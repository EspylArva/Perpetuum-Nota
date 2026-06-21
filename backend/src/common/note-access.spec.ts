import { canAccess } from './note-access';

describe('canAccess', () => {
  const owner = { id: 'owner-1' };
  const other = { id: 'other-1' };
  const privateNote = { ownerId: 'owner-1', visibility: 'PRIVATE' as const };
  const publicNote = { ownerId: 'owner-1', visibility: 'PUBLIC' as const };

  describe('view', () => {
    it('owner can view their own private note', () => {
      expect(canAccess(privateNote, owner, 'view', false)).toBe(true);
    });
    it('non-owner cannot view a private note without a grant', () => {
      expect(canAccess(privateNote, other, 'view', false)).toBe(false);
    });
    it('non-owner can view a private note shared with them', () => {
      expect(canAccess(privateNote, other, 'view', true)).toBe(true);
    });
    it('any logged-in user can view a PUBLIC note', () => {
      expect(canAccess(publicNote, other, 'view', false)).toBe(true);
    });
    it('owner can view their own public note', () => {
      expect(canAccess(publicNote, owner, 'view', false)).toBe(true);
    });
  });

  describe('edit', () => {
    it('owner can edit', () => {
      expect(canAccess(privateNote, owner, 'edit', false)).toBe(true);
    });
    it('any logged-in user can edit a PUBLIC note (public is everyone-editable)', () => {
      expect(canAccess(publicNote, other, 'edit', false)).toBe(true);
    });
    it('non-owner cannot edit a private note shared read-only', () => {
      // shared (true) but the grant is read-only (canEditGrant defaults false)
      expect(canAccess(privateNote, other, 'edit', true)).toBe(false);
    });
    it('non-owner can edit a private note shared with an editor grant', () => {
      expect(canAccess(privateNote, other, 'edit', true, true)).toBe(true);
    });
    it('an editor grant is meaningless without share membership', () => {
      expect(canAccess(privateNote, other, 'edit', false, true)).toBe(false);
    });
  });

  describe('delete (owner-only)', () => {
    it('owner can delete', () => {
      expect(canAccess(privateNote, owner, 'delete', false)).toBe(true);
    });
    it('non-owner cannot delete a PUBLIC note', () => {
      expect(canAccess(publicNote, other, 'delete', false)).toBe(false);
    });
    it('non-owner cannot delete even with an editor grant', () => {
      expect(canAccess(privateNote, other, 'delete', true, true)).toBe(false);
    });
  });

  describe('manage (owner-only — visibility/shares/tags)', () => {
    it('owner can manage', () => {
      expect(canAccess(privateNote, owner, 'manage', false)).toBe(true);
    });
    it('an editor grantee cannot manage sharing', () => {
      expect(canAccess(privateNote, other, 'manage', true, true)).toBe(false);
    });
    it('a logged-in user cannot manage a PUBLIC note they can edit', () => {
      expect(canAccess(publicNote, other, 'manage', false)).toBe(false);
    });
  });
});
