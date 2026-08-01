import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, rlsEnabled, IDS, type Db, type Fixture } from "../db/harness";
import { seed } from "../db/seed";

/**
 * The question these ask is not "does the query work" but "can the wrong person
 * reach this row". The middleware already turns anonymous callers away; what it
 * cannot do is stop one logged-in user from reading another company's books,
 * because the browser talks to PostgREST directly with the user's own token.
 * That is entirely a matter of policy, so it is asked of the database.
 */

const suite = rlsEnabled ? describe : describe.skip;

suite("tenant isolation", () => {
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

    describe("RLS is enabled everywhere", () => {
        it("leaves no business table unprotected", async () => {
            // Fails the moment a table is added to `public` without RLS, which
            // is the failure mode a per-table test cannot catch: the new table
            // simply has no test.
            const rows = await db.as(
                "service_role",
                null,
                `SELECT c.relname FROM pg_class c
                 JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
                 ORDER BY c.relname`,
            );
            expect(rows.map((r) => r.relname)).toEqual([]);
        });

        it("gives every protected table at least one policy", async () => {
            // RLS on with no policy denies everything, including the app. That
            // is safe but broken, and worth telling apart from a real denial.
            const rows = await db.as(
                "service_role",
                null,
                `SELECT c.relname FROM pg_class c
                 JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
                   AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
                 ORDER BY c.relname`,
            );
            // `api_keys` and `idempotency_keys` are deliberately policy-free:
            // only the service role, which bypasses RLS, may reach them.
            expect(rows.map((r) => r.relname)).toEqual(["api_keys", "idempotency_keys"]);
        });

        it("keeps the reporting views on security_invoker", async () => {
            // A view without it runs as its owner, so the policies underneath
            // are never consulted and the view hands over every project's
            // figures. The tables can be perfectly locked down and the numbers
            // still leak through here.
            const rows = await db.as(
                "service_role",
                null,
                `SELECT c.relname, c.reloptions FROM pg_class c
                 JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND c.relkind = 'v' ORDER BY c.relname`,
            );
            expect(rows.length).toBeGreaterThan(0);
            for (const view of rows) {
                expect(view.reloptions ?? [], `view ${view.relname}`).toContain("security_invoker=true");
            }
        });
    });

    describe("anonymous callers", () => {
        const tables = [
            "proyectos",
            "proyecto_usuarios",
            "productos",
            "ventas",
            "venta_detalle",
            "compras",
            "compra_detalle",
            "movimientos_stock",
            "otros_ingresos_gastos",
        ];

        it.each(tables)("cannot read %s", async (table) => {
            const message = await db.expectDenied("anon", null, `SELECT * FROM ${table}`);
            expect(message).toMatch(/permission denied/i);
        });

        it.each(["vista_finanzas_diarias", "vista_stock_final"])("cannot read %s", async (view) => {
            const message = await db.expectDenied("anon", null, `SELECT * FROM ${view}`);
            expect(message).toMatch(/permission denied/i);
        });
    });

    describe("a member of one project", () => {
        it("sees only their own project in the selector", async () => {
            const rows = await db.as("authenticated", IDS.adminAcme, `SELECT nombre FROM proyectos`);
            expect(rows.map((r) => r.nombre)).toEqual(["Acme"]);
        });

        it("does not see the other company's products", async () => {
            const rows = await db.as("authenticated", IDS.adminAcme, `SELECT id FROM productos`);
            expect(rows.map((r) => r.id)).toEqual([f.productoAcme]);
        });

        it("does not see the other company's sales", async () => {
            const rows = await db.as("authenticated", IDS.adminAcme, `SELECT id FROM ventas`);
            expect(rows.map((r) => r.id)).toEqual([f.ventaAcme]);
        });

        it("does not see the other company's sale lines", async () => {
            // The header being invisible is not enough: the lines carry the
            // prices and quantities, which is the commercially sensitive part.
            const rows = await db.as(
                "authenticated",
                IDS.adminAcme,
                `SELECT venta_id FROM venta_detalle`,
            );
            expect(rows.map((r) => r.venta_id)).toEqual([f.ventaAcme]);
        });

        it("does not see the other company's purchases or their lines", async () => {
            const compras = await db.as("authenticated", IDS.adminRival, `SELECT id FROM compras`);
            expect(compras).toEqual([]);
            const lineas = await db.as("authenticated", IDS.adminRival, `SELECT id FROM compra_detalle`);
            expect(lineas).toEqual([]);
        });

        it("does not see the other company's stock movements", async () => {
            const rows = await db.as(
                "authenticated",
                IDS.adminRival,
                `SELECT producto_id FROM movimientos_stock`,
            );
            for (const row of rows) expect(row.producto_id).toBe(f.productoRival);
        });

        it("does not see the other company's other income and expenses", async () => {
            const rows = await db.as(
                "authenticated",
                IDS.adminRival,
                `SELECT id FROM otros_ingresos_gastos`,
            );
            expect(rows).toEqual([]);
        });

        it("sees only their own figures in the finance view", async () => {
            const rows = await db.as(
                "authenticated",
                IDS.adminRival,
                `SELECT DISTINCT proyecto_id FROM vista_finanzas_diarias`,
            );
            expect(rows.map((r) => r.proyecto_id)).toEqual([f.rival]);
        });

        it("sees only their own products in the stock view", async () => {
            const rows = await db.as(
                "authenticated",
                IDS.adminRival,
                `SELECT DISTINCT proyecto_id FROM vista_stock_final`,
            );
            expect(rows.map((r) => r.proyecto_id)).toEqual([f.rival]);
        });
    });

    describe("a user who belongs to no project", () => {
        it("sees an empty world rather than an error", async () => {
            // Not a denial: PostgREST is reachable, the rows are simply not
            // theirs. The UI renders an empty project selector.
            const proyectos = await db.as("authenticated", IDS.sinProyecto, `SELECT * FROM proyectos`);
            const ventas = await db.as("authenticated", IDS.sinProyecto, `SELECT * FROM ventas`);
            expect(proyectos).toEqual([]);
            expect(ventas).toEqual([]);
        });

        it("cannot make themselves a member", async () => {
            // The whole model rests on this one: if a member row can be
            // self-issued, every other policy follows along.
            const message = await db.expectDenied(
                "authenticated",
                IDS.sinProyecto,
                `INSERT INTO proyecto_usuarios (proyecto_id, user_id) VALUES ($1,$2)`,
                [f.acme, IDS.sinProyecto],
            );
            expect(message).toMatch(/row-level security/i);
        });
    });

    describe("writes stay inside the project", () => {
        it("refuses a product written into another project", async () => {
            const message = await db.expectDenied(
                "authenticated",
                IDS.adminAcme,
                `INSERT INTO productos (proyecto_id, nombre) VALUES ($1,'Infiltrado')`,
                [f.rival],
            );
            expect(message).toMatch(/row-level security/i);
        });

        it("refuses moving an existing row into another project", async () => {
            // `USING` alone would allow this: the row is visible, so the update
            // is permitted, and only `WITH CHECK` inspects what it becomes.
            const message = await db.expectDenied(
                "authenticated",
                IDS.adminAcme,
                `UPDATE productos SET proyecto_id = $1 WHERE id = $2`,
                [f.rival, f.productoAcme],
            );
            expect(message).toMatch(/row-level security/i);
        });

        it("refuses a sale line written onto another project's sale", async () => {
            // The child tables are now guarded by their own `proyecto_id`, which
            // the trigger derives from the parent. So this is the assertion that
            // the derivation is what decides: the line names Rival's sale, the
            // trigger stamps Rival's project on it, and `WITH CHECK` refuses it.
            const message = await db.expectDenied(
                "authenticated",
                IDS.adminAcme,
                `INSERT INTO venta_detalle (venta_id, producto_id, unidades, precio_unitario_venta, porcentaje_iva)
                 VALUES ($1,$2,1,10.00,21)`,
                [f.ventaRival, f.productoAcme],
            );
            expect(message).toMatch(/row-level security/i);
        });

        it("ignores a proyecto_id supplied by the client on a sale line", async () => {
            // A column the caller could choose would be a caller choosing which
            // project they may write into. The trigger overwrites it, so naming
            // Rival's project on a line of Acme's own sale changes nothing.
            const [{ id }] = await db.as(
                "authenticated",
                IDS.adminAcme,
                `INSERT INTO venta_detalle (venta_id, proyecto_id, producto_id, unidades, precio_unitario_venta, porcentaje_iva)
                 VALUES ($1,$2,$3,1,10.00,21) RETURNING id`,
                [f.ventaAcme, f.rival, f.productoAcme],
            );
            const rows = await db.as(
                "service_role",
                null,
                `SELECT proyecto_id FROM venta_detalle WHERE id = $1`,
                [id],
            );
            expect(rows.map((r) => r.proyecto_id)).toEqual([f.acme]);

            // The fixture is seeded once for the whole file, so this line and
            // the stock movement its trigger derived have to go back out again.
            await db.as("service_role", null, `DELETE FROM movimientos_stock WHERE ref_venta_detalle_id = $1`, [id]);
            await db.as("service_role", null, `DELETE FROM venta_detalle WHERE id = $1`, [id]);
        });

        it("silently matches nothing when deleting another project's row", async () => {
            // A delete of an invisible row is not an error, it is a no-op — so
            // the assertion has to be that the row survived.
            await db.as("authenticated", IDS.adminRival, `DELETE FROM ventas WHERE id = $1`, [
                f.ventaAcme,
            ]);
            const rows = await db.as("service_role", null, `SELECT id FROM ventas WHERE id = $1`, [
                f.ventaAcme,
            ]);
            expect(rows).toHaveLength(1);
        });

        it("lets a member write inside their own project", async () => {
            // The mirror of every assertion above: policies that deny
            // everything would pass those and break the application.
            const rows = await db.as(
                "authenticated",
                IDS.miembroAcme,
                `INSERT INTO productos (proyecto_id, nombre) VALUES ($1,'Nuevo') RETURNING id`,
                [f.acme],
            );
            expect(rows).toHaveLength(1);
        });
    });

    describe("roster changes", () => {
        it("lets an admin add a member to their own project", async () => {
            await db.as(
                "authenticated",
                IDS.adminAcme,
                `INSERT INTO proyecto_usuarios (proyecto_id, user_id) VALUES ($1,$2)`,
                [f.acme, IDS.sinProyecto],
            );
            const rows = await db.as(
                "service_role",
                null,
                `SELECT rol FROM proyecto_usuarios WHERE proyecto_id = $1 AND user_id = $2`,
                [f.acme, IDS.sinProyecto],
            );
            expect(rows[0].rol).toBe("miembro");
        });

        it("refuses a plain member adding anyone", async () => {
            const message = await db.expectDenied(
                "authenticated",
                IDS.miembroAcme,
                `INSERT INTO proyecto_usuarios (proyecto_id, user_id, rol) VALUES ($1,$2,'admin')`,
                [f.acme, IDS.adminRival],
            );
            expect(message).toMatch(/row-level security/i);
        });

        it("does not let a plain member promote themselves", async () => {
            // A `USING` clause that rejects a row does not raise: the update
            // simply matches nothing. So the assertion is that the role did not
            // move, not that an error came back — a test written the other way
            // round would fail against a perfectly correct policy.
            await db.as(
                "authenticated",
                IDS.miembroAcme,
                `UPDATE proyecto_usuarios SET rol = 'admin' WHERE proyecto_id = $1 AND user_id = $2`,
                [f.acme, IDS.miembroAcme],
            );
            const rows = await db.as(
                "service_role",
                null,
                `SELECT rol FROM proyecto_usuarios WHERE proyecto_id = $1 AND user_id = $2`,
                [f.acme, IDS.miembroAcme],
            );
            expect(rows[0].rol).toBe("miembro");
        });

        it("does not let an admin rename another company's project", async () => {
            // Deliberately unfiltered: an attempt to rename every project the
            // caller can reach. Only their own may move.
            await db.as("authenticated", IDS.adminRival, `UPDATE proyectos SET nombre = 'Taken'`);
            const rows = await db.as("service_role", null, `SELECT nombre FROM proyectos ORDER BY id`);
            expect(rows.map((r) => r.nombre)).toEqual(["Acme", "Taken"]);
        });
    });

    describe("the membership predicate itself", () => {
        it("is not callable by anonymous requests", async () => {
            const message = await db.expectDenied("anon", null, `SELECT es_miembro(1)`);
            expect(message).toMatch(/permission denied/i);
        });

        it("does not let an anonymous request list the projects of whoever it is", async () => {
            const message = await db.expectDenied("anon", null, `SELECT mis_proyectos()`);
            expect(message).toMatch(/permission denied/i);
        });

        it("pins its search_path", async () => {
            // A SECURITY DEFINER function that resolves table names through the
            // caller's search_path can be aimed at a table the caller controls,
            // which turns the membership check into whatever they want.
            const rows = await db.as(
                "service_role",
                null,
                `SELECT proname, proconfig FROM pg_proc
                  WHERE proname IN ('es_miembro','es_admin_proyecto','mis_proyectos',
                                    'derivar_proyecto_venta_detalle',
                                    'derivar_proyecto_compra_detalle',
                                    'derivar_proyecto_movimiento')
                  ORDER BY proname`,
            );
            expect(rows).toHaveLength(6);
            for (const fn of rows) {
                expect(fn.proconfig ?? [], `function ${fn.proname}`).toContain(
                    "search_path=public, pg_temp",
                );
            }
        });
    });
});
