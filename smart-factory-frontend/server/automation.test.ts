import { afterEach, describe, expect, it, vi } from "vitest";
import {
  automationConfiguration,
  automationStatus,
  publishAutomationEvent,
} from "./automation";

const tracked = [
  "AUTOMATION_ENGINE",
  "ACTIVEPIECES_WEBHOOK_URL",
  "ACTIVEPIECES_WEBHOOK_SECRET",
  "ACTIVEPIECES_ALLOW_HTTP",
  "AUTOMATION_WEBHOOK_TIMEOUT_MS",
  "NODE_RED_INTEGRATION_ENABLED",
] as const;
const original = Object.fromEntries(
  tracked.map((key) => [key, process.env[key]]),
) as Record<(typeof tracked)[number], string | undefined>;

afterEach(() => {
  for (const key of tracked) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllGlobals();
});

describe("automation integration", () => {
  it("fails closed when Activepieces is not configured", async () => {
    delete process.env.AUTOMATION_ENGINE;
    delete process.env.ACTIVEPIECES_WEBHOOK_URL;
    delete process.env.ACTIVEPIECES_WEBHOOK_SECRET;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(automationConfiguration().configured).toBe(false);
    await expect(
      publishAutomationEvent("incident.note.added", { incidentId: 1 }),
    ).resolves.toEqual({ delivered: false, reason: "disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("signs and delivers an Activepieces business event", async () => {
    process.env.AUTOMATION_ENGINE = "activepieces";
    process.env.ACTIVEPIECES_ALLOW_HTTP = "true";
    process.env.ACTIVEPIECES_WEBHOOK_URL =
      "http://activepieces.internal/hooks/smart-factory";
    process.env.ACTIVEPIECES_WEBHOOK_SECRET = "x".repeat(48);
    process.env.AUTOMATION_WEBHOOK_TIMEOUT_MS = "750";

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      const headers = init?.headers as Record<string, string>;
      expect(headers["x-smart-factory-signature"]).toMatch(/^sha256=[a-f0-9]{64}$/);
      expect(headers["x-smart-factory-event-id"]).toMatch(
        /^[0-9a-f-]{36}$/i,
      );
      const body = JSON.parse(String(init?.body));
      expect(body.kind).toBe("incident.action.created");
      expect(body.payload).toEqual({ incidentId: 7, actionId: 11 });
      return new Response(null, { status: 202 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      publishAutomationEvent("incident.action.created", {
        incidentId: 7,
        actionId: 11,
      }),
    ).resolves.toEqual({ delivered: true, reason: "accepted" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports the two automation engines without making them authoritative", () => {
    process.env.NODE_RED_INTEGRATION_ENABLED = "true";
    process.env.AUTOMATION_ENGINE = "activepieces";
    process.env.ACTIVEPIECES_WEBHOOK_URL = "https://automation.example/hooks/a";
    process.env.ACTIVEPIECES_WEBHOOK_SECRET = "s".repeat(32);

    expect(automationStatus()).toEqual({
      nodeRed: { role: "edge_ot", enabled: true, authoritative: false },
      activepieces: {
        role: "business_ai",
        enabled: true,
        configured: true,
        authoritative: false,
      },
    });
  });
});
