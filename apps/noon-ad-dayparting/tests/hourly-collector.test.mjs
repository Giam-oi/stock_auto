import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { collectHourly } from "../src/runner.mjs";

test("publishes a complete six-store hourly snapshot atomically", async () => {
  const root = await mkdtemp(join(tmpdir(), "noon-hourly-"));
  const options = {
    hourlyRoot: join(root, "hourly"), resultPath: join(root, "result.json"),
    credentialDir: root,
  };
  const result = await collectHourly(options, {
    now: () => new Date("2026-08-28T04:10:00.000Z"),
    loadCredential: async () => ({}), login: async () => "cookie",
    createClient: ({ store }) => ({
      downloadReport: async () => Buffer.concat([Buffer.from("PK\u0003\u0004"), Buffer.alloc(4_100, Number(store.index))]),
    }),
  });
  assert.equal(result.successful, true);
  assert.equal(result.stores.length, 6);
  const manifest = JSON.parse(await readFile(join(result.directory, "manifest.json"), "utf8"));
  assert.equal(manifest.reportDate, "2026-08-28");
  assert.equal(manifest.stores.every((row) => row.bytes > 4_000), true);
});
