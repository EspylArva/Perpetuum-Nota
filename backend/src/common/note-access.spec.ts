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

  describe('edit (owner-only in MVP)', () => {
    it('owner can edit', () => {
      expect(canAccess(privateNote, owner, 'edit', false)).toBe(true);
    });
    it('non-owner cannot edit a PUBLIC note', () => {
      expect(canAccess(publicNote, other, 'edit', false)).toBe(false);
    });
    it('non-owner cannot edit even when shared (grants are view-only)', () => {
      expect(canAccess(privateNote, other, 'edit', true)).toBe(false);
    });
  });

  describe('delete (owner-only)', () => {
    it('owner can delete', () => {
      expect(canAccess(privateNote, owner, 'delete', false)).toBe(true);
    });
    it('non-owner cannot delete a PUBLIC note', () => {
      expect(canAccess(publicNote, other, 'delete', false)).toBe(false);
    });
    it('non-owner cannot delete even when shared', () => {
      expect(canAccess(privateNote, other, 'delete', true)).toBe(false);
    });
  });
});
