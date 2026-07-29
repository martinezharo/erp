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

export const getAuthenticatedSupabase = (cookies: any) => {
    if (isDemoMode) return null as any;

    const accessToken = cookies.get("sb-access-token")?.value;
    const refreshToken = cookies.get("sb-refresh-token")?.value;

    const client = createClient(supabaseUrl, supabasePublicKey);

    if (accessToken && refreshToken) {
        client.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
        });
    }

    return client;
};
