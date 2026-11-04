import { expect, type Page, type Response } from "@playwright/test";
import { requestedDataWorkspace } from "../shared/data-workspace";

function procedures(response: Response) {
  const url = new URL(response.url());
  if (!url.pathname.startsWith("/api/trpc/")) return [];
  try {
    return decodeURIComponent(url.pathname.slice("/api/trpc/".length)).split(
      ",",
    );
  } catch {
    return [];
  }
}

/** Observe the page's own request, including its complete body, before asserting
 * the rendered result. A separate API request cannot prove this page is ready. */
export async function withRpcResult(
  page: Page,
  procedure: string,
  action: () => Promise<unknown>,
  matches: (response: Response) => boolean | Promise<boolean> = () => true,
) {
  const origin =
    page.url() === "about:blank" ? undefined : new URL(page.url()).origin;
  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).origin ===
          (origin ?? new URL(page.url()).origin) &&
        candidate.request().frame() === page.mainFrame() &&
        procedures(candidate).includes(procedure) &&
        matches(candidate),
    ),
    action(),
  ]);
  expect(response.ok(), `${procedure} HTTP response`).toBe(true);
  expect(await response.finished(), `${procedure} response body`).toBeNull();
  const body = await response.json();
  const names = procedures(response);
  const batched = new URL(response.url()).searchParams.get("batch") === "1";
  expect(Array.isArray(body), `${procedure} batch shape`).toBe(batched);
  if (batched)
    expect(body, `${procedure} batch length`).toHaveLength(names.length);
  const result = Array.isArray(body) ? body[names.indexOf(procedure)] : body;
  expect(result, `${procedure} tRPC result`).toHaveProperty("result.data.json");
  expect(result).not.toHaveProperty("error");
  return result.result.data.json;
}

/** The initial Overview query starts only after login and its lazy route load.
 * Keep the existing UI assertions after this authenticated data-delivery gate. */
export async function signInToOverview(page: Page, email: string) {
  let user: { email: string } | undefined;
  await withRpcResult(page, "factory.floor", async () => {
    const result = await withRpcResult(page, "auth.login", () =>
      page.getByRole("button", { name: /^sign in$/i }).click(),
    );
    user = result.user;
  });
  expect(user?.email).toBe(email);
  await expect(page.locator("#dashboard-main")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
}

/** Selecting a different workspace invalidates the document and all protected
 * caches. Register both reload and new auth/data observers before the selection;
 * the old select value (or a cancelled request) cannot establish readiness. */
export async function selectDataWorkspace(page: Page, target: "demo" | "live") {
  const workspace = page.getByRole("combobox", {
    name: "Data workspace",
    exact: true,
  });
  await expect(workspace).toBeVisible();
  if ((await workspace.inputValue()) !== target) {
    const previousDocument = await page.evaluate(() => performance.timeOrigin);
    const inWorkspace = async (response: Response) =>
      requestedDataWorkspace(
        (await response.request().allHeaders()).cookie ?? "",
      ) === target;
    let user: { access?: { workspaceView?: string } } | undefined;
    await withRpcResult(
      page,
      "factory.floor",
      async () => {
        user = await withRpcResult(
          page,
          "auth.me",
          () =>
            Promise.all([
              page.waitForEvent("load"),
              workspace.selectOption(target),
            ]),
          inWorkspace,
        );
      },
      inWorkspace,
    );
    expect(await page.evaluate(() => performance.timeOrigin)).not.toBe(
      previousDocument,
    );
    expect(user?.access?.workspaceView).toBe(target);
  }
  await expect(page.locator("#dashboard-main")).toBeVisible();
  await expect(workspace).toHaveValue(target);
  await expect(workspace).toBeEnabled();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
}
