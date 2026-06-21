import { Component, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ThemeStore } from '../core/theme.store';
import { SidenavStore } from '../core/sidenav.store';

/**
 * Top app bar: drawer/sidebar toggle, brand, theme switch, settings link, the
 * current-user pill, and sign-out. Reads the global theme + sidenav stores
 * directly; the manager owns the mobile drawer (`toggleSidebar`) and the session
 * (`logout`). `display: contents` keeps the toolbar a direct flex child of the
 * manager shell so the bar still pins to the top.
 */
@Component({
  selector: 'app-manager-toolbar',
  imports: [RouterLink, MatButtonModule, MatIconModule, MatToolbarModule, MatTooltipModule],
  templateUrl: './manager-toolbar.html',
  styleUrl: './manager-toolbar.scss',
})
export class ManagerToolbar {
  readonly isHandset = input<boolean>(false);
  readonly userName = input<string | null | undefined>(undefined);

  readonly toggleSidebar = output<void>();
  readonly logout = output<void>();

  readonly theme = inject(ThemeStore);
  readonly sidenav = inject(SidenavStore);
}
