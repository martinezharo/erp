import { describe, expect, it } from "vitest";
import { escapeHtml } from "../../src/lib/html";

describe("escapeHtml", () => {
    it("escapes markup and both attribute quote styles", () => {
        expect(escapeHtml(`<img src=x onerror="alert('x')"> &`)).toBe(
            "&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt; &amp;",
        );
    });

    it("handles nullish and non-string values", () => {
        expect(escapeHtml(null)).toBe("");
        expect(escapeHtml(42)).toBe("42");
    });
});
