# Feature Backlog Implementation Plan (2026-06-12)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the entire "Feature backlog" section of TODO.md (28 open items) — editor formatting, export, tags UX, due dates + calendar, authorship, deep links + context menu, folders, wikilinks + graph view, wall-grid rework, and admin password tooling.

**Architecture:** NestJS (`backend/`, Prisma + Postgres, global JWT cookie auth + CSRF, `/api` prefix) + Angular 21 standalone components with signals (`frontend/`, Angular Material 21, TipTap 3.24 via ngx-tiptap) + shared DTO types (`shared/src`). Each work package (WP) is independently shippable, lands as one or more commits on `feature/backlog-2026-06-12`, and is implemented by a fresh subagent with TDD where logic is testable.

**Tech stack additions (all npm-bundled, self-hosted, no CDN):**
- `@tiptap/extension-code-block-lowlight` + `lowlight` (+ highlight.js grammars it bundles) — syntax highlighting
- `@tiptap/extension-mathematics` + `katex` — LaTeX math (KaTeX CSS + fonts bundled from node_modules)
- `@tiptap/extension-text-style` (TextStyle, Color, FontSize) — color + size controls

**Ground rules for every task:**
- Work from `w:\stickynotes` on branch `feature/backlog-2026-06-12`. Windows / PowerShell 5.1 (no `&&`; use `;`).
- `git add` only the files you touched — `TODO.md` is dirty in the worktree and must NOT be committed.
- Follow existing patterns: standalone components, `inject()`, signals, Material modules, class-validator DTOs, `@stickynotes/shared` types consumed with `import type`.
- Keep the link URL-scheme allowlist (`frontend/src/app/editor/safe-url.ts`) intact for anything that creates links.
- Offline constraint: nothing may load from a CDN at runtime.
- Tests: backend unit `npm test --workspace backend`; backend e2e `npm run test:e2e --workspace backend` (needs dev DB: `npm run dev:db`); frontend `npm test --workspace frontend` (vitest, single run). Run the suites relevant to what you changed plus a full backend unit + frontend pass before committing.
- DB migrations: from `backend/`, `npx prisma migrate dev --name <name>` (dev DB must be up). Never edit an existing migration.
- Builds must stay green: `npm run build:backend` and `npm run build:frontend` when you touched that side.

---

## WP1 — Admin: temp-password generator + admin password reset

**Backlog items:** "Temp password can be auto-generated in the create-user form", "Reset password for an existing user".

**Files:**
- Modify: `backend/src/users/users.controller.ts`, `backend/src/users/users.service.ts`
- Create: `backend/src/users/dto/reset-password.dto.ts`
- Modify: `backend/test/access-matrix.e2e-spec.ts` or create `backend/test/admin-users.e2e-spec.ts`
- Modify: `frontend/src/app/admin/admin-users.ts`, `admin-users.html`, `admin-users.scss`, `frontend/src/app/core/users.api.ts`
- Create: `frontend/src/app/admin/password-gen.ts` + `password-gen.spec.ts`

**Tasks:**
- [ ] Backend: `POST /api/users/:id/password` (admin-only via `@Roles('ADMIN')`), body `{ password: string }` (class-validator: string, minLength 8, maxLength 200). Service method `resetPassword(id, password)`: 404 if user missing, argon2-hash, update `passwordHash`. Write e2e tests first: admin can reset another user's password and the user can log in with the new one + old one fails; non-admin gets 403; unknown id 404; short password 400.
- [ ] Frontend `UsersApi`: add `resetPassword(id: string, password: string)`.
- [ ] Frontend `password-gen.ts`: `export function generateTempPassword(length = 16): string` using `crypto.getRandomValues`, alphabet without ambiguous chars (no `0OIl1`), guaranteed ≥1 digit. Vitest spec: length, alphabet, uniqueness across calls, contains digit.
- [ ] Admin UI: in the create-user form add a "Generate" button that fills the password field with `generateTempPassword()` and reveals it (text input) so the admin can copy it. In each user row add a "Reset password" action opening a small dialog: password field + Generate button + confirm; calls `resetPassword`; show the password with a copy-to-clipboard button after success (snackbar on copy).
- [ ] Run backend e2e + frontend tests + both builds. Commit: `feat(admin): temp password generator and admin password reset`.

