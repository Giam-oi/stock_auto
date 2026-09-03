import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AsnGateway, AsnJob, AsnRecord, NoonSession } from "../src/contracts.js";
import { AsnCreatorError } from "../src/errors.js";
import { JournalStore, createJobEntry, transition } from "../src/journal.js";
import { runFile, runFolder, type RunnerDependencies } from "../src/runner.js";

const session: NoonSession = { cookieHeader: "session=test", projectCode: "PRJ42958", authenticatedAt: "2026-08-11T00:00:00Z" };
const baseJob: AsnJob = {
  filePath: "D:\\input\\店铺1 one.xlsx", fileName: "店铺1 one.xlsx", fileFingerprint: "a".repeat(64),
  storeIndex: 1, projectCode: "PRJ42958", partnerId: "42958", site: "UAE",
  items: [{ partnerSku: "SKU-A", quantity: 2 }]
};
const record: AsnRecord = { asnNumber: "ASN-1", projectCode: "PRJ42958", status: "created", items: baseJob.items };

async function dependencies(overrides: Partial<RunnerDependencies> = {}): Promise<RunnerDependencies> {
  const folder = await mkdtemp(join(tmpdir(), "noon-runner-"));
  const gateway: AsnGateway = {
    findMatches: async () => [],
    create: async () => ({ outcome: "accepted" }),
    getDetails: async () => record
  };
  return {
    journal: new JournalStore(join(folder, "journal.json")),
    sessions: { get: async () => session },
    gateway,
    browser: { createAndVerify: async () => record },
    discoverWorkbooks: async () => [baseJob.filePath],
    readWorkbook: async () => baseJob,
    writeAsn: async () => undefined,
    ...overrides
  };
}

