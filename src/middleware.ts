import { defineMiddleware } from "astro/middleware";
import { getAuthenticatedSupabase, isDemoMode } from "./lib/supabase";
import { routePolicy } from "./lib/auth/routes";
import { getLangFromHeader, getLocale, useTranslations } from "./i18n/utils";

const SESSION_COOKIES = ["sb-access-token", "sb-refresh-token"] as const;

function unauthorizedJson(message: string): Response {
    return new Response(JSON.stringify({ error: message }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
    });
}

export const onRequest = defineMiddleware(async ({ cookies, redirect, request, locals }, next) => {
    // Resolve language from the browser's Accept-Language header. Done first so
    // it is available to both pages and API routes (including demo mode).
    const lang = getLangFromHeader(request.headers.get("accept-language"));
    locals.lang = lang;
    locals.locale = getLocale(lang);
    locals.t = useTranslations(lang);

    // In demo mode, skip all authentication checks
    if (isDemoMode) {
        return next();
    }

    const policy = routePolicy(new URL(request.url).pathname);
    if (policy === "public" || policy === "self_authenticated") {
        return next();
    }

    // The session is *validated*, not merely detected. Checking that the cookies
    // exist would let anyone through by sending two cookies of their own
    // choosing, leaving row-level security as the only thing between a forged
    // request and the books.
    const supabase = getAuthenticatedSupabase(cookies);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        if (policy === "session_json") {
            return unauthorizedJson(locals.t("api.unauthorized"));
        }
        // Clear the rejected cookies so a stale or tampered session does not
        // bounce the browser between /login and the page forever.
        for (const name of SESSION_COOKIES) cookies.delete(name, { path: "/" });
        return redirect("/login");
    }

    // Handed to pages and routes so a validated session is not re-fetched once
    // per component.
    locals.user = user;
    locals.supabase = supabase;

    return next();
});
