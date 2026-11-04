import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page, Request, Response, TestInfo } from "@playwright/test";
import { withAssistantHandoffDiagnostics } from "../e2e/assistant-handoff-diagnostics";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const privateValue = "<synthetic-unreported-value>";
function harness() {
  const root = mkdtempSync(join(tmpdir(), "assistant-handoff-test-"));
  roots.push(root);
  const output = join(root, "case", "assistant-handoff-timing.json");
  const forbidden = vi.fn(() => {
    throw new Error("No diagnostic browser call or payload read is permitted");
  });
  const page = Object.assign(new EventEmitter(), {
    location: "http://factory.test/#/inventory?context=" + privateValue,
    frame: {},
    url() {
      return this.location;
    },
    mainFrame() {
      return this.frame;
    },
    isClosed: () => false,
    evaluate: forbidden,
    locator: forbidden,
    waitForResponse: forbidden,
    waitForTimeout: forbidden,
    request: { get: forbidden, post: forbidden },
  });
  const info = { outputPath: vi.fn(() => output), attach: forbidden };
  const read = () => JSON.parse(readFileSync(output, "utf8"));
  const run = (action: Parameters<typeof withAssistantHandoffDiagnostics>[2]) =>
    withAssistantHandoffDiagnostics(
      page as unknown as Page,
      info as unknown as TestInfo,
      action,
    );
  const request = (path: string, type = "script", frame = page.frame) =>
    ({
      url: () =>
        path.startsWith("http") ? path : "http://factory.test" + path,
      frame: () => frame,
      resourceType: () => type,
      allHeaders: forbidden,
      headers: forbidden,
      postData: forbidden,
      failure: forbidden,
    }) as unknown as Request;
  const response = (request: Request, status = 200) =>
    ({
      request: () => request,
      status: () => status,
      body: forbidden,
      json: forbidden,
      text: forbidden,
      headers: forbidden,
    }) as unknown as Response;
  return { root, output, page, info, read, run, request, response, forbidden };
}

