# OlivERP API v1

An API designed to let AI agents and automation tools (n8n, Make, Zapier,
Custom GPTs) operate the ERP without using the web interface.

The complete, always up-to-date contract is available at:

```
GET /api/v1/openapi.json
```

This endpoint is intentionally public: a client must be able to read the
contract before it has credentials. It does not expose any data.

---

## Getting started

### 1. Configure the Convex bridge

Requests authenticated with an ERP API key are resolved by the Astro server and
authorized in Convex. Configure the same random value in Convex and the Astro
deployment:

```env
CONVEX_URL=https://your-deployment.convex.cloud
CONVEX_BRIDGE_SECRET=long-random-server-secret
```

`CONVEX_BRIDGE_SECRET` is server-only. Do not prefix it with `PUBLIC_` or put it
in a browser bundle. The existing Supabase public key is still required for the
login/session bridge.

### 2. Create an API key

```bash
pnpm api:key --nombre "n8n stock" --proyecto 1 --scopes read,write
```

Options:

| Flag         | Description                                                        |
| :----------- | :----------------------------------------------------------------- |
| `--nombre`   | Required. Used to identify the key later.                       |
| `--proyecto` | ID of the project to which the key is bound. Omit for all.       |
| `--scopes`   | `read`, `write`, or `read,write`. Defaults to `read`.            |
| `--expira`   | Expiration date (`YYYY-MM-DD`). Does not expire by default.      |

The key is shown **only once**: only its SHA-256 hash is stored in Convex. API
keys can be inspected or deactivated from the Convex dashboard while the
management UI is being completed.

---

## Authentication

```bash
curl -H "Authorization: Bearer erp_sk_..." https://your-erp/api/v1/proyectos
```

`X-API-Key: erp_sk_...` is also accepted and is the default header sent by
several automation tools.

The web interface continues to work with its Supabase cookie session; the same
endpoints support both types of caller. Supabase is no longer the ERP data
store.

### Permissions

- `read` → `GET` methods.
- `write` → `POST`, `PATCH`, and `DELETE` methods.

### Binding a key to a project

A key bound to a project (`--proyecto 1`) cannot read or write data in another
one. For these keys, `proyecto_id` is optional in requests; if it is provided
and does not match, the request is rejected instead of being silently rewritten.

This is the recommended configuration for agents: it grants access to a single
business without exposing the rest.

---

## Endpoints

| Method   | Path                          | Description                                      |
| :------- | :---------------------------- | :----------------------------------------------- |
| `GET`    | `/api/v1/proyectos`           | Accessible projects. Start here.                 |
| `GET`    | `/api/v1/productos`           | Product catalog. Supports the `buscar` filter.   |
| `POST`   | `/api/v1/productos`           | Creates a product.                               |
| `PATCH`  | `/api/v1/productos/{id}`      | Assigns a Wallapop listing title to a product.   |
| `GET`    | `/api/v1/clientes`            | Known customers for a project.                  |
| `GET`    | `/api/v1/ventas`              | Sales. Supports date, status, and channel filters. |
| `POST`   | `/api/v1/ventas`              | Records a sale transactionally.                  |
| `GET`    | `/api/v1/ventas/{id}`         | Returns sale details.                            |
| `PATCH`  | `/api/v1/ventas/{id}`         | Updates the header and/or line items.             |
| `GET`    | `/api/v1/compras`             | Purchases.                                       |
| `POST`   | `/api/v1/compras`             | Records a purchase transactionally.              |
| `GET`    | `/api/v1/compras/{id}`        | Returns purchase details.                        |
| `PATCH`  | `/api/v1/compras/{id}`        | Updates the header and/or line items.             |
| `GET`    | `/api/v1/transacciones`       | Other income and expenses.                       |
| `POST`   | `/api/v1/transacciones`       | Records income or an expense.                    |
| `GET`    | `/api/v1/transacciones/{id}`  | Returns transaction details.                     |
| `PATCH`  | `/api/v1/transacciones/{id}`  | Updates a transaction.                           |
| `DELETE` | `/api/v1/transacciones/{id}`  | Deletes a transaction.                           |
| `GET`    | `/api/v1/stock`               | Stock and days of inventory coverage.            |
| `POST`   | `/api/v1/stock/ajustes`       | Applies a manual stock adjustment.               |
| `GET`    | `/api/v1/finanzas`            | Income, expenses, profit, and VAT balance.        |
| `POST`   | `/api/v1/importaciones/wallapop` | Imports a confirmed Wallapop sale from Gmail. |

List endpoints always return the same envelope:

```json
{
  "data": [ ... ],
  "pagination": { "page": 1, "page_size": 20, "total": 132, "total_pages": 7, "has_more": true }
}
```

---

## Important conventions

**Prices include VAT.** This is how the schema stores them. Responses break out
`total_base`, `total_iva`, and `total`, so clients do not have to derive them.

**Statuses determine what counts.** Only sales with the `enviada` status count
as income, and only purchases with the `recibida` status count as expenses and
move stock. A return is a status `PATCH` to `devuelta`, not a deletion.

