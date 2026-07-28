import { defineMiddleware } from "astro/middleware";
import { isDemoMode } from "./lib/supabase";
import { getLangFromHeader, getLocale, useTranslations } from "./i18n/utils";

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

    const accessToken = cookies.get("sb-access-token");
    const refreshToken = cookies.get("sb-refresh-token");

    // Define public routes that don't require authentication
    const publicRoutes = ["/login", "/api/auth/signin"];
    const url = new URL(request.url);

    if (publicRoutes.includes(url.pathname)) {
        return next();
    }

    // The machine-facing API authenticates itself: an API key travels in a
    // header, not in the session cookies checked below. Redirecting a
    // programmatic caller to an HTML login page would turn a clear 401 into a
    // confusing 200, so these routes always resolve their own auth and return
    // JSON errors.
    if (url.pathname.startsWith("/api/v1/")) {
        return next();
    }

    if (!accessToken || !refreshToken) {
        return redirect("/login");
    }

    return next();
});
