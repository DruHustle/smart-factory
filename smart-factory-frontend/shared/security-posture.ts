export type SecurityObservation = {
  event_type: string;
  mode: string;
  quality: string;
  occurred_at: Date | string;
  clock_skew?: boolean;
  fact?: unknown;
};

const areas = [
  {
    key: "transport",
    title: "Transport encryption",
    types: ["transport.connection_observed"],
    next: "Collect the gateway's existing connection state. A declared TLS endpoint alone does not verify encryption.",
  },
  {
    key: "certificate",
    title: "Certificate validity",
    types: ["tls.certificate_observed"],
    next: "Import the public certificate or collect its validity dates. Certificate dates do not establish connection trust.",
  },
  {
    key: "configuration",
    title: "Configuration & integrity",
    types: [
      "config.changed",
      "config.drift_observed",
      "integrity.change_observed",
    ],
    next: "Collect configuration hashes and compare them with a reviewed, approved baseline.",
  },
  {
    key: "access",
    title: "Access audit",
    types: [
      "auth.authentication_failed",
      "auth.authorization_denied",
      "identity.unrecognized",
      "input.rejected",
    ],
    next: "Map the device's authentication and authorization audit source. An absence of denials does not verify access controls.",
  },
  {
    key: "software",
    title: "Software inventory",
    types: ["software.inventory_observed"],
    next: "Import a scoped software report and review version applicability. A registry firmware value is a declaration.",
  },
  {
    key: "collector",
    title: "Collector health",
    types: ["collector.health"],
    next: "Map an approved collector to this device and verify that security observations reach the workspace.",
  },
] as const;

/** Presentation of reported evidence, never a control pass/fail or a security score. */
export function securityEvidenceAreas(
  observations: readonly SecurityObservation[],
  now = Date.now(),
) {
  return areas.map((area) => {
    const candidates = observations.filter((o) =>
      (area.types as readonly string[]).includes(o.event_type),
    );
    const latest = candidates.toSorted(
      (a, b) =>
        Date.parse(String(b.occurred_at)) - Date.parse(String(a.occurred_at)),
    )[0];
    const age = latest ? now - Date.parse(String(latest.occurred_at)) : NaN;
    const state = !latest
      ? "missing"
      : !Number.isFinite(age) || age < 0 || latest.clock_skew
        ? "unverified"
        : age > 86_400_000
          ? "stale"
          : latest.quality !== "good"
            ? "unverified"
            : "reported";
    return {
      ...area,
      latest,
      state,
      label: {
        missing: "No evidence",
        unverified: "Unverified",
        stale: "Stale evidence",
        reported: "Evidence reported",
      }[state],
    };
  });
}

export function securityScopeHref(
  tab: string,
  kind: "asset" | "device",
  id: number,
  mode?: string,
) {
  const params = new URLSearchParams({
    tab,
    targetKind: kind,
    targetId: String(id),
  });
  if (mode) params.set("mode", mode);
  return `#/cybersecurity?${params}`;
}
