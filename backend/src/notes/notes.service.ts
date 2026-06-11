import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Note, Prisma, Visibility } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  EMPTY_DOC,
  extractSearchText,
  isProseMirrorDoc,
  previewFromText,
  rewriteUploadSrcs,
} from '../common/prosemirror-text';
import { UploadsService } from '../uploads/uploads.service';
import { CreateNoteDto } from './dto/create-note.dto';
import { UpdateNoteDto } from './dto/update-note.dto';
import { UpdateNoteContentDto } from './dto/update-note-content.dto';

export type NoteFilter = 'mine' | 'shared' | 'all' | 'trash';
export type NoteSort = 'position' | 'updated' | 'created' | 'title';

export interface ListOptions {
  filter: NoteFilter;
  q?: string;
  tag?: string;
  sort?: NoteSort;
}

export interface NoteSummary {
  id: string;
  title: string;
  visibility: Visibility;
  ownerId: string;
  isOwner: boolean;
  position: number;
  pinned: boolean;
  deletedAt: Date | null;
  updatedAt: Date;
  contentUpdatedAt: Date;
  preview: string;
  tags: string[];
  /** False only for a share grant the recipient hasn't opened yet. */
  seen: boolean;
}

type NoteWithMeta = Note & {
  tags: { tag: { name: string } }[];
  shares: { seenAt: Date | null }[];
};

const TRASH_RETENTION_DAYS = 30;

