import { expect, type JSHandle, type Page } from "@playwright/test";

const controlSelector =
  "button, a[href], input:not([type='hidden']), textarea, select, [role='button'], [role='link'], [role='combobox']";

export async function expectNamedControls(page: Page) {
  const controls = page.locator(controlSelector).filter({ visible: true });
  // Keep the actual nodes as well as their order. Live nth locators alone can
  // silently skip an unnamed control when a dynamic page reorders the list.
  const handles = await controls.elementHandles();
  let changes:
    | JSHandle<{ changed: () => boolean; disconnect: () => void }>
    | undefined;
  try {
    changes = await page.evaluateHandle(
      ({ expected, selector }) => {
        let changed = false;
        const containsControl = (node: Node) =>
          expected.some((element) => node.contains(element)) ||
          (node instanceof Element &&
            (node.matches(selector) || !!node.querySelector(selector)));
        const observe = (records: MutationRecord[]) => {
          for (const record of records) {
            if (
              record.type === "attributes"
                ? containsControl(record.target)
                : [...record.addedNodes, ...record.removedNodes].some(
                    containsControl,
                  )
            )
              changed = true;
          }
        };
        const observer = new MutationObserver(observe);
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: [
            "aria-hidden",
            "inert",
            "hidden",
            "style",
            "class",
            "role",
            "type",
            "href",
            "tabindex",
            "disabled",
          ],
        });
        return {
          changed: () => {
            observe(observer.takeRecords());
            return changed;
          },
          disconnect: () => observer.disconnect(),
        };
      },
      { expected: handles, selector: controlSelector },
    );
    const snapshot = await controls.evaluateAll((elements, expected) => {
      if (
        elements.length !== expected.length ||
        elements.some((element, index) => element !== expected[index])
      )
        return null;
      const localPath = (value: string | null) => {
        if (!value) return null;
        const url = new URL(value, location.href);
        return url.origin === location.origin
          ? (url.pathname + url.hash.split("?")[0]).slice(0, 160)
          : "<external>";
      };
      return elements.map((element) => ({
        context: {
          route: (location.pathname + location.hash.split("?")[0]).slice(
            0,
            160,
          ),
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute("role"),
          id: element.id.slice(0, 80),
          href: localPath(element.getAttribute("href")),
          children: Array.from(element.children)
            .slice(0, 5)
            .map((child) => child.tagName.toLowerCase()),
        },
        exposure: {
          inert: !!element.closest("[inert]"),
          hidden: !!element.closest('[aria-hidden="true"]'),
          tabbable:
            !element.matches(":disabled") &&
            (element as HTMLElement).tabIndex >= 0,
        },
      }));
    }, handles);
    if (!snapshot)
      throw new Error("Control list changed during the name audit");
    for (const [index, { context, exposure }] of snapshot.entries()) {
      if (exposure.inert) continue;
      if (exposure.hidden) {
        // aria-hidden does not remove a link/button from the keyboard tab order.
        // Such controls must fail, even though the accessibility tree hides them.
        expect(
          exposure.tabbable,
          `Hidden keyboard control: ${JSON.stringify(context)}`,
        ).toBe(false);
        continue;
      }
      // Offscreen focusable links (including Skip to main content) remain in the
      // audit; only actually hidden/inert controls are excluded above.
      // Use the browser accessibility name algorithm, including associated labels,
      // image alt text, SVG titles and visually hidden text, not innerText alone.
      // The outer document retry owns the bounded settling window. Unlike
      // locator.evaluate(), these checks never wait 30 seconds for a stale nth.
      await expect(
        controls.nth(index),
        `Named control: ${JSON.stringify(context)}`,
      ).toHaveAccessibleName(/\S/, { timeout: 1 });
    }
    // A replacement or reorder invalidates the pass even if every live nth
    // happened to resolve to a named neighbour. The outer retry takes a fresh
    // snapshot and must inspect the newly exposed control too.
    const final = await controls.evaluateAll(
      (elements, expected) => ({
        stable:
          elements.length === expected.length &&
          elements.every((element, index) => element === expected[index]),
        exposures: elements.map((element) => ({
          inert: !!element.closest("[inert]"),
          hidden: !!element.closest('[aria-hidden="true"]'),
          tabbable:
            !element.matches(":disabled") &&
            (element as HTMLElement).tabIndex >= 0,
        })),
      }),
      handles,
    );
    expect(final.stable, "Control list changed during the name audit").toBe(
      true,
    );
    expect(
      final.exposures,
      "Control exposure changed during the name audit",
    ).toEqual(snapshot.map(({ exposure }) => exposure));
    // Start/end equality is insufficient if a page moves a control away and
    // then restores the original order between semantic-name checks.
    expect(
      await changes.evaluate((guard) => guard.changed()),
      "Control list changed during the name audit",
    ).toBe(false);
  } finally {
    if (changes)
      await changes.evaluate((guard) => guard.disconnect()).catch(() => {});
    await Promise.allSettled([
      ...handles.map((handle) => handle.dispose()),
      ...(changes ? [changes.dispose()] : []),
    ]);
  }
}
