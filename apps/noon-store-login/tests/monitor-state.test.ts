import { describe, expect, it } from "vitest";
import { isConfirmedLogout, shouldOpenLoginPage } from "../src/monitor-state";

const loginResult = {
  valid: false,
  finalUrl: "https://login.noon.partners/en",
  title: "Partners Login",
};

describe("shouldOpenLoginPage", () => {
  it("opens once on an initial or new logout transition", () => {
    expect(shouldOpenLoginPage(false, loginResult)).toBe(true);
  });

  it("does not reopen while the same logout remains confirmed", () => {
    expect(shouldOpenLoginPage(true, loginResult)).toBe(false);
  });

  it("does not treat temporary failures as logout", () => {
    const unavailable = { valid: false, finalUrl: "", title: "" };
    expect(isConfirmedLogout(unavailable)).toBe(false);
    expect(shouldOpenLoginPage(false, unavailable)).toBe(false);
  });

  it("recognizes both the login host and login title", () => {
    expect(isConfirmedLogout(loginResult)).toBe(true);
    expect(isConfirmedLogout({
      valid: false,
      finalUrl: "https://fbn.noon.partners/en-ae/inventory",
      title: "Partners Login",
    })).toBe(true);
  });
});
