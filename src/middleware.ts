import { defineMiddleware } from "astro/middleware";

export const onRequest = defineMiddleware(async ({ cookies, redirect, request }, next) => {
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
