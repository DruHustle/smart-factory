import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Activity,
  ArrowUpRight,
  Boxes,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import { Button } from "@/components/ui/button";
import { useDocumentActive } from "@/hooks/useDocumentActive";
import { trpc } from "@/lib/trpc";
import {
  ALL_ASSET_OBSERVATIONS,
  selectOverviewObservationSource,
} from "@/lib/overview-observations";
import { useWorkspaceLocation } from "@/lib/hashLocation";
import { resolveTelemetryWindow } from "@/lib/floor-insights";
import { canonicalUnits, metrics, type Metric } from "@shared/measurements";
import { itemHref, type InventoryItem } from "@shared/inventory";
import { ObservationTrend } from "./ObservationTrend";
import { OverviewInfrastructure } from "./OverviewInfrastructure";
import { SystemItemTypes } from "./SystemInventoryOverview";
import { StatusBadge } from "./Primitives";

export type FloorInsightsView = "telemetry" | "inventory" | "infrastructure";

export function FactoryFloorInsights({
  view,
  items,
  demo,
  returnTo,
  rangeMs,
  onRangeChange,
  onInspectItem,
}: {
  view: FloorInsightsView;
  items: InventoryItem[];
  demo: boolean;
  returnTo: string;
  rangeMs?: number;
  onRangeChange?: (value: number) => void;
  onInspectItem?: (ref: string) => void;
}) {
  if (view === "telemetry")
    return (
      <FactoryTelemetry
        items={items}
        demo={demo}
        rangeMs={rangeMs}
        onRangeChange={onRangeChange}
      />
    );
  if (view === "inventory")
    return (
      <FactoryInventory
        items={items}
        returnTo={returnTo}
        onInspectItem={onInspectItem}
      />
    );
  return <FactoryInfrastructure />;
}

function TelemetryPreview({
  item,
  metric,
  demo,
  startTime,
  endTime,
  intervalMs,
  expanded,
  onExpand,
}: {
  item: InventoryItem;
  metric: Metric;
  demo: boolean;
  startTime: number;
  endTime: number;
  intervalMs: number;
  expanded: boolean;
  onExpand: () => void;
}) {
  const source =
    item.kind === "device"
      ? { deviceId: Number(item.id) }
      : { assetIds: [item.identifier] };
  const query = trpc.readings.trend.useQuery(
    {
      ...source,
      metric,
      scope: demo ? "simulated" : "operational",
      startTime,
      endTime,
      intervalMs,
    },
    { staleTime: 30_000, retry: false },
  );
  const values = query.data?.buckets ?? [];
  const verified = query.data?.verified ?? 0;
  return (
    <button
      type="button"
      aria-label={`Expand telemetry for ${item.name}`}
      aria-pressed={expanded}
      onClick={onExpand}
      className={`min-w-0 rounded-lg border p-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring ${expanded ? "border-primary bg-primary/5" : "bg-card"}`}
      data-testid="telemetry-preview"
    >
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">
            {item.name}
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {item.zone || item.location || "Unassigned"} · {metric} (
            {canonicalUnits[metric]})
          </span>
        </span>
        <StatusBadge status={item.status} />
      </span>
      <span className="mt-2 block h-16 min-w-0" aria-hidden="true">
        {query.isLoading ? (
          <span className="flex h-full items-center text-xs text-muted-foreground">
            Loading readings…
          </span>
        ) : query.error ? (
          <span className="flex h-full items-center text-xs text-destructive">
            Readings unavailable
          </span>
        ) : verified ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={values}>
              <Line
                type="linear"
                dataKey="value"
                stroke="var(--chart-2)"
                strokeWidth={2}
                connectNulls={false}
                dot={values.filter((value) => value.value != null).length === 1}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <span className="flex h-full items-center text-xs text-muted-foreground">
            No verified readings
          </span>
        )}
      </span>
      <span className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>
          {query.error
            ? "Source error"
            : verified
              ? `${verified} verified samples`
              : "Evidence not established"}
        </span>
        <span className="font-medium text-foreground">
          {expanded ? "Collapse" : "Expand chart"}
        </span>
      </span>
    </button>
  );
}

