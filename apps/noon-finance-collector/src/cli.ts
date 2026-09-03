import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultFinanceRange, validateRange } from "./dates.js";
import { monthDirectory } from "./contracts.js";
import { runCollector } from "./runner.js";

const DEFAULT_ONEDRIVE_ROOT = "C:\\Users\\admin\\OneDrive - AXIS PROFESSIONALS LTD\\A202 中东Noon运营 - 文档\\2.0 中东\\1.1 Noon\\1.0 管理文件夹\\2.0 数据分析\\6. 财务数据";

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

function errorDetails(error: unknown): Record<string, unknown> {
  if (error instanceof AggregateError) return { message: error.message, causes: error.errors.map(errorDetails) };
  if (error instanceof Error) return { message: error.message };
  return { message: String(error) };
}

export async function main(args = process.argv.slice(2), env = process.env): Promise<void> {
  const command = args[0] ?? "run";
  if (command !== "run") throw new Error("Only the run command is supported");
  const parsed = parseArgs(args.slice(1));
  const defaults = defaultFinanceRange();
  const fromDate = parsed.from ?? defaults.fromDate;
  const toDate = parsed.to ?? defaults.toDate;
  validateRange(fromDate, toDate);
  const month = monthDirectory(fromDate);
  const year = fromDate.slice(0, 4);
  const localRoot = parsed["output-root"] ?? env.NOON_FINANCE_OUTPUT_ROOT ?? "D:\\文件\\财务报表文件";
  const oneDriveRoot = parsed["onedrive-root"] ?? env.NOON_FINANCE_ONEDRIVE_ROOT ?? DEFAULT_ONEDRIVE_ROOT;
  const disableOneDrive = parsed["no-onedrive"]?.toLowerCase() === "true";
  const result = await runCollector({
    fromDate, toDate,
    credentialDirectory: parsed["credential-dir"] ?? env.NOON_CREDENTIAL_DIR ?? "D:\\noon-api",
    localDirectory: join(localRoot, year, month),
    oneDriveDirectory: disableOneDrive ? undefined : join(oneDriveRoot, year, month),
    concurrency: Number(parsed.concurrency ?? env.NOON_FINANCE_CONCURRENCY ?? "3"),
  });
  const resultDirectory = join(env.LOCALAPPDATA ?? process.cwd(), "NoonFinanceCollector");
  await mkdir(resultDirectory, { recursive: true });
  await writeFile(join(resultDirectory, "last-result.json"), JSON.stringify(result, null, 2), "utf8");
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch(async (error: unknown) => {
  const result = { ok: false, completedAt: new Date().toISOString(), error: errorDetails(error) };
  try {
    const resultDirectory = join(process.env.LOCALAPPDATA ?? process.cwd(), "NoonFinanceCollector");
    await mkdir(resultDirectory, { recursive: true });
    await writeFile(join(resultDirectory, "last-result.json"), JSON.stringify(result, null, 2), "utf8");
  } catch {}
  process.stderr.write(`${JSON.stringify(result)}\n`);
  process.exitCode = 1;
});
