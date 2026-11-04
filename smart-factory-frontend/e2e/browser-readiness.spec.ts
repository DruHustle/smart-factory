import { expect, test } from "@playwright/test";
import { selectDataWorkspace, withRpcResult } from "./readiness-helpers";
import { expectNamedControls } from "./ui-audit-helpers";
import {
  expectAllFloorItems,
  floorItemSnapshot,
} from "./visual-workspace-helpers";

test("floor readiness observes both counts in the same render", async ({
  page,
}) => {
  await page.setContent(
    '<div data-testid="factory-floor" data-total-items="1" data-visible-items="1">Fixture floor</div>',
  );
  const floor = page.getByTestId("factory-floor");
  await floor.evaluate((element) => {
    const original = element.getAttribute.bind(element);
    element.getAttribute = (name) => {
      const value = original(name);
      if (name === "data-total-items") {
        // A render between protocol round trips changes both counts together.
        // The old separately awaited reads always compare N with N+1 here.
        queueMicrotask(() => {
          const next = String(Number(value) + 1);
          element.setAttribute("data-total-items", next);
          element.setAttribute("data-visible-items", next);
        });
      }
      return value;
    };
  });
  await expectAllFloorItems(floor);
  const snapshot = await floorItemSnapshot(floor);
  expect(snapshot.complete).toBe(true);
  expect(snapshot.total).toBe(snapshot.visible);
});

