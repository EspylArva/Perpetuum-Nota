import { Visibility } from '@prisma/client';

export type AccessAction = 'view' | 'edit' | 'delete';

export interface NoteAccessSubject {
  ownerId: string;
  visibility: Visibility;
}

/**
 * Pure access-control predicate — the security core.
 *
 * - edit / delete: owner only (MVP — grants are view-only).
 * - view: owner, OR a PUBLIC note (any logged-in user), OR an explicit share grant.
 *
 * Share membership is passed in (isSharedWithUser) so this stays pure and fully
 * unit-testable; the DB lookup lives in NoteAccessGuard.
 */
export function canAccess(
  note: NoteAccessSubject,
  user: { id: string },
  action: AccessAction,
  isSharedWithUser: boolean,
): boolean {
  const isOwner = note.ownerId === user.id;

  if (action === 'edit' || action === 'delete') {
    return isOwner;
  }

  // action === 'view'
  if (isOwner) return true;
  if (note.visibility === 'PUBLIC') return true;
  return isSharedWithUser;
}
