import {
    ESTADOS_COMPRA,
    ESTADOS_VENTA,
    TIPOS_MOVIMIENTO,
    TIPOS_TRANSACCION,
} from "./schemas";

/**
 * The machine-readable contract for the v1 API.
 *
 * This is what makes the ERP usable by something that was never told about it:
 * point a Custom GPT, an n8n HTTP node or an MCP wrapper at
 * `/api/v1/openapi.json` and it can discover every operation, required field and
 * accepted enum value on its own.
 *
 * The enum lists are imported from `schemas.ts` rather than retyped, so the
 * document cannot fall out of step with what validation actually accepts.
 */

const errorSchema = {
    type: "object",
    properties: {
        error: {
            type: "object",
            required: ["code", "message"],
            properties: {
                code: {
                    type: "string",
                    enum: [
                        "validation_error",
                        "unauthorized",
                        "forbidden",
                        "not_found",
                        "conflict",
                        "idempotency_mismatch",
                        "demo_mode",
                        "not_configured",
                        "internal_error",
                    ],
                },
                message: { type: "string" },
                details: {
                    type: "array",
                    description: "Errores por campo. 'field' usa notación con puntos: 'items.0.unidades'.",
                    items: {
                        type: "object",
                        properties: {
                            field: { type: "string" },
                            message: { type: "string" },
                            expected: { type: "string", description: "Valores o formato aceptados." },
                        },
                    },
                },
                hint: { type: "string", description: "Cómo corregir la petición." },
            },
        },
    },
} as const;

const lineaSchema = {
    type: "object",
    required: ["producto_id", "unidades", "precio_unitario"],
    properties: {
        producto_id: { type: "integer", description: "Id de GET /api/v1/productos." },
        unidades: { type: "integer", minimum: 1 },
        precio_unitario: {
            type: "number",
            minimum: 0,
            description: "Precio por unidad IVA incluido.",
        },
        porcentaje_iva: { type: "number", minimum: 0, maximum: 100, default: 21 },
    },
} as const;

const lineaRespuestaSchema = {
    type: "object",
    properties: {
        id: { type: "integer" },
        producto_id: { type: "integer" },
        producto: { type: "string", nullable: true },
        unidades: { type: "integer" },
        precio_unitario: { type: "number" },
        porcentaje_iva: { type: "number" },
        total_base: { type: "number", description: "Importe sin IVA." },
        total_iva: { type: "number" },
        total: { type: "number", description: "Importe con IVA." },
    },
} as const;

const totalesSchema = {
    type: "object",
    properties: {
        unidades: { type: "integer" },
        base: { type: "number" },
        iva: { type: "number" },
        total: { type: "number" },
    },
} as const;

const paginationSchema = {
    type: "object",
    properties: {
        page: { type: "integer" },
        page_size: { type: "integer" },
        total: { type: "integer" },
        total_pages: { type: "integer" },
        has_more: { type: "boolean" },
    },
} as const;

const fechaSchema = {
    type: "string",
    description: "'YYYY-MM-DD' o ISO 8601. Una fecha sin hora se interpreta como medianoche.",
    examples: ["2026-01-31", "2026-01-31T14:30:00"],
} as const;

/** Reusable query parameters. */
const proyectoIdParam = {
    name: "proyecto_id",
    in: "query",
    schema: { type: "integer" },
    description:
        "Obligatorio salvo que la API key esté fijada a un proyecto, en cuyo caso se ignora si coincide y se rechaza si no.",
} as const;

const paginacionParams = [
    { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
    {
        name: "page_size",
        in: "query",
        schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
    },
] as const;

const rangoFechasParams = [
    { name: "desde", in: "query", schema: fechaSchema, description: "Inicio del rango, inclusive." },
    { name: "hasta", in: "query", schema: fechaSchema, description: "Fin del rango, inclusive." },
] as const;

const idempotencyHeader = {
    name: "Idempotency-Key",
    in: "header",
    required: false,
    schema: { type: "string" },
    description:
        "Identificador único de la operación. Si se repite, se devuelve la respuesta original en lugar de crear un duplicado. Muy recomendable para agentes y automatizaciones que reintentan.",
} as const;

const errorResponses = {
    "400": { description: "Petición inválida", content: { "application/json": { schema: errorSchema } } },
    "401": { description: "Falta autenticación o la key no es válida", content: { "application/json": { schema: errorSchema } } },
    "403": { description: "Permisos insuficientes o proyecto no permitido", content: { "application/json": { schema: errorSchema } } },
    "404": { description: "No encontrado", content: { "application/json": { schema: errorSchema } } },
} as const;

const escrituraResponses = {
    ...errorResponses,
    "409": { description: "Otra petición con la misma Idempotency-Key está en curso", content: { "application/json": { schema: errorSchema } } },
    "422": { description: "Idempotency-Key reutilizada con un cuerpo distinto", content: { "application/json": { schema: errorSchema } } },
} as const;

function listResponse(itemSchema: unknown) {
    return {
        "200": {
            description: "OK",
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        properties: {
                            data: { type: "array", items: itemSchema },
                            pagination: paginationSchema,
                        },
                    },
                },
            },
        },
    };
}