test("floor readiness refuses empty, absent and incomplete item counts", async ({
  page,
}) => {
  await page.setContent('<div data-testid="factory-floor">Fixture floor</div>');
  const floor = page.getByTestId("factory-floor");
  for (const [total, visible] of [
    [null, null],
    ["0", "0"],
    ["52", "51"],
    ["52", null],
  ] as const) {
    await floor.evaluate(
      (element, counts) => {
        for (const [name, value] of Object.entries(counts)) {
          if (value === null) element.removeAttribute(name);
          else element.setAttribute(name, value);
        }
      },
      { "data-total-items": total, "data-visible-items": visible },
    );
    expect(await floorItemSnapshot(floor)).toEqual({
      matches: 1,
      total,
      visible,
      complete: false,
    });
  }
  await floor.evaluate((element) => {
    element.setAttribute("data-total-items", "52");
    element.setAttribute("data-visible-items", "52");
  });
  await expectAllFloorItems(floor);
  await page.setContent(
    '<div data-testid="factory-floor" data-total-items="52" data-visible-items="52"></div>'.repeat(
      2,
    ),
  );
  expect(await floorItemSnapshot(floor)).toEqual({
    matches: 2,
    total: null,
    visible: null,
    complete: false,
  });
  await page.setContent("<main>No floor mounted</main>");
  expect(await floorItemSnapshot(floor)).toEqual({
    matches: 0,
    total: null,
    visible: null,
    complete: false,
  });
});

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test("workspace readiness waits for a new document and its scoped auth and data", async ({
  page,
}) => {
  const authStarted = gate(),
    auth = gate(),
    floorStarted = gate(),
    floor = gate();
  let documents = 0;
  await page.route("http://factory-readiness.test/**", async (route) => {
    const url = new URL(route.request().url());
    const cookie = (await route.request().allHeaders()).cookie ?? "";
    const workspace = cookie.includes("smart_factory_data_workspace=demo")
      ? "demo"
      : "live";
    if (url.pathname === "/api/trpc/auth.me") {
      if (workspace === "demo") {
        authStarted.release();
        await auth.promise;
      }
      await route.fulfill({
        json: {
          result: { data: { json: { access: { workspaceView: workspace } } } },
        },
      });
    } else if (url.pathname === "/api/trpc/factory.floor") {
      if (workspace === "demo") {
        floorStarted.release();
        await floor.promise;
      }
      await route.fulfill({
        json: { result: { data: { json: { items: [] } } } },
      });
    } else {
      documents++;
      await route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><body>
        <script>
          (async () => {
            const user = (await (await fetch('/api/trpc/auth.me')).json()).result.data.json;
            await (await fetch('/api/trpc/factory.floor')).json();
            document.body.innerHTML = '<main id="dashboard-main"><h1>Overview</h1><select aria-label="Data workspace"><option value="live">Live data</option><option value="demo">Demo data</option></select></main>';
            const select = document.querySelector('select');
            select.value = user.access.workspaceView;
            select.onchange = () => {
              select.disabled = true;
              document.cookie = 'smart_factory_data_workspace=' + select.value + '; Path=/; SameSite=Lax';
              location.reload();
            };
          })();
        </script></body></html>`,
      });
    }
  });
  await page.goto("http://factory-readiness.test/#/");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  let settled = false;
  const switched = selectDataWorkspace(page, "demo").then(() => {
    settled = true;
  });
  try {
    await authStarted.promise;
    expect(settled).toBe(false);
    expect(documents).toBe(2);
    auth.release();
    await floorStarted.promise;
    expect(settled).toBe(false);
    floor.release();
    await switched;
    const documentCount = documents;
    await selectDataWorkspace(page, "demo");
    expect(documents).toBe(documentCount);
  } finally {
    auth.release();
    floor.release();
    await switched;
  }
});

test("a successful neighboring batch result cannot hide the requested procedure's error", async ({
  page,
}) => {
  await page.route("http://factory-readiness.test/**", (route) => {
    if (new URL(route.request().url()).pathname.startsWith("/api/trpc/"))
      return route.fulfill({
        status: 207,
        json: [
          { result: { data: { json: { items: [] } } } },
          {
            error: {
              json: { message: "Fixture denied", data: { httpStatus: 403 } },
            },
          },
        ],
      });
    return route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><main>Fixture</main>",
    });
  });
  await page.goto("http://factory-readiness.test/");
  await expect(
    withRpcResult(page, "inventory.item", () =>
      page.evaluate(() =>
        fetch("/api/trpc/factory.floor,inventory.item?batch=1"),
      ),
    ),
  ).rejects.toThrow("inventory.item tRPC result");
});

test("the name audit admits image, SVG, label and screen-reader text semantics", async ({
  page,
}) => {
  await page.setContent(`<!doctype html>
    <a href="#image"><img alt="Open the floor image" width="20" height="20"></a>
    <a href="#svg"><svg width="20" height="20"><title>Open the diagram</title><rect width="20" height="20"/></svg></a>
    <label for="query">Search inventory</label><input id="query">
    <button><span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)">Refresh inventory</span><svg width="20" height="20"></svg></button>
    <div hidden><a href="#hidden"></a></div>
    <div aria-hidden="true"><a href="#not-exposed" tabindex="-1"><svg width="20" height="20"></svg></a></div>`);
  await expectNamedControls(page);
});

for (const label of [null, "   "]) {
  test(`the name audit rejects a visible empty icon link (${label === null ? "missing" : "blank"} label)`, async ({
    page,
  }) => {
    await page.route("http://factory-readiness.test/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><main><a id="empty-link" href="/#/inventory?private=must-not-appear" ${label === null ? "" : 'aria-label="   "'}><svg width="20" height="20"><rect width="20" height="20"/></svg></a></main>`,
      }),
    );
    await page.goto(
      "http://factory-readiness.test/#/monitoring?private=must-not-appear",
    );
    const failure = await expectNamedControls(page).then(
      () => "",
      (error: Error) => error.message,
    );
    expect(failure).toContain('"route":"/#/monitoring"');
    expect(failure).toContain('"href":"/#/inventory"');
    expect(failure).toContain('"id":"empty-link"');
    // The message's bounded context never includes query parameters. Playwright
    // may additionally print its locator, but no full DOM or response body.
    expect(failure.split("\n")[0]).not.toContain("must-not-appear");
  });
}

test("aria-hidden cannot conceal an unnamed keyboard-focusable link", async ({
  page,
}) => {
  await page.setContent(
    `<!doctype html><div aria-hidden="true"><a id="hidden-focus" href="#destination"><svg width="20" height="20"><rect width="20" height="20"/></svg></a></div>`,
  );
  await expect(expectNamedControls(page)).rejects.toThrow(
    "Hidden keyboard control",
  );
});

test("a control removed during the audit cannot strand a stale nth lookup", async ({
  page,
}) => {
  await page.setContent(
    '<!doctype html><a id="transient-control" href="#target">Named temporary control</a>',
  );
  await page.evaluate(() => {
    const control = document.querySelector<HTMLElement>("#transient-control")!;
    const getAttribute = control.getAttribute.bind(control);
    control.getAttribute = (name) => {
      const value = getAttribute(name);
      if (name === "role") queueMicrotask(() => control.remove());
      return value;
    };
  });
  await expect(async () => expectNamedControls(page)).toPass({
    timeout: 15000,
  });
  await expect(page.locator("#transient-control")).toHaveCount(0);
});

