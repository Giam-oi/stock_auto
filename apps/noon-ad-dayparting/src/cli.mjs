import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { apply, collectHourly, evaluate, seedCooldowns } from "./runner.mjs";
import { probeRanks } from "./rank-probe.mjs";
import { collectManualPilot } from "./manual-pilot.mjs";

const defaultReceiptRoot = resolve(fileURLToPath(new URL("../../../outputs/3570", import.meta.url)));

function parse(args) {
  const mode = args[0];
  const flags = new Set(args.slice(1));
  const dryRun = flags.has("--dry-run");
  if (!["seed", "evaluate", "apply", "collect", "probe", "pilot"].includes(mode)) throw new Error("Use seed, evaluate, apply, collect, probe or pilot");
  const root = resolve(process.env.NOON_DAYPART_ROOT ?? `${process.env.LOCALAPPDATA}/NoonAdDayparting`);
  return {
    mode, dryRun, credentialDir: resolve(process.env.NOON_CREDENTIAL_DIR ?? "D:/noon-api"),
    statePath: resolve(root, "state.json"), planPath: resolve(root, "plan.json"),
    cooldownPath: resolve(root, "cooldowns.json"),
    resultPath: resolve(root, mode === "collect" ? "hourly-last-result.json" : mode === "probe" ? "rank-last-result.json" : (dryRun ? "last-dry-run-result.json" : "last-result.json")),
    pilotRoot: resolve(root, "..", "NoonManualPilot"),
    pilotResultPath: resolve(root, "..", "NoonManualPilot", "pilot-last-result.json"),
    inventoryRoot: resolve(process.env.NOON_INVENTORY_ROOT ?? "D:/文件/库存文件/UAE"),
    auditPath: resolve(root, "audit", "bid-changes.jsonl"),
    hourlyRoot: resolve(root, "hourly"),
    rankRoot: resolve(root, "rank"), rankConfigPath: resolve(root, "rank-config.json"),
    receiptRoot: resolve(process.env.NOON_DAYPART_RECEIPT_ROOT ?? defaultReceiptRoot),
  };
}

try {
  const options = parse(process.argv.slice(2));
  const result = options.mode === "seed" ? await seedCooldowns(options)
    : options.mode === "evaluate" ? await evaluate(options)
      : options.mode === "collect" ? await collectHourly(options)
        : options.mode === "probe" ? await probeRanks(options)
          : options.mode === "pilot" ? await collectManualPilot(options) : await apply(options);
  process.stdout.write(`${JSON.stringify({ ok: result.successful !== false, mode: options.mode, dryRun: options.dryRun, targets: result.targets?.length, changes: result.changes?.length, errors: result.errors?.length, probes: result.probes?.length })}\n`);
  if (result.successful === false) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
  process.exitCode = 1;
}