**Acceptance:** Admin can generate a temp password during user creation and can set/generate a new password for an existing user from the admin panel; permissions enforced server-side.

---

## WP2 — Editor formatting: code blocks, quotes, markdown links, color, size, LaTeX

**Backlog items:** framed code blocks + syntax highlighting; blockquote vertical-line styling; `[title](url)` typed link rule; text color control; text size control; LaTeX math (self-hosted).

**Files:**
- Modify: `frontend/package.json` (add deps listed in header), `frontend/src/app/editor/extensions.ts`, `note-editor.ts`, `note-editor.html`, `note-editor.scss`, `frontend/src/styles.scss` (or wherever global editor/KaTeX styles belong), `frontend/angular.json` only if needed for KaTeX css include.
- Create: `frontend/src/app/editor/markdown-link-rule.ts` + spec (if implemented as a custom paste/input rule).

**Tasks:**
- [ ] Install deps: `@tiptap/extension-code-block-lowlight`, `lowlight`, `@tiptap/extension-mathematics`, `katex`, `@tiptap/extension-text-style` (check what TipTap 3.24 already bundles — StarterKit ships base CodeBlock; disable it there when adding CodeBlockLowlight).
- [ ] Code blocks: replace StarterKit code block with `CodeBlockLowlight` configured with `lowlight` (`createLowlight(common)` — the common grammar set, all bundled). SCSS: framed block — slightly different background (`color-mix` with Material surface tokens so dark theme works), 1px border, border-radius, monospace, padding; `.hljs-*` token colors for BOTH light and dark themes (define under `:root` and `html.dark`).
- [ ] Blockquote: SCSS vertical line emphasis — 3-4px solid left border in the Material primary color, padding-left, slightly muted text. (Blockquote parsing via `>` already works in StarterKit.)
- [ ] Markdown link typing: input rule so typing `[text](url)` converts to a link with label `text` — URL must pass `isSafeLinkUrl` from `safe-url.ts`, else leave plain text. Cover with a vitest spec (pure function or rule handler tested through the editor or factored regex; the regex + URL gate must be unit tested).
- [ ] Text color: add `TextStyle` + `Color`. Toolbar: palette button (mat-menu) with ~10 theme-aware swatches + "Default" to unset. Persist via marks (already in doc JSON, autosave just works).
- [ ] Text size: add `FontSize` (from `@tiptap/extension-text-style`). Toolbar: size menu (Small 0.85em / Normal unset / Large 1.25em / Huge 1.5em — em-based so it scales).
- [ ] Math: add `Mathematics` extension (KaTeX). Import `katex/dist/katex.min.css` through the build (styles array or scss `@import` so fonts resolve from node_modules — verify the production build serves the fonts, no CDN). Typing `$x^2$` (inline) and `$$...$$` (block) renders math. Toolbar button optional — input-rule based entry is acceptable per backlog.
- [ ] Verify export-to-HTML still produces sensible output for the new nodes (code block keeps text; math falls back to source text is acceptable — note it in the commit message if so).
- [ ] Run frontend tests + build. Commit: `feat(editor): code highlight, quote styling, md links, color, size, math`.

