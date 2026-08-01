# Database

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

## The tenant boundary

The project (`proyectos`) is the boundary. A user can see a project's rows if,
and only if, they have a row in `proyecto_usuarios`. Tables without a
`proyecto_id`—`venta_detalle`, `compra_detalle`, and `movimientos_stock`—inherit
the boundary through their parent row. Leaving them open would expose prices and
quantities one JOIN away even if the header were invisible.

Two non-obvious details covered by the test suite:

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
