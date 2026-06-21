import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { NoteExportItemDto, ProseMirrorDoc } from '@perpetuum-nota/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  extractSearchText,
  isProseMirrorDoc,
} from '../common/prosemirror-text';
import { UploadsService } from '../uploads/uploads.service';
import { ImportNoteDto } from './dto/import-notes.dto';
import { NotesService } from './notes.service';

/**
 * Bulk / cross-note operations split out of NotesService as part of the
 * god-file refactor; method bodies are relocated verbatim. Depends on
 * NotesService only for the shared link-recompute helper (importNotes), and on
 * UploadsService for file cleanup (emptyTrash) and nothing else.
 */
@Injectable()
export class NotesBatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly notes: NotesService,
  ) {}

  /**
   * Re-positions only the notes the user owns, following the given order.
   * Ids the user doesn't own (e.g. shared notes) are ignored.
   */
  async reorder(
    userId: string,
    orderedIds: string[],
  ): Promise<{ updated: string[] }> {
    const owned = await this.prisma.note.findMany({
      where: { id: { in: orderedIds }, ownerId: userId },
      select: { id: true },
    });
    const ownedSet = new Set(owned.map((n) => n.id));

    const ops: Prisma.PrismaPromise<unknown>[] = [];
    let pos = 0;
    for (const id of orderedIds) {
      if (ownedSet.has(id)) {
        ops.push(
          this.prisma.note.update({
            where: { id },
            data: { position: pos++ },
          }),
        );
      }
    }
    if (ops.length > 0) await this.prisma.$transaction(ops);
    return { updated: orderedIds.filter((id) => ownedSet.has(id)) };
  }

  /** Empties the caller's trash. Returns the ids purged. */
  async emptyTrash(userId: string): Promise<{ deleted: string[] }> {
    const trashed = await this.prisma.note.findMany({
      where: { ownerId: userId, deletedAt: { not: null } },
      select: { id: true },
    });
    const ids = trashed.map((n) => n.id);
    if (ids.length > 0) {
      const assets = await this.prisma.imageAsset.findMany({
        where: { noteId: { in: ids } },
      });
      await this.prisma.note.deleteMany({ where: { id: { in: ids } } });
      await this.uploads.deleteFiles(assets);
    }
    return { deleted: ids };
  }

  /** Soft-deletes only the notes the user owns; returns the ids trashed. */
  async batchDelete(
    userId: string,
    ids: string[],
  ): Promise<{ deleted: string[] }> {
    const owned = await this.prisma.note.findMany({
      where: { id: { in: ids }, ownerId: userId, deletedAt: null },
      select: { id: true },
    });
    const deletable = owned.map((n) => n.id);
    if (deletable.length > 0) {
      await this.prisma.note.updateMany({
        where: { id: { in: deletable } },
        data: { deletedAt: new Date() },
      });
    }
    return { deleted: deletable };
  }

  /**
   * Collects notes for the user's "Export notes" request. Scopes are additive
   * (a note matching any selected scope is returned once):
   *   - 'mine'   → notes the user owns
   *   - 'shared' → notes another user explicitly shared with them (a grant)
   *   - 'public' → PUBLIC notes owned by another user
   * Trashed notes are always excluded. Each note carries its full content so the
   * client can render the chosen format. Tag names are owner-scoped, so they are
   * only meaningful on the user's own notes (empty for others').
   */
  async exportNotes(
    userId: string,
    scopes: { mine: boolean; shared: boolean; public: boolean },
  ): Promise<NoteExportItemDto[]> {
    const or: Prisma.NoteWhereInput[] = [];
    if (scopes.mine) or.push({ ownerId: userId });
    if (scopes.shared) {
      or.push({ ownerId: { not: userId }, shares: { some: { userId } } });
    }
    if (scopes.public) {
      or.push({ ownerId: { not: userId }, visibility: 'PUBLIC' });
    }
    if (or.length === 0) return [];

    const notes = await this.prisma.note.findMany({
      where: { AND: [{ deletedAt: null }, { OR: or }] },
      include: {
        owner: { select: { displayName: true } },
        tags: {
          select: { tag: { select: { name: true } } },
          orderBy: { tag: { name: 'asc' as const } },
        },
      },
      orderBy: [{ ownerId: 'asc' }, { position: 'asc' }],
    });

    return notes.map((n) => ({
      id: n.id,
      title: n.title,
      visibility: n.visibility,
      ownerName: n.owner.displayName,
      isOwner: n.ownerId === userId,
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
      tags: n.tags.map((t) => t.tag.name),
      content: n.content as unknown as ProseMirrorDoc,
    }));
  }

  /**
   * Bulk-creates notes from an import (Settings → Account → Import notes). The
   * client parses each uploaded Markdown file into the app's ProseMirror content
   * shape (reusing the editor's converter) and posts the results here; this
   * method persists them as the caller's own PRIVATE notes — computing search
   * text and resolving wikilinks for each — in one transaction, so a single bad
   * item leaves nothing half-created. Returns the created count and titles.
   */
  async importNotes(
    userId: string,
    items: ImportNoteDto[],
  ): Promise<{ created: number; titles: string[] }> {
    // Validate every doc up front so the whole import fails atomically.
    for (const item of items) {
      if (!isProseMirrorDoc(item.content)) {
        throw new BadRequestException(
          'Every imported note must have a ProseMirror "doc" content node',
        );
      }
    }

    // New notes sort to the top, preserving the import's file order.
    const { _min } = await this.prisma.note.aggregate({
      where: { ownerId: userId },
      _min: { position: true },
    });
    let position = (_min.position ?? 0) - 1;

    const titles: string[] = [];
    await this.prisma.$transaction(
      async (tx) => {
        const created: { id: string; content: unknown }[] = [];
        for (const item of items) {
          const title = item.title?.trim() || 'Untitled';
          const note = await tx.note.create({
            data: {
              ownerId: userId,
              title,
              content: item.content as Prisma.InputJsonValue,
              contentText: extractSearchText(item.content),
              position: position--,
            },
            select: { id: true },
          });
          created.push({ id: note.id, content: item.content });
          titles.push(title);
        }
        // Second pass: resolve wikilinks once ALL imported notes exist, so
        // cross-references between them resolve regardless of file order.
        for (const c of created) {
          await this.notes.recomputeLinks(tx, c.id, c.content);
        }
      },
      // Generous ceiling — an import can be up to a few hundred notes.
      { timeout: 60_000 },
    );

    return { created: titles.length, titles };
  }
}
