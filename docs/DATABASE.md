# Base de datos

El esquema ejecutable vive en `db-structure/`, y se carga en orden:

| Fichero | Contenido |
| --- | --- |
| `01-schema.sql` | Enums, tablas, triggers de stock y vistas de informes |
| `02-rls.sql` | Pertenencia a proyectos y políticas de row level security |
| `03-agent-api.sql` | `api_keys`, idempotencia y las funciones transaccionales |

Antes había un único `structure.sql` que era un volcado descriptivo, no
ejecutable (`ARRAY`, `USER-DEFINED`, cuerpos de trigger sueltos sin su
`CREATE FUNCTION`). Servía para leerlo, no para levantar una base de datos, y
por eso no había forma de probar ni una política ni una RPC: no existía nada que
Postgres pudiera cargar. Los ficheros de `db-structure/` sí se cargan tal cual,
que es justo lo que hace la suite de `tests/rls`.

## El límite entre inquilinos

El proyecto (`proyectos`) es el límite. Un usuario ve las filas de un proyecto
si, y solo si, tiene fila en `proyecto_usuarios`. Las tablas que no llevan
`proyecto_id` — `venta_detalle`, `compra_detalle`, `movimientos_stock` — heredan
el límite a través de su fila padre; dejarlas abiertas filtraría los precios y
las cantidades a un JOIN de distancia aunque la cabecera fuese invisible.

Dos detalles que no son evidentes y que la suite comprueba:

- **Las vistas necesitan `security_invoker = true`.** Sin él una vista se
  ejecuta con los permisos de su propietario y las políticas de las tablas de
  debajo ni se consultan: `vista_finanzas_diarias` entregaría las cifras de
  todos los proyectos por muy bien cerradas que estén las tablas.
- **`REVOKE ... FROM anon` no basta en funciones.** Postgres concede `EXECUTE` a
  `PUBLIC` en cada función nueva, y `anon` lo hereda de ahí. Hay que revocar de
  `PUBLIC` y volver a conceder a los roles que sí deben poder llamarlas.

## Enums

Hay que castearlos explícitamente en SQL escrito a mano:

- `tipo_movimiento`: `compra`, `venta`, `devolucion_vta`, `ajuste manual`, `devolucion_com`
- `estado_compra`: `pendiente`, `recibida`, `cancelada`
- `tipo_transaccion`: `ingreso`, `gasto`
- `estado_venta`: `pendiente`, `enviada`, `devuelta`, `reembolsada`

```sql
'gasto'::tipo_transaccion, 'recibida'::estado_compra, '2026-01-01'::timestamp
```

Los subqueries dentro de `VALUES` no funcionan en el editor de Supabase; usar
CTE + `INSERT ... SELECT`.

## IVA

Los precios se guardan **con IVA incluido**, así que el impuesto se extrae como
`tipo / (100 + tipo)`, no como `tipo / 100`. 121,00 al 21 % son 100,00 de base y
21,00 de IVA. Confundirlo desvía la declaración en una quinta parte, y es lo que
comprueba `tests/rls/rpc-transactions.test.ts`.