function itemResponse(itemSchema: unknown, status = "200", description = "OK") {
    return {
        [status]: {
            description,
            content: {
                "application/json": {
                    schema: { type: "object", properties: { data: itemSchema } },
                },
            },
        },
    };
}

export function buildOpenApiDocument(serverUrl: string) {
    const ventaSchema = {
        type: "object",
        properties: {
            id: { type: "integer" },
            proyecto_id: { type: "integer" },
            fecha: { type: "string" },
            canal: { type: "string" },
            estado: { type: "string", enum: [...ESTADOS_VENTA] },
            items: { type: "array", items: lineaRespuestaSchema },
            totales: totalesSchema,
        },
    };

    const compraSchema = {
        type: "object",
        properties: {
            id: { type: "integer" },
            proyecto_id: { type: "integer" },
            fecha: { type: "string" },
            estado: { type: "string", enum: [...ESTADOS_COMPRA] },
            items: { type: "array", items: lineaRespuestaSchema },
            totales: totalesSchema,
        },
    };

    const transaccionSchema = {
        type: "object",
        properties: {
            id: { type: "integer" },
            proyecto_id: { type: "integer" },
            tipo: { type: "string", enum: [...TIPOS_TRANSACCION] },
            concepto: { type: "string" },
            descripcion: { type: "string", nullable: true },
            fecha: { type: "string" },
            porcentaje_iva: { type: "number" },
            importe_base: { type: "number" },
            importe_iva: { type: "number" },
            importe: { type: "number", description: "Siempre positivo; el signo lo determina 'tipo'." },
        },
    };

    const stockSchema = {
        type: "object",
        properties: {
            producto_id: { type: "integer" },
            producto: { type: "string" },
            proyecto_id: { type: "integer" },
            stock_actual: { type: "number" },
            coste_unitario: { type: "number", description: "Coste medio de compra de los últimos 60 días." },
            precio_venta_unitario: { type: "number", description: "Precio medio de venta de los últimos 30 días." },
            beneficio_unitario: { type: "number" },
            ventas_30d: { type: "number" },
            venta_diaria_promedio: { type: "number" },
            dias_stock_restante: {
                type: "number",
                description: "Días de cobertura al ritmo actual. 999 significa que no hay ventas recientes.",
            },
            valor_stock: { type: "number" },
        },
    };

    return {
        openapi: "3.1.0",
        info: {
            title: "OlivERP API",
            version: "1.0.0",
            description: [
                "API para automatizar OlivERP desde agentes de IA y herramientas de automatización.",
                "",
                "**Autenticación.** Envía `Authorization: Bearer erp_sk_...` (también se acepta `X-API-Key`).",
                "Una key puede estar fijada a un proyecto; en ese caso `proyecto_id` es opcional y no puede",
                "apuntar a otro proyecto.",
                "",
                "**Reintentos.** Las escrituras aceptan la cabecera `Idempotency-Key`. Reintentar con la misma",
                "clave devuelve la respuesta original en lugar de duplicar el registro.",
                "",
                "**IVA.** Todos los precios se guardan con IVA incluido; las respuestas desglosan base e IVA.",
                "",
                "**Estados.** Solo las ventas en estado `enviada` cuentan como ingreso, y solo las compras en",
                "estado `recibida` cuentan como gasto y mueven stock.",
            ].join("\n"),
        },
        servers: [{ url: serverUrl }],
        security: [{ ApiKeyAuth: [] }],
        components: {
            securitySchemes: {
                ApiKeyAuth: {
                    type: "http",
                    scheme: "bearer",
                    description: "API key con formato erp_sk_...",
                },
            },
            schemas: {
                Error: errorSchema,
                Linea: lineaSchema,
                Venta: ventaSchema,
                Compra: compraSchema,
                Transaccion: transaccionSchema,
                Stock: stockSchema,
            },
        },
        paths: {
            "/api/v1/proyectos": {
                get: {
                    operationId: "listarProyectos",
                    summary: "Lista los proyectos accesibles",
                    description:
                        "Punto de partida: el resto de recursos se filtran por proyecto, así que empieza aquí para obtener los ids válidos.",
                    responses: {
                        "200": {
                            description: "OK",
                            content: {
                                "application/json": {
                                    schema: {
                                        type: "object",
                                        properties: {
                                            data: {
                                                type: "array",
                                                items: {
                                                    type: "object",
                                                    properties: {
                                                        id: { type: "integer" },
                                                        nombre: { type: "string" },
                                                        activo: { type: "boolean" },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        ...errorResponses,
                    },
                },
            },

            "/api/v1/productos": {
                get: {
                    operationId: "listarProductos",
                    summary: "Lista el catálogo de productos",
                    parameters: [
                        proyectoIdParam,
                        { name: "buscar", in: "query", schema: { type: "string" }, description: "Coincidencia parcial en el nombre." },
                        ...paginacionParams,
                    ],
                    responses: {
                        ...listResponse({ type: "object", properties: { id: { type: "integer" }, proyecto_id: { type: "integer" }, nombre: { type: "string" } } }),
                        ...errorResponses,
                    },
                },
                post: {
                    operationId: "crearProducto",
                    summary: "Crea un producto",
                    parameters: [idempotencyHeader],
                    requestBody: {
                        required: true,
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    required: ["nombre"],
                                    properties: {
                                        proyecto_id: { type: "integer" },
                                        nombre: { type: "string", minLength: 1 },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        ...itemResponse({ type: "object" }, "201", "Creado"),
                        ...escrituraResponses,
                    },
                },
            },

            "/api/v1/ventas": {
                get: {
                    operationId: "listarVentas",
                    summary: "Lista ventas",
                    parameters: [
                        proyectoIdParam,
                        ...rangoFechasParams,
                        { name: "estado", in: "query", schema: { type: "string", enum: [...ESTADOS_VENTA] } },
                        { name: "canal", in: "query", schema: { type: "string" } },
                        ...paginacionParams,
                    ],
                    responses: { ...listResponse(ventaSchema), ...errorResponses },
                },
                post: {
                    operationId: "crearVenta",
                    summary: "Registra una venta",
                    description:
                        "La cabecera y las líneas se escriben en una única transacción. El stock lo descuentan los triggers de la base de datos.",
                    parameters: [idempotencyHeader],
                    requestBody: {
                        required: true,
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    required: ["fecha", "canal", "items"],
                                    properties: {
                                        proyecto_id: { type: "integer" },
                                        fecha: fechaSchema,
                                        canal: { type: "string", examples: ["Amazon", "Web", "Wallapop"] },
                                        estado: { type: "string", enum: [...ESTADOS_VENTA], default: "enviada" },
                                        items: { type: "array", minItems: 1, items: lineaSchema },
                                    },
                                },
                                example: {
                                    fecha: "2026-01-31",
                                    canal: "Amazon",
                                    items: [{ producto_id: 1, unidades: 2, precio_unitario: 24.99, porcentaje_iva: 21 }],
                                },
                            },
                        },
                    },
                    responses: { ...itemResponse(ventaSchema, "201", "Creada"), ...escrituraResponses },
                },
            },

            "/api/v1/ventas/{id}": {
                get: {
                    operationId: "obtenerVenta",
                    summary: "Obtiene una venta",
                    parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                    responses: { ...itemResponse(ventaSchema), ...errorResponses },
                },
                patch: {
                    operationId: "actualizarVenta",
                    summary: "Modifica una venta",
                    description:
                        "Omitir 'items' modifica solo la cabecera, que es lo habitual para cambiar el estado (por ejemplo a 'devuelta'). Enviar 'items' sustituye todas las líneas.",
                    parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                    requestBody: {
                        required: true,
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    minProperties: 1,
                                    properties: {
                                        fecha: fechaSchema,
                                        canal: { type: "string" },
                                        estado: { type: "string", enum: [...ESTADOS_VENTA] },
                                        items: { type: "array", minItems: 1, items: lineaSchema },
                                    },
                                },
                                example: { estado: "devuelta" },
                            },
                        },
                    },
                    responses: { ...itemResponse(ventaSchema), ...errorResponses },
                },
            },

            "/api/v1/compras": {
                get: {
                    operationId: "listarCompras",
                    summary: "Lista compras",
                    parameters: [
                        proyectoIdParam,
                        ...rangoFechasParams,
                        { name: "estado", in: "query", schema: { type: "string", enum: [...ESTADOS_COMPRA] } },
                        ...paginacionParams,
                    ],
                    responses: { ...listResponse(compraSchema), ...errorResponses },
                },
                post: {
                    operationId: "crearCompra",
                    summary: "Registra una compra",
                    description: "Solo las compras en estado 'recibida' incrementan stock y cuentan como gasto.",
                    parameters: [idempotencyHeader],
                    requestBody: {
                        required: true,
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    required: ["fecha", "items"],
                                    properties: {
                                        proyecto_id: { type: "integer" },
                                        fecha: fechaSchema,
                                        estado: { type: "string", enum: [...ESTADOS_COMPRA], default: "recibida" },
                                        items: { type: "array", minItems: 1, items: lineaSchema },
                                    },
                                },
                                example: {
                                    fecha: "2026-01-15",
                                    estado: "recibida",
                                    items: [{ producto_id: 1, unidades: 50, precio_unitario: 9.5, porcentaje_iva: 21 }],
                                },
                            },
                        },
                    },
                    responses: { ...itemResponse(compraSchema, "201", "Creada"), ...escrituraResponses },
                },
            },

            "/api/v1/compras/{id}": {
                get: {
                    operationId: "obtenerCompra",
                    summary: "Obtiene una compra",
                    parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                    responses: { ...itemResponse(compraSchema), ...errorResponses },
                },
                patch: {
                    operationId: "actualizarCompra",
                    summary: "Modifica una compra",
                    parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                    requestBody: {
                        required: true,
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    minProperties: 1,
                                    properties: {
                                        fecha: fechaSchema,
                                        estado: { type: "string", enum: [...ESTADOS_COMPRA] },
                                        items: { type: "array", minItems: 1, items: lineaSchema },
                                    },
                                },
                                example: { estado: "recibida" },
                            },
                        },
                    },
                    responses: { ...itemResponse(compraSchema), ...errorResponses },
                },
            },

            "/api/v1/transacciones": {
                get: {
                    operationId: "listarTransacciones",
                    summary: "Lista otros ingresos y gastos",
                    parameters: [
                        proyectoIdParam,
                        ...rangoFechasParams,
                        { name: "tipo", in: "query", schema: { type: "string", enum: [...TIPOS_TRANSACCION] } },
                        ...paginacionParams,
                    ],
                    responses: { ...listResponse(transaccionSchema), ...errorResponses },
                },
                post: {
                    operationId: "crearTransaccion",
                    summary: "Registra un ingreso o gasto",
                    parameters: [idempotencyHeader],
                    requestBody: {
                        required: true,
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    required: ["tipo", "concepto", "importe", "fecha"],
                                    properties: {
                                        proyecto_id: { type: "integer" },
                                        tipo: { type: "string", enum: [...TIPOS_TRANSACCION] },
                                        concepto: { type: "string", minLength: 1 },
                                        descripcion: { type: "string" },
                                        importe: { type: "number", exclusiveMinimum: 0, description: "Siempre positivo." },
                                        porcentaje_iva: { type: "number", minimum: 0, maximum: 100, default: 0 },
                                        fecha: fechaSchema,
                                    },
                                },
                                example: {
                                    tipo: "gasto",
                                    concepto: "Suscripción Shopify",
                                    importe: 32,
                                    porcentaje_iva: 21,
                                    fecha: "2026-01-01",
                                },
                            },
                        },
                    },
                    responses: { ...itemResponse(transaccionSchema, "201", "Creada"), ...escrituraResponses },
                },
            },

            "/api/v1/transacciones/{id}": {
                get: {
                    operationId: "obtenerTransaccion",
                    summary: "Obtiene un ingreso o gasto",
                    parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                    responses: { ...itemResponse(transaccionSchema), ...errorResponses },
                },
                patch: {
                    operationId: "actualizarTransaccion",
                    summary: "Modifica un ingreso o gasto",
                    parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                    requestBody: {
                        required: true,
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    minProperties: 1,
                                    properties: {
                                        tipo: { type: "string", enum: [...TIPOS_TRANSACCION] },
                                        concepto: { type: "string" },
                                        descripcion: { type: "string" },
                                        importe: { type: "number", exclusiveMinimum: 0 },
                                        porcentaje_iva: { type: "number", minimum: 0, maximum: 100 },
                                        fecha: fechaSchema,
                                    },
                                },
                            },
                        },
                    },
                    responses: { ...itemResponse(transaccionSchema), ...errorResponses },
                },
                delete: {
                    operationId: "borrarTransaccion",
                    summary: "Borra un ingreso o gasto",
                    parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
                    responses: { ...itemResponse({ type: "object" }), ...errorResponses },
                },
            },

            "/api/v1/stock": {
                get: {
                    operationId: "consultarStock",
                    summary: "Consulta el stock y su cobertura",
                    description:
                        "Incluye días de cobertura al ritmo de venta actual. Para automatizar reposición, filtra con 'max_dias_stock'.",
                    parameters: [
                        proyectoIdParam,
                        {
                            name: "max_dias_stock",
                            in: "query",
                            schema: { type: "number" },
                            description: "Solo productos que se agotan en este número de días o menos.",
                        },
                        {
                            name: "max_unidades",
                            in: "query",
                            schema: { type: "integer" },
                            description: "Solo productos con este stock o menos.",
                        },
                        ...paginacionParams,
                    ],
                    responses: { ...listResponse(stockSchema), ...errorResponses },
                },
            },

            "/api/v1/stock/ajustes": {
                post: {
                    operationId: "ajustarStock",
                    summary: "Registra un ajuste manual de stock",
                    description:
                        "Para roturas, recuentos o regalos. Los movimientos de ventas y compras los generan los triggers, no este endpoint.",
                    parameters: [idempotencyHeader],
                    requestBody: {
                        required: true,
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    required: ["producto_id", "unidades"],
                                    properties: {
                                        producto_id: { type: "integer" },
                                        unidades: {
                                            type: "integer",
                                            description: "Con signo: positivo suma stock, negativo lo resta. No puede ser 0.",
                                        },
                                        fecha: fechaSchema,
                                    },
                                },
                                example: { producto_id: 1, unidades: -3 },
                            },
                        },
                    },
                    responses: { ...itemResponse({ type: "object" }, "201", "Registrado"), ...escrituraResponses },
                },
            },

            "/api/v1/finanzas": {
                get: {
                    operationId: "consultarFinanzas",
                    summary: "Ingresos, gastos, beneficio y saldo de IVA",
                    description:
                        "Devuelve el desglose diario y los totales del periodo en una sola llamada. Útil para informes y resúmenes periódicos.",
                    parameters: [
                        proyectoIdParam,
                        ...rangoFechasParams,
                        {
                            name: "detalle",
                            in: "query",
                            schema: { type: "string", enum: ["diario", "resumen"], default: "diario" },
                            description: "'resumen' omite el desglose diario y devuelve solo los totales.",
                        },
                    ],
                    responses: {
                        "200": {
                            description: "OK",
                            content: {
                                "application/json": {
                                    schema: {
                                        type: "object",
                                        properties: {
                                            data: {
                                                type: "array",
                                                items: {
                                                    type: "object",
                                                    properties: {
                                                        dia: { type: "string" },
                                                        ingresos: { type: "number" },
                                                        gastos: { type: "number" },
                                                        balance: { type: "number" },
                                                        beneficio_neto: { type: "number" },
                                                        iva_soportado: { type: "number" },
                                                        iva_repercutido: { type: "number" },
                                                        saldo_iva: { type: "number" },
                                                    },
                                                },
                                            },
                                            totales: { type: "object" },
                                            periodo: { type: "object" },
                                        },
                                    },
                                },
                            },
                        },
                        ...errorResponses,
                    },
                },
            },
        },
        "x-enums": {
            estado_venta: [...ESTADOS_VENTA],
            estado_compra: [...ESTADOS_COMPRA],
            tipo_transaccion: [...TIPOS_TRANSACCION],
            tipo_movimiento: [...TIPOS_MOVIMIENTO],
        },
    };
}
