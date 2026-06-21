import {
  HttpClient,
  HttpErrorResponse,
  HttpEvent,
  HttpInterceptorFn,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, catchError, from, switchMap, throwError } from 'rxjs';

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

  const send = (): Observable<HttpEvent<unknown>> => {
    const token = readCookie(CSRF_COOKIE);
    const r = token
      ? req.clone({
          headers: req.headers.set(CSRF_HEADER, token),
          withCredentials: true,
        })
      : req.clone({ withCredentials: true });
    return next(r);
  };

  // Fetch (deduped) a fresh token; GET /auth/csrf overwrites a stale cookie.
  const refreshThenSend = (): Observable<HttpEvent<unknown>> => {
    if (!tokenFetch) {
      tokenFetch = http
        .get('/api/auth/csrf', { withCredentials: true })
        .toPromise()
        .then(() => undefined)
        .finally(() => {
          tokenFetch = null;
        });
    }
    return from(tokenFetch).pipe(switchMap(send));
  };

  const first = readCookie(CSRF_COOKIE) ? send() : refreshThenSend();

  // A present-but-stale cookie (the signing secret rotated on a server restart)
  // is still echoed and fails HMAC validation → 403 EBADCSRFTOKEN. Refetch once
  // and retry so mutations self-heal instead of dying until the user clears
  // cookies. One retry only (the retried send isn't wrapped) → no loop.
  // ponytail: gate on 403 alone; an unrelated 403 just costs one wasted refetch.
  return first.pipe(
    catchError((err) =>
      err instanceof HttpErrorResponse && err.status === 403
        ? refreshThenSend()
        : throwError(() => err),
    ),
  );
};
