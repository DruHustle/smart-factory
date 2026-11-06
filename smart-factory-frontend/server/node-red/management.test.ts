import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  packageSelection,
  pendingInstall,
  type InstallOperation,
} from "../../shared/node-red";
import { NodeRedClient } from "./client";
import {
  MANAGEMENT_PERMISSIONS,
  NodeRedError,
  nodeRedConfiguration,
} from "./configuration";
import { NodeRedPackageService } from "./service";
import type { InstallStore } from "./store";

const env = {
  NODE_RED_MANAGEMENT_ENABLED: "true",
  NODE_RED_INTEGRATION_ENABLED: "true",
  PUBLIC_DEMO_DEPLOYMENT: "false",
  ENABLE_DEMO_ACCOUNTS: "false",
  NODE_RED_ADMIN_URL: "http://127.0.0.1:18880/admin",
  NODE_RED_RUNTIME_ID: "8d70df1b-5722-4e7f-8dfc-e90cfa875a77",
  NODE_RED_RUNTIME_VERSION: "4.1.4",
  NODE_RED_RUNTIME_LABEL: "Synthetic gateway",
  NODE_RED_ADMIN_TOKEN: "a".repeat(64),
};
const selection = { module: "@fixture/node-red-test", version: "1.2.3" };
const config = () => nodeRedConfiguration(env)!;
function memoryStore() {
  const records = new Map<string, InstallOperation>();
  let current: InstallOperation | null = null;
  const store: InstallStore = {
    current: async () => structuredClone(current),
    authorize: vi.fn(async () => {}),
    claim: vi.fn(async (next) => {
      const existing = records.get(next.id);
      if (existing) {
        if (
          ["actorId", "runtimeId", "targetRevision", "module", "version"].some(
            (key) =>
              existing[key as keyof InstallOperation] !==
              next[key as keyof InstallOperation],
          )
        )
          throw new NodeRedError("Request ID mismatch", true);
        return { operation: structuredClone(existing), accepted: false };
      }
      if (pendingInstall(current))
        throw new NodeRedError("Installation pending or unconfirmed", true);
      current = structuredClone(next);
      records.set(next.id, current);
      return { operation: structuredClone(next), accepted: true };
    }),
    finish: vi.fn(async (next) => {
      if (!current || current.id !== next.id) throw Error("Wrong reservation");
      if (!pendingInstall(current)) return structuredClone(current);
      current = structuredClone(next);
      records.set(next.id, current);
      return structuredClone(current);
    }),
  };
  return store;
}
function runtimeFixture() {
  let installed = false;
  let postCount = 0;
  let postFailure: "lost" | "refused" | null = null;
  let failReadback = false;
  let pluginOnly = false;
  let wrongVersion = false;
  const calls: { url: string; init: RequestInit }[] = [];
  const entry = () => ({
    module: selection.module,
    name: "test",
    version: wrongVersion ? "9.9.9" : selection.version,
    enabled: true,
  });
  const module = () => ({
    name: selection.module,
    version: entry().version,
    nodes: pluginOnly ? [] : [entry()],
    plugins: pluginOnly ? [entry()] : [],
    path: "/private/node-red/userDir",
  });
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        "content-type": "application/json",
        "x-smart-factory-node-red-runtime": env.NODE_RED_RUNTIME_ID,
      },
    });
  const fetcher: typeof fetch = vi.fn(async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.startsWith("https://registry.npmjs.org/"))
      return reply({
        name: selection.module,
        version: selection.version,
        description: "Synthetic Node-RED package",
        "node-red": pluginOnly
          ? { plugins: { test: "plugin.js" } }
          : { nodes: { test: "node.js" } },
      });
    if (init.method === "POST") {
      postCount++;
      if (postFailure === "refused")
        return reply({ message: "Bearer secret-value" }, 401);
      if (postFailure === "lost")
        throw Error("Bearer secret-value http://private.gateway");
      installed = true;
      return reply(module());
    }
    if (postCount && failReadback)
      return reply({ message: "password=secret-value" }, 401);
    if (url.endsWith("/settings"))
      return reply({
        version: "4.1.4",
        user: { permissions: MANAGEMENT_PERMISSIONS },
        externalModules: {
          palette: {
            allowInstall: true,
            allowUpdate: false,
            allowUpload: false,
          },
        },
      });
    if (url.endsWith("/nodes"))
      return reply(installed && !pluginOnly ? [entry()] : []);
    if (url.endsWith("/plugins"))
      return reply(installed && pluginOnly ? [entry()] : []);
    if (url.endsWith("/nodes/" + encodeURIComponent(selection.module)))
      return reply(module());
    throw Error("Unexpected path " + url);
  });
  return {
    fetcher,
    calls,
    get posts() {
      return postCount;
    },
    set installed(value: boolean) {
      installed = value;
    },
    set postFailure(value: "lost" | "refused" | null) {
      postFailure = value;
    },
    set failReadback(value: boolean) {
      failReadback = value;
    },
    set pluginOnly(value: boolean) {
      pluginOnly = value;
    },
    set wrongVersion(value: boolean) {
      wrongVersion = value;
    },
  };
}
async function start(service: NodeRedPackageService, actorId = 7) {
  const review = await service.review(actorId, selection);
  const request = {
    requestId: randomUUID(),
    reviewToken: review.reviewToken,
    acknowledgeCodeExecution: true as const,
  };
  const operation = await service.install(actorId, request);
  return { review, request, operation };
}
async function settled(store: InstallStore) {
  await vi.waitFor(async () =>
    expect((await store.current(env.NODE_RED_RUNTIME_ID))?.state).not.toBe(
      "installing",
    ),
  );
  return (await store.current(env.NODE_RED_RUNTIME_ID))!;
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("Node-RED package input and transport boundary", () => {
  it.each([
    "../private",
    "/tmp/nodes",
    "file:./nodes",
    "https://example.test/package",
    "git+ssh://example.test/repo",
    "npm:other-package",
    "package@latest",
    "@scope/../package",
    "pkg;id",
    "pkg%2fother",
    "node-red",
    "--help",
  ])("rejects non-registry package form %s", (module) => {
    expect(packageSelection.safeParse({ ...selection, module }).success).toBe(
      false,
    );
  });
  it.each([
    "latest",
    "next",
    "^1.2.3",
    "~1.2.3",
    "1.x",
    "1.2",
    ">=1.2.3",
    "1.2.3 || 2.0.0",
    "v1.2.3",
    "01.2.3",
    "1.2.3-01",
    "1.2.3;id",
    "npm:alias@1.2.3",
  ])("rejects unpinned version %s", (version) => {
    expect(packageSelection.safeParse({ ...selection, version }).success).toBe(
      false,
    );
  });
  it("accepts scoped names and exact prereleases while rejecting extra command/URL fields", () => {
    expect(
      packageSelection.safeParse({
        ...selection,
        version: "1.2.3-rc.1+build.7",
      }).success,
    ).toBe(true);
    expect(
      packageSelection.safeParse({
        ...selection,
        url: "https://example.test/payload.tgz",
      }).success,
    ).toBe(false);
  });
  it.each([
    "http://localhost:1880/admin",
    "http://192.168.0.2:1880/admin",
    "https://example.test/admin",
    "http://user:secret@127.0.0.1:1880/admin",
    "http://127.0.0.1:1880/admin?token=secret",
    "http://127.0.0.1:1880/flows",
  ])(
    "rejects a host/path outside the approved loopback boundary: %s",
    (url) => {
      expect(() =>
        nodeRedConfiguration({ ...env, NODE_RED_ADMIN_URL: url }),
      ).toThrow(NodeRedError);
    },
  );
  it("stays off by default and refuses shared-demo deployments", () => {
    expect(nodeRedConfiguration({})).toBeNull();
    expect(() =>
      nodeRedConfiguration({ ...env, PUBLIC_DEMO_DEPLOYMENT: "true" }),
    ).toThrow(/private installation/);
    expect(() =>
      nodeRedConfiguration({ ...env, ENABLE_DEMO_ACCOUNTS: "true" }),
    ).toThrow(/private installation/);
  });
  it("does not follow redirects or expose the credential in public status", async () => {
    const runtime = runtimeFixture(),
      store = memoryStore();
    const service = new NodeRedPackageService(store, config, runtime.fetcher);
    const status = await service.status(7);
    expect(status.state).toBe("ready");
    expect(JSON.stringify(status)).not.toContain(env.NODE_RED_ADMIN_TOKEN);
    expect(JSON.stringify(status)).not.toContain("127.0.0.1");
    for (const { init } of runtime.calls) {
      expect(init.redirect).toBe("error");
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.headers).toMatchObject({
        Accept: "application/json",
        Authorization: "Bearer " + env.NODE_RED_ADMIN_TOKEN,
      });
    }
  });
  it("rejects a different runtime identity before a package request", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response("{}", {
          headers: {
            "content-type": "application/json",
            "x-smart-factory-node-red-runtime": randomUUID(),
          },
        }),
    );
    await expect(
      new NodeRedClient(config(), fetcher).checkRuntime(),
    ).rejects.toThrow(/enrolled Node-RED runtime/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("bounds streamed responses even without content-length", async () => {
    let cancelled = false;
    const body = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(600_000));
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetcher = vi.fn(
      async () =>
        new Response(body, {
          headers: {
            "content-type": "application/json",
            "x-smart-factory-node-red-runtime": env.NODE_RED_RUNTIME_ID,
          },
        }),
    );
    await expect(
      new NodeRedClient(config(), fetcher).checkRuntime(),
    ).rejects.toThrow(/size limit/);
    expect(cancelled).toBe(true);
  });
});

