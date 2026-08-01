#!/usr/bin/env node

/** Mints an ERP API key and stores only its SHA-256 hash in Convex. */

import { readFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const KEY_PREFIX = "erp_sk_";
const VALID_SCOPES = ["read", "write"];

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

function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i += 1) {
        if (!argv[i].startsWith("--")) continue;
        const key = argv[i].slice(2);
        const next = argv[i + 1];
        args[key] = next && !next.startsWith("--") ? next : "true";
        if (args[key] !== "true") i += 1;
    }
    return args;
}

function fail(message) {
    throw new Error(`\n✖ ${message}\n`);
}

async function main() {
    loadDotEnv(new URL("../.env", import.meta.url));
    loadDotEnv(new URL("../.env.local", import.meta.url));

    const args = parseArgs(process.argv.slice(2));
    const name = args.nombre ?? args.name;
    if (!name) fail('Falta --nombre. Ejemplo: "pnpm api:key --nombre n8n"');

    const scopes = (args.scopes ?? "read").split(",").map((scope) => scope.trim()).filter(Boolean);
    const invalid = scopes.filter((scope) => !VALID_SCOPES.includes(scope));
    if (invalid.length) fail(`Scopes no validos: ${invalid.join(", ")}. Acepta: read, write.`);

    const projectRaw = args.proyecto ?? args.project;
    const projectId = projectRaw && projectRaw !== "true" ? Number(projectRaw) : undefined;
    if (projectId !== undefined && (!Number.isInteger(projectId) || projectId <= 0)) {
        fail("--proyecto debe ser un id entero positivo.");
    }

    const expiresRaw = args.expira ?? args.expires;
    const expiresAt = expiresRaw && expiresRaw !== "true" ? new Date(expiresRaw).toISOString() : undefined;
    if (expiresRaw && Number.isNaN(new Date(expiresRaw).getTime())) {
        fail("--expira no es una fecha valida (usa YYYY-MM-DD).");
    }

    const convexUrl = process.env.CONVEX_URL || process.env.PUBLIC_CONVEX_URL;
    const bridgeSecret = process.env.CONVEX_BRIDGE_SECRET;
    if (!convexUrl || !bridgeSecret) fail("Faltan CONVEX_URL y CONVEX_BRIDGE_SECRET.");

    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const secret = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    const key = `${KEY_PREFIX}${secret}`;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
    const keyHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");

    const convex = new ConvexHttpClient(convexUrl, { logger: false });
    const data = await convex.mutation(api.domain.createApiKey, {
        bridgeSecret,
        name,
        ...(projectId !== undefined ? { projectLegacyId: projectId } : {}),
        keyHash,
        keyPrefix: key.slice(0, KEY_PREFIX.length + 6),
        scopes,
        ...(expiresAt ? { expiresAt } : {}),
    });

    console.log(`\n✔ API key creada en Convex\n\n  Nombre    : ${data.nombre}\n  Id        : ${data.id}\n  Proyecto  : ${data.proyecto_id ?? "todos"}\n  Permisos  : ${data.scopes.join(", ")}\n  Expira    : ${data.expira_en ?? "nunca"}\n\n  Key       : ${key}\n\n  Guardala ahora: no se puede volver a mostrar.\n`);
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
