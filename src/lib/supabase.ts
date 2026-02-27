import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

/**
 * Demo mode is active when Supabase env vars are missing or empty.
 * In this mode the app shows example data and skips authentication.
 */
export const isDemoMode = !supabaseUrl || !supabaseAnonKey;

// Only create a real client when we have valid credentials
export const supabase = isDemoMode
    ? (null as any)
    : createClient(supabaseUrl, supabaseAnonKey);

export const getAuthenticatedSupabase = (cookies: any) => {
    if (isDemoMode) return null as any;

    const accessToken = cookies.get("sb-access-token")?.value;
    const refreshToken = cookies.get("sb-refresh-token")?.value;

    const client = createClient(supabaseUrl, supabaseAnonKey);

    if (accessToken && refreshToken) {
        client.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
        });
    }

    return client;
};
