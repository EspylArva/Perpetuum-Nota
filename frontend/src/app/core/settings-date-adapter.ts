import { EnvironmentProviders, Provider, inject } from '@angular/core';
import {
  DateAdapter,
  NativeDateAdapter,
  provideNativeDateAdapter,
} from '@angular/material/core';
import { SettingsStore } from './settings.store';

/**
 * A `NativeDateAdapter` whose first day of the week follows the user's
 * Settings (`weekStart`), so the Material datepicker starts on Sunday or
 * Monday to match their preference.
 */
export class SettingsDateAdapter extends NativeDateAdapter {
  private readonly settings = inject(SettingsStore);

  override getFirstDayOfWeek(): number {
    return this.settings.weekStart() === 'monday' ? 1 : 0;
  }
}

/**
 * Provides the native date adapter plus our settings-aware override. Use this
 * in place of a bare `provideNativeDateAdapter()`: the later `DateAdapter`
 * binding wins, so the datepicker picks up the user's week-start.
 */
export function provideSettingsDateAdapter(): (Provider | EnvironmentProviders)[] {
  return [
    provideNativeDateAdapter(),
    { provide: DateAdapter, useClass: SettingsDateAdapter },
  ];
}