function FactoryTelemetry({
  items,
  demo,
  rangeMs,
  onRangeChange,
}: {
  items: InventoryItem[];
  demo: boolean;
  rangeMs?: number;
  onRangeChange?: (value: number) => void;
}) {
  const [location, navigate] = useWorkspaceLocation();
  const params = new URLSearchParams(location.split("?")[1] ?? "");
  const metric = metrics.includes(params.get("metric") as Metric)
    ? (params.get("metric") as Metric)
    : "temperature";
  const [localRangeMs, setLocalRangeMs] = useState(3_600_000);
  const selectedRangeMs = rangeMs ?? localRangeMs;
  const [anchor, setAnchor] = useState(() => Date.now());
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState(() =>
    params.has("observationSource"),
  );
  const expandedPanel = useRef<HTMLDivElement>(null);
  const previewFocus = useRef<HTMLButtonElement | null>(null);
  const active = useDocumentActive();
  const utils = trpc.useUtils();
  const update = (values: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values))
      value ? next.set(key, value) : next.delete(key);
    navigate(`${location.split("?")[0]}${next.size ? `?${next}` : ""}`);
  };
  const showcase = trpc.system.showcase.useQuery(undefined, {
    enabled: demo,
    staleTime: 300_000,
    retry: false,
  });
  const window = resolveTelemetryWindow({
    at: params.get("at"),
    anchor,
    now: Date.now(),
    demo,
    recordedAnchor: showcase.data?.anchor,
    rangeMs: selectedRangeMs,
  });
  const endTime = window.endTime;
  const selection = selectOverviewObservationSource(
    items,
    metric,
    params.get("observationSource"),
  );
  const filtered = selection.sources.filter((item) =>
    `${item.name} ${item.identifier} ${item.zone ?? ""} ${item.itemType}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const safePage = Math.min(
    page,
    Math.max(0, Math.ceil(filtered.length / 6) - 1),
  );
  const shown = filtered.slice(safePage * 6, safePage * 6 + 6);
  useEffect(() => {
    if (!active || demo || window.pinned) return;
    setAnchor(Date.now());
    const timer = globalThis.setInterval(() => setAnchor(Date.now()), 60_000);
    return () => globalThis.clearInterval(timer);
  }, [active, demo, window.pinned]);
  useEffect(() => {
    if (!expanded) return;
    expandedPanel.current?.focus({ preventScroll: true });
    expandedPanel.current?.scrollIntoView({ block: "nearest" });
  }, [expanded, selection.value]);
  const refresh = () => {
    if (!window.pinned) setAnchor(Date.now());
    void utils.readings.trend.invalidate();
  };
  const closeExpanded = () => {
    setExpanded(false);
    previewFocus.current?.focus({ preventScroll: true });
  };
  return (
    <section
      aria-label="Factory telemetry"
      className="min-w-0 space-y-4 p-3 sm:p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 font-semibold">
            <Activity className="size-4 text-info" aria-hidden />
            Telemetry
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {selection.sources.length} equipment sources · Select a mini-chart
            to expand verified measurements.
            {demo
              ? " Simulated observations, not live equipment."
              : " Missing readings remain gaps."}
            {window.pinned ? " Pinned observation window." : ""}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={refresh}>
          <RefreshCw className="mr-1 size-3.5" aria-hidden />
          Refresh window
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <input
          aria-label="Filter telemetry equipment"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
          }}
          placeholder="Search equipment or zone…"
          className="workspace-control min-w-0"
        />
        <select
          aria-label="Factory telemetry metric"
          value={metric}
          onChange={(event) => update({ metric: event.target.value })}
          className="workspace-control min-w-0"
        >
          {metrics.map((name) => (
            <option key={name} value={name}>
              {name} ({canonicalUnits[name]})
            </option>
          ))}
        </select>
        <select
          aria-label="Factory telemetry period"
          value={selectedRangeMs}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (onRangeChange) onRangeChange(next);
            else setLocalRangeMs(next);
          }}
          className="workspace-control min-w-0"
        >
          <option value={3_600_000}>Last 60 min</option>
          <option value={86_400_000}>Last 24 hours</option>
        </select>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0 whitespace-nowrap">Source</span>
          <select
            aria-label="Overview observation source"
            className="workspace-control min-w-0 flex-1"
            value={selection.selection}
            onChange={(event) => {
              update({ observationSource: event.target.value });
              setExpanded(true);
            }}
          >
            <option value="auto">Choose automatically</option>
            {selection.aggregateAvailable && (
              <option value={ALL_ASSET_OBSERVATIONS}>
                All registered assets
              </option>
            )}
            {selection.sources.map((item) => (
              <option key={item.ref} value={item.ref}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!selection.value}
          onClick={() => setExpanded(true)}
        >
          Expand selected source
        </Button>
      </div>
      {!filtered.length ? (
        <div
          className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground"
          role="status"
        >
          {selection.sources.length
            ? "No telemetry sources match the filter."
            : "No equipment observation sources are available. Connect an asset or a commissioned device to see verified trends."}
        </div>
      ) : (
        <>
          <div
            className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3"
            aria-label="Equipment telemetry previews"
          >
            {shown.map((item) => (
              <TelemetryPreview
                key={item.ref}
                item={item}
                metric={metric}
                demo={demo}
                startTime={window.startTime}
                endTime={endTime}
                intervalMs={window.intervalMs}
                expanded={expanded && selection.source?.ref === item.ref}
                onExpand={() => {
                  previewFocus.current =
                    document.activeElement instanceof HTMLButtonElement
                      ? document.activeElement
                      : null;
                  if (expanded && selection.source?.ref === item.ref)
                    closeExpanded();
                  else {
                    update({ observationSource: item.ref });
                    setExpanded(true);
                  }
                }}
              />
            ))}
          </div>
          {filtered.length > 6 && (
            <nav
              className="flex flex-wrap items-center justify-between gap-2"
              aria-label="Telemetry equipment pages"
            >
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={safePage === 0}
                onClick={() => setPage(safePage - 1)}
              >
                Previous equipment
              </Button>
              <span className="text-xs text-muted-foreground">
                {safePage * 6 + 1}–{Math.min(safePage * 6 + 6, filtered.length)}{" "}
                of {filtered.length} sources
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={(safePage + 1) * 6 >= filtered.length}
                onClick={() => setPage(safePage + 1)}
              >
                Next equipment
              </Button>
            </nav>
          )}
        </>
      )}
      {expanded && selection.value && (
        <div
          ref={expandedPanel}
          tabIndex={-1}
          className="min-w-0 space-y-2 outline-none"
          data-testid="expanded-factory-telemetry"
          aria-label={`Expanded telemetry for ${selection.label}`}
        >
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={closeExpanded}
            >
              Close expanded chart
            </Button>
          </div>
          <ObservationTrend
            dashboard
            title="Factory observations"
            sourceLabel={`Source: ${selection.label}${selection.source ? "" : " · asset observations only"}`}
            {...selection.input}
            metric={metric}
            onMetricChange={(value) => update({ metric: value })}
            scope={demo ? "simulated" : "operational"}
            startTime={window.startTime}
            endTime={endTime}
            intervalMs={window.intervalMs}
          />
        </div>
      )}
      <Link
        href="/analytics"
        className="inline-flex min-h-9 items-center gap-1 text-xs underline"
      >
        Explore all telemetry in Analytics{" "}
        <ArrowUpRight className="size-3.5" aria-hidden />
      </Link>
    </section>
  );
}

function FactoryInventory({
  items,
  returnTo,
  onInspectItem,
}: {
  items: InventoryItem[];
  returnTo: string;
  onInspectItem?: (ref: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const matching = items.filter((item) =>
    `${item.name} ${item.factoryTag ?? ""} ${item.identifier} ${item.itemType}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const safePage = Math.min(
    page,
    Math.max(0, Math.ceil(matching.length / 12) - 1),
  );
  const groups = useMemo(() => {
    const counts = new Map<
      string,
      { kind: string; itemType: string; equipment: boolean; count: number }
    >();
    for (const item of items) {
      const key = `${item.kind}:${item.itemType}`;
      const group = counts.get(key);
      if (group) group.count++;
      else
        counts.set(key, {
          kind: item.kind,
          itemType: item.itemType,
          equipment: item.kind === "equipment",
          count: 1,
        });
    }
    return [...counts.values()];
  }, [items]);
  const zones = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      const zone = item.zone || item.location || "Unassigned";
      counts.set(zone, (counts.get(zone) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [items]);
  const count = (status: InventoryItem["status"]) =>
    items.filter((item) => item.status === status).length;
  const issues = items.filter((item) =>
    ["offline", "error", "maintenance", "stale"].includes(item.status),
  );
  return (
    <section
      aria-label="Factory inventory summary"
      className="min-w-0 space-y-4 p-3 sm:p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 font-semibold">
            <Boxes className="size-4 text-info" aria-hidden />
            Factory inventory
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {items.length} registered items · {zones.length} groups by location
          </p>
        </div>
        <Link
          href="/inventory"
          className="inline-flex min-h-9 items-center gap-1 text-xs underline"
        >
          Full inventory <ArrowUpRight className="size-3.5" aria-hidden />
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Online", count("live")],
          ["Offline", count("offline")],
          ["Maintenance", count("maintenance")],
          ["Errors", count("error")],
        ].map(([name, value]) => (
          <div key={name} className="rounded-md border bg-background p-3">
            <p className="text-xs text-muted-foreground">{name}</p>
            <strong className="text-xl tabular-nums">{value}</strong>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {count("stale")} stale · {count("unknown")} unknown. Offline, error and
        maintenance statuses indicate possible downtime; actual downtime
        duration requires verified operational history.
      </p>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <div className="min-w-0 rounded-lg border p-3">
          <h4 className="mb-2 text-sm font-semibold">Item types</h4>
          <SystemItemTypes groups={groups} />
        </div>
        <div className="min-w-0 rounded-lg border p-3">
          <h4 className="mb-2 text-sm font-semibold">Factory groups & zones</h4>
          {zones.length ? (
            <ul
              className="max-h-64 divide-y overflow-y-auto text-sm"
              aria-label="Inventory by location"
            >
              {zones.map(([name, total]) => (
                <li
                  key={name}
                  className="flex items-center justify-between gap-2 py-2"
                >
                  <span className="min-w-0 break-words">{name}</span>
                  <strong className="tabular-nums">{total}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              No factory groups yet.
            </p>
          )}
        </div>
      </div>
      <section
        aria-label="Factory inventory"
        className="min-w-0 rounded-lg border p-3"
      >
        <label className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium">
          Equipment & devices
          <input
            aria-label="Search factory inventory"
            className="workspace-control max-w-64"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
            placeholder="Search this factory…"
          />
        </label>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {matching.slice(safePage * 12, safePage * 12 + 12).map((item) => (
            <li key={item.ref} className="min-w-0 rounded border p-3">
              {onInspectItem ? (
                <button
                  className="min-h-9 w-full break-words text-left text-sm font-medium underline"
                  aria-label={`Select ${item.name} on floor`}
                  onClick={() => onInspectItem(item.ref)}
                >
                  {item.name}
                </button>
              ) : (
                <strong className="break-words text-sm">{item.name}</strong>
              )}
              <p className="break-all text-xs text-muted-foreground">
                {item.factoryTag ?? item.identifier} ·{" "}
                {item.itemType.replaceAll("_", " ")}
              </p>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <StatusBadge status={item.status} />
                <Link
                  className="min-h-9 text-xs underline"
                  href={
                    item.sandbox
                      ? `/sandbox?tab=inventory&item=${encodeURIComponent(item.ref)}`
                      : itemHref(item.ref, "overview", returnTo)
                  }
                >
                  Open item
                </Link>
              </div>
            </li>
          ))}
        </ul>
        {!matching.length && (
          <p className="py-3 text-sm text-muted-foreground">
            No inventory items match this view.
          </p>
        )}
        {matching.length > 12 && (
          <nav
            aria-label="Factory inventory pages"
            className="mt-3 flex flex-wrap items-center justify-between gap-2"
          >
            <Button
              size="sm"
              variant="outline"
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
            >
              Previous items
            </Button>
            <span className="text-xs">
              {safePage * 12 + 1}–
              {Math.min(safePage * 12 + 12, matching.length)} of{" "}
              {matching.length}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={(safePage + 1) * 12 >= matching.length}
              onClick={() => setPage(safePage + 1)}
            >
              Next items
            </Button>
          </nav>
        )}
      </section>
      {issues.length > 0 && (
        <div className="rounded-lg border p-3">
          <h4 className="mb-2 text-sm font-semibold">
            Equipment needing attention · {issues.length}
          </h4>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {issues.slice(0, 9).map((item) => (
              <li key={item.ref}>
                <Link
                  href={
                    item.sandbox
                      ? `/sandbox?tab=inventory&item=${encodeURIComponent(item.ref)}`
                      : itemHref(item.ref, "overview", returnTo)
                  }
                  className="flex min-h-10 items-center justify-between gap-2 rounded border px-2 py-1 text-xs hover:bg-muted/50"
                >
                  <span className="min-w-0 truncate">{item.name}</span>
                  <StatusBadge status={item.status} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function FactoryInfrastructure() {
  const active = useDocumentActive();
  const access = trpc.security.availability.useQuery(undefined, {
    staleTime: 60_000,
    retry: false,
  });
  const enabled = access.data?.enabled === true;
  const evidenceFilter = {
    mode: access.data?.demoOnly ? undefined : ("live" as const),
  };
  const security = trpc.security.overview.useQuery(evidenceFilter, {
    enabled,
    staleTime: 30_000,
    retry: false,
    refetchInterval: active ? 60_000 : false,
    refetchIntervalInBackground: false,
  });
  const counts = security.data?.counts ?? [];
  const severities = ["critical", "high", "medium", "low"] as const;
  return (
    <section
      aria-label="Factory infrastructure and cybersecurity"
      className="min-w-0 space-y-3 p-3 sm:p-4"
    >
      <div>
        <h3 className="font-semibold">Infrastructure</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Workspace-wide application and integration service health, reported
          failures and security evidence; not limited to the selected factory
          zone.
        </p>
      </div>
      <div className="grid min-w-0 gap-3 lg:grid-cols-2">
        <OverviewInfrastructure />
        <div
          className="min-w-0 rounded-lg border bg-card p-4"
          aria-label="Cybersecurity status"
        >
          <h4 className="flex items-center gap-2 font-semibold">
            <ShieldAlert className="size-4 text-info" aria-hidden />
            Cybersecurity issues
          </h4>
          {access.isLoading ? (
            <p role="status" className="mt-3 text-xs text-muted-foreground">
              Checking security availability…
            </p>
          ) : access.error ? (
            <p role="alert" className="mt-3 text-xs text-muted-foreground">
              Security availability could not be checked.
            </p>
          ) : !enabled ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Security evidence collection is disabled. Security posture is
              unknown.
            </p>
          ) : security.isLoading ? (
            <p role="status" className="mt-3 text-xs text-muted-foreground">
              Loading reported findings…
            </p>
          ) : security.error || !security.data ? (
            <div className="mt-3 text-xs text-muted-foreground">
              <p>Security evidence unavailable; no assessment can be made.</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void security.refetch()}
              >
                Retry security evidence
              </Button>
            </div>
          ) : (
            <>
              <p className="mt-3 text-xs text-muted-foreground">
                {security.data.coverage.receiving} receiving /{" "}
                {security.data.coverage.configured} configured sources ·{" "}
                {security.data.coverage.stale} stale or missing
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                {severities.map((severity) => (
                  <Link
                    key={severity}
                    href={`/cybersecurity?tab=Findings&severity=${severity}${evidenceFilter.mode ? "&mode=live" : ""}`}
                    className="flex min-h-10 items-center justify-between gap-2 rounded border px-2 hover:bg-muted/40"
                  >
                    <span className="capitalize">{severity} findings</span>
                    <strong className="tabular-nums">
                      {Number(
                        counts.find((row) => row.severity === severity)
                          ?.count ?? 0,
                      )}
                    </strong>
                  </Link>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">
                {access.data?.demoOnly
                  ? "Simulated security evidence."
                  : "Reported security evidence."}{" "}
                Zero findings does not establish secure controls; unmonitored
                systems remain unknown.
              </p>
            </>
          )}
          <Link
            href={
              evidenceFilter.mode
                ? "/cybersecurity?mode=live"
                : "/cybersecurity"
            }
            className="mt-4 inline-flex min-h-9 items-center gap-1 text-xs underline"
          >
            Inspect cybersecurity findings{" "}
            <ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  );
}
