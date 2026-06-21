import {
  ElementRef,
  Injectable,
  Signal,
  WritableSignal,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  CdkDragEnd,
  CdkDragMove,
} from '@angular/cdk/drag-drop';
import { MatSnackBar } from '@angular/material/snack-bar';
import { forkJoin } from 'rxjs';
import type {
  FolderDto,
  NoteDto,
  NoteFilter,
  NoteSummaryDto,
} from '@perpetuum-nota/shared';
import { NotesApi } from '../core/notes.api';
import { FoldersApi } from '../core/folders.api';
import { OpenNotesStore, type NoteLinkRef } from '../editor/open-notes.store';
import { NotesIndexStore } from '../core/notes-index';
import { shouldOpenInApp } from './click-modifiers';
import { movedBeyond, type Point } from './drag-threshold';
import { pinnedFirst } from './pinned-order';
import {
  WALL_CARD_CELLS,
  WALL_CELL,
} from './wall-cell.directive';
import { reorganizeLayout } from './reorganize-layout';
import { linkLines, type Line } from './wall-links';

interface CellPos {
  x: number;
  y: number;
}

/**
 * Component-provided signal store owning the WALL grid + floating-window state
 * and logic extracted from the `Manager` "god component". It is wired to the
 * manager's shared data signals (notes/folders/filters) and refresh callbacks
 * via {@link connect}, which the manager calls once in its constructor. Because
 * signals are references, the store mutates the very same signals the manager
 * exposes — behaviour is identical to the pre-refactor in-component code.
 */
@Injectable()
export class WallStore {
  private readonly api = inject(NotesApi);
  private readonly foldersApi = inject(FoldersApi);
  private readonly openStore = inject(OpenNotesStore);
  private readonly notesIndex = inject(NotesIndexStore);
  private readonly snack = inject(MatSnackBar);

  /** Grid cell size exposed for the template (`wall.CELL`). */
  readonly CELL = WALL_CELL;

  // --- connected dependencies (set by Manager.connect) ---
  notes!: WritableSignal<NoteSummaryDto[]>;
  folders!: WritableSignal<FolderDto[]>;
  displayNotes!: Signal<NoteSummaryDto[]>;
  filter!: Signal<NoteFilter>;
  activeTag!: Signal<string | null>;
  activeFolderId!: Signal<string | null>;
  q!: Signal<string>;
  hasDueFilter!: Signal<boolean>;
  inTrash!: Signal<boolean>;
  mode!: Signal<'list' | 'wall'>;
  refresh!: () => void;
  refreshFolders!: () => void;
  refreshTags!: () => void;
  openNote!: (
    id: string,
    prefetched?: NoteDto,
    mode?: 'reuse' | 'newFocus' | 'background',
  ) => void;
  /** The wall grid element (viewChild on Manager); used for cell hit-testing. */
  wallEl!: Signal<ElementRef<HTMLDivElement> | undefined>;

  /**
   * Wires the store to the manager's shared signals/services + the wall element.
   * Signals are references, so the store reads/mutates the same ones the manager
   * exposes; refresh* / openNote are callbacks back into the manager.
   */
  connect(deps: {
    notes: WritableSignal<NoteSummaryDto[]>;
    folders: WritableSignal<FolderDto[]>;
    displayNotes: Signal<NoteSummaryDto[]>;
    filter: Signal<NoteFilter>;
    activeTag: Signal<string | null>;
    activeFolderId: Signal<string | null>;
    q: Signal<string>;
    hasDueFilter: Signal<boolean>;
    inTrash: Signal<boolean>;
    mode: Signal<'list' | 'wall'>;
    refresh: () => void;
    refreshFolders: () => void;
    refreshTags: () => void;
    openNote: (
      id: string,
      prefetched?: NoteDto,
      mode?: 'reuse' | 'newFocus' | 'background',
    ) => void;
    wallEl: Signal<ElementRef<HTMLDivElement> | undefined>;
  }): void {
    Object.assign(this, deps);
  }