**Acceptance:** Typing ``` fences gives a framed, highlighted code block; `>` quotes show a vertical bar; `[t](url)` auto-links (safe schemes only); toolbar offers color + size; `$...$` renders KaTeX offline.

---

## WP3 — Editor: toggleable TOC sidebar + export dropdown with Markdown export

**Backlog items:** "Toggleable Table of Contents in the sidebar of the note editor", "Notes can be exported to Markdown format", "Export button is a dropdown menu (markdown default; options HTML, markdown)".

**Files:**
- Create: `frontend/src/app/editor/markdown-export.ts` + `markdown-export.spec.ts`
- Create: `frontend/src/app/editor/toc.ts` + `toc.spec.ts` (heading extraction)
- Modify: `frontend/src/app/editor/note-editor.ts`, `note-editor.html`, `note-editor.scss`

**Tasks:**
- [ ] `markdown-export.ts`: `export function docToMarkdown(doc: ProseMirrorDoc): string`. Pure function over the JSON doc (no editor instance). Cover every node/mark this app can produce: paragraph, heading 1-6, bulletList/orderedList (nested), taskList/taskItem (`- [ ]` / `- [x]`), codeBlock with language fence, blockquote (`> ` prefix incl. nesting), image (`![](src)`), hardBreak (two-space newline), horizontalRule (`---`), text marks: bold `**`, italic `*`, strike `~~`, code `` ` ``, underline → `<u>…</u>`, link `[text](url)`, textStyle color/size → drop silently (markdown has no equivalent), math → `$src$` / `$$src$$`. TDD: write the spec first with one focused test per node/mark + a kitchen-sink doc test.
- [ ] Export dropdown: replace the existing export button with a split control — primary click exports Markdown (`<title>.md`, same filename sanitization as the HTML path); the arrow opens a mat-menu with "Markdown (.md)" and "HTML (.html)". Reuse the existing HTML export as-is.
- [ ] TOC: `toc.ts` `export function extractToc(doc: ProseMirrorDoc): { level: number; text: string; pos: number }[]` (walk the doc, accumulate positions). Vitest spec. In the editor: a toolbar toggle button shows/hides a slim sidebar panel inside the editor pane listing headings (indented by level); clicking one scrolls/sets selection to that heading (`editor.commands.setTextSelection(pos)` + `scrollIntoView`). TOC refreshes on doc updates (recompute on the editor's update event, debounced lightly). Toggle state persisted in localStorage.
- [ ] Run frontend tests + build. Commit: `feat(editor): markdown export with format dropdown and TOC panel`.

**Acceptance:** Export defaults to .md and offers .html in a dropdown; markdown output round-trips all supported content; TOC panel toggles, lists headings, click scrolls to heading.

---

## WP4 — Small UX: tag autocomplete + collapsible left menu

**Backlog items:** "Tags should autocomplete from the list of tags in the database", "Make the left menu collapsible and expandable (desktop)".

**Files:**
- Modify: wherever the tag chip input lives (Manager or NoteEditor — locate `addTagFromChip`), plus `frontend/src/app/manager/manager.ts/html/scss`.

**Tasks:**
- [ ] Tag autocomplete: attach `mat-autocomplete` to the existing chip input. Options = user's tags from `TagsApi.list()` minus tags already on the note, filtered case-insensitively by the current input text. Selecting an option adds the tag (same path as typing it); free text still works (it's create-on-use server-side). Refresh the option list when tags change (after save / on open).
- [ ] Collapsible sidebar (desktop only — mobile keeps the over-mode drawer): a chevron toggle in the sidebar header collapses the sidenav to a slim icon rail (~56px: filter icons, tags hidden, calendar hidden) or fully hides with an expand handle — pick whichever fits the existing `mat-sidenav` markup with less surgery; persist collapsed state in localStorage (new field on an existing store or local signal + effect).
- [ ] Run frontend tests + build. Commit: `feat(ui): tag autocomplete and collapsible sidebar`.

**Acceptance:** Typing in the tag input suggests existing tags; sidebar collapses/expands on desktop and remembers the choice.

---

## WP5 — Due dates + sidebar calendar

**Backlog items:** "Associate a date to a note (due date): emphasized when nearing, crossed out when passed; filterable by min/max date range", "Calendar in the left menu only: notes with a date appear on it; clicking a date filters to that date; Shift+Click filters by range".

