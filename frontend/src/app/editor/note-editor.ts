import {
  Component,
  Injector,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';
import { Editor } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import { Slice } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { TiptapEditorDirective } from 'ngx-tiptap';
import type { ProseMirrorDoc, ProseMirrorNode } from '@perpetuum-nota/shared';
import { UploadsApi } from '../core/uploads.api';
import { NotesIndexStore } from '../core/notes-index';
import { EMPTY_DOC, buildExtensions } from './extensions';
import { postProcessHtmlForExport } from './export-postprocess';
import { docToMarkdown } from './markdown-export';
import { looksLikeMarkdown, markdownToProseMirror } from './markdown-import';
import { OpenNote, OpenNotesStore } from './open-notes.store';
import { isSafeLinkUrl } from './safe-url';
import { extractToc, headingNumbers, TocEntry } from './toc';
import { SettingsStore } from '../core/settings.store';
import { slugifyHeading } from './wikilink-parse';
import { migrateWikilinkText } from './wikilink-migrate';

const TOC_STORAGE_KEY = 'sticky.toc';

/**
 * Presentation-agnostic note editor. Knows nothing about panes, windows, or
 * routing — it binds a noteId to the OpenNotesStore and renders a TipTap editor.
 * The same component is reused by the v2 floating windows / Electron client.
 */
@Component({
  selector: 'app-note-editor',
  imports: [
    TiptapEditorDirective,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatTooltipModule,
  ],
  templateUrl: './note-editor.html',
  styleUrl: './note-editor.scss',
  host: {
    '(document:keydown.escape)': 'onEsc()',
  },
})
export class NoteEditor implements OnInit, OnDestroy {
  readonly noteId = input.required<string>();
  readonly editable = input(true);
  /** Filename stem for "Export" (usually the note title). */
  readonly exportName = input<string>('note');

  private readonly store = inject(OpenNotesStore);
  private readonly uploads = inject(UploadsApi);
  private readonly injector = inject(Injector);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly notesIndex = inject(NotesIndexStore);
  private readonly settings = inject(SettingsStore);

  /** Whether headings render automatic outline numbers (Preferences toggle). */
  readonly numberedHeadings = this.settings.numberedHeadings;

  editor!: Editor;
  protected entry!: OpenNote;
  private appliedServerVersion = 0;
  private suppressUpdate = false;

  private readonly tick = signal(0);

  readonly status = computed(() => {
    void this.tick();
    if (this.entry?.conflict()) return 'Conflict';
    if (this.entry?.saving()) return 'Saving…';
    if (this.entry?.saveError()) return 'Save failed — retrying on next edit';
    if (this.entry?.dirty()) return 'Unsaved changes';
    return this.entry?.loaded() ? 'Saved' : 'Loading…';
  });

  readonly conflicted = computed(() => {
    void this.tick();
    return this.entry?.conflict() ?? false;
  });

  // --- TOC ---
  // The ToC is a slim, always-present (when the note has headings) left nav bar.
  // It starts MINIMIZED every time a note opens — a fresh NoteEditor instance is
  // created per note (manager renders it inside `@for (id …; track id)`), so a
  // `signal(false)` initial value reliably gives a minimized default on open.
  // The localStorage key only records the user's last expand *preference* for
  // analytics/parity; it intentionally does NOT seed the initial state.
  readonly tocExpanded = signal(false);
  readonly tocEntries = signal<TocEntry[]>([]);

  /**
   * ToC entries paired with their outline number — populated only when the
   * "Number headings" preference is on, otherwise an empty `num` per entry so
   * the ToC matches the editor surface.
   */
  readonly tocNumbered = computed(() => {
    const entries = this.tocEntries();
    const nums = this.numberedHeadings()
      ? headingNumbers(entries)
      : entries.map(() => '');
    return entries.map((e, i) => ({ ...e, num: nums[i] }));
  });

  toggleToc(): void {
    const next = !this.tocExpanded();
    this.tocExpanded.set(next);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(TOC_STORAGE_KEY, String(next));
    }
  }

  // --- Fullscreen ---
  readonly fullscreen = signal(false);

  toggleFullscreen(): void {
    this.fullscreen.update((v) => !v);
  }

  /** Exit fullscreen on Escape (wired via host metadata). No-op otherwise. */
  onEsc(): void {
    if (this.fullscreen()) this.fullscreen.set(false);
  }

  navigateToHeading(entry: TocEntry): void {
    this.editor.chain().focus().setTextSelection(entry.pos + 1).scrollIntoView().run();
  }

  // --- wikilinks ---

  /**
   * Resolves a `[[Title]]` to a note id. Prefers this note's already-resolved
   * outgoing links (case-insensitive title match), falling back to the global
   * title index — which covers freshly-typed links not yet reflected in
   * `entry.links()` (the debounced autosave refreshes them, but only once it
   * lands, so a just-typed link resolves via the index until then).
   */
  private resolveWikiLink(title: string): string | null {
    const want = title.trim().toLowerCase();
    const hit = this.entry?.links().find((l) => l.title.toLowerCase() === want);
    if (hit) return hit.id;
    return this.notesIndex.resolve(title);
  }

  /**
   * Navigates a clicked `[[wikilink]]`. A self-link with a `#heading` scrolls
   * within this editor; anything else routes to `/note/:id`, carrying an
   * `h-<slug>` fragment so the target editor can scroll to the heading on open.
   */
  private navigateWikiLink(id: string, heading: string | null): void {
    if (id === this.noteId() && heading) {
      this.scrollToHeadingSlug(slugifyHeading(heading));
      return;
    }
    void this.router.navigate(
      ['/note', id],
      heading ? { fragment: 'h-' + slugifyHeading(heading) } : {},
    );
  }

  /**
   * Scrolls this editor to the heading whose slugified text matches `slug`.
   * Returns true if a heading was found (so the deep-link effect can stop
   * retrying), false otherwise.
   */
  private scrollToHeadingSlug(slug: string): boolean {
    if (!this.editor) return false;
    // Read the TOC straight off the editor's live doc rather than the
    // `tocEntries` signal — the deep-link scroll effect and the content-apply
    // effect both react to serverVersion, and their relative order isn't
    // guaranteed, so the signal may not be refreshed yet.
    const entries = extractToc(this.editor.getJSON() as ProseMirrorDoc);
    const match = entries.find((e) => slugifyHeading(e.text) === slug);
    if (!match) return false;
    this.editor.chain().focus().setTextSelection(match.pos + 1).scrollIntoView().run();
    return true;
  }

  ngOnInit(): void {
    this.entry = this.store.open(this.noteId());

    this.editor = new Editor({
      extensions: buildExtensions({
        wikilink: {
          resolve: (title) => this.resolveWikiLink(title),
          navigate: (id, heading) => this.navigateWikiLink(id, heading),
          suggest: (query) => this.notesIndex.search(query),
        },
      }),
      editable: this.editable(),
      // Migrate any legacy `[[Title]]` text in stored content into atomic
      // wikilink nodes so old notes render (and behave) as pills.
      content: migrateWikilinkText(
        (this.entry.content() ?? EMPTY_DOC) as ProseMirrorDoc,
      ) as JSONContent,
      editorProps: {
        handlePaste: (_view, event) => this.handlePasteEvent(event),
        handleDrop: (_view, event) =>
          this.handleImageEvent((event as DragEvent).dataTransfer),
        // Copying puts Markdown on the clipboard's text/plain flavour, so text
        // pasted into another window (or note) carries the formatting as
        // Markdown source rather than styled HTML / flat text.
        clipboardTextSerializer: (slice) => {
          const content = slice.content.toJSON() as ProseMirrorNode[] | null;
          return docToMarkdown({ type: 'doc', content: content ?? [] });
        },
        // Pasted content adopts the note's default text colour: strip any
        // inherited colour marks the source carried (rich/HTML pastes).
        transformPasted: (slice, view) => stripPastedColors(slice, view),
      },
      onUpdate: ({ editor }) => {
        if (this.suppressUpdate) return;
        const doc = editor.getJSON() as ProseMirrorDoc;
        this.store.setContent(this.noteId(), doc);
        this.tocEntries.set(extractToc(doc));
      },
      onTransaction: () => this.tick.update((v) => v + 1),
    });

    // Apply content into the editor whenever the STORE got a fresh server copy
    // (initial load, conflict reload) — local edits don't bump serverVersion,
    // so typing never round-trips through setContent.
    effect(
      () => {
        const version = this.entry.serverVersion();
        const content = this.entry.content();
        if (
          content &&
          this.entry.loaded() &&
          version !== this.appliedServerVersion
        ) {
          this.appliedServerVersion = version;
          this.suppressUpdate = true;
          this.editor.commands.setContent(
            migrateWikilinkText(content) as JSONContent,
          );
          this.suppressUpdate = false;
          // Refresh TOC after a server-driven content replacement.
          this.tocEntries.set(extractToc(content));
        }
      },
      { injector: this.injector },
    );

    // Cross-note deep link: when the route carries an `h-<slug>` fragment, scroll
    // to the matching heading once the note's content has loaded. Best-effort and
    // runs once — it relies on the deep-link route having opened THIS note.
    const fragment = this.route.snapshot.fragment;
    if (fragment?.startsWith('h-')) {
      const slug = fragment.slice(2);
      let scrolled = false;
      effect(
        () => {
          // React to load + each server-driven content version so the scroll
          // fires after the real content is in the editor, not the empty doc.
          const loaded = this.entry.loaded();
          void this.entry.serverVersion();
          if (loaded && !scrolled && this.scrollToHeadingSlug(slug)) {
            scrolled = true;
          }
        },
        { injector: this.injector },
      );
    }
  }

  ngOnDestroy(): void {
    this.store.flush(this.noteId());
    this.editor?.destroy();
  }

  // --- conflict resolution ---
  reloadServerCopy(): void {
    this.store.reload(this.noteId());
  }

  keepMine(): void {
    this.store.overwrite(this.noteId());
  }

  /**
   * Paste pipeline: images first (existing upload path), then Markdown. When the
   * clipboard holds plain text that looks like Markdown (and no richer HTML
   * flavour), it's parsed into formatted nodes — headings, lists, checkboxes,
   * code blocks, etc. Everything else falls through to ProseMirror's default
   * paste (which `transformPasted` colour-normalises).
   */
  private handlePasteEvent(event: ClipboardEvent): boolean {
    const data = event.clipboardData;
    if (this.handleImageEvent(data)) return true;
    if (!data || !this.editable()) return false;

    // A real HTML flavour means a rich source; let ProseMirror map it (its
    // result is colour-normalised by transformPasted).
    const html = data.getData('text/html');
    if (html && html.trim()) return false;

    const text = data.getData('text/plain');
    if (!text || !looksLikeMarkdown(text)) return false;

    const doc = markdownToProseMirror(text);
    this.editor
      .chain()
      .focus()
      .insertContent((doc.content ?? []) as JSONContent[])
      .run();
    return true;
  }

  /** Uploads any image files from a paste/drop and inserts them; returns true if handled. */
  private handleImageEvent(data: DataTransfer | null): boolean {
    if (!data || !this.editable()) return false;
    const images = Array.from(data.files).filter((f) =>
      f.type.startsWith('image/'),
    );
    if (images.length === 0) return false;
    for (const file of images) {
      this.uploads.upload(this.noteId(), file).subscribe({
        next: (res) =>
          this.editor
            .chain()
            .focus()
            .setImage({ src: res.url, width: res.width, height: res.height })
            .run(),
      });
    }
    return true;
  }

  // --- toolbar ---
  isActive(name: string, attrs?: Record<string, unknown>): boolean {
    void this.tick();
    return this.editor?.isActive(name, attrs) ?? false;
  }

  toggleBold(): void {
    this.editor.chain().focus().toggleBold().run();
  }
  toggleItalic(): void {
    this.editor.chain().focus().toggleItalic().run();
  }
  toggleUnderline(): void {
    this.editor.chain().focus().toggleUnderline().run();
  }
  toggleStrike(): void {
    this.editor.chain().focus().toggleStrike().run();
  }
  /** Heading levels offered by the toolbar's heading dropdown. */
  readonly headingLevels = [1, 2, 3, 4, 5] as const;

  /** The active heading level at the selection, or null when not in a heading. */
  headingLevel(): 1 | 2 | 3 | 4 | 5 | null {
    void this.tick();
    for (const lvl of this.headingLevels) {
      if (this.editor?.isActive('heading', { level: lvl })) return lvl;
    }
    return null;
  }

  toggleHeading(level: 1 | 2 | 3 | 4 | 5): void {
    this.editor.chain().focus().toggleHeading({ level }).run();
  }

  /** Strips all block + inline formatting back to plain paragraph text. */
  clearFormatting(): void {
    this.editor.chain().focus().clearNodes().unsetAllMarks().run();
  }
  toggleBulletList(): void {
    this.editor.chain().focus().toggleBulletList().run();
  }
  toggleOrderedList(): void {
    this.editor.chain().focus().toggleOrderedList().run();
  }
  toggleTaskList(): void {
    this.editor.chain().focus().toggleTaskList().run();
  }
  toggleCodeBlock(): void {
    this.editor.chain().focus().toggleCodeBlock().run();
  }
  toggleCode(): void {
    this.editor.chain().focus().toggleCode().run();
  }

  // --- tables ---
  /** True when the selection is inside a table (drives the editing menu items). */
  inTable(): boolean {
    void this.tick();
    return this.editor?.isActive('table') ?? false;
  }

  insertTable(): void {
    this.editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  }
  addRowBefore(): void {
    this.editor.chain().focus().addRowBefore().run();
  }
  addRowAfter(): void {
    this.editor.chain().focus().addRowAfter().run();
  }
  deleteRow(): void {
    this.editor.chain().focus().deleteRow().run();
  }
  addColumnBefore(): void {
    this.editor.chain().focus().addColumnBefore().run();
  }
  addColumnAfter(): void {
    this.editor.chain().focus().addColumnAfter().run();
  }
  deleteColumn(): void {
    this.editor.chain().focus().deleteColumn().run();
  }
  toggleHeaderRow(): void {
    this.editor.chain().focus().toggleHeaderRow().run();
  }
  deleteTable(): void {
    this.editor.chain().focus().deleteTable().run();
  }

  /** Theme-agnostic swatches: each reads acceptably on light and dark surfaces. */
  readonly textColors: readonly string[] = [
    '#e53935', // red
    '#fb8c00', // orange
    '#fdd835', // yellow
    '#43a047', // green
    '#00897b', // teal
    '#1e88e5', // blue
    '#5e35b1', // purple
    '#d81b60', // pink
    '#6d4c41', // brown
    '#757575', // grey
  ];

  setColor(color: string): void {
    this.editor.chain().focus().setColor(color).run();
  }
  unsetColor(): void {
    this.editor.chain().focus().unsetColor().run();
  }
  setFontSize(size: string): void {
    this.editor.chain().focus().setFontSize(size).run();
  }
  unsetFontSize(): void {
    this.editor.chain().focus().unsetFontSize().run();
  }

  setLink(): void {
    const prev = (this.editor.getAttributes('link')['href'] as string) ?? '';
    const url = window.prompt('Link URL', prev);
    if (url === null) return;
    const trimmed = url.trim();
    if (trimmed === '') {
      this.editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    if (!isSafeLinkUrl(trimmed)) {
      window.alert('Only http, https, and mailto links are allowed.');
      return;
    }
    this.editor
      .chain()
      .focus()
      .extendMarkRange('link')
      .setLink({ href: trimmed })
      .run();
  }

  /** Downloads the note as a Markdown file (primary export action). */
  exportMarkdown(): void {
    const title = this.exportName() || 'note';
    const doc = this.editor.getJSON() as ProseMirrorDoc;
    const md = docToMarkdown(doc);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sanitizeFilename(title)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Downloads the note as a standalone HTML file (client-side only).
   *
   * Improvements over the original:
   *   (a) Math nodes export as LaTeX source ($…$ / $$…$$) instead of KaTeX
   *       markup — the rendered KaTeX HTML contains unstyled SVG that looks
   *       broken outside the app. We post-process the doc JSON via the same
   *       docToMarkdown helpers, then substitute the <span>/<div> math wrappers
   *       in the exported HTML with the raw LaTeX delimiters.
   *   (b) highlight.js token colours are inlined so code blocks stay readable
   *       without a CDN stylesheet.
   */
  exportHtml(): void {
    const title = this.exportName() || 'note';
    const rawHtml = this.editor.getHTML();
    const body = postProcessHtmlForExport(rawHtml);
    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 760px; margin: 2rem auto; padding: 0 1rem; line-height: 1.55; color: #222; }
  img { max-width: 100%; height: auto; }
  ul[data-type="taskList"] { list-style: none; padding-left: 0.2em; }
  ul[data-type="taskList"] li { display: flex; gap: 0.45em; align-items: baseline; }
  pre { background: #f4f4f5; border: 1px solid #e0e0e0; border-radius: 6px; padding: 0.75em 1em; overflow-x: auto; }
  pre code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; }
  blockquote { border-left: 4px solid #1e88e5; margin: 0.6em 0; padding: 0.1em 0 0.1em 1em; color: #555; }
  /* highlight.js token palette — inlined for self-contained export */
  .hljs-comment,.hljs-quote{color:#6a737d;font-style:italic}
  .hljs-keyword,.hljs-selector-tag,.hljs-built_in,.hljs-name,.hljs-tag{color:#d73a49}
  .hljs-string,.hljs-title,.hljs-section,.hljs-attribute,.hljs-literal,
  .hljs-template-tag,.hljs-template-variable,.hljs-type,.hljs-addition{color:#22863a}
  .hljs-number,.hljs-symbol,.hljs-bullet,.hljs-link,.hljs-meta,
  .hljs-selector-id,.hljs-selector-class{color:#005cc5}
  .hljs-attr,.hljs-variable,.hljs-params{color:#e36209}
  .hljs-function .hljs-title,.hljs-title.function_{color:#6f42c1}
  .hljs-deletion{color:#b31d28}
  .hljs-emphasis{font-style:italic}
  .hljs-strong{font-weight:700}
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${body}
</body>
</html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sanitizeFilename(title)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

/**
 * Returns a copy of a pasted slice with text-colour stripped, so pasted text
 * renders in the note's default colour instead of a colour carried over from
 * the source. A `textStyle` mark's `color` attr is removed; the mark is dropped
 * entirely once it has no remaining meaningful attrs (e.g. fontSize). Other
 * marks (bold, links, …) are untouched.
 */
function stripPastedColors(slice: Slice, view: EditorView): Slice {
  const json = slice.toJSON() as {
    content?: ProseMirrorNode[];
    openStart?: number;
    openEnd?: number;
  } | null;
  if (!json?.content) return slice;
  stripColorMarks(json.content);
  return Slice.fromJSON(view.state.schema, json);
}

function stripColorMarks(nodes: ProseMirrorNode[]): void {
  for (const node of nodes) {
    if (Array.isArray(node.marks)) {
      node.marks = node.marks.filter((mark) => {
        if (mark.type !== 'textStyle') return true;
        if (mark.attrs) delete mark.attrs['color'];
        // Keep the mark only if some other non-null attr survives (e.g. fontSize).
        return !!mark.attrs && Object.values(mark.attrs).some((v) => v != null);
      });
    }
    if (Array.isArray(node.content)) stripColorMarks(node.content);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitizeFilename(s: string): string {
  const cleaned = s.replace(/[\\/:*?"<>|]+/g, '-').trim();
  return cleaned || 'note';
}
