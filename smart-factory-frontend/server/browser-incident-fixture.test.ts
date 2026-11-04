import { afterEach, expect, it, vi } from "vitest";
import { withIncidentFixture } from "../e2e/incident-fixture";

const connect = vi.hoisted(() => vi.fn());
vi.mock("postgres", () => ({ default: connect }));
afterEach(() => {
  vi.unstubAllEnvs();
  connect.mockReset();
});

const database = "postgres://test:test@127.0.0.1:55432/factory_e2e";
function runner() {
  vi.stubEnv("SYSTEM_E2E", "true");
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("DATABASE_URL", database);
  vi.stubEnv("TEST_DATABASE_URL", database);
}
function storage(remove = true) {
  const queries: { text: string; values: unknown[] }[] = [];
  const end = vi.fn(async () => {});
  const query = Object.assign(
    vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
      const text = parts.join("?");
      queries.push({ text, values });
      if (text.includes("insert into alerts"))
        return [{ id: 17, deviceId: 9, message: values[0] }];
      if (text.includes("delete from alerts"))
        return remove ? [{ id: 17 }] : [];
      throw Error("Unexpected fixture SQL");
    }),
    { end },
  );
  connect.mockReturnValue(query);
  return { queries, end };
}

for (const [name, key, value] of [
  ["production", "NODE_ENV", "production"],
  ["no system runner", "SYSTEM_E2E", "false"],
  [
    "remote database",
    "DATABASE_URL",
    "postgres://test:test@example.test/factory_e2e",
  ],
  [
    "non-disposable database",
    "DATABASE_URL",
    "postgres://test:test@127.0.0.1/factory",
  ],
  ["alternate protocol", "DATABASE_URL", "https://127.0.0.1/factory_e2e"],
  ["connection options", "DATABASE_URL", database + "?host=example.test"],
  [
    "mismatched test database",
    "TEST_DATABASE_URL",
    database.replace("factory_e2e", "another_e2e"),
  ],
] as const) {
  it(`refuses ${name} before opening storage`, async () => {
    runner();
    vi.stubEnv(key, value);
    if (key === "DATABASE_URL") vi.stubEnv("TEST_DATABASE_URL", value);
    await expect(withIncidentFixture(async () => {})).rejects.toThrow(
      "explicit disposable local system runner",
    );
    expect(connect).not.toHaveBeenCalled();
  });
}

it("owns a fresh UUID marker and deletes only its exact incident after a failed browser step", async () => {
  runner();
  const { queries, end } = storage();
  const failed = Error("Synthetic browser step failed");
  await expect(
    withIncidentFixture(async (fixture) => {
      expect(fixture).toMatchObject({ id: 17, deviceId: 9 });
      expect(fixture.message).toMatch(/^E2E owned incident [a-f0-9-]{36}$/);
      throw failed;
    }),
  ).rejects.toBe(failed);
  expect(queries).toHaveLength(2);
  expect(queries[0].text).toContain(`"deviceId"='e2e-incident-source'`);
  expect(queries[1].text.replace(/\s+/g, " ")).toContain(
    'delete from alerts where id=? and "deviceId"=? and message=? and "errorCode"=\'SF-E2E-REVIEW\' returning id',
  );
  expect(queries[1].values).toEqual([17, 9, queries[0].values[0]]);
  expect(end).toHaveBeenCalledOnce();
});

it("does not report successful cleanup when the owned receipt no longer matches", async () => {
  runner();
  const { end } = storage(false);
  await expect(withIncidentFixture(async () => "done")).rejects.toThrow(
    "changed before cleanup",
  );
  expect(end).toHaveBeenCalledOnce();
});

it("does not reuse the previous attempt's fixture marker", async () => {
  runner();
  storage();
  const first = await withIncidentFixture(async (fixture) => fixture.message);
  const second = await withIncidentFixture(async (fixture) => fixture.message);
  expect(first).not.toBe(second);
});
