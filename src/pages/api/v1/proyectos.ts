import type { APIRoute } from "astro";
import { requireBackend } from "../../../lib/api/auth";
import { apiHandler, json } from "../../../lib/api/handler";

/**
 * GET /api/v1/proyectos
 *
 * The entry point for any caller: every other resource is scoped by project, so
 * an agent starts here to learn the ids it may use. A pinned key sees only its
 * own project.
 */
export const GET: APIRoute = (context) =>
    apiHandler(context, "read", async (principal) => {
        const data = await requireBackend(principal).listProjects();
        return json({
            data: principal.projectId === null
                ? data
                : data.filter((project) => project.id === principal.projectId),
        });
    });
