-- =============================================================================
-- 2026-08-01 · Carry `proyecto_id` on the child tables, and make the policies
--              set-based instead of per-row
-- =============================================================================
-- Fixes `canceling statement due to statement timeout` on /stock.
--
-- The policies added in 233b89c are correct and were too slow to survive a real
-- project. Two things compounded:
--
--   1. `venta_detalle` and `compra_detalle` had no index on `producto_id`, and
--      `vista_stock_final` looks them up by product — once per product, four
--      correlated subqueries deep. Sequential scan per product.
--   2. Every row those scans touched ran the table's policy, and for the three
--      child tables the policy was `EXISTS (SELECT 1 FROM <parent> ...)` — a
--      subplan against a table with a policy of its own, whose predicate called
--      the SECURITY DEFINER `es_miembro()`, which the planner will not inline.
--
-- Multiply: products × detail rows × a function call that is a real executor
-- invocation. Past eight seconds, PostgREST returns the timeout and the page
-- renders zeroes.
--
-- The fix keeps the boundary exactly where it was and changes what the database
-- has to do to enforce it: the parent's `proyecto_id` is copied onto the row by
-- trigger, so the policy is a comparison on an indexed column, and the
-- membership set is computed once per statement instead of once per row.
--
-- Safe to run on a live database, but it rewrites three tables (ADD COLUMN with
-- a backfill, then SET NOT NULL), so it takes an ACCESS EXCLUSIVE lock for the
-- duration. Run it when writes can wait.
-- =============================================================================

BEGIN;


-- -----------------------------------------------------------------------------
-- 1 · The missing indexes
-- -----------------------------------------------------------------------------
-- Independent of RLS: `vista_stock_final` and `vista_finanzas_diarias` have
-- always looked these tables up by product.

CREATE INDEX IF NOT EXISTS venta_detalle_producto_id_idx
  ON public.venta_detalle (producto_id);
CREATE INDEX IF NOT EXISTS compra_detalle_producto_id_idx
  ON public.compra_detalle (producto_id);


-- -----------------------------------------------------------------------------
-- 2 · The derived column
-- -----------------------------------------------------------------------------

ALTER TABLE public.venta_detalle
  ADD COLUMN IF NOT EXISTS proyecto_id integer REFERENCES public.proyectos (id);
ALTER TABLE public.compra_detalle
  ADD COLUMN IF NOT EXISTS proyecto_id integer REFERENCES public.proyectos (id);
ALTER TABLE public.movimientos_stock
  ADD COLUMN IF NOT EXISTS proyecto_id integer REFERENCES public.proyectos (id);

UPDATE public.venta_detalle vd
   SET proyecto_id = v.proyecto_id
  FROM public.ventas v
 WHERE v.id = vd.venta_id AND vd.proyecto_id IS DISTINCT FROM v.proyecto_id;

UPDATE public.compra_detalle cd
   SET proyecto_id = c.proyecto_id
  FROM public.compras c
 WHERE c.id = cd.compra_id AND cd.proyecto_id IS DISTINCT FROM c.proyecto_id;

UPDATE public.movimientos_stock m
   SET proyecto_id = p.proyecto_id
  FROM public.productos p
 WHERE p.id = m.producto_id AND m.proyecto_id IS DISTINCT FROM p.proyecto_id;

ALTER TABLE public.venta_detalle     ALTER COLUMN proyecto_id SET NOT NULL;
ALTER TABLE public.compra_detalle    ALTER COLUMN proyecto_id SET NOT NULL;
ALTER TABLE public.movimientos_stock ALTER COLUMN proyecto_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS venta_detalle_proyecto_id_idx
  ON public.venta_detalle (proyecto_id);
CREATE INDEX IF NOT EXISTS compra_detalle_proyecto_id_idx
  ON public.compra_detalle (proyecto_id);
CREATE INDEX IF NOT EXISTS movimientos_stock_proyecto_id_idx
  ON public.movimientos_stock (proyecto_id);


-- -----------------------------------------------------------------------------
-- 3 · Keeping it derived
-- -----------------------------------------------------------------------------
-- The triggers overwrite whatever the caller sent. A client able to choose its
-- own `proyecto_id` would be choosing which project it may write into, so the
-- column is never trusted from the outside.

CREATE OR REPLACE FUNCTION public.derivar_proyecto_venta_detalle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  SELECT v.proyecto_id INTO NEW.proyecto_id
  FROM public.ventas v WHERE v.id = NEW.venta_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.derivar_proyecto_compra_detalle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  SELECT c.proyecto_id INTO NEW.proyecto_id
  FROM public.compras c WHERE c.id = NEW.compra_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.derivar_proyecto_movimiento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  SELECT p.proyecto_id INTO NEW.proyecto_id
  FROM public.productos p WHERE p.id = NEW.producto_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_venta_detalle_proyecto ON public.venta_detalle;
