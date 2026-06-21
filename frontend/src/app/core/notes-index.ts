import { Injectable, inject, signal } from '@angular/core';
import { NotesApi } from './notes.api';

/** A note title entry usable as an autocomplete item / link-resolution target. */
export interface NoteIndexEntry {
  id: string;
  title: string;
}

/**
 * A lightweight, app-wide index of every note's id + title, backing two needs of
 * the inline `[[wikilink]]` feature:
 *
 *   1. Autocomplete — the `[[` suggestion popup queries {@link search}.
 *   2. Link resolution fallback — when a note's already-resolved `links()` don't
 *      yet include a freshly-typed `[[Title]]` (autosave doesn't refresh them
 *      until reopen), {@link resolve} maps the title to an id via this index.
 *
 * The data source is `NotesApi.graph()`, whose `nodes` are exactly the user's
 * viewable notes' id+title. The index is refreshed once on construction; callers
 * may `refresh()` again after creating/renaming notes.
 */
@Injectable({ providedIn: 'root' })
export class NotesIndexStore {
  private readonly api = inject(NotesApi);

  readonly notes = signal<NoteIndexEntry[]>([]);

  constructor() {
    this.refresh();
  }

  /** Reloads the full title index from the graph endpoint. */
  refresh(): void {
    this.api.graph().subscribe((g) => this.notes.set(g.nodes));
  }

  /**
   * Case-insensitive substring search over titles, capped at `limit`. Prefix
   * matches are ranked ahead of mid-string matches; an empty query returns the
   * first `limit` notes (in index order).
   */
  search(query: string, limit = 8): NoteIndexEntry[] {
    const all = this.notes();
    const q = query.trim().toLowerCase();
    if (q === '') return all.slice(0, limit);

    const prefix: NoteIndexEntry[] = [];
    const contains: NoteIndexEntry[] = [];
    for (const note of all) {
      const t = note.title.toLowerCase();
      if (t.startsWith(q)) prefix.push(note);
      else if (t.includes(q)) contains.push(note);
    }
    return [...prefix, ...contains].slice(0, limit);
  }

  /**
   * Resolves a title to a note id via a case-insensitive EXACT title match
   * (first match wins on duplicate titles); null when nothing matches.
   */
  resolve(title: string): string | null {
    const t = title.trim().toLowerCase();
    if (t === '') return null;
    const hit = this.notes().find((n) => n.title.toLowerCase() === t);
    return hit ? hit.id : null;
  }
}
