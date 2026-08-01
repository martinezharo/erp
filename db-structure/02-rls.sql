-- =============================================================================
-- OlivERP · Project membership and row level security
-- =============================================================================
-- Until this file existed, the middleware was the only thing standing between a
-- request and the books. That stops anonymous callers, and nothing else: every
-- logged-in user reached every project's sales, purchases, stock and margins,
-- because the browser talks to PostgREST directly with the user's own token and
-- no table carried a policy.
--
-- The tenant boundary is the project. A user sees a project's rows if, and only
-- if, they are a member of it. Every business table carries `proyecto_id` — on
-- `venta_detalle`, `compra_detalle` and `movimientos_stock` it is derived from
-- the parent row by trigger rather than supplied by the client — so every policy
-- below is the same sentence about the same column.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Membership
-- -----------------------------------------------------------------------------
-- `user_id` deliberately has no foreign key to `auth.users`: that table belongs
-- to Supabase Auth and referencing it from an application table couples project
-- deletion to auth internals. The id is a uuid because that is what `auth.uid()`
-- returns.
--
-- `rol` distinguishes who may change the project's shape from who may only work
-- inside it. Both see the same rows; only an `admin` may add or remove members.

CREATE TABLE IF NOT EXISTS public.proyecto_usuarios (
  proyecto_id integer     NOT NULL REFERENCES public.proyectos (id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL,
  rol         varchar     NOT NULL DEFAULT 'miembro',
  creado_en   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT proyecto_usuarios_pkey PRIMARY KEY (proyecto_id, user_id),
  CONSTRAINT proyecto_usuarios_rol_check CHECK (rol IN ('admin', 'miembro'))
);

CREATE INDEX IF NOT EXISTS proyecto_usuarios_user_id_idx ON public.proyecto_usuarios (user_id);


-- -----------------------------------------------------------------------------
-- Membership predicates
-- -----------------------------------------------------------------------------
-- Every policy is written against these. Inlining `EXISTS (SELECT 1 FROM
-- proyecto_usuarios ...)` in each policy would work, but it would also put a
-- policy on `proyecto_usuarios` in the path of every other policy and recurse.
-- SECURITY DEFINER breaks that cycle.
--
-- `search_path` is pinned: a SECURITY DEFINER function that resolves table names
-- through the caller's `search_path` can be pointed at a table the caller
-- controls, which would turn the membership check into whatever they want.
--
-- `mis_proyectos()` is the one the read policies use, and the shape is the whole
-- point. `es_miembro(proyecto_id)` takes the row's own column, so it is a fresh
-- call for every row examined — and a SECURITY DEFINER function is never inlined
-- by the planner, so each call is a real executor invocation. That is affordable
-- on a table someone paged through and ruinous underneath `vista_stock_final`,
-- which touches the detail tables once per product. Written as `proyecto_id IN
-- (SELECT public.mis_proyectos())` the subquery depends on no column, so the
-- planner runs it once for the whole statement and the row test becomes a hash
-- lookup — which an index on `proyecto_id` can then satisfy.
--
-- `es_miembro` stays for the single-row questions (`proyectos`, and the RPCs in
-- 03-agent-api.sql), where one call is one call.

CREATE OR REPLACE FUNCTION public.mis_proyectos()
RETURNS SETOF integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT proyecto_id FROM public.proyecto_usuarios WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.es_miembro(p_proyecto_id integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.proyecto_usuarios
    WHERE proyecto_id = p_proyecto_id
      AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.es_admin_proyecto(p_proyecto_id integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.proyecto_usuarios
    WHERE proyecto_id = p_proyecto_id
      AND user_id = auth.uid()
      AND rol = 'admin'
  );
$$;

-- These are policy plumbing, not API. `anon` calling them would learn nothing
-- (`auth.uid()` is NULL), but there is no reason to expose them either.
--
-- Revoking from `anon` alone would do nothing: Postgres grants EXECUTE to
-- PUBLIC on every new function, and `anon` inherits it there. The grant has to
-- be taken away from PUBLIC and then handed back to the roles that need it.
--
-- Revoking from PUBLIC alone is not enough either, and this is the half that is
-- easy to miss: a Supabase project also carries `ALTER DEFAULT PRIVILEGES ...
-- GRANT EXECUTE ON FUNCTIONS TO anon` for the `public` schema, so every new
-- function arrives with a grant to `anon` of its own. Dropping the PUBLIC grant
-- leaves that one standing. Both have to go.
REVOKE EXECUTE ON FUNCTION public.mis_proyectos() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.es_miembro(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.es_admin_proyecto(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mis_proyectos() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.es_miembro(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.es_admin_proyecto(integer) TO authenticated, service_role;


-- -----------------------------------------------------------------------------
-- Enable RLS
-- -----------------------------------------------------------------------------
-- Enabling with no policy denies everything, so each table below must also get
-- its policies; the order matters only in that RLS is on before the app runs.

ALTER TABLE public.proyectos             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proyecto_usuarios     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.productos             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ventas                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venta_detalle         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compras               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compra_detalle        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movimientos_stock     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otros_ingresos_gastos ENABLE ROW LEVEL SECURITY;


-- -----------------------------------------------------------------------------
-- proyectos
-- -----------------------------------------------------------------------------
-- Listing projects is how the UI populates its project selector, so the list
-- itself is the leak to avoid: a user must not learn that another company's
-- project exists, let alone rename it.

DROP POLICY IF EXISTS proyectos_select ON public.proyectos;
CREATE POLICY proyectos_select ON public.proyectos
  FOR SELECT TO authenticated
  USING (id IN (SELECT public.mis_proyectos()));

DROP POLICY IF EXISTS proyectos_update ON public.proyectos;
CREATE POLICY proyectos_update ON public.proyectos
  FOR UPDATE TO authenticated
  USING (public.es_admin_proyecto(id))
  WITH CHECK (public.es_admin_proyecto(id));

-- Creating and deleting projects is an ownership change, not day-to-day work:
-- a new project needs its first membership row written in the same breath, and
-- the browser cannot do two writes atomically. Both stay with the service role.


-- -----------------------------------------------------------------------------
-- proyecto_usuarios
-- -----------------------------------------------------------------------------
-- A member sees the roster of the projects they belong to — the UI shows who
-- else is on the project — but only an admin may change it. Without the
-- `WITH CHECK` on insert, any member could add themselves to any project and
-- every other policy here would follow along.

DROP POLICY IF EXISTS proyecto_usuarios_select ON public.proyecto_usuarios;
CREATE POLICY proyecto_usuarios_select ON public.proyecto_usuarios
  FOR SELECT TO authenticated
  USING (proyecto_id IN (SELECT public.mis_proyectos()));

DROP POLICY IF EXISTS proyecto_usuarios_insert ON public.proyecto_usuarios;
CREATE POLICY proyecto_usuarios_insert ON public.proyecto_usuarios
  FOR INSERT TO authenticated
  WITH CHECK (public.es_admin_proyecto(proyecto_id));

DROP POLICY IF EXISTS proyecto_usuarios_update ON public.proyecto_usuarios;
CREATE POLICY proyecto_usuarios_update ON public.proyecto_usuarios
  FOR UPDATE TO authenticated
  USING (public.es_admin_proyecto(proyecto_id))
  WITH CHECK (public.es_admin_proyecto(proyecto_id));

DROP POLICY IF EXISTS proyecto_usuarios_delete ON public.proyecto_usuarios;
CREATE POLICY proyecto_usuarios_delete ON public.proyecto_usuarios
  FOR DELETE TO authenticated
  USING (public.es_admin_proyecto(proyecto_id));


-- -----------------------------------------------------------------------------
-- Tables that carry proyecto_id
-- -----------------------------------------------------------------------------
-- Members get full read/write inside their own projects. `USING` and
-- `WITH CHECK` both name the membership check on updates: `USING` decides which
-- rows may be touched, `WITH CHECK` decides what they may become, and omitting
-- the second would let a member move a row into another project.

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


-- -----------------------------------------------------------------------------
-- Tables whose tenant is inherited from a parent
-- -----------------------------------------------------------------------------
-- A line item must not be the way around its header's policy: a sale can be
-- invisible while its lines still carry the prices and quantities, so leaving
-- them open would leak the same information one join away.
--
-- The first version of these policies asked the parent directly — `EXISTS
-- (SELECT 1 FROM ventas v WHERE v.id = venta_id AND es_miembro(v.proyecto_id))`
-- — which is correct and was unusable. The subquery names a column of the row
-- being tested, so it runs per row; the scan it starts on `ventas` is itself
-- under `ventas_all`; and `vista_stock_final` walks these tables once per
-- product. `SELECT * FROM vista_stock_final` on a real project ran past the
-- eight-second `statement_timeout` and the stock page came back empty.
--
-- So the parent's `proyecto_id` is now carried on the row (see 01-schema.sql),
-- filled by a trigger that ignores whatever the client sent, and these read like
-- every other policy here. The question asked is unchanged — may this caller
-- reach the project this row belongs to — but it is now one hash lookup per row
-- against a set computed once, on an indexed column.
--
-- Stock movements are written by triggers on the detail tables, which run as the
-- invoking user, so a member inserting a sale line must be allowed to create the
-- movement it derives from; it lands in the same project, so `WITH CHECK` passes
-- for exactly the callers who were allowed to write the line.

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


-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
-- No policy names `anon`, so an anonymous caller is already denied every row.
-- Revoking the table privileges as well means the answer is "permission denied"
-- rather than "zero rows", which is a clearer signal in logs and one less
-- surface if a policy is ever added carelessly.

REVOKE ALL ON public.proyectos, public.proyecto_usuarios, public.productos,
  public.ventas, public.venta_detalle, public.compras, public.compra_detalle,
  public.movimientos_stock, public.otros_ingresos_gastos FROM anon;

REVOKE ALL ON public.vista_finanzas_diarias, public.vista_stock_final FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.proyecto_usuarios, public.productos,
  public.ventas, public.venta_detalle, public.compras, public.compra_detalle,
  public.movimientos_stock, public.otros_ingresos_gastos TO authenticated;
GRANT SELECT, UPDATE ON public.proyectos TO authenticated;
GRANT SELECT ON public.vista_finanzas_diarias, public.vista_stock_final TO authenticated;
