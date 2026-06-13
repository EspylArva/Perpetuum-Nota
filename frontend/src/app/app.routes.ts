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
  {
    path: 'admin/users',
    component: AdminUsers,
    canActivate: [adminGuard],
  },
  { path: '**', redirectTo: '' },
];
