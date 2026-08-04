import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, rlsEnabled, type Db } from "../db/harness";
import {
    policiesFromManifest,
    policyDifferences,
} from "../../scripts/rls-policy-manifest.mjs";

const suite = rlsEnabled ? describe : describe.skip;

suite("RLS policy manifest", () => {
    let db: Db;

    beforeAll(async () => {
        db = await createTestDb(async () => undefined);
    });

    afterAll(async () => {
        await db?.close();
    });

    it("matches the policies created by db-structure", async () => {
        const expected = await policiesFromManifest();
        const actual = await db.as(
            "service_role",
            null,
            `SELECT schemaname AS schema, tablename AS table, policyname AS name,
                    permissive, roles::text[] AS roles, cmd AS command,
                    qual AS using, with_check AS check
             FROM pg_policies
             WHERE schemaname = 'public'
             ORDER BY schemaname, tablename, policyname`,
        );

        expect(policyDifferences(expected, actual)).toEqual([]);
    });
});
