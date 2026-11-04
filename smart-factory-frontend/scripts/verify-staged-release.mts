import { promotionCompatibility, releaseIdentityCompatibility } from "../shared/runtime-contract";
import { migrationManifest } from "../server/runtimeContract";
import { verifyIndustrialRelease } from "./industrial-release";

const origin = new URL(process.env.STAGED_ORIGIN ?? "");
const revision = process.env.RELEASE_SHA ?? "";
if (
  origin.protocol !== "https:" ||
  !/^[a-z0-9-]+\.vercel\.app$/.test(origin.hostname) ||
  origin.port || origin.username || origin.password ||
  origin.pathname !== "/" || origin.search || origin.hash ||
  revision.length !== 40 || !/^[a-f0-9]{40}$/.test(revision)
) throw Error("An exact staged Vercel origin and immutable revision are required");

// Protection stays enabled. Send the owner-configured bypass only to this exact
// validated deployment origin, never through redirects or to the API origin.
const checkedFetch: typeof fetch = async (input, init) => {
  const target = new URL(input instanceof Request ? input.url : String(input));
  if (target.origin !== origin.origin || target.username || target.password ||
      (init?.method ?? "GET").toUpperCase() !== "GET" || init?.body != null)
    throw Error("Staged verification permits same-origin read-only requests only");
  const headers = new Headers(init?.headers);
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) headers.set("x-vercel-protection-bypass", bypass);
  return fetch(target, { ...init, headers, credentials: "omit", redirect: "error",
    signal: AbortSignal.timeout(20000), cache: "no-store" });
};

async function json(path: string): Promise<unknown> {
  const response = await checkedFetch(new URL(path, origin));
  if (!response.ok || !response.body) throw Error("Staged release metadata is unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 1024 * 1024) throw Error("Staged metadata exceeds its size limit");
      chunks.push(next.value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
for (const path of ["/", "/health/ready"]) {
  const response = await checkedFetch(new URL(path, origin));
  await response.body?.cancel();
  if (response.status !== 200) throw Error(`Staged ${path} is not ready`);
}
const releaseError = releaseIdentityCompatibility(await json("/release.json"), revision);
if (releaseError) throw Error(releaseError);
const schema = await migrationManifest();
const runtimeError = promotionCompatibility(await json("/api/runtime/contract"), {
  source: revision, backend: revision, edge: revision, schemaDigest: schema.digest,
});
if (runtimeError) throw Error(runtimeError);
const assets = await verifyIndustrialRelease(origin, checkedFetch);
console.log(JSON.stringify({ stagedOrigin: origin.origin, revision, verifiedAssets: assets.length }));
