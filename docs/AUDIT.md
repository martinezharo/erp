# Engineering Audit

Last updated: 2026-08-08

This file records findings that should not be changed without an explicit product,
data-model, deployment, or accounting decision. Straightforward defects found in
the same audit are fixed in code and covered by tests rather than duplicated here.

## 1. Framework security upgrade requires a major-version migration

**Priority:** High

`pnpm audit` still reports 14 advisories after safe in-range upgrades reduced the
count from 71. The remaining set includes three high-severity advisories. The
Astro fixes require Astro 6 or 7, while the Cloudflare and Node adapter fixes
require corresponding major adapter upgrades. `sharp` also needs a 0.35 upgrade.
Forcing these versions through package-manager overrides would bypass peer-version
contracts and is not a safe maintenance patch.

**Decision required:** schedule an Astro 7 migration (preferred over an interim
Astro 6 migration), confirm the production Cloudflare adapter configuration, and
run browser-level regression tests before deployment.

## 2. Convex list and reporting queries are not scalable

**Priority:** High as data grows

Several paths in `convex/domain.ts` call `.collect()` for every sale, purchase,
line, movement, or product in a project and then filter, count, sort, join, and
paginate in memory. `stockRowsForProject` additionally filters the complete line
and movement arrays once per product, producing quadratic work. The API appears
paginated, but the backend work is still unbounded and will eventually hit Convex
transaction read limits.

Examples include `listProducts`, `listSales`, `listPurchases`,
`transactionSources`, `computeDailyFinances`, and `stockRowsForProject`.

**Decision required:** choose the reporting model. Options include native cursor
pagination for transactional lists plus Convex aggregate components and
transactionally maintained per-product/per-day summaries for stock and finance.
This changes query contracts and write paths, so it should be designed and
migrated deliberately.

## 3. Time-dependent inventory metrics are computed inside cached queries

**Priority:** Medium

`stockRowsForProject` uses `Date.now()` to define 30-day and 60-day windows.
Convex queries are reactive to database changes, not the passage of wall-clock
time, so an unchanged project can keep stale sales velocity, cost, and remaining
stock-day values. Reading the wall clock also reduces query-cache reuse.

**Decision required:** either pass a caller-controlled `asOf` date and define a
refresh cadence, or materialize daily metrics with a scheduled mutation. The
choice affects API reproducibility and operational scheduling.

## 4. Historical profit uses the latest purchase cost, not cost at sale time

**Priority:** Medium / accounting correctness

`computeDailyFinances` finds one latest purchase cost per product across the full
dataset and applies it to every historical sale. Adding a new purchase can
therefore rewrite prior-day profit without changing those sales. This may be
intentional replacement-cost reporting, but it is not stable historical margin.

**Decision required:** define the accounting rule: replacement cost, weighted
average, FIFO, or cost captured on each sale line. Once selected, add fixtures
that demonstrate how later purchases must affect earlier profit reports.

## 5. Backend authorization depends on one shared bridge secret

**Priority:** Medium

Astro validates the Supabase session and then sends a user id plus a shared
`CONVEX_BRIDGE_SECRET` to public Convex functions. This preserves tenant checks,
but compromise of that one server secret permits actor impersonation across the
entire bridge. Direct JWT verification by Convex would remove that trust
concentration, but requires an authentication migration and token/provider
configuration.

**Decision required:** retain and operationally rotate the bridge secret, or move
to a Convex-compatible JWT provider and derive identity exclusively from
`ctx.auth.getUserIdentity()`.
