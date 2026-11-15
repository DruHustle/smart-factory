import { resolveApiBase } from "./api-base";
const api = resolveApiBase(import.meta.env.VITE_API_URL, import.meta.env.PROD);
// Local development simulations retain their disposable operator fixtures.
export const hostedWorkspace = !["localhost", "127.0.0.1", "[::1]"].includes(
  window.location.hostname,
);
export const portalSignIn = api + "/auth/onesa/account/login";
export const portalRegistration = api + "/auth/onesa/account/register";
export const portalSecurity = api + "/auth/onesa/account/security";
