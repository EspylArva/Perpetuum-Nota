import { Test } from '@nestjs/testing';
import { NotesQueryService } from './notes-query.service';
import { NotesService } from './notes.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Characterization for the read-side scope building relocated from NotesService.
 * These assertions were authored against the original NotesService.listViewable
 * and moved here verbatim when the method was extracted. NotesService is mocked
 * to provide the shared metaInclude/toSummary helpers (toSummary is stubbed to
 * pass the row through so the row->summary mapping is observable).
 */
describe('NotesQueryService (characterization)', () => {
  let service: NotesQueryService;
  let prisma: { note: { findMany: jest.Mock } };
  let notes: { metaInclude: jest.Mock; toSummary: jest.Mock };

  beforeEach(async () => {
    prisma = { note: { findMany: jest.fn() } };
    notes = {
      metaInclude: jest.fn().mockReturnValue({ __meta: true }),
      // Mirror the real toSummary's isOwner derivation enough for the mapping test.
      toSummary: jest.fn((n: any, userId: string) => ({
        id: n.id,
        isOwner: n.ownerId === userId,
      })),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotesQueryService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotesService, useValue: notes },
      ],
    }).compile();

    service = moduleRef.get(NotesQueryService);
  });

  describe('listViewable scope building', () => {
    it("filter='mine' scopes strictly to the owner's notes (deletedAt null)", async () => {
      prisma.note.findMany.mockResolvedValue([]);
      await service.listViewable('owner-1', { filter: 'mine' });

      const arg = prisma.note.findMany.mock.calls[0][0];
      expect(arg.where.AND).toEqual([
        { ownerId: 'owner-1' },
        { deletedAt: null },
      ]);
    });

    it("filter='shared' scopes to public OR a share grant for non-owned notes", async () => {
      prisma.note.findMany.mockResolvedValue([]);
      await service.listViewable('me-1', { filter: 'shared' });

      const arg = prisma.note.findMany.mock.calls[0][0];
      expect(arg.where.AND[0]).toEqual({
        ownerId: { not: 'me-1' },
        OR: [{ visibility: 'PUBLIC' }, { shares: { some: { userId: 'me-1' } } }],
      });
      expect(arg.where.AND[1]).toEqual({ deletedAt: null });
    });

    it("filter='all' unions owned with shared/public", async () => {
      prisma.note.findMany.mockResolvedValue([]);
      await service.listViewable('me-1', { filter: 'all' });

      const arg = prisma.note.findMany.mock.calls[0][0];
      expect(arg.where.AND[0]).toEqual({
        OR: [
          { ownerId: 'me-1' },
          {
            ownerId: { not: 'me-1' },
            OR: [
              { visibility: 'PUBLIC' },
              { shares: { some: { userId: 'me-1' } } },
            ],
          },
        ],
      });
    });

    it("filter='trash' returns only the viewer's own trashed notes ordered by deletedAt desc", async () => {
      prisma.note.findMany.mockResolvedValue([]);
      await service.listViewable('me-1', { filter: 'trash' });

      const arg = prisma.note.findMany.mock.calls[0][0];
      expect(arg.where).toEqual({
        ownerId: 'me-1',
        deletedAt: { not: null },
      });
      expect(arg.orderBy).toEqual({ deletedAt: 'desc' });
    });

    it('adds a tag filter narrowed to the owner namespace', async () => {
      prisma.note.findMany.mockResolvedValue([]);
      await service.listViewable('me-1', { filter: 'all', tag: 'work' });

      const arg = prisma.note.findMany.mock.calls[0][0];
      expect(arg.where.AND).toContainEqual({
        tags: { some: { tag: { ownerId: 'me-1', name: 'work' } } },
      });
    });

    it('maps rows through NotesService.toSummary', async () => {
      prisma.note.findMany.mockResolvedValue([
        { id: 'x1', ownerId: 'owner-1' },
      ]);
      const out = await service.listViewable('owner-1', { filter: 'mine' });
      expect(out).toHaveLength(1);
      expect(out[0].id).toBe('x1');
      expect(out[0].isOwner).toBe(true);
      expect(notes.toSummary).toHaveBeenCalled();
    });
  });
});
