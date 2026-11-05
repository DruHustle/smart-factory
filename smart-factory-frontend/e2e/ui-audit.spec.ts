import { navigate } from "./workspace-helpers";
import { expect, type BrowserContext, type Page, test } from "@playwright/test";
import { signInToOverview, withRpcResult } from "./readiness-helpers";
import { expectNamedControls } from "./ui-audit-helpers";

async function loginAs(page: Page, role: "admin" | "engineer" | "viewer") {
  await page.goto("/#/login");
  await page.getByLabel("Email").fill(`security-${role}@example.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Synthetic-security-only-2026!");
  await signInToOverview(page, `security-${role}@example.test`);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
}

async function expectSoundDocumentStructure(page: Page) {
  // The connection screen also has an h1; audit the actual page landmark.
  await expect(page.locator("main h1").first()).toBeVisible({ timeout: 15000 });
  // A navigation refresh may replace the landmark after the visibility check.
  await expect(async () => {
    const audit = await page.evaluate(() => {
      const duplicateIds = Array.from(
        document.querySelectorAll<HTMLElement>("[id]"),
      )
        .map((element) => element.id)
        .filter((id, index, ids) => id && ids.indexOf(id) !== index);

      return {
        duplicateIds: [...new Set(duplicateIds)],
        mainCount: document.querySelectorAll("main").length,
        h1Count: document.querySelectorAll("h1").length,
        horizontalOverflow:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      };
    });

    expect(audit.duplicateIds).toEqual([]);
    await expectNamedControls(page);
    expect(audit.mainCount).toBe(1);
    expect(audit.h1Count).toBeGreaterThanOrEqual(1);
    expect(audit.horizontalOverflow).toBeLessThanOrEqual(1);
  }).toPass({ timeout: 15000 });
}

test("signed-out controls and password visibility expose sound semantics", async ({
  page,
}) => {
  await page.goto("/#/login");
  await expect(
    page.getByRole("heading", { name: "Smart Factory" }),
  ).toBeVisible();
  await expectSoundDocumentStructure(page);
  const password = page.locator("#password");
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    const toggle = page.getByRole("button", { name: "Show password" });
    await toggle.click({ trial: true });
    const box = await toggle.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    const inputBox = await password.boundingBox();
    expect(inputBox!.height).toBeGreaterThanOrEqual(44);
    // A tap outside the centered icon must still activate the control.
    await toggle.click({ position: { x: box!.width - 4, y: box!.height / 2 } });
    await expect(password).toHaveAttribute("type", "text");
    const hide = page.getByRole("button", { name: "Hide password" });
    await expect(hide).toHaveAttribute("aria-pressed", "true");
    await hide.focus();
    await page.keyboard.press("Space");
    await expect(password).toHaveAttribute("type", "password");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
  }
});

const routes = [
  ["/", "Overview"],
  ["/monitoring", "Monitoring"],
  ["/devices", "Assets & devices"],
  ["/assets", "Assets & devices"],
  ["/alerts", "Alerts"],
  ["/notifications", "Notifications"],
  ["/analytics", "Analytics"],
  ["/assistant", "Assistant"],
] as const;

test.describe("authenticated route audit", () => {
  let state: Awaited<ReturnType<BrowserContext["storageState"]>>;
  test.beforeAll(async ({ browser, baseURL }) => {
    // Authenticate once through the real UI; each route receives a separate
    // browser context. No rate-limit reset, bypass or shared page state.
    const context = await browser.newContext({ baseURL });
    try {
      await loginAs(await context.newPage(), "viewer");
      state = await context.storageState();
    } finally {
      await context.close();
    }
  });
  test.use({
    storageState: async ({}, use) => {
      await use(state);
    },
  });

  for (const width of [1440, 390]) {
    for (const [route, heading] of routes) {
      test(`${route} has named controls and sound landmarks at ${width}px`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 844 });
        const user = await withRpcResult(page, "auth.me", () =>
          page.goto(`/#${route}`),
        );
        expect(user?.email).toBe("security-viewer@example.test");
        await expect(page.locator("#dashboard-main")).toBeVisible();
        await expect(
          page.getByRole("heading", { name: heading, exact: true }),
        ).toBeVisible();
        await expectSoundDocumentStructure(page);
      });
    }
  }

  test("legacy inventory selection and keyboard sidebar resizing remain accessible", async ({
    page,
  }) => {
    await page.goto("/#/devices");
    await expect(
      page.getByRole("heading", { name: "Assets & devices", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Assets & devices", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    const resizer = page.getByRole("separator", { name: "Resize navigation" });
    const originalWidth = Number(await resizer.getAttribute("aria-valuenow"));
    await resizer.focus();
    await page.keyboard.press("ArrowRight");
    await expect(resizer).toHaveAttribute(
      "aria-valuenow",
      String(
        Math.min(
          Number(await resizer.getAttribute("aria-valuemax")),
          originalWidth + 10,
        ),
      ),
    );
  });

  test("the mobile navigation drawer opens the selected destination", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#/assistant");
    await expect(
      page.getByRole("heading", { name: "Assistant", exact: true }),
    ).toBeVisible();
    const menu = page
      .getByRole("button", { name: "Toggle navigation", exact: true })
      .filter({ visible: true })
      .first();
    await menu.click();
    await expect(
      page.getByRole("link", { name: "Monitoring", exact: true }),
    ).toBeVisible();
    await navigate(page, "Monitoring");
    await expect(
      page.getByRole("heading", { name: "Monitoring", exact: true }),
    ).toBeVisible();
  });
});
