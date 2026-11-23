import { describe, expect, it } from "vitest";
import { browserLogoutDestination } from "@/lib/api-auth";

const origin = "https://factory.onesa.eu";
const allowed = new URL("https://auth.onesa.eu/oidc/logout");
allowed.searchParams.set("client_id", "fixture-factory-web-client");
allowed.searchParams.set("post_logout_redirect_uri", origin + "/");

describe("Factory browser logout destination", () => {
  it("accepts the managed issuer and exact Factory return", () => {
    expect(browserLogoutDestination(allowed.href, origin)).toBe(allowed.href);
  });

  it.each([
    undefined,
    allowed.href.replace("auth.onesa.eu", "auth.example.test"),
    allowed.href.replace("/oidc/logout", "/authorize"),
    allowed.href.replace("factory.onesa.eu", "portal.onesa.eu"),
    allowed.href + "&id_token_hint=fixture",
    allowed.href + "#login",
  ])("rejects an unexpected provider handoff", (destination) => {
    expect(browserLogoutDestination(destination, origin)).toBeUndefined();
  });

  it("keeps provider logout off for other web hosts", () => {
    expect(browserLogoutDestination(allowed.href, "https://preview.example.test")).toBeUndefined();
  });
});
