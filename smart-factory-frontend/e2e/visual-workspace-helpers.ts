import { expect, type Locator, type Page } from "@playwright/test";
import { resetDemoViewerFixtureLoginLimit } from "./fixture-auth";

export async function floorItemSnapshot(floor: Locator) {
  // Both attributes describe one render. Separate awaited browser calls can
  // observe different renders, especially while software-GPU work is queued.
  // Query and sample together, without a nested locator wait when a render
  // replaces the node. Missing or duplicate floors remain an incomplete result.
  return floor.evaluateAll((elements) => {
    const element = elements.length === 1 ? elements[0] : undefined;
    const total = element?.getAttribute("data-total-items") ?? null,
      visible = element?.getAttribute("data-visible-items") ?? null;
    return {
      matches: elements.length,
      total,
      visible,
      complete: Number(total) > 0 && Number(total) === Number(visible),
    };
  });
}

export async function expectAllFloorItems(floor: Locator) {
  await expect
    .poll(async () => {
      const snapshot = await floorItemSnapshot(floor);
      // Keep the observed counts in a failed assertion, rather than only false.
      return snapshot.complete ? "ready" : JSON.stringify(snapshot);
    })
    .toBe("ready");
}

export async function enterSimulation(
  page: Page,
  width = 1440,
  theme = "light",
) {
  await resetDemoViewerFixtureLoginLimit();
  await page.setViewportSize({ width, height: 960 });
  await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
  await page.goto("/#/login");
  await page.getByRole("button", { name: "Viewer", exact: true }).click();
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  // Inventory types now live in the Factory Floor's dedicated Inventory view.
  await expect(
    page.getByRole("button", { name: "Factory Inventory", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Factory floor overview", exact: true }),
  ).toBeVisible();
  const floor = page.getByTestId("factory-floor");
  await expect(floor).toBeVisible();
  await expectAllFloorItems(floor);
  return (await (await page.request.get("/api/trpc/system.showcase")).json())
    .result.data.json;
}
export const rpc = (name: string, input: unknown) =>
  "/api/trpc/" +
  name +
  "?input=" +
  encodeURIComponent(JSON.stringify({ json: input }));
export async function noOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
}
