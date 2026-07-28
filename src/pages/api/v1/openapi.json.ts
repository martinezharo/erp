import type { APIRoute } from "astro";
import { buildOpenApiDocument } from "../../../lib/api/openapi";

/**
 * GET /api/v1/openapi.json
 *
 * Deliberately public: a client has to be able to read the contract before it
 * has credentials, and the document describes the shape of the API without
 * exposing any data. The server URL is taken from the request so the spec works
 * unchanged in local development and in production.
 */
export const GET: APIRoute = ({ url }) => {
    const document = buildOpenApiDocument(url.origin);

    return new Response(JSON.stringify(document, null, 2), {
        status: 200,
        headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=300",
            "Access-Control-Allow-Origin": "*",
        },
    });
};
