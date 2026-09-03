import { chmod, mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Page, Response } from "playwright-core";
import type { CapturedExchange, ContractOperationName } from "../noon/contract-schema.js";

const execFileAsync = promisify(execFile);

async function restrictDirectory(path: string): Promise<void> {
  await chmod(path, 0o700);
  if (process.platform === "win32" && process.env.USERNAME) {
    await execFileAsync("icacls.exe", [path, "/inheritance:r", "/grant:r", `${process.env.USERNAME}:(OI)(CI)F`], {
      windowsHide: true,
    });
  }
}

async function responseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export class ContractCapture {
  private activeOperation: ContractOperationName | undefined;
  private readonly captured: CapturedExchange[] = [];
  private readonly pending = new Set<Promise<void>>();
  private sequence = 0;

  constructor(private readonly page: Page, private readonly rawDirectory: string) {
    page.on("response", this.onResponse);
  }

  private readonly onResponse = (response: Response): void => {
    const operation = this.activeOperation;
    if (!operation) return;
    const task = this.record(operation, response).finally(() => this.pending.delete(task));
    this.pending.add(task);
  };

  private async record(operation: ContractOperationName, response: Response): Promise<void> {
    const request = response.request();
    let body: unknown;
    try {
      body = request.postDataJSON();
    } catch {
      body = request.postData() ?? undefined;
    }
    const parsedResponseBody = await responseBody(response);
    const exchange: CapturedExchange = {
      operation,
      request: {
        method: request.method(),
        url: request.url(),
        headers: await request.allHeaders(),
        ...(body === undefined ? {} : { body }),
      },
      response: {
        status: response.status(),
        ...(parsedResponseBody === undefined ? {} : { body: parsedResponseBody }),
      },
    };
    this.captured.push(exchange);
    await mkdir(this.rawDirectory, { recursive: true });
    await restrictDirectory(this.rawDirectory);
    const path = join(this.rawDirectory, `${String(++this.sequence).padStart(4, "0")}-${operation}.json`);
    await writeFile(path, JSON.stringify(exchange), { encoding: "utf8", mode: 0o600 });
  }

  async during<T>(operation: ContractOperationName, action: () => Promise<T>): Promise<T> {
    if (this.activeOperation) throw new Error("A contract capture window is already active");
    this.activeOperation = operation;
    try {
      return await action();
    } finally {
      this.activeOperation = undefined;
      await Promise.all([...this.pending]);
    }
  }

  exchanges(): readonly CapturedExchange[] {
    return structuredClone(this.captured);
  }

  dispose(): void {
    this.page.off("response", this.onResponse);
  }
}
