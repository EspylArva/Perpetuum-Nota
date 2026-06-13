import { Routes } from '@angular/router';
import { adminGuard } from './core/admin.guard';
import { authGuard } from './core/auth.guard';
import { AdminUsers } from './admin/admin-users';
import { Login } from './features/login/login';
import { Manager } from './manager/manager';

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
    path: 'admin/users',
    component: AdminUsers,
    canActivate: [adminGuard],
  },
  { path: '**', redirectTo: '' },
];
