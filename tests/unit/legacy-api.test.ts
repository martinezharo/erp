import { beforeEach, describe, expect, it, vi } from "vitest";

const createBackend = vi.fn(() => ({ kind: "backend" }));
vi.mock("../../src/lib/convex", () => ({ createBackend }));
vi.mock("../../src/lib/supabase", () => ({ isDemoMode: false }));

const { parsePositiveInteger, sessionBackend } = await import("../../src/lib/legacy-api");

beforeEach(() => createBackend.mockClear());

describe("sessionBackend", () => {
    it("reuses the user already validated by middleware", async () => {
        const context = { locals: { user: { id: "user-1" } }, cookies: {} } as never;
        await expect(sessionBackend(context)).resolves.toEqual({
            backend: { kind: "backend" },
            userId: "user-1",
        });
        expect(createBackend).toHaveBeenCalledWith(
            expect.objectContaining({ user: { id: "user-1" } }),
            { kind: "session", userId: "user-1" },
        );
    });

    it("fails closed when middleware did not attach a user", async () => {
        await expect(sessionBackend({ locals: {}, cookies: {} } as never)).resolves.toBeNull();
        expect(createBackend).not.toHaveBeenCalled();
    });
});

describe("parsePositiveInteger", () => {
    it("normalizes ids coming from HTML dataset attributes", () => {
        expect(parsePositiveInteger("42")).toBe(42);
        expect(parsePositiveInteger(42)).toBe(42);
    });

    it("rejects missing, fractional and non-numeric ids", () => {
        expect(parsePositiveInteger(undefined)).toBeNull();
        expect(parsePositiveInteger("0")).toBeNull();
        expect(parsePositiveInteger("1.5")).toBeNull();
        expect(parsePositiveInteger("purchase-42")).toBeNull();
    });
});