  // --- wall grid state ---
  readonly wallCols = signal(24);
  /** Measured card heights in grid cells (id → cells). */
  readonly cardHeights = signal<ReadonlyMap<string, number>>(new Map());

  // --- wall floating windows (multiple open notes / folders) ---
  /** Max concurrently-open windows (notes + folders) before we refuse more. */
  private readonly WALL_WINDOW_CAP = 6;
  /** Open note-window ids in WALL mode (LIST mode still uses `openId`). */
  readonly wallOpenIds = signal<string[]>([]);
  /** Open folder-window ids in WALL mode. */
  readonly wallFolderIds = signal<string[]>([]);
  /** Per-window z-index (id → z); raising a window bumps it above `topZ`. */
  private readonly winZ = signal<ReadonlyMap<string, number>>(new Map());
  /** Per-window drag offset (id → {x,y}); survives minimize/restore re-mounts. */
  private readonly winPos = signal<ReadonlyMap<string, { x: number; y: number }>>(
    new Map(),
  );
  /** Monotonic z-index counter; the next raised window gets topZ. */
  private topZ = 60;
  /** Notes inside each open folder window (folderId → its notes). */
  readonly folderNotes = signal<ReadonlyMap<string, NoteSummaryDto[]>>(
    new Map(),
  );

  /** Ids of windows minimized to bubbles (bottom-right). */
  readonly minimized = signal<ReadonlySet<string>>(new Set());
  /** Whether the bubble stack is fanned out. */
  readonly bubblesFanned = signal(false);
  /** Wall "reorganize" mode: alphabetized auto-layout the user can commit. */
  readonly reorganizing = signal(false);
  /** Wall "show links" overlay toggle + the cached wikilink edges. */
  readonly showLinks = signal(false);
  private readonly linkEdges = signal<{ a: string; b: string }[]>([]);

  // --- wall drag-and-drop (file/unfile notes; move subfolders) ---
  /** Folder id currently under a dragged note (drives the drop highlight). */
  readonly dragOverFolderId = signal<string | null>(null);
  /** True while a folder-window tile is being dragged (un-clips the windows so
   *  the tile can be dragged out onto the grid). */
  readonly draggingMini = signal(false);
  /** True while a note dragged from a folder window is over the empty grid. */
  readonly dragOverGrid = signal(false);

  /**
   * Notes shown loose on the WALL. In the root unfiltered view, notes filed into
   * a folder live inside that folder's window (opened from its card), so they're
   * hidden from the main grid here. Filtered/inside-a-folder views show the full
   * `displayNotes` set as before.
   */
  readonly wallNotes = computed(() => {
    const notes = this.displayNotes();
    return this.isRootWallView()
      ? notes.filter((n) => n.folderId == null)
      : notes;
  });

  /**
   * Spatial layout for the wall: hand-placed notes keep their stored grid
   * coords; never-placed notes flow into the first free slot (top-left scan).
   * Flow placement is display-only — coords persist only when the user drags.
   */
  /**
   * Unified wall placement — folder cards and note cards share ONE grid, each
   * avoiding the others. Hand-placed cards (stored wallX/wallY) keep their
   * coords; never-placed cards flow into the first free slot (top-left scan).
   * Folders are laid first so a fresh note flows around them. Returns both maps
   * so folder/note layouts stay consistent (no overlaps between the two sets).
   */
  private readonly wallPlacement = computed<{
    folders: Map<string, CellPos>;
    notes: Map<string, CellPos>;
  }>(() => {
    const cols = Math.max(WALL_CARD_CELLS, this.wallCols());
    const heights = this.cardHeights();
    const W = WALL_CARD_CELLS;
    const FH = this.FOLDER_CARD_CELLS;
    const rects: { x: number; y: number; w: number; h: number }[] = [];
    const overlap = (x: number, y: number, w: number, h: number): boolean =>
      rects.some((r) => x < r.x + r.w && r.x < x + w && y < r.y + r.h && r.y < y + h);
    const flow = (w: number, h: number): CellPos => {
      for (let y = 0; ; y++) {
        for (let x = 0; x + w <= cols; x++) {
          if (!overlap(x, y, w, h)) return { x, y };
        }
      }
    };

    const folders = new Map<string, CellPos>();
    const notes = new Map<string, CellPos>();
    const folderCards = this.rootFolders();
    const noteCards = this.wallNotes();

    // 1–2: lock in every hand-placed card first (folders + notes).
    for (const f of folderCards) {
      if (f.wallX == null || f.wallY == null) continue;
      folders.set(f.id, { x: f.wallX, y: f.wallY });
      rects.push({ x: f.wallX, y: f.wallY, w: W, h: FH });
    }
    for (const n of noteCards) {
      if (n.wallX == null || n.wallY == null) continue;
      notes.set(n.id, { x: n.wallX, y: n.wallY });
      rects.push({ x: n.wallX, y: n.wallY, w: W, h: heights.get(n.id) ?? 3 });
    }
    // 3–4: flow the rest into free slots (folders before notes).
    for (const f of folderCards) {
      if (f.wallX != null && f.wallY != null) continue;
      const pos = flow(W, FH);
      folders.set(f.id, pos);
      rects.push({ ...pos, w: W, h: FH });
    }
    for (const n of noteCards) {
      if (n.wallX != null && n.wallY != null) continue;
      const h = heights.get(n.id) ?? 3;
      const pos = flow(W, h);
      notes.set(n.id, pos);
      rects.push({ ...pos, w: W, h });
    }
    return { folders, notes };
  });