@Injectable()
export class NotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {}

  async create(userId: string, dto: CreateNoteDto): Promise<NoteSummary> {
    // Place new notes first by giving them a position below the current minimum.
    const { _min } = await this.prisma.note.aggregate({
      where: { ownerId: userId },
      _min: { position: true },
    });
    const note = await this.prisma.note.create({
      data: {
        ownerId: userId,
        title: dto.title?.trim() || 'Untitled',
        content: EMPTY_DOC,
        position: (_min.position ?? 0) - 1,
      },
      include: this.metaInclude(userId),
    });
    return this.toSummary(note, userId);
  }

  async listViewable(
    userId: string,
    opts: ListOptions,
  ): Promise<NoteSummary[]> {
    const { filter, q, tag } = opts;

    if (filter === 'trash') {
      // Trash is strictly the viewer's own notes; shared/public notes in
      // someone else's trash are invisible (and unviewable, see NoteAccessService).
      const notes = await this.prisma.note.findMany({
        where: { ownerId: userId, deletedAt: { not: null } },
        include: this.metaInclude(userId),
        orderBy: { deletedAt: 'desc' },
      });
      return notes.map((n) => this.toSummary(n, userId));
    }

    const owned: Prisma.NoteWhereInput = { ownerId: userId };
    const sharedWithMe: Prisma.NoteWhereInput = {
      ownerId: { not: userId },
      OR: [{ visibility: 'PUBLIC' }, { shares: { some: { userId } } }],
    };

    let scope: Prisma.NoteWhereInput;
    if (filter === 'mine') scope = owned;
    else if (filter === 'shared') scope = sharedWithMe;
    else scope = { OR: [owned, sharedWithMe] };

    const and: Prisma.NoteWhereInput[] = [scope, { deletedAt: null }];

    // Tag filter — tags are owner-scoped, so this effectively narrows to the
    // viewer's own notes carrying that tag.
    if (tag) {
      and.push({
        tags: { some: { tag: { ownerId: userId, name: tag } } },
      });
    }

    // Full-text search: GIN-indexed websearch over title + contentText, plus
    // ILIKE so partial words still hit (FTS matches whole lexemes only).
    if (q && q.trim()) {
      const ids = await this.searchIds(q.trim());
      and.push({ id: { in: ids } });
    }

    const notes = await this.prisma.note.findMany({
      where: { AND: and },
      include: this.metaInclude(userId),
      orderBy: this.orderBy(opts.sort),
    });
    return notes.map((n) => this.toSummary(n, userId));
  }

  /**
   * Id-prefilter for search. Access control is applied by the Prisma query the
   * ids feed into, so this can stay a simple content match.
   */
  private async searchIds(q: string): Promise<string[]> {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Note"
      WHERE to_tsvector('simple', coalesce(title, '') || ' ' || coalesce("contentText", ''))
              @@ websearch_to_tsquery('simple', ${q})
         OR title ILIKE ${like} ESCAPE '\\'
         OR "contentText" ILIKE ${like} ESCAPE '\\'
      LIMIT 500
    `;
    return rows.map((r) => r.id);
  }

  private orderBy(
    sort?: NoteSort,
  ): Prisma.NoteOrderByWithRelationInput[] {
    const pinnedFirst: Prisma.NoteOrderByWithRelationInput = {
      pinned: 'desc',
    };
    switch (sort) {
      case 'updated':
        return [pinnedFirst, { contentUpdatedAt: 'desc' }];
      case 'created':
        return [pinnedFirst, { createdAt: 'desc' }];
      case 'title':
        return [pinnedFirst, { title: 'asc' }];
      default:
        return [pinnedFirst, { position: 'asc' }, { updatedAt: 'desc' }];
    }
  }

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

  async findOne(noteId: string, userId: string) {
    const note = await this.prisma.note.findUnique({
      where: { id: noteId },
      include: this.metaInclude(userId),
    });
    if (!note) throw new NotFoundException('Note not found');

    // Opening a note consumes its "unseen share" badge for this viewer.
    if (note.ownerId !== userId) {
      await this.prisma.noteShare.updateMany({
        where: { noteId, userId, seenAt: null },
        data: { seenAt: new Date() },
      });
    }
    return { ...this.toSummary(note, userId), content: note.content };
  }

  /** Count of share grants to me I haven't opened yet (sidebar badge). */
  async unseenSharedCount(userId: string): Promise<{ count: number }> {
    const count = await this.prisma.noteShare.count({
      where: {
        userId,
        seenAt: null,
        note: { deletedAt: null, ownerId: { not: userId } },
      },
    });
    return { count };
  }

  async updateMeta(noteId: string, userId: string, dto: UpdateNoteDto) {
    const note = await this.prisma.note.update({
      where: { id: noteId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.pinned !== undefined ? { pinned: dto.pinned } : {}),
      },
      include: this.metaInclude(userId),
    });
    return this.toSummary(note, userId);
  }

  async updateContent(noteId: string, dto: UpdateNoteContentDto) {
    if (!isProseMirrorDoc(dto.content)) {
      throw new BadRequestException('content must be a ProseMirror "doc" node');
    }
    const contentText = extractSearchText(dto.content);
    const now = new Date();
    const data = {
      content: dto.content as Prisma.InputJsonValue,
      contentText,
      contentUpdatedAt: now,
    };

    if (dto.baseContentUpdatedAt) {
      const base = new Date(dto.baseContentUpdatedAt);
      if (Number.isNaN(base.getTime())) {
        throw new BadRequestException(
          'baseContentUpdatedAt must be an ISO timestamp',
        );
      }
      // Atomic optimistic concurrency: the row is only written if it still
      // carries the timestamp the client based its edit on.
      const res = await this.prisma.note.updateMany({
        where: { id: noteId, contentUpdatedAt: base },
        data,
      });
      if (res.count === 0) {
        throw new ConflictException('Note was modified elsewhere');
      }
      return { contentUpdatedAt: now };
    }

    const note = await this.prisma.note.update({
      where: { id: noteId },
      data,
      select: { contentUpdatedAt: true },
    });
    return { contentUpdatedAt: note.contentUpdatedAt };
  }

  /** Soft delete — moves the note to trash (idempotent). */
  async remove(noteId: string): Promise<{ id: string; deletedAt: Date }> {
    const note = await this.prisma.note.update({
      where: { id: noteId },
      data: { deletedAt: new Date() },
      select: { id: true, deletedAt: true },
    });
    return { id: note.id, deletedAt: note.deletedAt! };
  }

  async restore(noteId: string, userId: string): Promise<NoteSummary> {
    const note = await this.prisma.note.update({
      where: { id: noteId },
      data: { deletedAt: null },
      include: this.metaInclude(userId),
    });
    return this.toSummary(note, userId);
  }

  /** Hard delete — removes the row (cascades) and the image files on disk. */
  async removePermanently(noteId: string): Promise<{ id: string }> {
    const assets = await this.prisma.imageAsset.findMany({
      where: { noteId },
    });
    await this.prisma.note.delete({ where: { id: noteId } });
    await this.uploads.deleteFiles(assets);
    return { id: noteId };
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
   * Clones a note the user can view into their own account: content, image
   * files (fresh copies — no cross-note file sharing), and — when duplicating
   * one's own note — its tags. Visibility resets to PRIVATE.
   */
  async duplicate(noteId: string, userId: string): Promise<NoteSummary> {
    const src = await this.prisma.note.findUnique({
      where: { id: noteId },
      include: { tags: { select: { tagId: true } } },
    });
    if (!src) throw new NotFoundException('Note not found');

    const { _min } = await this.prisma.note.aggregate({
      where: { ownerId: userId },
      _min: { position: true },
    });

    const created = await this.prisma.note.create({
      data: {
        ownerId: userId,
        title: `${src.title || 'Untitled'} (copy)`,
        content: src.content as Prisma.InputJsonValue,
        contentText: src.contentText,
        visibility: 'PRIVATE',
        position: (_min.position ?? 0) - 1,
        ...(src.ownerId === userId && src.tags.length > 0
          ? { tags: { create: src.tags.map((t) => ({ tagId: t.tagId })) } }
          : {}),
      },
    });

    // Copy image files + asset rows, then point the cloned doc at the copies.
    const idMap = await this.uploads.copyAssets(noteId, created.id, userId);
    if (idMap.size > 0) {
      const rewritten = rewriteUploadSrcs(src.content, idMap);
      await this.prisma.note.update({
        where: { id: created.id },
        data: { content: rewritten as Prisma.InputJsonValue },
      });
    }

    const full = await this.prisma.note.findUniqueOrThrow({
      where: { id: created.id },
      include: this.metaInclude(userId),
    });
    return this.toSummary(full, userId);
  }

  async setVisibility(noteId: string, visibility: Visibility) {
    const note = await this.prisma.note.update({
      where: { id: noteId },
      data: { visibility },
    });
    return { visibility: note.visibility };
  }

  async getShares(noteId: string) {
    const note = await this.prisma.note.findUnique({
      where: { id: noteId },
      select: { visibility: true },
    });
    const shares = await this.prisma.noteShare.findMany({
      where: { noteId },
      include: {
        user: {
          select: { id: true, email: true, displayName: true, role: true },
        },
      },
    });
    return {
      visibility: note?.visibility ?? 'PRIVATE',
      sharedWith: shares.map((s) => s.user),
    };
  }

  /** Replaces the grant set with the given users (active, non-owner only). */
  async setShares(noteId: string, ownerId: string, userIds: string[]) {
    const valid = await this.prisma.user.findMany({
      where: { id: { in: userIds }, isActive: true, NOT: { id: ownerId } },
      select: { id: true },
    });
    const ids = valid.map((u) => u.id);
    await this.prisma.$transaction([
      // Keep existing grants' seenAt: delete only removed users, add only new.
      this.prisma.noteShare.deleteMany({
        where: { noteId, userId: { notIn: ids } },
      }),
      ...(ids.length
        ? [
            this.prisma.noteShare.createMany({
              data: ids.map((userId) => ({ noteId, userId })),
              skipDuplicates: true,
            }),
          ]
        : []),
    ]);
    return this.getShares(noteId);
  }

  /** Hard-purges trash older than the retention window (called by the sweep). */
  async purgeExpiredTrash(): Promise<number> {
    const cutoff = new Date(
      Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    const expired = await this.prisma.note.findMany({
      where: { deletedAt: { lt: cutoff } },
      select: { id: true },
    });
    const ids = expired.map((n) => n.id);
    if (ids.length === 0) return 0;
    const assets = await this.prisma.imageAsset.findMany({
      where: { noteId: { in: ids } },
    });
    await this.prisma.note.deleteMany({ where: { id: { in: ids } } });
    await this.uploads.deleteFiles(assets);
    return ids.length;
  }

  private metaInclude(userId: string) {
    return {
      tags: {
        select: { tag: { select: { name: true } } },
        orderBy: { tag: { name: 'asc' as const } },
      },
      shares: { where: { userId }, select: { seenAt: true } },
    };
  }

  private toSummary(note: NoteWithMeta, userId: string): NoteSummary {
    const grant = note.shares[0];
    return {
      id: note.id,
      title: note.title,
      visibility: note.visibility,
      ownerId: note.ownerId,
      isOwner: note.ownerId === userId,
      position: note.position,
      pinned: note.pinned,
      deletedAt: note.deletedAt,
      updatedAt: note.updatedAt,
      contentUpdatedAt: note.contentUpdatedAt,
      preview: previewFromText(note.contentText),
      tags: note.tags.map((t) => t.tag.name),
      seen: note.ownerId === userId || !grant || grant.seenAt !== null,
    };
  }
}
