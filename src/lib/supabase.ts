import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;

/**
 * Supabase replaced the JWT-based `anon` key with the publishable key
 * (`sb_publishable_...`), which can be rotated on its own instead of through the
 * project's JWT secret. The new name wins when set; the legacy one still works,
 * so existing deployments need no change.
 */
const supabasePublicKey =
    import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

/**
 * Demo mode is active when Supabase env vars are missing or empty.
 * In this mode the app shows example data and skips authentication.
 */
export const isDemoMode = !supabaseUrl || !supabasePublicKey;

// Only create a real client when we have valid credentials
export const supabase = isDemoMode
    ? (null as any)
    : createClient(supabaseUrl, supabasePublicKey);

/**
 * A Supabase client that acts as the logged-in user.
 *
 * The token travels as an `Authorization` header rather than through
 * `setSession`, which is asynchronous: the previous code did not await it, so a
 * query issued straight afterwards could still race the session being applied
 * and run as `anon` instead of as the user. A header is applied at construction
 * time and cannot race.
 *
 * This only *presents* a token; it does not verify one. Nothing here is an
 * authentication check — the middleware validates the session before any route
 * gets to use this client.
 */
export const getAuthenticatedSupabase = (cookies: any) => {
    if (isDemoMode) return null as any;

    const accessToken = cookies.get("sb-access-token")?.value;

    return createClient(supabaseUrl, supabasePublicKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        ...(accessToken
            ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } }
            : {}),
    });
};
