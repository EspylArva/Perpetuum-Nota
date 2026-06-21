import type { Role, Visibility } from './enums';
import type { ProseMirrorDoc } from './prosemirror';

export interface UserDto {
  id: string;
  email: string;
  displayName: string;
  role: Role;
}

export interface UserAdminDto extends UserDto {
  isActive: boolean;
}

export interface CreateUserDto {
  email: string;
  displayName: string;
  password: string;
  role?: Role;
}

export interface UpdateUserDto {
  displayName?: string;
  role?: Role;
  isActive?: boolean;
}

export interface ChangePasswordDto {
  currentPassword: string;
  newPassword: string;
}

export interface NoteSummaryDto {
  id: string;
  title: string;
  visibility: Visibility;
  ownerId: string;
  // display name of the owner (author)
  ownerName: string;
  isOwner: boolean;
  // whether the current viewer may edit this note (owner, a PUBLIC note, or an
  // editor share grant); read-only grantees get false
  canEdit: boolean;
  // display name of the user who last edited the note; null = never edited
  lastEditedByName: string | null;
  // explicit sort order (lower = earlier); set via drag-reorder
  position: number;
  pinned: boolean;
  // wall-view grid coordinates in cell units; null = never hand-placed
  wallX: number | null;
  wallY: number | null;
  // non-null = in trash (ISO timestamp of the soft delete)
  deletedAt: string | null;
  // optional due date (ISO timestamp); null = no due date
  dueDate: string | null;
  // organizational folder id the note lives in; null = root (no folder)
  folderId: string | null;
  updatedAt: string;
  contentUpdatedAt: string;
  // short plain-text preview for cards / list rows
  preview: string;
  // owner's tag names on this note (alphabetical)
  tags: string[];
  // false only for a share grant the viewer hasn't opened yet
  seen: boolean;
}

export interface NoteDto extends NoteSummaryDto {
  content: ProseMirrorDoc;
  // Outgoing wikilinks ([[title]] in the body), resolved to live target notes.
  // Stored by id, so each carries the target's CURRENT title (renames follow).
  links: { id: string; title: string }[];
}

// Wikilink graph for the graph view. Nodes are the requester's viewable notes;
// an undirected edge joins two notes that link each other in either direction.
export interface NoteGraphDto {
  nodes: { id: string; title: string }[];
  edges: { a: string; b: string }[];
}

export interface CreateNoteDto {
  title?: string;
}

export interface UpdateNoteDto {
  title?: string;
  pinned?: boolean;
  wallX?: number;
  wallY?: number;
  // ISO timestamp to set the due date, or null to clear it
  dueDate?: string | null;
  // folder id to file the note under, or null to move it to the root
  folderId?: string | null;
}

export interface UpdateNoteContentDto {
  content: ProseMirrorDoc;
  // optimistic-concurrency guard: server rejects with 409 when the note moved on
  baseContentUpdatedAt?: string;
}

export interface BatchDeleteDto {
  ids: string[];
}

export interface ReorderNotesDto {
  orderedIds: string[];
}

export interface ReorderResultDto {
  updated: string[];
}

// A user a note is shared with, plus the grant level (read-only vs editor).
export interface SharedUserDto extends UserDto {
  canEdit: boolean;
}

export interface NoteSharesDto {
  visibility: Visibility;
  sharedWith: SharedUserDto[];
}

// One share grant in a setShares request.
export interface ShareGrantDto {
  userId: string;
  canEdit: boolean;
}

export interface SetSharesDto {
  grants: ShareGrantDto[];
}

export interface SetTagsDto {
  names: string[];
}

export interface TagDto {
  id: string;
  name: string;
  // live (non-trashed) notes carrying this tag
  count: number;
}

export interface FolderDto {
  id: string;
  name: string;
  // parent folder id, or null for a root folder
  parentId: string | null;
  // live (non-trashed) notes directly in this folder
  noteCount: number;
  // wall-view grid coordinates in cell units; null = never hand-placed
  wallX: number | null;
  wallY: number | null;
}

export interface CreateFolderDto {
  name: string;
  parentId?: string | null;
}

export interface UpdateFolderDto {
  name?: string;
  parentId?: string | null;
}

