import { describe, expect, it } from "vitest";
import {
  securityEvidenceAreas,
  securityScopeHref,
  type SecurityObservation,
} from "../shared/security-posture";

const now = Date.parse("2026-11-05T12:00:00Z");
const observation = (
  changes: Partial<SecurityObservation> = {},
): SecurityObservation => ({
  event_type: "transport.connection_observed",
  mode: "live",
  quality: "good",
  occurred_at: new Date(now - 1000).toISOString(),
  fact: { tlsActive: false },
  ...changes,
});
describe("security coverage presentation", () => {
  it("keeps every control unknown without security observations", () => {
    expect(securityEvidenceAreas([], now).map((a) => a.state)).toEqual(
      Array(6).fill("missing"),
    );
  });
  it("reports evidence presence without treating plaintext or rejected access as a passed control", () => {
    const areas = securityEvidenceAreas(
      [
        observation(),
        observation({ event_type: "auth.authentication_failed" }),
      ],
      now,
    );
    expect(areas.find((a) => a.key === "transport")).toMatchObject({
      state: "reported",
      label: "Evidence reported",
    });
    expect(areas.find((a) => a.key === "access")?.next).toContain(
      "does not verify access controls",
    );
    expect(areas.filter((a) => a.state === "reported")).toHaveLength(2);
  });
  it.each([
    [{ occurred_at: new Date(now - 86_400_001).toISOString() }, "stale"],
    [{ occurred_at: new Date(now + 1).toISOString() }, "unverified"],
    [{ occurred_at: "invalid" }, "unverified"],
    [{ quality: "bad" }, "unverified"],
    [{ quality: "unknown" }, "unverified"],
    [{ clock_skew: true }, "unverified"],
  ] as const)(
    "does not count unreliable evidence as recent: %j",
    (changes, state) => {
      expect(securityEvidenceAreas([observation(changes)], now)[0].state).toBe(
        state,
      );
    },
  );
  it("does not fall back to older good evidence when the latest report is uncertain", () => {
    const old = observation({
      occurred_at: new Date(now - 60_000).toISOString(),
    });
    expect(
      securityEvidenceAreas(
        [old, observation({ quality: "uncertain" })],
        now,
      )[0].state,
    ).toBe("unverified");
  });
  it("retains simulated provenance and never relabels it live", () => {
    expect(
      securityEvidenceAreas([observation({ mode: "simulated" })], now)[0].latest
        ?.mode,
    ).toBe("simulated");
  });
  it("keeps the identity and evidence mode on all navigation links", () => {
    const href = securityScopeHref("Sources and policies", "device", 1, "live");
    const params = new URLSearchParams(href.split("?")[1]);
    expect(Object.fromEntries(params)).toEqual({
      tab: "Sources and policies",
      targetKind: "device",
      targetId: "1",
      mode: "live",
    });
  });
});
