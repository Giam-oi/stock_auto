import { describe, expect, it } from "vitest";
import { destinationUrl, findStores, STORES } from "../src/config";

describe("store selection", () => {
  it("supports one, multiple, and all stores", () => {
    expect(findStores("2").map((store) => store.index)).toEqual([2]);
    expect(findStores("1, 3,3,6").map((store) => store.index)).toEqual([1, 3, 6]);
    expect(findStores("all")).toHaveLength(6);
  });

  it("rejects an invalid store", () => {
    expect(() => findStores("7")).toThrow("1-6");
  });
});

describe("destinationUrl", () => {
  it("builds site and project-specific URLs", () => {
    expect(destinationUrl(STORES[0]!, "UAE", "inventory"))
      .toBe("https://fbn.noon.partners/en-ae/inventory?mp=noon&project=PRJ42958");
    expect(destinationUrl(STORES[5]!, "KSA", "dashboard"))
      .toBe("https://noon-store.noon.partners/en/STR363826-NSA/home?project=PRJ363826&tabs=dashboard");
  });
});
