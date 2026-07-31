# OlivERP API v1

API pensada para que agentes de IA y herramientas de automatización (n8n, Make,
Zapier, Custom GPTs) operen el ERP sin pasar por la interfaz web.

El contrato completo y siempre actualizado está en:

```
GET /api/v1/openapi.json
```

Ese endpoint es público a propósito: un cliente tiene que poder leer el contrato
antes de tener credenciales. No expone ningún dato.

---

## Puesta en marcha

### 1. Ejecutar el SQL

En el editor SQL de Supabase, después de `db-structure/01-schema.sql` y
`db-structure/02-rls.sql`:

```
db-structure/03-agent-api.sql
```

Crea las tablas `api_keys` e `idempotency_keys` y las funciones transaccionales
`crear_venta`, `actualizar_venta`, `crear_compra` y `actualizar_compra`.

### 2. Configurar el secreto del servidor

Las peticiones autenticadas por API key no tienen usuario de Supabase, así que
el servidor necesita una **secret key** de Supabase:

```env
SUPABASE_SECRET_KEY=sb_secret_...
```

La creas en el dashboard de Supabase, en **Settings → API Keys → Publishable and
secret API keys**. Si el proyecto es antiguo verás un botón *Create new API
keys*: crearlas es seguro y no rompe nada, se añaden junto a las que ya tienes.

**Sin prefijo `PUBLIC_`**, para que Astro nunca la incluya en el bundle del
cliente. En Cloudflare, configúrala como secreto (`wrangler secret put
SUPABASE_SECRET_KEY`), no como variable en texto plano.

> **Sobre las keys legacy.** La `service_role` sigue funcionando (`SUPABASE_SERVICE_ROLE_KEY`
> se acepta como alternativa), pero Supabase la ha sustituido por las secret keys
> y solo la mantiene hasta finales de 2026. Merece la pena migrar ya: las
> `anon`/`service_role` derivan del JWT secret del proyecto, así que no se pueden
> rotar sin tocar todo lo demás, mientras que las nuevas se crean, nombran y
> revocan por separado. Además una secret key **devuelve 401 si se usa desde un
> navegador** (Supabase lo detecta por el `User-Agent`), red de seguridad que la
> `service_role` no tenía.
>
> En el lado cliente el equivalente es la publishable key: define
> `PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...` y tiene prioridad sobre
> `PUBLIC_SUPABASE_ANON_KEY`, que se sigue aceptando.
>
> Ojo con el nombre: la *secret key* es de Supabase y va en el servidor; las
> *API keys* (`erp_sk_...`) son las de este ERP y son las que reparten a los
> agentes. No son lo mismo.

### 3. Crear una API key

```bash
pnpm api:key --nombre "n8n stock" --proyecto 1 --scopes read,write
```

Opciones:

| Flag        | Descripción                                                       |
| :---------- | :---------------------------------------------------------------- |
| `--nombre`  | Obligatorio. Para identificarla después.                           |
| `--proyecto`| Id del proyecto al que se fija la key. Si se omite, accede a todos. |
| `--scopes`  | `read`, `write` o `read,write`. Por defecto `read`.                |
| `--expira`  | Fecha de caducidad (`YYYY-MM-DD`). Por defecto no caduca.          |

La key se muestra **una sola vez**: en la base de datos solo se guarda su hash
SHA-256. Si se pierde, se crea otra y se revoca la anterior:

```sql
UPDATE api_keys SET activa = false WHERE nombre = 'n8n stock';
```

---

## Autenticación

```bash
curl -H "Authorization: Bearer erp_sk_..." https://tu-erp/api/v1/proyectos
```

También se acepta `X-API-Key: erp_sk_...`, que es lo que envían por defecto
varias herramientas de automatización.

La interfaz web sigue funcionando con su sesión de cookies; los mismos endpoints
responden a ambos tipos de llamante.

### Permisos

- `read` → métodos `GET`.
- `write` → `POST`, `PATCH`, `DELETE`.

### Fijación a un proyecto

Una key fijada a un proyecto (`--proyecto 1`) no puede leer ni escribir en otro.
En esas keys `proyecto_id` es opcional en las peticiones; si se envía y no
coincide, la petición se rechaza en lugar de reescribirse en silencio.

Es la configuración recomendada para agentes: da acceso a un negocio concreto sin
exponer el resto.

---

## Endpoints

| Método   | Ruta                          | Descripción                                   |
| :------- | :---------------------------- | :-------------------------------------------- |
| `GET`    | `/api/v1/proyectos`           | Proyectos accesibles. Empieza aquí.            |
| `GET`    | `/api/v1/productos`           | Catálogo. Filtro `buscar`.                     |
| `POST`   | `/api/v1/productos`           | Crea un producto.                              |
| `GET`    | `/api/v1/ventas`              | Ventas. Filtros de fecha, estado y canal.      |
| `POST`   | `/api/v1/ventas`              | Registra una venta (transaccional).            |
| `GET`    | `/api/v1/ventas/{id}`         | Detalle de una venta.                          |
| `PATCH`  | `/api/v1/ventas/{id}`         | Modifica cabecera y/o líneas.                  |
| `GET`    | `/api/v1/compras`             | Compras.                                       |
| `POST`   | `/api/v1/compras`             | Registra una compra (transaccional).           |
| `GET`    | `/api/v1/compras/{id}`        | Detalle de una compra.                         |
| `PATCH`  | `/api/v1/compras/{id}`        | Modifica cabecera y/o líneas.                  |
| `GET`    | `/api/v1/transacciones`       | Otros ingresos y gastos.                       |
| `POST`   | `/api/v1/transacciones`       | Registra un ingreso o gasto.                   |
| `GET`    | `/api/v1/transacciones/{id}`  | Detalle.                                       |
| `PATCH`  | `/api/v1/transacciones/{id}`  | Modifica.                                      |
| `DELETE` | `/api/v1/transacciones/{id}`  | Borra.                                         |
| `GET`    | `/api/v1/stock`               | Stock y días de cobertura.                     |
| `POST`   | `/api/v1/stock/ajustes`       | Ajuste manual de stock.                        |
| `GET`    | `/api/v1/finanzas`            | Ingresos, gastos, beneficio y saldo de IVA.    |

