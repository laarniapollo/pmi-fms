import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE } from "@/lib/constants";

/**
 * Middleware runs on the Edge runtime, where Prisma and bcrypt cannot follow.
 * So it does the one thing it can do without a database: bounce requests that
 * carry no session cookie at all.
 *
 * This is a redirect, not an authorization check. Whether the session is real,
 * unexpired, and permitted for the route is settled server-side by
 * `requireUser` / `requireAction` in each layout and route handler — a forged
 * cookie gets past here and no further.
 */

const PUBLIC_PATHS = ["/login", "/signup", "/pricing"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  const isPublic = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );

  if (!hasSession && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    // Bring them back to what they asked for once they are signed in.
    if (pathname !== "/") url.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  if (hasSession && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Everything except Next internals, the auth API, and static files —
     * matching those would redirect the sign-in page's own assets.
     */
    "/((?!_next/static|_next/image|favicon.ico|api/events|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
