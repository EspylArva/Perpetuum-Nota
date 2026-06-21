import { Routes } from '@angular/router';
import { adminGuard } from './core/admin.guard';
import { authGuard } from './core/auth.guard';
import { Login } from './features/login/login';
import { Manager } from './manager/manager';

// The Settings shell is one lazy component; each route below selects the active
// section via `data.section`. Administration keeps the canonical `/admin/users`
// URL (admin-guarded), now rendering inside Settings.
const settings = () =>
  import('./settings/settings').then((m) => m.Settings);

export const routes: Routes = [
  { path: 'login', component: Login },
  { path: '', component: Manager, canActivate: [authGuard] },
  { path: 'note/:id', component: Manager, canActivate: [authGuard] },
  // GraphView is a standalone full-page route (never shown inside Manager), so
  // it is lazy-loaded to keep it out of the initial bundle.
  {
    path: 'graph',
    canActivate: [authGuard],
    loadComponent: () => import('./graph/graph-view').then((m) => m.GraphView),
  },
  {
    path: 'settings',
    canActivate: [authGuard],
    loadComponent: settings,
    data: { section: 'preferences' },
  },
  {
    path: 'settings/account',
    canActivate: [authGuard],
    loadComponent: settings,
    data: { section: 'account' },
  },
  {
    path: 'settings/app-info',
    canActivate: [authGuard],
    loadComponent: settings,
    data: { section: 'app-info' },
  },
  {
    path: 'admin/users',
    canActivate: [adminGuard],
    loadComponent: settings,
    data: { section: 'administration' },
  },
  { path: '**', redirectTo: '' },
];
