import { Shield, ArrowUpRight, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useDocumentActive } from "@/hooks/useDocumentActive";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SampleTime } from "@/components/workspace/Primitives";
import {
  securityEvidenceAreas,
  securityScopeHref,
} from "@shared/security-posture";

/** Scoped evidence is independent of telemetry availability and never implies a secure device. */
export default function SecuritySummary({
  kind,
  id,
}: {
  kind: "asset" | "device";
  id: number;
}) {
  const active = useDocumentActive();
  const access = trpc.security.availability.useQuery();
  const enabled =
    access.data?.enabled === true && Number.isInteger(id) && id > 0;
  const mode = access.data?.demoOnly ? undefined : ("live" as const);
  const filter = { targetKind: kind, targetId: id, mode };
  const options = {
    enabled,
    refetchInterval: active ? 30_000 : (false as const),
    refetchIntervalInBackground: false,
  };
  const findings = trpc.security.findings.useQuery(filter, options);
  const posture = trpc.security.posture.useQuery(filter, options);
  const refresh = () => {
    void access.refetch();
    if (enabled) {
      void findings.refetch();
      void posture.refetch();
    }
  };
  const pending =
    access.isLoading || (enabled && (findings.isLoading || posture.isLoading));
  const error = access.error || (enabled && (findings.error || posture.error));
  const item = posture.data?.items.find(
    (item) => item.kind === kind && item.id === id,
  );
  const areas = securityEvidenceAreas(item?.observations ?? []);
  const reported = areas.filter((area) => area.state === "reported").length;
  const latest = item?.observations.toSorted(
    (a, b) =>
      Date.parse(String(b.occurred_at)) - Date.parse(String(a.occurred_at)),
  )[0];
  const records = findings.data?.items ?? [];
  const review = records
    .filter(
      (f) => !["resolved", "dismissed", "accepted_risk"].includes(f.status),
    )
    .toSorted((a, b) => b.priority - a.priority)
    .slice(0, 3);
  const href = (tab: string) => securityScopeHref(tab, kind, id, mode);
  return (
    <section
      aria-label="Cybersecurity summary"
      className="min-w-0 space-y-5 rounded-xl border bg-card p-5 [overflow-wrap:anywhere]"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="rounded-lg bg-primary/10 p-2 text-primary">
            <Shield className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-semibold">Cybersecurity</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Security evidence for this {kind}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={
            access.isFetching || findings.isFetching || posture.isFetching
          }
        >
          <RefreshCw className="mr-2 size-3.5" aria-hidden="true" />
          Refresh evidence
        </Button>
      </header>
      {pending ? (
        <p role="status" className="text-sm">
          Loading security coverage and findings…
        </p>
      ) : error ? (
        <p
          role="alert"
          className="rounded-lg border border-warning/50 bg-warning/5 p-4 text-sm"
        >
          Security evidence could not be loaded. Refresh to try again; no
          finding count or assessment is available.
        </p>
      ) : !access.data?.enabled ? (
        <p className="text-sm">
          Security collection is disabled. Ask an administrator to enable
          evidence collection before assessing this {kind}.
        </p>
      ) : (
        <>
          <div className="rounded-lg border bg-muted/20 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">
                {!item
                  ? "Security identity unavailable"
                  : reported === 0
                    ? "Security evidence not established"
                    : reported < areas.length
                      ? "Security evidence incomplete"
                      : "Security evidence available"}
              </h3>
              <Badge variant="outline">
                {access.data?.demoOnly
                  ? "Demonstration evidence"
                  : "Live evidence"}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {!item
                ? "This identity was not returned by the security inventory. Review its registration and evidence mapping."
                : "Telemetry can be live while security controls remain unverified. Zero findings does not mean this device or asset is secure."}
            </p>
          </div>
          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">
                Recorded findings
              </dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums">
                {records.length}
                {findings.data?.hasMore ? "+" : ""}
              </dd>
              <p className="text-xs text-muted-foreground">
                All investigation states · {mode ?? "demo modes"}
              </p>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                Areas with recent evidence
              </dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums">
                {reported}
                <span className="text-sm font-normal text-muted-foreground">
                  {" "}
                  / {areas.length}
                </span>
              </dd>
              <p className="text-xs text-muted-foreground">
                Reported within 24h · not a security score
              </p>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                Latest security observation
              </dt>
              <dd className="mt-2 text-sm">
                {latest ? (
                  <SampleTime value={String(latest.occurred_at)} />
                ) : (
                  "Not observed"
                )}
              </dd>
              <p className="mt-1 text-xs text-muted-foreground">
                Separate from sensor readings
              </p>
            </div>
          </dl>
          {item && (
            <div
              aria-label="Security evidence coverage"
              className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
            >
              {areas.map((area) => (
                <article key={area.key} className="rounded-lg border p-3">
                  <h3 className="text-sm font-medium">{area.title}</h3>
                  <p
                    className={`mt-2 text-xs font-medium ${area.state === "reported" ? "text-info" : "text-muted-foreground"}`}
                  >
                    {area.label}
                  </p>
                  {area.latest && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {area.latest.mode} · {area.latest.quality} quality ·{" "}
                      <SampleTime value={String(area.latest.occurred_at)} />
                    </p>
                  )}
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    {area.next}
                  </p>
                </article>
              ))}
            </div>
          )}
          {review.length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Findings to review</h3>
              {review.map((f) => (
                <a
                  key={f.id}
                  className="block rounded-lg border p-3 text-sm hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"
                  href={`${href("Findings")}&finding=${encodeURIComponent(f.id)}`}
                >
                  <div className="flex flex-wrap justify-between gap-2">
                    <strong className="font-medium">{f.title}</strong>
                    <Badge variant="outline">{f.severity}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {f.mode} · {f.status.replaceAll("_", " ")} ·{" "}
                    {f.condition_active
                      ? "Condition observed"
                      : "Condition no longer current"}
                  </p>
                </a>
              ))}
              {findings.data?.hasMore && (
                <p className="text-xs text-muted-foreground">
                  Showing priority findings from the latest 50 records. Open all
                  findings for the full history.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {records.length === 0
                ? "No findings recorded in this evidence scope. Start by reviewing the coverage above and mapping an approved security source."
                : "No findings awaiting review in this page of records. Review evidence coverage and the full investigation history."}
            </p>
          )}
          <nav
            aria-label="Security next steps"
            className="flex flex-wrap gap-x-5 gap-y-3 border-t pt-4 text-sm"
          >
            <a
              className="inline-flex items-center gap-1 text-primary underline underline-offset-4"
              href={href("Findings")}
            >
              Review findings
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </a>
            <a
              className="text-primary underline underline-offset-4"
              href={href("Asset posture")}
            >
              Inspect {kind} posture
            </a>
            <a
              className="text-primary underline underline-offset-4"
              href={href("Events")}
            >
              View security observations
            </a>
            {access.data?.canEngineer && (
              <a
                className="text-primary underline underline-offset-4"
                href={href("Sources and policies")}
              >
                Review sources & mappings
              </a>
            )}
          </nav>
        </>
      )}
    </section>
  );
}
