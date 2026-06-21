import { doubleCsrf } from 'csrf-csrf';
import type { Request } from 'express';

export const CSRF_COOKIE = 'csrf_token';
export const CSRF_HEADER = 'x-csrf-token';
// Constant double-submit identifier (no server-side session). Binding to the
// auth cookie would break a token issued before login; double-submit security
// does not depend on it.
const SESSION_ID = 'perpetuum-nota';

/**
 * Double-submit-cookie CSRF protection. The token is delivered in a readable
 * cookie (CSRF_COOKIE) AND must be echoed back in the X-CSRF-Token header on
 * mutating requests; the library verifies the header matches an HMAC of the
 * cookie. SameSite=Lax already blocks most cross-site sends; this closes the
 * gap for top-level navigations and form posts the Contrarian flagged.
 */
export function createCsrf(secret: string) {
  return doubleCsrf({
    getSecret: () => secret,
    getSessionIdentifier: () => SESSION_ID,
    cookieName: CSRF_COOKIE,
    cookieOptions: {
      httpOnly: false, // the SPA must read it to echo it back in the header
      sameSite: 'lax',
      // Default for the protection middleware's re-issue path; the token issuer
      // (CsrfService.generateToken) overrides per request from req.secure.
      secure: false,
      path: '/',
    },
    getCsrfTokenFromRequest: (req: Request) =>
      req.headers[CSRF_HEADER] as string | undefined,
  });
}
