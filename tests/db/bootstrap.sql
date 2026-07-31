-- ============================================================
-- Supabase stand-ins, so db-structure/*.sql loads unmodified.
--
-- These recreate only what the schema and its policies actually reference: the
-- three PostgREST roles, `auth.uid()` and `auth.users`. Everything else about a
-- real Supabase project is irrelevant to whether a policy lets the wrong person
-- read a row.
--
-- The point of loading the real db-structure files on top of this is that the
-- policies under test are the ones in the repo, not a paraphrase of them.
-- ============================================================

-- PostgREST connects as one of these. `anon` is an unauthenticated visitor,
-- `authenticated` is a logged-in user, and `service_role` is the server-side key
-- that bypasses RLS.
--
-- Roles live in the cluster, not in the database, so they survive a dropped test
-- database and have to be created conditionally.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END
$$;

GRANT anon, authenticated, service_role TO CURRENT_USER;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE auth.users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

/**
 * Supabase derives this from the request's JWT. PostgREST exposes the claims as
 * a GUC, so setting `request.jwt.claim.sub` is exactly how a test says "this
 * request arrives as that user" — the same mechanism the real thing uses.
 */
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')::text;
$$;

-- PostgREST grants usage on the API schema to its roles, and grants table
-- privileges broadly; 02-rls.sql then narrows them. Starting permissive is what
-- makes the suite meaningful: a table that ends up readable does so because a
-- policy allowed it, not because a grant was forgotten.
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role;

-- Only the server ever writes to auth.users; the seed does it through
-- service_role, the same way Supabase Auth would.
GRANT SELECT, INSERT ON auth.users TO service_role;