**Contract:**
- Prisma: `Note.dueDate DateTime?` + `@@index([ownerId, dueDate])`. Migration `add_due_date`.
- `UpdateNoteDto`: optional `dueDate?: string | null` (ISO 8601, validate with `@IsISO8601()`, nullable to clear).
- `GET /api/notes`: new optional query params `dueAfter`, `dueBefore` (ISO dates, inclusive day bounds) — combine with existing filter/search/tag params.
- Shared DTOs: `NoteSummaryDto.dueDate: string | null`.
- "Nearing" = due within the next 48h (and not passed). "Passed" = dueDate < now → title rendered struck-through. Both list and wall cards.

**Files:** `backend/prisma/schema.prisma` + migration, `backend/src/notes/*` (dto, service, controller), `shared/src/dto.ts`, `frontend/src/app/core/notes.api.ts`, `frontend/src/app/manager/*`, the note editor metadata area (due-date picker), e2e spec.

**Tasks:**
- [ ] Migration + DTO + service filtering (e2e tests first: set/clear dueDate via PATCH meta; list filtering by dueAfter/dueBefore inclusive bounds; combination with `filter=mine`).
- [ ] Note UI: due-date control in the open note's metadata area (next to tags): mat-datepicker, clearable. Saving goes through `updateMeta`.
- [ ] List/wall emphasis: due date shown as a small chip on rows/cards (relative wording, e.g. "due tomorrow" via a tiny pure helper + vitest spec); nearing → warn/amber styling; passed → note title struck through + muted chip.
- [ ] Sidebar calendar (desktop sidebar only): inline `<mat-calendar>` under the filters. `dateClass` marks days having ≥1 viewable note due (data from the already-loaded notes list, or a lightweight `GET /api/notes?fields=dueDate` reuse — prefer deriving from the current list response of filter "all" without search; document the choice). Click a day → set dueAfter=dueBefore=that day; Shift+Click another day → range [min,max]; clicking the active selection again clears the date filter. An active date filter is visible as a removable chip above the list.
- [ ] Run backend unit+e2e, frontend tests, builds. Commit: `feat(notes): due dates with calendar filter`.

**Acceptance:** Notes can carry a due date; nearing/passed states are visually distinct; min/max range filtering works from API and from the sidebar calendar (click + Shift+Click).

---

## WP6 — Authorship: author, last editor, last edit date

**Backlog item:** "Show the author of each note, plus last editor and last edit date (author = ownerId; last editor needs lastEditedById)".

**Contract:**
- Prisma: `Note.lastEditedById String?` + relation `lastEditedBy User? @relation("LastEditor", fields: [lastEditedById], references: [id], onDelete: SetNull)` (+ back-relation on User). Migration `add_last_edited_by`.
- Set `lastEditedById = userId` in `updateContent`, `updateMeta`, and `setNoteTags` mutations (the acting user; today only owners edit, but write it generically).
- Shared DTOs: `NoteSummaryDto` gains `ownerName: string`, `lastEditedByName: string | null`. Last edit date = existing `contentUpdatedAt`/`updatedAt` (no new column).

**Files:** schema + migration, `backend/src/notes/notes.service.ts` (include relations in list/get selects, map names), `shared/src/dto.ts`, manager list row + wall card + editor header UI, e2e spec additions.

**Tasks:**
- [ ] Migration, service writes, DTO mapping (e2e: after a content PATCH by owner, GET returns `lastEditedByName` = owner displayName; new note has null).
- [ ] UI: list rows get a muted metadata line "by {ownerName} · edited {relative date} by {lastEditedByName}" (omit editor segment when null; reuse/extract the existing relative-date helper if one exists, else add one with a spec). Editor header shows the same line for the open note. Wall card tooltip carries it.
- [ ] Run suites + builds. Commit: `feat(notes): author and last-editor attribution`.

**Acceptance:** Every note displays author, last editor, and last edit date in list and editor.