**Stock moves automatically.** Database triggers generate movements for sales
and purchases. `POST /api/v1/stock/ajustes` is only for manual corrections
(breakage, stock counts, and giveaways).

**Wallapop titles are exact mappings.** The Gmail workflow sends the complete
listing title. It must first be assigned to the matching product through
`PATCH /api/v1/productos/{id}`; an unknown title is rejected instead of being
silently attached to the wrong product.

**Dates accept `YYYY-MM-DD` or ISO 8601.** A date without a time is interpreted
as midnight.

**`importe` is always positive** in transactions; `tipo` determines its sign.

---

## Safe retries (`Idempotency-Key`)

When a request times out, the caller does not know whether the sale was
recorded. Retrying blindly could duplicate it. To avoid this, send a unique key
for each operation:

```bash
curl -X POST https://your-erp/api/v1/ventas \
  -H "Authorization: Bearer erp_sk_..." \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: venta-shopify-10432" \
  -d '{
    "fecha": "2026-01-31",
    "canal": "Web",
    "items": [{ "producto_id": 1, "unidades": 2, "precio_unitario": 24.99 }]
  }'
```

Repeating this call returns the original response with the
`Idempotency-Replayed: true` header without creating a second sale.

- Same key with a different body → `422 idempotency_mismatch`.
- Same key while the first request is still in progress → `409 conflict`.
- If the request fails, the key is released and can be reused.

A good value is the order ID from the source system, which is naturally unique
and stable across retries.

The Convex idempotency ledger can be inspected and cleaned from the Convex
dashboard; the migration intentionally starts it empty.

---

## Errors

All errors use the same structure:

```json
{
  "error": {
    "code": "validation_error",
    "message": "El cuerpo de la peticion no es valido.",
    "details": [
      {
        "field": "items.0.unidades",
        "message": "Las unidades deben ser un numero entero."
      },
      {
        "field": "estado",
        "message": "Invalid option: expected one of \"pendiente\"|\"enviada\"|\"devuelta\"|\"reembolsada\"",
        "expected": "\"pendiente\" | \"enviada\" | \"devuelta\" | \"reembolsada\""
      }
    ],
    "hint": "Revisa los campos listados en 'details'."
  }
}
```

`field` uses dot notation, so it points directly to the relevant part of the
submitted JSON. `expected` lists the accepted values for a constrained field,
allowing a model to correct the call instead of retrying it unchanged.

| Code                   | HTTP | Meaning                                             |
| :--------------------- | :--- | :-------------------------------------------------- |
| `validation_error`     | 400  | Invalid request body or query.                      |
| `unauthorized`         | 401  | The key is missing, invalid, revoked, or expired.   |
| `forbidden`            | 403  | Missing permission or project not allowed.          |
| `not_found`            | 404  | The resource does not exist or is not visible.      |
| `conflict`             | 409  | A request with the same key is still in progress.   |
| `idempotency_mismatch` | 422  | The key was reused with a different body.           |
| `demo_mode`            | 403  | The deployment is running in demo mode.             |
| `not_configured`       | 503  | `CONVEX_URL` or `CONVEX_BRIDGE_SECRET` is missing.  |
| `internal_error`       | 500  | Server failure.                                     |

---

## Examples

### Restock items running out this week

```bash
curl -H "Authorization: Bearer erp_sk_..." \
  "https://your-erp/api/v1/stock?max_dias_stock=7"
```

### Monthly financial summary

```bash
curl -H "Authorization: Bearer erp_sk_..." \
  "https://your-erp/api/v1/finanzas?desde=2026-01-01&hasta=2026-01-31&detalle=resumen"
```

### Mark a sale as returned

```bash
curl -X PATCH https://your-erp/api/v1/ventas/42 \
  -H "Authorization: Bearer erp_sk_..." \
  -H "Content-Type: application/json" \
  -d '{"estado": "devuelta"}'
```

### Import a Wallapop sale

The n8n workflow in `automations/n8n/wallapop-gmail-to-erp.json` searches for
confirmation emails, parses both plain-text and HTML bodies, and calls the
import endpoint. It sends the Gmail message id as `origen_id` and as
`Idempotency-Key`, so polling and delivery retries do not create duplicate
sales.

```bash
curl -X POST https://your-erp/api/v1/importaciones/wallapop \
  -H "Authorization: Bearer erp_sk_..." \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: gmail-message-id" \
  -d '{
    "origen_id": "gmail-message-id",
    "fecha": "2026-08-03",
    "comprador_nombre": "Antonio R.",
    "titulo_wallapop": "Mando Xiaomi XMRM-006 a Estrenar",
    "importe_total": 3.49,
    "unidades": 1,
    "estado": "pendiente"
  }'
```

The import creates or reuses a customer by normalized name and records the
sale as `Wallapop`. It remains `pendiente` until shipment; the exact title is
matched to the product before the sale and stock movement are written.

### Connect a Custom GPT or agent

Give it the spec URL and the key:

```
https://your-erp/api/v1/openapi.json
```

It can then discover the operations, required fields, and accepted enum values
on its own; there is no need to describe the API manually.
