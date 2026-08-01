import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, rlsEnabled, IDS, type Db, type Fixture } from "../db/harness";
import { seed } from "../db/seed";

/**
 * `crear_venta` and friends exist precisely because the HTTP client cannot wrap
 * two writes in a transaction. Testing them against a mock would assert that
 * the mock was called — the interesting part is what the database is left
 * holding when a line halfway through the array is rejected, and only Postgres
 * can answer that.
 *
 * The stock movements are in the same position: nothing inserts them directly,
 * they are derived by triggers on the detail rows, so they are checked here
 * rather than anywhere the application code could be mocked.
 */

const suite = rlsEnabled ? describe : describe.skip;

suite("transactional RPCs and stock triggers", () => {
    let db: Db;
    let f: Fixture;

    beforeAll(async () => {
        let fixture!: Fixture;
        db = await createTestDb(async (d) => {
            fixture = await seed(d);
        });
        f = fixture;
    });

    afterAll(async () => {
        await db?.close();
    });

    const item = (producto: number, unidades = 1, precio = 121, iva = 21) => ({
        producto_id: producto,
        unidades,
        precio_unitario: precio,
        porcentaje_iva: iva,
    });

    describe("crear_venta", () => {
        it("writes the header and its lines in one go", async () => {
            const rows = await db.as(
                "authenticated",
                IDS.adminAcme,
                `SELECT crear_venta($1, now()::timestamp, 'web', $2::jsonb) AS r`,
                [f.acme, JSON.stringify([item(f.productoAcme, 2), item(f.productoAcme, 3)])],
            );
            const ventaId = rows[0].r.id;
            const lineas = await db.as(
                "service_role",
                null,
                `SELECT unidades FROM venta_detalle WHERE venta_id = $1 ORDER BY id`,
                [ventaId],
            );
            expect(lineas.map((l) => l.unidades)).toEqual([2, 3]);
        });

        it("leaves no orphan header when a later line is invalid", async () => {
            // The failure that motivated the RPC: over PostgREST the header
            // insert would already have committed by the time the second line
            // was rejected, leaving a sale with no contents in the ledger.
            const before = await db.as("service_role", null, `SELECT count(*)::int AS n FROM ventas`);

            const message = await db.expectDenied(
                "authenticated",
                IDS.adminAcme,
                `SELECT crear_venta($1, now()::timestamp, 'web', $2::jsonb)`,
                [f.acme, JSON.stringify([item(f.productoAcme), item(f.productoRival)])],
            );
            expect(message).toMatch(/no pertenece al proyecto/i);

            const after = await db.as("service_role", null, `SELECT count(*)::int AS n FROM ventas`);
            expect(after[0].n).toBe(before[0].n);
        });

        it("refuses a sale with no lines", async () => {
            const message = await db.expectDenied(
                "authenticated",
                IDS.adminAcme,
                `SELECT crear_venta($1, now()::timestamp, 'web', '[]'::jsonb)`,
                [f.acme],
            );
            expect(message).toMatch(/al menos una linea/i);
        });

        it("refuses to write into a project the caller does not belong to", async () => {
            // The RPC is not SECURITY DEFINER, so it runs as the caller and the
            // policies apply inside it. Were it ever marked SECURITY DEFINER,
            // this is the test that would notice.
            const message = await db.expectDenied(
                "authenticated",
                IDS.adminRival,
                `SELECT crear_venta($1, now()::timestamp, 'web', $2::jsonb)`,
                [f.acme, JSON.stringify([item(f.productoAcme)])],
            );
            expect(message).toMatch(/row-level security|no pertenece/i);
        });

        it("is not callable by anonymous requests", async () => {
            const message = await db.expectDenied(
                "anon",
                null,
                `SELECT crear_venta($1, now()::timestamp, 'web', $2::jsonb)`,
                [f.acme, JSON.stringify([item(f.productoAcme)])],
            );
            // Denied at the function, not merely blocked by the table grants
            // inside it, so the message names the function itself.
            expect(message).toMatch(/permission denied for function crear_venta/i);
        });

        it("keeps housekeeping away from logged-in users", async () => {
            // `limpiar_idempotency_keys` deletes stored responses; a browser
            // session has no business calling it.
            const message = await db.expectDenied(
                "authenticated",
                IDS.adminAcme,
                `SELECT limpiar_idempotency_keys()`,
            );
            expect(message).toMatch(/permission denied for function/i);
        });
    });

    describe("actualizar_venta", () => {
        it("edits only the header when no lines are given", async () => {
            // A status change (enviada -> devuelta) must not disturb the lines,
            // or the stock movements would be rewritten as a side effect.
            const before = await db.as(
                "service_role",
                null,
                `SELECT id FROM venta_detalle WHERE venta_id = $1 ORDER BY id`,
                [f.ventaAcme],
            );

            await db.as(
                "authenticated",
                IDS.adminAcme,
                `SELECT actualizar_venta(p_venta_id => $1, p_estado => 'devuelta')`,
                [f.ventaAcme],
            );

            const estado = await db.as("service_role", null, `SELECT estado FROM ventas WHERE id = $1`, [
                f.ventaAcme,
            ]);
            const after = await db.as(
                "service_role",
                null,
                `SELECT id FROM venta_detalle WHERE venta_id = $1 ORDER BY id`,
                [f.ventaAcme],
            );
            expect(estado[0].estado).toBe("devuelta");
            expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
        });

        it("replaces the lines and their stock movements when lines are given", async () => {
            const created = await db.as(
                "authenticated",
                IDS.adminAcme,
                `SELECT crear_venta($1, now()::timestamp, 'web', $2::jsonb) AS r`,
                [f.acme, JSON.stringify([item(f.productoAcme, 4)])],
            );
            const ventaId = created[0].r.id;

            await db.as(
                "authenticated",
                IDS.adminAcme,
                `SELECT actualizar_venta(p_venta_id => $1, p_items => $2::jsonb)`,
                [ventaId, JSON.stringify([item(f.productoAcme, 7)])],
            );

            const movimientos = await db.as(
                "service_role",
                null,
                `SELECT m.unidades FROM movimientos_stock m
                   JOIN venta_detalle vd ON m.ref_venta_detalle_id = vd.id
                  WHERE vd.venta_id = $1`,
                [ventaId],
            );
            // One movement, for the surviving line, and negative because a sale
            // takes units out of stock.
            expect(movimientos.map((m) => m.unidades)).toEqual([-7]);
        });

        it("reports a missing sale rather than silently doing nothing", async () => {
            const message = await db.expectDenied(
                "authenticated",
                IDS.adminAcme,
                `SELECT actualizar_venta(p_venta_id => $1, p_estado => 'devuelta')`,
                [999999],
            );
            expect(message).toMatch(/no encontrada/i);
        });
    });

    describe("stock movements", () => {
        it("adds units for a purchase line and removes them for a sale line", async () => {
            const compra = await db.as(
                "authenticated",
                IDS.adminAcme,
                `SELECT crear_compra($1, now()::timestamp, $2::jsonb) AS r`,
                [f.acme, JSON.stringify([item(f.productoAcme, 12, 60.5)])],
            );
            const compraId = compra[0].r.id;

            const rows = await db.as(
                "service_role",
                null,
                `SELECT m.unidades, m.tipo_movimiento FROM movimientos_stock m
                   JOIN compra_detalle cd ON m.ref_compra_detalle_id = cd.id
                  WHERE cd.compra_id = $1`,
                [compraId],
            );
            expect(rows).toEqual([{ unidades: 12, tipo_movimiento: "compra" }]);
        });

        it("follows an edited line instead of leaving the old quantity behind", async () => {
            const compra = await db.as(
                "authenticated",
                IDS.adminAcme,
                `SELECT crear_compra($1, now()::timestamp, $2::jsonb) AS r`,
                [f.acme, JSON.stringify([item(f.productoAcme, 5, 60.5)])],
            );
            const compraId = compra[0].r.id;

            await db.as(
                "authenticated",
                IDS.adminAcme,
                `UPDATE compra_detalle SET unidades = 9 WHERE compra_id = $1`,
                [compraId],
            );

            const rows = await db.as(
                "service_role",
                null,
                `SELECT m.unidades FROM movimientos_stock m
                   JOIN compra_detalle cd ON m.ref_compra_detalle_id = cd.id
                  WHERE cd.compra_id = $1`,
                [compraId],
            );
            expect(rows.map((r) => r.unidades)).toEqual([9]);
        });

        it("keeps the derived stock consistent with what the view reports", async () => {
            // `vista_stock_final` sums the movements, so this is the end-to-end
            // statement: what the dashboard shows equals what was bought minus
            // what was sold, as seen by a member of the project.
            const [sum] = await db.as(
                "service_role",
                null,
                `SELECT COALESCE(sum(unidades),0)::int AS n FROM movimientos_stock WHERE producto_id = $1`,
                [f.productoAcme],
            );
            const [view] = await db.as(
                "authenticated",
                IDS.adminAcme,
                `SELECT stock_actual::int AS n FROM vista_stock_final WHERE producto_id = $1`,
                [f.productoAcme],
            );
            expect(view.n).toBe(sum.n);
        });
    });

    describe("VAT extracted by the finance view", () => {
        it("treats prices as VAT-inclusive", async () => {
            // 121.00 at 21% is 100.00 net plus 21.00 tax, so the view must
            // report 21.00 and not 121 * 0.21. Getting this backwards is the
            // classic way a VAT return ends up wrong by a fifth.
            const db2 = await createTestDb(async (d) => {
                const sql = (t: string, p: unknown[] = []) => d.as("service_role", null, t, p);
                await sql(`INSERT INTO auth.users (id, email) VALUES ($1,'solo@test.local')`, [
                    IDS.adminAcme,
                ]);
                const [{ id }] = await sql(`INSERT INTO proyectos (nombre) VALUES ('IVA') RETURNING id`);
                await sql(
                    `INSERT INTO proyecto_usuarios (proyecto_id, user_id, rol) VALUES ($1,$2,'admin')`,
                    [id, IDS.adminAcme],
                );
                const [{ id: prod }] = await sql(
                    `INSERT INTO productos (proyecto_id, nombre) VALUES ($1,'P') RETURNING id`,
                    [id],
                );
                const [{ id: venta }] = await sql(
                    `INSERT INTO ventas (proyecto_id, canal, estado) VALUES ($1,'web','enviada') RETURNING id`,
                    [id],
                );
                await sql(
                    `INSERT INTO venta_detalle (venta_id, producto_id, unidades, precio_unitario_venta, porcentaje_iva)
                     VALUES ($1,$2,1,121.00,21)`,
                    [venta, prod],
                );
            });

            try {
                const [row] = await db2.as(
                    "authenticated",
                    IDS.adminAcme,
                    `SELECT ingresos, iva_repercutido FROM vista_finanzas_diarias`,
                );
                expect(Number(row.ingresos)).toBeCloseTo(121, 2);
                expect(Number(row.iva_repercutido)).toBeCloseTo(21, 2);
            } finally {
                await db2.close();
            }
        });

        it("excludes returned sales from income and from the VAT due", async () => {
            // A refunded sale that still counted as revenue would overstate
            // both the takings and the tax owed on them.
            const [row] = await db.as(
                "authenticated",
                IDS.adminAcme,
                `SELECT COALESCE(sum(ingresos),0) AS ingresos FROM vista_finanzas_diarias`,
            );
            const [devueltas] = await db.as(
                "service_role",
                null,
                `SELECT COALESCE(sum(vd.unidades * vd.precio_unitario_venta),0) AS total
                   FROM venta_detalle vd JOIN ventas v ON vd.venta_id = v.id
                  WHERE v.proyecto_id = $1 AND v.estado <> 'enviada'`,
                [f.acme],
            );
            expect(Number(devueltas.total)).toBeGreaterThan(0);
            const [enviadas] = await db.as(
                "service_role",
                null,
                `SELECT COALESCE(sum(vd.unidades * vd.precio_unitario_venta),0) AS total
                   FROM venta_detalle vd JOIN ventas v ON vd.venta_id = v.id
                  WHERE v.proyecto_id = $1 AND v.estado = 'enviada'`,
                [f.acme],
            );
            // Other income and expenses also feed `ingresos`; the seed's only
            // one is a `gasto`, so the sales figure is the whole of it.
            expect(Number(row.ingresos)).toBeCloseTo(Number(enviadas.total), 2);
        });
    });
});
