import { readFile } from "node:fs/promises";

export const POLICY_MANIFEST_URL = new URL("../db-structure/rls-policies.json", import.meta.url);

const POLICY_QUERY = `
    SELECT schemaname, tablename, policyname, permissive, roles::text[] AS roles,
           cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY schemaname, tablename, policyname
`;

function normalizeExpression(expression) {
    return expression == null ? null : expression.replace(/\s+/g, " ").trim();
}

function normalizePolicy(policy) {
    return {
        schema: policy.schemaname ?? policy.schema,
        table: policy.tablename ?? policy.table,
        name: policy.policyname ?? policy.name,
        permissive: policy.permissive,
        roles: [...policy.roles].sort(),
        command: policy.cmd ?? policy.command,
        using: normalizeExpression(policy.qual ?? policy.using),
        check: normalizeExpression(policy.with_check ?? policy.check),
    };
}

export async function policiesFromDatabase(client) {
    const { rows } = await client.query(POLICY_QUERY);
    return rows.map(normalizePolicy);
}

export async function policiesFromManifest() {
    const contents = await readFile(POLICY_MANIFEST_URL, "utf8");
    return JSON.parse(contents).map(normalizePolicy);
}

function policyKey(policy) {
    return `${policy.schema}.${policy.table}.${policy.name}`;
}

export function policyDifferences(expected, actual) {
    const normalizedExpected = expected.map(normalizePolicy);
    const normalizedActual = actual.map(normalizePolicy);
    const expectedByKey = new Map(normalizedExpected.map((policy) => [policyKey(policy), policy]));
    const actualByKey = new Map(normalizedActual.map((policy) => [policyKey(policy), policy]));
    const differences = [];

    for (const [key, policy] of expectedByKey) {
        const live = actualByKey.get(key);
        if (!live) {
            differences.push(`Missing policy: ${key}`);
        } else if (JSON.stringify(policy) !== JSON.stringify(live)) {
            differences.push(
                `Changed policy: ${key}\n  expected ${JSON.stringify(policy)}\n  received ${JSON.stringify(live)}`,
            );
        }
    }

    for (const key of actualByKey.keys()) {
        if (!expectedByKey.has(key)) differences.push(`Unexpected policy: ${key}`);
    }

    return differences;
}
