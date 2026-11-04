import type {
  Frame,
  Page,
  Request,
  Response,
  TestInfo,
} from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

type Milestone = "link-clicked" | "route-url-matched" | "heading-observed";
type ModuleKind =
  | "assistant-module"
  | "source-module"
  | "dependency-module"
  | "other-script"
  | "document";
type RequestProgress = {
  kind: ModuleKind;
  started_ms: number;
  response_ms?: number;
  status?: number;
  finished_ms?: number;
  failed_ms?: number;
};

/** Failure evidence for this handoff only. Observe existing traffic without
 * waiting for it, reading response bodies, or introducing another readiness gate.
 * All recorded strings are fixed labels; URLs, query values and errors stay out.
 */
export async function withAssistantHandoffDiagnostics(
  page: Page,
  testInfo: TestInfo,
  handoff: (mark: (milestone: Milestone) => void) => Promise<void>,
) {
  const started = performance.now();
  const elapsed = () => Math.round((performance.now() - started) * 10) / 10;
  const milestones: Partial<Record<Milestone, number>> = {};
  const requests = new Map<Request, RequestProgress>();
  const documents: {
    event: "navigation" | "domcontentloaded" | "load";
    at_ms: number;
    assistant_route: boolean;
  }[] = [];
  let droppedRequests = 0,
    droppedDocumentEvents = 0,
    captureErrors = 0,
    pageErrors = 0;
  let origin: string | undefined;
  try {
    origin = new URL(page.url()).origin;
  } catch {
    captureErrors++;
  }
  const assistantRoute = () => {
    try {
      return new URL(page.url()).hash.split("?")[0] === "#/assistant";
    } catch {
      captureErrors++;
      return false;
    }
  };
  const guarded =
    <T>(observe: (value: T) => void) =>
    (value: T) => {
      try {
        observe(value);
      } catch {
        captureErrors++;
      }
    };
  const warn = (message: string) => {
    try {
      console.warn(message);
    } catch {
      // Even a broken diagnostic sink must preserve the original test result.
    }
  };
  const onRequest = guarded<Request>((request) => {
    const url = new URL(request.url());
    if (url.origin !== origin || request.frame() !== page.mainFrame()) return;
    const type = request.resourceType();
    if (type !== "script" && type !== "document") return;
    if (requests.size === 64) {
      droppedRequests++;
      return;
    }
    const kind: ModuleKind =
      type === "document"
        ? "document"
        : url.pathname === "/src/pages/Assistant.tsx"
          ? "assistant-module"
          : url.pathname.startsWith("/src/")
            ? "source-module"
            : /^\/(?:node_modules\/|@id\/|@fs\/)/.test(url.pathname)
              ? "dependency-module"
              : "other-script";
    requests.set(request, { kind, started_ms: elapsed() });
  });
  const onResponse = guarded<Response>((response) => {
    const record = requests.get(response.request());
    if (!record) return;
    record.response_ms = elapsed();
    const status = response.status();
    if (Number.isInteger(status) && status >= 0 && status <= 599)
      record.status = status;
  });
  const onFinished = guarded<Request>((request) => {
    const record = requests.get(request);
    if (record) record.finished_ms = elapsed();
  });
  const onFailed = guarded<Request>((request) => {
    const record = requests.get(request);
    if (record) record.failed_ms = elapsed();
  });
  const documentEvent = (event: "navigation" | "domcontentloaded" | "load") => {
    if (documents.length === 16) {
      droppedDocumentEvents++;
      return;
    }
    documents.push({
      event,
      at_ms: elapsed(),
      assistant_route: assistantRoute(),
    });
  };
  const onNavigation = guarded<Frame>((frame) => {
    if (frame === page.mainFrame()) documentEvent("navigation");
  });
  const onDomContentLoaded = guarded<Page>(() =>
    documentEvent("domcontentloaded"),
  );
  const onLoad = guarded<Page>(() => documentEvent("load"));
  const onPageError = () => {
    pageErrors++;
  };
  const stop = () => {
    let failed = false;
    for (const remove of [
      () => page.off("request", onRequest),
      () => page.off("response", onResponse),
      () => page.off("requestfinished", onFinished),
      () => page.off("requestfailed", onFailed),
      () => page.off("framenavigated", onNavigation),
      () => page.off("domcontentloaded", onDomContentLoaded),
      () => page.off("load", onLoad),
      () => page.off("pageerror", onPageError),
    ]) {
      try {
        remove();
      } catch {
        failed = true;
      }
    }
    if (failed)
      warn("Assistant handoff diagnostics could not remove every listener.");
  };
  try {
    page.on("request", onRequest);
    page.on("response", onResponse);
    page.on("requestfinished", onFinished);
    page.on("requestfailed", onFailed);
    page.on("framenavigated", onNavigation);
    page.on("domcontentloaded", onDomContentLoaded);
    page.on("load", onLoad);
    page.on("pageerror", onPageError);
  } catch {
    captureErrors++;
  }
  try {
    await handoff((milestone) => {
      if (
        !["link-clicked", "route-url-matched", "heading-observed"].includes(
          milestone,
        )
      ) {
        captureErrors++;
        return;
      }
      milestones[milestone] ??= elapsed();
    });
  } catch (originalError) {
    try {
      const report = {
        schema: "smart-factory-assistant-handoff/v1",
        clock: "monotonic milliseconds since handoff observation began",
        scope:
          "Only existing same-origin main-frame script/document requests started during the handoff; cached or earlier requests are not reconstructed. Module timings do not isolate server compilation from transfer or browser execution.",
        started_ms: 0,
        failed_ms: elapsed(),
        failed_phase:
          milestones["link-clicked"] === undefined
            ? "link-click"
            : milestones["route-url-matched"] === undefined
              ? "route-url-predicate"
              : milestones["heading-observed"] === undefined
                ? "assistant-heading"
                : "handoff-completion",
        heading_observed_ms: milestones["heading-observed"] ?? null,
        milestones,
        assistant_route_at_failure: assistantRoute(),
        page_closed_at_failure: page.isClosed(),
        document_events: documents,
        requests: [...requests.values()],
        dropped_requests: droppedRequests,
        dropped_document_events: droppedDocumentEvents,
        page_error_count: pageErrors,
        capture_error_count: captureErrors,
      };
      let body = JSON.stringify(report, null, 2) + "\n";
      if (Buffer.byteLength(body) > 24 * 1024) {
        report.dropped_requests += report.requests.length;
        report.dropped_document_events += report.document_events.length;
        report.requests = [];
        report.document_events = [];
        body = JSON.stringify(report, null, 2) + "\n";
      }
      if (Buffer.byteLength(body) > 24 * 1024)
        throw new Error("Assistant handoff diagnostic exceeded its size limit");
      const output = testInfo.outputPath("assistant-handoff-timing.json");
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, body, { flag: "wx", mode: 0o600 });
    } catch {
      // Evidence failure must not replace the original navigation/assertion error.
      warn("Assistant handoff diagnostics could not be written.");
    }
    throw originalError;
  } finally {
    stop();
  }
}
