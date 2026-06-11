import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

/**
 * Sends the httpOnly auth cookie with every request, and on a 401 (outside the
 * auth endpoints themselves) bounces the user to /login.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const withCreds = req.clone({ withCredentials: true });
  return next(withCreds).pipe(
    catchError((err) => {
      if (err.status === 401 && !req.url.includes('/auth/')) {
        void router.navigate(['/login']);
      }
      return throwError(() => err);
    }),
  );
};
