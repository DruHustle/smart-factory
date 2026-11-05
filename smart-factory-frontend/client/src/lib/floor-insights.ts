export function resolveTelemetryWindow(input: {
  at: string | null;
  anchor: number;
  now: number;
  demo: boolean;
  recordedAnchor?: string;
  rangeMs: number;
}) {
  const requested = input.at === null ? NaN : Number(input.at);
  const pinned =
    Number.isSafeInteger(requested) &&
    requested > 0 &&
    requested <= input.now + 300_000;
  const recorded = Date.parse(input.recordedAnchor ?? "");
  const endTime = pinned
    ? requested
    : input.demo && Number.isFinite(recorded)
      ? recorded
      : input.anchor;
  const range = input.rangeMs === 86_400_000 ? 86_400_000 : 3_600_000;
  return {
    pinned,
    endTime,
    startTime: endTime - range,
    intervalMs: range === 86_400_000 ? 900_000 : 60_000,
  };
}
export const floorViews = [
  "3d",
  "plan",
  "process",
  "electrical",
  "telemetry",
  "inventory",
  "infrastructure",
] as const;
export type FloorView = (typeof floorViews)[number];
export function resolveFloorView(value: string | null): FloorView {
  return floorViews.includes(value as FloorView) ? (value as FloorView) : "3d";
}
