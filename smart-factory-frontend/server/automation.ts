import { createHmac, randomUUID } from "node:crypto";

export type AutomationEventKind =
  | "incident.note.added"
  | "incident.action.created"
  | "incident.action.updated";

type AutomationConfiguration = {
  engine: "disabled" | "activepieces";
  configured: boolean;
  webhookUrl: string | null;
  timeoutMs: number;
  allowHttp: boolean;
};

const DEFAULT_TIMEOUT_MS = 2_000;
const MIN_SECRET_LENGTH = 32;

function parseTimeout(value: string | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 250 && parsed <= 10_000
    ? parsed
    : DEFAULT_TIMEOUT_MS;
}

function webhookUrl(value: string | undefined, allowHttp: boolean) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) return null;
    if (parsed.protocol === "https:") return parsed.toString();
    if (allowHttp && parsed.protocol === "http:") return parsed.toString();
  } catch {
    // Configuration status reports invalid URLs without leaking the value.
  }
  return null;
}

export function automationConfiguration(): AutomationConfiguration {
  const requested = (process.env.AUTOMATION_ENGINE ?? "disabled")
    .trim()
    .toLowerCase();
  const engine = requested === "activepieces" ? "activepieces" : "disabled";
  const allowHttp = process.env.ACTIVEPIECES_ALLOW_HTTP === "true";
  const url = webhookUrl(process.env.ACTIVEPIECES_WEBHOOK_URL, allowHttp);
  const secret = process.env.ACTIVEPIECES_WEBHOOK_SECRET ?? "";
  return {
    engine,
    configured:
      engine === "activepieces" &&
      url !== null &&
      secret.length >= MIN_SECRET_LENGTH,
    webhookUrl: url,
    timeoutMs: parseTimeout(process.env.AUTOMATION_WEBHOOK_TIMEOUT_MS),
    allowHttp,
  };
}

export function automationStatus() {
  const activepieces = automationConfiguration();
  return {
    nodeRed: {
      role: "edge_ot" as const,
      enabled: process.env.NODE_RED_INTEGRATION_ENABLED === "true",
      authoritative: false,
    },
    activepieces: {
      role: "business_ai" as const,
      enabled: activepieces.engine === "activepieces",
      configured: activepieces.configured,
      authoritative: false,
    },
  };
}

export async function publishAutomationEvent(
  kind: AutomationEventKind,
  payload: Record<string, unknown>,
) {
  const config = automationConfiguration();
  if (config.engine !== "activepieces")
    return { delivered: false, reason: "disabled" as const };
  if (!config.configured || !config.webhookUrl)
    return { delivered: false, reason: "unconfigured" as const };

  const id = randomUUID();
  const body = JSON.stringify({
    schemaVersion: 1,
    id,
    kind,
    occurredAt: new Date().toISOString(),
    source: "smart-factory",
    payload,
  });
  const secret = process.env.ACTIVEPIECES_WEBHOOK_SECRET!;
  const signature = createHmac("sha256", secret).update(body).digest("hex");

  try {
    const response = await fetch(config.webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "smart-factory-automation/1",
        "x-smart-factory-event-id": id,
        "x-smart-factory-signature": `sha256=${signature}`,
      },
      body,
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    if (!response.ok) {
      console.warn(
        `[Automation] Activepieces rejected ${kind} with HTTP ${response.status}`,
      );
      return { delivered: false, reason: "rejected" as const };
    }
    return { delivered: true, reason: "accepted" as const };
  } catch (error) {
    console.warn(
      `[Automation] Activepieces delivery failed for ${kind}: ${error instanceof Error ? error.name : "unknown error"}`,
    );
    return { delivered: false, reason: "unavailable" as const };
  }
}
