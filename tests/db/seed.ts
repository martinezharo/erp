import { IDS, type Db, type Fixture } from "./harness";

/**
 * Two unrelated companies, each with its own project, catalogue and ledger.
 *
 * That is the smallest world in which "Rival must not see this" is a real
 * question rather than an empty set. Acme also has a second, non-admin member,
 * because "any logged-in user" and "a member who is not an admin" are different
 * questions and only the second one is interesting for the roster policies.
 *
 * Everything is inserted as `service_role`, which is how the server writes. The
 * tests then read it back as the people who must and must not be able to.
 */
export async function seed(db: Db): Promise<Fixture> {
    const sql = (text: string, params: unknown[] = []) => db.as("service_role", null, text, params);

    await sql(`INSERT INTO auth.users (id, email) VALUES ($1,$2),($3,$4),($5,$6),($7,$8)`, [
        IDS.adminAcme, "admin-acme@test.local",
        IDS.miembroAcme, "miembro-acme@test.local",
        IDS.adminRival, "admin-rival@test.local",
        IDS.sinProyecto, "sin-proyecto@test.local",
    ]);

    const [{ id: acme }] = await sql(`INSERT INTO proyectos (nombre) VALUES ('Acme') RETURNING id`);
    const [{ id: rival }] = await sql(`INSERT INTO proyectos (nombre) VALUES ('Rival') RETURNING id`);

    await sql(
        `INSERT INTO proyecto_usuarios (proyecto_id, user_id, rol)
         VALUES ($1,$2,'admin'),($1,$3,'miembro'),($4,$5,'admin')`,
        [acme, IDS.adminAcme, IDS.miembroAcme, rival, IDS.adminRival],
    );

    const [{ id: productoAcme }] = await sql(
        `INSERT INTO productos (proyecto_id, nombre) VALUES ($1,'Widget Acme') RETURNING id`,
        [acme],
    );
    const [{ id: productoRival }] = await sql(
        `INSERT INTO productos (proyecto_id, nombre) VALUES ($1,'Widget Rival') RETURNING id`,
        [rival],
    );

    // One shipped sale per project, with a line each, so the trigger-derived
    // stock movements exist too and can be asked about separately.
    const [{ id: ventaAcme }] = await sql(
        `INSERT INTO ventas (proyecto_id, canal, estado) VALUES ($1,'web','enviada') RETURNING id`,
        [acme],
    );
    const [{ id: ventaRival }] = await sql(
        `INSERT INTO ventas (proyecto_id, canal, estado) VALUES ($1,'web','enviada') RETURNING id`,
        [rival],
    );
    await sql(
        `INSERT INTO venta_detalle (venta_id, producto_id, unidades, precio_unitario_venta, porcentaje_iva)
         VALUES ($1,$2,3,121.00,21),($3,$4,1,60.50,21)`,
        [ventaAcme, productoAcme, ventaRival, productoRival],
    );

    const [{ id: compraAcme }] = await sql(
        `INSERT INTO compras (proyecto_id, estado) VALUES ($1,'recibida') RETURNING id`,
        [acme],
    );
    await sql(
        `INSERT INTO compra_detalle (compra_id, producto_id, unidades, precio_unitario_compra, porcentaje_iva)
         VALUES ($1,$2,10,60.50,21)`,
        [compraAcme, productoAcme],
    );

    const [{ id: gastoAcme }] = await sql(
        `INSERT INTO otros_ingresos_gastos (proyecto_id, tipo, concepto, importe, porcentaje_iva)
         VALUES ($1,'gasto','Alquiler',1210.00,21) RETURNING id`,
        [acme],
    );

    return { acme, rival, productoAcme, productoRival, ventaAcme, ventaRival, compraAcme, gastoAcme };
}
