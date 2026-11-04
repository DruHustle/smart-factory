import { expect, type Page } from "@playwright/test";

const controlSelector =
  "button, a[href], input:not([type='hidden']), textarea, select, [role='button'], [role='link'], [role='combobox']";

export async function expectNamedControls(page: Page) {
  const controls = page.locator(controlSelector).filter({ visible: true });
  for (const control of await controls.all()) {
    const context = await control.evaluate((element) => {
      const localPath = (value: string | null) => {
        if (!value) return null;
        const url = new URL(value, location.href);
        return url.origin === location.origin
          ? (url.pathname + url.hash.split("?")[0]).slice(0, 160)
          : "<external>";
      };
      return {
        route: (location.pathname + location.hash.split("?")[0]).slice(0, 160),
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute("role"),
        id: element.id.slice(0, 80),
        href: localPath(element.getAttribute("href")),
        children: Array.from(element.children)
          .slice(0, 5)
          .map((child) => child.tagName.toLowerCase()),
      };
    });
    const exposure = await control.evaluate((element) => ({
      inert: !!element.closest("[inert]"),
      hidden: !!element.closest('[aria-hidden="true"]'),
      tabbable:
        !element.matches(":disabled") && (element as HTMLElement).tabIndex >= 0,
    }));
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
    // The outer document retry owns the bounded settling window.
    await expect(
      control,
      `Named control: ${JSON.stringify(context)}`,
    ).toHaveAccessibleName(/\S/, { timeout: 1 });
  }
}
