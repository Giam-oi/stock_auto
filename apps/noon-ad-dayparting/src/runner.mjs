import { appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { createAdClient, targetPayload } from "./ad-client.mjs";
import { loadCredential, loginNoon } from "./auth.mjs";
import { STORES, isoDateInZone, subtractDays } from "./contracts.mjs";
import { classifyPerformance, dubaiHour, factorFor, periodForHour, resolvePolicyCooldown, roundBid } from "./policy.mjs";
import { readJson, writeJsonAtomic } from "./state.mjs";
import { aggregateTargetMetrics, targetMetricKey, targetMetricsFromReport } from "./target-report.mjs";
import { appendSmartSheet, sendWeCom } from "./wecom.mjs";
import { hasSaleableFbnProduct, loadSaleableInventory } from "./inventory.mjs";

const targetKey = (store, id) => `${store}|${id}`;
const PROTECTED_CAMPAIGNS = new Set(["C_YJ2S0828WZ", "C_YNLBNZN399"]);
const PROTECTION_MODE_UNTIL = Date.parse("2026-09-09T00:00:00+04:00");
const EXPLORATION_SPEND_CAP = 0.20;
const ageDays = (createdAt, now) => Math.floor((now.getTime() - Date.parse(createdAt)) / 86_400_000);
const campaignData = (details) => details?.campaign ?? details?.data?.campaign ?? details;

function targetsFromDetails(details) {
  const targeting = details?.targeting ?? details?.data?.targeting ?? [];
  return targeting.flatMap((group) => {
    const adgroupCode = group?.metadata?.adgroupCode;
    if (!adgroupCode) return [];
    return [...(group.targetedKeywords ?? []), ...(group.targetedCategories ?? [])]
      .map((target) => ({ ...target, adgroupCode: target.adgroupCode ?? adgroupCode }));
  });
}

function metricMatch(index, campaignName, target) {
  const key = targetMetricKey({
    campaignName, targetingType: target.targetingType,
    targetValue: target.targetValue, strategy: target.strategy,
  });
  const rows = index.get(key) ?? [];
  return { key, rows, metric: rows.length === 1 ? rows[0] : null };
}

async function loadTargetReports(client, store, fromDate, toDate, services) {
  if (services.loadTargetReports) return services.loadTargetReports(store, fromDate, toDate);
  const [historical, previousDay] = await Promise.all([
    client.downloadReport(fromDate, toDate), client.downloadReport(toDate, toDate),
  ]);
  return {
    historical: await targetMetricsFromReport(historical),
    previousDay: await targetMetricsFromReport(previousDay),
  };
}

async function session(store, options, services) {
  const credential = await (services.loadCredential ?? loadCredential)(join(options.credentialDir, store.credentialFile), store);
  let cookie;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try { cookie = await (services.login ?? loginNoon)(credential); break; }
    catch (error) {
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_500));
    }
  }
  return (services.createClient ?? createAdClient)({ store, cookie });
}

function collectCampaignCodes(value, output = new Set()) {
  if (Array.isArray(value)) for (const item of value) collectCampaignCodes(item, output);
  else if (value && typeof value === "object") {
    if (typeof value.campaignCode === "string") output.add(value.campaignCode);
    for (const item of Object.values(value)) collectCampaignCodes(item, output);
  }
  return output;
}

function collectVerifiedBidActions(value, source, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectVerifiedBidActions(item, source, output);
  } else if (value && typeof value === "object") {
    const afterBid = Number(value.afterBid);
    const idAdgroupTarget = Number(value.idAdgroupTarget);
    const executedAt = value.executedAt ?? value.verifiedAt ?? value.completedAt;
    const successfulStatus = !value.status || ["updated", "success", "succeeded"].includes(String(value.status).toLowerCase());
    if (value.readBackVerified === true && successfulStatus && Number.isFinite(afterBid)
      && Number.isFinite(idAdgroupTarget) && value.store != null && executedAt && Number.isFinite(Date.parse(executedAt))) {
      output.push({
        store: String(value.store), idAdgroupTarget, campaignCode: value.campaignCode,
        afterBid, executedAt, source,
      });
    }
    for (const item of Object.values(value)) collectVerifiedBidActions(item, source, output);
  }
  return output;
}

