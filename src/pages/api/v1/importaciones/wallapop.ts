import type { APIRoute } from "astro";
import { requireBackend, resolveProjectId } from "../../../../lib/api/auth";
import { ApiError } from "../../../../lib/api/errors";
import {
  apiHandler,
  json,
  parseBody,
  withIdempotency,
} from "../../../../lib/api/handler";
import { importarVentaWallapopSchema } from "../../../../lib/api/schemas";
import { serializeVenta } from "../../../../lib/api/serializers";

/**
 * POST /api/v1/importaciones/wallapop
 *
 * Receives the structured fields extracted by Gmail/n8n from a Wallapop sale
 * confirmation. Convex matches the exact listing title, upserts the buyer and
 * creates the sale and stock movement atomically.
 */
export const POST: APIRoute = (context) =>
  apiHandler(context, "write", async (principal) => {
    const body = await parseBody(context.request, importarVentaWallapopSchema);
    const projectId = resolveProjectId(principal, body.proyecto_id);

    return withIdempotency(
      context,
      principal,
      "POST /api/v1/importaciones/wallapop",
      body,
      async () => {
        const result = await requireBackend(principal).importWallapopSale({
          projectId,
          originId: body.origen_id,
          date: body.fecha,
          customerName: body.comprador_nombre,
          wallapopTitle: body.titulo_wallapop,
          totalAmount: body.importe_total,
          units: body.unidades,
          vatRate: body.porcentaje_iva,
          status: body.estado,
        });
        const sale = await requireBackend(principal).getSale(result.id);
        if (!sale) {
          throw new ApiError(
            "internal_error",
            "La importación no devolvió la venta creada.",
          );
        }

        return json(
          { data: serializeVenta(sale), importada: result.created },
          result.created ? 201 : 200,
        );
      },
    );
  });
