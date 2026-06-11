import { Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  CdkDrag,
  CdkDragDrop,
  CdkDragHandle,
  CdkDropList,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
import { Router, RouterLink } from '@angular/router';
import type {
  NoteFilter,
  NoteSort,
  NoteSummaryDto,
  TagDto,
} from '@stickynotes/shared';
import { AuthService } from '../core/auth.service';
import { NotesApi } from '../core/notes.api';
import { TagsApi } from '../core/tags.api';
import { ViewModeStore } from '../core/view-mode.store';
import { NoteEditor } from '../editor/note-editor';
import { ChangePasswordDialog } from '../features/change-password/change-password-dialog';
import { ShareDialog } from '../sharing/share-dialog';

const SEARCH_DEBOUNCE_MS = 300;

@Component({
  selector: 'app-manager',
  imports: [
    NoteEditor,
    ShareDialog,
    ChangePasswordDialog,
    RouterLink,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
  ],
  templateUrl: './manager.html',
  styleUrl: './manager.scss',
})
export class Manager implements OnInit {
  private readonly api = inject(NotesApi);
  private readonly tagsApi = inject(TagsApi);
  private readonly auth = inject(AuthService);
  private readonly viewModeStore = inject(ViewModeStore);
  private readonly router = inject(Router);

  readonly user = this.auth.user;
  readonly mode = this.viewModeStore.mode;
  readonly sort = this.viewModeStore.sort;

  readonly notes = signal<NoteSummaryDto[]>([]);
  readonly tags = signal<TagDto[]>([]);
  readonly sharedBadge = signal(0);
  readonly loading = signal(true);
  readonly filter = signal<NoteFilter>('all');
  readonly activeTag = signal<string | null>(null);
  readonly q = signal('');
  readonly openId = signal<string | null>(null);
  readonly shareId = signal<string | null>(null);
  readonly selected = signal<ReadonlySet<string>>(new Set());
  readonly showPasswordDialog = signal(false);
  readonly sidebarOpen = signal(false); // mobile off-canvas

  // tag editing (pane head)
  readonly tagDraft = signal('');

  private searchTimer?: ReturnType<typeof setTimeout>;

  // single-item array so @for can recreate the editor when the open note changes
  readonly openIds = computed(() => {
    const id = this.openId();
    return id ? [id] : [];
  });
  readonly openNote = computed(() =>
    this.notes().find((n) => n.id === this.openId()),
  );
  readonly selectionCount = computed(() => this.selected().size);
  readonly inTrash = computed(() => this.filter() === 'trash');
  /** Whether the open note's content may be edited by the current user. */
  readonly canEditOpen = computed(() => {
    const n = this.openNote();
    return !!n && n.isOwner && !n.deletedAt;
  });
  /** Drag-reorder only makes sense on the explicit order, unfiltered. */
  readonly canReorder = computed(
    () =>
      !this.inTrash() &&
      this.sort() === 'position' &&
      !this.q() &&
      !this.activeTag(),
  );

  ngOnInit(): void {
    this.refresh();
    this.refreshTags();
    this.refreshBadge();
  }

  refresh(): void {
    this.loading.set(true);
    this.api
      .list({
        filter: this.filter(),
        q: this.q() || undefined,
        tag: this.activeTag() ?? undefined,
        sort: this.sort(),
      })
      .subscribe({
        next: (notes) => {
          this.notes.set(notes);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  refreshTags(): void {
    this.tagsApi.list().subscribe((t) => this.tags.set(t));
  }

  refreshBadge(): void {
    this.api.sharedBadge().subscribe((b) => this.sharedBadge.set(b.count));
  }

  setFilter(filter: NoteFilter): void {
    this.filter.set(filter);
    this.activeTag.set(null);
    this.openId.set(null);
    this.clearSelection();
    this.sidebarOpen.set(false);
    this.refresh();
  }

  setTag(name: string): void {
    this.activeTag.set(name);
    this.filter.set('all');
    this.openId.set(null);
    this.clearSelection();
    this.sidebarOpen.set(false);
    this.refresh();
  }

  onSearch(value: string): void {
    this.q.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.refresh(), SEARCH_DEBOUNCE_MS);
  }

  setSort(value: string): void {
    const sort: NoteSort =
      value === 'updated' || value === 'created' || value === 'title'
        ? value
        : 'position';
    this.viewModeStore.setSort(sort);
    this.refresh();
  }

  setView(mode: 'list' | 'wall'): void {
    // Close any open editor so it doesn't reappear (as a pane or modal) in the
    // other view after switching.
    this.openId.set(null);
    this.viewModeStore.set(mode);
  }

  /** Reorders notes (shared by list and wall views) and persists the new order. */
  drop(event: CdkDragDrop<NoteSummaryDto[]>): void {
    if (event.previousIndex === event.currentIndex) return;
    const reordered = [...this.notes()];
    moveItemInArray(reordered, event.previousIndex, event.currentIndex);
    this.notes.set(reordered); // optimistic
    this.api.reorder(reordered.map((n) => n.id)).subscribe({
      error: () => this.refresh(), // revert to server order on failure
    });
  }

  create(): void {
    this.api.create('Untitled note').subscribe((n) => {
      this.notes.update((list) => [n, ...list]);
      this.openId.set(n.id);
    });
  }

  open(id: string): void {
    this.openId.set(id);
    const note = this.notes().find((n) => n.id === id);
    if (note && !note.seen) {
      // The editor's GET marks the grant seen server-side; reflect it locally.
      this.notes.update((list) =>
        list.map((n) => (n.id === id ? { ...n, seen: true } : n)),
      );
      setTimeout(() => this.refreshBadge(), 800);
    }
  }

  openShare(id: string): void {
    this.shareId.set(id);
  }

  closeShare(): void {
    this.shareId.set(null);
    this.refresh(); // reflect new visibility badges
  }

  rename(id: string, title: string): void {
    this.api.updateMeta(id, { title }).subscribe((updated) => {
      this.notes.update((list) =>
        list.map((n) => (n.id === id ? { ...n, title: updated.title } : n)),
      );
    });
  }

  togglePin(note: NoteSummaryDto, event?: Event): void {
    event?.stopPropagation();
    if (!note.isOwner) return;
    this.api.updateMeta(note.id, { pinned: !note.pinned }).subscribe(() => {
      this.refresh();
    });
  }

  duplicate(id: string): void {
    this.api.duplicate(id).subscribe((copy) => {
      // The copy is always owned by me; jump to it where it's visible.
      if (this.inTrash() || this.filter() === 'shared') this.setFilter('mine');
      else this.refresh();
      this.openId.set(copy.id);
      this.refreshTags();
    });
  }

  closeEditor(): void {
    this.openId.set(null);
    this.refresh(); // pick up title/preview changes
    this.refreshTags();
  }

  isSelected(id: string): boolean {
    return this.selected().has(id);
  }

  toggleSelect(id: string): void {
    this.selected.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  clearSelection(): void {
    this.selected.set(new Set());
  }

  // --- delete / trash lifecycle ---

  deleteOne(id: string): void {
    this.api.remove(id).subscribe(() => this.afterDelete([id]));
  }

  batchDelete(): void {
    const ids = [...this.selected()];
    if (ids.length === 0) return;
    this.api.batchDelete(ids).subscribe((res) => this.afterDelete(res.deleted));
  }

  restore(id: string, event?: Event): void {
    event?.stopPropagation();
    this.api.restore(id).subscribe(() => this.afterDelete([id]));
  }

  deleteForever(id: string, event?: Event): void {
    event?.stopPropagation();
    if (!confirm('Delete this note permanently? This cannot be undone.')) {
      return;
    }
    this.api.removePermanently(id).subscribe(() => this.afterDelete([id]));
  }

  emptyTrash(): void {
    const count = this.notes().length;
    if (count === 0) return;
    if (
      !confirm(
        `Permanently delete all ${count} note(s) in the trash? This cannot be undone.`,
      )
    ) {
      return;
    }
    this.api.emptyTrash().subscribe((res) => this.afterDelete(res.deleted));
  }

  private afterDelete(ids: string[]): void {
    const gone = new Set(ids);
    this.notes.update((list) => list.filter((n) => !gone.has(n.id)));
    if (this.openId() && gone.has(this.openId()!)) this.openId.set(null);
    this.selected.update((set) => {
      const next = new Set(set);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    this.refreshTags();
  }

  // --- tags on the open note ---

  addTag(): void {
    const note = this.openNote();
    const name = this.tagDraft().trim();
    if (!note || !name) return;
    const next = [...note.tags, name];
    this.tagDraft.set('');
    this.saveTags(note.id, next);
  }

  removeTag(name: string): void {
    const note = this.openNote();
    if (!note) return;
    this.saveTags(
      note.id,
      note.tags.filter((t) => t !== name),
    );
  }

  private saveTags(noteId: string, names: string[]): void {
    this.api.setTags(noteId, names).subscribe((res) => {
      this.notes.update((list) =>
        list.map((n) => (n.id === noteId ? { ...n, tags: res.tags } : n)),
      );
      this.refreshTags();
    });
  }

  logout(): void {
    this.auth.logout().subscribe(() => void this.router.navigateByUrl('/login'));
  }
}
