import { describe, expect, it } from "vitest";
import {
  resolveFloorView,
  resolveTelemetryWindow,
} from "../client/src/lib/floor-insights";
const now = Date.parse("2026-11-05T12:00:00Z");
const base = { at: null, anchor: now, now, demo: false, rangeMs: 3600000 };
describe("floor insight evidence windows", () => {
  it("advances live windows without changing a pinned timestamp", () => {
    expect(resolveTelemetryWindow(base).endTime).toBe(now);
    expect(
      resolveTelemetryWindow({ ...base, anchor: now + 60000, now: now + 60000 })
        .endTime,
    ).toBe(now + 60000);
    expect(
      resolveTelemetryWindow({
        ...base,
        at: String(now),
        anchor: now + 60000,
        now: now + 60000,
      }),
    ).toMatchObject({ pinned: true, endTime: now });
  });
  it("rejects malformed, future and unsafe pins and bounds range", () => {
    for (const at of [
      "",
      "-1",
      "NaN",
      "Infinity",
      "1.5",
      String(now + 300001),
      "9007199254740992",
    ])
      expect(resolveTelemetryWindow({ ...base, at, rangeMs: 1 })).toMatchObject(
        { pinned: false, startTime: now - 3600000 },
      );
  });
  it("uses recorded demo time, while respecting explicit incident replay", () => {
    const recordedAnchor = "2026-10-31T12:00:00Z";
    expect(
      resolveTelemetryWindow({ ...base, demo: true, recordedAnchor }).endTime,
    ).toBe(Date.parse(recordedAnchor));
    expect(
      resolveTelemetryWindow({
        ...base,
        demo: true,
        recordedAnchor,
        at: String(now),
        rangeMs: 86400000,
      }),
    ).toMatchObject({
      endTime: now,
      intervalMs: 900000,
      startTime: now - 86400000,
    });
  });
  it("accepts only known URL views", () => {
    expect(resolveFloorView("telemetry")).toBe("telemetry");
    for (const view of [null, "<script>", "unexpected"])
      expect(resolveFloorView(view)).toBe("3d");
  });
});
