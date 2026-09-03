import { readFile } from "node:fs/promises";
import { join } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

interface TabState { id: number; url: string; title: string; status: string }

async function loadExtension(initial: TabState) {
  const updated = new Set<(id: number, change: Record<string, unknown>) => void>();
  const removedListeners = new Set<(id: number) => void>();
  const messages: Array<(message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean | void> = [];
  const storage: Record<string, unknown> = {};
  const removed: number[] = [];
  const alarms: Array<{ name: string; options: unknown }> = [];
  const fetchUrls: string[] = [];
  let scriptingCalls = 0;
  let tab = { ...initial };
  const chrome = {
    action: { setBadgeBackgroundColor: () => {}, setBadgeText: () => {} },
    alarms: {
      create: async (name: string, options: unknown) => { alarms.push({ name, options }); },
      onAlarm: { addListener: () => {} },
    },
    runtime: {
      onMessage: { addListener: (listener: typeof messages[number]) => messages.push(listener) },
      onStartup: { addListener: () => {} },
    },
    storage: {
      local: {
        set: async (value: Record<string, unknown>) => Object.assign(storage, value),
        get: async (key: string) => ({ [key]: storage[key] }),
      },
    },
    scripting: {
      executeScript: async () => { scriptingCalls += 1; return [{ result: true }]; },
    },
    tabs: {
      create: async ({ url }: { url: string }) => { tab = { ...tab, url }; return { id: tab.id }; },
      get: async () => ({ ...tab }),
      update: async (_id: number, { url }: { url: string }) => {
        tab = { ...tab, url, title: "Noon Store - Partners", status: "complete" };
        return { ...tab };
      },
      remove: async (id: number) => { removed.push(id); },
      onUpdated: {
        addListener: (listener: (id: number, change: Record<string, unknown>) => void) => updated.add(listener),
        removeListener: (listener: (id: number, change: Record<string, unknown>) => void) => updated.delete(listener),
      },
      onRemoved: {
        addListener: (listener: (id: number) => void) => removedListeners.add(listener),
        removeListener: (listener: (id: number) => void) => removedListeners.delete(listener),
      },
    },
  };
  const source = await readFile(join(process.cwd(), "extension", "background.js"), "utf8");
  const fetch = async (url: string) => {
    fetchUrls.push(url);
    return {
      ok: true,
      json: async () => url.includes("/otp-code/") ? { code: "123456" } : { ok: true },
    };
  };
  vm.runInNewContext(source, { chrome, URL, Date, Error, Event, Promise, fetch, setTimeout, clearTimeout });
  const configure = messages[0]!;
  const run = (state: TabState, alarmMode: "primary" | "fallback" = "primary", autoLogin = false) => new Promise<Record<string, unknown>>((resolve) => {
    tab = state;
    configure({
      type: "configure-monitor",
      config: {
        storeIndex: 1,
        projectCode: "PRJ42958",
        targetUrl: autoLogin ? "https://noon-store.noon.partners/en/STR42958-NAE/home?project=PRJ42958&tabs=dashboard" : state.url,
        intervalMinutes: 10,
        alarmMode,
        ...(autoLogin ? { autoLogin: true, bridgeBaseUrl: "http://127.0.0.1:12345", bridgeToken: "test-token" } : {}),
      },
    }, {}, (value) => resolve(value as Record<string, unknown>));
    setTimeout(() => {
      tab = state;
      for (const listener of updated) listener(tab.id, { status: "complete" });
    }, 0);
  });
  return { run, storage, removed, alarms, fetchUrls, getScriptingCalls: () => scriptingCalls };
}

describe("monitor extension", () => {
  it("reports a valid Store Dashboard, persists the result, and closes the check tab", async () => {
    const harness = await loadExtension({
      id: 1,
      url: "https://noon-store.noon.partners/en/STR42958-NAE/home?project=PRJ42958&tabs=dashboard",
      title: "Noon Store - Partners",
      status: "complete",
    });
    const result = await harness.run({
      id: 1,
      url: "https://noon-store.noon.partners/en/STR42958-NAE/home?project=PRJ42958&tabs=dashboard",
      title: "Noon Store - Partners",
      status: "complete",
    });
    expect(result.valid).toBe(true);
    expect(harness.removed).toEqual([1]);
    expect(harness.alarms[0]).toMatchObject({ name: "noon-session-keepalive", options: { periodInMinutes: 10 } });
    expect((harness.storage.lastCheck as Record<string, unknown>).valid).toBe(true);
  });

  it("reports a redirect to Partners Login as invalid", async () => {
    const harness = await loadExtension({
      id: 2,
      url: "https://login.noon.partners/en?page=fbn.sc",
      title: "Partners Login",
      status: "complete",
    });
    const result = await harness.run({
      id: 2,
      url: "https://login.noon.partners/en?page=fbn.sc",
      title: "Partners Login",
      status: "complete",
    });
    expect(result).toMatchObject({ valid: false, reason: "redirected_to_login" });
    expect(harness.removed).toEqual([2]);
  });

  it("defers the extension alarm while the executable owns the monitor loop", async () => {
    const harness = await loadExtension({
      id: 3,
      url: "https://noon-store.noon.partners/en/STR42958-NAE/home?project=PRJ42958&tabs=dashboard",
      title: "Noon Store - Partners",
      status: "complete",
    });
    await harness.run({
      id: 3,
      url: "https://noon-store.noon.partners/en/STR42958-NAE/home?project=PRJ42958&tabs=dashboard",
      title: "Noon Store - Partners",
      status: "complete",
    }, "fallback");
    expect(harness.alarms).toEqual([{
      name: "noon-session-keepalive",
      options: { delayInMinutes: 20, periodInMinutes: 10 },
    }]);
  });

  it("does not treat FBN Inventory as the Store Dashboard login target", async () => {
    const harness = await loadExtension({
      id: 5,
      url: "https://fbn.noon.partners/en-ae/inventory?project=PRJ42958",
      title: "fulfillment | sc | noon | seller lab",
      status: "complete",
    });
    const result = await harness.run({
      id: 5,
      url: "https://fbn.noon.partners/en-ae/inventory?project=PRJ42958",
      title: "fulfillment | sc | noon | seller lab",
      status: "complete",
    });
    expect(result).toMatchObject({ valid: false, reason: "unexpected_page" });
  });

  it("requests a fresh Outlook code and verifies the target after automatic login", async () => {
    const harness = await loadExtension({
      id: 4,
      url: "https://login.noon.partners/en?project=PRJ42958",
      title: "Partners Login",
      status: "complete",
    });
    const result = await harness.run({
      id: 4,
      url: "https://login.noon.partners/en?project=PRJ42958",
      title: "Partners Login",
      status: "complete",
    }, "primary", true);
    expect(result).toMatchObject({ valid: true, autoLogin: true });
    expect(harness.fetchUrls).toEqual([
      "http://127.0.0.1:12345/otp-begin/test-token",
      "http://127.0.0.1:12345/otp-code/test-token",
    ]);
    expect(harness.getScriptingCalls()).toBe(4);
  });
});
