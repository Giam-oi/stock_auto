import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { OtpBaseline, OtpProvider } from "./outlook-otp";

export interface MonitorConfig {
  storeIndex: number;
  projectCode: string;
  targetUrl: string;
  intervalMinutes: number;
  alarmMode?: "primary" | "fallback";
  autoLogin?: boolean;
}

export interface SessionCheckResult {
  valid: boolean;
  finalUrl: string;
  title: string;
  checkedAt: string;
  reason?: string;
}

interface PendingCheck {
  config: MonitorConfig;
  resolve: (result: SessionCheckResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  otpBaseline?: OtpBaseline;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 64 * 1024) throw new Error("response too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function isCheckResult(value: unknown): value is SessionCheckResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return typeof source.valid === "boolean"
    && typeof source.finalUrl === "string"
    && typeof source.title === "string"
    && typeof source.checkedAt === "string";
}

export class SessionBridge {
  private readonly checks = new Map<string, PendingCheck>();
  private readonly server: Server;
  private port = 0;

  constructor(private readonly timeoutMs = 120_000, private readonly otpProvider?: OtpProvider) {
    this.server = createServer((request, response) => {
      void this.handle(request, response).catch(() => sendJson(response, 500, { error: "bridge failure" }));
    });
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const [, action, token] = url.pathname.split("/");
    const check = token ? this.checks.get(token) : undefined;
    if (!check) return sendJson(response, 404, { error: "not found" });

    if (action === "bridge" && request.method === "GET") {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      });
      response.end("<!doctype html><meta charset=utf-8><title>Noon 会话检查</title><style>body{font:16px system-ui;padding:40px;color:#333}</style>正在检查 Noon 登录状态...");
      return;
    }
    if (action === "config" && request.method === "GET") {
      return sendJson(response, 200, {
        ...check.config,
        bridgeBaseUrl: `http://127.0.0.1:${this.port}`,
        bridgeToken: token,
      });
    }
    if (action === "otp-begin" && request.method === "POST") {
      if (!check.config.autoLogin || !this.otpProvider) return sendJson(response, 409, { error: "automatic login unavailable" });
      check.otpBaseline = await this.otpProvider.begin(check.config.storeIndex);
      return sendJson(response, 200, { ok: true });
    }
    if (action === "otp-code" && request.method === "GET") {
      if (!check.config.autoLogin || !this.otpProvider || !check.otpBaseline) return sendJson(response, 409, { error: "verification baseline unavailable" });
      const baseline = check.otpBaseline;
      delete check.otpBaseline;
      const code = await this.otpProvider.waitForCode(check.config.storeIndex, baseline);
      return sendJson(response, 200, { code });
    }
    if (action === "complete" && request.method === "POST") {
      const result = await readJson(request);
      if (!isCheckResult(result)) return sendJson(response, 400, { error: "invalid result" });
      if (check.otpBaseline) await this.otpProvider?.cancel?.(check.otpBaseline);
      clearTimeout(check.timer);
      this.checks.delete(token!);
      check.resolve(result);
      return sendJson(response, 200, { ok: true });
    }
    return sendJson(response, 405, { error: "method not allowed" });
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("本机会话检查服务启动失败");
    this.port = address.port;
  }

  prepare(config: MonitorConfig): { url: string; completed: Promise<SessionCheckResult> } {
    const token = randomBytes(32).toString("hex");
    const completed = new Promise<SessionCheckResult>((resolve, reject) => {
      let pending!: PendingCheck;
      const timer = setTimeout(() => {
        this.checks.delete(token);
        if (pending.otpBaseline) void this.otpProvider?.cancel?.(pending.otpBaseline);
        reject(new Error(`店铺${config.storeIndex}监控扩展未响应，请重新加载扩展`));
      }, this.timeoutMs);
      pending = { config, resolve, reject, timer };
      this.checks.set(token, pending);
    });
    return { url: `http://127.0.0.1:${this.port}/bridge/${token}`, completed };
  }

  async close(): Promise<void> {
    for (const check of this.checks.values()) {
      clearTimeout(check.timer);
      if (check.otpBaseline) await this.otpProvider?.cancel?.(check.otpBaseline);
      check.reject(new Error("本机会话检查服务已关闭"));
    }
    this.checks.clear();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}
