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
  CdkDragMove,
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
import { MatSidenavContainer, MatSidenavModule } from '@angular/material/sidenav';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { catchError, forkJoin, map, of } from 'rxjs';
import type {
  FolderDto,
  NoteDto,
  NoteFilter,
  NoteSort,
  NoteSummaryDto,
  TagDto,
} from '@perpetuum-nota/shared';
import { AuthService } from '../core/auth.service';
import { NotesApi } from '../core/notes.api';
import { TagsApi } from '../core/tags.api';
import { FoldersApi } from '../core/folders.api';
import { ThemeStore } from '../core/theme.store';
import { SidenavStore } from '../core/sidenav.store';
import { ViewModeStore } from '../core/view-mode.store';
import { SettingsStore } from '../core/settings.store';
import { provideSettingsDateAdapter } from '../core/settings-date-adapter';
import { filterTagOptions } from './tag-filter';
import { tagColor } from './tag-color';
import {
  dueLabel as dueLabelRelative,
  dueState,
  endOfDay,
  sameDay,
  startOfDay,
} from './due-date';
import { timeAgo } from './time-ago';
import { opensInBackground, shouldOpenInApp } from './click-modifiers';
import {
  activateTab as activateTabState,
  closeTab as closeTabState,
  openInActiveTab as openInActiveTabState,
  openTab as openTabState,
  parseStoredTabs,
  patchTab as patchTabState,
  reorderTabs as reorderTabsState,
  restoreTabs,
  serializeTabs,
  type StoredTabs,
  type TabsState,
} from './tab-reducer';
import { movedBeyond, type Point } from './drag-threshold';
import { clampPan } from './wall-pan';
import { FolderTree } from './folder-tree';
import type { FolderNode } from './folder-tree.util';
import { openMoveToFolder } from './move-to-folder-dialog';
import { pinnedFirst } from './pinned-order';
import { NoteWindow } from './note-window';
import { NoteEditor } from '../editor/note-editor';
import { OpenNotesStore, type NoteLinkRef } from '../editor/open-notes.store';
import { NotesIndexStore } from '../core/notes-index';
import { ConfirmData, openConfirm } from '../shared-ui/confirm-dialog';
import { CollapsibleSection } from '../shared-ui/collapsible-section';
import { openNameDialog } from '../shared-ui/name-dialog';
import { ShareDialog } from '../sharing/share-dialog';
import {
  WALL_CARD_CELLS,
  WALL_CELL,
  WallCellDirective,
} from './wall-cell.directive';
import { dueGroups } from './due-group';
import { reorganizeLayout } from './reorganize-layout';
import { linkLines, type Line } from './wall-links';

const SEARCH_DEBOUNCE_MS = 300;

interface CellPos {
  x: number;
  y: number;
}

/** A flattened list-view row: either a due-date separator or a note. */
type ListRow =
  | { kind: 'sep'; key: string; label: string }
  | { kind: 'note'; key: string; note: NoteSummaryDto };

