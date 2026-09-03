import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AuthenticationError, createJwt, loginNoon } from "../src/auth.js";
import type { NoonCredential } from "../src/credentials.js";

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

describe("createJwt", () => {
  it("creates the exact RS256 claims and a valid signature", () => {
    const token = createJwt(credential, 1_786_064_400, "fixed-jti");
    const parts = token.split(".");
    expect(parts).toHaveLength(3);
    expect(decodePart(parts[0]!)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(decodePart(parts[1]!)).toEqual({
      sub: "key-test",
      iat: 1_786_064_400,
      jti: "fixed-jti",
    });
    expect(
      verify(
        "RSA-SHA256",
        Buffer.from(`${parts[0]}.${parts[1]}`),
        publicKey,
        Buffer.from(parts[2]!, "base64url"),
      ),
    ).toBe(true);
  });
});

describe("loginNoon", () => {
  it("posts the documented login body and returns only cookie name-value pairs", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fakeFetch: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      const headers = new Headers();
      headers.append("Set-Cookie", "session=a; Path=/; HttpOnly");
      headers.append("Set-Cookie", "auth=b; Path=/; Secure");
      return new Response("{}", { status: 200, headers });
    };

    const session = await loginNoon(credential, fakeFetch);

    expect(capturedUrl).toBe("https://noon-api-gateway.noon.partners/identity/public/v1/api/login");
    expect(capturedInit?.method).toBe("POST");
    expect(new Headers(capturedInit?.headers).get("User-Agent")).toBe("StockAuto/1.0");
    expect(new Headers(capturedInit?.headers).get("Content-Type")).toBe("application/json");
    const body = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
    expect(body.default_project_code).toBe("PRJ42958");
    expect(String(body.token).split(".")).toHaveLength(3);
    expect(session.cookieHeader).toBe("session=a; auth=b");
  });

  it("reports only status for rejected authentication", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response("private diagnostic body", { status: 401 });

    const rejection = loginNoon(credential, fakeFetch).catch((error: unknown) => error);
    const error = await rejection;

    expect(error).toBeInstanceOf(AuthenticationError);
    expect((error as AuthenticationError).status).toBe(401);
    expect((error as Error).message).toBe("Noon authentication failed with HTTP 401");
    expect((error as Error).message).not.toContain("private diagnostic body");
  });

  it("rejects a successful response without session cookies", async () => {
    const fakeFetch: typeof fetch = async () => new Response("{}", { status: 200 });
    await expect(loginNoon(credential, fakeFetch)).rejects.toThrow("did not return a session cookie");
  });
});
