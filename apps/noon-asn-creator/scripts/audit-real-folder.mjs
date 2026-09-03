import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import JSZip from "jszip";
import { STORE_CONFIGS, storeConfig } from "../dist/src/contracts.js";
import { readOoxmlSheet } from "../dist/src/ooxml.js";
import { loadCredential, loginNoon } from "../dist/src/noon/auth.js";
import { ContractApiGateway } from "../dist/src/noon/api-gateway.js";
import { loadContractBundle } from "../dist/src/noon/contract-loader.js";
import { bindOperation } from "../dist/src/noon/contract-replay.js";
import { itemsExactlyMatch } from "../dist/src/noon/verifier.js";
import { JournalStore, transition } from "../dist/src/journal.js";
import { isSkippedWorkbook, readAsnJob, writeAsnNumber } from "../dist/src/workbook.js";

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function fetchJsonWithRetry(url, init) {
  const delays = [0, 1_000, 3_000];
  let lastError;
  for (const delay of delays) {
    if (delay) await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
    try {
      const response = await fetch(url, init);
      if (response.status !== 429 && response.status < 500) {
        return { response, body: await response.json().catch(() => undefined) };
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function workbookStructure(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const sheetPath = "xl/worksheets/sheet1.xml";
  const sheetFile = zip.file(sheetPath);
  if (!sheetFile) throw new Error("Worksheet part is missing");
  const source = (await sheetFile.async("string")).replace(/^\uFEFF/, "").trimStart();
  const document = new DOMParser().parseFromString(source, "application/xml");
  const cells = Array.from(document.getElementsByTagNameNS(MAIN_NS, "c"));
  const c2 = cells.find((cell) => cell.getAttribute("r")?.toUpperCase() === "C2");
  if (!c2) throw new Error("C2 is missing");
  while (c2.firstChild) c2.removeChild(c2.firstChild);
  c2.removeAttribute("t");
  const otherParts = {};
  for (const [name, file] of Object.entries(zip.files).sort(([left], [right]) => left.localeCompare(right))) {
    if (file.dir || name === sheetPath) continue;
    otherParts[name] = sha256(await file.async("nodebuffer"));
  }
  return {
    normalizedSheetHash: sha256(new XMLSerializer().serializeToString(document)),
    otherParts,
  };
}

async function snapshot(folder) {
  const files = (await readdir(folder)).filter((name) => !name.startsWith("~$") && name.toLowerCase().endsWith(".xlsx"))
    .sort((left, right) => left.localeCompare(right, "zh-CN", { numeric: true }));
  const entries = [];
  for (const fileName of files) {
    const filePath = join(folder, fileName);
    const bytes = await readFile(filePath);
    const sheet = await readOoxmlSheet(bytes, "约仓");
    const parsed = await readAsnJob(filePath);
    entries.push({
      fileName,
      fileHash: sha256(bytes),
      c2: String(sheet.values.get("C2") ?? "").trim(),
      ...(isSkippedWorkbook(parsed) ? {} : {
        storeIndex: parsed.storeIndex,
        projectCode: parsed.projectCode,
        itemCount: parsed.items.length,
        totalQuantity: parsed.items.reduce((total, item) => total + item.quantity, 0),
      }),
      ...(await workbookStructure(bytes)),
    });
  }
  return { folder, createdAt: new Date().toISOString(), entries };
}

async function verifyServer(folder, backupFolder, allowIncomplete = false, collectFailures = false) {
  const contract = await loadContractBundle(resolve(import.meta.dirname, "..", "contracts", "noon-uae-asn.v1.json"));
  const credentialDirectory = process.env.NOON_CREDENTIAL_DIR ?? "D:\\noon-api";
  const sessions = new Map();
  const refreshSession = async (storeIndex) => {
    const store = storeConfig(storeIndex);
    const session = await loginNoon(await loadCredential(join(credentialDirectory, store.credentialFile), store));
    sessions.set(storeIndex, session);
    return session;
  };
  const gateway = new ContractApiGateway(contract, { refreshSession });
  const files = (await readdir(folder)).filter((name) => !name.startsWith("~$") && name.toLowerCase().endsWith(".xlsx"));
  const results = [];
  for (const fileName of files) {
    const current = await readAsnJob(join(folder, fileName));
    if (!isSkippedWorkbook(current)) {
      if (allowIncomplete) continue;
      throw new Error(`${fileName}: C2 is blank after the run`);
    }
    const job = await readAsnJob(join(backupFolder, fileName));
    if (isSkippedWorkbook(job)) throw new Error(`${fileName}: backup already contained C2`);
    let session = sessions.get(job.storeIndex);
    if (!session) session = await refreshSession(job.storeIndex);
    let details;
    try {
      details = await gateway.getDetails(current.skippedAsn, job, session);
    } catch (error) {
      if (collectFailures) {
        results.push({
          fileName,
          storeIndex: job.storeIndex,
          itemCount: job.items.length,
          verified: false,
          kind: error?.kind ?? "unexpected",
          httpStatus: error?.status ?? null,
        });
        continue;
      }
      throw new Error(`${fileName} (store ${job.storeIndex}): detail verification failed`, { cause: error });
    }
    const verified = details.projectCode === job.projectCode && itemsExactlyMatch(job.items, details.items);
    if (!verified) {
      if (collectFailures) {
        results.push({
          fileName,
          storeIndex: job.storeIndex,
          itemCount: job.items.length,
          verified: false,
          kind: "verification",
          httpStatus: null,
        });
        continue;
      }
      throw new Error(`${fileName}: Noon details mismatch`);
    }
    results.push({ fileName, storeIndex: job.storeIndex, itemCount: job.items.length, verified: true });
  }
  return results.sort((left, right) => left.fileName.localeCompare(right.fileName, "zh-CN", { numeric: true }));
}

async function diagnoseIncomplete(folder, backupFolder) {
  const contract = await loadContractBundle(resolve(import.meta.dirname, "..", "contracts", "noon-uae-asn.v1.json"));
  const credentialDirectory = process.env.NOON_CREDENTIAL_DIR ?? "D:\\noon-api";
  const sessions = new Map();
  const rowsByStore = new Map();
  const files = (await readdir(folder)).filter((name) => name.toLowerCase().endsWith(".xlsx"));
  const results = [];
  for (const fileName of files) {
    const current = await readAsnJob(join(folder, fileName));
    if (isSkippedWorkbook(current)) continue;
    const job = await readAsnJob(join(backupFolder, fileName));
    if (isSkippedWorkbook(job)) throw new Error(`${fileName}: backup already completed`);
    let session = sessions.get(job.storeIndex);
    if (!session) {
      const store = storeConfig(job.storeIndex);
      session = await loginNoon(await loadCredential(join(credentialDirectory, store.credentialFile), store));
      sessions.set(job.storeIndex, session);
    }
    let rows = rowsByStore.get(job.storeIndex);
    if (!rows) {
      const request = bindOperation(contract, "find", job, session);
      const response = await fetch(request.url, { method: request.method, headers: request.headers, body: JSON.stringify(request.body) });
      if (response.status !== 200) throw new Error(`Store ${job.storeIndex}: list HTTP ${response.status}`);
      rows = (await response.json())?.data?.rows ?? [];
      rowsByStore.set(job.storeIndex, rows);
    }
    const expectedTotal = job.items.reduce((total, item) => total + item.quantity, 0);
    const candidates = rows.filter((row) => Number(row.total_qty) === expectedTotal).map((row) => {
      const items = Array.isArray(row.lines) ? row.lines.map((line) => ({ partnerSku: String(line.partner_sku), quantity: Number(line.qty) })) : [];
      return {
        asnNumber: row.asn_nr,
        createdAt: row.created_at,
        status: row.status,
        totalQuantity: row.total_qty,
        lineCount: items.length,
        exact: itemsExactlyMatch(job.items, items),
      };
    });
    results.push({ fileName, storeIndex: job.storeIndex, itemCount: job.items.length, expectedTotal, candidates });
  }
  return results.sort((left, right) => left.fileName.localeCompare(right.fileName, "zh-CN", { numeric: true }));
}

async function diagnosePending(folder, backupFolder) {
  const contract = await loadContractBundle(resolve(import.meta.dirname, "..", "contracts", "noon-uae-asn.v1.json"));
  const credentialDirectory = process.env.NOON_CREDENTIAL_DIR ?? "D:\\noon-api";
  const sessions = new Map();
  const gateway = new ContractApiGateway(contract);
  const journal = new JournalStore();
  const files = (await readdir(folder)).filter((name) => name.toLowerCase().endsWith(".xlsx"));
  const results = [];
  for (const fileName of files) {
    const job = await readAsnJob(join(folder, fileName));
    if (isSkippedWorkbook(job)) continue;
    const backup = await readAsnJob(join(backupFolder, fileName));
    if (isSkippedWorkbook(backup)) throw new Error(`${fileName}: backup already completed`);
    const entry = await journal.get(job);
    if (!entry?.pendingAsn) throw new Error(`${fileName}: pending ASN is missing from the journal`);
    let session = sessions.get(job.storeIndex);
    if (!session) {
      const store = storeConfig(job.storeIndex);
      session = await loginNoon(await loadCredential(join(credentialDirectory, store.credentialFile), store));
      sessions.set(job.storeIndex, session);
    }
    const details = await gateway.getDetails(entry.pendingAsn, job, session);
    const expected = new Map(job.items.map((item) => [item.partnerSku, item.quantity]));
    const seen = new Set();
    const exactSubset = details.items.every((item) => {
      if (seen.has(item.partnerSku) || expected.get(item.partnerSku) !== item.quantity) return false;
      seen.add(item.partnerSku);
      return true;
    });
    results.push({
      fileName,
      storeIndex: job.storeIndex,
      asnNumber: entry.pendingAsn,
      expectedLineCount: job.items.length,
      actualLineCount: details.items.length,
      expectedTotal: job.items.reduce((total, item) => total + item.quantity, 0),
      actualTotal: details.items.reduce((total, item) => total + item.quantity, 0),
      exactSubset,
      exact: details.projectCode === job.projectCode && itemsExactlyMatch(job.items, details.items),
    });
  }
  return results.sort((left, right) => left.fileName.localeCompare(right.fileName, "zh-CN", { numeric: true }));
}

async function diagnoseRoutes(folder, backupFolder) {
  const contract = await loadContractBundle(resolve(import.meta.dirname, "..", "contracts", "noon-uae-asn.v1.json"));
  const credentialDirectory = process.env.NOON_CREDENTIAL_DIR ?? "D:\\noon-api";
  const sessions = new Map();
  const journal = new JournalStore();
  const files = (await readdir(folder)).filter((name) => name.toLowerCase().endsWith(".xlsx"));
  const results = [];
  fileLoop: for (const fileName of files) {
    const job = await readAsnJob(join(folder, fileName));
    if (isSkippedWorkbook(job)) continue;
    const backup = await readAsnJob(join(backupFolder, fileName));
    if (isSkippedWorkbook(backup)) throw new Error(`${fileName}: backup already completed`);
    const entry = await journal.get(job);
    if (!entry?.pendingAsn) throw new Error(`${fileName}: pending ASN is missing from the journal`);
    let session = sessions.get(job.storeIndex);
    if (!session) {
      const store = storeConfig(job.storeIndex);
      session = await loginNoon(await loadCredential(join(credentialDirectory, store.credentialFile), store));
      sessions.set(job.storeIndex, session);
    }
    const routeItems = [];
    const catalogMetadata = [];
    const sensitiveValues = [entry.pendingAsn, job.projectCode, job.partnerId, ...job.items.map((item) => item.partnerSku)];
    for (const item of job.items) {
      const eligible = bindOperation(contract, "eligible", job, session, undefined, { partnerSku: item.partnerSku });
      const eligibleResult = await fetchJsonWithRetry(eligible.url, {
        method: eligible.method,
        headers: eligible.headers,
        body: JSON.stringify(eligible.body),
      });
      const eligibleResponse = eligibleResult.response;
      if (eligibleResponse.status !== 200) {
        results.push({
          fileName,
          storeIndex: job.storeIndex,
          asnNumber: entry.pendingAsn,
          status: eligibleResponse.status,
          routeCount: 0,
          isTransfer: false,
          errorCategory: eligibleResponse.status === 401 ? "authentication" : "eligible_http",
        });
        continue fileLoop;
      }
      const rows = eligibleResult.body?.rows ?? [];
      const matches = rows.filter((row) => row.partner_sku === item.partnerSku);
      if (matches.length !== 1) throw new Error(`${fileName}: eligible SKU match is not unique`);
      sensitiveValues.push(matches[0].partner_sku, matches[0].psku_code, matches[0].sku);
      routeItems.push({ sku: matches[0].sku, qty: item.quantity, storage_type_code: matches[0].storage_type_code });
      catalogMetadata.push({
        storageType: matches[0].storage_type_code,
        sizeClassification: matches[0].size_classification ?? "missing",
        hasPositiveVolume: typeof matches[0].cubic_feet === "number" && matches[0].cubic_feet > 0,
      });
    }
    const route = bindOperation(contract, "route", job, session, entry.pendingAsn, { routeItems });
    const routeResult = await fetchJsonWithRetry(route.url, {
      method: route.method,
      headers: route.headers,
      body: JSON.stringify(route.body),
    });
    const routeResponse = routeResult.response;
    const routeBody = routeResult.body;
    const routeError = typeof routeBody?.error === "string" ? routeBody.error : "";
    const errorTemplate = sensitiveValues
      .filter((value) => typeof value === "string" && value.length > 0)
      .sort((left, right) => right.length - left.length)
      .reduce((message, value) => message.replaceAll(value, "<ID>"), routeError)
      .replace(/\s+/g, " ")
      .slice(0, 500);
    const errorCategory = /split\s+asn|empty_route|storage type/i.test(routeError)
      ? "split_required"
      : /psku_codes|other asn|already.*asn/i.test(routeError)
        ? "item_conflict"
        : routeError
          ? "other"
          : "none";
    const storageTypeCounts = routeItems.reduce((counts, item) => {
      const key = typeof item.storage_type_code === "string" ? item.storage_type_code : "unknown";
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {});
    const sizeClassificationCounts = catalogMetadata.reduce((counts, item) => {
      const key = typeof item.sizeClassification === "string" ? item.sizeClassification : "missing";
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {});
    const positiveVolumeCount = catalogMetadata.filter((item) => item.hasPositiveVolume).length;
    const catalogAttributeCounts = catalogMetadata.reduce((counts, item) => {
      const key = [
        item.storageType ?? "unknown",
        item.sizeClassification ?? "missing",
        item.hasPositiveVolume ? "volume" : "no_volume",
      ].join("|");
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {});
    const splitChecks = [];
    if (errorCategory === "split_required") {
      for (const [storageType, count] of Object.entries(storageTypeCounts)) {
        const groupItems = routeItems.filter((item) => item.storage_type_code === storageType);
        const groupRequest = bindOperation(contract, "route", job, session, entry.pendingAsn, { routeItems: groupItems });
        const groupResult = await fetchJsonWithRetry(groupRequest.url, {
          method: groupRequest.method,
          headers: groupRequest.headers,
          body: JSON.stringify(groupRequest.body),
        });
        splitChecks.push({
          storageType,
          lineCount: count,
          status: groupResult.response.status,
          routeCount: Array.isArray(groupResult.body?.data) ? groupResult.body.data.length : 0,
        });
      }
    }
    results.push({
      fileName,
      storeIndex: job.storeIndex,
      asnNumber: entry.pendingAsn,
      status: routeResponse.status,
      routeCount: Array.isArray(routeBody?.data) ? routeBody.data.length : 0,
      isTransfer: routeBody?.is_transfer === true,
      storageTypeCounts,
      sizeClassificationCounts,
      positiveVolumeCount,
      catalogAttributeCounts,
      errorCategory,
      ...(splitChecks.length ? { splitChecks } : {}),
      ...(errorTemplate ? { errorTemplate } : {}),
    });
  }
  return results.sort((left, right) => left.fileName.localeCompare(right.fileName, "zh-CN", { numeric: true }));
}

async function applyDiagnosed(folder, evidencePath) {
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  const journal = new JournalStore();
  const results = [];
  for (const item of evidence) {
    if (item.exact !== true || typeof item.asnNumber !== "string") continue;
    const filePath = join(folder, item.fileName);
    const job = await readAsnJob(filePath);
    if (isSkippedWorkbook(job)) {
      if (job.skippedAsn !== item.asnNumber) throw new Error(`${item.fileName}: C2 differs from verified evidence`);
      results.push({ fileName: item.fileName, asnNumber: item.asnNumber, status: "already_written" });
      continue;
    }
    const entry = await journal.get(job);
    if (!entry || entry.pendingAsn !== item.asnNumber || entry.stage !== "verifying") {
      throw new Error(`${item.fileName}: journal no longer matches verified evidence`);
    }
    const confirmed = transition(entry, "confirmed", { confirmedAsn: item.asnNumber });
    await journal.put(confirmed);
    await writeAsnNumber(job, item.asnNumber);
    await journal.put(transition(confirmed, "written"));
    results.push({ fileName: item.fileName, asnNumber: item.asnNumber, status: "written" });
  }
  return results;
}

async function markSplitReview(folder, evidencePath) {
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  const journal = new JournalStore();
  const results = [];
  for (const item of evidence.filter((candidate) => candidate.errorCategory === "split_required")) {
    const job = await readAsnJob(join(folder, item.fileName));
    if (isSkippedWorkbook(job)) throw new Error(`${item.fileName}: workbook is already completed`);
    const entry = await journal.get(job);
    if (!entry) throw new Error(`${item.fileName}: journal entry is missing`);
    if (entry.stage === "needs_review") {
      results.push({ fileName: item.fileName, status: "already_needs_review" });
      continue;
    }
    if (entry.stage !== "verifying") throw new Error(`${item.fileName}: expected verifying stage, received ${entry.stage}`);
    const error = {
      kind: "verification",
      stage: "route",
      message: "Noon routing requires this workbook to be split into multiple ASNs",
    };
    await journal.put(transition(entry, "needs_review", { error }));
    results.push({ fileName: item.fileName, status: "needs_review" });
  }
  return results;
}

async function checkAuthentication(credentialDirectory) {
  const results = [];
  for (const store of STORE_CONFIGS) {
    try {
      const session = await loginNoon(await loadCredential(join(credentialDirectory, store.credentialFile), store));
      const cookieNames = session.cookieHeader
        .split(";")
        .map((cookie) => cookie.trim().split("=", 1)[0])
        .filter(Boolean)
        .sort();
      results.push({ storeIndex: store.index, credentialFile: store.credentialFile, status: "ok", cookieNames });
    } catch (error) {
      results.push({
        storeIndex: store.index,
        credentialFile: store.credentialFile,
        status: "failed",
        kind: error?.kind ?? "unexpected",
        httpStatus: error?.status ?? null,
        stage: error?.stage ?? "authentication",
      });
    }
  }
  return results;
}

const [command, folderArg, outputArg, backupArg] = process.argv.slice(2);
if (!command || !folderArg) throw new Error("Usage: audit-real-folder.mjs snapshot|compare|verify <folder> [output-or-before] [backup]");
const folder = resolve(folderArg);
if (command === "auth-check") {
  process.stdout.write(`${JSON.stringify(await checkAuthentication(folder), null, 2)}\n`);
} else if (command === "snapshot") {
  if (!outputArg) throw new Error("Snapshot output path is required");
  await writeFile(resolve(outputArg), `${JSON.stringify(await snapshot(folder), null, 2)}\n`, "utf8");
  process.stdout.write(`Snapshot written for ${(await readdir(folder)).filter((name) => name.endsWith(".xlsx")).length} workbooks\n`);
} else if (command === "compare" || command === "compare-partial") {
  if (!outputArg) throw new Error("Before snapshot path is required");
  const before = JSON.parse(await readFile(resolve(outputArg), "utf8"));
  const after = await snapshot(folder);
  const failures = [];
  for (const previous of before.entries) {
    const current = after.entries.find((entry) => entry.fileName === previous.fileName);
    if (!current) { failures.push(`${previous.fileName}: missing`); continue; }
    if (command === "compare" && !current.c2) failures.push(`${previous.fileName}: C2 blank`);
    if (current.normalizedSheetHash !== previous.normalizedSheetHash) failures.push(`${previous.fileName}: worksheet changed outside C2`);
    if (JSON.stringify(current.otherParts) !== JSON.stringify(previous.otherParts)) failures.push(`${previous.fileName}: non-worksheet OOXML part changed`);
  }
  if (after.entries.length !== before.entries.length) failures.push("Workbook count changed");
  if (failures.length) throw new Error(failures.join("; "));
  const completed = after.entries.filter((entry) => entry.c2).length;
  process.stdout.write(`All ${after.entries.length} workbooks changed only at C2; completed=${completed} blank=${after.entries.length - completed}\n`);
} else if (command === "verify" || command === "verify-partial" || command === "verify-report") {
  if (!backupArg) throw new Error("Backup folder is required");
  const results = await verifyServer(
    folder,
    resolve(backupArg),
    command !== "verify",
    command === "verify-report",
  );
  if (outputArg) await writeFile(resolve(outputArg), `${JSON.stringify(results, null, 2)}\n`, "utf8");
  const verified = results.filter((item) => item.verified).length;
  process.stdout.write(`${verified}/${results.length} Noon ASN details match their workbooks\n`);
} else if (command === "diagnose") {
  if (!backupArg) throw new Error("Backup folder is required");
  const results = await diagnoseIncomplete(folder, resolve(backupArg));
  if (outputArg) await writeFile(resolve(outputArg), `${JSON.stringify(results, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
} else if (command === "diagnose-pending") {
  if (!backupArg) throw new Error("Backup folder is required");
  const results = await diagnosePending(folder, resolve(backupArg));
  if (outputArg) await writeFile(resolve(outputArg), `${JSON.stringify(results, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
} else if (command === "diagnose-route") {
  if (!backupArg) throw new Error("Backup folder is required");
  const results = await diagnoseRoutes(folder, resolve(backupArg));
  if (outputArg) await writeFile(resolve(outputArg), `${JSON.stringify(results, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
} else if (command === "apply-diagnosed") {
  if (!outputArg) throw new Error("Evidence path is required");
  const results = await applyDiagnosed(folder, resolve(outputArg));
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
} else if (command === "mark-split-review") {
  if (!outputArg) throw new Error("Evidence path is required");
  const results = await markSplitReview(folder, resolve(outputArg));
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
} else if (command === "recover-journal") {
  if (!outputArg) throw new Error("Recovery map path is required");
  const recovery = JSON.parse(await readFile(resolve(outputArg), "utf8"));
  const journal = new JournalStore();
  for (const item of recovery) {
    const job = await readAsnJob(join(folder, item.fileName));
    if (isSkippedWorkbook(job)) throw new Error(`${item.fileName}: workbook already completed`);
    const entry = await journal.get(job);
    if (!entry) throw new Error(`${item.fileName}: journal entry is missing`);
    if (item.pendingAsn) {
      await journal.put({ ...entry, pendingAsn: item.pendingAsn, updatedAt: new Date().toISOString() });
    } else {
      if (entry.stage !== "verifying") throw new Error(`${item.fileName}: expected verifying stage, received ${entry.stage}`);
      await journal.put(transition(entry, "failed", {
        error: { kind: "verification", stage: "recovery", message: "No server-side ASN main record found; safe retry authorized" },
      }));
    }
  }
  process.stdout.write(`Updated ${recovery.length} journal entries for safe recovery\n`);
} else {
  throw new Error(`Unknown command: ${command}`);
}