describe("bounded Assistant handoff failure evidence", () => {
  it("preserves the exact failure and records causal milestones and existing module progress without payloads", async () => {
    const h = harness(),
      original = new Error(privateValue);
    await expect(
      h.run(async (mark) => {
        const module = h.request(
          "/src/pages/Assistant.tsx?session=" + privateValue,
        );
        const dependency = h.request(
          "/node_modules/.vite/deps/private-name.js?context=" + privateValue,
        );
        const failed = h.request(
          "/src/private-name.ts?context=" + privateValue,
        );
        h.page.emit("request", module);
        mark("link-clicked");
        h.page.location =
          "http://factory.test/#/assistant?context=" + privateValue;
        h.page.emit("framenavigated", h.page.frame);
        mark("route-url-matched");
        h.page.emit("response", h.response(module));
        h.page.emit("requestfinished", module);
        h.page.emit("request", dependency);
        h.page.emit("response", h.response(dependency, 304));
        h.page.emit("request", failed);
        h.page.emit("requestfailed", failed);
        h.page.emit("pageerror", new Error(privateValue));
        throw original;
      }),
    ).rejects.toBe(original);
    const report = h.read();
    expect(report).toMatchObject({
      schema: "smart-factory-assistant-handoff/v1",
      started_ms: 0,
      failed_phase: "assistant-heading",
      heading_observed_ms: null,
      assistant_route_at_failure: true,
      page_closed_at_failure: false,
      page_error_count: 1,
      capture_error_count: 0,
      dropped_requests: 0,
    });
    expect(report.milestones["link-clicked"]).toBeGreaterThanOrEqual(0);
    expect(report.milestones["route-url-matched"]).toBeGreaterThanOrEqual(
      report.milestones["link-clicked"],
    );
    expect(report.failed_ms).toBeGreaterThanOrEqual(
      report.milestones["route-url-matched"],
    );
    expect(report.requests).toHaveLength(3);
    expect(report.requests[0]).toMatchObject({
      kind: "assistant-module",
      status: 200,
      finished_ms: expect.any(Number),
    });
    expect(report.requests[1]).toMatchObject({
      kind: "dependency-module",
      status: 304,
    });
    expect(report.requests[1]).not.toHaveProperty("finished_ms");
    expect(report.requests[2]).toMatchObject({
      kind: "source-module",
      failed_ms: expect.any(Number),
    });
    expect(report.document_events).toEqual([
      { event: "navigation", at_ms: expect.any(Number), assistant_route: true },
    ]);
    const encoded = readFileSync(h.output, "utf8");
    for (const value of [
      privateValue,
      encodeURIComponent(privateValue),
      "factory.test",
      "private-name",
      "session=",
      "context=",
    ])
      expect(encoded).not.toContain(value);
    expect(statSync(h.output).mode & 0o777).toBe(0o600);
    expect(h.page.eventNames()).toEqual([]);
    expect(h.forbidden).not.toHaveBeenCalled();
  });

  it("observes no API, image, cross-origin or other-frame payload and never polls readiness", async () => {
    const h = harness(),
      original = new Error("Synthetic heading failure");
    await expect(
      h.run(async () => {
        for (const request of [
          h.request("/api/trpc/auth.me?input=" + privateValue, "fetch"),
          h.request("/private-image.png", "image"),
          h.request("https://foreign.test/src/pages/Assistant.tsx"),
          h.request("/src/pages/Assistant.tsx", "script", {}),
        ]) {
          h.page.emit("request", request);
          h.page.emit("response", h.response(request));
          h.page.emit("requestfinished", request);
        }
        throw original;
      }),
    ).rejects.toBe(original);
    expect(h.read().requests).toEqual([]);
    expect(h.forbidden).not.toHaveBeenCalled();
    expect(h.page.eventNames()).toEqual([]);
  });

  it("caps the retained active-request map and lifecycle events before serialization", async () => {
    const h = harness(),
      original = new Error("Synthetic bounded failure");
    const ignoredStatus = vi.fn(() => 200);
    await expect(
      h.run(async () => {
        let last!: Request;
        for (let i = 0; i < 200; i++) {
          last = h.request(`/src/synthetic-${i}.tsx`);
          h.page.emit("request", last);
        }
        h.page.emit("response", { request: () => last, status: ignoredStatus });
        for (let i = 0; i < 100; i++) h.page.emit("load");
        throw original;
      }),
    ).rejects.toBe(original);
    expect(h.read().requests).toHaveLength(64);
    expect(h.read().dropped_requests).toBe(136);
    expect(h.read().document_events).toHaveLength(16);
    expect(h.read().dropped_document_events).toBe(84);
    expect(ignoredStatus).not.toHaveBeenCalled();
    expect(statSync(h.output).size).toBeLessThanOrEqual(24 * 1024);
    expect(h.page.eventNames()).toEqual([]);
  });

  it("emits no artifact on success and removes only its own listeners", async () => {
    const h = harness(),
      existing = vi.fn();
    h.page.on("request", existing);
    await expect(
      h.run(async (mark) => {
        h.page.emit("request", h.request("/src/pages/Assistant.tsx"));
        mark("link-clicked");
        mark("route-url-matched");
        mark("heading-observed");
      }),
    ).resolves.toBeUndefined();
    expect(h.info.outputPath).not.toHaveBeenCalled();
    expect(existsSync(h.output)).toBe(false);
    expect(h.page.listeners("request")).toEqual([existing]);
    expect(h.page.eventNames()).toEqual(["request"]);
    expect(existing).toHaveBeenCalledOnce();
    expect(h.forbidden).not.toHaveBeenCalled();
  });

  it("contains observer callback failures and refuses arbitrary milestone payloads", async () => {
    const h = harness(),
      original = new Error("Synthetic callback failure");
    await expect(
      h.run(async (mark) => {
        h.page.emit("request", {
          url: () => {
            throw new Error(privateValue);
          },
        });
        (mark as (value: string) => void)(privateValue);
        throw original;
      }),
    ).rejects.toBe(original);
    expect(h.read().capture_error_count).toBe(2);
    expect(h.read().milestones).toEqual({});
    expect(readFileSync(h.output, "utf8")).not.toContain(privateValue);
    expect(h.page.eventNames()).toEqual([]);
  });

  for (const failure of [
    "create-directory",
    "write-existing-file",
    "serialize",
    "oversized-serialization",
  ] as const) {
    it(`rethrows the identical original Error when diagnostics cannot ${failure}`, async () => {
      const h = harness(),
        original = new Error("Synthetic original failure");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      let serializer: ReturnType<typeof vi.spyOn> | undefined;
      if (failure === "create-directory")
        writeFileSync(join(h.root, "case"), "owned synthetic blocker");
      if (failure === "write-existing-file") {
        h.info.outputPath.mockReturnValue(join(h.root, "existing.json"));
        writeFileSync(join(h.root, "existing.json"), "owned earlier evidence");
      }
      let caught: unknown;
      try {
        await h.run(async () => {
          if (failure === "serialize")
            serializer = vi.spyOn(JSON, "stringify").mockImplementation(() => {
              throw new Error(privateValue);
            });
          if (failure === "oversized-serialization")
            serializer = vi
              .spyOn(JSON, "stringify")
              .mockReturnValue("x".repeat(24 * 1024 + 1));
          throw original;
        });
      } catch (error) {
        caught = error;
      } finally {
        serializer?.mockRestore();
      }
      expect(caught).toBe(original);
      expect(warn).toHaveBeenCalledWith(
        "Assistant handoff diagnostics could not be written.",
      );
      expect(existsSync(h.output)).toBe(false);
      if (failure === "write-existing-file")
        expect(readFileSync(join(h.root, "existing.json"), "utf8")).toBe(
          "owned earlier evidence",
        );
      expect(h.page.eventNames()).toEqual([]);
    });
  }

  it("preserves the original failure when the diagnostic warning sink also throws", async () => {
    const h = harness(),
      original = new Error("Synthetic original failure");
    h.info.outputPath.mockImplementation(() => {
      throw new Error(privateValue);
    });
    vi.spyOn(console, "warn").mockImplementation(() => {
      throw new Error("Synthetic warning failure");
    });
    await expect(
      h.run(async () => {
        throw original;
      }),
    ).rejects.toBe(original);
    expect(h.page.eventNames()).toEqual([]);
  });

  it("cleans partial listener registration without replacing the handoff result", async () => {
    const h = harness(),
      original = new Error("Synthetic original failure");
    const on = h.page.on.bind(h.page);
    vi.spyOn(h.page, "on").mockImplementation((event, listener) => {
      if (event === "requestfinished") throw new Error(privateValue);
      return on(event, listener);
    });
    await expect(
      h.run(async () => {
        throw original;
      }),
    ).rejects.toBe(original);
    expect(h.read().capture_error_count).toBe(1);
    expect(h.page.eventNames()).toEqual([]);
  });

  it("continues every listener removal even when one removal reports failure", async () => {
    const h = harness(),
      original = new Error("Synthetic original failure");
    const off = h.page.off.bind(h.page);
    vi.spyOn(h.page, "off").mockImplementation((event, listener) => {
      off(event, listener);
      if (event === "request") throw new Error(privateValue);
      return h.page;
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      h.run(async () => {
        throw original;
      }),
    ).rejects.toBe(original);
    expect(warn).toHaveBeenCalledWith(
      "Assistant handoff diagnostics could not remove every listener.",
    );
    expect(h.page.eventNames()).toEqual([]);
  });
});
