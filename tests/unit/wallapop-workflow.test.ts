import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const workflow = JSON.parse(
  await readFile(
    new URL(
      "../../automations/n8n/wallapop-gmail-to-erp.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  nodes: Array<{ name: string; parameters?: { jsCode?: string } }>;
};

const parserCode = workflow.nodes.find(
  (node) => node.name === "Parse Wallapop sale",
)?.parameters?.jsCode;

if (!parserCode) throw new Error("The Wallapop workflow has no parser node.");

function parseMessage(message: Record<string, unknown>) {
  const run = new Function("$json", "$env", parserCode!);
  return run(message, { ERP_PROJECT_ID: "7" }) as Array<{
    json: Record<string, unknown>;
  }>;
}

describe("Wallapop n8n parser", () => {
  it("parses a plain-text confirmation", () => {
    const [item] = parseMessage({
      id: "gmail-plain-1",
      textPlain: [
        "Venta confirmada",
        "Comprado por:",
        "Antonio R.",
        "Mando Xiaomi XMRM-006 a Estrenar 3,49 €",
        "Fecha de compra: 03/08/2026",
      ].join("\n"),
    });

    expect(item.json).toMatchObject({
      proyecto_id: 7,
      origen_id: "gmail-plain-1",
      fecha: "2026-08-03",
      comprador_nombre: "Antonio R.",
      titulo_wallapop: "Mando Xiaomi XMRM-006 a Estrenar",
      importe_total: 3.49,
      unidades: 1,
      estado: "pendiente",
    });
  });

  it("parses an HTML-shaped confirmation and decimal-dot prices", () => {
    const [item] = parseMessage({
      messageId: "gmail-html-1",
      textHtml: [
        "<div>Comprado por:</div>",
        "<div>María</div>",
        "<div>Mando LG MR20GA con Micrófono y Puntero a Estrenar 12.90 &euro;</div>",
        "<div>Fecha de compra: 4/8/2026</div>",
      ].join(""),
    });

    expect(item.json).toMatchObject({
      origen_id: "gmail-html-1",
      fecha: "2026-08-04",
      comprador_nombre: "María",
      titulo_wallapop: "Mando LG MR20GA con Micrófono y Puntero a Estrenar",
      importe_total: 12.9,
    });
  });

  it("fails closed when the email shape is not recognized", () => {
    expect(() =>
      parseMessage({ id: "invalid", textPlain: "Venta confirmada" }),
    ).toThrow("No se encontro el bloque Comprado por");
  });
});
