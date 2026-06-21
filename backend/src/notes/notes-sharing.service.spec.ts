import { Test } from '@nestjs/testing';
import { NotesSharingService } from './notes-sharing.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Characterization for the share-grant delta logic relocated from NotesService.
 * These assertions were authored against the original NotesService.setShares and
 * moved here verbatim when the method was extracted, so they keep protecting the
 * revoke/upsert behavior across the refactor.
 */
describe('NotesSharingService (characterization)', () => {
  let service: NotesSharingService;
  let prisma: {
    note: { findUnique: jest.Mock };
    noteShare: { findMany: jest.Mock; deleteMany: jest.Mock; upsert: jest.Mock };
    user: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      note: { findUnique: jest.fn() },
      noteShare: {
        findMany: jest.fn(),
        deleteMany: jest.fn(),
        upsert: jest.fn(),
      },
      user: { findMany: jest.fn() },
      $transaction: jest.fn().mockResolvedValue([]),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotesSharingService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(NotesSharingService);
  });

  describe('setShares', () => {
    it('revokes users not in the validated list and upserts each valid grant', async () => {
      // Two requested; only u-keep is valid (u-bad filtered out as inactive/owner).
      prisma.user.findMany.mockResolvedValue([{ id: 'u-keep' }]);
      // getShares() tail call
      prisma.note.findUnique.mockResolvedValue({ visibility: 'PRIVATE' });
      prisma.noteShare.findMany.mockResolvedValue([]);

      await service.setShares('note-1', 'owner-1', [
        { userId: 'u-keep', canEdit: true },
        { userId: 'u-bad', canEdit: false },
      ]);

      // valid-user query excludes the owner and requires active
      const userArg = prisma.user.findMany.mock.calls[0][0];
      expect(userArg.where.isActive).toBe(true);
      expect(userArg.where.NOT).toEqual({ id: 'owner-1' });
      expect(userArg.where.id).toEqual({ in: ['u-keep', 'u-bad'] });

      // the $transaction got an array: [deleteMany, upsert...]
      const opsArg = prisma.$transaction.mock.calls[0][0];
      expect(Array.isArray(opsArg)).toBe(true);

      // revoke targets everyone not in the kept set
      expect(prisma.noteShare.deleteMany).toHaveBeenCalledWith({
        where: { noteId: 'note-1', userId: { notIn: ['u-keep'] } },
      });
      // exactly one upsert, for the kept editor grant
      expect(prisma.noteShare.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.noteShare.upsert).toHaveBeenCalledWith({
        where: { noteId_userId: { noteId: 'note-1', userId: 'u-keep' } },
        create: { noteId: 'note-1', userId: 'u-keep', canEdit: true },
        update: { canEdit: true },
      });
    });

    it('revokes ALL grants when no requested user is valid (notIn empty)', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.note.findUnique.mockResolvedValue({ visibility: 'PRIVATE' });
      prisma.noteShare.findMany.mockResolvedValue([]);

      await service.setShares('note-1', 'owner-1', [
        { userId: 'u-bad', canEdit: true },
      ]);

      expect(prisma.noteShare.deleteMany).toHaveBeenCalledWith({
        where: { noteId: 'note-1', userId: { notIn: [] } },
      });
      expect(prisma.noteShare.upsert).not.toHaveBeenCalled();
    });
  });
});
