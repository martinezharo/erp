import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["tests/**/*.test.ts"],
        // The database suite needs a live Postgres and runs as its own project;
        // see vitest.rls.config.ts and tests/rls/README.md.
        exclude: ["node_modules/**", "tests/rls/**"],
        environment: "node",
        globals: true,
    },
});
