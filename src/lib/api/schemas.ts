import { z } from "zod";

/**
 * Request schemas for the v1 API.
 *
 * The enum tuples below are the single source of truth shared by validation and
 * the OpenAPI document, so the accepted values quoted in an error message can
 * never drift from the ones the database actually takes. They mirror the
 * Postgres enums declared in `db-structure/01-schema.sql`.
 */
export const ESTADOS_VENTA = ["pendiente", "enviada", "devuelta", "reembolsada"] as const;
export const ESTADOS_COMPRA = ["pendiente", "recibida", "cancelada"] as const;
export const TIPOS_TRANSACCION = ["ingreso", "gasto"] as const;
export const TIPOS_MOVIMIENTO = [
    "compra",
    "venta",
    "devolucion_vta",
    "ajuste manual",
    "devolucion_com",
] as const;

/**
 * Accepts `2026-01-31` or a full ISO timestamp. Plain dates are widened to
 * midnight so the value always lands cleanly in a `timestamp` column, which
 * spares callers the explicit cast the SQL notes warn about.
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

export const fechaSchema = z
    .string()
    .refine((value) => DATE_ONLY.test(value) || ISO_DATETIME.test(value), {
        message: "Formato de fecha invalido. Usa 'YYYY-MM-DD' o ISO 8601 'YYYY-MM-DDTHH:mm:ss'.",
    })
    .transform((value) => (DATE_ONLY.test(value) ? `${value}T00:00:00` : value));

const idSchema = z.number().int().positive();

const porcentajeIvaSchema = z
    .number()
    .min(0, { message: "El porcentaje de IVA no puede ser negativo." })
    .max(100, { message: "El porcentaje de IVA no puede superar 100." });

/** A single line of a sale or purchase. */
export const lineaSchema = z.object({
    producto_id: idSchema,
    unidades: z
        .number()
        .int({ message: "Las unidades deben ser un numero entero." })
        .positive({ message: "Las unidades deben ser mayores que cero." }),
    precio_unitario: z
        .number()
        .nonnegative({ message: "El precio unitario no puede ser negativo." }),
    porcentaje_iva: porcentajeIvaSchema.default(21),
});

const lineasSchema = z
    .array(lineaSchema)
    .min(1, { message: "Se requiere al menos una linea en 'items'." });

// -----------------------------------------------------------------------------
// Ventas
// -----------------------------------------------------------------------------
export const crearVentaSchema = z.object({
    proyecto_id: idSchema.optional(),
    fecha: fechaSchema,
    canal: z.string().min(1, { message: "El canal no puede estar vacio." }),
    estado: z.enum(ESTADOS_VENTA).default("enviada"),
    items: lineasSchema,
});

export const actualizarVentaSchema = z
    .object({
        fecha: fechaSchema.optional(),
        canal: z.string().min(1).optional(),
        estado: z.enum(ESTADOS_VENTA).optional(),
        items: lineasSchema.optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
        message: "Indica al menos un campo a modificar.",
    });

// -----------------------------------------------------------------------------
// Compras
// -----------------------------------------------------------------------------
export const crearCompraSchema = z.object({
    proyecto_id: idSchema.optional(),
    fecha: fechaSchema,
    estado: z.enum(ESTADOS_COMPRA).default("recibida"),
    items: lineasSchema,
});

export const actualizarCompraSchema = z
    .object({
        fecha: fechaSchema.optional(),
        estado: z.enum(ESTADOS_COMPRA).optional(),
        items: lineasSchema.optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
        message: "Indica al menos un campo a modificar.",
    });

// -----------------------------------------------------------------------------
// Otros ingresos y gastos
// -----------------------------------------------------------------------------
export const crearTransaccionSchema = z.object({
    proyecto_id: idSchema.optional(),
    tipo: z.enum(TIPOS_TRANSACCION),
    concepto: z.string().min(1, { message: "El concepto no puede estar vacio." }),
    descripcion: z.string().optional(),
    importe: z.number().positive({
        message: "El importe siempre es positivo; el signo lo determina 'tipo'.",
    }),
    porcentaje_iva: porcentajeIvaSchema.default(0),
    fecha: fechaSchema,
});

export const actualizarTransaccionSchema = z
    .object({
        tipo: z.enum(TIPOS_TRANSACCION).optional(),
        concepto: z.string().min(1).optional(),
        descripcion: z.string().optional(),
        importe: z.number().positive().optional(),
        porcentaje_iva: porcentajeIvaSchema.optional(),
        fecha: fechaSchema.optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
        message: "Indica al menos un campo a modificar.",
    });

// -----------------------------------------------------------------------------
// Productos y stock
// -----------------------------------------------------------------------------
export const crearProductoSchema = z.object({
    proyecto_id: idSchema.optional(),
    nombre: z.string().min(1, { message: "El nombre no puede estar vacio." }),
});

export const ajustarStockSchema = z.object({
    producto_id: idSchema,
    /** Signed: positive adds stock, negative removes it. Zero is a no-op. */
    unidades: z
        .number()
        .int({ message: "Las unidades deben ser un numero entero." })
        .refine((value) => value !== 0, {
            message: "El ajuste no puede ser cero. Usa un valor positivo para sumar stock o negativo para restarlo.",
        }),
    fecha: fechaSchema.optional(),
});

// -----------------------------------------------------------------------------
// Query strings
// -----------------------------------------------------------------------------
/** Query params arrive as strings, so these coerce before validating. */
export const paginacionSchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(100).default(20),
});

export const filtrosSchema = paginacionSchema.extend({
    proyecto_id: z.coerce.number().int().positive().optional(),
    desde: fechaSchema.optional(),
    hasta: fechaSchema.optional(),
});

export const filtrosVentasSchema = filtrosSchema.extend({
    estado: z.enum(ESTADOS_VENTA).optional(),
    canal: z.string().min(1).optional(),
});

export const filtrosComprasSchema = filtrosSchema.extend({
    estado: z.enum(ESTADOS_COMPRA).optional(),
});

export const filtrosTransaccionesSchema = filtrosSchema.extend({
    tipo: z.enum(TIPOS_TRANSACCION).optional(),
});

export type Linea = z.infer<typeof lineaSchema>;
