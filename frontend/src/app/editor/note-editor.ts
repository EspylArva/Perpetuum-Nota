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
  imports: [TiptapEditorDirective],
  templateUrl: './note-editor.html',
  styleUrl: './note-editor.scss',
})
export class NoteEditor implements OnInit, OnDestroy {
  readonly noteId = input.required<string>();
  readonly editable = input(true);

  private readonly store = inject(OpenNotesStore);
  private readonly uploads = inject(UploadsApi);
  private readonly injector = inject(Injector);

  editor!: Editor;
  private entry!: OpenNote;
  private loadedIntoEditor = false;
  private suppressUpdate = false;

  private readonly tick = signal(0);

  readonly status = computed(() => {
    void this.tick();
    if (this.entry?.saving()) return 'Saving…';
    if (this.entry?.dirty()) return 'Unsaved changes';
    return this.entry?.loaded() ? 'Saved' : 'Loading…';
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

    effect(
      () => {
        const content = this.entry.content();
        if (content && this.entry.loaded() && !this.loadedIntoEditor) {
          this.loadedIntoEditor = true;
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
  toggleHeading(level: 1 | 2): void {
    this.editor.chain().focus().toggleHeading({ level }).run();
  }
  toggleBulletList(): void {
    this.editor.chain().focus().toggleBulletList().run();
  }
  toggleOrderedList(): void {
    this.editor.chain().focus().toggleOrderedList().run();
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
}
