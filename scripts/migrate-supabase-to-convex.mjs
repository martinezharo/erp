#!/usr/bin/env node

/**
 * Copies the application data from Supabase into the Convex legacy-shaped
 * model. It requires a server-side Supabase key because the public key is
 * correctly denied by the project's RLS policies.
 *
 * Usage:
 *   SUPABASE_SECRET_KEY=... pnpm migrate:supabase
 *
 * `CONVEX_PRODUCTION_URL` is preferred over the local `CONVEX_URL` written by
 * `convex dev`. Use `--convex-url` when importing into another deployment.
 *
 * The script is resumable: every Convex import mutation upserts by the
 * original numeric id. Idempotency rows are intentionally not copied because
 * their old UUIDs are not part of the application contract and replaying stale
 * responses is less safe than starting with an empty retry ledger.
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const BATCH_SIZE = 100;
const PAGE_SIZE = 1000;

function loadDotEnv(path) {
    try {
        const contents = readFileSync(path, "utf8");
        for (const line of contents.split("\n")) {
            const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
            if (!match) continue;
            const value = match[2].replace(/^['"]|['"]$/g, "");
            if (!process.env[match[1]]) process.env[match[1]] = value;
        }
    } catch {
        // Ambient environment variables are enough in CI.
    }
}

function fail(message) {
    throw new Error(`Migracion detenida: ${message}`);
}

function option(name) {
    const index = process.argv.indexOf(name);
    if (index === -1) return undefined;
    const value = process.argv[index + 1];
    if (!value || value.startsWith("--")) fail(`falta el valor de ${name}.`);
    return value;
}

async function importRows(convex, reference, label, rows, bridgeSecret, alreadyImported) {
    for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
        const batch = rows.slice(offset, offset + BATCH_SIZE);
        const imported = await convex.mutation(reference, { bridgeSecret, rows: batch });
        if (imported !== batch.length) {
            fail(`${label}: Convex confirmo ${imported} filas para un lote de ${batch.length}.`);
        }
        console.log(`  ${label}: ${alreadyImported + Math.min(offset + batch.length, rows.length)} filas`);
    }
}

async function importTable(supabase, convex, sourceTable, label, reference, bridgeSecret) {
    let offset = 0;
    let imported = 0;

    for (;;) {
        const { data, error } = await supabase
            .from(sourceTable)
            .select("*")
            .range(offset, offset + PAGE_SIZE - 1);
        if (error) fail(`${sourceTable}: ${error.message}`);

        const rows = data ?? [];
        await importRows(convex, reference, label, rows, bridgeSecret, imported);
        imported += rows.length;
        if (rows.length < PAGE_SIZE) break;
        offset += rows.length;
    }

    console.log(`${sourceTable}: ${imported} filas totales`);
}

async function main() {
    loadDotEnv(new URL("../.env", import.meta.url));
    loadDotEnv(new URL("../.env.local", import.meta.url));

    const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    const convexUrl =
        option("--convex-url") ||
        process.env.CONVEX_MIGRATION_URL ||
        process.env.CONVEX_PRODUCTION_URL ||
        [process.env.CONVEX_URL, process.env.PUBLIC_CONVEX_URL].find((value) =>
            value?.startsWith("https://"),
        );
    const bridgeSecret = process.env.CONVEX_BRIDGE_SECRET;

    if (!supabaseUrl || !supabaseKey) {
        fail("faltan PUBLIC_SUPABASE_URL y SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY.");
    }
    if (!convexUrl || !bridgeSecret) {
        fail(
            "faltan una URL HTTPS de Convex (CONVEX_PRODUCTION_URL, CONVEX_MIGRATION_URL, --convex-url) y CONVEX_BRIDGE_SECRET.",
        );
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
    const convex = new ConvexHttpClient(convexUrl, { logger: false });

    const sourceTables = [
        ["proyectos", "projects", api.migration.importProjects],
        ["proyecto_usuarios", "members", api.migration.importMembers],
        ["productos", "products", api.migration.importProducts],
        ["ventas", "sales", api.migration.importSales],
        ["venta_detalle", "sale lines", api.migration.importSaleLines],
        ["compras", "purchases", api.migration.importPurchases],
        ["compra_detalle", "purchase lines", api.migration.importPurchaseLines],
        ["otros_ingresos_gastos", "other transactions", api.migration.importTransactions],
        ["movimientos_stock", "stock movements", api.migration.importMovements],
        ["api_keys", "API keys", api.migration.importApiKeys],
    ];

    console.log(`Migrando Supabase -> Convex (${convexUrl})`);
    for (const [sourceTable, label, reference] of sourceTables) {
        await importTable(supabase, convex, sourceTable, label, reference, bridgeSecret);
    }

    console.log("\nMigracion completada. idempotency_keys no se copia por seguridad.");
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
