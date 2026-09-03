import { describe, expect, it } from "vitest";
import type { NoonCredential } from "../src/credentials.js";
import type { InventoryDownload } from "../src/realtime-client.js";
import {
  runCollector,
  runSite,
  runStore,
  type CollectorOptions,
  type RunnerServices,
} from "../src/runner.js";
import { SITE_CONFIGS, STORE_CONFIGS } from "../src/contracts.js";
import type { OneDriveRoots } from "../src/onedrive.js";

const oneDriveRoots: OneDriveRoots = {
  KSA: "C:/OneDrive/KSA/Pending表",
  UAE: "C:/OneDrive/UAE/出入库",
};

const credential: NoonCredential = {
  type: "apijwt",
  key_id: "test",
  private_key: "test",
  project_code: "PRJ42958",
};

const download: InventoryDownload = {
  csvText: "full,csv\n",
  contentType: "text/csv",
  requestedAt: new Date("2026-08-07T00:00:00Z"),
  completedAt: new Date("2026-08-07T00:00:01Z"),
  httpStatus: 200,
};

function options(overrides: Partial<CollectorOptions> = {}): CollectorOptions {
  return {
    credentialDir: "D:/noon-api",
    outputRoot: "D:/文件/库存文件",
    runDate: "2026-08-07",
    sites: ["UAE", "KSA"],
    storeIndexes: [1, 2, 3, 4, 5, 6],
    dryRun: false,
    maximumAgeMinutes: 60,
    ...overrides,
  };
}

function services(events: string[] = [], overrides: Partial<RunnerServices> = {}): RunnerServices {
  return {
    loadCredential: async (_path, store) => {
      events.push(`load-${store.index}`);
      return { ...credential, project_code: store.projectCode };
    },
    login: async () => { events.push("login"); return { cookieHeader: "session=test" }; },
    download: async ({ store, site }) => {
      events.push(`download-${site.code}-${store.index}`);
      return download;
    },
    validate: (_value, store, site) => {
      events.push(`validate-${site.code}-${store.index}`);
      return {
        csvText: `inventory_type,partner_sku,qty\nsaleable,SKU-${store.index},1\n`,
        stats: {
          partnerId: store.partnerId,
          countryCode: site.countryCode,
          snapshotAtUtc: new Date("2026-08-07T00:00:00Z"),
          rowCount: 1,
          saleableRowCount: 1,
          saleableSkuCount: 1,
          saleableQty: 1,
        },
      };
    },
    stage: async (input) => {
      events.push(`stage-${input.site}-${input.files.length}`);
      return {
        ...input,
        stagingDirectory: `${input.outputRoot}/.staging/${input.runId}/${input.site}`,
        files: input.files.map((file) => ({ ...file, byteSize: Buffer.byteLength(file.csvText) })),
        expectedStoreIndexes: input.expectedStoreIndexes.slice(),
      };
    },
    publish: async (staged) => {
      events.push(`publish-${staged.site}-${staged.files.length}`);
      return {
        site: staged.site,
        runDate: staged.runDate,
        finalDirectory: staged.targetDirectory ??
          `${staged.outputRoot}/${staged.site}/${staged.runDate}`,
        fileNames: staged.files.map((file) => file.fileName),
      };
    },
    notify: async () => { events.push("notify"); },
    logger: { info: async () => undefined, error: async () => undefined },
    now: () => new Date("2026-08-07T00:00:00Z"),
    createRunId: () => "run-test",
    sleep: async () => undefined,
    ...overrides,
  };
}

describe("runStore", () => {
  it("reloads credentials and logs in again for a transient download retry", async () => {
    const events: string[] = [];
    let downloads = 0;
    const result = await runStore(
      {
        store: STORE_CONFIGS[0]!,
        site: SITE_CONFIGS.UAE,
        credentialDir: "D:/noon-api",
        runDate: "2026-08-07",
        maximumAgeMinutes: 60,
      },
      services(events, {
        download: async () => {
          events.push("download");
          downloads += 1;
          if (downloads === 1) throw Object.assign(new Error("temporary"), { retryable: true, kind: "network" });
          return download;
        },
      }),
    );

    expect(events).toEqual([
      "load-1", "login", "download",
      "load-1", "login", "download", "validate-UAE-1",
    ]);
    expect(result.result).toMatchObject({ status: "success", attempts: 2, fileName: "UAE1.20260807.csv" });
    expect(result.file?.csvText).toContain("SKU-1");
  });
});

