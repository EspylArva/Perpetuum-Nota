import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import type {
  ImportNoteDto,
  NoteExportFormat,
  NoteExportItemDto,
} from '@perpetuum-nota/shared';
import { ExportScopes, NotesApi } from '../core/notes.api';
import { SettingsBackupService } from '../core/settings-backup.service';
import { docToMarkdown } from '../editor/markdown-export';
import { markdownToProseMirror } from '../editor/markdown-import';
import { SettingsPanel } from '../settings/ui/settings-panel';

// Embeddable: rendered inside Settings → Account. Three independent tools —
// settings backup (JSON), notes export (scoped, Markdown or JSON), and notes
// import (Markdown only). File reads/writes happen entirely in the browser;
// the server is touched only to fetch note content and to bulk-create imports.
@Component({
  selector: 'app-data-management',
  imports: [
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
    SettingsPanel,
  ],
  templateUrl: './data-management.html',
  styleUrl: './data-management.scss',
})
export class DataManagement {
  private readonly backup = inject(SettingsBackupService);
  private readonly notesApi = inject(NotesApi);
  private readonly snack = inject(MatSnackBar);

  // --- notes export controls ---
  readonly scopeMine = signal(true);
  readonly scopeShared = signal(false);
  readonly scopePublic = signal(false);
  readonly format = signal<NoteExportFormat>('markdown');
  readonly exportingNotes = signal(false);
  readonly importingNotes = signal(false);

  private readonly scopes = computed<ExportScopes>(() => ({
    mine: this.scopeMine(),
    shared: this.scopeShared(),
    public: this.scopePublic(),
  }));
  readonly canExportNotes = computed(
    () =>
      !this.exportingNotes() &&
      (this.scopeMine() || this.scopeShared() || this.scopePublic()),
  );

  // ---------------------------------------------------------------- settings

  exportSettings(): void {
    const dto = this.backup.snapshot();
    this.download(
      `perpetuum-nota-settings-${this.stamp()}.json`,
      'application/json',
      JSON.stringify(dto, null, 2),
    );
  }

  async onImportSettingsFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-selecting the same file later
    if (!file) return;
    try {
      const data: unknown = JSON.parse(await file.text());
      const { applied } = this.backup.restore(data);
      this.snack.open(`Settings imported: ${applied.join(', ')}.`, 'Dismiss', {
        duration: 5000,
      });
    } catch (e) {
      this.snack.open(
        e instanceof Error ? e.message : 'Could not read the settings file.',
        'Dismiss',
        { duration: 5000 },
      );
    }
  }

  // ------------------------------------------------------------- notes export

  exportNotes(): void {
    if (!this.canExportNotes()) return;
    this.exportingNotes.set(true);
    this.notesApi.exportNotes(this.scopes()).subscribe({
      next: (res) => {
        this.exportingNotes.set(false);
        if (res.count === 0) {
          this.snack.open('No notes matched the selected scopes.', 'Dismiss', {
            duration: 4000,
          });
          return;
        }
        const stamp = this.stamp();
        if (this.format() === 'json') {
          this.download(
            `notes-export-${stamp}.json`,
            'application/json',
            JSON.stringify(res, null, 2),
          );
        } else {
          this.download(
            `notes-export-${stamp}.md`,
            'text/markdown',
            this.notesToMarkdown(res.notes),
          );
        }
        this.snack.open(`Exported ${res.count} note(s).`, 'Dismiss', {
          duration: 4000,
        });
      },
      error: () => {
        this.exportingNotes.set(false);
        this.snack.open('Could not export notes.', 'Dismiss', {
          duration: 5000,
        });
      },
    });
  }

  /** One Markdown document: each note as an `# H1` + body, separated by `---`. */
  private notesToMarkdown(notes: NoteExportItemDto[]): string {
    const docs = notes.map((n) => {
      const heading = `# ${n.title || 'Untitled'}`;
      const body = docToMarkdown(n.content);
      return body ? `${heading}\n\n${body}` : heading;
    });
    return `${docs.join('\n\n---\n\n')}\n`;
  }

  // ------------------------------------------------------------- notes import

  async onImportNotesFiles(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length === 0) return;

    const accepted = files.filter((f) => /\.(md|markdown)$/i.test(f.name));
    const rejected = files.length - accepted.length;
    if (accepted.length === 0) {
      this.snack.open('Only Markdown (.md) files can be imported.', 'Dismiss', {
        duration: 5000,
      });
      return;
    }

    this.importingNotes.set(true);
    let parsed: ImportNoteDto[];
    try {
      parsed = await Promise.all(
        accepted.map(async (file) => {
          const { title, body } = this.splitTitle(await file.text(), file.name);
          return { title, content: markdownToProseMirror(body) };
        }),
      );
    } catch {
      this.importingNotes.set(false);
      this.snack.open('Could not read the selected files.', 'Dismiss', {
        duration: 5000,
      });
      return;
    }

    this.notesApi.importNotes(parsed).subscribe({
      next: (res) => {
        this.importingNotes.set(false);
        const skipped =
          rejected > 0 ? ` (${rejected} non-Markdown file(s) skipped)` : '';
        this.snack.open(`Imported ${res.created} note(s)${skipped}.`, 'Dismiss', {
          duration: 5000,
        });
      },
      error: (e: { error?: { message?: string } }) => {
        this.importingNotes.set(false);
        this.snack.open(
          e?.error?.message ?? 'Could not import the notes.',
          'Dismiss',
          { duration: 5000 },
        );
      },
    });
  }

  /**
   * Splits a Markdown file into a title + body. A leading `# Heading` becomes
   * the note title (and is dropped from the body); otherwise the filename (sans
   * extension) is used.
   */
  private splitTitle(
    markdown: string,
    filename: string,
  ): { title: string; body: string } {
    const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
    let i = 0;
    while (i < lines.length && lines[i].trim() === '') i++;
    const h1 = lines[i]?.match(/^#\s+(.+)$/);
    if (h1) {
      const title = h1[1].trim();
      const body = lines
        .slice(i + 1)
        .join('\n')
        .replace(/^\n+/, '');
      return { title: title || 'Untitled', body };
    }
    const base = filename.replace(/\.(md|markdown)$/i, '').trim();
    return { title: base || 'Untitled', body: markdown };
  }

  // -------------------------------------------------------------- file helpers

  private stamp(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private download(filename: string, mime: string, content: string): void {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}
