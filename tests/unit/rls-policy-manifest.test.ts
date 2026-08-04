import { describe, expect, it } from "vitest";
import { policyDifferences } from "../../scripts/rls-policy-manifest.mjs";

const policy = {
    schema: "public",
    table: "productos",
    name: "productos_all",
    permissive: "PERMISSIVE",
    roles: ["authenticated"],
    command: "ALL",
    using: "proyecto_id IN (SELECT mis_proyectos())",
    check: "proyecto_id IN (SELECT mis_proyectos())",
};

describe("RLS policy drift", () => {
    it("reports unexpected production policies", () => {
        const unexpected = { ...policy, name: "dashboard_override" };

        expect(policyDifferences([policy], [policy, unexpected])).toEqual([
            "Unexpected policy: public.productos.dashboard_override",
        ]);
    });

    it("reports predicate changes while ignoring whitespace", () => {
        expect(policyDifferences([policy], [{ ...policy, using: "  proyecto_id IN (SELECT mis_proyectos())  " }]))
            .toEqual([]);
        expect(policyDifferences([policy], [{ ...policy, using: "true" }])[0])
            .toContain("Changed policy: public.productos.productos_all");
    });
});
