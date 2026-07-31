import { describe, expect, it } from "vitest";
import {
    extractApiKey,
    generateApiKey,
    hashApiKey,
    KEY_PREFIX,
    SCOPES,
} from "../../src/lib/api/keys";

function request(headers: Record<string, string>): Request {
    return new Request("https://example.test/api/v1/proyectos", { headers });
}

describe("generateApiKey", () => {
    it("mints a prefixed key with 24 bytes of entropy", () => {
        const { key } = generateApiKey();
        expect(key.startsWith(KEY_PREFIX)).toBe(true);
        expect(key.slice(KEY_PREFIX.length)).toMatch(/^[0-9a-f]{48}$/);
    });

    it("returns a prefix that identifies the key without revealing it", () => {
        const { key, prefix } = generateApiKey();
        expect(key.startsWith(prefix)).toBe(true);
        // Six hex characters is 24 bits: enough to spot a key in a list, far
        // too little to reconstruct the remaining 168.
        expect(prefix).toHaveLength(KEY_PREFIX.length + 6);
        expect(prefix.length).toBeLessThan(key.length);
    });

    it("never repeats a key", () => {
        const keys = new Set(Array.from({ length: 200 }, () => generateApiKey().key));
        expect(keys.size).toBe(200);
    });
});

describe("hashApiKey", () => {
    it("is a stable SHA-256 hex digest", async () => {
        // Fixed vector: if this changes, every key already in the database stops
        // authenticating, so the test exists to make that break loudly.
        await expect(hashApiKey("erp_sk_abc")).resolves.toBe(
            "842b9bae1461d3699aa2092c7f0c3bdd93ccae2438f7a45bf9e37ae68ec1f63e",
        );
    });

    it("gives different digests to keys differing in one character", async () => {
        const [a, b] = await Promise.all([hashApiKey("erp_sk_aaa"), hashApiKey("erp_sk_aab")]);
        expect(a).not.toBe(b);
    });

    it("never returns the plaintext", async () => {
        const { key } = generateApiKey();
        const hash = await hashApiKey(key);
        expect(hash).not.toContain(key.slice(KEY_PREFIX.length));
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
});

describe("extractApiKey", () => {
    it("reads an Authorization: Bearer header", () => {
        expect(extractApiKey(request({ authorization: "Bearer erp_sk_123" }))).toBe("erp_sk_123");
    });

    it("accepts any casing of the Bearer scheme", () => {
        expect(extractApiKey(request({ authorization: "bearer erp_sk_123" }))).toBe("erp_sk_123");
        expect(extractApiKey(request({ authorization: "BEARER erp_sk_123" }))).toBe("erp_sk_123");
    });

    it("tolerates surrounding and internal whitespace", () => {
        expect(extractApiKey(request({ authorization: "  Bearer    erp_sk_123  " }))).toBe(
            "erp_sk_123",
        );
    });

    it("falls back to X-API-Key, which several automation tools send by default", () => {
        expect(extractApiKey(request({ "x-api-key": " erp_sk_456 " }))).toBe("erp_sk_456");
    });

    it("prefers Authorization when both headers are present", () => {
        const req = request({ authorization: "Bearer erp_sk_auth", "x-api-key": "erp_sk_other" });
        expect(extractApiKey(req)).toBe("erp_sk_auth");
    });

    it("returns null when there is no key to find", () => {
        expect(extractApiKey(request({}))).toBeNull();
        // A bare scheme with no credentials must not fall through to the session
        // path with an empty-string key.
        expect(extractApiKey(request({ authorization: "Bearer" }))).toBeNull();
        expect(extractApiKey(request({ authorization: "Bearer " }))).toBeNull();
        expect(extractApiKey(request({ authorization: "Basic dXNlcjpwYXNz" }))).toBeNull();
    });
});

describe("SCOPES", () => {
    it("is exactly read and write", () => {
        expect([...SCOPES]).toEqual(["read", "write"]);
    });
});
