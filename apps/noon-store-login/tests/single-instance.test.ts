import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireSingleInstance } from "../src/single-instance";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("single instance lock", () => {
  it("rejects a second live owner and replaces a stale owner", async () => {
    const root = await mkdtemp(join(tmpdir(), "noon-resident-"));
    roots.push(root);
    const lockPath = join(root, "resident.lock");
    const first = await acquireSingleInstance(lockPath, 111, (pid) => pid === 111);
    expect(first.acquired).toBe(true);
    const second = await acquireSingleInstance(lockPath, 222, (pid) => pid === 111);
    expect(second.acquired).toBe(false);
    await first.release();

    await mkdir(lockPath);
    await writeFile(join(lockPath, "owner.json"), JSON.stringify({ pid: 333 }), "utf8");
    const replacement = await acquireSingleInstance(lockPath, 444, () => false);
    expect(replacement.acquired).toBe(true);
    expect(JSON.parse(await readFile(join(lockPath, "owner.json"), "utf8"))).toMatchObject({ pid: 444 });
    await replacement.release();
  });
});
