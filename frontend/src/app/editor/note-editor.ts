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
import { MatTooltipModule } from '@angular/material/tooltip';
import { Editor } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import { TiptapEditorDirective } from 'ngx-tiptap';
import type { ProseMirrorDoc } from '@stickynotes/shared';
import { UploadsApi } from '../core/uploads.api';
import { EMPTY_DOC, buildExtensions } from './extensions';
import { OpenNote, OpenNotesStore } from './open-notes.store';
import { isSafeLinkUrl } from './safe-url';

/**
 * Presentation-agnostic note editor. Knows nothing about panes, windows, or
 * routing — it binds a noteId to the OpenNotesStore and renders a TipTap editor.
 * The same component is reused by the v2 floating windows / Electron client.
 */
@Component({
  selector: 'app-note-editor',
  imports: [TiptapEditorDirective, MatButtonModule, MatIconModule, MatTooltipModule],
  templateUrl: './note-editor.html',
  styleUrl: './note-editor.scss',
})
export class NoteEditor implements OnInit, OnDestroy {
  readonly noteId = input.required<string>();
  readonly editable = input(true);
  /** Filename stem for "Export HTML" (usually the note title). */
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
        this.store.setContent(this.noteId(), editor.getJSON() as ProseMirrorDoc);
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

  /** Downloads the note as a standalone HTML file (client-side only). */
  exportHtml(): void {
    const title = this.exportName() || 'note';
    const body = this.editor.getHTML();
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
