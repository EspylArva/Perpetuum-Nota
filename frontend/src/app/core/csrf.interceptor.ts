import {
  HttpClient,
  HttpEvent,
  HttpInterceptorFn,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, from, switchMap } from 'rxjs';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_COOKIE = 'csrf_token';
const CSRF_HEADER = 'X-CSRF-Token';

let tokenFetch: Promise<void> | null = null;

function readCookie(name: string): string | null {
  const m = document.cookie.match(
    new RegExp('(?:^|; )' + name + '=([^;]*)'),
  );
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Attaches the CSRF token header to mutating requests (double-submit). The token
 * lives in a readable cookie set by GET /api/auth/csrf; if it's missing when a
 * mutation fires, we fetch it once first. Safe methods pass through untouched.
 */
export const csrfInterceptor: HttpInterceptorFn = (req, next) => {
  if (SAFE_METHODS.has(req.method) || req.url.includes('/auth/csrf')) {
    return next(req);
  }

  const http = inject(HttpClient);

  const attach = (): Observable<HttpEvent<unknown>> => {
    const token = readCookie(CSRF_COOKIE);
    const r = token
      ? req.clone({
          headers: req.headers.set(CSRF_HEADER, token),
          withCredentials: true,
        })
      : req.clone({ withCredentials: true });
    return next(r);
  };

  if (readCookie(CSRF_COOKIE)) {
    return attach();
  }

  // No token yet — fetch one (deduped), then proceed.
  if (!tokenFetch) {
    tokenFetch = http
      .get('/api/auth/csrf', { withCredentials: true })
      .toPromise()
      .then(() => undefined)
      .finally(() => {
        tokenFetch = null;
      });
  }
  return from(tokenFetch).pipe(switchMap(() => attach()));
};
