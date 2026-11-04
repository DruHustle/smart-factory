import { describe, expect, it } from "vitest";
import { expectedSources } from "../scripts/expected-sources.mts";

const pins = { backend: "b".repeat(40), edge: "c".repeat(40) };
describe("qualification source layout", () => {
  it("preserves legacy source pins", () => {
    expect(expectedSources(undefined, "a".repeat(40), pins)).toEqual(pins);
  });
  it("requires the same exact canonical revision for every component", () => {
    expect(expectedSources("monorepo", "a".repeat(40), pins)).toEqual({
      backend: "a".repeat(40),
      edge: "a".repeat(40),
    });
  });
  it.each([
    undefined,
    "",
    "main",
    "a".repeat(39),
    "A".repeat(40),
    "a".repeat(40) + "\n",
  ])("rejects an unpinned monorepo revision: %s", (revision) => {
    expect(() => expectedSources("monorepo", revision, pins)).toThrow();
  });
  it("does not silently accept unknown layouts", () => {
    expect(() => expectedSources("other", "a".repeat(40), pins)).toThrow();
  });
  it("rejects invalid legacy pins", () => {
    expect(() =>
      expectedSources("legacy", undefined, {
        backend: "main",
        edge: pins.edge,
      }),
    ).toThrow();
  });
});
