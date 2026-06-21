import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { BreakpointObserver } from '@angular/cdk/layout';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import type { AppInfoDto } from '@perpetuum-nota/shared';
import { DataManagement } from '../account/data-management';
import { AdminDatabase } from '../admin/admin-database';
import { AdminUsers } from '../admin/admin-users';
import { AppInfoApi } from '../core/app-info.api';
import { AuthService } from '../core/auth.service';
import { DATE_FORMATS, DateFormat } from '../core/date-format';
import { SettingsStore } from '../core/settings.store';
import { ThemeName, ThemeStore } from '../core/theme.store';
import { ChangePasswordForm } from '../features/change-password/change-password-form';
import { SETTINGS_SECTIONS, SettingsSection } from './settings-section';
import { SettingsPanel } from './ui/settings-panel';
import { SettingSelect, SettingOption } from './ui/setting-select';
import { SettingToggle } from './ui/setting-toggle';

/**
 * Settings shell: a left navigation drawer (groups) + a scrollable content area
 * whose section is driven by the route's `data.section`. Each group renders one
 * or more `app-settings-panel`s built from the generic typed setting fields
 * (Preferences), or projects custom content (inline password form, embedded
 * admin users, read-only app-info grid).
 */
@Component({
  selector: 'app-settings',
  imports: [
    RouterLink,
    MatToolbarModule,
    MatSidenavModule,
    MatListModule,
    MatButtonModule,
    MatIconModule,
    SettingsPanel,
    SettingSelect,
    SettingToggle,
    ChangePasswordForm,
    AdminUsers,
    AdminDatabase,
    DataManagement,
  ],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly appInfo = inject(AppInfoApi);
  private readonly route = inject(ActivatedRoute);
  private readonly breakpoints = inject(BreakpointObserver);
  readonly theme = inject(ThemeStore);
  readonly settings = inject(SettingsStore);

  readonly user = this.auth.user;

  /** Active section from the route data (drives the content @switch + highlight). */
  private readonly routeData = toSignal(this.route.data, {
    initialValue: this.route.snapshot.data,
  });
  readonly active = computed<SettingsSection>(
    () => (this.routeData()['section'] as SettingsSection) ?? 'preferences',
  );

  /** Nav items, hiding Administration for non-admins. */
  readonly sections = computed(() =>
    SETTINGS_SECTIONS.filter(
      (s) => !s.adminOnly || this.user()?.role === 'ADMIN',
    ),
  );

  // --- responsive drawer (side on desktop, overlay on handset) ---
  readonly isHandset = toSignal(
    this.breakpoints.observe('(max-width: 900px)').pipe(map((r) => r.matches)),
    { initialValue: false },
  );
  readonly drawerOpen = signal(false);

  // --- preference field options ---
  readonly themeOptions: readonly SettingOption[] = this.theme.themes.map(
    (t) => ({ value: t.value, label: t.label }),
  );
  readonly dateFormatOptions: readonly SettingOption[] = DATE_FORMATS.map(
    (f) => ({ value: f.value, label: f.label, hint: f.example }),
  );

  // --- app info ---
  readonly info = signal<AppInfoDto | null>(null);
  readonly today = new Date();

  ngOnInit(): void {
    // Only the App info section needs the build metadata; each settings route
    // mounts its own shell instance, so fetch lazily to avoid needless calls.
    if (this.active() === 'app-info') {
      this.appInfo.get().subscribe({
        next: (i) => this.info.set(i),
        error: () => this.info.set(null),
      });
    }
  }

  buildTimeDisplay(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : this.settings.format(d);
  }

  setThemeName(name: string): void {
    this.theme.setThemeName(name as ThemeName);
  }

  setDateFormat(f: string): void {
    this.settings.setDateFormat(f as DateFormat);
  }

  setDark(dark: boolean): void {
    this.theme.set(dark ? 'dark' : 'light');
  }

  setMonday(monday: boolean): void {
    this.settings.setWeekStart(monday ? 'monday' : 'sunday');
  }

  setAbsoluteDates(absolute: boolean): void {
    this.settings.setDueDisplay(absolute ? 'absolute' : 'relative');
  }

  setConfirmOnDelete(on: boolean): void {
    this.settings.setConfirmOnDelete(on);
  }

  setNumberedHeadings(on: boolean): void {
    this.settings.setNumberedHeadings(on);
  }
}
