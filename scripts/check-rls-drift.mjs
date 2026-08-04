import { Client } from "pg";
import {
    policiesFromDatabase,
    policiesFromManifest,
    policyDifferences,
} from "./rls-policy-manifest.mjs";

const connectionString = process.env.RLS_POLICY_DATABASE_URL;

if (!connectionString) {
    console.error("RLS_POLICY_DATABASE_URL is required (the check is read-only).");
    process.exitCode = 2;
} else {
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const expected = await policiesFromManifest();
        const actual = await policiesFromDatabase(client);
        const differences = policyDifferences(expected, actual);

        if (differences.length > 0) {
            console.error("Production RLS policies differ from db-structure:\n");
            console.error(differences.join("\n\n"));
            process.exitCode = 1;
        } else {
            console.log(`RLS policy manifest matches (${actual.length} policies).`);
        }
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    } finally {
        await client.end().catch(() => undefined);
    }
}
