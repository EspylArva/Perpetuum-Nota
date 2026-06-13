import { Injectable, Signal, WritableSignal, inject, signal } from '@angular/core';
import type { NoteDto, ProseMirrorDoc } from '@stickynotes/shared';
import { NotesApi } from '../core/notes.api';

/** A resolved outgoing wikilink: the target note's id + current title. */
export interface NoteLinkRef {
  id: string;
  title: string;
}

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
  /**
   * Outgoing `[[wikilinks]]` resolved server-side, surfaced as pills. Refreshed
   * on load and on conflict-reload; NOT after a plain autosave (updateContent
   * returns only the new timestamp), so a freshly-typed link appears on reopen.
   */
  readonly links: WritableSignal<NoteLinkRef[]>;
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
  /** Ids with an in-flight initial GET, so concurrent open() calls share one. */
  private readonly loading = new Set<string>();
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

  /**
   * Drops all cached entries and pending saves. MUST be called on login and
   * logout: the store is root-scoped, so without this a second account in the
   * same SPA lifetime would read the previous account's cached note content
   * (and skip the server fetch that marks share grants as seen).
   */
  clear(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.loading.clear();
    this.notes.clear();
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
        links: signal<NoteLinkRef[]>([]),
        contentUpdatedAt: null,
      };
      this.notes.set(noteId, n);
    }
    return n;
  }

  /** Reactive outgoing wikilinks for a note (empty until loaded). */
  linksOf(noteId: string): Signal<NoteLinkRef[]> {
    return this.entry(noteId).links;
  }

  /**
   * Seeds an entry from an already-fetched note so a later open() skips the
   * network round-trip. Used by the deep-link path, which fetches the note to
   * validate access before opening it — without this, open() would GET it
   * again. No-op if the entry is already loaded.
   */
  prime(note: NoteDto): void {
    const n = this.entry(note.id);
    if (n.loaded()) return;
    n.content.set(note.content);
    n.contentUpdatedAt = note.contentUpdatedAt;
    n.links.set(note.links ?? []);
    n.loaded.set(true);
    n.serverVersion.update((v) => v + 1);
  }

  /**
   * Ensures the note's content is fetched from the server once. The `loading`
   * guard means concurrent callers (the manager opening the pane AND the editor
   * mounting) share a single GET rather than racing two.
   */
  open(noteId: string): OpenNote {
    const n = this.entry(noteId);
    if (!n.loaded() && !this.loading.has(noteId)) {
      this.loading.add(noteId);
      this.api.get(noteId).subscribe({
        next: (note) => {
          n.content.set(note.content);
          n.contentUpdatedAt = note.contentUpdatedAt;
          n.links.set(note.links ?? []);
          n.loaded.set(true);
          n.serverVersion.update((v) => v + 1);
        },
        complete: () => this.loading.delete(noteId),
        error: () => this.loading.delete(noteId),
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
        n.links.set(note.links ?? []);
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
