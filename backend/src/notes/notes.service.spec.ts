import { Test } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { NotesService } from './notes.service';
import { PrismaService } from '../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';

/**
 * Characterization tests for NotesService. These pin down the riskiest behavior
 * BEFORE the god-file split so the same assertions keep passing as methods are
 * relocated VERBATIM into NotesQueryService / NotesBatchService /
 * NotesSharingService. Prisma + Uploads are fully mocked; we assert on the
 * shapes/args handed to Prisma and the values returned, not on a real DB.
 *
 * Private helpers (recomputeLinks, toSummary) are exercised via bracket access
 * so the tests survive the later private -> public change unchanged.
 */
describe('NotesService (characterization)', () => {
  let service: NotesService;
  let prisma: {
    note: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      aggregate: jest.Mock;
    };
    noteLink: {
      findMany: jest.Mock;
      deleteMany: jest.Mock;
      createMany: jest.Mock;
    };
    noteShare: {
      findMany: jest.Mock;
      deleteMany: jest.Mock;
      upsert: jest.Mock;
    };
    user: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let uploads: { deleteFiles: jest.Mock; copyAssets: jest.Mock };

  // A transaction client mirroring the prisma mock surface the code touches
  // inside $transaction callbacks (recomputeLinks uses tx.note / tx.noteLink).
  let tx: {
    note: { findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
    noteLink: { deleteMany: jest.Mock; createMany: jest.Mock };
  };

  beforeEach(async () => {
    tx = {
      note: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      noteLink: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
    };

    prisma = {
      note: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        aggregate: jest.fn(),
      },
      noteLink: {
        findMany: jest.fn(),
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      noteShare: {
        findMany: jest.fn(),
        deleteMany: jest.fn(),
        upsert: jest.fn(),
      },
      user: { findMany: jest.fn() },
      // Default: run array form as a no-op resolve; callback form gets the tx.
      $transaction: jest.fn((arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (c: typeof tx) => unknown)(tx)
          : Promise.resolve([]),
      ),
    };

    uploads = {
      deleteFiles: jest.fn().mockResolvedValue(undefined),
      copyAssets: jest.fn().mockResolvedValue(new Map()),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotesService,
        { provide: PrismaService, useValue: prisma },
        { provide: UploadsService, useValue: uploads },
      ],
    }).compile();

    service = moduleRef.get(NotesService);
  });

  /** Builds a NoteWithMeta-shaped row for toSummary. */
  function noteRow(over: Partial<Record<string, unknown>> = {}): any {
    return {
      id: 'n1',
      title: 'Title',
      visibility: 'PRIVATE',
      ownerId: 'owner-1',
      position: 0,
      pinned: false,
      wallX: null,
      wallY: null,
      deletedAt: null,
      dueDate: null,
      folderId: null,
      updatedAt: new Date('2024-01-01T00:00:00Z'),
      contentUpdatedAt: new Date('2024-01-01T00:00:00Z'),
      contentText: 'hello world',
      tags: [{ tag: { name: 'b' } }, { tag: { name: 'a' } }],
      shares: [],
      owner: { displayName: 'Owner' },
      lastEditedBy: null,
      ...over,
    };
  }

  // ---- recomputeLinks: resolution + self-link skip -------------------------
  describe('recomputeLinks', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'wikilink', attrs: { title: 'Alpha' } },
            { type: 'wikilink', attrs: { title: 'Self' } },
            { type: 'wikilink', attrs: { title: 'Ghost' } },
          ],
        },
      ],
    };

    it('resolves titles within the owner namespace, skips self + unresolved, writes edges, returns sorted', async () => {
      // owner lookup
      tx.note.findUnique.mockResolvedValue({ ownerId: 'owner-1' });
      // candidate matches: Alpha resolves, Self resolves to noteId (skipped),
      // Ghost has no candidate row (unresolved).
      tx.note.findMany.mockResolvedValue([
        { id: 'a-id', title: 'Alpha', updatedAt: new Date() },
        { id: 'n1', title: 'Self', updatedAt: new Date() },
      ]);
      tx.noteLink.deleteMany.mockResolvedValue({ count: 0 });
      tx.noteLink.createMany.mockResolvedValue({ count: 1 });

      const result = await (service as any).recomputeLinks(tx, 'n1', content);

      // owner namespace honored
      expect(tx.note.findMany.mock.calls[0][0].where.ownerId).toBe('owner-1');
      expect(tx.note.findMany.mock.calls[0][0].where.deletedAt).toBeNull();

      // old edges wiped for this source
      expect(tx.noteLink.deleteMany).toHaveBeenCalledWith({
        where: { fromNoteId: 'n1' },
      });
      // only Alpha persisted (Self skipped, Ghost unresolved)
      expect(tx.noteLink.createMany).toHaveBeenCalledWith({
        data: [{ fromNoteId: 'n1', toNoteId: 'a-id' }],
        skipDuplicates: true,
      });
      expect(result).toEqual([{ id: 'a-id', title: 'Alpha' }]);
    });

    it('returns [] and writes no edges when the source note is gone', async () => {
      tx.note.findUnique.mockResolvedValue(null);
      const result = await (service as any).recomputeLinks(tx, 'gone', content);
      expect(result).toEqual([]);
      expect(tx.noteLink.deleteMany).not.toHaveBeenCalled();
      expect(tx.noteLink.createMany).not.toHaveBeenCalled();
    });

    it('clears edges (no createMany) when nothing resolves', async () => {
      tx.note.findUnique.mockResolvedValue({ ownerId: 'owner-1' });
      tx.note.findMany.mockResolvedValue([]); // nothing matches
      tx.noteLink.deleteMany.mockResolvedValue({ count: 3 });

      const result = await (service as any).recomputeLinks(tx, 'n1', content);
      expect(tx.noteLink.deleteMany).toHaveBeenCalledWith({
        where: { fromNoteId: 'n1' },
      });
      expect(tx.noteLink.createMany).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  // ---- toSummary: canEdit + seen mapping -----------------------------------
  describe('toSummary canEdit / seen mapping', () => {
    const call = (row: any, userId: string) =>
      (service as any).toSummary(row, userId);

    it('owner: canEdit true, seen true, isOwner true', () => {
      const s = call(noteRow({ ownerId: 'me' }), 'me');
      expect(s.isOwner).toBe(true);
      expect(s.canEdit).toBe(true);
      expect(s.seen).toBe(true);
    });

    it('PUBLIC note is editable by a non-owner', () => {
      const s = call(
        noteRow({ ownerId: 'someone', visibility: 'PUBLIC', shares: [] }),
        'me',
      );
      expect(s.isOwner).toBe(false);
      expect(s.canEdit).toBe(true);
    });

    it('non-owner with a read-only grant cannot edit', () => {
      const s = call(
        noteRow({
          ownerId: 'someone',
          visibility: 'PRIVATE',
          shares: [{ seenAt: new Date(), canEdit: false }],
        }),
        'me',
      );
      expect(s.canEdit).toBe(false);
    });

    it('non-owner with an editor grant can edit', () => {
      const s = call(
        noteRow({
          ownerId: 'someone',
          visibility: 'PRIVATE',
          shares: [{ seenAt: new Date(), canEdit: true }],
        }),
        'me',
      );
      expect(s.canEdit).toBe(true);
    });

    it('unseen share grant => seen false; opened grant => seen true', () => {
      const unseen = call(
        noteRow({
          ownerId: 'someone',
          shares: [{ seenAt: null, canEdit: false }],
        }),
        'me',
      );
      expect(unseen.seen).toBe(false);

      const seen = call(
        noteRow({
          ownerId: 'someone',
          shares: [{ seenAt: new Date(), canEdit: false }],
        }),
        'me',
      );
      expect(seen.seen).toBe(true);
    });

    it('tags are passed through in the include order; preview derives from contentText', () => {
      const s = call(noteRow(), 'owner-1');
      expect(s.tags).toEqual(['b', 'a']);
      expect(typeof s.preview).toBe('string');
    });
  });

  // ---- updateContent: optimistic-concurrency conflict ----------------------
  describe('updateContent optimistic concurrency', () => {
    const doc: Record<string, unknown> = { type: 'doc', content: [] };

    it('throws Conflict and leaves links untouched when the base timestamp no longer matches', async () => {
      tx.note.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.updateContent('n1', 'owner-1', {
          content: doc,
          baseContentUpdatedAt: '2024-01-01T00:00:00.000Z',
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      // recompute must NOT run on a 0-row match
      expect(tx.noteLink.deleteMany).not.toHaveBeenCalled();
    });
  });
});
