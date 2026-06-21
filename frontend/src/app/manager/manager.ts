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
  CdkDragHandle,
  CdkDropList,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
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
import { SidenavStore } from '../core/sidenav.store';
import { ViewModeStore } from '../core/view-mode.store';
import { SettingsStore } from '../core/settings.store';
import { provideSettingsDateAdapter } from '../core/settings-date-adapter';
import { authorLine } from './author-line';
import { tagColor } from './tag-color';
import {
  dueLabel as dueLabelRelative,
  dueState,
  endOfDay,
  sameDay,
  startOfDay,
} from './due-date';
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
import { clampPan } from './wall-pan';
import { FolderTree } from './folder-tree';
import type { FolderNode } from './folder-tree.util';
import { openMoveToFolder } from './move-to-folder-dialog';
import { pinnedFirst } from './pinned-order';
import { NoteWindow } from './note-window';
import { ManagerToolbar } from './manager-toolbar';
import { NoteContentPanel } from './note-content-panel';
import { OpenNotesStore } from '../editor/open-notes.store';
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
import { WallStore } from './wall.store';

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
    ManagerToolbar,
    NoteWindow,
    NoteContentPanel,
    ShareDialog,
    FolderTree,
    CollapsibleSection,
    RouterLink,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    WallCellDirective,
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
    MatTooltipModule,
    MatDatepickerModule,
  ],
  // The datepicker + inline calendar need a DateAdapter. The settings-aware
  // adapter wraps the native one and honors the user's week-start setting.
  providers: [provideSettingsDateAdapter(), WallStore],
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

  /** Wall + floating-window state/logic, component-provided and wired below. */
  readonly wall = inject(WallStore);

  readonly sidenav = inject(SidenavStore);
  readonly user = this.auth.user;
  readonly mode = this.viewModeStore.mode;
  readonly sort = this.viewModeStore.sort;

  readonly isHandset = toSignal(
    this.breakpoints
      .observe('(max-width: 900px)')
      .pipe(map((r) => r.matches)),
    { initialValue: false },
  );

  /** Nav-list tooltips are redundant unless the rail is collapsed to icons. */
  readonly navTooltipsOff = computed(
    () => this.isHandset() || !this.sidenav.collapsed(),
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
  readonly tagColor = tagColor;
  readonly authorLine = authorLine;

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

  private searchTimer?: ReturnType<typeof setTimeout>;

  // --- wall grid state (viewChild refs stay here; the rest lives in WallStore) ---
  /** The wall grid element — passed to the store for cell hit-testing. */
  private readonly wallEl =
    viewChild<ElementRef<HTMLDivElement>>('wallEl');
  /** Scroll/viewport container — the pan starts on its empty background. */
  private readonly wallScrollEl =
    viewChild<ElementRef<HTMLDivElement>>('wallScrollEl');
  private wallResize?: ResizeObserver;

  /** The sidenav container — used to recompute the content margin when the
   *  sidebar collapses. Material only does this on open/close, not on the CSS
   *  width change that drives our collapse. */
  private readonly sidenavContainer = viewChild(MatSidenavContainer);
  /** rAF handle for the in-progress collapse/expand margin sync. */
  private sidenavResizeRaf = 0;

  // single-item array so @for can recreate the editor when the open note changes
  readonly openIds = computed(() => {
    const id = this.openId();
    return id ? [id] : [];
  });
  readonly openNote = computed(() => {
    const id = this.openId();
    return id ? this.openTabs().find((n) => n.id === id) : undefined;
  });
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

  constructor() {
    // Wire the wall store to this component's shared data signals + refresh
    // callbacks (signals are references, so the store mutates the very same
    // ones) and the wall element it needs for grid hit-testing. Done once, up
    // front, before the effects below run.
    this.wall.connect({
      notes: this.notes,
      folders: this.folders,
      displayNotes: this.displayNotes,
      filter: this.filter,
      activeTag: this.activeTag,
      activeFolderId: this.activeFolderId,
      q: this.q,
      hasDueFilter: this.hasDueFilter,
      inTrash: this.inTrash,
      mode: this.mode,
      refresh: () => this.refresh(),
      refreshFolders: () => this.refreshFolders(),
      refreshTags: () => this.refreshTags(),
      openNote: (id, prefetched, mode) => this.open(id, prefetched, mode),
      wallEl: this.wallEl,
    });

    // (Re)attach the resize observer whenever the wall container appears.
    effect(() => {
      const el = this.wallEl()?.nativeElement;
      this.wallResize?.disconnect();
      if (!el) return;
      this.wallResize = new ResizeObserver(() => {
        this.wall.wallCols.set(Math.max(WALL_CARD_CELLS, Math.floor(el.clientWidth / WALL_CELL)));
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
    this.wall.closeAllWallWindows();
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
    this.wall.closeAllWallWindows();
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
    this.wall.closeAllWallWindows();
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
      this.wall.bindNoteToFolder(note.id, result);
    });
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
    this.wall.closeAllWallWindows();
    this.viewModeStore.set(mode);
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
        const cell = this.wall.firstFreeCell();
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
      this.wall.openWallWindow(id);
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
    this.wall.panStart = {
      px: event.clientX,
      py: event.clientY,
      ox: this.wall.panOffset().x,
      oy: this.wall.panOffset().y,
    };
    this.wall.panning.set(true);
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  onPanPointerMove(event: PointerEvent): void {
    if (!this.wall.panStart) return;
    const dx = event.clientX - this.wall.panStart.px;
    const dy = event.clientY - this.wall.panStart.py;
    const scroll = this.wallScrollEl()?.nativeElement;
    const viewport = {
      w: scroll?.clientWidth ?? 0,
      h: scroll?.clientHeight ?? 0,
    };
    this.wall.panOffset.set(
      clampPan(
        { x: this.wall.panStart.ox + dx, y: this.wall.panStart.oy + dy },
        this.wall.wallContentSize(),
        viewport,
      ),
    );
  }

  onPanPointerUp(event: PointerEvent): void {
    if (!this.wall.panStart) return;
    this.wall.panStart = null;
    this.wall.panning.set(false);
    (event.currentTarget as HTMLElement).releasePointerCapture?.(
      event.pointerId,
    );
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
    const cols = Math.max(WALL_CARD_CELLS, this.wall.wallCols());
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
    this.wall.purgeDeletedWindows(gone);
    this.selected.update((set) => {
      const next = new Set(set);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    this.refreshTags();
    this.refreshFolders(); // trashing/restoring changes folder note counts
  }

  // --- tags on the open note ---

  /** Persists a note's full tag list (emitted by the note panel) + syncs caches. */
  saveTags(noteId: string, names: string[]): void {
    this.api.setTags(noteId, names).subscribe((res) => {
      this.notes.update((list) =>
        list.map((n) => (n.id === noteId ? { ...n, tags: res.tags } : n)),
      );
      this.patchTabs(noteId, { tags: res.tags });
      this.refreshTags();
    });
  }

  // --- due date on the open note ---

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

  logout(): void {
    this.auth.logout().subscribe(() => void this.router.navigateByUrl('/login'));
  }
}