Los endpoints de lista devuelven siempre el mismo sobre:

```json
{
  "data": [ ... ],
  "pagination": { "page": 1, "page_size": 20, "total": 132, "total_pages": 7, "has_more": true }
}
```

---

## Convenciones que conviene conocer

**Los precios incluyen IVA.** Es como los guarda el esquema. Las respuestas
desglosan `total_base`, `total_iva` y `total` para que no haya que deducirlo.

**Los estados deciden qué cuenta.** Solo las ventas en estado `enviada` suman
como ingreso, y solo las compras en `recibida` cuentan como gasto y mueven
stock. Una devolución es un `PATCH` del estado a `devuelta`, no un borrado.

**El stock se mueve solo.** Los movimientos de ventas y compras los generan
triggers de la base de datos. `POST /api/v1/stock/ajustes` es únicamente para
correcciones manuales (roturas, recuentos, regalos).

**Las fechas admiten `YYYY-MM-DD` o ISO 8601.** Una fecha sin hora se interpreta
como medianoche.

**`importe` siempre es positivo** en transacciones; el signo lo determina `tipo`.

---

## Reintentos seguros (`Idempotency-Key`)

Una petición que da timeout deja al llamante sin saber si la venta se registró.
Reintentar a ciegas la duplica. Para evitarlo, envía una clave única por
operación:

```bash
curl -X POST https://tu-erp/api/v1/ventas \
  -H "Authorization: Bearer erp_sk_..." \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: venta-shopify-10432" \
  -d '{
    "fecha": "2026-01-31",
    "canal": "Web",
    "items": [{ "producto_id": 1, "unidades": 2, "precio_unitario": 24.99 }]
  }'
```

Repetir esa llamada devuelve la respuesta original con la cabecera
`Idempotency-Replayed: true`, sin crear una segunda venta.

- Misma clave con un cuerpo distinto → `422 idempotency_mismatch`.
- Misma clave mientras la primera sigue en curso → `409 conflict`.
- Si la petición falla, la clave se libera y puede reutilizarse.

Un buen valor es el id del pedido en el sistema de origen, que es naturalmente
único y estable entre reintentos.

Las claves guardadas se pueden purgar de vez en cuando:

```sql
SELECT limpiar_idempotency_keys(7); -- borra las de más de 7 días
```

---

## Errores

Todos los errores usan la misma forma:

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

`field` usa notación con puntos, así que apunta directamente al sitio del JSON
enviado. `expected` lista los valores aceptados cuando el campo está acotado, que
es lo que permite a un modelo corregir la llamada en lugar de reintentarla igual.

| Código                 | HTTP | Significado                                        |
| :--------------------- | :--- | :------------------------------------------------- |
| `validation_error`     | 400  | Cuerpo o query inválidos.                           |
| `unauthorized`         | 401  | Falta la key, o es inválida, revocada o caducada.   |
| `forbidden`            | 403  | Sin el permiso necesario, o proyecto no permitido.  |
| `not_found`            | 404  | El recurso no existe (o no es visible para la key). |
| `conflict`             | 409  | Petición en curso con la misma `Idempotency-Key`.   |
| `idempotency_mismatch` | 422  | Clave reutilizada con otro cuerpo.                  |
| `demo_mode`            | 403  | El despliegue está en modo demo.                    |
| `not_configured`       | 503  | Falta `SUPABASE_SECRET_KEY` en el servidor.         |
| `internal_error`       | 500  | Fallo del servidor.                                 |

---

## Ejemplos

### Reponer lo que se agota esta semana

```bash
curl -H "Authorization: Bearer erp_sk_..." \
  "https://tu-erp/api/v1/stock?max_dias_stock=7"
```

### Resumen financiero del mes

```bash
curl -H "Authorization: Bearer erp_sk_..." \
  "https://tu-erp/api/v1/finanzas?desde=2026-01-01&hasta=2026-01-31&detalle=resumen"
```

### Marcar una venta como devuelta

```bash
curl -X PATCH https://tu-erp/api/v1/ventas/42 \
  -H "Authorization: Bearer erp_sk_..." \
  -H "Content-Type: application/json" \
  -d '{"estado": "devuelta"}'
```

### Conectar un Custom GPT o un agente

Dale la URL del spec y la key:

```
https://tu-erp/api/v1/openapi.json
```

Con eso descubre solo las operaciones, los campos obligatorios y los valores de
enum aceptados; no hace falta describirle la API a mano.
