import { generateKeyPairSync, verify } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AsnJob } from "../src/contracts.js";
import { STORE_CONFIGS } from "../src/contracts.js";
import {
  SessionManager,
  createJwt,
  loadCredential,
  loginNoon,
  type NoonCredential,
} from "../src/noon/auth.js";
import { webHeaders } from "../src/noon/headers.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const credential: NoonCredential = {
  type: "apijwt",
  key_id: "key-test",
  project_code: "PRJ42958",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
};

function decodePart(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

function successfulLoginFetch(cookie = "session=test-cookie"): typeof fetch {
  return async () => new Response("{}", { status: 200, headers: { "Set-Cookie": `${cookie}; Path=/; HttpOnly` } });
}

describe("credential and JWT", () => {
  it("creates exact RS256 claims and a valid signature", () => {
    const token = createJwt(credential, 1_786_064_400, "fixed-jti");
    const parts = token.split(".");
    expect(decodePart(parts[0]!)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(decodePart(parts[1]!)).toEqual({ sub: "key-test", iat: 1_786_064_400, jti: "fixed-jti" });
    expect(verify(
      "RSA-SHA256",
      Buffer.from(`${parts[0]}.${parts[1]}`),
      publicKey,
      Buffer.from(parts[2]!, "base64url"),
    )).toBe(true);
  });

  it("rejects a credential whose project does not match the store", async () => {
    const folder = await mkdtemp(join(tmpdir(), "noon-asn-auth-"));
    const path = join(folder, "noon1-API.json");
    await writeFile(path, JSON.stringify({ ...credential, project_code: "PRJ99999" }), "utf8");
    await expect(loadCredential(path, STORE_CONFIGS[0]!)).rejects.toThrow(/project_code mismatch/);
  });
});

describe("loginNoon", () => {
  it("posts the documented login body and returns a timestamped cookie session", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fakeFetch: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return successfulLoginFetch()(input, init);
    };
    const session = await loginNoon(credential, fakeFetch, () => new Date("2026-08-11T01:02:03.000Z"));
    expect(capturedUrl).toBe("https://noon-api-gateway.noon.partners/identity/public/v1/api/login");
    expect(new Headers(capturedInit?.headers).get("User-Agent")).toBe("NoonASNCreator/1.0");
    expect(JSON.parse(String(capturedInit?.body))).toMatchObject({ default_project_code: "PRJ42958" });
    expect(session).toEqual({
      cookieHeader: "session=test-cookie",
      projectCode: "PRJ42958",
      authenticatedAt: "2026-08-11T01:02:03.000Z",
    });
  });

  it("rejects authentication failure and missing cookie without response-body leakage", async () => {
    await expect(loginNoon(credential, async () => new Response("private body", { status: 401 }))).rejects.toMatchObject({
      kind: "authentication",
      status: 401,
    });
    await expect(loginNoon(credential, async () => new Response("{}", { status: 200 }))).rejects.toThrow(/session cookie/);
  });
});

describe("SessionManager", () => {
  it("caches per-store sessions and supports one forced refresh", async () => {
    const load = vi.fn(async () => credential);
    let loginCount = 0;
    const login = vi.fn(async () => ({
      cookieHeader: `session=${++loginCount}`,
      projectCode: "PRJ42958" as const,
      authenticatedAt: "2026-08-11T00:00:00.000Z",
    }));
    const manager = new SessionManager("D:\\noon-api", { loadCredential: load, login });
    expect((await manager.get(1)).cookieHeader).toBe("session=1");
    expect((await manager.get(1)).cookieHeader).toBe("session=1");
    expect((await manager.refresh(1)).cookieHeader).toBe("session=2");
    expect(login).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("webHeaders", () => {
  it("binds the established UAE and project headers", () => {
    const job: AsnJob = {
      filePath: "D:\\input.xlsx",
      fileName: "01 店铺1.xlsx",
      fileFingerprint: "a".repeat(64),
      storeIndex: 1,
      projectCode: "PRJ42958",
      partnerId: "42958",
      site: "UAE",
      items: [{ partnerSku: "TEST", quantity: 1 }],
    };
    expect(webHeaders(job, {
      cookieHeader: "session=test",
      projectCode: "PRJ42958",
      authenticatedAt: "2026-08-11T00:00:00.000Z",
    })).toMatchObject({
      "User-Agent": "NoonASNCreator/1.0",
      Cookie: "session=test",
      "X-Locale": "en-ae",
      "X-Platform": "web",
      "X-Project": "PRJ42958",
      "Country-Code": "ae",
      "Id-Partner": "42958",
    });
  });
});