CREATE TRIGGER trg_venta_detalle_proyecto
BEFORE INSERT OR UPDATE ON public.venta_detalle
FOR EACH ROW EXECUTE FUNCTION public.derivar_proyecto_venta_detalle();

DROP TRIGGER IF EXISTS trg_compra_detalle_proyecto ON public.compra_detalle;
CREATE TRIGGER trg_compra_detalle_proyecto
BEFORE INSERT OR UPDATE ON public.compra_detalle
FOR EACH ROW EXECUTE FUNCTION public.derivar_proyecto_compra_detalle();

DROP TRIGGER IF EXISTS trg_movimientos_stock_proyecto ON public.movimientos_stock;
CREATE TRIGGER trg_movimientos_stock_proyecto
BEFORE INSERT OR UPDATE ON public.movimientos_stock
FOR EACH ROW EXECUTE FUNCTION public.derivar_proyecto_movimiento();


-- -----------------------------------------------------------------------------
-- 4 · One membership lookup per statement
-- -----------------------------------------------------------------------------
-- `es_miembro(proyecto_id)` takes the row's own column, so it is one executor
-- call per row examined. `proyecto_id IN (SELECT public.mis_proyectos())` names
-- no column of the row, so the planner runs it once for the whole statement and
-- the row test becomes a hash lookup an index can drive.

CREATE OR REPLACE FUNCTION public.mis_proyectos()
RETURNS SETOF integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT proyecto_id FROM public.proyecto_usuarios WHERE user_id = auth.uid();
$$;

REVOKE EXECUTE ON FUNCTION public.mis_proyectos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mis_proyectos() TO authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 5 · The policies
-- -----------------------------------------------------------------------------
-- Same sentence as before — is the caller a member of the project this row
-- belongs to — asked of a column instead of through a join.

DROP POLICY IF EXISTS proyectos_select ON public.proyectos;
CREATE POLICY proyectos_select ON public.proyectos
  FOR SELECT TO authenticated
  USING (id IN (SELECT public.mis_proyectos()));

DROP POLICY IF EXISTS proyecto_usuarios_select ON public.proyecto_usuarios;
CREATE POLICY proyecto_usuarios_select ON public.proyecto_usuarios
  FOR SELECT TO authenticated
  USING (proyecto_id IN (SELECT public.mis_proyectos()));

DROP POLICY IF EXISTS productos_all ON public.productos;
CREATE POLICY productos_all ON public.productos
  FOR ALL TO authenticated
  USING (proyecto_id IN (SELECT public.mis_proyectos()))
  WITH CHECK (proyecto_id IN (SELECT public.mis_proyectos()));

DROP POLICY IF EXISTS ventas_all ON public.ventas;
CREATE POLICY ventas_all ON public.ventas
  FOR ALL TO authenticated
  USING (proyecto_id IN (SELECT public.mis_proyectos()))
  WITH CHECK (proyecto_id IN (SELECT public.mis_proyectos()));

DROP POLICY IF EXISTS compras_all ON public.compras;
CREATE POLICY compras_all ON public.compras
  FOR ALL TO authenticated
  USING (proyecto_id IN (SELECT public.mis_proyectos()))
  WITH CHECK (proyecto_id IN (SELECT public.mis_proyectos()));

DROP POLICY IF EXISTS otros_ingresos_gastos_all ON public.otros_ingresos_gastos;
CREATE POLICY otros_ingresos_gastos_all ON public.otros_ingresos_gastos
  FOR ALL TO authenticated
  USING (proyecto_id IN (SELECT public.mis_proyectos()))
  WITH CHECK (proyecto_id IN (SELECT public.mis_proyectos()));

DROP POLICY IF EXISTS venta_detalle_all ON public.venta_detalle;
CREATE POLICY venta_detalle_all ON public.venta_detalle
  FOR ALL TO authenticated
  USING (proyecto_id IN (SELECT public.mis_proyectos()))
  WITH CHECK (proyecto_id IN (SELECT public.mis_proyectos()));

DROP POLICY IF EXISTS compra_detalle_all ON public.compra_detalle;
CREATE POLICY compra_detalle_all ON public.compra_detalle
  FOR ALL TO authenticated
  USING (proyecto_id IN (SELECT public.mis_proyectos()))
  WITH CHECK (proyecto_id IN (SELECT public.mis_proyectos()));

DROP POLICY IF EXISTS movimientos_stock_all ON public.movimientos_stock;
CREATE POLICY movimientos_stock_all ON public.movimientos_stock
  FOR ALL TO authenticated
  USING (proyecto_id IN (SELECT public.mis_proyectos()))
  WITH CHECK (proyecto_id IN (SELECT public.mis_proyectos()));


COMMIT;

-- Fresh statistics on the rewritten tables, so the planner costs the new
-- column and the new indexes from real numbers. Outside the transaction.
ANALYZE public.venta_detalle;
ANALYZE public.compra_detalle;
ANALYZE public.movimientos_stock;
