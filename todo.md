- Transaction filters
- Manage refunds and returns through the database and enable editing the sale status.
- Default the purchase price to the most recent transaction only.

## Remaining from the 2026-07-31 testing pass

RLS, the RPC/trigger tests, the VAT arithmetic and the pre-push hook are done
(PR #3). Still open:

- [ ] **Unify the legacy routes.** Six under `src/pages/api/` call `getUser()`
      for themselves and ten do not. Since the middleware validates the session
      and puts the user on `locals`, the six are redundant — and the
      inconsistency is worse than either choice, because it is impossible to
      tell by reading one route whether it is protected. Delete the local checks
      and read `locals.user`.
- [ ] **Serializer and Zod rounding.** `lib/api/serializers.ts` and
      `schemas.ts`. The database side of the VAT arithmetic is now covered by
      `tests/rls/rpc-transactions.test.ts`; what the API hands back after
      rounding is not.
- [ ] **A membership UI.** `proyecto_usuarios` is currently only writable with
      the service role (see README). Adding and removing members from the app
      needs a screen, and creating a project needs an RPC that writes the
      project and its first admin in one transaction.
