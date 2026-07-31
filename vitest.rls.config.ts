import { defineConfig } from "vitest/config";

/**
 * The database suite runs against a real Postgres, so it is a separate project
 * from the unit tests: it is slower, it needs a server, and `npm test` (which
 * the pre-push hook runs) must stay runnable with nothing but node_modules.
 *
 * See tests/rls/README.md for how to point it at a database.
 */
export default defineConfig({
    test: {
        include: ["tests/rls/**/*.test.ts"],
        environment: "node",
        globals: true,
        // One connection, one schema load, many assertions.
        fileParallelism: false,
        testTimeout: 30_000,
        hookTimeout: 120_000,
    },
});
