import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import type { StoreIndex } from "./config";

interface PkgProcess extends NodeJS.Process { pkg?: unknown }

export interface OtpBaseline {
  readonly messageIds: readonly string[];
  readonly leaseId?: string;
}

export interface OtpProvider {
  begin(storeIndex: number): Promise<OtpBaseline>;
  waitForCode(storeIndex: number, baseline: OtpBaseline): Promise<string>;
  cancel?(baseline: OtpBaseline): Promise<void>;
}

function scriptPath(): string {
  if ((process as PkgProcess).pkg) return join(dirname(process.execPath), "outlook-otp.ps1");
  return join(__dirname, "..", "..", "assets", "outlook-otp.ps1");
}

function runPowerShell(mode: "Baseline" | "Wait", storeIndex: StoreIndex, input?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle", "Hidden",
      "-ExecutionPolicy", "Bypass",
      "-File", scriptPath(),
      "-Mode", mode,
      "-StoreIndex", String(storeIndex),
    ], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Outlook verification timed out"));
    }, mode === "Wait" ? 75_000 : 20_000);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const detail = Buffer.concat(stderr).toString("utf8").trim();
        reject(new Error(detail || "Outlook verification failed"));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(stdout).toString("utf8")) as unknown);
      } catch {
        reject(new Error("Outlook verification returned invalid data"));
      }
    });
    child.stdin.end(input === undefined ? "" : JSON.stringify(input));
  });
}

function asBaseline(value: unknown): OtpBaseline {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Outlook baseline is invalid");
  const ids = (value as Record<string, unknown>).messageIds;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) throw new Error("Outlook baseline is invalid");
  return { messageIds: ids };
}

export class OutlookOtpProvider implements OtpProvider {
  private queue: Promise<void> = Promise.resolve();
  private readonly releases = new Map<string, () => void>();

  private async acquire(): Promise<string> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const leaseId = randomUUID();
    this.releases.set(leaseId, release);
    return leaseId;
  }

  private release(leaseId: string | undefined): void {
    if (!leaseId) return;
    const release = this.releases.get(leaseId);
    if (!release) return;
    this.releases.delete(leaseId);
    release();
  }

  async begin(storeIndex: number): Promise<OtpBaseline> {
    if (!Number.isInteger(storeIndex) || storeIndex < 1 || storeIndex > 6) throw new Error("Invalid store index");
    const leaseId = await this.acquire();
    try {
      const baseline = asBaseline(await runPowerShell("Baseline", storeIndex as StoreIndex));
      return { ...baseline, leaseId };
    } catch (error) {
      this.release(leaseId);
      throw error;
    }
  }

  async waitForCode(storeIndex: number, baseline: OtpBaseline): Promise<string> {
    if (!Number.isInteger(storeIndex) || storeIndex < 1 || storeIndex > 6) throw new Error("Invalid store index");
    try {
      const value = await runPowerShell("Wait", storeIndex as StoreIndex, baseline);
      const code = value && typeof value === "object" ? (value as Record<string, unknown>).code : undefined;
      if (typeof code !== "string" || !/^\d{6}$/.test(code)) throw new Error("Outlook verification code is invalid");
      return code;
    } finally {
      this.release(baseline.leaseId);
    }
  }

  async cancel(baseline: OtpBaseline): Promise<void> {
    this.release(baseline.leaseId);
  }
}
