import { test, expect, request } from "@playwright/test";
for (const role of ["Admin", "Engineer", "Operator", "Viewer"]) {
  test(`shared ${role} sees only approved fixtures and cannot mutate any operational domain`, async ({
    page,
  }) => {
    await page.goto("/#/login");
    await page.getByRole("button", { name: role, exact: true }).click();
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    const me = await page.request.get("/api/trpc/auth.me");
    expect((await me.json()).result.data.json.access).toMatchObject({
      demoOnly: true,
      canOperate: false,
      canEngineer: false,
      canAdminister: false,
    });
    await expect(
      page.getByRole("combobox", { name: "Data workspace", exact: true }),
    ).toHaveValue("demo");
    await expect(
      page
        .getByRole("combobox", { name: "Data workspace", exact: true })
        .locator('option[value="live"]'),
    ).toBeDisabled();
    // Forge the scope on a separate HTTP client, not in the active page's
    // cookie jar: the page correctly reloads when its own scope changes.
    const state = await page.context().storageState();
    const origin = new URL(page.url());
    state.cookies = state.cookies.filter(
      (cookie) => cookie.name !== "smart_factory_data_workspace",
    );
    state.cookies.push({
      name: "smart_factory_data_workspace",
      value: "live",
      domain: origin.hostname,
      path: "/",
      expires: -1,
      httpOnly: false,
      secure: origin.protocol === "https:",
      sameSite: "Lax",
    });
    const forged = await request.newContext({
      baseURL: origin.origin,
      storageState: state,
    });
    try {
      const inventory = await forged.get(
        "/api/trpc/inventory.list?input=" +
          encodeURIComponent(
            JSON.stringify({ json: { page: 0, pageSize: 50 } }),
          ),
      );
      const items = (await inventory.json()).result.data.json.items;
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((i: any) => i.isDemo === true)).toBe(true);
      expect(JSON.stringify(items)).not.toContain("Workspace imported asset");
      for (const procedure of [
        "devices.create",
        "devices.update",
        "devices.delete",
        "devices.pulseIndicator",
        "assets.create",
        "assets.update",
        "assets.delete",
        "assets.controlAda031",
        "assets.publishGatewayConfiguration",
        "assets.publishPassport",
        "thresholds.upsert",
        "alerts.assign",
        "alerts.resolve",
        "users.create",
        "users.setRole",
        "users.setEnabled",
        "system.setDemoData",
        "readings.create",
        "equipment.create",
        "security.createSource",
        "notifications.retryEmail",
      ]) {
        const denied = await forged.post("/api/trpc/" + procedure, {
          data: { json: {} },
        });
        expect(denied.status(), procedure).toBe(403);
      }
      for (const path of [
        "/api/aas/shells",
        "/api/onesa/artifacts/equipment.json",
        "/api/trpc/users.list",
        "/api/trpc/system.operations",
      ])
        expect((await forged.get(path)).status(), path).toBe(403);
      const raw = await forged.post("/api/assets/import", {
        multipart: {
          file: {
            name: "blocked.aasx",
            mimeType: "application/aas+zip",
            buffer: Buffer.from("PKsynthetic"),
          },
        },
      });
      expect(raw.status()).toBe(403);
    } finally {
      await forged.dispose();
    }
    // Reload the untouched page to verify its demo scope survives navigation.
    await page.reload();
    await expect(
      page.getByRole("combobox", { name: "Data workspace", exact: true }),
    ).toHaveValue("demo");
    await page.goto("/#/inventory");
    await expect(
      page.getByRole("button", { name: "Add item", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Administration", exact: true }),
    ).toBeVisible();
    await page.goto("/#/assistant");
    await page
      .getByLabel("Ask the Smart Factory Assistant")
      .fill("How many assets are visible in this workspace?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(
      page.getByTestId("assistant-answer-content").first(),
    ).toBeVisible();
    await expect(
      page.getByTestId("assistant-answer-content").first(),
    ).not.toContainText("Workspace imported asset");
  });
}
