import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFolderDto } from './dto/create-folder.dto';
import { UpdateFolderDto } from './dto/update-folder.dto';

export interface FolderSummary {
  id: string;
  name: string;
  parentId: string | null;
  /** Live (non-trashed) notes directly in this folder. */
  noteCount: number;
}

@Injectable()
export class FoldersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Flat list of the caller's folders with direct live-note counts. */
  async listMine(userId: string): Promise<FolderSummary[]> {
    const folders = await this.prisma.folder.findMany({
      where: { ownerId: userId },
      include: {
        _count: {
          select: { notes: { where: { deletedAt: null } } },
        },
      },
      orderBy: { name: 'asc' },
    });
    return folders.map((f) => ({
      id: f.id,
      name: f.name,
      parentId: f.parentId,
      noteCount: f._count.notes,
    }));
  }

  async create(userId: string, dto: CreateFolderDto): Promise<FolderSummary> {
    const parentId = dto.parentId ?? null;
    if (parentId) await this.assertOwnedFolder(parentId, userId);

    const folder = await this.prisma.folder.create({
      data: { ownerId: userId, name: dto.name.trim(), parentId },
    });
    return {
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId,
      noteCount: 0,
    };
  }

  /** Rename and/or move. Rejects moves that would create a cycle (400). */
  async update(
    folderId: string,
    userId: string,
    dto: UpdateFolderDto,
  ): Promise<FolderSummary> {
    await this.assertOwnedFolder(folderId, userId);

    // parentId is only changed when present in the body. `undefined` = leave it.
    const moving = dto.parentId !== undefined;
    const newParentId = dto.parentId ?? null;

    // Self-parent is a pure value check — reject it up front (400). It need not
    // be inside the transaction.
    if (moving && newParentId === folderId) {
      throw new BadRequestException('A folder cannot be its own parent');
    }

    // The cycle check (a read walk up the parent chain) and the parentId write
    // must be atomic: run them in one Serializable transaction so two
    // concurrent moves can't each pass the check and then both commit a cycle.
    // All reads in the walk use the same `tx` client as the final update.
    const folder = await this.prisma.$transaction(
      async (tx) => {
        if (moving && newParentId) {
          await this.assertOwnedFolder(newParentId, userId, tx);
          // Reject moving a folder under one of its own descendants (would
          // orphan a subtree into a cycle). Walk up from the target parent; if
          // we hit the folder being moved, the target is inside its subtree.
          if (await this.isDescendant(newParentId, folderId, userId, tx)) {
            throw new BadRequestException(
              'Cannot move a folder into its own descendant',
            );
          }
        }

        return tx.folder.update({
          where: { id: folderId },
          data: {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...(moving ? { parentId: newParentId } : {}),
          },
          include: {
            _count: { select: { notes: { where: { deletedAt: null } } } },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return {
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId,
      noteCount: folder._count.notes,
    };
  }

  /**
   * Deletes a folder, reparenting its direct children + notes up to its own
   * parent (null if it was a root) within a transaction BEFORE removing the
   * row — so deleting a folder never loses notes or subfolders. The DB cascade
   * on the self-relation is never exercised on this path.
   */
  async remove(folderId: string, userId: string): Promise<{ id: string }> {
    const folder = await this.assertOwnedFolder(folderId, userId);
    const newParentId = folder.parentId; // grandparent, or null if folder was root

    await this.prisma.$transaction([
      // Notes in this folder move up to the parent.
      this.prisma.note.updateMany({
        where: { folderId, ownerId: userId },
        data: { folderId: newParentId },
      }),
      // Child folders move up to the parent.
      this.prisma.folder.updateMany({
        where: { parentId: folderId, ownerId: userId },
        data: { parentId: newParentId },
      }),
      this.prisma.folder.delete({ where: { id: folderId } }),
    ]);
    return { id: folderId };
  }

  /**
   * Loads a folder and asserts the caller owns it, else 404. Accepts an
   * optional transaction client so the check can run inside a transaction.
   */
  private async assertOwnedFolder(
    folderId: string,
    userId: string,
    client: Prisma.TransactionClient = this.prisma,
  ) {
    const folder = await client.folder.findUnique({
      where: { id: folderId },
    });
    if (!folder || folder.ownerId !== userId) {
      throw new NotFoundException('Folder not found');
    }
    return folder;
  }

  /**
   * True if `candidateId` lies in the subtree rooted at `ancestorId` (i.e.
   * walking up the parent chain from `candidateId` reaches `ancestorId`).
   * Owner-scoped and cycle-safe (bounded by visited set).
   */
  private async isDescendant(
    candidateId: string,
    ancestorId: string,
    userId: string,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<boolean> {
    const visited = new Set<string>();
    let current: string | null = candidateId;
    while (current) {
      if (current === ancestorId) return true;
      if (visited.has(current)) break; // defensive: pre-existing data cycle
      visited.add(current);
      const node: { parentId: string | null } | null =
        await client.folder.findFirst({
          where: { id: current, ownerId: userId },
          select: { parentId: true },
        });
      if (!node) break;
      current = node.parentId;
    }
    return false;
  }
}
