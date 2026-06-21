import { Injectable } from '@nestjs/common';
import { Visibility } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Note visibility + share-grant management. Split out of NotesService as part of
 * the god-file refactor; method bodies are relocated verbatim. Owner-only
 * surface (the controller guards these with NoteAccess('manage')), so it needs
 * no shared NotesService helpers — just Prisma.
 */
@Injectable()
export class NotesSharingService {
  constructor(private readonly prisma: PrismaService) {}

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
      sharedWith: shares.map((s) => ({ ...s.user, canEdit: s.canEdit })),
    };
  }

  /**
   * Replaces the grant set with the given users (active, non-owner only), each
   * at its requested level (canEdit true = editor, false = read-only). Existing
   * grants are upserted so their seenAt survives a level change; users absent
   * from the list are revoked.
   */
  async setShares(
    noteId: string,
    ownerId: string,
    grants: { userId: string; canEdit: boolean }[],
  ) {
    const requestedIds = grants.map((g) => g.userId);
    const valid = await this.prisma.user.findMany({
      where: { id: { in: requestedIds }, isActive: true, NOT: { id: ownerId } },
      select: { id: true },
    });
    const validIds = new Set(valid.map((u) => u.id));
    const editById = new Map(grants.map((g) => [g.userId, !!g.canEdit]));
    const ids = [...validIds];

    await this.prisma.$transaction([
      // Revoke grants for anyone no longer in the list (notIn: [] removes all).
      this.prisma.noteShare.deleteMany({
        where: { noteId, userId: { notIn: ids } },
      }),
      // Upsert each remaining grant so seenAt is preserved while canEdit updates.
      ...ids.map((userId) =>
        this.prisma.noteShare.upsert({
          where: { noteId_userId: { noteId, userId } },
          create: { noteId, userId, canEdit: editById.get(userId) ?? false },
          update: { canEdit: editById.get(userId) ?? false },
        }),
      ),
    ]);
    return this.getShares(noteId);
  }
}
