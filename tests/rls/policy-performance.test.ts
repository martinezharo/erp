import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, rlsEnabled, IDS, type Db, type Fixture } from "../db/harness";
import { seed } from "../db/seed";

const suite = rlsEnabled ? describe : describe.skip;
const PRODUCT_COUNT = 250;
const LINES_PER_PRODUCT = 20;

suite("RLS policy performance", () => {
    let db: Db;
    let fixture: Fixture;

    beforeAll(async () => {
        db = await createTestDb(async (database) => {
            fixture = await seed(database);

            await database.as(
                "service_role",
                null,
                `INSERT INTO productos (proyecto_id, nombre)
                 SELECT $1, 'Load product ' || n
                 FROM generate_series(1, $2::integer) n`,
                [fixture.acme, PRODUCT_COUNT],
            );

            const [{ id: saleId }] = await database.as(
                "service_role",
                null,
                `INSERT INTO ventas (proyecto_id, canal, estado)
                 VALUES ($1, 'load-test', 'enviada') RETURNING id`,
                [fixture.acme],
            );
            const [{ id: purchaseId }] = await database.as(
                "service_role",
                null,
                `INSERT INTO compras (proyecto_id, estado)
                 VALUES ($1, 'recibida') RETURNING id`,
                [fixture.acme],
            );

            await database.as(
                "service_role",
                null,
                `INSERT INTO venta_detalle
                    (venta_id, producto_id, unidades, precio_unitario_venta, porcentaje_iva)
                 SELECT $1, p.id, 1, 12.10, 21
                 FROM productos p
                 CROSS JOIN generate_series(1, $3::integer)
                 WHERE p.proyecto_id = $2 AND p.nombre LIKE 'Load product %'`,
                [saleId, fixture.acme, LINES_PER_PRODUCT],
            );
            await database.as(
                "service_role",
                null,
                `INSERT INTO compra_detalle
                    (compra_id, producto_id, unidades, precio_unitario_compra, porcentaje_iva)
                 SELECT $1, p.id, 2, 6.05, 21
                 FROM productos p
                 CROSS JOIN generate_series(1, $3::integer)
                 WHERE p.proyecto_id = $2 AND p.nombre LIKE 'Load product %'`,
                [purchaseId, fixture.acme, LINES_PER_PRODUCT],
            );

            await database.as("service_role", null, "ANALYZE");
        });
    });

    afterAll(async () => {
        await db?.close();
    });

    it("keeps high-volume policies independent of the current row", async () => {
        const highVolumeTables = [
            "productos",
            "ventas",
            "venta_detalle",
            "compras",
            "compra_detalle",
            "movimientos_stock",
            "otros_ingresos_gastos",
        ];
        const policies = await db.as(
            "service_role",
            null,
            `SELECT tablename, qual, with_check
             FROM pg_policies
             WHERE schemaname = 'public' AND tablename = ANY($1::text[])
             ORDER BY tablename`,
            [highVolumeTables],
        );

        expect(policies).toHaveLength(highVolumeTables.length);
        for (const policy of policies) {
            expect(policy.qual, policy.tablename).toContain("mis_proyectos()");
            expect(policy.qual, policy.tablename).not.toContain("es_miembro(");
            expect(policy.with_check, policy.tablename).toContain("mis_proyectos()");
            expect(policy.with_check, policy.tablename).not.toContain("es_miembro(");
        }
    });

    it("plans and executes the stock view within its production timeout", async () => {
        const [explain] = await db.as(
            "authenticated",
            IDS.adminAcme,
            `EXPLAIN (ANALYZE, FORMAT JSON)
             SELECT * FROM vista_stock_final WHERE proyecto_id = $1`,
            [fixture.acme],
            { statementTimeoutMs: 2_000 },
        );
        const plan = explain["QUERY PLAN"][0];

        expect(plan["Execution Time"]).toBeLessThan(1_500);
        expect(plan.Plan["Actual Rows"]).toBe(PRODUCT_COUNT + 1);
    });
});