test("a transient reorder invalidates the audit before a fresh unnamed-control check", async ({
  page,
}) => {
  await page.setContent(`<!doctype html>
    <a id="moving-control" href="#move" aria-label="Named moving control"><svg width="20" height="20"></svg></a>
    <a id="unnamed-control" href="#empty" aria-label="Named before the negative check"><svg width="20" height="20"></svg></a>
    <button id="restoring-control" aria-label="Named final control">Named final control</button>`);
  // First isolate the transient-mutation guard from an earlier genuine name
  // failure. The second audit below still has to reject the unnamed anchor.
  await expectNamedControls(page);
  await page.evaluate(() => {
    const control = document.querySelector<HTMLElement>("#moving-control")!;
    const final = document.querySelector<HTMLElement>("#restoring-control")!;
    const unnamed = document.querySelector<HTMLElement>("#unnamed-control")!;
    const finalAttribute = final.getAttribute.bind(final);
    const orders: string[][] = [];
    (window as any).__auditReorderProof = orders;
    document.addEventListener(
      "fixture:reorder-and-restore",
      () => {
        document.body.append(control);
        orders.push(
          Array.from(document.body.children, (element) => element.id),
        );
        document.body.insertBefore(control, unnamed);
        orders.push(
          Array.from(document.body.children, (element) => element.id),
        );
      },
      { once: true },
    );
    final.getAttribute = (name) => {
      const value = finalAttribute(name);
      if (name === "role") {
        final.getAttribute = finalAttribute;
        // The helper reads role in its own metadata evaluation. The browser's
        // isolated accessible-name engine need not call a page-world override.
        // Run after that complete snapshot, while its observer is active.
        queueMicrotask(() =>
          document.dispatchEvent(new Event("fixture:reorder-and-restore")),
        );
      }
      return value;
    };
  });
  await expect(expectNamedControls(page)).rejects.toThrow(
    "Control list changed during the name audit",
  );
  expect(
    await page.evaluate(() => (window as any).__auditReorderProof),
  ).toEqual([
    ["unnamed-control", "restoring-control", "moving-control"],
    ["moving-control", "unnamed-control", "restoring-control"],
  ]);
  expect(
    await page
      .locator("body > a, body > button")
      .evaluateAll((elements) => elements.map((element) => element.id)),
  ).toEqual(["moving-control", "unnamed-control", "restoring-control"]);
  await page
    .locator("#unnamed-control")
    .evaluate((element) => element.removeAttribute("aria-label"));
  await expect(expectNamedControls(page)).rejects.toThrow(
    '"id":"unnamed-control"',
  );
});

test("removing inert exposure cannot hide an unnamed control from the audit", async ({
  page,
}) => {
  await page.setContent(`<!doctype html>
    <div id="inert-group" inert><a id="exposed-control" href="#empty"><svg width="20" height="20"></svg></a></div>
    <button id="exposer" aria-label="Named exposing control">Named exposing control</button>`);
  await expectNamedControls(page);
  await page.evaluate(() => {
    const control = document.querySelector<HTMLElement>("#exposer")!;
    const group = document.querySelector<HTMLElement>("#inert-group")!;
    const getAttribute = control.getAttribute.bind(control);
    const proof = {
      events: 0,
      before: group.hasAttribute("inert"),
      after: true,
    };
    (window as any).__auditExposureProof = proof;
    document.addEventListener(
      "fixture:expose-control",
      () => {
        group.removeAttribute("inert");
        proof.events++;
        proof.after = group.hasAttribute("inert");
      },
      { once: true },
    );
    control.getAttribute = (name) => {
      const value = getAttribute(name);
      if (name === "role") {
        control.getAttribute = getAttribute;
        queueMicrotask(() =>
          document.dispatchEvent(new Event("fixture:expose-control")),
        );
      }
      return value;
    };
  });
  await expect(expectNamedControls(page)).rejects.toThrow(
    "Control exposure changed during the name audit",
  );
  expect(
    await page.evaluate(() => (window as any).__auditExposureProof),
  ).toEqual({
    events: 1,
    before: true,
    after: false,
  });
  expect(
    await page
      .locator("#inert-group")
      .evaluate((element) => element.hasAttribute("inert")),
  ).toBe(false);
  await expect(expectNamedControls(page)).rejects.toThrow(
    '"id":"exposed-control"',
  );
});
