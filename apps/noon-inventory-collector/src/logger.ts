import { appendFile, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { redactSecrets } from "./redaction.js";

export interface LoggerOptions {
  root?: string;
  now?: Date;
  retentionDays?: number;
}

export interface CollectorLogger {
  info(event: string, data?: unknown): Promise<void>;
  error(event: string, data?: unknown): Promise<void>;
}

function dateInShanghai(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export async function createLogger(options: LoggerOptions = {}): Promise<CollectorLogger> {
  const now = options.now ?? new Date();
  const root = options.root ?? join(
    process.env.LOCALAPPDATA ?? process.cwd(),
    "NoonInventoryCollector",
    "logs",
  );
  const retentionDays = options.retentionDays ?? 30;
  await mkdir(root, { recursive: true });

  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1_000;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const match = /^(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(entry.name);
    if (!entry.isFile() || !match) {
      continue;
    }
    const fileDate = Date.parse(`${match[1]}T00:00:00Z`);
    if (Number.isFinite(fileDate) && fileDate < cutoff) {
      await rm(join(root, entry.name));
    }
  }

  const logPath = join(root, `${dateInShanghai(now)}.jsonl`);
  const write = async (level: "info" | "error", event: string, data?: unknown): Promise<void> => {
    const record = {
      timestamp: new Date().toISOString(),
      level,
      event,
      data: redactSecrets(data),
    };
    await appendFile(logPath, `${JSON.stringify(record)}\n`, "utf8");
  };

  return {
    info: (event, data) => write("info", event, data),
    error: (event, data) => write("error", event, data),
  };
}
