import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { redact } from "./redaction.js";

export interface LogRecord {
  event: string;
  [key: string]: unknown;
}

function localAppData(): string {
  return process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? ".", "AppData", "Local");
}

export function defaultLogPath(now = new Date()): string {
  return join(localAppData(), "NoonASNCreator", "logs", `${now.toISOString().slice(0, 10)}.jsonl`);
}

export class JsonLogger {
  constructor(
    readonly path = defaultLogPath(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async write(record: LogRecord): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const safe = redact({ timestamp: this.now().toISOString(), ...record });
    await appendFile(this.path, `${JSON.stringify(safe)}\n`, "utf8");
  }
}
