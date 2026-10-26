import { DASHBOARD_ROUTE } from "@/lib/auth/config";

/** Routes that require an authenticated Supabase session (dashboard). */
export const PROTECTED_ROUTES = [
  "/dashboard",
  "/upload",
  "/translator",
  "/risk",
  "/approvals",
  "/analytics",
  "/notifications",
  "/integrations",
  "/billing",
  "/pipeline",
  "/audit",
  "/settings",
  "/onboarding",
  "/onboarding/welcome",
  "/agents",
  "/agents/templates",
  "/templates",
  "/decision-agents",
  "/monitor",
  "/runs",
] as const;

/** Auth pages — signed-in users are redirected to the dashboard. */
export const AUTH_ROUTES = ["/login", "/signup", "/forgot-password"] as const;

export { DASHBOARD_ROUTE };

export const DEFAULT_LOGIN_REDIRECT = DASHBOARD_ROUTE;

export function isProtectedRoute(pathname: string): boolean {
  return PROTECTED_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}

export function isAuthRoute(pathname: string): boolean {
  return AUTH_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}

export function sanitizeRedirect(path: string | null | undefined): string {
  if (!path || !path.startsWith("/") || path.startsWith("//")) {
    return DASHBOARD_ROUTE;
  }
  if (isAuthRoute(path) || path.startsWith("/auth/")) {
    return DASHBOARD_ROUTE;
  }
  return path;
}
