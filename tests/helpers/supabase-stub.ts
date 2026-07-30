/**
 * A minimal stand-in for a Supabase client.
 *
 * The API layer only ever uses the PostgREST builder (`from().select().eq()`,
 * `insert`, `update`, `delete`, `maybeSingle`), so the stub records each call as
 * a plain `QueryOp` and hands it to a resolver the test supplies. That keeps the
 * assertions about *what the code asked the database for* — which key hash it
 * looked up, which row it tried to reserve — rather than about the shape of the
 * Supabase SDK.
 */

export type QueryKind = "select" | "insert" | "update" | "delete";

export interface QueryOp {
    table: string;
    kind: QueryKind;
    /** Row(s) passed to `insert` / `update`. */
    payload?: unknown;
    /** Column list passed to `select`. */
    columns?: string;
    /** `eq` filters, in the order they were applied. */
    filters: Array<[string, unknown]>;
    /** True once `maybeSingle()` or `single()` narrowed the query. */
    single: boolean;
}

export interface QueryResult {
    data?: unknown;
    error?: { code?: string; message: string } | null;
}

export type Resolver = (op: QueryOp) => QueryResult | Promise<QueryResult>;

export interface SupabaseStub {
    /** Every operation the code under test performed, in order. */
    ops: QueryOp[];
    from(table: string): Record<string, (...args: unknown[]) => unknown>;
    /** Ops filtered by table and kind, for concise assertions. */
    opsFor(table: string, kind?: QueryKind): QueryOp[];
}

const EMPTY: QueryResult = { data: null, error: null };

export function createSupabaseStub(resolve: Resolver = () => EMPTY): SupabaseStub {
    const ops: QueryOp[] = [];

    function chainFor(op: QueryOp) {
        // Thenable, so `await builder.eq(...)` resolves the same way an
        // un-narrowed PostgREST query does.
        const chain = {
            eq(column: string, value: unknown) {
                op.filters.push([column, value]);
                return chain;
            },
            select(columns?: string) {
                op.columns = columns;
                return chain;
            },
            maybeSingle() {
                op.single = true;
                return Promise.resolve(resolve(op));
            },
            single() {
                op.single = true;
                return Promise.resolve(resolve(op));
            },
            then<T>(
                onFulfilled?: (value: QueryResult) => T,
                onRejected?: (reason: unknown) => T,
            ) {
                return Promise.resolve(resolve(op)).then(onFulfilled, onRejected);
            },
        };
        return chain;
    }

    function start(table: string, kind: QueryKind, payload?: unknown, columns?: string) {
        const op: QueryOp = { table, kind, payload, columns, filters: [], single: false };
        ops.push(op);
        return chainFor(op);
    }

    return {
        ops,
        opsFor(table, kind) {
            return ops.filter((op) => op.table === table && (!kind || op.kind === kind));
        },
        from(table: string) {
            return {
                select: (columns?: string) => start(table, "select", undefined, columns),
                insert: (payload: unknown) => start(table, "insert", payload),
                update: (payload: unknown) => start(table, "update", payload),
                delete: () => start(table, "delete"),
            } as Record<string, (...args: unknown[]) => unknown>;
        },
    };
}
