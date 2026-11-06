import { sql } from "drizzle-orm";
import { getDb } from "../db";
import type { ApplicationDatabase } from "../database-scope";
import {
  installOperation,
  pendingInstall,
  type InstallOperation,
} from "../../shared/node-red";
import { NodeRedError } from "./configuration";
import { sharedDemoIdentity } from "../../shared/access-policy";

export interface InstallStore {
  current(runtimeId: string): Promise<InstallOperation | null>;
  claim(
    operation: InstallOperation,
  ): Promise<{ operation: InstallOperation; accepted: boolean }>;
  finish(operation: InstallOperation): Promise<InstallOperation>;
  authorize(actorId: number): Promise<void>;
}
const currentKey = (id: string) => `node_red_runtime:${id}`;
const operationKey = (id: string) => `node_red_operation:${id}`;
async function database() {
  const db = await getDb();
  if (!db)
    throw new NodeRedError(
      "Persistent installation status is unavailable. No package installation has been started.",
    );
  return db;
}
async function read(
  db: ApplicationDatabase,
  key: string,
): Promise<InstallOperation | null> {
  const [row] = await db.execute<{ value: unknown }>(
    sql`select value from system_settings where key=${key}`,
  );
  if (!row) return null;
  const result = installOperation.safeParse(row.value);
  if (!result.success)
    throw new NodeRedError(
      "The saved Node-RED operation needs an administrator's review before further installs.",
    );
  return result.data;
}
async function authorize(db: ApplicationDatabase, actorId: number) {
  const [user] = await db.execute<{ openId: string; email: string | null }>(
    sql`select "openId",email from users where id=${actorId} and role='admin' and disabled_at is null and password_change_required=false`,
  );
  if (!user || sharedDemoIdentity(user))
    throw new NodeRedError(
      "An active individual administrator account is required to install Node-RED packages.",
      true,
    );
}
async function save(db: ApplicationDatabase, operation: InstallOperation) {
  // Existing JSONB settings storage keeps the reservation durable without a
  // long-lived database transaction around npm/network I/O.
  for (const key of [
    currentKey(operation.runtimeId),
    operationKey(operation.id),
  ])
    await db.execute(
      sql`insert into system_settings(key,value,"updatedBy","updatedAt") values(${key},${JSON.stringify(operation)}::jsonb,${operation.actorId},now()) on conflict(key) do update set value=excluded.value,"updatedBy"=excluded."updatedBy","updatedAt"=excluded."updatedAt"`,
    );
}
export const postgresInstallStore: InstallStore = {
  async current(runtimeId) {
    return read(await database(), currentKey(runtimeId));
  },
  async authorize(actorId) {
    await authorize(await database(), actorId);
  },
  async claim(operation) {
    return (await database()).transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout='3000ms'`);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${currentKey(operation.runtimeId)},0))`,
      );
      await authorize(tx, operation.actorId);
      const previous = await read(tx, operationKey(operation.id));
      if (previous) {
        if (
          ["runtimeId", "targetRevision", "actorId", "module", "version"].some(
            (key) =>
              previous[key as keyof InstallOperation] !==
              operation[key as keyof InstallOperation],
          )
        )
          throw new NodeRedError(
            "This request identifier belongs to a different installation request.",
            true,
          );
        return { operation: previous, accepted: false };
      }
      const current = await read(tx, currentKey(operation.runtimeId));
      if (pendingInstall(current))
        throw new NodeRedError(
          "An installation for this runtime is pending or unconfirmed. Check its outcome before requesting another package.",
          true,
        );
      // Insert the unique request before replacing the runtime slot. A reused ID
      // on a different runtime cannot overwrite its original audit record.
      await tx.execute(
        sql`insert into system_settings(key,value,"updatedBy") values(${operationKey(operation.id)},${JSON.stringify(operation)}::jsonb,${operation.actorId})`,
      );
      await save(tx, operation);
      return { operation, accepted: true };
    });
  },
  async finish(operation) {
    return (await database()).transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout='3000ms'`);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${currentKey(operation.runtimeId)},0))`,
      );
      const current = await read(tx, currentKey(operation.runtimeId));
      if (!current || current.id !== operation.id)
        throw new NodeRedError(
          "The active installation changed. Refresh its saved status.",
        );
      // A late network failure cannot undo a verified read-back reconciliation.
      if (!pendingInstall(current)) return current;
      await save(tx, operation);
      return operation;
    });
  },
};
