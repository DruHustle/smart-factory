import { safeSessionStorage } from "./storage";
import { resolveApiBase } from "./api-base";
import { safeReturnPath } from "@shared/onesa-return-path";
const api = resolveApiBase(import.meta.env.VITE_API_URL, import.meta.env.PROD);
// Local development simulations retain their disposable operator fixtures.
export const hostedWorkspace = !["localhost", "127.0.0.1", "[::1]"].includes(
  window.location.hostname,
);
export const portalSignIn = api + "/auth/onesa/account/login";
export const portalRegistration = api + "/auth/onesa/account/register";
export const portalSecurity = api + "/auth/onesa/account/security";
// Onesa Account owns credentials for all hosted product registrations.
export function identityRegistration(audience: "user" | "admin") {
  return "https://account.onesa.eu/register?audience=" + audience + "&product=factory&platform=web";
}
// Account recovery starts at the central managed sign-in screen.
// /account/recovery is an authenticated POST, not a public GET page.
export const identityRecovery = "https://account.onesa.eu/login";

const registrationKey = "onesa.product-registration";

export function rememberRegistration() {
  const hash = window.location.hash;
  const query = new URLSearchParams(hash.split("?")[1] || "");
  const route = safeReturnPath(query.get("returnTo") || hash);
  safeSessionStorage.setItem(registrationKey, route);
}

export function resumeRegistration() {
  if (window.location.hash !== "#/login?registration=complete") return false;
  const route = safeReturnPath(safeSessionStorage.getItem(registrationKey));
  safeSessionStorage.removeItem(registrationKey);
  history.replaceState(null, "", "#/login?returnTo=" + encodeURIComponent(route));
  return true;
}
