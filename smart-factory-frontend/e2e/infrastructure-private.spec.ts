import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { rpc, noOverflow } from "./visual-workspace-helpers";
test.skip(
  process.env.WORKSPACE_E2E !== "true",
  "Uses the individual-account disposable workspace",
);
async function login(page: Page, role: string) {
  await page.goto("/#/login");
  await page.getByLabel("Email").fill(`security-${role}@example.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Synthetic-security-only-2026!");
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible({ timeout: 15000 });
}
test("compatible older API rollback hides Node-RED management without issuing its requests", async ({
  page,
}) => {
  let managementRequests = 0;
  page.on("request", (request) => {
    if (
      request.url().includes("/api/trpc/") &&
      request.url().includes("nodeRed.")
    )
      managementRequests++;
  });
  await page.route("**/api/runtime/contract", async (route) => {
    const response = await route.fetch();
    const contract = await response.json();
    await route.fulfill({
      response,
      json: {
        ...contract,
        capabilities: contract.capabilities.filter(
          (capability: string) =>
            capability !== "node-red-package-management-v1",
        ),
      },
    });
  });
  await login(page, "admin");
  await page.goto("/#/administration/integrations");
  await expect(
    page.getByRole("heading", { name: "Administration", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Configured connection profiles", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Node-RED nodes, plugins & libraries", { exact: true }),
  ).toHaveCount(0);
  expect(managementRequests).toBe(0);
});
for (const role of ["viewer", "operator", "engineer"])
  test(`private ${role} cannot inspect installation infrastructure`, async ({
    page,
  }) => {
    await login(page, role);
    await expect(
      page.getByRole("link", { name: "Service health", exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await page.request.get(
          rpc("system.infrastructure", { range: "2h", scenario: "normal" }),
        )
      ).status(),
    ).toBe(403);
    expect(
      (await page.request.get("/api/trpc/system.operations")).status(),
    ).toBe(403);
    expect((await page.request.get("/api/trpc/nodeRed.status")).status()).toBe(
      403,
    );
    await page.goto("/#/infrastructure/service-health");
    await expect(
      page.getByText("Service health is restricted", { exact: true }),
    ).toBeVisible({ timeout: 15000 });
  });

test("administrator reviews an exact Node-RED package and retains an uncertain installation after reload", async ({
  page,
}) => {
  const target = {
    id: "8d70df1b-5722-4e7f-8dfc-e90cfa875a77",
    label: "Synthetic OT gateway",
    version: "4.1.4",
    revision: "a".repeat(64),
  };
  let operation: Record<string, unknown> | null = null;
  let installs = 0;
  const captured: Record<string, unknown>[] = [];
  // UI-only responses. Other batched procedures still use the real private
  // fixture API; no Node-RED management request is forwarded to a runtime.
  await page.route(/\/api\/trpc\/[^?]*nodeRed\./, async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const names = decodeURIComponent(url.pathname.split("/api/trpc/")[1]).split(
      ",",
    );
    const batched = url.searchParams.get("batch") === "1";
    const inputs = JSON.parse(
      url.searchParams.get("input") ?? request.postData() ?? "{}",
    );
    const others = names
      .map((name, index) => ({ name, index }))
      .filter(({ name }) => !name.startsWith("nodeRed."));
    const forwarded = new Map<number, unknown>();
    if (others.length) {
      const onlyOthers = new URL(url);
      onlyOthers.pathname =
        "/api/trpc/" + others.map(({ name }) => name).join(",");
      const remapped = Object.fromEntries(
        others.map(({ index }, next) => [next, inputs[index]]),
      );
      if (request.method() === "GET")
        onlyOthers.searchParams.set("input", JSON.stringify(remapped));
      const response = await route.fetch({
        url: onlyOthers.toString(),
        ...(request.method() === "POST"
          ? { postData: JSON.stringify(remapped) }
          : {}),
      });
      const body = await response.json();
      others.forEach(({ index }, next) => forwarded.set(index, body[next]));
    }
    const responses = names.map((name, index) => {
      if (!name.startsWith("nodeRed.")) return forwarded.get(index);
      const input = (batched ? inputs[index] : inputs)?.json;
      let data: unknown;
      if (name === "nodeRed.status")
        data = {
          state: "ready",
          message: "Connected to the enrolled synthetic runtime.",
          target,
          operation,
          packages:
            operation?.state === "installed"
              ? [
                  {
                    name: "node-red-contrib-fixture",
                    version: "1.2.3",
                    nodeSets: 1,
                    pluginSets: 0,
                    loadError: false,
                    pendingVersion: null,
                  },
                ]
              : [],
        };
      else if (name === "nodeRed.review")
        data = {
          ...input,
          target,
          description:
            "Synthetic node library for the browser interaction test.",
          nodeSets: ["fixture"],
          pluginSets: [],
          reviewToken: "synthetic-approved-review",
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        };
      else if (name === "nodeRed.install") {
        installs++;
        captured.push(input);
        operation = {
          id: input.requestId,
          runtimeId: target.id,
          targetRevision: target.revision,
          actorId: 1,
          module: "node-red-contrib-fixture",
          version: "1.2.3",
          state: "unconfirmed",
          message:
            "The installation response was lost. Check its outcome before another request.",
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        data = operation;
      } else if (name === "nodeRed.reconcile") {
        operation = {
          ...operation,
          state: "installed",
          message:
            "Read-back confirms the exact package version without reported errors.",
        };
        data = operation;
      } else throw Error("Unexpected Node-RED procedure " + name);
      return { result: { data: { json: data } } };
    });
    await route.fulfill({
      status: 200,
      json: batched ? responses : responses[0],
    });
  });
  await login(page, "admin");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/administration/integrations");
  await expect(
    page.getByText("Runtime connected", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("npm package name", { exact: true })
    .fill("node-red-contrib-fixture");
  await page.getByLabel("Exact version", { exact: true }).fill("1.2.3");
  await page
    .getByRole("button", { name: "Review package", exact: true })
    .click();
  const review = page.getByRole("region", { name: "Review Node-RED package" });
  await expect(review).toContainText(
    "node-red-contrib-fixture@1.2.3 → Synthetic OT gateway",
  );
  await expect(
    page.getByRole("button", { name: "Install approved version", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Exact version", { exact: true }).fill("1.2.4");
  await expect(review).toHaveCount(0);
  await page.getByLabel("Exact version", { exact: true }).fill("1.2.3");
  await page
    .getByRole("button", { name: "Review package", exact: true })
    .click();
  await review.getByRole("checkbox").check();
  await noOverflow(page);
  const directory =
    process.env.VISUAL_WORKSPACE_EVIDENCE_DIR ??
    "test-results/visual-workspaces";
  mkdirSync(directory, { recursive: true });
  await page.screenshot({
    path: `${directory}/node-red-package-review-390.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Install approved version", exact: true })
    .click();
  await expect(
    page.getByText("Outcome unconfirmed", { exact: true }),
  ).toBeVisible();
  expect(installs).toBe(1);
  expect(captured[0]).toMatchObject({
    acknowledgeCodeExecution: true,
    reviewToken: "synthetic-approved-review",
  });
  expect(Object.keys(captured[0]).sort()).toEqual([
    "acknowledgeCodeExecution",
    "requestId",
    "reviewToken",
  ]);
  await page.reload();
  await expect(
    page.getByText("Outcome unconfirmed", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review package", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Check installation outcome", exact: true })
    .click();
  await expect(
    page.getByText("Version verified", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Installed Node-RED packages" }),
  ).toContainText("node-red-contrib-fixture");
  expect(installs).toBe(1);
  await noOverflow(page);
});
test("individual administrator inspects real scoped process and database evidence without controls", async ({
  page,
}) => {
  await login(page, "admin");
  await page.getByRole("link", { name: "Service health", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Service health", exact: true }),
  ).toBeVisible();
  const response = await page.request.get(
    rpc("system.infrastructure", { range: "2h", scenario: "normal" }),
  );
  expect(response.ok()).toBe(true);
  const data = (await response.json()).result.data.json;
  expect(data.snapshot.synthetic).toBe(false);
  expect(data.snapshot.services.find((s: any) => s.id === "api").state).toBe(
    "healthy",
  );
  expect(
    data.snapshot.services.find((s: any) => s.id === "database").state,
  ).toBe("healthy");
  expect(
    data.snapshot.resources.find((s: any) => s.id === "api-rss").value,
  ).toBeGreaterThan(0);
  expect(
    data.snapshot.resources.find((s: any) => s.id === "host-memory").value,
  ).toBeNull();
  expect(JSON.stringify(data)).not.toContain("postgres://");
  expect(data.snapshot.recovery).toEqual([]);
  await page.getByRole("tab", { name: "Services", exact: true }).click();
  await page
    .getByRole("button", { name: /Application PostgreSQL.*Healthy/ })
    .click();
  await expect(
    page.getByRole("complementary", { name: "Service evidence" }),
  ).toContainText("QUERY_COMPLETED");
  await expect(
    page.getByRole("button", { name: /restart|purge|deploy/i }),
  ).toHaveCount(0);
  await noOverflow(page);
});
test("registration and role-filtered navigation retain mobile sizing, icons and keyboard access", async ({
  page,
}) => {
  await login(page, "admin");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/inventory");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await page.getByRole("button", { name: /IoT device A standalone/ }).click();
  await expect(page.getByLabel("Device ID", { exact: true })).toBeVisible();
  for (const field of await page.locator("[role=dialog] input:visible").all())
    expect(
      parseFloat(await field.evaluate((el) => getComputedStyle(el).fontSize)),
    ).toBeGreaterThanOrEqual(16);
  const dir =
    process.env.VISUAL_WORKSPACE_EVIDENCE_DIR ??
    "test-results/visual-workspaces";
  mkdirSync(dir, { recursive: true });
  await page.screenshot({
    path: `${dir}/registration-390-light.png`,
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await noOverflow(page);
  const trigger = page
    .getByRole("button", { name: "Toggle navigation", exact: true })
    .filter({ visible: true })
    .first();
  await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Service health", exact: true }),
  ).toBeVisible();
  for (const icon of await page
    .getByRole("dialog")
    .locator("svg[data-navigation-icon]")
    .all()) {
    const b = await icon.boundingBox();
    expect(b!.width).toBe(16);
    expect(b!.height).toBe(16);
    expect(await icon.getAttribute("stroke-width")).toBe("1.75");
  }
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});