  readonly wallLayout = computed<ReadonlyMap<string, CellPos>>(() => {
    // Reorganize mode overrides stored coords with an alphabetized auto-layout.
    // Display-only: stored wallX/wallY are untouched, so toggling off restores
    // the user's custom positions for free (only Commit persists). The layout is
    // shifted below any folder cards so the reorganized notes never hide them.
    if (this.reorganizing()) {
      const cols = Math.max(WALL_CARD_CELLS, this.wallCols());
      const layout = reorganizeLayout(this.wallNotes(), this.cardHeights(), cols);
      let folderBottom = 0;
      for (const [, p] of this.folderLayout()) {
        folderBottom = Math.max(folderBottom, p.y + this.FOLDER_CARD_CELLS + 1);
      }
      if (folderBottom === 0) return layout;
      const shifted = new Map<string, CellPos>();
      for (const [id, p] of layout) shifted.set(id, { x: p.x, y: p.y + folderBottom });
      return shifted;
    }
    return this.wallPlacement().notes;
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

  /** Line segments between linked cards for the "show links" overlay. */
  readonly wallLinkLines = computed<Line[]>(() =>
    this.showLinks()
      ? linkLines(
          this.linkEdges(),
          this.wallLayout(),
          this.cardHeights(),
          this.noteOffsetCells(),
        )
      : [],
  );

  // --- wall panning ---
  /** Pan offset applied as translate() to the positioned `.wall-grid` layer. */
  readonly panOffset = signal<{ x: number; y: number }>({ x: 0, y: 0 });
  readonly panning = signal(false);
  /** Pointer + offset captured at pan start. */
  panStart: { px: number; py: number; ox: number; oy: number } | null = null;

  /**
   * Pixel extent of the placed content (farthest card right/bottom edge). Drives
   * the pan clamp so you can pan content-extent + one viewport, never further.
   */
  readonly wallContentSize = computed<{ w: number; h: number }>(() => {
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

  /** Folder card footprint height in cells. */
  private readonly FOLDER_CARD_CELLS = 2;

  /** Grid coords for folder cards (from the unified folder+note placement). */
  readonly folderLayout = computed<ReadonlyMap<string, CellPos>>(
    () => this.wallPlacement().folders,
  );

  /**
   * Legacy "push notes below the folder band" offset. Folders are now free-placed
   * grid cards (sharing the unified placement above), so notes are no longer
   * offset — kept at 0 so the existing template/extent math stays unchanged.
   */
  readonly noteOffsetCells = computed(() => 0);

  // --- wall grid ---

  onCellHeight(event: { id: string; cells: number }): void {
    const current = this.cardHeights();
    if (current.get(event.id) === event.cells) return;
    const next = new Map(current);
    next.set(event.id, event.cells);
    this.cardHeights.set(next);
  }

  // --- wall occupancy helpers (shared by drag, create, context-menu) ---

  /** Footprint rects of every placed card (folders + notes), minus `excludeId`. */
  private wallOccupancy(
    excludeId?: string,
  ): { x: number; y: number; w: number; h: number }[] {
    const heights = this.cardHeights();
    const rects: { x: number; y: number; w: number; h: number }[] = [];
    for (const [id, p] of this.folderLayout()) {
      if (id === excludeId) continue;
      rects.push({ x: p.x, y: p.y, w: WALL_CARD_CELLS, h: this.FOLDER_CARD_CELLS });
    }
    for (const [id, p] of this.wallLayout()) {
      if (id === excludeId) continue;
      rects.push({ x: p.x, y: p.y, w: WALL_CARD_CELLS, h: heights.get(id) ?? 3 });
    }
    return rects;
  }

  /** Pushes (x,y) straight down until a card of height `h` cells fits free. */
  private nudgeDownToFree(
    x: number,
    y: number,
    h: number,
    excludeId?: string,
  ): CellPos {
    const rects = this.wallOccupancy(excludeId);
    const hit = (yy: number) =>
      rects.some(
        (r) => x < r.x + r.w && r.x < x + WALL_CARD_CELLS && yy < r.y + r.h && r.y < yy + h,
      );
    while (hit(y)) y++;
    return { x, y };
  }

  /** First free cell (top-left scan) for a new card of height `h` cells. */
  firstFreeCell(h = 3): CellPos {
    const cols = Math.max(WALL_CARD_CELLS, this.wallCols());
    const rects = this.wallOccupancy();
    const hit = (x: number, y: number) =>
      rects.some(
        (r) => x < r.x + r.w && r.x < x + WALL_CARD_CELLS && y < r.y + r.h && r.y < y + h,
      );
    for (let y = 0; ; y++) {
      for (let x = 0; x + WALL_CARD_CELLS <= cols; x++) {
        if (!hit(x, y)) return { x, y };
      }
    }
  }

  // --- drag hit-testing helpers (file/unfile via drop targets) ---

  /** Client-space pointer point from a CDK drag's native event. */
  private clientPoint(e: MouseEvent | TouchEvent): Point {
    if (typeof TouchEvent !== 'undefined' && e instanceof TouchEvent) {
      const t = e.changedTouches[0] ?? e.touches[0];
      return { x: t?.clientX ?? 0, y: t?.clientY ?? 0 };
    }
    const m = e as MouseEvent;
    return { x: m.clientX, y: m.clientY };
  }

  /** Element under (x,y), with the dragged element momentarily hidden so the
   *  real drop target below is returned (no flicker — done synchronously). */
  private elementUnder(x: number, y: number, dragEl: HTMLElement): Element | null {
    const prev = dragEl.style.visibility;
    dragEl.style.visibility = 'hidden';
    const el = document.elementFromPoint(x, y);
    dragEl.style.visibility = prev;
    return el;
  }

  /** Folder id of the folder CARD or folder WINDOW under a point (or null). */
  private folderTargetAt(x: number, y: number, dragEl: HTMLElement): string | null {
    const el = this.elementUnder(x, y, dragEl);
    if (!el) return null;
    const card = el.closest('.folder-card[data-folder-id]');
    if (card) return card.getAttribute('data-folder-id');
    const win = el.closest('[data-folder-window]');
    if (win) return win.getAttribute('data-folder-window');
    return null;
  }

  /** True when a point is over the empty wall grid (not a window / card). */
  private overGridAt(x: number, y: number, dragEl: HTMLElement): boolean {
    const el = this.elementUnder(x, y, dragEl);
    return !!el?.closest('.wall-scroll') && !el.closest('.note-window');
  }

  /** Live drop-target highlight while dragging a note across the wall. */
  onNoteDragMoved(event: CdkDragMove): void {
    const pt = this.clientPoint(event.event);
    const dragEl = event.source.element.nativeElement;
    this.dragOverFolderId.set(this.folderTargetAt(pt.x, pt.y, dragEl));
  }

  /** Snaps a dragged card to the nearest intersection and persists its coords —
   *  OR files the note when it's dropped on a folder card / folder window. */
  onWallDragEnd(note: NoteSummaryDto, event: CdkDragEnd): void {
    const delta = event.source.getFreeDragPosition();
    const pt = this.clientPoint(event.event);
    const dragEl = event.source.element.nativeElement;
    const targetFolderId = this.folderTargetAt(pt.x, pt.y, dragEl);
    event.source.reset(); // cards are positioned via left/top, not transforms
    this.dragOverFolderId.set(null);

    // Dropped on a folder card / window → file the note into that folder.
    if (targetFolderId && targetFolderId !== note.folderId) {
      this.bindNoteToFolder(note.id, targetFolderId);
      return;
    }
    if (delta.x === 0 && delta.y === 0) return;

    const cur = this.wallLayout().get(note.id) ?? { x: 0, y: 0 };
    const cols = Math.max(WALL_CARD_CELLS, this.wallCols());
    let x = Math.round((cur.x * WALL_CELL + delta.x) / WALL_CELL);
    let y = Math.round((cur.y * WALL_CELL + delta.y) / WALL_CELL);
    x = Math.max(0, Math.min(x, cols - WALL_CARD_CELLS));
    y = Math.max(0, y);

    // Anywhere on the grid — but never hidden under another card (folder OR
    // note): nudge straight down to the first free row at that column.
    const h = this.cardHeights().get(note.id) ?? 3;
    ({ x, y } = this.nudgeDownToFree(x, y, h, note.id));

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

  // --- folder cards: drag to reposition + single-click to open ---

  /** Pointerdown coords per folder card, to tell a click from a drag. */
  private folderDownAt: Point | null = null;

  onFolderPointerDown(event: PointerEvent): void {
    event.stopPropagation(); // don't let the pan handler grab it
    this.folderDownAt =
      event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
  }

  /** Single (un-dragged) left click on a folder card → open its window. */
  onFolderPointerUp(id: string, event: PointerEvent): void {
    const down = this.folderDownAt;
    this.folderDownAt = null;
    if (!down || event.button !== 0) return;
    if (movedBeyond(down, { x: event.clientX, y: event.clientY })) return;
    this.openFolderWindow(id);
  }

  /** Snaps a dragged folder card to the grid and persists its coords. */
  onFolderDragEnd(folder: FolderDto, event: CdkDragEnd): void {
    const delta = event.source.getFreeDragPosition();
    event.source.reset();
    if (delta.x === 0 && delta.y === 0) return;

    const cur = this.folderLayout().get(folder.id) ?? { x: 0, y: 0 };
    const cols = Math.max(WALL_CARD_CELLS, this.wallCols());
    let x = Math.round((cur.x * WALL_CELL + delta.x) / WALL_CELL);
    let y = Math.round((cur.y * WALL_CELL + delta.y) / WALL_CELL);
    x = Math.max(0, Math.min(x, cols - WALL_CARD_CELLS));
    y = Math.max(0, y);
    ({ x, y } = this.nudgeDownToFree(x, y, this.FOLDER_CARD_CELLS, folder.id));

    this.folders.update((list) =>
      list.map((f) => (f.id === folder.id ? { ...f, wallX: x, wallY: y } : f)),
    );
    this.foldersApi.moveOnWall(folder.id, x, y).subscribe({
      error: () => {
        this.snack.open('Could not save the folder position.', 'Dismiss', {
          duration: 4000,
        });
        this.refreshFolders();
      },
    });
  }

  // --- folder-window tiles: drag a note / subfolder out (to grid or another folder) ---

  /** Converts client coords to a free wall cell (for an unfiled note's landing). */
  private gridCellAt(clientX: number, clientY: number): CellPos {
    const el = this.wallEl()?.nativeElement;
    if (!el) return this.firstFreeCell();
    const rect = el.getBoundingClientRect();
    const cols = Math.max(WALL_CARD_CELLS, this.wallCols());
    let x = Math.floor((clientX - rect.left) / WALL_CELL);
    let y = Math.floor((clientY - rect.top) / WALL_CELL);
    x = Math.max(0, Math.min(x, cols - WALL_CARD_CELLS));
    y = Math.max(0, y);
    return this.nudgeDownToFree(x, y, 3);
  }

  onMiniDragStart(): void {
    this.draggingMini.set(true);
  }

  /** Live highlight while a folder-window tile is dragged. */
  onMiniDragMoved(event: CdkDragMove): void {
    const pt = this.clientPoint(event.event);
    const dragEl = event.source.element.nativeElement;
    this.dragOverFolderId.set(this.folderTargetAt(pt.x, pt.y, dragEl));
    this.dragOverGrid.set(this.overGridAt(pt.x, pt.y, dragEl));
  }

  private endMiniDrag(event: CdkDragEnd): void {
    event.source.reset(); // tiles are data-driven; never free-positioned
    this.draggingMini.set(false);
    this.dragOverGrid.set(false);
    this.dragOverFolderId.set(null);
  }

  /** Note tile dragged out of `fromFolderId`: onto the grid → unfile to root
   *  (placed where dropped); onto another folder window → refile there. */
  onMiniNoteDragEnd(
    fromFolderId: string,
    note: NoteSummaryDto,
    event: CdkDragEnd,
  ): void {
    const pt = this.clientPoint(event.event);
    const dragEl = event.source.element.nativeElement;
    const targetFolderId = this.folderTargetAt(pt.x, pt.y, dragEl);
    const onGrid = this.overGridAt(pt.x, pt.y, dragEl);
    this.endMiniDrag(event);

    if (targetFolderId && targetFolderId !== fromFolderId) {
      this.bindNoteToFolder(note.id, targetFolderId);
    } else if (onGrid) {
      this.bindNoteToFolder(note.id, null, this.gridCellAt(pt.x, pt.y));
    }
  }

  /** Subfolder tile dragged out of `fromFolderId`: onto the grid → move to root;
   *  onto another folder window → move into that folder. */
  onMiniFolderDragEnd(
    fromFolderId: string,
    sub: FolderDto,
    event: CdkDragEnd,
  ): void {
    const pt = this.clientPoint(event.event);
    const dragEl = event.source.element.nativeElement;
    const targetFolderId = this.folderTargetAt(pt.x, pt.y, dragEl);
    const onGrid = this.overGridAt(pt.x, pt.y, dragEl);
    this.endMiniDrag(event);

    let newParent: string | null;
    if (onGrid) {
      newParent = null;
    } else if (
      targetFolderId &&
      targetFolderId !== sub.id &&
      targetFolderId !== fromFolderId
    ) {
      newParent = targetFolderId;
    } else {
      return; // dropped nowhere meaningful
    }
    this.foldersApi.move(sub.id, newParent).subscribe({
      next: () => {
        this.refreshFolders();
        this.refreshOpenFolderWindows();
      },
      error: (err: { status?: number }) =>
        this.snack.open(
          err?.status === 400
            ? 'Cannot move a folder into its own subfolder.'
            : 'Could not move the folder.',
          'Dismiss',
          { duration: 4000 },
        ),
    });
  }

  /** Creates a note at a specific wall cell (from the empty-grid menu). */
  createAt(cell: CellPos): void {
    this.api.create('Untitled note').subscribe((n) => {
      const pos = this.nudgeDownToFree(cell.x, cell.y, 3);
      const created = { ...n, wallX: pos.x, wallY: pos.y };
      this.api.updateMeta(n.id, { wallX: pos.x, wallY: pos.y }).subscribe();
      this.notes.update((list) => pinnedFirst([created, ...list]));
      this.openNote(created.id, undefined, 'newFocus');
      this.notesIndex.refresh();
    });
  }

  // --- wall floating windows ---

  /**
   * Adds a note window in WALL mode. If already open, just raises it. Capped at
   * WALL_WINDOW_CAP total windows (notes + folders) — over the cap we snackbar
   * and refuse rather than silently dropping the user's existing windows.
   */
  openWallWindow(id: string): void {
    if (this.wallOpenIds().includes(id)) {
      // Re-clicking a minimized note's grid card maximizes it back.
      this.dropMinimized(id);
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
    this.dropMinimized(id);
    this.clearWinZ(id);
    this.clearWinPos(id);
    this.refreshTags();
  }

  /** Removes an id from the minimized set (so reopening shows the window). */
  private dropMinimized(id: string): void {
    if (!this.minimized().has(id)) return;
    this.minimized.update((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
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

  /** Stored drag offset for a window (origin until the user drags it). */
  windowPos(id: string): { x: number; y: number } {
    return this.winPos().get(id) ?? { x: 0, y: 0 };
  }

  /** Remembers where a window was dragged so restore re-opens it in place. */
  onWindowMoved(id: string, pos: { x: number; y: number }): void {
    this.winPos.update((m) => {
      const out = new Map(m);
      out.set(id, pos);
      return out;
    });
  }

  private clearWinPos(id: string): void {
    this.winPos.update((m) => {
      if (!m.has(id)) return m;
      const out = new Map(m);
      out.delete(id);
      return out;
    });
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
    return !!n && n.canEdit && !n.deletedAt;
  }

  /** Outgoing wikilinks for a specific open note window. */
  linksOfWindow(id: string): NoteLinkRef[] {
    return this.openStore.linksOf(id)();
  }

  // --- minimize to bubbles ---

  isMinimized(id: string): boolean {
    return this.minimized().has(id);
  }

  /** Minimizes a window to a bubble (flushes any pending note autosave first). */
  minimize(id: string): void {
    this.openStore.flush(id); // no-op for folder windows (no store entry)
    this.minimized.update((s) => new Set(s).add(id));
  }

  /**
   * Closes a minimized item directly from its bubble (the hover-revealed × ),
   * routing to the right teardown for a note vs folder window. Both paths drop
   * the minimized entry, so the bubble disappears.
   */
  closeMinimized(id: string): void {
    if (this.wallFolderIds().includes(id)) {
      this.closeFolderWindow(id);
    } else {
      this.closeWindow(id);
    }
  }

  /** Re-opens a minimized window and collapses the fanned stack. */
  restoreWindow(id: string): void {
    this.minimized.update((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
    this.bubblesFanned.set(false);
    this.raiseWindow(id);
  }

  /** Minimized windows still open, with a title + kind for the bubble label. */
  readonly minimizedWindows = computed(() => {
    const min = this.minimized();
    const out: { id: string; title: string; kind: 'note' | 'folder' }[] = [];
    for (const id of this.wallOpenIds()) {
      if (min.has(id)) {
        out.push({ id, title: this.noteById(id)?.title || 'Untitled', kind: 'note' });
      }
    }
    for (const id of this.wallFolderIds()) {
      if (min.has(id)) {
        out.push({ id, title: this.folderName(id), kind: 'folder' });
      }
    }
    return out;
  });

  /** Count of minimized folder windows (drives the folder count pill). */
  readonly minimizedFolderCount = computed(
    () => this.minimizedWindows().filter((w) => w.kind === 'folder').length,
  );
  /** Count of minimized note windows (drives the note count pill). */
  readonly minimizedNoteCount = computed(
    () => this.minimizedWindows().filter((w) => w.kind === 'note').length,
  );

  // --- reorganize mode ---

  /** Toggles reorganize mode; turning it on minimizes all open windows. */
  toggleReorganize(): void {
    const on = !this.reorganizing();
    this.reorganizing.set(on);
    if (on) {
      for (const id of [...this.wallOpenIds(), ...this.wallFolderIds()]) {
        this.minimize(id);
      }
    }
  }

  /**
   * Persists the current reorganized layout as each OWNED note's custom wall
   * coords (foreign notes are owner-set only), then exits reorganize mode.
   */
  commitReorganize(): void {
    const layout = this.wallLayout();
    const owned = this.wallNotes().filter((n) => n.isOwner);
    if (owned.length === 0) {
      this.reorganizing.set(false);
      return;
    }
    forkJoin(
      owned.map((n) => {
        const pos = layout.get(n.id) ?? { x: 0, y: 0 };
        return this.api.updateMeta(n.id, { wallX: pos.x, wallY: pos.y });
      }),
    ).subscribe({
      next: () => {
        this.notes.update((list) =>
          list.map((n) => {
            const pos = n.isOwner ? layout.get(n.id) : undefined;
            return pos ? { ...n, wallX: pos.x, wallY: pos.y } : n;
          }),
        );
        this.reorganizing.set(false);
      },
      error: () => {
        this.snack.open('Could not save the layout.', 'Dismiss', {
          duration: 4000,
        });
      },
    });
  }

  // --- show links overlay ---

  /** Toggles the wall link overlay, fetching the wikilink graph on first use. */
  toggleLinks(): void {
    const on = !this.showLinks();
    this.showLinks.set(on);
    if (on && this.linkEdges().length === 0) {
      this.api.graph().subscribe((g) => this.linkEdges.set(g.edges));
    }
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
      // Re-clicking a minimized folder maximizes it back.
      this.dropMinimized(id);
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
    this.dropMinimized(id);
    this.clearWinZ(id);
    this.clearWinPos(id);
  }

  /** Notes inside an open folder window. */
  notesInFolder(id: string): NoteSummaryDto[] {
    return this.folderNotes().get(id) ?? [];
  }

  /**
   * Files (folderId set) or unfiles (null) a note, optionally repositioning it
   * on the wall (used when dragging a note out of a folder onto the grid). Patch
   * is optimistic; folder counts + any open folder windows are refreshed. Shared
   * by the move dialog and the wall drag-and-drop.
   */
  bindNoteToFolder(
    noteId: string,
    targetFolderId: string | null,
    wall?: CellPos,
  ): void {
    const patch: { folderId: string | null; wallX?: number; wallY?: number } = {
      folderId: targetFolderId,
    };
    if (wall) {
      patch.wallX = wall.x;
      patch.wallY = wall.y;
    }
    this.api.updateMeta(noteId, patch).subscribe((updated) => {
      const activeFolderId = this.activeFolderId();
      const dropsOut = !!activeFolderId && updated.folderId !== activeFolderId;
      this.notes.update((list) =>
        dropsOut
          ? list.filter((n) => n.id !== noteId)
          : list.map((n) =>
              n.id === noteId
                ? {
                    ...n,
                    folderId: updated.folderId,
                    wallX: updated.wallX,
                    wallY: updated.wallY,
                  }
                : n,
            ),
      );
      this.refreshFolders(); // note counts changed
      this.refreshOpenFolderWindows(); // their contents changed
    });
  }

  /** Re-fetches the note lists of every open folder window. */
  private refreshOpenFolderWindows(): void {
    for (const id of this.wallFolderIds()) {
      this.api.list({ filter: 'all', folderId: id }).subscribe((notes) => {
        this.folderNotes.update((m) => new Map(m).set(id, notes));
      });
    }
  }

  /**
   * Tears down any floating wall windows (note + folder) whose ids are in `gone`,
   * WITHOUT flushing — the notes are being trashed/deleted, so pending editor
   * content must NOT be re-saved. Mirrors the window-teardown the manager's
   * `afterDelete` used to do inline (relocated here so the window state stays
   * encapsulated).
   */
  purgeDeletedWindows(gone: Set<string>): void {
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
  }

  /** Flushes + closes every floating wall window (note and folder). */
  closeAllWallWindows(): void {
    for (const id of this.wallOpenIds()) this.openStore.flush(id);
    this.wallOpenIds.set([]);
    this.wallFolderIds.set([]);
    this.folderNotes.set(new Map());
    this.winZ.set(new Map());
    this.minimized.set(new Set());
    this.bubblesFanned.set(false);
    this.reorganizing.set(false);
    // Reset the pan so a stale offset doesn't leave the new view scrolled away.
    this.panOffset.set({ x: 0, y: 0 });
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
    this.openNote(id);
  }
}