export async function loadVerifiedBidActions(receiptRoot) {
  const latest = new Map();
  let files = [];
  try { files = await readdir(receiptRoot, { withFileTypes: true }); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  for (const file of files) {
    if (!file.isFile() || !/receipt.*\.json$/i.test(file.name)) continue;
    try {
      const value = JSON.parse(await readFile(join(receiptRoot, file.name), "utf8"));
      for (const row of collectVerifiedBidActions(value, file.name)) {
        const key = targetKey(row.store, row.idAdgroupTarget);
        const previous = latest.get(key);
        if (!previous || Date.parse(row.executedAt) > Date.parse(previous.executedAt)) latest.set(key, row);
      }
    } catch { /* Ignore unrelated or malformed historical artifacts. */ }
  }
  return latest;
}

export function verifiedExternalBase({ key, actualBid, priorTarget, stateUpdatedAt, action }) {
  if (!action || Math.abs(Number(action.afterBid) - Number(actualBid)) > 0.0001) return null;
  const priorAppliedAt = priorTarget?.lastAppliedAt ?? stateUpdatedAt;
  if (priorAppliedAt && Date.parse(action.executedAt) <= Date.parse(priorAppliedAt)) return null;
  return Number(action.afterBid);
}

export async function seedCooldowns(options, services = {}) {
  const now = services.now?.() ?? new Date();
  const files = await readdir(options.receiptRoot, { withFileTypes: true });
  const rows = [];
  for (const file of files) {
    if (!file.isFile() || !/receipt.*\.json$/i.test(file.name)) continue;
    try {
      const value = JSON.parse(await readFile(join(options.receiptRoot, file.name), "utf8"));
      const adjustedAt = value.executedAt ?? value.verifiedAt ?? value.completedAt;
      if (!adjustedAt || now.getTime() - Date.parse(adjustedAt) > 7 * 86_400_000) continue;
      for (const campaignCode of collectCampaignCodes(value)) rows.push({ campaignCode, adjustedAt, source: file.name });
    } catch { /* Ignore unrelated or malformed historical artifacts. */ }
  }
  const latest = new Map();
  for (const row of rows) {
    const previous = latest.get(row.campaignCode);
    if (!previous || Date.parse(row.adjustedAt) > Date.parse(previous.adjustedAt)) latest.set(row.campaignCode, row);
  }
  const output = { version: 1, generatedAt: now.toISOString(), campaigns: [...latest.values()].sort((a, b) => a.campaignCode.localeCompare(b.campaignCode)) };
  await writeJsonAtomic(options.cooldownPath, output);
  return output;
}

export async function collectHourly(options, services = {}) {
  const now = services.now?.() ?? new Date();
  const reportDate = isoDateInZone(now);
  const capturedAt = now.toISOString();
  const stamp = capturedAt.replaceAll(":", "-").replaceAll(".", "-");
  const dayRoot = join(options.hourlyRoot, reportDate);
  const staging = join(dayRoot, ".staging", `${stamp}-${process.pid}`);
  const destination = join(dayRoot, stamp);
  const files = [];
  await mkdir(staging, { recursive: true });
  try {
    for (const store of STORES) {
      const client = await session(store, options, services);
      const buffer = await client.downloadReport(reportDate, reportDate);
      const name = `${store.partnerId}.xlsx`;
      await writeFile(join(staging, name), buffer);
      files.push({
        store: store.partnerId, name, bytes: buffer.length,
        sha256: createHash("sha256").update(buffer).digest("hex"),
      });
    }
    const manifest = {
      version: 1, site: "UAE", reportDate, capturedAt, successful: true,
      semantics: "same-day cumulative Noon advertising report; hourly metrics require adjacent-snapshot deltas",
      stores: files,
    };
    await writeFile(join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await mkdir(dayRoot, { recursive: true });
    await rename(staging, destination);
    const result = { mode: "collect", ...manifest, directory: destination };
    await writeJsonAtomic(options.resultPath, result);
    return result;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    const result = { mode: "collect", reportDate, capturedAt, successful: false, error: error.message, files };
    await writeJsonAtomic(options.resultPath, result);
    return result;
  }
}

export async function evaluate(options, services = {}) {
  const now = services.now?.() ?? new Date();
  const inventoryDate = isoDateInZone(now);
  const toDate = subtractDays(inventoryDate, 1);
  const fromDate = subtractDays(toDate, 13);
  const priorState = await readJson(options.statePath, { version: 1, targets: {} });
  const verifiedActions = await loadVerifiedBidActions(options.receiptRoot);
  const protectionMode = now.getTime() < PROTECTION_MODE_UNTIL;
  const plan = {
    version: 3, generatedAt: now.toISOString(), fromDate, toDate, inventoryDate,
    hardRoas: 8, optimizationRoas: 10,
    scope: "target-level metrics for live campaigns with at least one active FBN product having positive saleable inventory",
    metricSemantics: "auto keyword and auto category are classified independently; current UAE day is excluded",
    cooldownDays: 7, protectionMode,
    protectionModeUntil: new Date(PROTECTION_MODE_UNTIL).toISOString(),
    explorationSpendCap: EXPLORATION_SPEND_CAP,
    protectedCampaigns: [...PROTECTED_CAMPAIGNS],
    stores: [], targets: [], warnings: [],
  };
  const errors = [];
  const previousDayTotals = [];
  for (const store of STORES) {
    try {
      const client = await session(store, options, services);
      const [rows, reports] = await Promise.all([
        client.campaignMetrics(fromDate, toDate), loadTargetReports(client, store, fromDate, toDate, services),
      ]);
      const inventory = await (services.loadSaleableInventory ?? loadSaleableInventory)(options.inventoryRoot, inventoryDate, store);
      previousDayTotals.push(reports.previousDay.total ?? aggregateTargetMetrics(reports.previousDay.rows));
      const counts = {
        protectedCampaigns: 0, noSaleableFbnCampaigns: 0, eligibleCampaigns: 0, targets: 0,
        unmatchedTargetMetrics: 0, ambiguousTargetMetrics: 0, portfolioPausedTargets: 0,
      };
      const storeTargetStart = plan.targets.length;
      for (const row of rows) {
        const code = row.campaign?.campaignCode;
        if (!code || row.campaign?.status !== "live") continue;
        if (PROTECTED_CAMPAIGNS.has(code)) { counts.protectedCampaigns += 1; continue; }
        const listedCreatedAt = row.campaign?.createdAt ?? row.campaign?.startTime;
        let details;
        try { details = await client.details(code); }
        catch (error) {
          errors.push({ store: store.partnerId, campaignCode: code, stage: "details", message: error.message });
          continue;
        }
        const campaign = campaignData(details);
        if (campaign?.status !== "live" || !hasSaleableFbnProduct(details, inventory)) {
          counts.noSaleableFbnCampaigns += 1;
          continue;
        }
        const createdAt = campaign?.createdAt ?? campaign?.startTime ?? listedCreatedAt;
        const campaignName = campaign?.name ?? row.campaign?.name ?? "";
        counts.eligibleCampaigns += 1;
        for (const target of targetsFromDetails(details)) {
            const adgroupCode = target.adgroupCode;
            if (!target.isActive || !Number.isFinite(Number(target.bid)) || Number(target.bid) < 0.25) continue;
            const historicalMatch = metricMatch(reports.historical.index, campaignName, target);
            if (!historicalMatch.metric) {
              const ambiguous = historicalMatch.rows.length > 1;
              counts[ambiguous ? "ambiguousTargetMetrics" : "unmatchedTargetMetrics"] += 1;
              plan.warnings.push({
                store: store.partnerId, campaignCode: code, adgroupCode,
                target: target.targetValue, stage: ambiguous ? "ambiguous_target_metrics" : "missing_target_metrics",
                message: ambiguous ? `Target report returned ${historicalMatch.rows.length} matches` : "Target is absent from the 14-day report",
              });
              continue;
            }
            const dailyMatch = metricMatch(reports.previousDay.index, campaignName, target);
            const key = targetKey(store.partnerId, target.idAdgroupTarget);
            const previous = priorState.targets[key];
            const actual = Number(target.bid);
            const reconciledBase = previous && Math.abs(actual - Number(previous.lastAppliedBid)) > 0.0001
              ? verifiedExternalBase({ key, actualBid: actual, priorTarget: previous, stateUpdatedAt: priorState.updatedAt, action: verifiedActions.get(key) })
              : null;
            if (previous && Math.abs(actual - Number(previous.lastAppliedBid)) > 0.0001) {
              if (reconciledBase == null) {
                errors.push({ store: store.partnerId, campaignCode: code, adgroupCode, target: target.targetValue, stage: "manual_conflict", message: `expected ${previous.lastAppliedBid}, got ${actual}` });
                continue;
              }
            }
            const baseBid = reconciledBase ?? (previous ? Number(previous.baseBid) : actual);
            const rawPolicy = classifyPerformance({
              roas: historicalMatch.metric.roas, spends: historicalMatch.metric.spends,
              orders: historicalMatch.metric.orders, ageDays: createdAt ? ageDays(createdAt, now) : NaN,
            });
            const policy = resolvePolicyCooldown(rawPolicy, previous, now);
            const policyChanged = !previous?.tier || previous.tier !== policy.tier;
            plan.targets.push({
              key, store: store.partnerId, campaignCode: code, campaignName,
              adgroupCode, idAdgroupTarget: target.idAdgroupTarget, targetingType: target.targetingType,
              targetValue: target.targetValue, strategy: target.strategy, baseBid,
              lastAppliedBid: actual, tier: policy.tier, reason: policy.reason,
              pauseTarget: policy.pauseTarget === true,
              policyUpdatedAt: policyChanged ? now.toISOString() : (previous.policyUpdatedAt ?? now.toISOString()),
              reconciledFrom: reconciledBase == null ? undefined : verifiedActions.get(key).source,
              metrics: {
                roas: historicalMatch.metric.roas, spends: historicalMatch.metric.spends,
                orders: historicalMatch.metric.orders, revenue: historicalMatch.metric.revenue,
              },
              previousDayMetrics: dailyMatch.metric ? {
                roas: dailyMatch.metric.roas, spends: dailyMatch.metric.spends,
                orders: dailyMatch.metric.orders, revenue: dailyMatch.metric.revenue,
              } : { roas: 0, spends: 0, orders: 0, revenue: 0 },
            });
            counts.targets += 1;
        }
      }

      const storeTargets = plan.targets.slice(storeTargetStart);
      const dailyTotalSpend = Number(reports.previousDay.total?.spends ?? 0);
      const exploration = storeTargets.filter((target) => target.metrics.orders === 0
        && !target.pauseTarget && target.previousDayMetrics.spends > 0);
      let explorationSpend = exploration.reduce((sum, target) => sum + target.previousDayMetrics.spends, 0);
      const allowedExplorationSpend = dailyTotalSpend * EXPLORATION_SPEND_CAP;
      if (dailyTotalSpend > 0 && explorationSpend > allowedExplorationSpend) {
        for (const target of [...exploration].sort((a, b) => b.previousDayMetrics.spends - a.previousDayMetrics.spends)) {
          target.pauseTarget = true;
          target.tier = "zero_order_stop";
          target.reason = `${target.reason}；昨日全店0单探索消耗超过20%上限`;
          counts.portfolioPausedTargets += 1;
          explorationSpend -= target.previousDayMetrics.spends;
          if (explorationSpend <= allowedExplorationSpend) break;
        }
      }
      plan.stores.push({
        store: store.partnerId, status: "success", campaigns: rows.length,
        inventoryPath: inventory.path, inventorySnapshotAt: inventory.snapshotAt,
        previousDaySpend: dailyTotalSpend,
        previousDayExplorationSpend: exploration.reduce((sum, target) => sum + target.previousDayMetrics.spends, 0),
        ...counts,
      });
    } catch (error) {
      errors.push({ store: store.partnerId, stage: "evaluate", message: error.message });
      plan.stores.push({ store: store.partnerId, status: "failed", error: error.message });
    }
  }
  plan.previousDayMetrics = aggregateTargetMetrics(previousDayTotals);
  plan.raiseGuard = {
    allowRaises: !protectionMode && plan.previousDayMetrics.roas >= 8,
    reason: protectionMode ? "7天只降不升保护模式"
      : plan.previousDayMetrics.roas < 8 ? "昨日全店ROAS低于硬线8" : "昨日全店ROAS达到硬线8",
  };
  plan.errors = errors;
  plan.successful = errors.length === 0;
  if (!options.dryRun && plan.successful) {
    const targets = Object.fromEntries(plan.targets.map((row) => [row.key, {
      baseBid: row.baseBid, lastAppliedBid: row.lastAppliedBid, campaignCode: row.campaignCode,
      adgroupCode: row.adgroupCode, idAdgroupTarget: row.idAdgroupTarget,
      tier: row.tier, reason: row.reason, pauseTarget: row.pauseTarget,
      policyUpdatedAt: row.policyUpdatedAt,
      lastAppliedAt: priorState.targets[row.key]?.lastAppliedAt ?? now.toISOString(),
    }]));
    await writeJsonAtomic(options.planPath, plan);
    await writeJsonAtomic(options.statePath, { version: 1, updatedAt: now.toISOString(), targets });
  }
  await writeJsonAtomic(options.resultPath, { mode: "evaluate", dryRun: options.dryRun, ...plan });
  return plan;
}

function matchesIdentity(target, planned) {
  return Number(target.idAdgroupTarget) === Number(planned.idAdgroupTarget)
    && target.adgroupCode === planned.adgroupCode && target.targetingType === planned.targetingType
    && target.targetValue === planned.targetValue && target.strategy === planned.strategy;
}

function stashPayload(planned, target) {
  return {
    campaignCode: planned.campaignCode, adgroupCode: target.adgroupCode,
    bid: Number(target.bid), idAdgroupTarget: target.idAdgroupTarget,
    isActive: false, isbidUpdate: true, strategy: target.strategy,
    targetValue: target.targetValue, targetingType: target.targetingType,
  };
}

export async function apply(options, services = {}) {
  const now = services.now?.() ?? new Date();
  const period = periodForHour(dubaiHour(now));
  const plan = await readJson(options.planPath);
  const state = await readJson(options.statePath, { version: 1, targets: {} });
  const verifiedActions = await loadVerifiedBidActions(options.receiptRoot);
  if (!plan?.targets || !plan.generatedAt || now.getTime() - Date.parse(plan.generatedAt) > 8 * 86_400_000) {
    throw new Error("No current daypart plan is available");
  }
  const changes = [], errors = [], reconciliations = [];
  for (const store of STORES) {
    const rows = plan.targets.filter((row) => row.store === store.partnerId);
    if (!rows.length) continue;
    try {
      const client = await session(store, options, services);
      const groups = Map.groupBy(rows, (row) => row.adgroupCode);
      for (const [adgroupCode, plannedRows] of groups) {
        const liveCheck = campaignData(await client.details(plannedRows[0].campaignCode));
        if (liveCheck?.status !== "live") continue;
        const before = await client.targets(adgroupCode);
        const selected = [];
        let conflict = null;
        for (const planned of plannedRows) {
          const target = before.find((item) => matchesIdentity(item, planned));
          const expected = Number(state.targets[planned.key]?.lastAppliedBid ?? planned.lastAppliedBid);
          if (!target) {
            if (planned.pauseTarget === true) {
              state.targets[planned.key] = { ...state.targets[planned.key], isActive: false, lastAppliedAt: now.toISOString() };
              reconciliations.push({
                key: planned.key, store: store.partnerId, campaignCode: planned.campaignCode,
                idAdgroupTarget: planned.idAdgroupTarget, status: "pause-already-satisfied",
              });
              continue;
            }
            conflict = `${planned.targetValue}: expected ${expected}, got ${target?.bid ?? "missing"}`;
            break;
          }
          if (Math.abs(Number(target.bid) - expected) > 0.0001) {
            const reconciledBase = verifiedExternalBase({
              key: planned.key, actualBid: Number(target.bid), priorTarget: state.targets[planned.key],
              stateUpdatedAt: state.updatedAt, action: verifiedActions.get(planned.key),
            });
            if (reconciledBase == null) {
              conflict = `${planned.targetValue}: expected ${expected}, got ${target.bid}`;
              break;
            }
            planned.baseBid = reconciledBase;
            planned.lastAppliedBid = Number(target.bid);
            planned.reconciledFrom = verifiedActions.get(planned.key).source;
            state.targets[planned.key] = {
              ...state.targets[planned.key], baseBid: reconciledBase, lastAppliedBid: Number(target.bid),
              lastAppliedAt: verifiedActions.get(planned.key).executedAt,
            };
            reconciliations.push({
              key: planned.key, store: store.partnerId, campaignCode: planned.campaignCode,
              idAdgroupTarget: planned.idAdgroupTarget, baseBid: reconciledBase,
              receipt: planned.reconciledFrom,
            });
          }
          const desiredActive = planned.pauseTarget !== true;
          const policyBid = roundBid(planned.baseBid, factorFor(planned.tier, period));
          const raisesAllowed = plan.raiseGuard?.allowRaises === true && plan.protectionMode !== true;
          const desired = desiredActive && !raisesAllowed && policyBid > Number(target.bid)
            ? Number(target.bid) : (desiredActive ? policyBid : Number(target.bid));
          if (Math.abs(desired - Number(target.bid)) > 0.0001 || target.isActive !== desiredActive) {
            selected.push({ planned, target, desired, desiredActive });
          }
        }
        if (conflict) { errors.push({ store: store.partnerId, adgroupCode, stage: "precondition", message: conflict }); continue; }
        if (!selected.length) {
          if (!options.dryRun) await writeJsonAtomic(options.statePath, { ...state, updatedAt: now.toISOString() });
          continue;
        }
        if (options.dryRun) {
          changes.push(...selected.map(({ planned, target, desired, desiredActive }) => ({
            ...planned, period, action: desiredActive ? "bid_update" : "pause_target",
            beforeBid: Number(target.bid), afterBid: desired,
            beforeActive: target.isActive, afterActive: desiredActive, dryRun: true,
          })));
          continue;
        }
        const pauses = selected.filter((row) => !row.desiredActive);
        const bidUpdates = selected.filter((row) => row.desiredActive);

        for (const { planned, target, desired } of pauses) {
          try {
            const pauseBefore = await client.targets(adgroupCode);
            const liveTarget = pauseBefore.find((item) => matchesIdentity(item, planned));
            if (!liveTarget) continue;
            await client.stashTargets([stashPayload(planned, liveTarget)]);
            const pauseAfter = await client.targets(adgroupCode);
            const removed = !pauseAfter.some((item) => matchesIdentity(item, planned));
            const otherTargetsUnchanged = pauseBefore
              .filter((item) => !matchesIdentity(item, planned))
              .every((item) => {
                const current = pauseAfter.find((candidate) => Number(candidate.idAdgroupTarget) === Number(item.idAdgroupTarget));
                return current && Number(current.bid) === Number(item.bid) && current.isActive === item.isActive;
              });
            if (!removed || !otherTargetsUnchanged) {
              errors.push({
                store: store.partnerId, adgroupCode, stage: "pause_readback",
                message: `${planned.targetValue}: removed=${removed}; otherTargetsUnchanged=${otherTargetsUnchanged}`,
              });
              continue;
            }
            state.targets[planned.key] = {
              ...state.targets[planned.key], baseBid: planned.baseBid,
              lastAppliedBid: desired, isActive: false, lastAppliedAt: now.toISOString(),
            };
            changes.push({
              ...planned, planDate: plan.toDate, period, action: "pause_target",
              beforeBid: Number(target.bid), afterBid: desired,
              beforeActive: true, afterActive: false,
              executedAt: now.toISOString(), readBackVerified: true,
            });
          } catch (error) {
            errors.push({ store: store.partnerId, adgroupCode, stage: "pause", message: `${planned.targetValue}: ${error.message}` });
          }
        }

        let verifiedBidUpdates = [];
        if (bidUpdates.length) {
          let updateError = null;
          try {
            await client.updateTargets(bidUpdates.map(({ planned, target, desired }) => (
              targetPayload(planned.campaignCode, target, desired, true)
            )));
          } catch (error) { updateError = error; }
          const after = await client.targets(adgroupCode);
          const verified = bidUpdates.every(({ planned, desired }) => {
            const target = after.find((item) => matchesIdentity(item, planned));
            return target && Math.abs(Number(target.bid) - desired) <= 0.0001 && target.isActive === true;
          });
          if (!verified) {
            let rollbackOk = false;
            try {
              await client.updateTargets(bidUpdates.map(({ planned, target }) => (
                targetPayload(planned.campaignCode, target, Number(target.bid), target.isActive)
              )));
              const rollback = await client.targets(adgroupCode);
              rollbackOk = bidUpdates.every(({ planned, target }) => {
                const current = rollback.find((item) => matchesIdentity(item, planned));
                return current && Math.abs(Number(current.bid) - Number(target.bid)) <= 0.0001
                  && current.isActive === target.isActive;
              });
            } catch { rollbackOk = false; }
            errors.push({
              store: store.partnerId, adgroupCode, stage: "readback",
              message: `${updateError?.message ?? "verification failed"}; rollback=${rollbackOk}`,
            });
          } else verifiedBidUpdates = bidUpdates;
        }

        for (const { planned, target, desired, desiredActive } of verifiedBidUpdates) {
          state.targets[planned.key] = {
            ...state.targets[planned.key], baseBid: planned.baseBid, lastAppliedBid: desired,
            isActive: desiredActive, lastAppliedAt: now.toISOString(),
          };
          changes.push({
            ...planned, planDate: plan.toDate, period,
            action: desiredActive ? "bid_update" : "pause_target",
            beforeBid: Number(target.bid), afterBid: desired,
            beforeActive: target.isActive, afterActive: desiredActive,
            executedAt: now.toISOString(), readBackVerified: true,
          });
        }
        await writeJsonAtomic(options.statePath, { ...state, updatedAt: now.toISOString() });
      }
    } catch (error) { errors.push({ store: store.partnerId, stage: "apply", message: error.message }); }
  }
  const result = { mode: "apply", completedAt: now.toISOString(), period, dryRun: options.dryRun, successful: errors.length === 0, reconciliations, changes, errors };
  if (!options.dryRun && reconciliations.length) {
    await writeJsonAtomic(options.planPath, plan);
    await writeJsonAtomic(options.statePath, { ...state, updatedAt: now.toISOString() });
  }
  await writeJsonAtomic(options.resultPath, result);
  if (!options.dryRun && changes.length) {
    await mkdir(dirname(options.auditPath), { recursive: true });
    await appendFile(options.auditPath, changes.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
    try { result.onlineAudit = await appendSmartSheet(changes); }
    catch (error) { errors.push({ stage: "online_audit", message: error.message }); result.successful = false; }
  }
  try {
    if (!options.dryRun && errors.length) {
      await sendWeCom(`**Noon UAE 分时出价失败**\n> 时间：${now.toISOString()}\n> 阶段：${period}\n> 错误数：${errors.length}`);
    } else if (!options.dryRun && changes.length && process.env.NOON_DAYPART_NOTIFY_SUCCESS === "1") {
      await sendWeCom(`**Noon UAE 分时出价已更新**\n> 时段：${period}\n> 调整目标：${changes.length}`);
    }
  } catch (error) {
    result.notificationError = error.message;
    result.successful = false;
  }
  await writeJsonAtomic(options.resultPath, result);
  return result;
}
