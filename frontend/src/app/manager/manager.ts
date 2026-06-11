import {
  Component,
  ElementRef,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { BreakpointObserver } from '@angular/cdk/layout';
import {
  CdkDrag,
  CdkDragDrop,
  CdkDragEnd,
  CdkDragHandle,
  CdkDropList,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
import { Router, RouterLink } from '@angular/router';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipInputEvent, MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatSelectModule } from '@angular/material/select';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { map } from 'rxjs';
import type {
  NoteFilter,
  NoteSort,
  NoteSummaryDto,
  TagDto,
} from '@stickynotes/shared';
import { AuthService } from '../core/auth.service';
import { NotesApi } from '../core/notes.api';
import { TagsApi } from '../core/tags.api';
import { ThemeStore } from '../core/theme.store';
import { ViewModeStore } from '../core/view-mode.store';
import { NoteEditor } from '../editor/note-editor';
import { ChangePasswordDialog } from '../features/change-password/change-password-dialog';
import { openConfirm } from '../shared-ui/confirm-dialog';
import { ShareDialog } from '../sharing/share-dialog';
import {
  WALL_CARD_CELLS,
  WALL_CELL,
  WallCellDirective,
} from './wall-cell.directive';

const SEARCH_DEBOUNCE_MS = 300;

interface CellPos {
  x: number;
  y: number;
}

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
    WallCellDirective,
    MatToolbarModule,
    MatSidenavModule,
    MatListModule,
    MatBadgeModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatCheckboxModule,
    MatChipsModule,
    MatTooltipModule,
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
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly breakpoints = inject(BreakpointObserver);

  readonly theme = inject(ThemeStore);
  readonly user = this.auth.user;
  readonly mode = this.viewModeStore.mode;
  readonly sort = this.viewModeStore.sort;
  readonly CELL = WALL_CELL;

  readonly isHandset = toSignal(
    this.breakpoints
      .observe('(max-width: 900px)')
      .pipe(map((r) => r.matches)),
    { initialValue: false },
  );

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
  readonly sidebarOpen = signal(false); // mobile over-mode drawer

  private searchTimer?: ReturnType<typeof setTimeout>;

  // --- wall grid state ---
  private readonly wallEl =
    viewChild<ElementRef<HTMLDivElement>>('wallEl');
  private readonly wallCols = signal(24);
  /** Measured card heights in grid cells (id → cells). */
  private readonly cardHeights = signal<ReadonlyMap<string, number>>(
    new Map(),
  );
  private wallResize?: ResizeObserver;

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
  /** List-view drag-reorder only makes sense on the explicit order, unfiltered. */
  readonly canReorder = computed(
    () =>
      !this.inTrash() &&
      this.sort() === 'position' &&
      !this.q() &&
      !this.activeTag(),
  );

  /**
   * Spatial layout for the wall: hand-placed notes keep their stored grid
   * coords; never-placed notes flow into the first free slot (top-left scan).
   * Flow placement is display-only — coords persist only when the user drags.
   */
  readonly wallLayout = computed<ReadonlyMap<string, CellPos>>(() => {
    const cols = Math.max(WALL_CARD_CELLS, this.wallCols());
    const heights = this.cardHeights();
    const out = new Map<string, CellPos>();
    const rects: { x: number; y: number; w: number; h: number }[] = [];
    const overlap = (x: number, y: number, h: number): boolean =>
      rects.some(
        (r) =>
          x < r.x + r.w && r.x < x + WALL_CARD_CELLS && y < r.y + r.h && r.y < y + h,
      );

    const notes = this.notes();
    for (const n of notes) {
      if (n.wallX == null || n.wallY == null) continue;
      out.set(n.id, { x: n.wallX, y: n.wallY });
      rects.push({
        x: n.wallX,
        y: n.wallY,
        w: WALL_CARD_CELLS,
        h: heights.get(n.id) ?? 3,
      });
    }
    for (const n of notes) {
      if (n.wallX != null && n.wallY != null) continue;
      const h = heights.get(n.id) ?? 3;
      let pos: CellPos = { x: 0, y: 0 };
      placed: for (let y = 0; ; y++) {
        for (let x = 0; x + WALL_CARD_CELLS <= cols; x++) {
          if (!overlap(x, y, h)) {
            pos = { x, y };
            break placed;
          }
        }
      }
      out.set(n.id, pos);
      rects.push({ ...pos, w: WALL_CARD_CELLS, h });
    }
    return out;
  });

  readonly wallHeightPx = computed(() => {
    const heights = this.cardHeights();
    let maxRow = 10;
    for (const [id, pos] of this.wallLayout()) {
      maxRow = Math.max(maxRow, pos.y + (heights.get(id) ?? 3));
    }
    return (maxRow + 6) * WALL_CELL;
  });

  constructor() {
    // (Re)attach the resize observer whenever the wall container appears.
    effect(() => {
      const el = this.wallEl()?.nativeElement;
      this.wallResize?.disconnect();
      if (!el) return;
      this.wallResize = new ResizeObserver(() => {
        this.wallCols.set(Math.max(WALL_CARD_CELLS, Math.floor(el.clientWidth / WALL_CELL)));
      });
      this.wallResize.observe(el);
    });
  }

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

  setSort(value: NoteSort): void {
    this.viewModeStore.setSort(value);
    this.refresh();
  }

  setView(mode: 'list' | 'wall'): void {
    // Close any open editor so it doesn't reappear (as a pane or modal) in the
    // other view after switching.
    this.openId.set(null);
    this.viewModeStore.set(mode);
  }

  /** List view: persists the new explicit order after a row drag. */
  drop(event: CdkDragDrop<NoteSummaryDto[]>): void {
    if (event.previousIndex === event.currentIndex) return;
    const reordered = [...this.notes()];
    moveItemInArray(reordered, event.previousIndex, event.currentIndex);
    this.notes.set(reordered); // optimistic
    this.api.reorder(reordered.map((n) => n.id)).subscribe({
      error: () => this.refresh(), // revert to server order on failure
    });
  }

  // --- wall grid ---

  onCellHeight(event: { id: string; cells: number }): void {
    const current = this.cardHeights();
    if (current.get(event.id) === event.cells) return;
    const next = new Map(current);
    next.set(event.id, event.cells);
    this.cardHeights.set(next);
  }

  /** Snaps a dragged card to the nearest intersection and persists its coords. */
  onWallDragEnd(note: NoteSummaryDto, event: CdkDragEnd): void {
    const delta = event.source.getFreeDragPosition();
    event.source.reset(); // cards are positioned via left/top, not transforms
    if (delta.x === 0 && delta.y === 0) return;

    const cur = this.wallLayout().get(note.id) ?? { x: 0, y: 0 };
    const cols = Math.max(WALL_CARD_CELLS, this.wallCols());
    let x = Math.round((cur.x * WALL_CELL + delta.x) / WALL_CELL);
    let y = Math.round((cur.y * WALL_CELL + delta.y) / WALL_CELL);
    x = Math.max(0, Math.min(x, cols - WALL_CARD_CELLS));
    y = Math.max(0, y);

    // Anywhere on the grid — but never hidden under another card: nudge down
    // to the first free row at that column.
    const heights = this.cardHeights();
    const h = heights.get(note.id) ?? 3;
    const others = [...this.wallLayout().entries()]
      .filter(([id]) => id !== note.id)
      .map(([id, p]) => ({
        x: p.x,
        y: p.y,
        w: WALL_CARD_CELLS,
        h: heights.get(id) ?? 3,
      }));
    while (
      others.some(
        (r) =>
          x < r.x + r.w && r.x < x + WALL_CARD_CELLS && y < r.y + r.h && r.y < y + h,
      )
    ) {
      y++;
    }

    this.notes.update((list) =>
      list.map((m) => (m.id === note.id ? { ...m, wallX: x, wallY: y } : m)),
    );
    this.api.updateMeta(note.id, { wallX: x, wallY: y }).subscribe({
      error: () => {
        this.snack.open('Could not save the note position.', 'Dismiss', {
          duration: 4000,
        });
        this.refresh();
      },
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
    openConfirm(this.dialog, {
      title: 'Delete forever?',
      message: 'This permanently deletes the note and its images. It cannot be undone.',
      confirmLabel: 'Delete forever',
      destructive: true,
    }).subscribe((ok) => {
      if (!ok) return;
      this.api.removePermanently(id).subscribe(() => this.afterDelete([id]));
    });
  }

  emptyTrash(): void {
    const count = this.notes().length;
    if (count === 0) return;
    openConfirm(this.dialog, {
      title: 'Empty trash?',
      message: `Permanently delete all ${count} note(s) in the trash? This cannot be undone.`,
      confirmLabel: 'Empty trash',
      destructive: true,
    }).subscribe((ok) => {
      if (!ok) return;
      this.api.emptyTrash().subscribe((res) => this.afterDelete(res.deleted));
    });
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

  addTagFromChip(event: MatChipInputEvent): void {
    const note = this.openNote();
    const name = event.value.trim();
    event.chipInput.clear();
    if (!note || !name) return;
    this.saveTags(note.id, [...note.tags, name]);
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
