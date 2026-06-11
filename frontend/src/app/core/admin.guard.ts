import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthService } from './auth.service';

/**
 * Allows ADMIN users only. Self-sufficient: hydrates the current user via /me if
 * needed (so it doesn't depend on another guard running first), then checks role.
 */
export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const verdict = (): boolean | UrlTree =>
    auth.user()?.role === 'ADMIN' ? true : router.createUrlTree(['/']);

  if (auth.user()) return verdict();

  return auth.me().pipe(
    map(() => verdict()),
    catchError(() => of(router.createUrlTree(['/login']))),
  );
};