---

## WP7 — List navigation: deep link, Ctrl+Click tabs, context menu, select-all

**Backlog items:** "Open multiple notes in multiple tabs using Ctrl+Click (needs `/note/:id`) in List mode", "Contextual menu using right click on a note", "Button in the top bar to select all notes (current view)".

**Contract:**
- New route `note/:id` → the Manager (or a slim wrapper) opening exactly that note's editor full-pane; guarded by `authGuard`; unknown/inaccessible id → snackbar + redirect to ``.
- List mode: Ctrl+Click (and middle-click) on a note row opens `/note/:id` in a new browser tab (render rows as real `<a href>` so the browser handles it natively; plain click still does SPA open via `routerLink`/click handler with `preventDefault` for the non-modified case).
- Right-click on a note row/card opens a Material menu at the cursor (CDK Overlay or the mat-menu trigger-position trick): Open, Open in new tab, Pin/Unpin, Share…, Duplicate, Move to trash (Restore/Delete forever when in trash). Tag/folder entries arrive in later WPs — design the menu so items are easy to extend.
- Top bar: "Select all" button toggling selection of all currently visible notes (the existing multi-select/batch-delete machinery — find it via `batchDelete` usage; if list lacks a selection model, add checkbox selection consistent with existing batch-delete UX).

**Files:** `frontend/src/app/app.routes.ts`, `frontend/src/app/manager/*`, possibly `frontend/src/app/core/notes.api.ts` (no backend changes expected — GET /api/notes/:id exists).

**Tasks:**
- [ ] Route + open-by-id flow (handle direct load: fetch note, open editor, 404 path).
- [ ] Ctrl/middle-click new-tab behavior in list mode.
- [ ] Context menu component + wiring on rows (list) and cards (wall) with the actions above reusing existing handlers (pin, share dialog, duplicate, trash).
- [ ] Select-all button in the top bar acting on the current filtered view; works with existing batch operations.
- [ ] Run frontend tests + build; backend untouched. Commit: `feat(ui): note deep links, context menu, select-all`.

**Acceptance:** `/note/:id` opens a note directly; Ctrl+Click opens new tabs; right-click menus expose note actions; select-all selects the current view.

---

## WP8 — Folders

**Backlog item:** "Folder system: a note can only be in one folder at a time; folders can have subfolders (tree)."

