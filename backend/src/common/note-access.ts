import { Visibility } from '@prisma/client';

export type AccessAction = 'view' | 'edit' | 'delete' | 'manage';

export interface NoteAccessSubject {
  ownerId: string;
  visibility: Visibility;
}

/**
 * Pure access-control predicate — the security core.
 *
 * - view:   owner, OR a PUBLIC note (any logged-in user), OR a share grant.
 * - edit:   owner, OR a PUBLIC note (PUBLIC notes are editable by EVERYONE),
 *           OR a share grant whose canEdit is true (an "editor" grant).
 * - delete: owner only (trashing/restoring stays with the owner).
 * - manage: owner only (visibility, share grants, tags — never delegated).
 *
 * Share membership + grant level are passed in (isSharedWithUser / canEditGrant)
 * so this stays pure and fully unit-testable; the DB lookup lives in
 * NoteAccessService / NoteAccessGuard.
 */
export function canAccess(
  note: NoteAccessSubject,
  user: { id: string },
  action: AccessAction,
  isSharedWithUser: boolean,
  canEditGrant = false,
): boolean {
  const isOwner = note.ownerId === user.id;

  if (action === 'delete' || action === 'manage') {
    return isOwner;
  }

  if (action === 'edit') {
    if (isOwner) return true;
    // PUBLIC notes are always editable by everyone (no read-only public mode).
    if (note.visibility === 'PUBLIC') return true;
    // PRIVATE notes: only an explicit editor grant unlocks editing.
    return isSharedWithUser && canEditGrant;
  }

  // action === 'view'
  if (isOwner) return true;
  if (note.visibility === 'PUBLIC') return true;
  return isSharedWithUser;
}
