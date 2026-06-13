import {
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { BreakpointObserver } from '@angular/cdk/layout';
import {
  CdkDrag,
  CdkDragDrop,
  CdkDragEnd,
  CdkDragHandle,
  CdkDropList,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent, MatAutocompleteTrigger } from '@angular/material/autocomplete';
import { MatChipInputEvent, MatChipsModule } from '@angular/material/chips';
import { provideNativeDateAdapter } from '@angular/material/core';
import {
  MatCalendarCellClassFunction,
  MatDatepickerModule,
} from '@angular/material/datepicker';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { map } from 'rxjs';
import type {
  FolderDto,
  NoteDto,
  NoteFilter,
  NoteSort,
  NoteSummaryDto,
  TagDto,
} from '@stickynotes/shared';
import { AuthService } from '../core/auth.service';
import { NotesApi } from '../core/notes.api';
import { TagsApi } from '../core/tags.api';
import { FoldersApi } from '../core/folders.api';
import { ThemeStore } from '../core/theme.store';
import { SidenavStore } from '../core/sidenav.store';
import { ViewModeStore } from '../core/view-mode.store';
import { filterTagOptions } from './tag-filter';
import {
  dueLabel,
  dueState,
  endOfDay,
  sameDay,
  startOfDay,
} from './due-date';
import { timeAgo } from './time-ago';
import { shouldOpenInApp } from './click-modifiers';
import { movedBeyond, type Point } from './drag-threshold';
import { clampPan } from './wall-pan';
import { FolderTree } from './folder-tree';
import type { FolderNode } from './folder-tree.util';
import { openMoveToFolder } from './move-to-folder-dialog';
import { NoteWindow } from './note-window';
import { NoteEditor } from '../editor/note-editor';
import { OpenNotesStore, type NoteLinkRef } from '../editor/open-notes.store';
import { ChangePasswordDialog } from '../features/change-password/change-password-dialog';
import { openConfirm } from '../shared-ui/confirm-dialog';
import { openNameDialog } from '../shared-ui/name-dialog';
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
    NoteWindow,
    ShareDialog,
    ChangePasswordDialog,
    FolderTree,
    RouterLink,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    WallCellDirective,
    MatToolbarModule,
    MatSidenavModule,
    MatListModule,
    MatMenuModule,
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
    MatAutocompleteModule,
    MatDatepickerModule,
  ],
  // The datepicker + inline calendar need a DateAdapter; the native adapter
  // ships with Material (no extra npm dependency).
  providers: [provideNativeDateAdapter()],
  templateUrl: './manager.html',
  styleUrl: './manager.scss',
})
export class Manager implements OnInit {
  private readonly api = inject(NotesApi);
  private readonly tagsApi = inject(TagsApi);
  private readonly foldersApi = inject(FoldersApi);
  private readonly auth = inject(AuthService);
  private readonly viewModeStore = inject(ViewModeStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);
  private readonly openStore = inject(OpenNotesStore);
  private readonly breakpoints = inject(BreakpointObserver);

  readonly theme = inject(ThemeStore);
  readonly sidenav = inject(SidenavStore);
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

  // --- folders ---
  readonly folders = signal<FolderDto[]>([]);
  /** Folder id the notes list is filtered to, or null = no folder filter. */
  readonly activeFolderId = signal<string | null>(null);
  /** Expanded folder ids in the sidebar tree. */
  readonly expandedFolders = signal<ReadonlySet<string>>(new Set<string>());
  /** Display name of the active folder for the filter chip. */
  readonly activeFolderName = computed(() => {
    const id = this.activeFolderId();
    return id ? (this.folders().find((f) => f.id === id)?.name ?? null) : null;
  });

  // --- due-date calendar filter ---
  // The active day-range filter as local Date day-anchors (start-of-day). A
  // single-day filter has dueStart === dueEnd; null = no due filter.
  readonly dueStart = signal<Date | null>(null);
  readonly dueEnd = signal<Date | null>(null);
  /** Set on mousedown over the calendar so (selectedChange) can read shiftKey. */
  private shiftHeld = false;

  // Expose the pure helpers to the template.
  readonly dueLabel = dueLabel;
  readonly dueState = dueState;
  readonly timeAgo = timeAgo;
  readonly openId = signal<string | null>(null);
  /**
   * Outgoing wikilinks of the currently open note, surfaced as pills. Links live
   * on the full NoteDto (the summary list carries tags but NOT links), so they
   * are read from the OpenNotesStore entry the editor already fetches — no extra
   * request from the manager.
   */
  readonly openNoteLinks = computed(() => {
    const id = this.openId();
    return id ? this.openStore.linksOf(id)() : [];
  });
  readonly shareId = signal<string | null>(null);
  readonly selected = signal<ReadonlySet<string>>(new Set());
  readonly showPasswordDialog = signal(false);
  readonly sidebarOpen = signal(false); // mobile over-mode drawer

