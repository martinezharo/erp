- Transaction filters
- Manage refunds and returns through the database and enable editing the sale status.
- Default the purchase price to the most recent transaction only.

## Remaining from the 2026-07-31 testing pass

RLS, the RPC/trigger tests, the VAT arithmetic and the pre-push hook are done
(PR #3). Still open:

- [x] **Unify the legacy routes.** All browser API routes now reuse the user
      validated by middleware through `sessionBackend`; no route performs a
      second `getUser()` call.
- [x] **Serializer and Zod rounding.** `lib/api/serializers.ts` and
      `schemas.ts` normalize monetary inputs to cents and keep base, VAT and
      gross output internally consistent, with unit coverage at rounding edges.
- [ ] **Nothing notices when production drifts from `db-structure/`.** A policy
      called `Solo_Yo_Acceso_Total`, added by hand in the dashboard and absent
      from this repository, had been granting one hardcoded email full access to
      all eight business tables. It surfaced only because its predicate appeared
      in a query plan being read for another reason; it is dropped now
      (`.sb-migrations/20260801_drop_hardcoded_email_bypass_policy.sql`). A check
      that compares `pg_policies` against the policies in `02-rls.sql` would have
      caught it the day it appeared.

- [ ] **A policy is a query plan too.** The RLS suite proved the policies added
      in PR #3 were *correct* and said nothing about what they cost, so the
      stock page timed out in production against a real project's data (fixed by
      `.sb-migrations/20260801_carry_proyecto_id_on_child_tables.sql`). The
      fixture is four rows; nothing in it can produce a bad plan. Worth a test
      that seeds a few thousand lines and asserts `EXPLAIN` on
      `vista_stock_final` shows no per-row subplan — or, more cheaply, that the
      query finishes well inside the timeout.

- [ ] **A membership UI.** `proyecto_usuarios` is currently only writable with
      the service role (see README). Adding and removing members from the app
      needs a screen, and creating a project needs an RPC that writes the
      project and its first admin in one transaction.