export interface SharedBadgeDto {
  count: number;
}

// Build/version metadata for the "App info" panel. Sourced from env vars baked
// into the api image at build time (see scripts/deploy-to-zot.sh), with dev
// fallbacks when running unbuilt.
export interface AppInfoDto {
  name: string;
  // Release version or `git describe` (e.g. "1.2.0" / "57a583f-dirty"); "dev" unbuilt.
  version: string;
  // Short commit sha; "unknown" when not built from git.
  commit: string;
  // Full commit sha (for links); falls back to `commit`.
  commitFull: string;
  // Git branch the image was built from.
  branch: string;
  // ISO-8601 build timestamp; "unknown" unbuilt.
  buildTime: string;
  // Who built/authored the release.
  author: string;
  // Runtime NODE_ENV (production / development).
  environment: string;
}

export interface LoginDto {
  email: string;
  password: string;
}

export interface ImageUploadResultDto {
  id: string;
  url: string;
  width: number;
  height: number;
}

// Admin "Rinse database" panel: row counts for the content the rinse will wipe,
// plus the user count it will KEEP (accounts survive a rinse).
export interface DatabaseStatsDto {
  notes: number;
  folders: number;
  tags: number;
  shares: number;
  links: number;
  images: number;
  // Accounts are preserved by a rinse — shown so the admin knows what survives.
  users: number;
}

// What a rinse actually removed (image `files` are the on-disk uploads unlinked,
// matching the `images` rows deleted by cascade).
export interface RinseResultDto {
  notes: number;
  folders: number;
  tags: number;
  images: number;
  files: number;
}

// --- Data management (Settings → Account) ---

/**
 * Portable backup of a user's client-side preferences (Settings → Account →
 * "Export settings"). Everything here lives in localStorage, not the database,
 * so this is the only way to move preferences between browsers/devices. Values
 * are kept loosely typed (string) so an import from a newer/older app version
 * never fails to parse; the importer validates each field against its allowed
 * set and silently ignores anything it doesn't recognise.
 */
export interface SettingsBackupDto {
  // Backup schema version (bump when the shape changes incompatibly).
  version: 1;
  // ISO-8601 timestamp the backup was produced.
  exportedAt: string;
  theme: {
    // 'light' | 'dark'
    mode: string;
    // ThemeName palette ('default' | 'monokai' | …)
    name: string;
  };
  preferences: {
    // DateFormat ('medium' | 'iso' | 'us' | 'eu')
    dateFormat: string;
    // 'sunday' | 'monday'
    weekStart: string;
    // 'relative' | 'absolute'
    dueDisplay: string;
    // Show a confirmation dialog before deleting a note or folder.
    confirmOnDelete: boolean;
    // Show automatic outline numbers (1, 1.1, …) before headings.
    numberedHeadings: boolean;
  };
}

// Which notes a user wants to include in a notes export.
export type NoteExportScope = 'mine' | 'shared' | 'public';
// Output format for a notes export.
export type NoteExportFormat = 'markdown' | 'json';

// One note in an export payload. Carries full content so the client can render
// it to the chosen format (Markdown via docToMarkdown, or raw JSON).
export interface NoteExportItemDto {
  id: string;
  title: string;
  visibility: Visibility;
  // Display name of the note's owner (author).
  ownerName: string;
  // True when the requesting user owns the note.
  isOwner: boolean;
  createdAt: string;
  updatedAt: string;
  // Owner's tag names on the note (only populated for the user's own notes).
  tags: string[];
  content: ProseMirrorDoc;
}

// Server response for GET /api/notes/export — the selected notes with content.
export interface NotesExportDto {
  exportedAt: string;
  count: number;
  notes: NoteExportItemDto[];
}

// One note to import (already parsed from Markdown on the client into the app's
// ProseMirror content shape). Title is derived from the file's leading H1 or its
// filename.
export interface ImportNoteDto {
  title: string;
  content: ProseMirrorDoc;
}

export interface ImportNotesDto {
  notes: ImportNoteDto[];
}

// Server response for POST /api/notes/import.
export interface ImportNotesResultDto {
  created: number;
  titles: string[];
}