  /** Current text typed into the tag chip input — drives autocomplete options. */
  readonly tagQuery = signal('');

  private searchTimer?: ReturnType<typeof setTimeout>;

  // --- wall grid state ---
  private readonly wallEl =
    viewChild<ElementRef<HTMLDivElement>>('wallEl');
  /** Scroll/viewport container — the pan starts on its empty background. */
  private readonly wallScrollEl =
    viewChild<ElementRef<HTMLDivElement>>('wallScrollEl');
  private readonly wallCols = signal(24);
  /** Measured card heights in grid cells (id → cells). */
  private readonly cardHeights = signal<ReadonlyMap<string, number>>(
    new Map(),
  );
  private wallResize?: ResizeObserver;

  // --- wall floating windows (multiple open notes / folders) ---
  /** Max concurrently-open windows (notes + folders) before we refuse more. */
  private readonly WALL_WINDOW_CAP = 6;
  /** Open note-window ids in WALL mode (LIST mode still uses `openId`). */
  readonly wallOpenIds = signal<string[]>([]);
  /** Open folder-window ids in WALL mode. */
  readonly wallFolderIds = signal<string[]>([]);
  /** Per-window z-index (id → z); raising a window bumps it above `topZ`. */
  private readonly winZ = signal<ReadonlyMap<string, number>>(new Map());
  /** Monotonic z-index counter; the next raised window gets topZ. */
  private topZ = 60;
  /** Notes inside each open folder window (folderId → its notes). */
  readonly folderNotes = signal<ReadonlyMap<string, NoteSummaryDto[]>>(
    new Map(),
  );

  // single-item array so @for can recreate the editor when the open note changes
  readonly openIds = computed(() => {
    const id = this.openId();
    return id ? [id] : [];
  });
  readonly openNote = computed(() =>
    this.notes().find((n) => n.id === this.openId()),
  );
  /** Autocomplete options: all user tags minus the open note's tags, filtered by current input. */
  readonly tagOptions = computed(() =>
    filterTagOptions(this.tags(), this.openNote()?.tags ?? [], this.tagQuery()),
  );
  readonly selectionCount = computed(() => this.selected().size);
  readonly inTrash = computed(() => this.filter() === 'trash');

  // --- right-click context menu ---
  /** Hidden trigger positioned at the cursor; the menu attaches to it. */
  private readonly ctxTrigger = viewChild<MatMenuTrigger>('ctxTrigger');
  /** Viewport position of the hidden trigger (set on (contextmenu)). */
  readonly ctxPos = signal<{ x: number; y: number }>({ x: 0, y: 0 });
  /** The note the context menu currently targets (drives its items). */
  readonly ctxNote = signal<NoteSummaryDto | null>(null);

  /** All visible notes selected? Drives the select-all toggle's icon/state. */
  readonly allSelected = computed(() => {
    const visible = this.notes();
    return visible.length > 0 && visible.every((n) => this.selected().has(n.id));
  });

  /**
   * Set of local-day timestamps (start-of-day ms) that have ≥1 due note. Derived
   * from the CURRENTLY LOADED notes signal, so the calendar dots reflect the
   * active filter view rather than the whole account.
   */
  readonly dueDays = computed(() => {
    const set = new Set<number>();
    for (const n of this.notes()) {
      if (n.dueDate) set.add(startOfDay(new Date(n.dueDate)).getTime());
    }
    return set;
  });

  /** Marks calendar cells whose day carries a due note (CSS dot via dateClass). */
  readonly dueDateClass: MatCalendarCellClassFunction<Date> = (date, view) =>
    view === 'month' && this.dueDays().has(startOfDay(date).getTime())
      ? 'has-due'
      : '';

  /** True when a due-date day/range filter is active (chip + calendar select). */
  readonly hasDueFilter = computed(() => this.dueStart() !== null);

