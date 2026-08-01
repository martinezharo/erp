-- =============================================================================
-- 2026-08-01 · Drop `Solo_Yo_Acceso_Total`
-- =============================================================================
-- This policy was created by hand in the Supabase dashboard and never existed in
-- `db-structure/`, so it was invisible to anyone reading this repository. It was
-- found while reading a query plan: every policy predicate in production carried
-- an `OR ((auth.jwt() ->> 'email') = '...')` that the repository did not explain.
--
-- It granted `FOR ALL` to `authenticated` on the eight business tables whenever
-- the caller's email matched one hardcoded address. Being permissive, it was
-- OR'd with the membership policies, so it reached across the project boundary
-- that the rest of this schema exists to enforce — ownership expressed as a
-- string literal in eight places rather than as a row in `proyecto_usuarios`.
--
-- Dropping it changed nobody's access: that account holds an `admin` row for all
-- three projects, verified before running this.
--
-- To restore it, per table:
--   CREATE POLICY "Solo_Yo_Acceso_Total" ON public.<tabla>
--     FOR ALL TO authenticated
--     USING ((auth.jwt() ->> 'email') = 'octopuscontrol2024@gmail.com')
--     WITH CHECK ((auth.jwt() ->> 'email') = 'octopuscontrol2024@gmail.com');
-- =============================================================================

DROP POLICY IF EXISTS "Solo_Yo_Acceso_Total" ON public.proyectos;
DROP POLICY IF EXISTS "Solo_Yo_Acceso_Total" ON public.productos;
DROP POLICY IF EXISTS "Solo_Yo_Acceso_Total" ON public.ventas;
DROP POLICY IF EXISTS "Solo_Yo_Acceso_Total" ON public.venta_detalle;
DROP POLICY IF EXISTS "Solo_Yo_Acceso_Total" ON public.compras;
DROP POLICY IF EXISTS "Solo_Yo_Acceso_Total" ON public.compra_detalle;
DROP POLICY IF EXISTS "Solo_Yo_Acceso_Total" ON public.movimientos_stock;
DROP POLICY IF EXISTS "Solo_Yo_Acceso_Total" ON public.otros_ingresos_gastos;
