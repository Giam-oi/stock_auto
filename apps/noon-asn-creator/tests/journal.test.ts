import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AsnJob } from "../src/contracts.js";
import { JournalStore, createJobEntry, journalKey, transition } from "../src/journal.js";

const job: AsnJob = {
  filePath: "D:\\input\\01 店铺1.xlsx",
  fileName: "01 店铺1.xlsx",
  fileFingerprint: "a".repeat(64),
  storeIndex: 1,
  projectCode: "PRJ42958",
  partnerId: "42958",
  site: "UAE",
  items: [{ partnerSku: "TEST-SKU", quantity: 2 }],
};

describe("journal state machine", () => {
  it("allows only declared transitions", () => {
    const discovered = createJobEntry(job, "2026-08-11T00:00:00.000Z");
    expect(() => transition(discovered, "written", {}, "2026-08-11T00:00:01.000Z")).toThrow(/invalid transition/i);
    const validated = transition(discovered, "validated", {}, "2026-08-11T00:00:01.000Z");
    const creating = transition(validated, "creating", {}, "2026-08-11T00:00:02.000Z");
    expect(creating.stage).toBe("creating");
    expect(() => transition(creating, "confirmed", {}, "2026-08-11T00:00:03.000Z")).toThrow(/invalid transition/i);
  });

  it("uses path, fingerprint, and project for a stable key", () => {
    expect(journalKey(job)).toMatch(/^[a-f0-9]{64}$/);
    expect(journalKey({ ...job, projectCode: "PRJ55651" })).not.toBe(journalKey(job));
  });
});

describe("JournalStore", () => {
  it("persists and reloads an entry", async () => {
    const folder = await mkdtemp(join(tmpdir(), "noon-asn-journal-"));
    const path = join(folder, "journal.json");
    const store = new JournalStore(path);
    const entry = createJobEntry(job, "2026-08-11T00:00:00.000Z");
    await store.put(entry);
    const reloaded = new JournalStore(path);
    await expect(reloaded.get(job)).resolves.toEqual(entry);
  });

  it("leaves the previous journal parseable when replacement fails", async () => {
    const folder = await mkdtemp(join(tmpdir(), "noon-asn-journal-failure-"));
    const path = join(folder, "journal.json");
    const store = new JournalStore(path);
    const entry = createJobEntry(job, "2026-08-11T00:00:00.000Z");
    await store.put(entry);

    const failing = new JournalStore(path, {
      beforeReplace: async () => { throw new Error("simulated interruption"); },
    });
    const validated = transition(entry, "validated", {}, "2026-08-11T00:00:01.000Z");
    await expect(failing.put(validated)).rejects.toThrow(/simulated interruption/);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ entries: { [entry.key]: entry } });
  });
});