  /** Human label for the active due filter chip ("Due Jun 15" or a range). */
  readonly dueFilterLabel = computed(() => {
    const start = this.dueStart();
    const end = this.dueEnd();
    if (!start) return '';
    const fmt = (d: Date) =>
      d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return end && !sameDay(start, end)
      ? `Due ${fmt(start)} – ${fmt(end)}`
      : `Due ${fmt(start)}`;
  });
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
    const offset = this.noteOffsetCells();
    let maxRow = 10;
    for (const [id, pos] of this.wallLayout()) {
      maxRow = Math.max(maxRow, offset + pos.y + (heights.get(id) ?? 3));
    }
    return (maxRow + 6) * WALL_CELL;
  });

  // --- wall panning ---
  /** Pan offset applied as translate() to the positioned `.wall-grid` layer. */
  readonly panOffset = signal<{ x: number; y: number }>({ x: 0, y: 0 });
  readonly panning = signal(false);
  /** Pointer + offset captured at pan start. */
  private panStart: { px: number; py: number; ox: number; oy: number } | null =
    null;

  /**
   * Pixel extent of the placed content (farthest card right/bottom edge). Drives
   * the pan clamp so you can pan content-extent + one viewport, never further.
   */
  private readonly wallContentSize = computed<{ w: number; h: number }>(() => {
    const heights = this.cardHeights();
    const offset = this.noteOffsetCells();
    let w = 0;
    let h = 0;
    for (const [id, pos] of this.wallLayout()) {
      w = Math.max(w, pos.x * WALL_CELL + WALL_CARD_CELLS * WALL_CELL);
      h = Math.max(
        h,
        (offset + pos.y) * WALL_CELL + (heights.get(id) ?? 3) * WALL_CELL,
      );
    }
    // Folder band may be wider/taller than the notes when notes are sparse.
    for (const [, pos] of this.folderLayout()) {
      w = Math.max(w, pos.x * WALL_CELL + WALL_CARD_CELLS * WALL_CELL);
      h = Math.max(h, (pos.y + this.FOLDER_CARD_CELLS) * WALL_CELL);
    }
    return { w, h };
  });

  /** Whether the wall is showing the root, unfiltered view (no folder/tag/search). */
  readonly isRootWallView = computed(
    () =>
      this.filter() === 'all' &&
      !this.activeFolderId() &&
      !this.activeTag() &&
      !this.q() &&
      !this.hasDueFilter(),
  );

  /** Root-level folders, shown as cards only in the root unfiltered wall view. */
  readonly rootFolders = computed(() =>
    this.isRootWallView()
      ? this.folders().filter((f) => f.parentId === null)
      : [],
  );

  /** Folder card footprint height in cells (short cards in a top band). */
  private readonly FOLDER_CARD_CELLS = 2;

  /**
   * Grid coords for folder cards: a band of short cards starting at the top-left,
   * flowing left-to-right. Notes are pushed below this band (see noteOffsetCells)
   * so the two never overlap.
   */
  readonly folderLayout = computed<ReadonlyMap<string, CellPos>>(() => {
    const out = new Map<string, CellPos>();
    const folders = this.rootFolders();
    if (folders.length === 0) return out;
    const cols = Math.max(WALL_CARD_CELLS, this.wallCols());
    const perRow = Math.max(1, Math.floor(cols / WALL_CARD_CELLS));
    folders.forEach((f, i) => {
      const col = i % perRow;
      const row = Math.floor(i / perRow);
      out.set(f.id, {
        x: col * WALL_CARD_CELLS,
        y: row * this.FOLDER_CARD_CELLS,
      });
    });
    return out;
  });

  /**
   * Cells the notes are shifted DOWN by, to clear the folder band at the top.
   * Zero when no folder cards are shown (filtered view, or no root folders).
   */
  readonly noteOffsetCells = computed(() => {
    const folders = this.rootFolders();
    if (folders.length === 0) return 0;
    const cols = Math.max(WALL_CARD_CELLS, this.wallCols());
    const perRow = Math.max(1, Math.floor(cols / WALL_CARD_CELLS));
    const rows = Math.ceil(folders.length / perRow);
    // +1 gutter row between the folder band and the notes.
    return rows * this.FOLDER_CARD_CELLS + 1;
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
    this.refreshFolders();
    this.refreshBadge();

    // Deep link: /note/:id opens exactly that note. React to param changes so
    // in-app navigation (e.g. a future router push) works too. The id is
    // validated with a direct GET so an unknown/inaccessible note shows a
    // snackbar and redirects to the list instead of opening a broken editor.
    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const id = params.get('id');
        if (!id) return;
        this.openDeepLink(id);
      });
  }

  /** Validates a deep-linked id, then opens it; bad id → snackbar + redirect. */
  private openDeepLink(id: string): void {
    this.api.get(id).subscribe({
      next: (note) => {
        // Seed the editor cache so open() doesn't refetch the content, and make
        // sure the note is in the list so the pane header (title/pin/share/
        // author) renders even when it falls outside the current filter view
        // (e.g. a shared/public/trashed note deep-linked while filter='mine').
        this.openStore.prime(note);
        if (!this.notes().some((n) => n.id === id)) {
          this.notes.update((list) => [note, ...list]);
        }
        this.open(id, note);
      },
      error: () => {
        this.snack.open('Note not found or not accessible', 'Dismiss', {
          duration: 4000,
        });
        void this.router.navigate(['']);
      },
    });
  }

  refresh(): void {
    this.loading.set(true);
    this.api
      .list({
        filter: this.filter(),
        q: this.q() || undefined,
        tag: this.activeTag() ?? undefined,
        sort: this.sort(),
        // Local start-of-day / end-of-day bounds; the server does plain
        // timestamp comparison (no timezone logic). A single-day filter
        // (dueEnd null) spans that one day's start..end.
        dueAfter: this.dueStart()
          ? startOfDay(this.dueStart()!).toISOString()
          : undefined,
        dueBefore: this.dueStart()
          ? endOfDay(this.dueEnd() ?? this.dueStart()!).toISOString()
          : undefined,
        folderId: this.activeFolderId() ?? undefined,
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

  refreshFolders(): void {
    this.foldersApi.list().subscribe((f) => this.folders.set(f));
  }

  refreshBadge(): void {
    this.api.sharedBadge().subscribe((b) => this.sharedBadge.set(b.count));
  }

  setFilter(filter: NoteFilter): void {
    this.filter.set(filter);
    this.activeTag.set(null);
    this.activeFolderId.set(null);
    this.dueStart.set(null);
    this.dueEnd.set(null);
    this.q.set('');
    this.openId.set(null);
    this.closeAllWallWindows();
    this.clearSelection();
    this.sidebarOpen.set(false);
    this.refresh();
  }

  setTag(name: string): void {
    this.activeTag.set(name);
    this.filter.set('all');
    this.activeFolderId.set(null);
    this.dueStart.set(null);
    this.dueEnd.set(null);
    this.q.set('');
    this.openId.set(null);
    this.closeAllWallWindows();
    this.clearSelection();
    this.sidebarOpen.set(false);
    this.refresh();
  }

  // --- folders ---

  /** Filter the notes list to a folder (clears tag/due filters, like setTag). */
  setFolder(id: string): void {
    this.activeFolderId.set(id);
    this.filter.set('all');
    this.activeTag.set(null);
    this.dueStart.set(null);
    this.dueEnd.set(null);
    this.q.set('');
    this.openId.set(null);
    this.closeAllWallWindows();
    this.clearSelection();
    this.sidebarOpen.set(false);
    this.refresh();
  }

  clearFolderFilter(): void {
    this.activeFolderId.set(null);
    this.refresh();
  }

  toggleFolderExpand(id: string): void {
    this.expandedFolders.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Prompts for a name and creates a folder at the root. */
  async createRootFolder(): Promise<void> {
    const name = await openNameDialog(this.dialog, {
      title: 'New folder',
      label: 'Folder name',
      confirmText: 'Create',
    });
    if (!name) return;
    this.foldersApi.create(name, null).subscribe(() => this.refreshFolders());
  }

  async createSubfolder(parent: FolderNode): Promise<void> {
    const name = await openNameDialog(this.dialog, {
      title: 'New subfolder',
      label: 'Folder name',
      confirmText: 'Create',
    });
    if (!name) return;
    this.foldersApi.create(name, parent.id).subscribe(() => {
      // Reveal the new child by expanding its parent.
      this.expandedFolders.update((set) => new Set(set).add(parent.id));
      this.refreshFolders();
    });
  }

  async renameFolder(folder: FolderNode): Promise<void> {
    const name = await openNameDialog(this.dialog, {
      title: 'Rename folder',
      label: 'Folder name',
      initial: folder.name,
      confirmText: 'Rename',
    });
    if (!name || name === folder.name) return;
    this.foldersApi.rename(folder.id, name).subscribe(() => this.refreshFolders());
  }

  deleteFolder(folder: FolderNode): void {
    openConfirm(this.dialog, {
      title: `Delete "${folder.name}"?`,
      message:
        'The folder is removed. Any notes and subfolders inside it move up to ' +
        'the parent folder (or to the root if this is a top-level folder). No ' +
        'notes are deleted.',
      confirmLabel: 'Delete folder',
      destructive: true,
    }).subscribe((ok) => {
      if (!ok) return;
      this.foldersApi.remove(folder.id).subscribe(() => {
        // If we were filtering by the deleted folder, drop back to All notes.
        if (this.activeFolderId() === folder.id) {
          this.activeFolderId.set(null);
        }
        this.refreshFolders();
        this.refresh();
      });
    });
  }

  /** Context-menu "Move to folder…": opens the picker and files the note. */
  moveToFolder(note: NoteSummaryDto): void {
    openMoveToFolder(this.dialog, {
      folders: this.folders(),
      currentFolderId: note.folderId,
    }).subscribe((result) => {
      if (result === undefined) return; // cancelled
      if (result === note.folderId) return; // no change
      this.api.updateMeta(note.id, { folderId: result }).subscribe((updated) => {
        // Single pass: patch the moved note's folderId and, when a folder
        // filter is active that the note no longer matches, omit it entirely.
        const activeFolderId = this.activeFolderId();
        const dropsOut =
          !!activeFolderId && updated.folderId !== activeFolderId;
        this.notes.update((list) =>
          dropsOut
            ? list.filter((n) => n.id !== note.id)
            : list.map((n) =>
                n.id === note.id ? { ...n, folderId: updated.folderId } : n,
              ),
        );
        this.refreshFolders(); // note counts changed
      });
    });
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
    // Close any open editor / windows so nothing reappears (as a pane or a
    // floating window) in the other view after switching.
    this.openId.set(null);
    this.closeAllWallWindows();
    this.viewModeStore.set(mode);
  }

  /** Flushes + closes every floating wall window (note and folder). */
  private closeAllWallWindows(): void {
    for (const id of this.wallOpenIds()) this.openStore.flush(id);
    this.wallOpenIds.set([]);
    this.wallFolderIds.set([]);
    this.folderNotes.set(new Map());
    this.winZ.set(new Map());
    // Reset the pan so a stale offset doesn't leave the new view scrolled away.
    this.panOffset.set({ x: 0, y: 0 });
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
      // Opens the right-hand pane (LIST) or a floating window (WALL).
      this.open(n.id);
    });
  }

  /**
   * Opens a note in the right-hand pane. The single content fetch is owned by
   * OpenNotesStore (the editor mounts and calls store.open too — the store's
   * in-flight guard dedupes them into one GET). The linked-note pills then read
   * straight off that store entry via `openNoteLinks`. The deep-link path
   * already has the NoteDto and primes the store with it to skip the fetch.
   */
  open(id: string, prefetched?: NoteDto): void {
    if (prefetched) {
      this.openStore.prime(prefetched);
    } else {
      this.openStore.open(id);
    }
    // WALL mode spawns a floating, non-modal window (multiple can be open at
    // once); LIST mode keeps the single right-hand pane.
    if (this.mode() === 'wall' && !this.inTrash()) {
      this.openWallWindow(id);
    } else {
      this.openId.set(id);
    }
    const note = this.notes().find((n) => n.id === id);
    if (note && !note.seen) {
      // Reflect the now-consumed share badge locally.
      this.notes.update((list) =>
        list.map((n) => (n.id === id ? { ...n, seen: true } : n)),
      );
      setTimeout(() => this.refreshBadge(), 800);
    }
  }

  // --- wall floating windows ---

  /**
   * Adds a note window in WALL mode. If already open, just raises it. Capped at
   * WALL_WINDOW_CAP total windows (notes + folders) — over the cap we snackbar
   * and refuse rather than silently dropping the user's existing windows.
   */
  private openWallWindow(id: string): void {
    if (this.wallOpenIds().includes(id)) {
      this.raiseWindow(id);
      return;
    }
    if (this.totalWindows() >= this.WALL_WINDOW_CAP) {
      this.snack.open('You can open up to 6 windows at once.', 'Dismiss', {
        duration: 3000,
      });
      return;
    }
    this.wallOpenIds.update((ids) => [...ids, id]);
    this.raiseWindow(id);
  }

  /** Count of open windows (notes + folders) for the cap. */
  private totalWindows(): number {
    return this.wallOpenIds().length + this.wallFolderIds().length;
  }

  /** Flushes pending autosave then removes a note window. */
  closeWindow(id: string): void {
    this.openStore.flush(id);
    this.wallOpenIds.update((ids) => ids.filter((x) => x !== id));
    this.clearWinZ(id);
    // Keep the deep-link / single openId in sync so reopening behaves.
    if (this.openId() === id) this.openId.set(null);
    this.refreshTags();
  }

  /** Brings a window to the front by assigning it the next z-index. */
  raiseWindow(id: string): void {
    const next = ++this.topZ;
    this.winZ.update((m) => {
      const out = new Map(m);
      out.set(id, next);
      return out;
    });
  }

  private clearWinZ(id: string): void {
    this.winZ.update((m) => {
      if (!m.has(id)) return m;
      const out = new Map(m);
      out.delete(id);
      return out;
    });
  }

  /** Z-index for a window; unraised windows sit at the base layer. */
  zOf(id: string): number {
    return this.winZ().get(id) ?? 60;
  }

  /**
   * Cascade position for the Nth window so they don't perfectly overlap. Seeded
   * from the window's index in the open list — deterministic, no Math.random.
   */
  windowLeft(index: number): number {
    return 40 + (index % 8) * 30;
  }
  windowTop(index: number): number {
    return 40 + (index % 8) * 30;
  }

  /** Per-window note lookup (notes list first, then any open folder window). */
  noteById(id: string): NoteSummaryDto | undefined {
    const hit = this.notes().find((n) => n.id === id);
    if (hit) return hit;
    for (const list of this.folderNotes().values()) {
      const f = list.find((n) => n.id === id);
      if (f) return f;
    }
    return undefined;
  }

  /** Whether a specific note window's content may be edited. */
  canEditNote(id: string): boolean {
    const n = this.noteById(id);
    return !!n && n.isOwner && !n.deletedAt;
  }

  /** Outgoing wikilinks for a specific open note window. */
  linksOfWindow(id: string): NoteLinkRef[] {
    return this.openStore.linksOf(id)();
  }

  // --- folder windows ---

  /** Note count badge for a folder card. */
  folderCount(id: string): number {
    return this.folders().find((f) => f.id === id)?.noteCount ?? 0;
  }

  folderName(id: string): string {
    return this.folders().find((f) => f.id === id)?.name ?? 'Folder';
  }

  /** Subfolders of an open folder window (shown as folder cards inside it). */
  subfolders(folderId: string): FolderDto[] {
    return this.folders().filter((f) => f.parentId === folderId);
  }

  /** Double-click a folder card → open its floating mini-grid window. */
  openFolderWindow(id: string): void {
    if (this.wallFolderIds().includes(id)) {
      this.raiseWindow(id);
      return;
    }
    if (this.totalWindows() >= this.WALL_WINDOW_CAP) {
      this.snack.open('You can open up to 6 windows at once.', 'Dismiss', {
        duration: 3000,
      });
      return;
    }
    this.wallFolderIds.update((ids) => [...ids, id]);
    this.raiseWindow(id);
    // Fetch the folder's notes for the mini-grid.
    this.api.list({ filter: 'all', folderId: id }).subscribe((notes) => {
      this.folderNotes.update((m) => {
        const out = new Map(m);
        out.set(id, notes);
        return out;
      });
    });
  }

  closeFolderWindow(id: string): void {
    this.wallFolderIds.update((ids) => ids.filter((x) => x !== id));
    this.folderNotes.update((m) => {
      if (!m.has(id)) return m;
      const out = new Map(m);
      out.delete(id);
      return out;
    });
    this.clearWinZ(id);
  }

  /** Notes inside an open folder window. */
  notesInFolder(id: string): NoteSummaryDto[] {
    return this.folderNotes().get(id) ?? [];
  }

  // --- wall panning (left-drag on empty grid background) ---

  /**
   * Begins panning when a pointerdown lands on the EMPTY grid background (not on
   * a card / folder card / window). Records the start pointer + offset and
   * captures the pointer so a fast drag that leaves the element still tracks.
   */
  onPanPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return; // left button only
    // Only start from empty space: ignore clicks that originate on a card.
    const target = event.target as HTMLElement;
    if (target.closest('.card, .folder-card, .note-window')) return;
    this.panStart = {
      px: event.clientX,
      py: event.clientY,
      ox: this.panOffset().x,
      oy: this.panOffset().y,
    };
    this.panning.set(true);
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  onPanPointerMove(event: PointerEvent): void {
    if (!this.panStart) return;
    const dx = event.clientX - this.panStart.px;
    const dy = event.clientY - this.panStart.py;
    const scroll = this.wallScrollEl()?.nativeElement;
    const viewport = {
      w: scroll?.clientWidth ?? 0,
      h: scroll?.clientHeight ?? 0,
    };
    this.panOffset.set(
      clampPan(
        { x: this.panStart.ox + dx, y: this.panStart.oy + dy },
        this.wallContentSize(),
        viewport,
      ),
    );
  }

  onPanPointerUp(event: PointerEvent): void {
    if (!this.panStart) return;
    this.panStart = null;
    this.panning.set(false);
    (event.currentTarget as HTMLElement).releasePointerCapture?.(
      event.pointerId,
    );
  }

  // --- wall card click-vs-drag suppression ---

  /** Pointerdown coords per card, to discriminate a click from a micro-drag. */
  private cardDownAt: Point | null = null;

  onCardPointerDown(event: PointerEvent): void {
    // Stop the pan handler from also reacting to a card press.
    event.stopPropagation();
    if (event.button !== 0) {
      this.cardDownAt = null;
      return;
    }
    this.cardDownAt = { x: event.clientX, y: event.clientY };
  }

  /**
   * Opens the note only on a genuine click: a plain left interaction whose
   * pointer barely moved. Any movement beyond ~3px (even a CDK sub-threshold
   * micro-drag) suppresses the open so dragging a card never opens the editor.
   */
  onCardPointerUp(id: string, event: PointerEvent): void {
    const down = this.cardDownAt;
    this.cardDownAt = null;
    if (!down || event.button !== 0) return;
    if (!shouldOpenInApp(event)) return;
    if (movedBeyond(down, { x: event.clientX, y: event.clientY })) return;
    this.open(id);
  }

  /**
   * Plain left-click on a row's title anchor: open in-app and suppress the
   * browser navigation. Ctrl/Cmd/Shift/Alt/middle-click fall through so the
   * browser opens `/note/:id` natively (a new tab/window) — see shouldOpenInApp.
   */
  rowOpen(id: string, event: MouseEvent): void {
    if (!shouldOpenInApp(event)) return; // let the browser handle the anchor
    event.preventDefault();
    this.open(id);
  }

  /**
   * Click on a linked-note pill: open the target in the same pane (plain
   * left-click) or let the browser open `/note/:id` in a new tab/window for
   * Ctrl/Cmd/Shift/Alt/middle-click — same rule as note rows.
   */
  openLink(id: string, event: MouseEvent): void {
    if (!shouldOpenInApp(event)) return; // browser handles the anchor
    event.preventDefault();
    this.open(id);
  }

  /**
   * Right-click on a row / card: position the hidden trigger at the cursor and
   * open the Material menu for that note. Suppresses the native browser menu.
   */
  openContextMenu(note: NoteSummaryDto, event: MouseEvent): void {
    event.preventDefault();
    this.ctxNote.set(note);
    this.ctxPos.set({ x: event.clientX, y: event.clientY });
    const trigger = this.ctxTrigger();
    if (!trigger) return;
    // Re-open at the new position if a previous menu is still showing.
    trigger.closeMenu();
    trigger.openMenu();
  }

  /** Opens `/note/:id` in a new browser tab (context-menu "Open in new tab"). */
  openInNewTab(id: string): void {
    const url = this.router.serializeUrl(
      this.router.createUrlTree(['/note', id]),
    );
    window.open(url, '_blank', 'noopener');
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
      // LIST → pane; WALL → floating window.
      this.open(copy.id);
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

  /**
   * Select-all toggle over the current (filtered) view: if every visible note
   * is already selected, clear; otherwise select them all.
   */
  toggleSelectAll(): void {
    if (this.allSelected()) {
      this.clearSelection();
      return;
    }
    this.selected.set(new Set(this.notes().map((n) => n.id)));
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
    // Close any floating wall windows for deleted notes.
    // Deliberately skip flush (unlike closeWindow) — the note is being permanently
    // deleted/trashed so we must not re-save any pending editor content.
    if (this.wallOpenIds().some((id) => gone.has(id))) {
      this.wallOpenIds().filter((id) => gone.has(id)).forEach((id) => this.clearWinZ(id));
      this.wallOpenIds.update((list) => list.filter((id) => !gone.has(id)));
    }
    if (this.wallFolderIds().some((id) => gone.has(id))) {
      this.wallFolderIds().filter((id) => gone.has(id)).forEach((id) => {
        this.clearWinZ(id);
        this.folderNotes.update((m) => {
          if (!m.has(id)) return m;
          const out = new Map(m);
          out.delete(id);
          return out;
        });
      });
      this.wallFolderIds.update((list) => list.filter((id) => !gone.has(id)));
    }
    this.selected.update((set) => {
      const next = new Set(set);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    this.refreshTags();
    this.refreshFolders(); // trashing/restoring changes folder note counts
  }

  // --- tags on the open note ---

  addTagFromChip(event: MatChipInputEvent, trigger: MatAutocompleteTrigger): void {
    // If an autocomplete option is highlighted, the (optionSelected) handler owns
    // this Enter press — avoid double-adding by bailing out here.
    if (trigger.activeOption) {
      event.chipInput.clear();
      return;
    }
    const note = this.openNote();
    const name = event.value.trim();
    event.chipInput.clear();
    this.tagQuery.set('');
    if (!note || !name) return;
    this.saveTags(note.id, [...note.tags, name]);
  }

  addTagFromOption(event: MatAutocompleteSelectedEvent, inputEl: HTMLInputElement): void {
    const note = this.openNote();
    const name = event.option.viewValue.trim();
    inputEl.value = '';
    this.tagQuery.set('');
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

  // --- tags scoped to a specific WALL window (multiple open notes) ---

  /** Autocomplete options for a window: all tags minus that note's tags. */
  tagOptionsFor(id: string): string[] {
    return filterTagOptions(
      this.tags(),
      this.noteById(id)?.tags ?? [],
      this.tagQuery(),
    );
  }

  addTagOn(
    id: string,
    event: MatChipInputEvent,
    trigger: MatAutocompleteTrigger,
  ): void {
    if (trigger.activeOption) {
      event.chipInput.clear();
      return;
    }
    const note = this.noteById(id);
    const name = event.value.trim();
    event.chipInput.clear();
    this.tagQuery.set('');
    if (!note || !name) return;
    this.saveTags(id, [...note.tags, name]);
  }

  addTagOnFromOption(
    id: string,
    event: MatAutocompleteSelectedEvent,
    inputEl: HTMLInputElement,
  ): void {
    const note = this.noteById(id);
    const name = event.option.viewValue.trim();
    inputEl.value = '';
    this.tagQuery.set('');
    if (!note || !name) return;
    this.saveTags(id, [...note.tags, name]);
  }

  removeTagOn(id: string, name: string): void {
    const note = this.noteById(id);
    if (!note) return;
    this.saveTags(
      id,
      note.tags.filter((t) => t !== name),
    );
  }

  // --- due date on the open note ---

  /** Converts a stored ISO due date (or null/undefined) to a Date for the picker. */
  dueAsDate(iso: string | null | undefined): Date | null {
    return iso ? new Date(iso) : null;
  }

  /** Saves (or clears, when `date` is null) the open note's due date. */
  setDue(noteId: string, date: Date | null): void {
    const iso = date ? date.toISOString() : null;
    this.api.updateMeta(noteId, { dueDate: iso }).subscribe((updated) => {
      this.notes.update((list) =>
        list.map((n) =>
          n.id === noteId ? { ...n, dueDate: updated.dueDate } : n,
        ),
      );
    });
  }

  // --- sidebar calendar filter ---

  /**
   * Records the shift key at mousedown so the subsequent (selectedChange) can
   * tell a plain click from a Shift+Click without its own event object.
   */
  onCalendarMouseDown(event: MouseEvent): void {
    this.shiftHeld = event.shiftKey;
  }

  /**
   * Calendar day selection:
   *  - plain click on a new day → filter to that single day;
   *  - plain click on the already-selected single day → clear the filter;
   *  - Shift+Click with one day already selected → filter the [min, max] range.
   */
  onCalendarSelect(date: Date | null): void {
    if (!date) return;
    const start = this.dueStart();

    if (this.shiftHeld && start && !this.dueEnd()) {
      const [lo, hi] =
        date.getTime() < start.getTime() ? [date, start] : [start, date];
      this.dueStart.set(lo);
      this.dueEnd.set(hi);
    } else if (start && !this.dueEnd() && sameDay(start, date)) {
      // re-clicking the single selected day clears the filter
      this.clearDueFilter();
      return;
    } else {
      this.dueStart.set(date);
      this.dueEnd.set(null);
    }
    this.openId.set(null);
    this.refresh();
  }

  /** Current calendar selection (single day = start; the cell highlight). */
  get dueSelected(): Date | null {
    return this.dueStart();
  }

  clearDueFilter(): void {
    this.dueStart.set(null);
    this.dueEnd.set(null);
    this.refresh();
  }

  // --- authorship ---

  /**
   * One-line attribution shown under list rows / in the editor header and as
   * the wall-card tooltip: "by {owner} · edited {when}[ by {editor}]". The
   * "by {editor}" segment is omitted when the note has never been edited.
   */
  authorLine(note: NoteSummaryDto): string {
    let line = `by ${note.ownerName} · edited ${timeAgo(note.updatedAt)}`;
    if (note.lastEditedByName) line += ` by ${note.lastEditedByName}`;
    return line;
  }

  logout(): void {
    this.auth.logout().subscribe(() => void this.router.navigateByUrl('/login'));
  }
}
