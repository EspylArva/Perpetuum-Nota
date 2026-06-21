/** The settings groups shown in the left navigation drawer. */
export type SettingsSection =
  | 'preferences'
  | 'account'
  | 'administration'
  | 'app-info';

export interface SectionMeta {
  id: SettingsSection;
  label: string;
  /** Short subtitle shown under the label in the nav drawer. */
  description: string;
  /** mat-icon name. */
  icon: string;
  /** routerLink target for this section. */
  link: string[];
  /** Only visible/reachable by admins. */
  adminOnly?: boolean;
}

/**
 * Single source of truth for the settings nav. Administration keeps the
 * canonical `/admin/users` URL; the other sections live under `/settings/*`.
 */
export const SETTINGS_SECTIONS: readonly SectionMeta[] = [
  {
    id: 'preferences',
    label: 'Preferences',
    description: 'Appearance, theme, and dates',
    icon: 'tune',
    link: ['/settings'],
  },
  {
    id: 'account',
    label: 'Account',
    description: 'Password & sign-in',
    icon: 'account_circle',
    link: ['/settings/account'],
  },
  {
    id: 'administration',
    label: 'Administration',
    description: 'Manage users & access',
    icon: 'admin_panel_settings',
    link: ['/admin/users'],
    adminOnly: true,
  },
  {
    id: 'app-info',
    label: 'App info',
    description: 'Version & build details',
    icon: 'info',
    link: ['/settings/app-info'],
  },
];
