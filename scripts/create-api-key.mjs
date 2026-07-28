#!/usr/bin/env node
/**
 * Mints an API key for the v1 API.
 *
 * The secret is printed once and never stored: the database only ever holds its
 * SHA-256 hash, so a leaked backup does not hand over working credentials, and a
 * lost key has to be replaced rather than recovered.
 *
 * Usage:
 *   node scripts/create-api-key.mjs --nombre "n8n" --proyecto 1 --scopes read,write
 *   node scripts/create-api-key.mjs --nombre "Informes" --scopes read --expira 2027-01-01
 *
 * Requires PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, read from the
 * environment or from a local .env file.
 *
 * The key format and hashing must stay in step with src/lib/api/keys.ts.
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const KEY_PREFIX = "erp_sk_";
const VALID_SCOPES = ["read", "write"];

function loadDotEnv() {
    try {
        const contents = readFileSync(new URL("../.env", import.meta.url), "utf8");
        for (const line of contents.split("\n")) {
            const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
            if (!match) continue;
            const value = match[2].replace(/^["']|["']$/g, "");
            if (!process.env[match[1]]) process.env[match[1]] = value;
        }
    } catch {
        // No .env file; rely on the ambient environment.
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
    console.error(`\n✖ ${message}\n`);
    process.exit(1);
}

async function main() {
    loadDotEnv();

    const args = parseArgs(process.argv.slice(2));
    const nombre = args.nombre ?? args.name;
    if (!nombre) {
        fail("Falta --nombre. Ejemplo: --nombre \"n8n stock\"");
    }

    const scopes = (args.scopes ?? "read").split(",").map((s) => s.trim()).filter(Boolean);
    const invalid = scopes.filter((s) => !VALID_SCOPES.includes(s));
    if (invalid.length > 0) {
        fail(`Scopes no validos: ${invalid.join(", ")}. Acepta: ${VALID_SCOPES.join(", ")}`);
    }

    const proyectoRaw = args.proyecto ?? args.project;
    let proyectoId = null;
    if (proyectoRaw && proyectoRaw !== "true") {
        proyectoId = Number(proyectoRaw);
        if (!Number.isInteger(proyectoId) || proyectoId <= 0) {
            fail("--proyecto debe ser un id entero positivo.");
        }
    }

    const expiraRaw = args.expira ?? args.expires;
    let expiraEn = null;
    if (expiraRaw && expiraRaw !== "true") {
        const parsed = new Date(expiraRaw);
        if (Number.isNaN(parsed.getTime())) fail("--expira no es una fecha valida (usa YYYY-MM-DD).");
        expiraEn = parsed.toISOString();
    }

    const url = process.env.PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
        fail("Faltan PUBLIC_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY.");
    }

    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const secret = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const key = `${KEY_PREFIX}${secret}`;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
    const keyHash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");

    const supabase = createClient(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase
        .from("api_keys")
        .insert({
            nombre,
            key_hash: keyHash,
            key_prefix: key.slice(0, KEY_PREFIX.length + 6),
            proyecto_id: proyectoId,
            scopes,
            expira_en: expiraEn,
        })
        .select("id, nombre, proyecto_id, scopes, expira_en")
        .single();

    if (error) {
        fail(`No se pudo crear la key: ${error.message}`);
    }

    console.log(`
✔ API key creada

  Nombre    : ${data.nombre}
  Id        : ${data.id}
  Proyecto  : ${data.proyecto_id ?? "todos"}
  Permisos  : ${data.scopes.join(", ")}
  Expira    : ${data.expira_en ?? "nunca"}

  Key       : ${key}

  Guardala ahora: no se puede volver a mostrar.

  Prueba:
    curl -H "Authorization: Bearer ${key}" \\
      http://localhost:4321/api/v1/proyectos
`);
}

main().catch((error) => fail(error.message));
