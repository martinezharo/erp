import type { APIRoute } from "astro";
import { requireBackend, resolveProjectId } from "../../../../lib/api/auth";
import { ApiError } from "../../../../lib/api/errors";
import { apiHandler, json, parseBody } from "../../../../lib/api/handler";
import { actualizarProductoSchema } from "../../../../lib/api/schemas";

function parseId(raw: string | undefined): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(
      "validation_error",
      "El id del producto debe ser un entero positivo.",
    );
  }
  return id;
}

/** PATCH /api/v1/productos/{id} - maps an existing product to its Wallapop title. */
export const PATCH: APIRoute = (context) =>
  apiHandler(context, "write", async (principal) => {
    const productId = parseId(context.params.id);
    const body = await parseBody(context.request, actualizarProductoSchema);
    const projectId = resolveProjectId(principal, body.proyecto_id);

    const data = await requireBackend(principal).updateProductWallapopTitle(
      projectId,
      productId,
      body.titulo_wallapop,
    );
    return json({ data });
  });
