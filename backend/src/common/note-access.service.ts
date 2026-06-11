import { Injectable } from '@nestjs/common';
import { Visibility } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface LoadedNoteAccess {
  note: { ownerId: string; visibility: Visibility } | null;
  shared: boolean;
}

/**
 * Loads the minimal note fields + share-membership needed to evaluate canAccess().
 * Shared by NoteAccessGuard (route guard) and UploadsService (image serving) so
 * both apply identical access rules.
 */
@Injectable()
export class NoteAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async load(noteId: string, userId: string): Promise<LoadedNoteAccess> {
    const note = await this.prisma.note.findUnique({
      where: { id: noteId },
      select: { ownerId: true, visibility: true },
    });
    if (!note) return { note: null, shared: false };

    let shared = false;
    if (note.ownerId !== userId && note.visibility === 'PRIVATE') {
      const grant = await this.prisma.noteShare.findUnique({
        where: { noteId_userId: { noteId, userId } },
        select: { noteId: true },
      });
      shared = grant !== null;
    }
    return { note, shared };
  }
}
