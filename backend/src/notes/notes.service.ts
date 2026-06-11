import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Note, Prisma, Visibility } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EMPTY_DOC, extractPlainText } from '../common/prosemirror-text';
import { CreateNoteDto } from './dto/create-note.dto';
import { UpdateNoteDto } from './dto/update-note.dto';
import { UpdateNoteContentDto } from './dto/update-note-content.dto';

export type NoteFilter = 'mine' | 'shared' | 'all';

export interface NoteSummary {
  id: string;
  title: string;
  visibility: Visibility;
  ownerId: string;
  isOwner: boolean;
  position: number;
  updatedAt: Date;
  contentUpdatedAt: Date;
  preview: string;
}

@Injectable()
export class NotesService {
  constructor(private readonly prisma: PrismaService) {}

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
    });
    return this.toSummary(note, userId);
  }

  async listViewable(
    userId: string,
    filter: NoteFilter,
  ): Promise<NoteSummary[]> {
    const owned: Prisma.NoteWhereInput = { ownerId: userId };
    const sharedWithMe: Prisma.NoteWhereInput = {
      ownerId: { not: userId },
      OR: [{ visibility: 'PUBLIC' }, { shares: { some: { userId } } }],
    };

    let where: Prisma.NoteWhereInput;
    if (filter === 'mine') where = owned;
    else if (filter === 'shared') where = sharedWithMe;
    else where = { OR: [owned, sharedWithMe] };

    // `position` is owner-local. For the `all`/`shared` filters, owned notes
    // (which the user can reorder) interleave with shared notes whose position
    // belongs to another owner — so the explicit order is only fully meaningful
    // for the viewer's own notes. Acceptable for the MVP.
    const notes = await this.prisma.note.findMany({
      where,
      orderBy: [{ position: 'asc' }, { updatedAt: 'desc' }],
    });
    return notes.map((n) => this.toSummary(n, userId));
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
    const note = await this.prisma.note.findUnique({ where: { id: noteId } });
    if (!note) throw new NotFoundException('Note not found');
    return { ...this.toSummary(note, userId), content: note.content };
  }

  async updateMeta(noteId: string, userId: string, dto: UpdateNoteDto) {
    const note = await this.prisma.note.update({
      where: { id: noteId },
      data: { title: dto.title?.trim() },
    });
    return this.toSummary(note, userId);
  }

  async updateContent(noteId: string, dto: UpdateNoteContentDto) {
    if ((dto.content as { type?: unknown }).type !== 'doc') {
      throw new ConflictException('content must be a ProseMirror "doc" node');
    }

    if (dto.baseContentUpdatedAt) {
      const current = await this.prisma.note.findUnique({
        where: { id: noteId },
        select: { contentUpdatedAt: true },
      });
      if (
        current &&
        current.contentUpdatedAt.toISOString() !== dto.baseContentUpdatedAt
      ) {
        throw new ConflictException('Note was modified elsewhere');
      }
    }

    const note = await this.prisma.note.update({
      where: { id: noteId },
      data: {
        content: dto.content as Prisma.InputJsonValue,
        contentUpdatedAt: new Date(),
      },
      select: { contentUpdatedAt: true },
    });
    return { contentUpdatedAt: note.contentUpdatedAt };
  }

  async remove(noteId: string): Promise<{ id: string }> {
    await this.prisma.note.delete({ where: { id: noteId } });
    return { id: noteId };
  }

  /** Deletes only the notes the user owns; returns the ids actually deleted. */
  async batchDelete(
    userId: string,
    ids: string[],
  ): Promise<{ deleted: string[] }> {
    const owned = await this.prisma.note.findMany({
      where: { id: { in: ids }, ownerId: userId },
      select: { id: true },
    });
    const deletable = owned.map((n) => n.id);
    if (deletable.length > 0) {
      await this.prisma.note.deleteMany({ where: { id: { in: deletable } } });
    }
    return { deleted: deletable };
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
      this.prisma.noteShare.deleteMany({ where: { noteId } }),
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

  private toSummary(note: Note, userId: string): NoteSummary {
    return {
      id: note.id,
      title: note.title,
      visibility: note.visibility,
      ownerId: note.ownerId,
      isOwner: note.ownerId === userId,
      position: note.position,
      updatedAt: note.updatedAt,
      contentUpdatedAt: note.contentUpdatedAt,
      preview: extractPlainText(note.content),
    };
  }
}