describe("runSite", () => {
  it("stages and publishes exactly six validated production files", async () => {
    const events: string[] = [];
    const result = await runSite("UAE", options({ sites: ["UAE"] }), "run-test", services(events));
    expect(result.status).toBe("success");
    expect(result.stores).toHaveLength(6);
    expect(events).toContain("stage-UAE-6");
    expect(events).toContain("publish-UAE-6");
  });

  it("never stages or publishes an incomplete site", async () => {
    const events: string[] = [];
    const base = services(events);
    const result = await runSite("UAE", options({ sites: ["UAE"] }), "run-test", {
      ...base,
      download: async (input) => {
        events.push(`download-${input.site.code}-${input.store.index}`);
        if (input.store.index === 3) throw Object.assign(new Error("auth rejected"), { retryable: false, kind: "auth" });
        return download;
      },
    });
    expect(result.status).toBe("failed");
    expect(result.stores.find((store) => store.storeIndex === 3)?.status).toBe("failed");
    expect(events.some((event) => event.startsWith("stage-"))).toBe(false);
    expect(events.some((event) => event.startsWith("publish-"))).toBe(false);
  });

  it("stages but does not publish an isolated dry run", async () => {
    const events: string[] = [];
    const result = await runSite(
      "UAE",
      options({ sites: ["UAE"], storeIndexes: [1], dryRun: true, outputRoot: "D:/temp" }),
      "dry-test",
      services(events),
    );
    expect(result.status).toBe("success");
    expect(events).toContain("stage-UAE-1");
    expect(events.some((event) => event.startsWith("publish-"))).toBe(false);
  });

  it("publishes a complete production set locally and to the historical OneDrive path", async () => {
    const events: string[] = [];
    const result = await runSite(
      "KSA",
      options({ sites: ["KSA"], oneDriveRoots }),
      "sync-test",
      services(events),
    );

    expect(result.status).toBe("success");
    expect(events.filter((event) => event === "stage-KSA-6")).toHaveLength(2);
    expect(events.filter((event) => event === "publish-KSA-6")).toHaveLength(2);
    expect(result.oneDriveDirectory?.replaceAll("\\", "/"))
      .toBe("C:/OneDrive/KSA/Pending表/2026/2026.8/2026.08.07");
  });

  it("marks the site failed when OneDrive publication fails after local publication", async () => {
    const events: string[] = [];
    const base = services(events);
    let publications = 0;
    const result = await runSite(
      "UAE",
      options({ sites: ["UAE"], oneDriveRoots }),
      "sync-failure",
      {
        ...base,
        publish: async (staged) => {
          publications += 1;
          if (publications === 2) throw new Error("OneDrive unavailable");
          return base.publish(staged);
        },
      },
    );

    expect(publications).toBe(2);
    expect(result.status).toBe("failed");
    expect(result.error).toMatchObject({ stage: "onedrive-publish" });
  });
});

describe("runCollector", () => {
  it("continues KSA when UAE fails and sends one aggregate notification", async () => {
    const events: string[] = [];
    const base = services(events);
    const result = await runCollector(options(), {
      ...base,
      download: async (input) => {
        events.push(`download-${input.site.code}-${input.store.index}`);
        if (input.site.code === "UAE" && input.store.index === 2) {
          throw Object.assign(new Error("UAE failed"), { retryable: false, kind: "schema" });
        }
        return download;
      },
    });
    expect(result.sites.UAE.status).toBe("failed");
    expect(result.sites.KSA.status).toBe("success");
    expect(events).toContain("publish-KSA-6");
    expect(events.filter((event) => event === "notify")).toHaveLength(1);
    expect(result.successful).toBe(false);
  });

  it("keeps published files but marks the run failed when notification fails", async () => {
    const events: string[] = [];
    const result = await runCollector(options(), services(events, {
      notify: async () => { events.push("notify"); throw new Error("notification down"); },
    }));
    expect(events).toContain("publish-UAE-6");
    expect(events).toContain("publish-KSA-6");
    expect(result.notificationStatus).toBe("failed");
    expect(result.successful).toBe(false);
  });
});
