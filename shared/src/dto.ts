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

export interface NoteSharesDto {
  visibility: Visibility;
  sharedWith: UserDto[];
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

export interface SharedBadgeDto {
  count: number;
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
