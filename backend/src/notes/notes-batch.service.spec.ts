import { Test } from '@nestjs/testing';
import { NotesBatchService } from './notes-batch.service';
import { NotesService } from './notes.service';
import { PrismaService } from '../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';

/**
 * Characterization for bulk operations relocated from NotesService. The reorder
 * ownership-filter assertions were authored against the original
 * NotesService.reorder and moved here verbatim when the method was extracted.
 * importNotes is checked for delegating link resolution to the shared
 * NotesService.recomputeLinks helper inside its transaction.
 */
describe('NotesBatchService (characterization)', () => {
  let service: NotesBatchService;
  let prisma: {
    note: {
      findMany: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
      create: jest.Mock;
      aggregate: jest.Mock;
    };
    imageAsset: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let uploads: { deleteFiles: jest.Mock };
  let notes: { recomputeLinks: jest.Mock };

  let tx: { note: { create: jest.Mock } };

  beforeEach(async () => {
    tx = { note: { create: jest.fn() } };

    prisma = {
      note: {
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
        create: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _min: { position: 0 } }),
      },
      imageAsset: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((arg: unknown, _opts?: unknown) =>
        typeof arg === 'function'
          ? (arg as (c: typeof tx) => unknown)(tx)
          : Promise.resolve([]),
      ),
    };

    uploads = { deleteFiles: jest.fn().mockResolvedValue(undefined) };
    notes = { recomputeLinks: jest.fn().mockResolvedValue([]) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotesBatchService,
        { provide: PrismaService, useValue: prisma },
        { provide: UploadsService, useValue: uploads },
        { provide: NotesService, useValue: notes },
      ],
    }).compile();

    service = moduleRef.get(NotesBatchService);
  });

  describe('reorder ownership filter', () => {
    it('re-positions only owned ids in list order; ignores non-owned', async () => {
      // requested order: a, b, c — only a and c are owned.
      prisma.note.findMany.mockResolvedValue([{ id: 'a' }, { id: 'c' }]);
      prisma.note.update.mockImplementation((u: unknown) => u);

      const out = await service.reorder('owner-1', ['a', 'b', 'c']);

      // ownership query
      expect(prisma.note.findMany.mock.calls[0][0].where).toEqual({
        id: { in: ['a', 'b', 'c'] },
        ownerId: 'owner-1',
      });
      // only owned ids reported updated, preserving order
      expect(out).toEqual({ updated: ['a', 'c'] });

      // positions assigned densely from 0 in list order over owned ids only:
      // a -> 0, c -> 1 (b skipped). Inspect the ops passed to $transaction.
      const ops = prisma.$transaction.mock.calls[0][0] as Array<{
        where: { id: string };
        data: { position: number };
      }>;
      expect(ops).toEqual([
        { where: { id: 'a' }, data: { position: 0 } },
        { where: { id: 'c' }, data: { position: 1 } },
      ]);
    });

    it('does not open a transaction when nothing is owned', async () => {
      prisma.note.findMany.mockResolvedValue([]);
      const out = await service.reorder('owner-1', ['x', 'y']);
      expect(out).toEqual({ updated: [] });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('importNotes', () => {
    it('creates each note then resolves links via NotesService.recomputeLinks (second pass)', async () => {
      const doc = { type: 'doc', content: [] };
      tx.note.create
        .mockResolvedValueOnce({ id: 'new-1' })
        .mockResolvedValueOnce({ id: 'new-2' });

      const out = await service.importNotes('owner-1', [
        { title: 'A', content: doc as Record<string, unknown> },
        { title: 'B', content: doc as Record<string, unknown> },
      ]);

      expect(out).toEqual({ created: 2, titles: ['A', 'B'] });
      // recompute runs once per created note, AFTER all creates, on the tx client
      expect(notes.recomputeLinks).toHaveBeenCalledTimes(2);
      expect(notes.recomputeLinks).toHaveBeenNthCalledWith(1, tx, 'new-1', doc);
      expect(notes.recomputeLinks).toHaveBeenNthCalledWith(2, tx, 'new-2', doc);
    });
  });
});
