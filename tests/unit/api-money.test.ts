import { describe, expect, it } from "vitest";
import {
    actualizarTransaccionSchema,
    crearTransaccionSchema,
    lineaSchema,
} from "../../src/lib/api/schemas";
import {
    serializeCompra,
    serializeFinanzas,
    serializeStock,
    serializeTransaccion,
    serializeVenta,
} from "../../src/lib/api/serializers";

describe("API monetary input", () => {
    it("rounds prices and VAT rates at the validation boundary", () => {
        expect(lineaSchema.parse({
            producto_id: 1,
            unidades: 2,
            precio_unitario: 1.005,
            porcentaje_iva: 21.126,
        })).toMatchObject({ precio_unitario: 1.01, porcentaje_iva: 21.13 });

        expect(crearTransaccionSchema.parse({
            tipo: "ingreso",
            concepto: "Rounding",
            importe: 10.075,
            porcentaje_iva: 4.567,
            fecha: "2026-08-04",
        })).toMatchObject({ importe: 10.08, porcentaje_iva: 4.57 });

        expect(actualizarTransaccionSchema.parse({ importe: 12.344 })).toEqual({ importe: 12.34 });
    });

    it("rejects zero transaction amounts and out-of-range VAT", () => {
        expect(() => crearTransaccionSchema.parse({
            tipo: "gasto", concepto: "Invalid", importe: 0, porcentaje_iva: 21, fecha: "2026-08-04",
        })).toThrow();
        expect(() => lineaSchema.parse({
            producto_id: 1, unidades: 1, precio_unitario: 1, porcentaje_iva: 100.01,
        })).toThrow();
    });
});

describe("API monetary output", () => {
    const line = {
        id: 1,
        producto_id: 2,
        unidades: 3,
        porcentaje_iva: "21",
        precio_unitario_venta: "4.115",
        producto: { nombre: "Widget" },
    };

    it("rounds each VAT-inclusive line and totals the serialized cents", () => {
        const venta = serializeVenta({
            id: 1, proyecto_id: 2, fecha: "2026-08-04", canal: "web", estado: "enviada",
            venta_detalle: [line, { ...line, id: 2 }],
        });

        expect(venta.items[0]).toMatchObject({
            precio_unitario: 4.12,
            total_base: 10.21,
            total_iva: 2.15,
            total: 12.36,
        });
        expect(venta.totales).toEqual({ unidades: 6, base: 20.42, iva: 4.3, total: 24.72 });

        const compra = serializeCompra({
            id: 1, proyecto_id: 2, fecha: "2026-08-04", estado: "recibida",
            compra_detalle: [{ ...line, precio_unitario_venta: undefined, precio_unitario_compra: "4.115" }],
        });
        expect(compra.items[0].total).toBe(12.36);
    });

    it("uses the same gross-to-base formula for other transactions", () => {
        expect(serializeTransaccion({
            id: 1, proyecto_id: 2, tipo: "ingreso", concepto: "Fee", fecha: "2026-08-04",
            importe: "121.005", porcentaje_iva: "21",
        })).toMatchObject({ importe_base: 100.01, importe_iva: 21, importe: 121.01 });
    });

    it("normalizes decimal strings across stock and finance responses", () => {
        expect(serializeStock({ coste_ud: "1.005", venta_ud: "10.075", beneficio_ud: "-1.005" }))
            .toMatchObject({ coste_unitario: 1.01, precio_venta_unitario: 10.08, beneficio_unitario: -1.01 });
        expect(serializeFinanzas({ ingresos: "10.075", gastos: "1.005", balance: "9.07" }))
            .toMatchObject({ ingresos: 10.08, gastos: 1.01, balance: 9.07 });
    });
});
