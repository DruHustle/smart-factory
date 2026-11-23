import { describe, expect, it, vi } from "vitest";
import { requireOnesaSignIn } from "../scripts/require-onesa-sign-in";

const origin = new URL("https://factory.example");

describe("Factory release sign-in verification", () => {
  it("checks the same anonymous endpoint as the browser and accepts the canonical issuer", async () => {
    const read = vi.fn(async () =>
      Response.json({ enabled: true, issuer: "https://auth.onesa.eu/" }),
    );
    await expect(requireOnesaSignIn(origin, read)).resolves.toBeUndefined();
    expect(read).toHaveBeenCalledWith(
      new URL("/api/auth/onesa/config", origin),
      expect.objectContaining({
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
      }),
    );
  });

  it("rejects an older API revision that does not expose the sign-in route", async () => {
    const read = async () =>
      Response.json({ error: "Route not found" }, { status: 404 });
    await expect(requireOnesaSignIn(origin, read)).rejects.toThrow("HTTP 404");
  });

  it("rejects a deployed API with sign-in disabled", async () => {
    const read = async () => Response.json({ enabled: false });
    await expect(requireOnesaSignIn(origin, read)).rejects.toThrow(
      "sign-in is disabled",
    );
  });

  it.each([
    { enabled: true },
    { enabled: true, issuer: null },
    { enabled: true, issuer: "https://portal.onesa.eu/api/v1/identity" },
    { enabled: true, issuer: "https://auth.onesa.eu" },
  ])("rejects a release without the exact managed issuer (%o)", async (configuration) => {
    const read = async () => Response.json(configuration);
    await expect(requireOnesaSignIn(origin, read)).rejects.toThrow("issuer");
  });
});
