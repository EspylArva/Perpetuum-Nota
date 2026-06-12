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
import { Editor } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import { TiptapEditorDirective } from 'ngx-tiptap';
import type { ProseMirrorDoc } from '@stickynotes/shared';
import { UploadsApi } from '../core/uploads.api';
import { EMPTY_DOC, buildExtensions } from './extensions';
import { postProcessHtmlForExport } from './export-postprocess';
import { docToMarkdown } from './markdown-export';
import { OpenNote, OpenNotesStore } from './open-notes.store';
import { isSafeLinkUrl } from './safe-url';
import { extractToc, TocEntry } from './toc';

const TOC_STORAGE_KEY = 'note-editor.toc';

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
})
export class NoteEditor implements OnInit, OnDestroy {
  readonly noteId = input.required<string>();
  readonly editable = input(true);
  /** Filename stem for "Export" (usually the note title). */
  readonly exportName = input<string>('note');

  private readonly store = inject(OpenNotesStore);
  private readonly uploads = inject(UploadsApi);
  private readonly injector = inject(Injector);

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
  readonly tocVisible = signal(
    typeof localStorage !== 'undefined'
      ? localStorage.getItem(TOC_STORAGE_KEY) === 'true'
      : false,
  );
  readonly tocEntries = signal<TocEntry[]>([]);

  toggleToc(): void {
    const next = !this.tocVisible();
    this.tocVisible.set(next);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(TOC_STORAGE_KEY, String(next));
    }
  }

  navigateToHeading(entry: TocEntry): void {
    this.editor.chain().focus().setTextSelection(entry.pos + 1).scrollIntoView().run();
  }

  ngOnInit(): void {
    this.entry = this.store.open(this.noteId());

    this.editor = new Editor({
      extensions: buildExtensions(),
      editable: this.editable(),
      content: this.entry.content() ?? EMPTY_DOC,
      editorProps: {
        handlePaste: (_view, event) => this.handleImageEvent(event.clipboardData),
        handleDrop: (_view, event) =>
          this.handleImageEvent((event as DragEvent).dataTransfer),
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
          this.editor.commands.setContent(content as JSONContent);
          this.suppressUpdate = false;
          // Refresh TOC after a server-driven content replacement.
          this.tocEntries.set(extractToc(content));
        }
      },
      { injector: this.injector },
    );
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
  toggleHeading(level: 1 | 2): void {
    this.editor.chain().focus().toggleHeading({ level }).run();
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
