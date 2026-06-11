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

export interface NoteSummaryDto {
  id: string;
  title: string;
  visibility: Visibility;
  ownerId: string;
  isOwner: boolean;
  // explicit sort order (lower = earlier); set via drag-reorder
  position: number;
  updatedAt: string;
  contentUpdatedAt: string;
  // short plain-text preview for cards / list rows
  preview: string;
}

export interface NoteDto extends NoteSummaryDto {
  content: ProseMirrorDoc;
}

export interface CreateNoteDto {
  title?: string;
}

export interface UpdateNoteDto {
  title?: string;
  visibility?: Visibility;
}

export interface UpdateNoteContentDto {
  content: ProseMirrorDoc;
  // optimistic-concurrency guard (optional, see PLAN.md decision #2)
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
