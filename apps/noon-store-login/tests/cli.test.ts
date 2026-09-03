import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli";

describe("CLI options", () => {
  it("parses unattended launch options", () => {
    expect(parseArgs(["--store", "all", "--site", "ksa", "--page", "dashboard"], {})).toMatchObject({
      stores: "all",
      site: "KSA",
      destination: "dashboard",
      intervalMinutes: 30,
      interactive: false,
      autoLogin: true,
    });
  });

  it("parses a bounded monitor window", () => {
    expect(parseArgs([
      "--store", "1",
      "--interval-minutes", "15",
      "--monitor-until", "2026-08-12T09:30:00+08:00",
    ], {})).toMatchObject({
      intervalMinutes: 15,
      monitorUntil: "2026-08-12T09:30:00+08:00",
    });
  });

  it("parses resident mode without an interactive prompt", () => {
    expect(parseArgs(["--resident"], {})).toMatchObject({
      resident: true,
      stores: "all",
      interactive: false,
      intervalMinutes: 30,
      destination: "dashboard",
      openLoginOnLogout: false,
    });
  });

  it("keeps login presentation for an ordinary one-shot run", () => {
    expect(parseArgs(["--store", "1"], {})).toMatchObject({ openLoginOnLogout: true });
  });

  it("disables login presentation for a background one-shot run", () => {
    expect(parseArgs(["--background", "--store", "all"], {})).toMatchObject({ openLoginOnLogout: false });
  });

  it("allows automatic Outlook login to be disabled explicitly", () => {
    expect(parseArgs(["--store", "2", "--no-auto-login"], {})).toMatchObject({ autoLogin: false });
  });
});
