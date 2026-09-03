import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { loadCredential, loginNoon } from "./auth.mjs";
import { downloadCampaignReport } from "./ad-client.mjs";
import { latestCompletedWeek } from "./dates.mjs";
import { SITES, STORES, validateRange } from "./contracts.mjs";

function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (!key?.startsWith("--") || !value) throw new Error(`Invalid argument near ${key ?? "end"}`);
    parsed[key.slice(2)] = value;
  }
  return parsed;
}

async function exists(path) {
  try { await access(path, constants.F_OK); return true; } catch { return false; }
}

async function completeDirectory(path) {
  for (const store of STORES) {
    const file = join(path, `${store.partnerId}.xlsx`);
    if (!(await exists(file))) return false;
    const signature = (await readFile(file)).subarray(0, 4).toString("hex");
    if (signature !== "504b0304") return false;
  }
  return true;
}

export async function run(args = process.argv.slice(2), env = process.env) {
  const parsed = parseArgs(args);
  const siteCode = (parsed.site ?? "").toUpperCase();
  const site = SITES[siteCode];
  if (!site) throw new Error("--site must be UAE or KSA");
  const defaults = latestCompletedWeek(siteCode);
  const fromDate = parsed.from ?? defaults.fromDate;
  const toDate = parsed.to ?? defaults.toDate;
  validateRange(siteCode, fromDate, toDate);
  const credentialDir = resolve(parsed["credential-dir"] ?? env.NOON_CREDENTIAL_DIR ?? "D:/noon-api");
  const outputRoot = resolve(parsed["output-root"] ?? env.NOON_AD_REPORT_ROOT ?? join(env.LOCALAPPDATA ?? process.cwd(), "NoonAdCollector", "reports"));
  const target = join(outputRoot, `${fromDate}_${toDate}`, siteCode);
  if (await exists(target)) {
    if (!(await completeDirectory(target))) throw new Error(`Existing advertising output is incomplete: ${target}`);
    return { status: "reused", site: siteCode, fromDate, toDate, directory: target, files: STORES.map((store) => join(target, `${store.partnerId}.xlsx`)) };
  }
  const staging = join(outputRoot, ".staging", `${siteCode}-${fromDate}_${toDate}-${randomUUID()}`);
  await mkdir(staging, { recursive: true });
  const files = [];
  try {
    for (const store of STORES) {
      const credential = await loadCredential(join(credentialDir, store.credentialFile), store);
      const cookieHeader = await loginNoon(credential);
      const buffer = await downloadCampaignReport({ site, store, cookieHeader, fromDate, toDate });
      const destination = join(staging, `${store.partnerId}.xlsx`);
      await writeFile(destination, buffer);
      files.push({ store: store.partnerId, path: destination, bytes: buffer.length });
    }
    await mkdir(resolve(target, ".."), { recursive: true });
    if (await exists(target)) throw new Error(`Advertising output appeared during publish: ${target}`);
    await rename(staging, target);
    return {
      status: "downloaded", site: siteCode, fromDate, toDate, directory: target,
      files: files.map((file) => ({ ...file, path: join(target, `${file.store}.xlsx`) })),
    };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

if (import.meta.url === `file:///${process.argv[1]?.replaceAll("\\", "/")}`) {
  run().then(
    (result) => process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`),
    (error) => {
      process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
      process.exitCode = 1;
    },
  );
}
