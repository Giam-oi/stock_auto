import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));

describe("Windows package", () => {
  it("declares the compiled entry and verified contract asset", async () => {
    const metadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as any;
    expect(metadata.bin).toBe("dist/src/main.js");
    expect(metadata.pkg.assets).toContain("contracts/noon-uae-asn.v1.json");
  });

  it("prints the exact Windows target and output in dry-run mode", async () => {
    const { stdout } = await run(process.execPath, ["scripts/build-exe.mjs", "--dry-run"], {
      cwd: root
    });
    const result = JSON.parse(stdout) as { target: string; output: string };
    expect(result.target).toBe("node22-win-x64");
    expect(result.output).toMatch(/release[\\/]NoonASNCreator[\\/]NoonASNCreator\.exe$/);
  });
});
