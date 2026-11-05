import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { disposableDatabase } from "../test/disposableDatabase";
import { database } from "./store";
import { filters, posture } from "./service";

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "security posture identity scope",
  () => {
    disposableDatabase("security_posture");
    beforeAll(async () => {
      const db = await database();
      await db.execute(
        sql`insert into devices(id,"deviceId",name,type,"isDemo") values (1,'scope-live','Live scoped device','sensor',false),(2,'scope-other','Other device','sensor',false),(3,'scope-demo','Demo device','sensor',true)`,
      );
      await db.execute(
        sql`insert into assets(id,"assetId",name,"assetType","isDemo","aasShell") values (1,'scope-asset','Same numeric ID asset','pump',false,'{}'::json)`,
      );
    });
    it("returns only the requested typed identity, including before the inventory limit", async () => {
      const result = await posture(
        false,
        false,
        filters.parse({ targetKind: "device", targetId: 1 }),
      );
      expect(result.items.map((i) => [i.kind, i.id, i.name])).toEqual([
        ["device", 1, "Live scoped device"],
      ]);
      expect(result.items[0].observations).toEqual([]);
    });
    it("does not confuse an asset and device with the same numeric ID", async () => {
      const result = await posture(
        false,
        false,
        filters.parse({ targetKind: "asset", targetId: 1 }),
      );
      expect(result.items.map((i) => i.name)).toEqual([
        "Same numeric ID asset",
      ]);
    });
    it("preserves demo isolation even with an explicit live target", async () => {
      expect(
        (
          await posture(
            true,
            true,
            filters.parse({ targetKind: "device", targetId: 1 }),
          )
        ).items,
      ).toEqual([]);
      expect(
        (
          await posture(
            true,
            true,
            filters.parse({ targetKind: "device", targetId: 3 }),
          )
        ).items,
      ).toHaveLength(1);
    });
    it("does not substitute all inventory when the identity is missing", async () => {
      expect(
        (
          await posture(
            false,
            false,
            filters.parse({ targetKind: "device", targetId: 9000 }),
          )
        ).items,
      ).toEqual([]);
    });
  },
);
