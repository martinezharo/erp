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

    if (!accessToken || !refreshToken) {
        return redirect("/login");
    }

    return next();
});
