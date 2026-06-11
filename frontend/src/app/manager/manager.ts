import { Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  CdkDrag,
  CdkDragDrop,
  CdkDragHandle,
  CdkDropList,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
import { Router, RouterLink } from '@angular/router';
import type { NoteSummaryDto } from '@stickynotes/shared';
import { AuthService } from '../core/auth.service';
import { NotesApi } from '../core/notes.api';
import { ViewModeStore } from '../core/view-mode.store';
import { NoteEditor } from '../editor/note-editor';
import { ShareDialog } from '../sharing/share-dialog';

@Component({
  selector: 'app-manager',
  imports: [
    NoteEditor,
    ShareDialog,
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
  private readonly auth = inject(AuthService);
  private readonly viewModeStore = inject(ViewModeStore);
  private readonly router = inject(Router);

  readonly user = this.auth.user;
  readonly mode = this.viewModeStore.mode;

  readonly notes = signal<NoteSummaryDto[]>([]);
  readonly loading = signal(true);
  readonly openId = signal<string | null>(null);
  readonly shareId = signal<string | null>(null);
  readonly selected = signal<ReadonlySet<string>>(new Set());

  // single-item array so @for can recreate the editor when the open note changes
  readonly openIds = computed(() => {
    const id = this.openId();
    return id ? [id] : [];
  });
  readonly openNote = computed(() =>
    this.notes().find((n) => n.id === this.openId()),
  );
  readonly selectionCount = computed(() => this.selected().size);

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.loading.set(true);
    this.api.list('all').subscribe({
      next: (notes) => {
        this.notes.set(notes);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
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
  }

  openShare(id: string): void {
    this.shareId.set(id);
  }

  closeShare(): void {
    this.shareId.set(null);
    this.refresh(); // reflect new visibility badges
  }

  rename(id: string, title: string): void {
    this.api.updateMeta(id, title).subscribe((updated) => {
      this.notes.update((list) =>
        list.map((n) => (n.id === id ? { ...n, title: updated.title } : n)),
      );
    });
  }

  closeEditor(): void {
    this.openId.set(null);
    this.refresh(); // pick up title/preview changes
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

  deleteOne(id: string): void {
    if (!confirm('Delete this note?')) return;
    this.api.remove(id).subscribe(() => this.afterDelete([id]));
  }

  batchDelete(): void {
    const ids = [...this.selected()];
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} note(s)?`)) return;
    this.api.batchDelete(ids).subscribe((res) => this.afterDelete(res.deleted));
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
  }

  logout(): void {
    this.auth.logout().subscribe(() => void this.router.navigateByUrl('/login'));
  }
}
