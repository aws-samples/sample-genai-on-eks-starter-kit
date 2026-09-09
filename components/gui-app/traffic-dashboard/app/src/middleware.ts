import { auth } from "@/auth";

/**
 * Every page and API route is behind auth. The matcher below excludes only the
 * Auth.js endpoints themselves, the sign-in page and static assets — without
 * that exclusion the OIDC redirect would loop.
 */
export default auth((req) => {
  if (!req.auth && req.nextUrl.pathname !== "/signin") {
    const signInUrl = new URL("/signin", req.nextUrl.origin);
    signInUrl.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search);
    return Response.redirect(signInUrl);
  }
});

export const config = {
  matcher: ["/((?!api/auth|signin|_next/static|_next/image|favicon.ico).*)"],
};
