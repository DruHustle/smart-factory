import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, getDb } from "../db";
import { disposableDatabase } from "../test/disposableDatabase";
import type { InstallOperation } from "../../shared/node-red";
import { postgresInstallStore } from "./store";

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "persistent Node-RED install reservations",
  () => {
    disposableDatabase("node_red_install");
    let actorId: number;
    beforeEach(async () => {
      const db = (await getDb())!;
      await db.execute(
        sql`delete from system_settings where key like 'node_red_%'`,
      );
      const [user] = await db.execute<{ id: number }>(
        sql`insert into users("openId",email,role) values(${randomUUID()},${randomUUID() + "@example.test"},'admin') returning id`,
      );
      actorId = user.id;
    });
    const operation = (
      runtimeId: string,
      id = randomUUID(),
    ): InstallOperation => ({
      id,
      runtimeId,
      targetRevision: "a".repeat(64),
      actorId,
      module: "node-red-contrib-synthetic",
      version: "1.2.3",
      state: "installing",
      message: "Reserved synthetic installation",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    it("admits only one reservation across concurrent database connections", async () => {
      const runtimeId = randomUUID();
      const outcomes = await Promise.allSettled(
        Array.from({ length: 8 }, () =>
          postgresInstallStore.claim(operation(runtimeId)),
        ),
      );
      expect(
        outcomes.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        outcomes.filter((result) => result.status === "rejected"),
      ).toHaveLength(7);
      expect((await postgresInstallStore.current(runtimeId))?.state).toBe(
        "installing",
      );
      const records = await (await getDb())!.execute(
        sql`select key from system_settings where key like 'node_red_%'`,
      );
      expect(records).toHaveLength(2);
    });
    it("deduplicates the same request and preserves its record after closing the pool", async () => {
      const reserved = operation(randomUUID());
      const results = await Promise.all(
        Array.from({ length: 6 }, () => postgresInstallStore.claim(reserved)),
      );
      expect(results.filter((result) => result.accepted)).toHaveLength(1);
      await closeDatabase();
      expect(await postgresInstallStore.current(reserved.runtimeId)).toEqual(
        reserved,
      );
      await expect(
        postgresInstallStore.claim(operation(reserved.runtimeId)),
      ).rejects.toThrow(/pending or unconfirmed/);
      expect((await postgresInstallStore.claim(reserved)).accepted).toBe(false);
    });
    it("keeps uncertain results locked, then preserves a verified reconciliation from late failure", async () => {
      const reserved = operation(randomUUID());
      await postgresInstallStore.claim(reserved);
      await postgresInstallStore.finish({ ...reserved, state: "unconfirmed" });
      await closeDatabase();
      await expect(
        postgresInstallStore.claim(operation(reserved.runtimeId)),
      ).rejects.toThrow(/pending or unconfirmed/);
      await postgresInstallStore.finish({ ...reserved, state: "installed" });
      expect(
        (
          await postgresInstallStore.finish({
            ...reserved,
            state: "unconfirmed",
          })
        ).state,
      ).toBe("installed");
      expect(
        (await postgresInstallStore.claim(operation(reserved.runtimeId)))
          .accepted,
      ).toBe(true);
    });
    it("refuses request ID reuse with a different actor, package or runtime", async () => {
      const reserved = operation(randomUUID());
      await postgresInstallStore.claim(reserved);
      await postgresInstallStore.finish({ ...reserved, state: "failed" });
      await expect(
        postgresInstallStore.claim({ ...reserved, version: "2.0.0" }),
      ).rejects.toThrow(/different installation/);
      await expect(
        postgresInstallStore.claim({ ...reserved, runtimeId: randomUUID() }),
      ).rejects.toThrow(/different installation/);
      const saved = await (await getDb())!.execute<{ value: InstallOperation }>(
        sql`select value from system_settings where key=${"node_red_operation:" + reserved.id}`,
      );
      expect(saved[0].value.version).toBe(reserved.version);
    });
    it("rechecks durable account authority before reserving or transmitting", async () => {
      await (await getDb())!.execute(
        sql`update users set role='engineer' where id=${actorId}`,
      );
      await expect(
        postgresInstallStore.claim(operation(randomUUID())),
      ).rejects.toThrow(/administrator account/);
      await expect(postgresInstallStore.authorize(actorId)).rejects.toThrow(
        /administrator account/,
      );
      await (await getDb())!.execute(
        sql`update users set role='admin',password_change_required=true where id=${actorId}`,
      );
      await expect(postgresInstallStore.authorize(actorId)).rejects.toThrow(
        /administrator account/,
      );
      await (await getDb())!.execute(
        sql`update users set password_change_required=false,disabled_at=now() where id=${actorId}`,
      );
      await expect(postgresInstallStore.authorize(actorId)).rejects.toThrow(
        /administrator account/,
      );
    });
  },
);
