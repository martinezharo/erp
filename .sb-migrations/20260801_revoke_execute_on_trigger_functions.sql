-- =============================================================================
-- 2026-08-01 · Take EXECUTE on the new trigger functions away from the API roles
-- =============================================================================
-- Follow-up to 20260801_carry_proyecto_id_on_child_tables.sql. The database
-- linter flagged the three `derivar_proyecto_*` functions as callable over
-- PostgREST by `anon` and `authenticated`, because every new function in the
-- `public` schema arrives with EXECUTE granted to PUBLIC and, through a Supabase
-- project's default privileges, to those two roles as well.
--
-- Calling a trigger function through the API only ever errors, so this is not a
-- hole so much as surface that has no reason to exist. Revoking does not stop
-- the triggers: EXECUTE is checked when the trigger is created, not each time it
-- fires.
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.derivar_proyecto_venta_detalle() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.derivar_proyecto_compra_detalle() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.derivar_proyecto_movimiento() FROM PUBLIC, anon, authenticated;
