/**
 * How a route is authenticated, decided from its path alone.
 *
 * Kept separate from the middleware so the policy is one small pure function
 * that can be enumerated in tests, rather than a chain of `if`s tangled up with
 * cookie reads and redirects.
 */
export type RoutePolicy =
    /** No authentication: the login page and the endpoint that signs you in. */
    | "public"
    /** Authenticates itself from an `Authorization` header; the middleware stays out of the way. */
    | "self_authenticated"
    /** Needs a valid session; an anonymous caller gets a JSON 401. */
    | "session_json"
    /** Needs a valid session; an anonymous caller is redirected to the login page. */
    | "session_redirect";

const PUBLIC_ROUTES = new Set(["/login", "/api/auth/signin"]);

/**
 * The machine-facing API carries an API key in a header, not in cookies.
 * Redirecting a programmatic caller to an HTML login page would turn a clear
 * 401 into a confusing 200, so those routes resolve their own auth.
 */
const SELF_AUTHENTICATED_PREFIX = "/api/v1/";

const API_PREFIX = "/api/";

export function routePolicy(pathname: string): RoutePolicy {
    if (PUBLIC_ROUTES.has(pathname)) return "public";
    if (pathname.startsWith(SELF_AUTHENTICATED_PREFIX)) return "self_authenticated";
    // Everything else under /api/ is the browser UI's own JSON API. It is
    // fetched by scripts, so an HTML redirect would be parsed as a successful
    // response body; these get a 401 instead.
    if (pathname.startsWith(API_PREFIX)) return "session_json";
    return "session_redirect";
}
