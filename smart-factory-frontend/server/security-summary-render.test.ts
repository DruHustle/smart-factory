import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const queries = vi.hoisted(() => ({
  access: vi.fn(),
  findings: vi.fn(),
  posture: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    security: {
      availability: { useQuery: queries.access },
      findings: { useQuery: queries.findings },
      posture: { useQuery: queries.posture },
    },
  },
}));
vi.mock("@/hooks/useDocumentActive", () => ({ useDocumentActive: () => true }));
import SecuritySummary from "@/components/SecuritySummary";
const query = (data?: unknown, extra = {}) => ({
  data,
  isLoading: false,
  isFetching: false,
  error: null,
  refetch: vi.fn(),
  ...extra,
});
const render = () =>
  renderToStaticMarkup(
    createElement(SecuritySummary, { kind: "device", id: 1 }),
  );
beforeEach(() => {
  queries.access.mockReturnValue(
    query({ enabled: true, demoOnly: false, canEngineer: true }),
  );
  queries.findings.mockReturnValue(query({ items: [], hasMore: false }));
  queries.posture.mockReturnValue(
    query({ items: [{ kind: "device", id: 1, observations: [] }] }),
  );
});
describe("device security summary states", () => {
  it("offers scoped next steps when there are no findings or observations", () => {
    const html = render();
    expect(html).toContain("Security evidence not established");
    expect(html.match(/No evidence/g)).toHaveLength(6);
    expect(html).toContain("targetKind=device&amp;targetId=1&amp;mode=live");
    expect(queries.posture).toHaveBeenCalledWith(
      expect.objectContaining({
        targetKind: "device",
        targetId: 1,
        mode: "live",
      }),
      expect.anything(),
    );
  });
  it("does not render a zero count or missing controls while loading", () => {
    queries.posture.mockReturnValue(query(undefined, { isLoading: true }));
    const html = render();
    expect(html).toContain("Loading security coverage and findings");
    expect(html).not.toContain("Recorded findings");
  });
  it("does not reuse cached zero counts as a current assessment after a failed refresh", () => {
    queries.posture.mockReturnValue(
      query({ items: [] }, { error: new Error("offline") }),
    );
    const html = render();
    expect(html).toContain('role="alert"');
    expect(html).toContain("Security evidence could not be loaded");
    expect(html).not.toContain("Recorded findings");
  });
  it("distinguishes disabled collection from missing evidence", () => {
    queries.access.mockReturnValue(query({ enabled: false }));
    expect(render()).toContain("Security collection is disabled");
    expect(render()).not.toContain("Security evidence not established");
  });
  it("retains demonstration provenance without offering engineering setup", () => {
    queries.access.mockReturnValue(
      query({ enabled: true, demoOnly: true, canEngineer: false }),
    );
    const html = render();
    expect(html).toContain("Demonstration evidence");
    expect(html).not.toContain("Live evidence");
    expect(html).not.toContain("Review sources &amp; mappings");
  });
  it("explains missing registration instead of implying all six controls were checked", () => {
    queries.posture.mockReturnValue(query({ items: [] }));
    const html = render();
    expect(html).toContain("Security identity unavailable");
    expect(html).not.toContain('aria-label="Security evidence coverage"');
  });
});
