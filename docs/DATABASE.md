# Database

## Convex is now the application database

The running application stores ERP data in `convex/schema.ts` and implements
its transactional domain operations in `convex/domain.ts`. Numeric ids and the
Spanish response fields are retained so the public API and existing UI keep
their contract. Prices are stored as integer cents internally.

Supabase remains only as the temporary password/session provider. Moving
password hashes between providers would require an explicit auth migration and
user re-authentication plan, so it is intentionally outside this data cutover.

For an existing Supabase database, run `pnpm migrate:supabase` with a
server-side Supabase key. The importer targets `CONVEX_PRODUCTION_URL` (or an
explicit `--convex-url`) instead of accidentally using a local `CONVEX_URL`,
preserves relationships and original ids, and can be run again safely. It
deliberately starts the Convex idempotency ledger empty.

The executable schema lives in `db-structure/` and is loaded in this order:

| File | Contents |
| --- | --- |
| `01-schema.sql` | Enums, tables, stock triggers, and reporting views |
| `02-rls.sql` | Project membership and row-level security policies |
| `03-agent-api.sql` | `api_keys`, idempotency, and transactional functions |

Previously, there was a single `structure.sql` file that was a descriptive,
non-executable dump (`ARRAY`, `USER-DEFINED`, and standalone trigger bodies
without their `CREATE FUNCTION`). It was useful for reading the schema, but not
for creating a database, which meant there was no way to test a policy or RPC:
there was nothing PostgreSQL could load. The files in `db-structure/` can be
loaded as-is, which is exactly what the `tests/rls` suite does.

## Changing the schema

`db-structure/` describes the database as it should be; it is what a fresh
database is built from and what `tests/rls` loads. A database that already
exists cannot be rebuilt from it, so every change also gets a file in
`.sb-migrations/`, named `YYYYMMDD_what_it_does.sql`, containing only that
change. Run it in the Supabase SQL editor. The two must never disagree.

## The tenant boundary

The project (`proyectos`) is the boundary. A user can see a project's rows if,
and only if, they have a row in `proyecto_usuarios`. Every business table
carries `proyecto_id`, so every policy is the same sentence about the same
column. On the three child tables—`venta_detalle`, `compra_detalle`, and
`movimientos_stock`—that column is derived from the parent row by trigger and
never accepted from the client; leaving those tables open would expose prices
and quantities one JOIN away even if the header were invisible.

Three non-obvious details covered by the test suite:

- **A policy predicate runs once per row, unless it names no column.** The first
  version of the child-table policies asked the parent directly, with `EXISTS
  (SELECT 1 FROM ventas v WHERE v.id = venta_id AND es_miembro(v.proyecto_id))`.
  Correct, and unusable: the subquery names a column of the row being tested, so
  it runs per row; it scans a table that has a policy of its own; and
  `es_miembro` is `SECURITY DEFINER`, which the planner will never inline.
  Underneath `vista_stock_final`, which walks the detail tables once per
  product, `SELECT * FROM vista_stock_final` ran past Supabase's eight-second
  `statement_timeout` and the stock page rendered zeroes. The policies now read
  `proyecto_id IN (SELECT public.mis_proyectos())`, which depends on no column,
  so it is computed once per statement and the row test is a hash lookup on an
  indexed column.

- **Views need `security_invoker = true`.** Without it, a view runs with its
  owner's permissions and the policies on the underlying tables are never
  evaluated: `vista_finanzas_diarias` would return figures from every project,
  regardless of how tightly the tables were secured.
- **Function permissions are revoked twice.** PostgreSQL grants `EXECUTE` to
  `PUBLIC` on every new function, and `anon` inherits it from there. In addition,
  a Supabase project includes an `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON
  FUNCTIONS TO anon, authenticated` for the `public` schema, so every function
  is also created with a direct grant to those two roles. Revoking only from
  `PUBLIC` leaves the second grant in place. The roles must be named explicitly,
  followed by new grants to the roles that should be able to call the function.
  `tests/db/bootstrap.sql` reproduces that `ALTER DEFAULT PRIVILEGES`; without
  it, the suite would run against a cluster stricter than production and accept
  a revocation that changes nothing there.

## Enums

They must be cast explicitly in hand-written SQL:

- `tipo_movimiento`: `compra`, `venta`, `devolucion_vta`, `ajuste manual`, `devolucion_com`
- `estado_compra`: `pendiente`, `recibida`, `cancelada`
- `tipo_transaccion`: `ingreso`, `gasto`
- `estado_venta`: `pendiente`, `enviada`, `devuelta`, `reembolsada`

```sql
'gasto'::tipo_transaccion, 'recibida'::estado_compra, '2026-01-01'::timestamp
```

Subqueries inside `VALUES` do not work in the Supabase editor; use a CTE with
`INSERT ... SELECT` instead.

## VAT

Prices are stored **with VAT included**, so the tax is extracted using
`rate / (100 + rate)`, not `rate / 100`. At 21%, 121.00 consists of a 100.00
taxable amount and 21.00 VAT. Confusing the two formulas throws the tax return
off by one fifth; this is covered by `tests/rls/rpc-transactions.test.ts`.
