-- =============================================================================
-- OlivERP · Agent-friendly API layer
-- =============================================================================
-- Run this in the Supabase SQL Editor after `structure.sql`.
--
-- It adds three things the machine-facing API needs and the schema did not have:
--   1. `api_keys`          - authentication for non-browser clients.
--   2. `idempotency_keys`  - safe retries for agents and automation tools.
--   3. RPC functions       - real transactions for the multi-table writes that
--                            the HTTP client cannot roll back on its own.
--
-- Enum reminder (see structure.sql): enums must be cast explicitly, e.g.
-- 'enviada'::estado_venta, 'recibida'::estado_compra, 'gasto'::tipo_transaccion.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. API keys
-- -----------------------------------------------------------------------------
-- Keys are shown once at creation time and only ever stored hashed (SHA-256 of
-- the full secret, hex encoded). `key_prefix` keeps a non-sensitive fragment so
-- keys can be told apart in a list.
--
-- `proyecto_id` NULL means the key may act on every project. Setting it pins the
-- key to a single project, which is the recommended default for agents.

CREATE TABLE IF NOT EXISTS public.api_keys (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  nombre        varchar     NOT NULL,
  key_hash      varchar     NOT NULL UNIQUE,
  key_prefix    varchar     NOT NULL,
  proyecto_id   integer     NULL,
  scopes        text[]      NOT NULL DEFAULT ARRAY['read']::text[],
  activa        boolean     NOT NULL DEFAULT true,
  expira_en     timestamptz NULL,
  ultimo_uso_en timestamptz NULL,
  creada_en     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT api_keys_pkey PRIMARY KEY (id),
  CONSTRAINT api_keys_proyecto_id_fkey FOREIGN KEY (proyecto_id)
    REFERENCES public.proyectos (id)
);

CREATE INDEX IF NOT EXISTS api_keys_key_hash_idx ON public.api_keys (key_hash);

-- The API layer reaches this table with the service role, which bypasses RLS.
-- Enabling it with no permissive policy means anon/authenticated clients (i.e.
-- anything reachable from the browser) can never read the hashes.
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;


-- -----------------------------------------------------------------------------
-- 2. Idempotency
-- -----------------------------------------------------------------------------
-- An agent that retries after a timeout must not create the sale twice. Writes
-- accept an `Idempotency-Key` header; the first response is stored and replayed
-- verbatim for any repeat of the same key.
--
-- `request_hash` detects the dangerous case of the same key being reused with a
-- different payload, which is answered with 422 rather than a wrong replay.
--
-- The row is inserted *before* the write runs, with `response_status = 0`
-- meaning "in flight", and updated with the real response once it completes.
-- The unique constraint is therefore what stops two concurrent requests sharing
-- a key from both writing. Failed attempts delete their row so the caller can
-- retry with the same key.

CREATE TABLE IF NOT EXISTS public.idempotency_keys (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  idempotency_key varchar     NOT NULL,
  api_key_id      uuid        NULL,
  endpoint        varchar     NOT NULL,
  request_hash    varchar     NOT NULL,
  response_status integer     NOT NULL,
  response_body   jsonb       NOT NULL,
  creada_en       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT idempotency_keys_pkey PRIMARY KEY (id),
  CONSTRAINT idempotency_keys_unique UNIQUE (idempotency_key, endpoint),
  CONSTRAINT idempotency_keys_api_key_id_fkey FOREIGN KEY (api_key_id)
    REFERENCES public.api_keys (id) ON DELETE CASCADE
);

ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;

-- Housekeeping: stored responses are only useful for the retry window.
-- Schedule with pg_cron if available, or call it manually now and then.
CREATE OR REPLACE FUNCTION public.limpiar_idempotency_keys(p_dias integer DEFAULT 7)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_borradas integer;
BEGIN
  DELETE FROM idempotency_keys
  WHERE creada_en < now() - (p_dias || ' days')::interval;
  GET DIAGNOSTICS v_borradas = ROW_COUNT;
  RETURN v_borradas;
END;
$$;


