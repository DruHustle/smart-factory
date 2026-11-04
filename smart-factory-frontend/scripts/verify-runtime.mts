import { readFile, writeFile } from "node:fs/promises";
import { promotionCompatibility } from "../shared/runtime-contract";
import { migrationManifest } from "../server/runtimeContract";
import { frontendFetch } from "./frontend-fetch";
import { expectedSources } from "./expected-sources.mts";
const origin = new URL(process.env.API_ORIGIN ?? "");
if (
  origin.protocol !== "https:" ||
  origin.username ||
  origin.password ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash
)
  throw Error("API_ORIGIN must be a plain HTTPS origin");
const response = await frontendFetch(new URL("/api/runtime/contract", origin), {
  redirect: "error",
  signal: AbortSignal.timeout(10000),
  cache: "no-store",
});
if (!response.ok) throw Error("API runtime contract is unavailable");
const contract = await response.json();
const expected = await migrationManifest();
const sources = expectedSources(
  process.env.QUALIFICATION_LAYOUT,
  process.env.EXPECTED_API_SOURCE,
  JSON.parse(await readFile("deploy/qualification-sources.json", "utf8")),
);
const error = promotionCompatibility(contract, {
  schemaDigest: expected.digest,
  ...sources,
  source: process.env.EXPECTED_API_SOURCE,
});
if (error) throw Error(error);
if (process.env.RUNTIME_EVIDENCE_FILE)
  await writeFile(
    process.env.RUNTIME_EVIDENCE_FILE,
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        origin: origin.origin,
        ...contract,
      },
      null,
      2,
    ) + "\n",
  );
console.log(
  `Compatible runtime: API ${contract.source}, backend ${contract.backendSource}, edge ${contract.edgeSource}; schema ${contract.schema.revision}`,
);
