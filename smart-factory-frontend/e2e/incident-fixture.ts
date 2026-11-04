import { randomUUID } from "node:crypto";
import postgres from "postgres";

export type IncidentFixture = { id: number; deviceId: number; message: string };

/** Each attempt owns one incident. All role decisions and mutations still go
 * through the real authenticated UI/API; this helper only prepares disposable
 * records and removes its exact receipt after the attempt, including failures. */
export async function withIncidentFixture<T>(
  use: (fixture: IncidentFixture) => Promise<T>,
) {
  const raw = process.env.DATABASE_URL;
  const url = new URL(raw ?? "http://invalid");
  if (
    process.env.SYSTEM_E2E !== "true" ||
    process.env.NODE_ENV !== "development" ||
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    !url.pathname.endsWith("_e2e") ||
    url.search ||
    url.hash ||
    process.env.TEST_DATABASE_URL !== raw
  )
    throw Error(
      "Incident fixtures require the explicit disposable local system runner.",
    );
  const connection = postgres(url.toString(), {
    max: 1,
    connect_timeout: 5,
    ssl: false,
  });
  const message = "E2E owned incident " + randomUUID();
  let fixture: IncidentFixture | undefined;
  try {
    const rows = await connection<IncidentFixture[]>`
      insert into alerts ("deviceId", type, severity, message, "errorCode")
      select id, 'system_error', 'warning', ${message}, 'SF-E2E-REVIEW'
      from devices where "deviceId"='e2e-incident-source'
        and name='E2E incident source' and type='sensor' and "isDemo"=false
      returning id, "deviceId", message`;
    if (
      rows.length !== 1 ||
      !Number.isSafeInteger(rows[0].id) ||
      rows[0].id <= 0
    )
      throw Error(
        "The system runner's incident source fixture is unavailable.",
      );
    fixture = rows[0];
    return await use(fixture);
  } finally {
    try {
      if (fixture) {
        // Existing foreign keys cascade only this incident's actions, activity
        // and notification rows. No shared counters or other incidents change.
        const removed = await connection`
          delete from alerts where id=${fixture.id} and "deviceId"=${fixture.deviceId}
            and message=${message} and "errorCode"='SF-E2E-REVIEW' returning id`;
        if (removed.length !== 1 || removed[0].id !== fixture.id)
          throw Error("The owned incident fixture changed before cleanup.");
      }
    } finally {
      await connection.end({ timeout: 5 });
    }
  }
}
