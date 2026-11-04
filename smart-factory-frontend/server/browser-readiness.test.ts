import { describe, expect, it } from "vitest";
import type { Page, Response } from "@playwright/test";
import { withRpcResult } from "../e2e/readiness-helpers";

const frame = {};
const result = (json: unknown) => ({ result: { data: { json } } });
function reply(
  path: string,
  body: unknown,
  options: {
    origin?: string;
    frame?: object;
    ok?: boolean;
    finished?: () => Promise<Error | null>;
  } = {},
) {
  return {
    url: () => (options.origin ?? "http://factory.test") + path,
    request: () => ({ frame: () => options.frame ?? frame }),
    ok: () => options.ok ?? true,
    finished: options.finished ?? (async () => null),
    json: async () => body,
  } as Response;
}

function harness(replies: Response[]) {
  let predicate:
    | ((response: Response) => boolean | Promise<boolean>)
    | undefined;
  let deliver!: (response: Response) => void;
  const page = {
    url: () => "http://factory.test/#/inventory",
    mainFrame: () => frame,
    waitForResponse: (matches: typeof predicate) => {
      predicate = matches;
      return new Promise<Response>((resolve) => {
        deliver = resolve;
      });
    },
  } as unknown as Page;
  const action = async () => {
    // No request may start before its observer is registered.
    expect(predicate).toBeTypeOf("function");
    for (const response of replies) {
      if (await predicate!(response)) {
        deliver(response);
        return;
      }
    }
    throw new Error("No qualifying page response");
  };
  return { page, action };
}

describe("browser fixture readiness evidence", () => {
  it("observes the page's exact origin, frame and procedure before the action", async () => {
    const { page, action } = harness([
      reply("/api/trpc/inventory.item", result("foreign"), {
        origin: "http://foreign.test",
      }),
      reply("/api/trpc/inventory.item", result("iframe"), { frame: {} }),
      reply("/api/trpc/inventory.itemExtra", result("different procedure")),
      reply("/api/trpc/inventory.item", result({ ref: "device:7" })),
    ]);
    await expect(
      withRpcResult(page, "inventory.item", action),
    ).resolves.toEqual({ ref: "device:7" });
  });

  it("waits for complete body delivery", async () => {
    let finish!: () => void;
    let observed = false;
    const body = new Promise<null>((resolve) => {
      finish = () => resolve(null);
    });
    const { page, action } = harness([
      reply("/api/trpc/inventory.item", result("ready"), {
        finished: async () => {
          observed = true;
          return body;
        },
      }),
    ]);
    let settled = false;
    const reading = withRpcResult(page, "inventory.item", action).then(
      (value) => {
        settled = true;
        return value;
      },
    );
    await expect.poll(() => observed).toBe(true);
    expect(settled).toBe(false);
    finish();
    await expect(reading).resolves.toBe("ready");
  });

  it("selects the requested result in a successful batch", async () => {
    const { page, action } = harness([
      reply("/api/trpc/factory.floor,inventory.item?batch=1", [
        result("floor"),
        result("item"),
      ]),
    ]);
    await expect(withRpcResult(page, "inventory.item", action)).resolves.toBe(
      "item",
    );
  });

  for (const [name, response] of [
    [
      "HTTP failure",
      reply("/api/trpc/inventory.item", result("denied"), { ok: false }),
    ],
    [
      "failed body",
      reply("/api/trpc/inventory.item", result("partial"), {
        finished: async () => new Error("interrupted"),
      }),
    ],
    [
      "missing result",
      reply("/api/trpc/inventory.item", { error: { message: "Denied" } }),
    ],
    [
      "mixed batch error",
      reply("/api/trpc/factory.floor,inventory.item?batch=1", [
        result("floor"),
        { error: { message: "Denied" } },
      ]),
    ],
    [
      "unbound batch shape",
      reply(
        "/api/trpc/factory.floor,inventory.item?batch=1",
        result("wrong slot"),
      ),
    ],
    [
      "missing batch slot",
      reply("/api/trpc/factory.floor,inventory.item?batch=1", [
        result("floor"),
      ]),
    ],
  ] as const) {
    it(`rejects ${name}`, async () => {
      const { page, action } = harness([response]);
      await expect(
        withRpcResult(page, "inventory.item", action),
      ).rejects.toThrow();
    });
  }

  it("ignores a previous workspace response before accepting the scoped response", async () => {
    const old = reply("/api/trpc/inventory.item", result("old scope"));
    const next = reply("/api/trpc/inventory.item", result("new scope"));
    const { page, action } = harness([old, next]);
    await expect(
      withRpcResult(
        page,
        "inventory.item",
        action,
        async (response) => response === next,
      ),
    ).resolves.toBe("new scope");
  });
});
