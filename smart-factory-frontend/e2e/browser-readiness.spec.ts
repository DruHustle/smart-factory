import { expect, test } from "@playwright/test";
import { selectDataWorkspace, withRpcResult } from "./readiness-helpers";
import { expectNamedControls } from "./ui-audit-helpers";

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

test("reordering and restoring named neighbours cannot hide an unnamed control", async ({
  page,
}) => {
  await page.setContent(`<!doctype html>
    <a id="moving-control" href="#move" aria-label="Named moving control"><svg width="20" height="20"></svg></a>
    <a id="unnamed-control" href="#empty"><svg width="20" height="20"></svg></a>
    <button id="restoring-control" aria-label="Named final control">Named final control</button>`);
  await page.evaluate(() => {
    const control = document.querySelector<HTMLElement>("#moving-control")!;
    const final = document.querySelector<HTMLElement>("#restoring-control")!;
    const unnamed = document.querySelector<HTMLElement>("#unnamed-control")!;
    const getAttribute = control.getAttribute.bind(control);
    const finalAttribute = final.getAttribute.bind(final);
    let moved = false;
    control.getAttribute = (name) => {
      const value = getAttribute(name);
      if (name === "aria-label" && !moved) {
        moved = true;
        document.body.append(control);
      }
      return value;
    };
    final.getAttribute = (name) => {
      const value = finalAttribute(name);
      if (name === "aria-label" && moved)
        document.body.insertBefore(control, unnamed);
      return value;
    };
  });
  await expect(expectNamedControls(page)).rejects.toThrow(
    "Control list changed during the name audit",
  );
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
  await page.evaluate(() => {
    const control = document.querySelector<HTMLElement>("#exposer")!;
    const group = document.querySelector<HTMLElement>("#inert-group")!;
    const getAttribute = control.getAttribute.bind(control);
    control.getAttribute = (name) => {
      const value = getAttribute(name);
      if (name === "aria-label") group.removeAttribute("inert");
      return value;
    };
  });
  await expect(expectNamedControls(page)).rejects.toThrow(
    "Control exposure changed during the name audit",
  );
  await expect(expectNamedControls(page)).rejects.toThrow(
    '"id":"exposed-control"',
  );
});
