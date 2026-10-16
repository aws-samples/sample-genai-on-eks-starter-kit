import NextAuth from "next-auth";
import Keycloak from "next-auth/providers/keycloak";

/**
 * Auth.js v5 with the Keycloak realm deployed by components/auth/keycloak.
 * Reads AUTH_SECRET, AUTH_KEYCLOAK_ID, AUTH_KEYCLOAK_SECRET and
 * AUTH_KEYCLOAK_ISSUER from the environment (Auth.js picks up the provider vars
 * by convention; they are listed explicitly so a missing value fails loudly).
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Keycloak({
      clientId: process.env.AUTH_KEYCLOAK_ID,
      clientSecret: process.env.AUTH_KEYCLOAK_SECRET,
      issuer: process.env.AUTH_KEYCLOAK_ISSUER,
    }),
  ],
  session: { strategy: "jwt" },
  // Behind the shared ALB the app sees plain HTTP with X-Forwarded-Proto set,
  // so Auth.js has to trust the proxy to build https callback URLs.
  trustHost: true,
  pages: {
    signIn: "/signin",
  },
});