@Component({
  selector: 'app-manager',
  imports: [
    NoteEditor,
    NoteWindow,
    ShareDialog,
    FolderTree,
    CollapsibleSection,
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
  // The datepicker + inline calendar need a DateAdapter. The settings-aware
  // adapter wraps the native one and honors the user's week-start setting.
  providers: [provideSettingsDateAdapter()],
  templateUrl: './manager.html',
  styleUrls: ['./manager.scss', './manager-wall.scss'],
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
  private readonly notesIndex = inject(NotesIndexStore);
  private readonly breakpoints = inject(BreakpointObserver);
  private readonly settings = inject(SettingsStore);

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

  /**
   * Client-side "pinned only" filter. The tag/folder/due/search filters go
   * through the server; pinned has no server param, so it's applied on top of
   * the loaded `notes` via the `displayNotes` computed below. The `notes` signal
   * (and all its mutations) stays the full loaded set; only display/derived
   * reads route through `displayNotes()`.
   */
  readonly pinnedOnly = signal(false);
  /** The visible note set: the loaded notes, narrowed to pinned when toggled. */
  readonly displayNotes = computed(() =>
    this.pinnedOnly() ? this.notes().filter((n) => n.pinned) : this.notes(),
  );

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
   * List-view rows. When sorting by due date in list mode, notes are grouped
   * under progressive separators (Past due / Today / … ); otherwise it's a plain
   * note stream. One flattened stream so the template avoids duplicating the row.
   */
  readonly listRows = computed<ListRow[]>(() => {
    const notes = this.displayNotes();
    if (this.mode() !== 'list' || this.sort() !== 'dueDate') {
      return notes.map((n) => ({ kind: 'note', key: n.id, note: n }));
    }
    const rows: ListRow[] = [];
    for (const g of dueGroups(notes)) {
      rows.push({ kind: 'sep', key: `sep-${g.key}`, label: g.label });
      for (const n of g.notes) rows.push({ kind: 'note', key: n.id, note: n });
    }
    return rows;
  });

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
  readonly dueState = dueState;
  readonly timeAgo = timeAgo;
  readonly tagColor = tagColor;

  /**
   * Due-date wording for chips. Honours the user's "due display" preference:
   * the absolute formatted date when set to 'absolute', else the relative
   * wording ("due tomorrow" / "overdue 2 days").
   */
  dueLabel(due: Date | string): string {
    return this.settings.dueDisplay() === 'absolute'
      ? this.settings.format(due)
      : dueLabelRelative(due);
  }

  // --- LIST-mode in-app tabs (WALL mode uses wallOpenIds + floating windows) ---
  /** localStorage key for the open-tab set (cleared on login/logout in AuthService). */
  private readonly TABS_STORAGE_KEY = 'sticky.openTabs';
  /**
   * Open tabs + the active tab id for LIST mode. Each tab caches the note's
   * summary so tabs survive a `notes()` refresh (changing filter/tag/folder no
   * longer closes open notes). All mutations go through the pure tab-reducer.
   */
  readonly tabs = signal<TabsState<NoteSummaryDto>>({ tabs: [], activeId: null });
  /** The open tabs, in strip order. */
  readonly openTabs = computed(() => this.tabs().tabs);
  /** The active tab id — kept as `openId` so existing list-pane bindings hold. */
  readonly openId = computed(() => this.tabs().activeId);
  /** Gate so the persistence effect doesn't clobber storage before the restore. */
  private readonly tabsRestored = signal(false);
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

  /** The sidenav container — used to recompute the content margin when the
   *  sidebar collapses. Material only does this on open/close, not on the CSS
   *  width change that drives our collapse. */
  private readonly sidenavContainer = viewChild(MatSidenavContainer);
  /** rAF handle for the in-progress collapse/expand margin sync. */
  private sidenavResizeRaf = 0;

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

  // single-item array so @for can recreate the editor when the open note changes
  readonly openIds = computed(() => {
    const id = this.openId();
    return id ? [id] : [];
  });
  readonly openNote = computed(() => {
    const id = this.openId();
    return id ? this.openTabs().find((n) => n.id === id) : undefined;
  });
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

  // --- empty-grid (wall) context menu ---
  private readonly gridCtxTrigger = viewChild<MatMenuTrigger>('gridCtxTrigger');
  readonly gridCtxPos = signal<{ x: number; y: number }>({ x: 0, y: 0 });
  /** Grid cell the empty-space menu acts on ("New note here"). */
  readonly gridCtxCell = signal<CellPos>({ x: 0, y: 0 });

  /** All visible notes selected? Drives the select-all toggle's icon/state. */
  readonly allSelected = computed(() => {
    const visible = this.displayNotes();
    return visible.length > 0 && visible.every((n) => this.selected().has(n.id));
  });

  /**
   * Any selected OWNED note currently pinned? Drives the single pin toggle:
   * true → the button unpins all (crossed tack); false → it pins the selection
   * (plain tack). Owner-scoped to match batchPin, which only touches owned notes.
   */
  readonly anySelectedPinned = computed(() => {
    const sel = this.selected();
    return this.notes().some((n) => sel.has(n.id) && n.isOwner && n.pinned);
  });

  /**
   * Set of local-day timestamps (start-of-day ms) that have ≥1 due note. Derived
   * from the CURRENTLY LOADED notes signal, so the calendar dots reflect the
   * active filter view rather than the whole account.
   */
  readonly dueDays = computed(() => {
    const set = new Set<number>();
    for (const n of this.displayNotes()) {
      if (n.dueDate) set.add(startOfDay(new Date(n.dueDate)).getTime());
    }
    return set;
  });

  /**
   * Marks calendar cells for CSS via dateClass. A day carrying a due note gets
   * `has-due` (the dot). When a range filter is active (both dueStart and dueEnd
   * set), every day from start..end inclusive also gets `in-range`, and the two
   * ends additionally get `range-start` / `range-end` so the band can be capped.
   */
  readonly dueDateClass: MatCalendarCellClassFunction<Date> = (date, view) => {
    if (view !== 'month') return '';
    const day = startOfDay(date);
    const classes: string[] = [];
    if (this.dueDays().has(day.getTime())) classes.push('has-due');

    const start = this.dueStart();
    const end = this.dueEnd();
    if (start && end) {
      const lo = startOfDay(start);
      const hi = startOfDay(end);
      if (day.getTime() >= lo.getTime() && day.getTime() <= hi.getTime()) {
        classes.push('in-range');
        if (sameDay(day, lo)) classes.push('range-start');
        if (sameDay(day, hi)) classes.push('range-end');
      }
    }
    return classes;
  };

  /** True when a due-date day/range filter is active (chip + calendar select). */
  readonly hasDueFilter = computed(() => this.dueStart() !== null);

  /** Human label for the active due filter chip ("Due Jun 15" or a range). */
  readonly dueFilterLabel = computed(() => {
    const start = this.dueStart();
    const end = this.dueEnd();
    if (!start) return '';
    const fmt = (d: Date) => this.settings.format(d);
    return end && !sameDay(start, end)
      ? `Due ${fmt(start)} – ${fmt(end)}`
      : `Due ${fmt(start)}`;
  });
  /** Whether the open note's content may be edited by the current user. */
  readonly canEditOpen = computed(() => {
    const n = this.openNote();
    return !!n && n.canEdit && !n.deletedAt;
  });
  /** List-view drag-reorder only makes sense on the explicit order, unfiltered.
   *  The pinned-only client filter narrows the displayed rows, so CDK drag
   *  indices wouldn't line up with the full `notes` array — gate it off too. */
  readonly canReorder = computed(
    () =>
      !this.inTrash() &&
      this.sort() === 'position' &&
      !this.q() &&
      !this.activeTag() &&
      !this.pinnedOnly(),
  );

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

    // Persist the open-tab set (ids + active id, no content) on every change,
    // but only once the initial restore has run — otherwise the first effect
    // pass would overwrite storage with the empty starting state.
    effect(() => {
      const snapshot = serializeTabs(this.tabs());
      if (!this.tabsRestored()) return;
      this.persistTabs(snapshot);
    });

    // Collapsing the sidebar only animates its CSS width; MatSidenavContainer
    // won't re-measure the open drawer on its own, so the content pane keeps a
    // stale margin (a gap when collapsing, overlap when expanding). Re-measure
    // each frame of the width transition so the content tracks the rail.
    effect(() => {
      this.sidenav.collapsed(); // re-run whenever the collapse state flips
      this.syncSidenavMargins();
    });
  }

  /**
   * Drives MatSidenavContainer.updateContentMargins() across the sidebar's
   * width transition. updateContentMargins() reads the drawer's live
   * offsetWidth, so polling it per frame for the transition's duration keeps the
   * content margin in lockstep with the animating rail.
   */
  private syncSidenavMargins(): void {
    const container = this.sidenavContainer();
    if (!container) return; // not yet rendered (first effect pass)
    cancelAnimationFrame(this.sidenavResizeRaf);
    // Matches the 200ms `transition: width` on .sidebar, with a small buffer.
    const deadline = performance.now() + 240;
    const step = () => {
      container.updateContentMargins();
      if (performance.now() < deadline) {
        this.sidenavResizeRaf = requestAnimationFrame(step);
      }
    };
    this.sidenavResizeRaf = requestAnimationFrame(step);
  }

  ngOnInit(): void {
    this.refresh();
    this.refreshTags();
    this.refreshFolders();
    this.refreshBadge();

    // Restore persisted tabs first, THEN wire the deep link so `/note/:id` opens
    // as the active tab on top of whatever was restored (and isn't clobbered by
    // the async restore landing afterwards).
    this.restoreTabsFromStorage(() => {
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
    });
  }

  /** Writes the open-tab set to localStorage (best-effort). */
  private persistTabs(stored: StoredTabs): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(this.TABS_STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // storage full / disabled — tabs simply won't survive reload
    }
  }

  /**
   * Rebuilds the open tabs from localStorage on load: validates each id with a
   * GET (dropping ones that 404 / are inaccessible), primes the editor store so
   * it skips a second fetch, then opens the gate so future changes persist.
   * Calls `done` once finished (immediately when nothing is stored).
   */
  private restoreTabsFromStorage(done: () => void): void {
    const raw =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem(this.TABS_STORAGE_KEY)
        : null;
    const stored = parseStoredTabs(raw);
    if (!stored || stored.ids.length === 0) {
      this.tabsRestored.set(true);
      done();
      return;
    }
    forkJoin(
      stored.ids.map((id) =>
        this.api.get(id).pipe(catchError(() => of(null))),
      ),
    ).subscribe((results) => {
      const fetched = results.filter((n): n is NoteDto => n !== null);
      fetched.forEach((n) => this.openStore.prime(n));
      // NoteDto carries every NoteSummaryDto field (the deep-link path relies on
      // this too), so the fetched notes seed the tab cache directly.
      this.tabs.set(restoreTabs(stored, fetched as NoteSummaryDto[]));
      this.tabsRestored.set(true);
      done();
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
        // A deep-linked note opens as its own focused tab (don't clobber a tab).
        this.open(id, note, 'newFocus');
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
    this.closeAllWallWindows();
    this.clearSelection();
    this.sidebarOpen.set(false);
    this.refresh();
  }

  clearFolderFilter(): void {
    this.activeFolderId.set(null);
    this.refresh();
  }

  /** Clears the active tag filter (lightweight, like clearFolderFilter). */
  clearTagFilter(): void {
    this.activeTag.set(null);
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

  async renameFolder(folder: { id: string; name: string }): Promise<void> {
    const name = await openNameDialog(this.dialog, {
      title: 'Rename folder',
      label: 'Folder name',
      initial: folder.name,
      confirmText: 'Rename',
    });
    if (!name || name === folder.name) return;
    this.foldersApi.rename(folder.id, name).subscribe(() => this.refreshFolders());
  }

  /**
   * Folder-tree "Move to…": reparent a folder to the root, another folder, or a
   * subfolder. The picker hides the folder's own subtree; the backend also
   * rejects cycles (400).
   */
  moveFolder(folder: FolderNode): void {
    openMoveToFolder(this.dialog, {
      folders: this.folders(),
      currentFolderId: folder.parentId,
      title: `Move “${folder.name}”`,
      excludeId: folder.id,
    }).subscribe((target) => {
      if (target === undefined || target === folder.parentId) return; // cancel / no-op
      this.foldersApi.move(folder.id, target).subscribe({
        next: () => this.refreshFolders(),
        error: (err: { status?: number }) =>
          this.snack.open(
            err?.status === 400
              ? 'Cannot move a folder into its own subfolder.'
              : 'Could not move the folder.',
            'Dismiss',
            { duration: 4000 },
          ),
      });
    });
  }

  deleteFolder(folder: FolderNode): void {
    this.confirmDelete({
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
      this.bindNoteToFolder(note.id, result);
    });
  }

  /**
   * Files (folderId set) or unfiles (null) a note, optionally repositioning it
   * on the wall (used when dragging a note out of a folder onto the grid). Patch
   * is optimistic; folder counts + any open folder windows are refreshed. Shared
   * by the move dialog and the wall drag-and-drop.
   */
  private bindNoteToFolder(
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
   * Selection toolbar "Pin"/"Unpin": sets `pinned` on every selected OWNED note
   * in one batch. Mirrors single `togglePin` (owner-safe, optimistic local patch
   * + patchTabs for any open tab) then `refresh()` to re-sort the list/wall.
   */
  batchPin(pinned: boolean): void {
    const owned = [...this.selected()].filter(
      (id) => this.notes().find((n) => n.id === id)?.isOwner,
    );
    if (owned.length === 0) return;
    forkJoin(
      owned.map((id) => this.api.updateMeta(id, { pinned })),
    ).subscribe(() => {
      const ids = new Set(owned);
      this.notes.update((list) =>
        list.map((n) => (ids.has(n.id) ? { ...n, pinned } : n)),
      );
      owned.forEach((id) => this.patchTabs(id, { pinned }));
      this.refresh();
    });
  }

  /**
   * Selection toolbar "Move to folder…": files every selected OWNED note into a
   * picked folder in one batch. Mirrors single `moveToFolder` — a note that no
   * longer matches an active folder filter drops out of the list — then refreshes
   * the folder counts and clears the selection.
   */
  batchMoveToFolder(): void {
    const owned = [...this.selected()].filter(
      (id) => this.notes().find((n) => n.id === id)?.isOwner,
    );
    if (owned.length === 0) return;
    openMoveToFolder(this.dialog, {
      folders: this.folders(),
      currentFolderId: null,
    }).subscribe((result) => {
      if (result === undefined) return; // cancelled
      forkJoin(
        owned.map((id) => this.api.updateMeta(id, { folderId: result })),
      ).subscribe(() => {
        const moved = new Set(owned);
        // When a folder filter is active and the target differs, the moved notes
        // no longer match the view, so drop them; otherwise patch their folderId.
        const activeFolderId = this.activeFolderId();
        const dropsOut = !!activeFolderId && result !== activeFolderId;
        this.notes.update((list) =>
          dropsOut
            ? list.filter((n) => !moved.has(n.id))
            : list.map((n) =>
                moved.has(n.id) ? { ...n, folderId: result } : n,
              ),
        );
        this.refreshFolders(); // note counts changed
        this.clearSelection();
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

  /** Flips the client-side "pinned only" display filter (list + wall). */
  togglePinnedFilter(): void {
    this.pinnedOnly.update((v) => !v);
  }

  setView(mode: 'list' | 'wall'): void {
    // Close any open editor / windows so nothing reappears (as a pane or a
    // floating window) in the other view after switching.
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
    this.minimized.set(new Set());
    this.bubblesFanned.set(false);
    this.reorganizing.set(false);
    // Reset the pan so a stale offset doesn't leave the new view scrolled away.
    this.panOffset.set({ x: 0, y: 0 });
  }

  /**
   * List view: persists the new explicit order after a row drag. Pinned notes
   * always sort first, so a pinned note dragged into the non-pinned region snaps
   * back above all of them on release (pinnedFirst is a stable partition that
   * keeps the dropped order within each group).
   */
  drop(event: CdkDragDrop<NoteSummaryDto[]>): void {
    if (event.previousIndex === event.currentIndex) return;
    const reordered = [...this.notes()];
    moveItemInArray(reordered, event.previousIndex, event.currentIndex);
    const ordered = pinnedFirst(reordered);
    this.notes.set(ordered); // optimistic
    this.api.reorder(ordered.map((n) => n.id)).subscribe({
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
  private firstFreeCell(h = 3): CellPos {
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

  /** Rename a folder from its floating window (double-click the title bar). */
  renameFolderById(id: string): void {
    const f = this.folders().find((x) => x.id === id);
    if (f) this.renameFolder(f);
  }

  create(): void {
    this.api.create('Untitled note').subscribe((n) => {
      let created = n;
      // In WALL mode drop the new note into the first free cell so it lands in
      // empty space (and persists there) rather than just flowing top-left.
      if (this.mode() === 'wall' && !this.inTrash()) {
        const cell = this.firstFreeCell();
        created = { ...n, wallX: cell.x, wallY: cell.y };
        this.api.updateMeta(n.id, { wallX: cell.x, wallY: cell.y }).subscribe();
      }
      // New notes sort first among NON-pinned notes (lowest position), but must
      // still fall below any pinned ones — pinnedFirst floats pinned above the
      // freshly-prepended note, mirroring the backend's pinned-first ordering.
      this.notes.update((list) => pinnedFirst([created, ...list]));
      // A brand-new note opens in its own focused tab (LIST) / window (WALL).
      this.open(created.id, undefined, 'newFocus');
      // Make the new note linkable via [[…]] right away.
      this.notesIndex.refresh();
      // On mobile the sidebar is an over-mode drawer covering the editor; close
      // it after creating so the new note is immediately visible.
      if (this.isHandset()) this.sidebarOpen.set(false);
    });
  }

  /** Creates a note at a specific wall cell (from the empty-grid menu). */
  createAt(cell: CellPos): void {
    this.api.create('Untitled note').subscribe((n) => {
      const pos = this.nudgeDownToFree(cell.x, cell.y, 3);
      const created = { ...n, wallX: pos.x, wallY: pos.y };
      this.api.updateMeta(n.id, { wallX: pos.x, wallY: pos.y }).subscribe();
      this.notes.update((list) => pinnedFirst([created, ...list]));
      this.open(created.id, undefined, 'newFocus');
      this.notesIndex.refresh();
    });
  }

  /**
   * Opens a note in the right-hand pane. The single content fetch is owned by
   * OpenNotesStore (the editor mounts and calls store.open too — the store's
   * in-flight guard dedupes them into one GET). The linked-note pills then read
   * straight off that store entry via `openNoteLinks`. The deep-link path
   * already has the NoteDto and primes the store with it to skip the fetch.
   */
  open(
    id: string,
    prefetched?: NoteDto,
    mode: 'reuse' | 'newFocus' | 'background' = 'reuse',
  ): void {
    if (prefetched) {
      this.openStore.prime(prefetched);
    } else {
      this.openStore.open(id);
    }
    const note = this.notes().find((n) => n.id === id) ?? prefetched;
    // WALL mode spawns a floating, non-modal window (multiple can be open at
    // once); LIST mode drives the tab strip:
    //  - 'reuse'      → plain click: navigate the focused tab (no new tab);
    //  - 'newFocus'   → create/duplicate/deep-link: a new, focused tab;
    //  - 'background' → Ctrl/middle-click: a new tab without stealing focus.
    if (this.mode() === 'wall' && !this.inTrash()) {
      this.openWallWindow(id);
    } else if (note) {
      this.tabs.update((s) =>
        mode === 'reuse'
          ? openInActiveTabState(s, note)
          : openTabState(s, note, { background: mode === 'background' }),
      );
    }
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
   * Click on a note row's title anchor (LIST mode). Always handled in-app — the
   * browser never opens an OS tab. A plain click navigates the currently focused
   * tab to this note (no new tab); Ctrl/Cmd/Shift/Alt-click opens it in a new
   * background tab.
   */
  rowOpen(id: string, event: MouseEvent): void {
    event.preventDefault();
    this.open(id, undefined, opensInBackground(event) ? 'background' : 'reuse');
  }

  /** Middle-click a row → open in a background tab (suppress the browser new-tab). */
  rowAux(id: string, event: MouseEvent): void {
    if (event.button !== 1) return;
    event.preventDefault();
    this.open(id, undefined, 'background');
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
    event.stopPropagation(); // don't also trigger the empty-grid menu
    this.ctxNote.set(note);
    this.ctxPos.set({ x: event.clientX, y: event.clientY });
    const trigger = this.ctxTrigger();
    if (!trigger) return;
    // Re-open at the new position if a previous menu is still showing.
    trigger.closeMenu();
    trigger.openMenu();
  }

  /**
   * Right-click on EMPTY wall space → a grid context menu (new note here / new
   * folder). Ignored when the click lands on a card or window (those have their
   * own menu). The clicked point is converted to a grid cell so "New note here"
   * drops the note where the user clicked.
   */
  openGridContextMenu(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (target.closest('.card, .folder-card, .note-window')) return;
    event.preventDefault();
    const el = this.wallEl()?.nativeElement;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cols = Math.max(WALL_CARD_CELLS, this.wallCols());
    let x = Math.floor((event.clientX - rect.left) / WALL_CELL);
    let y = Math.floor((event.clientY - rect.top) / WALL_CELL);
    x = Math.max(0, Math.min(x, cols - WALL_CARD_CELLS));
    y = Math.max(0, y);
    this.gridCtxCell.set({ x, y });
    this.gridCtxPos.set({ x: event.clientX, y: event.clientY });
    const trigger = this.gridCtxTrigger();
    if (!trigger) return;
    trigger.closeMenu();
    trigger.openMenu();
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
      this.patchTabs(id, { title: updated.title });
      // Keep the [[wikilink]] autocomplete/resolution index in sync with the new
      // title so the renamed note is immediately linkable from other notes.
      this.notesIndex.refresh();
    });
  }

  togglePin(note: NoteSummaryDto, event?: Event): void {
    event?.stopPropagation();
    if (!note.isOwner) return;
    this.api.updateMeta(note.id, { pinned: !note.pinned }).subscribe(() => {
      this.patchTabs(note.id, { pinned: !note.pinned });
      this.refresh();
    });
  }

  duplicate(id: string): void {
    this.api.duplicate(id).subscribe((copy) => {
      // The copy is always owned by me; jump to it where it's visible.
      if (this.inTrash() || this.filter() === 'shared') this.setFilter('mine');
      else this.refresh();
      // The copy opens in its own focused tab (LIST) / window (WALL).
      this.open(copy.id, undefined, 'newFocus');
      this.refreshTags();
      this.notesIndex.refresh();
    });
  }

  // --- LIST tab strip actions ---

  /** Closes the active tab (pane-head Close button). */
  closeActiveTab(): void {
    const id = this.openId();
    if (id) this.closeTab(id);
  }

  /** Flushes pending autosave, removes the tab, and focuses its neighbor. */
  closeTab(id: string): void {
    this.openStore.flush(id);
    this.tabs.update((s) => closeTabState(s, id));
    // Pick up any title/preview edits the closed note made, in the row list.
    this.refresh();
    this.refreshTags();
  }

  /** Middle-click a tab closes it. */
  closeTabAux(id: string, event: MouseEvent): void {
    if (event.button !== 1) return;
    event.preventDefault();
    this.closeTab(id);
  }

  /** Click a tab to focus it. */
  activateTab(id: string): void {
    this.tabs.update((s) => activateTabState(s, id));
  }

  /** Drag-reorder of the tab strip. */
  dropTab(event: CdkDragDrop<NoteSummaryDto[]>): void {
    if (event.previousIndex === event.currentIndex) return;
    this.tabs.update((s) =>
      reorderTabsState(s, event.previousIndex, event.currentIndex),
    );
  }

  /** Keeps an open tab's cached summary live after a metadata edit. */
  private patchTabs(id: string, partial: Partial<NoteSummaryDto>): void {
    this.tabs.update((s) => patchTabState(s, id, partial));
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
    this.selected.set(new Set(this.displayNotes().map((n) => n.id)));
  }

  // --- delete / trash lifecycle ---

  /**
   * Opens a confirmation dialog unless the "Confirm before deleting" preference
   * is off, in which case it resolves to `true` immediately. Used for the
   * reversible (trash) deletes of notes and folders; permanent deletes always
   * confirm regardless of the preference.
   */
  private confirmDelete(data: ConfirmData) {
    if (!this.settings.confirmOnDelete()) return of(true);
    return openConfirm(this.dialog, data);
  }

  deleteOne(id: string): void {
    this.confirmDelete({
      title: 'Move to trash?',
      message:
        'This note moves to the trash. You can restore it from there until the ' +
        'trash is emptied.',
      confirmLabel: 'Delete note',
      destructive: true,
    }).subscribe((ok) => {
      if (!ok) return;
      this.api.remove(id).subscribe(() => this.afterDelete([id]));
    });
  }

  batchDelete(): void {
    const ids = [...this.selected()];
    if (ids.length === 0) return;
    this.confirmDelete({
      title: `Move ${ids.length} note(s) to trash?`,
      message:
        'The selected notes move to the trash. You can restore them from there ' +
        'until the trash is emptied.',
      confirmLabel: 'Delete notes',
      destructive: true,
    }).subscribe((ok) => {
      if (!ok) return;
      this.api
        .batchDelete(ids)
        .subscribe((res) => this.afterDelete(res.deleted));
    });
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
    // Drop any LIST tabs for deleted notes (no flush — they're being removed).
    for (const id of ids) this.tabs.update((s) => closeTabState(s, id));
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
      this.patchTabs(noteId, { tags: res.tags });
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
      this.patchTabs(noteId, { dueDate: updated.dueDate });
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
