import { frontendFetch } from "./frontend-fetch";

export async function requireOnesaSignIn(
  origin: URL,
  fetcher: typeof fetch = frontendFetch,
) {
  const response = await fetcher(new URL("/api/auth/onesa/config", origin), {
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw Error(
      `Factory Onesa sign-in configuration returned HTTP ${response.status}`,
    );
  }
  const config = await response.json();
  if (config?.enabled !== true)
    throw Error("Factory Onesa sign-in is disabled");
  if (config.issuer !== "https://auth.onesa.eu/")
    throw Error("Factory release requires the canonical Onesa Auth0 issuer");
}