describe("runner idempotency", () => {
  it("skips a workbook with C2 populated", async () => {
    const create = vi.fn(async () => ({ outcome: "accepted" as const }));
    const deps = await dependencies({
      readWorkbook: async () => ({ filePath: baseJob.filePath, skippedAsn: "ASN-DONE", job: baseJob }),
      gateway: { findMatches: async () => [], create, getDetails: async () => record }
    });
    expect(await runFile(baseJob.filePath, deps)).toMatchObject({ status: "skipped_existing", asnNumber: "ASN-DONE" });
    expect(create).not.toHaveBeenCalled();
  });

  it("adopts one exact pre-existing server match without creating", async () => {
    const create = vi.fn(async () => ({ outcome: "accepted" as const }));
    const writeAsn = vi.fn(async () => undefined);
    const deps = await dependencies({ gateway: { findMatches: async () => [record], create, getDetails: async () => record }, writeAsn });
    expect(await runFile(baseJob.filePath, deps)).toMatchObject({ status: "written", asnNumber: "ASN-1" });
    expect(create).not.toHaveBeenCalled();
    expect(writeAsn).toHaveBeenCalledWith(baseJob, "ASN-1");
  });

  it("seals only after exact verification and before writing C2", async () => {
    const order: string[] = [];
    const seal = vi.fn(async () => { order.push("seal"); return { ...record, status: "sealed" }; });
    const writeAsn = vi.fn(async () => { order.push("write"); });
    const deps = await dependencies({
      gateway: { findMatches: async () => [record], create: async () => ({ outcome: "accepted" }), getDetails: async () => record, seal },
      writeAsn,
    });

    await expect(runFile(baseJob.filePath, deps)).resolves.toMatchObject({ status: "written", asnNumber: "ASN-1" });
    expect(order).toEqual(["seal", "write"]);
    expect(seal).toHaveBeenCalledWith("ASN-1", baseJob, session);
  });

  it("does not write C2 when sealing cannot be verified", async () => {
    const writeAsn = vi.fn(async () => undefined);
    const deps = await dependencies({
      gateway: {
        findMatches: async () => [record],
        create: async () => ({ outcome: "accepted" }),
        getDetails: async () => record,
        seal: async () => { throw new AsnCreatorError("verification", true, "seal", "uncertain seal"); },
      },
      writeAsn,
    });

    await expect(runFile(baseJob.filePath, deps)).resolves.toMatchObject({ status: "failed", error: { stage: "seal" } });
    expect(writeAsn).not.toHaveBeenCalled();
    expect((await deps.journal.get(baseJob))?.stage).toBe("confirmed");
  });

  it("verifies and seals an ASN already present in C2", async () => {
    const seal = vi.fn(async () => ({ ...record, asnNumber: "ASN-DONE", status: "sealed" }));
    const deps = await dependencies({
      readWorkbook: async () => ({ filePath: baseJob.filePath, skippedAsn: "ASN-DONE", job: baseJob }),
      gateway: { findMatches: async () => [], create: async () => ({ outcome: "accepted" }), getDetails: async () => ({ ...record, asnNumber: "ASN-DONE" }), seal },
    });

    await expect(runFile(baseJob.filePath, deps)).resolves.toMatchObject({ status: "skipped_existing", asnNumber: "ASN-DONE" });
    expect(seal).toHaveBeenCalledOnce();
  });

  it("marks multiple exact matches needs_review without writing", async () => {
    const writeAsn = vi.fn(async () => undefined);
    const deps = await dependencies({
      gateway: { findMatches: async () => [record, { ...record, asnNumber: "ASN-2" }], create: async () => ({ outcome: "accepted" }), getDetails: async () => record },
      writeAsn
    });
    expect(await runFile(baseJob.filePath, deps)).toMatchObject({ status: "needs_review" });
    expect(writeAsn).not.toHaveBeenCalled();
  });

  it("reconciles after uncertain create and never issues a second create on rerun", async () => {
    const create = vi.fn(async () => ({ outcome: "uncertain" as const }));
    const deps = await dependencies({ gateway: { findMatches: async () => [], create, getDetails: async () => record } });
    expect(await runFile(baseJob.filePath, deps)).toMatchObject({ status: "failed" });
    expect(await runFile(baseJob.filePath, deps)).toMatchObject({ status: "failed" });
    expect(create).toHaveBeenCalledOnce();
  });

  it("immediately persists and safely resumes a known pending ASN", async () => {
    const partial: AsnRecord = { ...record, items: [] };
    let complete = false;
    const resume = vi.fn(async () => { complete = true; });
    const create = vi.fn(async () => ({ outcome: "uncertain" as const, asnNumber: "ASN-PENDING" }));
    const deps = await dependencies({ gateway: {
      findMatches: async () => [],
      create,
      resume,
      getDetails: async () => complete ? { ...record, asnNumber: "ASN-PENDING" } : { ...partial, asnNumber: "ASN-PENDING" }
    } });
    expect(await runFile(baseJob.filePath, deps)).toMatchObject({ status: "written", asnNumber: "ASN-PENDING" });
    expect((await deps.journal.get(baseJob))?.pendingAsn).toBe("ASN-PENDING");
    expect(create).toHaveBeenCalledOnce();
    expect(resume).toHaveBeenCalledOnce();
  });

  it("never creates again after a pending ASN encounters a read-only network failure", async () => {
    const create = vi.fn(async () => ({ outcome: "uncertain" as const, asnNumber: "ASN-PENDING" }));
    let findCalls = 0;
    const deps = await dependencies({ gateway: {
      findMatches: async () => {
        findCalls += 1;
        if (findCalls === 2) throw new AsnCreatorError("network", true, "find", "temporary outage");
        return [];
      },
      create,
      resume: async () => undefined,
      getDetails: async () => ({ ...record, asnNumber: "ASN-PENDING", items: [] })
    } });
    expect(await runFile(baseJob.filePath, deps)).toMatchObject({ status: "failed" });
    expect(await runFile(baseJob.filePath, deps)).toMatchObject({ status: "failed" });
    expect((await deps.journal.get(baseJob))?.pendingAsn).toBe("ASN-PENDING");
    expect((await deps.journal.get(baseJob))?.attempts).toBe(1);
    expect(await runFile(baseJob.filePath, deps)).toMatchObject({ status: "failed" });
    expect(create).toHaveBeenCalledOnce();
  });

  it("marks a pending ASN needs_review when Noon routing requires a split", async () => {
    const deps = await dependencies({ gateway: {
      findMatches: async () => [],
      create: async () => ({ outcome: "uncertain", asnNumber: "ASN-PENDING" }),
      resume: async () => { throw new AsnCreatorError("verification", false, "route", "split required"); },
      getDetails: async () => ({ ...record, asnNumber: "ASN-PENDING", items: [] })
    } });
    expect(await runFile(baseJob.filePath, deps)).toMatchObject({ status: "needs_review" });
    expect(await runFile(baseJob.filePath, deps)).toMatchObject({ status: "needs_review" });
    expect((await deps.journal.get(baseJob))?.stage).toBe("needs_review");
  });

  it("uses browser only after explicit API creation failure and zero matches", async () => {
    const browser = vi.fn(async () => record);
    const deps = await dependencies({
      gateway: { findMatches: async () => [], create: async () => { throw new AsnCreatorError("contract", false, "create", "drift"); }, getDetails: async () => record },
      browser: { createAndVerify: browser }
    });
    expect(await runFile(baseJob.filePath, deps)).toMatchObject({ status: "written" });
    expect(browser).toHaveBeenCalledOnce();
  });

  it("marks catalog dimension problems needs_review without opening the browser", async () => {
    const browser = vi.fn(async () => record);
    const create = vi.fn(async () => {
      throw new AsnCreatorError("verification", false, "catalog", "unidentified storage");
    });
    const deps = await dependencies({
      gateway: { findMatches: async () => [], create, getDetails: async () => record },
      browser: { createAndVerify: browser }
    });
    expect(await runFile(baseJob.filePath, deps)).toMatchObject({ status: "needs_review" });
    expect(browser).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledOnce();
  });

  it("reopens a legacy unidentified-storage review without preserving its create attempt", async () => {
    const create = vi.fn(async () => ({ outcome: "accepted" as const, asnNumber: "ASN-1" }));
    const deps = await dependencies({
      gateway: { findMatches: async () => [], create, getDetails: async () => record },
    });
    let entry = createJobEntry(baseJob);
    entry = transition(entry, "validated");
    entry = transition(entry, "creating", { attempts: 1 });
    entry = transition(entry, "verifying");
    entry = transition(entry, "needs_review", {
      error: { kind: "verification", stage: "catalog", message: "Noon catalog has items with unidentified storage type" },
    });
    await deps.journal.put(entry);

    await expect(runFile(baseJob.filePath, deps)).resolves.toMatchObject({ status: "written", asnNumber: "ASN-1" });
    expect(create).toHaveBeenCalledOnce();
    expect((await deps.journal.get(baseJob))?.attempts).toBe(1);
  });

  it("stores confirmed ASN when Excel is locked and writes it on the next run", async () => {
    const writeAsn = vi.fn()
      .mockRejectedValueOnce(new AsnCreatorError("workbook", false, "write-back", "locked"))
      .mockResolvedValueOnce(undefined);
    const deps = await dependencies({ gateway: { findMatches: async () => [record], create: async () => ({ outcome: "accepted" }), getDetails: async () => record }, writeAsn });
    expect(await runFile(baseJob.filePath, deps)).toMatchObject({ status: "failed" });
    expect((await deps.journal.get(baseJob))?.stage).toBe("confirmed");
    expect(await runFile(baseJob.filePath, deps)).toMatchObject({ status: "written" });
    expect(writeAsn).toHaveBeenCalledTimes(2);
  });

  it("refuses write-back or creation when the source fingerprint changed", async () => {
    const deps = await dependencies();
    const oldEntry = transition(
      transition(transition(createJobEntry(baseJob), "validated"), "verifying"),
      "confirmed",
      { confirmedAsn: "ASN-OLD" }
    );
    await deps.journal.put(oldEntry);
    const changed = { ...baseJob, fileFingerprint: "b".repeat(64) };
    const create = vi.fn(async () => ({ outcome: "accepted" as const }));
    deps.readWorkbook = async () => changed;
    deps.gateway = { findMatches: async () => [], create, getDetails: async () => record };
    expect(await runFile(changed.filePath, deps)).toMatchObject({ status: "needs_review" });
    expect(create).not.toHaveBeenCalled();
  });

  it("continues remaining files after invalid input or failed creation", async () => {
    const badPath = "D:\\input\\bad.xlsx";
    const deps = await dependencies({
      discoverWorkbooks: async () => [badPath, baseJob.filePath],
      readWorkbook: async (path) => { if (path === badPath) throw new Error("invalid"); return baseJob; },
      gateway: { findMatches: async () => [record], create: async () => ({ outcome: "accepted" }), getDetails: async () => record }
    });
    const result = await runFolder("D:\\input", deps);
    expect(result.files.map(({ status }) => status)).toEqual(["invalid_input", "written"]);
  });

  it("reports discovery and per-file progress in order", async () => {
    const badPath = "D:\\input\\bad.xlsx";
    const events: string[] = [];
    const deps = await dependencies({
      discoverWorkbooks: async () => [badPath, baseJob.filePath],
      readWorkbook: async (path) => { if (path === badPath) throw new Error("invalid"); return baseJob; },
      gateway: { findMatches: async () => [record], create: async () => ({ outcome: "accepted" }), getDetails: async () => record },
      onFolderDiscovered: (paths) => { events.push(`found:${paths.length}`); },
      onFileStart: (_path, index, total) => { events.push(`start:${index}/${total}`); },
      onFileComplete: (result, index, total) => { events.push(`done:${index}/${total}:${result.status}`); },
    });

    await runFolder("D:\\input", deps);

    expect(events).toEqual([
      "found:2",
      "start:1/2",
      "done:1/2:invalid_input",
      "start:2/2",
      "done:2/2:written",
    ]);
  });
});