-- -----------------------------------------------------------------------------
-- 3. Transactional writes
-- -----------------------------------------------------------------------------
-- A sale is a row in `ventas` plus N rows in `venta_detalle`, and the stock
-- movements the triggers derive from them. Doing that over PostgREST means two
-- round trips with no transaction, so a failure halfway leaves a sale with no
-- lines. These functions make each operation atomic.
--
-- `p_items` is a JSON array of objects:
--   [{ "producto_id": 1, "unidades": 2, "precio_unitario": 9.99, "porcentaje_iva": 21 }]

CREATE OR REPLACE FUNCTION public.crear_venta(
  p_proyecto_id integer,
  p_fecha       timestamp,
  p_canal       varchar,
  p_items       jsonb,
  p_estado      varchar DEFAULT 'enviada'
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_venta_id integer;
  v_item     jsonb;
BEGIN
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Una venta necesita al menos una linea'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO ventas (proyecto_id, fecha, canal, estado)
  VALUES (p_proyecto_id, p_fecha, p_canal, p_estado::estado_venta)
  RETURNING id INTO v_venta_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    -- Guard against lines pointing at another project's catalogue.
    IF NOT EXISTS (
      SELECT 1 FROM productos
      WHERE id = (v_item->>'producto_id')::integer
        AND proyecto_id = p_proyecto_id
    ) THEN
      RAISE EXCEPTION 'El producto % no pertenece al proyecto %',
        v_item->>'producto_id', p_proyecto_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    INSERT INTO venta_detalle (
      venta_id, producto_id, unidades, precio_unitario_venta, porcentaje_iva
    ) VALUES (
      v_venta_id,
      (v_item->>'producto_id')::integer,
      (v_item->>'unidades')::integer,
      (v_item->>'precio_unitario')::numeric,
      COALESCE((v_item->>'porcentaje_iva')::numeric, 21)
    );
  END LOOP;

  RETURN jsonb_build_object('id', v_venta_id);
END;
$$;


CREATE OR REPLACE FUNCTION public.actualizar_venta(
  p_venta_id integer,
  p_fecha    timestamp DEFAULT NULL,
  p_canal    varchar   DEFAULT NULL,
  p_estado   varchar   DEFAULT NULL,
  p_items    jsonb     DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_proyecto_id integer;
  v_item        jsonb;
BEGIN
  SELECT proyecto_id INTO v_proyecto_id FROM ventas WHERE id = p_venta_id;
  IF v_proyecto_id IS NULL THEN
    RAISE EXCEPTION 'Venta % no encontrada', p_venta_id
      USING ERRCODE = 'no_data_found';
  END IF;

  UPDATE ventas
  SET fecha  = COALESCE(p_fecha, fecha),
      canal  = COALESCE(p_canal, canal),
      estado = COALESCE(p_estado::estado_venta, estado)
  WHERE id = p_venta_id;

  -- Lines are replaced wholesale when provided; omitting `p_items` edits only
  -- the header, which is what a status change (enviada -> devuelta) needs.
  IF p_items IS NOT NULL THEN
    IF jsonb_array_length(p_items) = 0 THEN
      RAISE EXCEPTION 'Una venta necesita al menos una linea'
        USING ERRCODE = 'check_violation';
    END IF;

    -- The stock movements reference the detail rows, so they must go first.
    DELETE FROM movimientos_stock
    WHERE ref_venta_detalle_id IN (
      SELECT id FROM venta_detalle WHERE venta_id = p_venta_id
    );
    DELETE FROM venta_detalle WHERE venta_id = p_venta_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM productos
        WHERE id = (v_item->>'producto_id')::integer
          AND proyecto_id = v_proyecto_id
      ) THEN
        RAISE EXCEPTION 'El producto % no pertenece al proyecto %',
          v_item->>'producto_id', v_proyecto_id
          USING ERRCODE = 'foreign_key_violation';
      END IF;

      INSERT INTO venta_detalle (
        venta_id, producto_id, unidades, precio_unitario_venta, porcentaje_iva
      ) VALUES (
        p_venta_id,
        (v_item->>'producto_id')::integer,
        (v_item->>'unidades')::integer,
        (v_item->>'precio_unitario')::numeric,
        COALESCE((v_item->>'porcentaje_iva')::numeric, 21)
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object('id', p_venta_id);
END;
$$;


CREATE OR REPLACE FUNCTION public.crear_compra(
  p_proyecto_id integer,
  p_fecha       timestamp,
  p_items       jsonb,
  p_estado      varchar DEFAULT 'recibida'
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_compra_id integer;
  v_item      jsonb;
BEGIN
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Una compra necesita al menos una linea'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO compras (proyecto_id, fecha, estado)
  VALUES (p_proyecto_id, p_fecha, p_estado::estado_compra)
  RETURNING id INTO v_compra_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM productos
      WHERE id = (v_item->>'producto_id')::integer
        AND proyecto_id = p_proyecto_id
    ) THEN
      RAISE EXCEPTION 'El producto % no pertenece al proyecto %',
        v_item->>'producto_id', p_proyecto_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    INSERT INTO compra_detalle (
      compra_id, producto_id, unidades, precio_unitario_compra, porcentaje_iva
    ) VALUES (
      v_compra_id,
      (v_item->>'producto_id')::integer,
      (v_item->>'unidades')::integer,
      (v_item->>'precio_unitario')::numeric,
      COALESCE((v_item->>'porcentaje_iva')::numeric, 21)
    );
  END LOOP;

  RETURN jsonb_build_object('id', v_compra_id);
END;
$$;


CREATE OR REPLACE FUNCTION public.actualizar_compra(
  p_compra_id integer,
  p_fecha     timestamp DEFAULT NULL,
  p_estado    varchar   DEFAULT NULL,
  p_items     jsonb     DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_proyecto_id integer;
  v_item        jsonb;
BEGIN
  SELECT proyecto_id INTO v_proyecto_id FROM compras WHERE id = p_compra_id;
  IF v_proyecto_id IS NULL THEN
    RAISE EXCEPTION 'Compra % no encontrada', p_compra_id
      USING ERRCODE = 'no_data_found';
  END IF;

  UPDATE compras
  SET fecha  = COALESCE(p_fecha, fecha),
      estado = COALESCE(p_estado::estado_compra, estado)
  WHERE id = p_compra_id;

  IF p_items IS NOT NULL THEN
    IF jsonb_array_length(p_items) = 0 THEN
      RAISE EXCEPTION 'Una compra necesita al menos una linea'
        USING ERRCODE = 'check_violation';
    END IF;

    DELETE FROM movimientos_stock
    WHERE ref_compra_detalle_id IN (
      SELECT id FROM compra_detalle WHERE compra_id = p_compra_id
    );
    DELETE FROM compra_detalle WHERE compra_id = p_compra_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM productos
        WHERE id = (v_item->>'producto_id')::integer
          AND proyecto_id = v_proyecto_id
      ) THEN
        RAISE EXCEPTION 'El producto % no pertenece al proyecto %',
          v_item->>'producto_id', v_proyecto_id
          USING ERRCODE = 'foreign_key_violation';
      END IF;

      INSERT INTO compra_detalle (
        compra_id, producto_id, unidades, precio_unitario_compra, porcentaje_iva
      ) VALUES (
        p_compra_id,
        (v_item->>'producto_id')::integer,
        (v_item->>'unidades')::integer,
        (v_item->>'precio_unitario')::numeric,
        COALESCE((v_item->>'porcentaje_iva')::numeric, 21)
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object('id', p_compra_id);
END;
$$;


-- Logged-in users reach these through the web UI (role `authenticated`) and API
-- keys reach them through the service role. Nothing should be callable by an
-- unauthenticated caller.
--
-- Revoking from `anon` by name is not enough: Postgres grants EXECUTE to PUBLIC
-- on every new function, and `anon` inherits it from there, so the grant has to
-- be taken from PUBLIC and handed back deliberately.
REVOKE EXECUTE ON FUNCTION public.crear_venta       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.actualizar_venta  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crear_compra      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.actualizar_compra FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.limpiar_idempotency_keys FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.crear_venta       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.actualizar_venta  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crear_compra      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.actualizar_compra TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.limpiar_idempotency_keys TO service_role;
