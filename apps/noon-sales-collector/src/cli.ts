import { runCollector } from "./runner.js";
import { validateRange, type SiteCode } from "./contracts.js";
import { DEFAULT_ONEDRIVE_ROOTS } from "./onedrive.js";
import { defaultReportRange } from "./dates.js";
import { join } from "node:path";
import { sendSuccessOnce, sendWeComNotification, validateWeComWebhookUrl } from "./wecom.js";

function parseArgs(args: readonly string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key?.startsWith("--")) continue;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    parsed[key.slice(2)] = value;
    index += 1;
  }
  return parsed;
}

export async function main(args = process.argv.slice(2), env = process.env): Promise<void> {
  const command = args[0] ?? "run";
  if (command !== "run") throw new Error("Only the run command is supported");
  const parsed = parseArgs(args.slice(1));
  const defaults = parsed.from ? null : defaultReportRange();
  if (!parsed.from && !defaults) {
    process.stdout.write(`${JSON.stringify({ ok: true, status: "skipped", reason: "weekend" }, null, 2)}\n`);
    return;
  }
  const fromDate = parsed.from ?? defaults!.fromDate;
  const toDate = parsed.to ?? (parsed.from ? fromDate : defaults!.toDate);
  validateRange(fromDate, toDate);
  const siteText = (parsed.site ?? "ALL").toUpperCase();
  if (!(["ALL", "UAE", "KSA"] as const).includes(siteText as "ALL" | SiteCode)) {
    throw new Error("--site must be ALL, UAE, or KSA");
  }
  const sites: SiteCode[] = siteText === "ALL" ? ["UAE", "KSA"] : [siteText as SiteCode];
  const disableOneDrive = parsed["no-onedrive"]?.toLowerCase() === "true";
  const disableWeCom = parsed["no-wecom"]?.toLowerCase() === "true";
  if (!disableWeCom) validateWeComWebhookUrl(env.WECOM_WEBHOOK_URL);
  const startedAt = new Date();
  try {
    const result = await runCollector({
      sites,
      fromDate,
      toDate,
      credentialDir: parsed["credential-dir"] ?? env.NOON_CREDENTIAL_DIR ?? "D:\\noon-api",
      outputRoot: parsed["output-root"] ?? env.NOON_SALES_OUTPUT_ROOT ?? "D:\\文件\\销售报表文件",
      oneDriveRoots: disableOneDrive ? undefined : {
        KSA: parsed["ksa-onedrive-root"] ?? env.NOON_SALES_KSA_ONEDRIVE_ROOT ?? DEFAULT_ONEDRIVE_ROOTS.KSA,
        UAE: parsed["uae-onedrive-root"] ?? env.NOON_SALES_UAE_ONEDRIVE_ROOT ?? DEFAULT_ONEDRIVE_ROOTS.UAE,
      },
    });
    const notification = disableWeCom ? "disabled" : await sendSuccessOnce({
      fromDate, toDate, status: "success",
      startedAt: startedAt.toISOString(), completedAt: new Date().toISOString(),
    }, env.WECOM_WEBHOOK_URL, join(
      env.LOCALAPPDATA ?? process.env.LOCALAPPDATA ?? process.cwd(),
      "NoonSalesCollector", "wecom-delivery.json",
    ));
    process.stdout.write(`${JSON.stringify({ ok: true, fromDate, toDate, sites: result, notification }, null, 2)}\n`);
  } catch (error) {
    if (!disableWeCom) {
      try {
        await sendWeComNotification({
          fromDate, toDate, status: "failure",
          startedAt: startedAt.toISOString(), completedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
        }, env.WECOM_WEBHOOK_URL);
      } catch (notificationError) {
        throw new AggregateError([error, notificationError], "Sales collection and failure notification both failed");
      }
    }
    throw error;
  }
}

function errorDetails(error: unknown): unknown {
  if (error instanceof AggregateError) {
    return { message: error.message, causes: error.errors.map(errorDetails) };
  }
  if (error instanceof Error) return { message: error.message };
  return { message: String(error) };
}

main().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: errorDetails(error) })}\n`);
  process.exitCode = 1;
});