describe("Node-RED reviewed install and recovery", () => {
  it.each([false, true])(
    "reserves before one exact install and verifies node/plugin inventory (plugin-only=%s)",
    async (pluginOnly) => {
      const store = memoryStore(),
        runtime = runtimeFixture();
      runtime.pluginOnly = pluginOnly;
      const service = new NodeRedPackageService(store, config, runtime.fetcher);
      const { operation, request } = await start(service);
      expect(operation.state).toBe("installing");
      expect((await settled(store)).state).toBe("installed");
      expect(runtime.posts).toBe(1);
      const post = runtime.calls.find((call) => call.init.method === "POST")!;
      expect(post.url).toBe(env.NODE_RED_ADMIN_URL + "/nodes");
      expect(JSON.parse(String(post.init.body))).toEqual(selection);
      const registry = runtime.calls.find((call) =>
        call.url.startsWith("https://registry.npmjs.org/"),
      )!;
      expect(registry.init.headers).not.toHaveProperty("Authorization");
      const replay = await service.install(7, request);
      expect(replay.id).toBe(operation.id);
      expect(replay.state).toBe("installed");
      expect(runtime.posts).toBe(1);
      expect(JSON.stringify(replay)).not.toContain("/private/");
    },
  );
  it("binds the review to the administrator and target configuration", async () => {
    const store = memoryStore(),
      runtime = runtimeFixture();
    const service = new NodeRedPackageService(store, config, runtime.fetcher);
    const review = await service.review(7, selection);
    const request = {
      requestId: randomUUID(),
      reviewToken: review.reviewToken,
      acknowledgeCodeExecution: true as const,
    };
    await expect(service.install(8, request)).rejects.toThrow(
      /administrator and runtime/,
    );
    const changed = new NodeRedPackageService(
      store,
      () =>
        nodeRedConfiguration({
          ...env,
          NODE_RED_ADMIN_URL: "http://127.0.0.1:18881/admin",
        }),
      runtime.fetcher,
    );
    await expect(changed.install(7, request)).rejects.toThrow(
      /no longer matches/,
    );
    expect(runtime.posts).toBe(0);
    expect(store.claim).not.toHaveBeenCalled();
  });
  it("requires explicit acknowledgement and rejects expired or edited reviews", async () => {
    const store = memoryStore(),
      runtime = runtimeFixture();
    const service = new NodeRedPackageService(store, config, runtime.fetcher);
    const review = await service.review(7, selection);
    const request = {
      requestId: randomUUID(),
      reviewToken: review.reviewToken,
      acknowledgeCodeExecution: true as const,
    };
    await expect(
      service.install(7, {
        ...request,
        acknowledgeCodeExecution: false,
      } as never),
    ).rejects.toThrow();
    await expect(
      service.install(7, {
        ...request,
        reviewToken: review.reviewToken + "extra",
      }),
    ).rejects.toThrow(/invalid/);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 601_000);
    await expect(service.install(7, request)).rejects.toThrow(/expired/);
    expect(store.claim).not.toHaveBeenCalled();
  });
  it("does not upgrade a package that appeared after review", async () => {
    const store = memoryStore(),
      runtime = runtimeFixture();
    const service = new NodeRedPackageService(store, config, runtime.fetcher);
    const review = await service.review(7, selection);
    runtime.installed = true;
    runtime.wrongVersion = true;
    await service.install(7, {
      requestId: randomUUID(),
      reviewToken: review.reviewToken,
      acknowledgeCodeExecution: true,
    });
    expect((await settled(store)).state).toBe("failed");
    expect(runtime.posts).toBe(0);
  });
  it("keeps uncertainty after POST succeeds but authenticated read-back fails", async () => {
    const store = memoryStore(),
      runtime = runtimeFixture();
    runtime.failReadback = true;
    const service = new NodeRedPackageService(store, config, runtime.fetcher);
    const { request } = await start(service);
    const result = await settled(store);
    expect(runtime.posts).toBe(1);
    expect(result.state).toBe("unconfirmed");
    await expect(
      service.install(7, { ...request, requestId: randomUUID() }),
    ).rejects.toThrow(/pending or unconfirmed/);
    expect(JSON.stringify(result)).not.toContain("secret-value");
  });
  it("distinguishes an authoritative POST credential refusal from a lost response", async () => {
    for (const refusal of ["refused", "lost"] as const) {
      const store = memoryStore(),
        runtime = runtimeFixture();
      runtime.postFailure = refusal;
      const service = new NodeRedPackageService(store, config, runtime.fetcher);
      await start(service);
      expect((await settled(store)).state).toBe(
        refusal === "refused" ? "failed" : "unconfirmed",
      );
    }
  });
  it("retains a durable uncertain reservation across service restart and never replays on absence", async () => {
    const store = memoryStore(),
      runtime = runtimeFixture();
    runtime.postFailure = "lost";
    const original = new NodeRedPackageService(store, config, runtime.fetcher);
    const { operation, request } = await start(original);
    await settled(store);
    const restarted = new NodeRedPackageService(store, config, runtime.fetcher);
    expect((await restarted.status(7)).operation?.id).toBe(operation.id);
    expect((await restarted.reconcile(7))?.state).toBe("unconfirmed");
    await expect(
      restarted.install(7, { ...request, requestId: randomUUID() }),
    ).rejects.toThrow(/pending or unconfirmed/);
    expect(runtime.posts).toBe(1);
    runtime.installed = true;
    expect((await restarted.reconcile(7))?.state).toBe("installed");
    expect(runtime.posts).toBe(1);
  });
  it("preserves uncertainty when Node-RED reports a different installed version", async () => {
    const store = memoryStore(),
      runtime = runtimeFixture();
    runtime.wrongVersion = true;
    await start(new NodeRedPackageService(store, config, runtime.fetcher));
    expect((await settled(store)).state).toBe("unconfirmed");
  });
  it("stops before POST when the administrator loses authority after approval", async () => {
    const store = memoryStore(),
      runtime = runtimeFixture();
    const service = new NodeRedPackageService(store, config, runtime.fetcher);
    const review = await service.review(7, selection);
    vi.mocked(store.authorize).mockRejectedValue(
      new NodeRedError("Administrator access changed", true),
    );
    await service.install(7, {
      requestId: randomUUID(),
      reviewToken: review.reviewToken,
      acknowledgeCodeExecution: true,
    });
    expect((await settled(store)).state).toBe("failed");
    expect(runtime.posts).toBe(0);
  });
});
