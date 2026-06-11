import { Injectable, WritableSignal, inject, signal } from '@angular/core';
import type { ProseMirrorDoc } from '@stickynotes/shared';
import { NotesApi } from '../core/notes.api';

export interface OpenNote {
  readonly id: string;
  readonly content: WritableSignal<ProseMirrorDoc | null>;
  readonly loaded: WritableSignal<boolean>;
  readonly dirty: WritableSignal<boolean>;
  readonly saving: WritableSignal<boolean>;
  /** Autosave hit a 409 — the note changed elsewhere; user must resolve. */
  readonly conflict: WritableSignal<boolean>;
  /** Last autosave failed for a non-conflict reason (offline, 5xx…). */
  readonly saveError: WritableSignal<boolean>;
  /**
   * Bumped every time `content` is replaced FROM THE SERVER (initial load,
   * conflict reload) — the editor component re-applies content only on version
   * changes, never on local edits echoing back through the signal.
   */
  readonly serverVersion: WritableSignal<number>;
  contentUpdatedAt: string | null;
}

/**
 * Single source of truth for which notes are "open" and their edit/save lifecycle.
 * Presentation-agnostic: the MVP right-hand pane binds one entry; future floating
 * windows / Electron mount the same <note-editor> against these same entries.
 *
 * Autosaves carry the last-seen contentUpdatedAt so the server can 409 when the
 * note moved on (second tab, second device). On conflict the entry freezes
 * autosave until the user reloads the server copy or overwrites it.
 */
@Injectable({ providedIn: 'root' })
export class OpenNotesStore {
  private readonly api = inject(NotesApi);
  private readonly notes = new Map<string, OpenNote>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly DEBOUNCE_MS = 900;

  constructor() {
    // Best-effort flush when the tab hides or unloads, so the last <900ms of
    // typing isn't lost. (visibilitychange also covers mobile tab switches.)
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.flushAll();
      });
      window.addEventListener('pagehide', () => this.flushAll());
    }
  }

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
        conflict: signal(false),
        saveError: signal(false),
        serverVersion: signal(0),
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
          n.serverVersion.update((v) => v + 1);
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
    if (n.conflict()) return; // frozen until the user resolves
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
    if (!n || !n.dirty() || n.conflict() || n.saving()) return;
    const content = n.content();
    if (!content) return;
    const timer = this.timers.get(noteId);
    if (timer) clearTimeout(timer);
    this.save(n, content, n.contentUpdatedAt);
  }

  flushAll(): void {
    for (const id of this.notes.keys()) this.flush(id);
  }

  /** Discards local edits and reloads the server copy (conflict resolution). */
  reload(noteId: string): void {
    const n = this.entry(noteId);
    this.api.get(noteId).subscribe({
      next: (note) => {
        n.content.set(note.content);
        n.contentUpdatedAt = note.contentUpdatedAt;
        n.dirty.set(false);
        n.conflict.set(false);
        n.saveError.set(false);
        n.loaded.set(true);
        n.serverVersion.update((v) => v + 1);
      },
    });
  }

  /** Keeps local edits, overwriting whatever the server has (conflict resolution). */
  overwrite(noteId: string): void {
    const n = this.entry(noteId);
    const content = n.content();
    if (!content) return;
    n.conflict.set(false);
    this.save(n, content, null); // no base = unconditional write
  }

  private save(
    n: OpenNote,
    content: ProseMirrorDoc,
    base: string | null,
  ): void {
    n.saving.set(true);
    this.api.updateContent(n.id, content, base).subscribe({
      next: (res) => {
        n.contentUpdatedAt = res.contentUpdatedAt;
        n.dirty.set(false);
        n.saving.set(false);
        n.saveError.set(false);
      },
      error: (err) => {
        n.saving.set(false);
        if (err?.status === 409) {
          n.conflict.set(true);
        } else {
          n.saveError.set(true);
        }
      },
    });
  }
}
