import { describe, expect, it } from "vitest";
import { profileDirectoryMap } from "../src/profiles";

describe("Chrome profile mapping", () => {
  it("maps the six named store profiles to their directories", () => {
    const map = profileDirectoryMap({
      profile: { info_cache: {
        Default: { name: "Person 1" },
        "Profile 1": { name: "店铺1" },
        "Profile 2": { name: "店铺2" },
        "Profile 6": { name: "店铺6" },
      } },
    });
    expect([...map]).toEqual([[1, "Profile 1"], [2, "Profile 2"], [6, "Profile 6"]]);
  });
});
