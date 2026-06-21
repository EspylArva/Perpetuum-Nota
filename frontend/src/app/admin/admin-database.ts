import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { DatabaseStatsDto } from '@perpetuum-nota/shared';
import { MaintenanceApi } from '../core/maintenance.api';
import { openConfirm } from '../shared-ui/confirm-dialog';

/** The exact phrase an admin must type before the rinse button enables. */
const CONFIRM_PHRASE = 'I want to delete all content';

// Embeddable: rendered inside the Settings → Administration section, below the
// user table. Wipes all content (notes/folders/tags/images/shares/links) while
// keeping user accounts — a destructive, type-to-confirm-guarded reset.
@Component({
  selector: 'app-admin-database',
  imports: [
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  templateUrl: './admin-database.html',
  styleUrl: './admin-database.scss',
})
export class AdminDatabase implements OnInit {
  private readonly api = inject(MaintenanceApi);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);

  readonly phrase = CONFIRM_PHRASE;
  readonly stats = signal<DatabaseStatsDto | null>(null);
  readonly rinsing = signal(false);
  readonly confirmText = signal('');

  // Button enables only on an exact phrase match and when not already running.
  readonly canRinse = computed(
    () => this.confirmText().trim() === CONFIRM_PHRASE && !this.rinsing(),
  );

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.api.stats().subscribe({
      next: (s) => this.stats.set(s),
      error: () => this.stats.set(null),
    });
  }

  rinse(): void {
    if (!this.canRinse()) return;
    openConfirm(this.dialog, {
      title: 'Rinse the database?',
      message:
        'This permanently deletes EVERY note, folder, tag, share, link, and ' +
        'image for ALL users. User accounts and passwords are kept. This ' +
        'cannot be undone.',
      confirmLabel: 'Rinse everything',
      destructive: true,
    }).subscribe((ok) => {
      if (!ok) return;
      this.rinsing.set(true);
      this.api.rinse().subscribe({
        next: (r) => {
          this.rinsing.set(false);
          this.confirmText.set('');
          this.snack.open(
            `Database rinsed — removed ${r.notes} notes, ${r.folders} folders, ` +
              `${r.tags} tags, and ${r.images} images.`,
            'Dismiss',
            { duration: 6000 },
          );
          this.refresh();
        },
        error: (e: { error?: { message?: string } }) => {
          this.rinsing.set(false);
          this.snack.open(
            e?.error?.message ?? 'Could not rinse the database.',
            'Dismiss',
            { duration: 5000 },
          );
        },
      });
    });
  }
}