**Contract:**
- Prisma:
  ```prisma
  model Folder {
    id       String  @id @default(uuid())
    ownerId  String
    owner    User    @relation(fields: [ownerId], references: [id], onDelete: Cascade)
    name     String
    parentId String?
    parent   Folder? @relation("FolderTree", fields: [parentId], references: [id], onDelete: Cascade)
    children Folder[] @relation("FolderTree")
    notes    Note[]
    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt
    @@index([ownerId, parentId])
  }
  // Note: folderId String? + relation (onDelete: SetNull)
  ```
  Migration `add_folders`. Note: folder delete should *reparent* contents in service code (children + notes move to deleted folder's parent / root), not rely on cascade — implement delete as a transaction.
- New module `backend/src/folders/` (module/controller/service/dtos): `GET /api/folders` (flat list of user's folders: id, name, parentId, noteCount), `POST /api/folders` `{name, parentId?}`, `PATCH /api/folders/:id` `{name?, parentId?}` (reject moving under own descendant — cycle check; 404 cross-owner), `DELETE /api/folders/:id` (reparent then delete). Folders are strictly owner-scoped (only owner sees/uses them; shared notes don't expose the owner's folder).
- `UpdateNoteDto` gains `folderId?: string | null` — service validates the folder belongs to the acting user and the note is owned by them.
- `GET /api/notes` gains `folderId` query param (notes directly in that folder, owner only). No param → unchanged behavior (folders do NOT hide notes from All/Mine; they're an organizational filter). Search ignores folder scoping unless folderId is also passed.
- Shared DTOs: `FolderDto {id, name, parentId, noteCount}`, `NoteSummaryDto.folderId: string | null`.
- Frontend: `core/folders.api.ts`; sidebar gets a "Folders" section — recursive tree (expand/collapse, note counts, indent), entries: click = filter list to folder, hover/menu = rename / new subfolder / delete (confirm dialog explains reparenting); a "New folder" affordance at section header; active folder filter shown as removable chip. Context menu (WP7) gains "Move to folder…" → small dialog with folder tree + "No folder" option.

**Tasks:**
- [ ] Backend TDD: e2e spec `backend/test/folders.e2e-spec.ts` — CRUD, cycle rejection, cross-owner 404s, reparent-on-delete, note assignment, list filtering by folderId.
- [ ] Frontend tree UI + filtering + move-to-folder dialog + context-menu entry.
- [ ] Run all suites + builds. Commit: `feat(folders): nested folders with sidebar tree and note assignment`.

**Acceptance:** Folder tree CRUD in sidebar; a note lives in ≤1 folder; clicking a folder filters; deleting a folder loses no notes.

---

## WP9 — Note-to-note links (`[[title]]`) + graph view

**Backlog items:** wikilinks listed as distinct pills below tags; Obsidian-style graph view menu entry.

**Contract:**
- Prisma:
  ```prisma
  model NoteLink {
    fromNoteId String
    from       Note   @relation("OutgoingLinks", fields: [fromNoteId], references: [id], onDelete: Cascade)
    toNoteId   String
    to         Note   @relation("IncomingLinks", fields: [toNoteId], references: [id], onDelete: Cascade)
    createdAt  DateTime @default(now())
    @@id([fromNoteId, toNoteId])
    @@index([toNoteId])
  }
  ```
  Migration `add_note_links`.
- Extraction (backend, on every content write incl. create/duplicate/overwrite): walk the ProseMirror doc text (extend the existing `prosemirror-text` walker file with a sibling `extractWikilinks(doc): string[]` — unit-test it) for `[[...]]` patterns (trimmed inner text, ignore empty, dedupe case-insensitively). Resolution: among notes owned by the *note's owner*, exact case-insensitive title match, not trashed; ambiguity → most recently `updatedAt` wins; unresolved titles produce no row. Replace the note's outgoing `NoteLink` rows in the same transaction as the content save. Title renames do NOT rewrite source text; stored id-links keep working and pills show the target's current title (documented behavior).
- DTO: `NoteDto.links: { id: string; title: string }[]` (outgoing, resolved, target not trashed). 
- `GET /api/notes/graph` → `{ nodes: [{ id, title }], edges: [{ a, b }] }`: nodes = notes viewable by the requesting user (not trashed); edge a–b when either note links the other (dedupe; only include edges where both endpoints are in nodes).
- Frontend: pills below the tag pills in the open-note metadata area — same chip style, distinct accent color (theme-aware), click opens that note (same-pane; Ctrl+Click new tab via `/note/:id`). Graph view: sidebar menu entry → route `/graph`, component `frontend/src/app/graph/graph-view.ts`: SVG, hand-rolled force layout (no new deps; deterministic seeded positions, ~200 iterations of repulsion + spring, then static), node = circle + title text below, hover → highlight node, its edges, and neighbors (dim the rest), click → navigate to `/note/:id`. Layout math in `graph-layout.ts` as pure functions with a vitest spec (stability: no NaN, nodes spread apart, connected nodes closer than unconnected average).

**Tasks:**
- [ ] Backend: wikilink extraction unit spec → walker; link persistence in content-save transaction; `links` in NoteDto; graph endpoint; e2e spec `note-links.e2e-spec.ts` (link created on save, ambiguity rule, unresolved ignored, graph shape, permissions: graph only shows viewable notes).
- [ ] Frontend: linked-note pills; graph route/component/layout + sidebar entry.
- [ ] Run all suites + builds. Commit: `feat(links): wikilinks with linked-note pills and graph view`.

**Acceptance:** Typing `[[Exact Title]]` and saving lists that note as a distinct pill; the graph page shows nodes/edges with hover highlighting and click-through.

---

## WP10 — Wall (grid) rework

**Backlog items:** card-title transparent border; pan by dragging empty space (clamped); drag must never open the editor; folders on the grid (count badge, double-click opens a windowed grid); opening a note keeps the grid interactive; multiple notes open at once.

**Design:** In wall mode, notes open in **floating, draggable, non-modal windows** layered over the grid (the `OpenNotesStore` already supports many concurrently open notes and `NoteEditor` is presentation-agnostic — this was the intended evolution). List mode keeps the current center-pane behavior.

**Files:** `frontend/src/app/manager/manager.ts/.html/.scss`, `_wall-grid.scss`, `wall-cell.directive.ts`; create `frontend/src/app/manager/note-window.ts` (floating window shell: title bar = note title + close, cdkDrag with handle, focus brings to front via z-index stack signal, sensible default cascade positions, min/max size, content = `<app-note-editor>`); create `frontend/src/app/manager/wall-pan.ts` (pure pan-clamp math + spec).

**Tasks:**
- [ ] Title emphasis: wall card title gets a rounded semi-transparent border (theme-aware, e.g. `border: 1px solid color-mix(in srgb, currentColor 25%, transparent)`) with padding so it reads as a title plate.
- [ ] Panning: pointer-down on empty wall background + drag pans the grid (translate offset signals). Clamp: offset range limited to [-(maxNoteExtent + 1 viewport), +1 viewport] per axis relative to origin — implement clamp as pure function in `wall-pan.ts` with vitest spec (cases: no notes, notes far right/down, both axes). Cursor feedback (grab/grabbing). Drag on a card still moves the card (existing CDK behavior) — pan only initiates from empty space.
- [ ] Click-vs-drag: opening a note must be suppressed for ANY pointer movement beyond ~3px between down and up on a card (track manually; do not rely solely on CDK's click suppression — cover the under-threshold micro-drag case). Same logic guards folder double-click vs drag.
- [ ] Folders on grid: when the wall is unfiltered, render the owner's root-level folders as distinct folder cards (icon + name + note count). Double-click opens a floating window (same shell as note windows) titled with the folder name, containing a mini-grid of that folder's notes (click opens note window; no nested folder recursion required — subfolders inside the window open the same way replacing/adding a window). Close button closes.
- [ ] Note windows: in wall mode, opening a note (click card / context menu / deep link arrival in wall mode) spawns a `note-window` instead of the center pane. Multiple windows allowed (cap ~6 with a snackbar beyond); grid stays fully interactive (pan, drag, open more). Window close flushes pending autosave (store `flush()`). Editor inside windows must keep autosave/conflict UX working.
- [ ] Run frontend tests + build. Manual smoke via dev server if feasible. Commit: `feat(wall): panning, folder cards, floating multi-note windows`.

**Acceptance:** Wall pans with clamped bounds; micro-drags never open notes; folders show as cards with counts and open into windowed grids; several notes can be open in floating windows while the grid stays usable.

---

## Final phase

- [ ] Full regression: backend unit + e2e, frontend tests, both production builds.
- [ ] Dispatch final code review over `main..feature/backlog-2026-06-12`.
- [ ] Update `TODO.md` backlog checkboxes + `REVIEW.md` summary (single docs commit).
- [ ] finishing-a-development-branch: present merge/PR options.

## Execution order

WP1 → WP2 → WP3 → WP4 → WP5 → WP6 → WP7 → WP8 → WP9 → WP10 → Final.
Rationale: WP1 is isolated (pipeline shakedown); editor cluster (WP2→WP3) before Manager-heavy work; schema-touching packages (WP5, WP6, WP8, WP9) run sequentially to serialize Prisma migrations; WP10 last — it depends on folders (WP8) and reshapes the Manager.
