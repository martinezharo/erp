# Database tests

These run the repository's own `db-structure/*.sql` against a real PostgreSQL
and then ask it the two questions that mocks cannot answer:

- **Can the wrong person reach this row?** Policies are sentences about rows.
  Only Postgres evaluating one can tell you whether `es_miembro(proyecto_id)`
  actually keeps one company's ledger away from another.
- **What is left behind when a transaction fails halfway?** `crear_venta` writes
  a header, its lines, and the stock movements the triggers derive from them. A
  stub would assert that it was called; the interesting part is that nothing
  survives when the third line is rejected.

They are separate from `npm test` on purpose. The unit suite must stay runnable
with nothing but `node_modules` — the pre-push hook runs it — while these need a
server. Without `RLS_DATABASE_URL` set they skip rather than fail.

## Running them

```bash
export RLS_DATABASE_URL='postgresql://postgres@localhost:5432/postgres'
npm run test:rls
```

The URL must point at a **superuser** on a throwaway cluster: the harness
creates a fresh database per run (`erp_rls_<timestamp>`) and creates the
`anon` / `authenticated` / `service_role` roles if they are missing.

### With the Supabase CLI

```bash
npx supabase start
export RLS_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
npm run test:rls
```

### With a plain PostgreSQL 16

Any local cluster works — nothing here needs Supabase itself.
`tests/db/bootstrap.sql` recreates the only pieces the schema references: the
three PostgREST roles, `auth.uid()` and `auth.users`.

## Detecting production policy drift

`db-structure/rls-policies.json` is the reviewed policy manifest. The RLS suite
compares it with a fresh database loaded from `db-structure/*.sql`, so schema
changes cannot silently leave the manifest stale. Compare that same manifest
with production using a read-only database connection:

```bash
export RLS_POLICY_DATABASE_URL='postgresql://readonly:...@db.example/postgres?sslmode=require'
pnpm run db:policies:check
```

The command exits with status 1 and lists missing, unexpected, and changed
policies. Use a dedicated login with only enough access to read `pg_policies`;
the check never writes to the target database.

## How a test says "this request comes from that user"

Exactly the way PostgREST does it. `auth.uid()` reads the
`request.jwt.claim.sub` setting, so the harness sets the role and that claim
inside a transaction:

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '<user uuid>', true);
-- ... the query under test ...
COMMIT;
```

Each call is its own transaction, so no test can leak its identity into the
next one.

## What the fixture contains

Two unrelated companies, Acme and Rival, each with its own project, product,
sale and stock. Acme also has a second, non-admin member, and there is one user
who belongs to no project at all. That is the smallest world in which "Rival
must not see this" is a real question rather than an empty set.

Rows are written as `service_role`, the way the server writes them, and read
back as the people who must and must not be able to.

## Denial is not always an error

Worth knowing before writing an assertion. A row rejected by a policy's `USING`
clause is simply *not matched*: an `UPDATE` or `DELETE` against it affects zero
rows and returns success. Only `WITH CHECK` — what a row is allowed to *become*
— raises `new row violates row-level security policy`.

So a test for "they must not be able to change this" asserts that the value did
not move, while a test for "they must not be able to write that" asserts on the
error. Getting it backwards produces a test that fails against a correct policy.

## Adding a table

`RLS is enabled everywhere > leaves no business table unprotected` fails the
moment a table is added to `public` without `ENABLE ROW LEVEL SECURITY`, and its
companion fails if RLS is enabled with no policy at all (which denies the
application as thoroughly as an attacker). A new table should also get its own
isolation test here — the generic checks only prove RLS is on, not that the
policy is right.
