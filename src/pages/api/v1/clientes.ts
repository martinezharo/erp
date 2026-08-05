import type { APIRoute } from "astro";
import { requireBackend, resolveProjectId } from "../../../lib/api/auth";
import { apiHandler, json, parseQuery } from "../../../lib/api/handler";
import { filtrosClientesSchema } from "../../../lib/api/schemas";
import { paginated } from "../../../lib/api/serializers";

/** GET /api/v1/clientes - customers known for a project. */
export const GET: APIRoute = (context) =>
  apiHandler(context, "read", async (principal) => {
    const { page, page_size, proyecto_id, buscar } = parseQuery(
      context.url,
      filtrosClientesSchema,
    );
    const projectId = resolveProjectId(principal, proyecto_id);
    const { data, count } = await requireBackend(principal).listCustomers({
      projectId,
      page,
      pageSize: page_size,
      search: buscar,
    });

    return json(paginated(data ?? [], count ?? 0, page, page_size));
  });
