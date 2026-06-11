import { Injectable, WritableSignal, inject, signal } from '@angular/core';
import type { ProseMirrorDoc } from '@stickynotes/shared';
import { NotesApi } from '../core/notes.api';

export interface OpenNote {
  readonly id: string;
  readonly content: WritableSignal<ProseMirrorDoc | null>;
  readonly loaded: WritableSignal<boolean>;
  readonly dirty: WritableSignal<boolean>;
  readonly saving: WritableSignal<boolean>;
  contentUpdatedAt: string | null;
}

/**
 * Single source of truth for which notes are "open" and their edit/save lifecycle.
 * Presentation-agnostic: the MVP right-hand pane binds one entry; future floating
 * windows / Electron mount the same <note-editor> against these same entries.
 */
@Injectable({ providedIn: 'root' })
export class OpenNotesStore {
  private readonly api = inject(NotesApi);
  private readonly notes = new Map<string, OpenNote>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly DEBOUNCE_MS = 900;

  /** Returns the entry, creating an empty one if needed. */
  entry(noteId: string): OpenNote {
    let n = this.notes.get(noteId);
    if (!n) {
      n = {
        id: noteId,
        content: signal<ProseMirrorDoc | null>(null),
        loaded: signal(false),
        dirty: signal(false),
        saving: signal(false),
        contentUpdatedAt: null,
      };
      this.notes.set(noteId, n);
    }
    return n;
  }

  /** Ensures the note's content is fetched from the server (once). */
  open(noteId: string): OpenNote {
    const n = this.entry(noteId);
    if (!n.loaded()) {
      this.api.get(noteId).subscribe({
        next: (note) => {
          n.content.set(note.content);
          n.contentUpdatedAt = note.contentUpdatedAt;
          n.loaded.set(true);
        },
      });
    }
    return n;
  }

  /** Records an edit and schedules a debounced autosave. */
  setContent(noteId: string, content: ProseMirrorDoc): void {
    const n = this.entry(noteId);
    n.content.set(content);
    n.dirty.set(true);
    const existing = this.timers.get(noteId);
    if (existing) clearTimeout(existing);
    this.timers.set(
      noteId,
      setTimeout(() => this.flush(noteId), this.DEBOUNCE_MS),
    );
  }

  /** Saves immediately if dirty (e.g. on blur / close / navigation). */
  flush(noteId: string): void {
    const n = this.notes.get(noteId);
    if (!n || !n.dirty()) return;
    const content = n.content();
    if (!content) return;
    const timer = this.timers.get(noteId);
    if (timer) clearTimeout(timer);
    n.saving.set(true);
    this.api.updateContent(noteId, content).subscribe({
      next: (res) => {
        n.contentUpdatedAt = res.contentUpdatedAt;
        n.dirty.set(false);
        n.saving.set(false);
      },
      error: () => n.saving.set(false),
    });
  }
}
