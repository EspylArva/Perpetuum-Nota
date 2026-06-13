import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface TagSummary {
  id: string;
  name: string;
  /** Live (non-trashed) notes carrying this tag. */
  count: number;
}

const MAX_TAGS_PER_NOTE = 20;

@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The caller's tags with live-note counts, name-sorted. */
  async listMine(userId: string): Promise<TagSummary[]> {
    const tags = await this.prisma.tag.findMany({
      where: { ownerId: userId },
      include: {
        _count: {
          select: { notes: { where: { note: { deletedAt: null } } } },
        },
      },
      orderBy: { name: 'asc' },
    });
    return tags.map((t) => ({ id: t.id, name: t.name, count: t._count.notes }));
  }

  /**
   * Replaces a note's tag set with the given names (create-on-use). Names are
   * trimmed, whitespace-collapsed, and deduped case-insensitively (an existing
   * tag wins over a re-typed variant of itself). Tags left with no notes are
   * pruned so the sidebar stays tidy.
   */
  async setNoteTags(
    noteId: string,
    ownerId: string,
    names: string[],
  ): Promise<{ tags: string[] }> {
    const cleaned: string[] = [];
    const seen = new Set<string>();
    for (const raw of names) {
      const name = raw.trim().replace(/\s+/g, ' ');
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      cleaned.push(name);
      if (cleaned.length >= MAX_TAGS_PER_NOTE) break;
    }

    // Resolve case-insensitively against existing tags so "Work" and "work"
    // never coexist for one owner.
    const existing = await this.prisma.tag.findMany({
      where: { ownerId },
      select: { id: true, name: true },
    });
    const byKey = new Map(existing.map((t) => [t.name.toLowerCase(), t]));

    const tagIds: string[] = [];
    for (const name of cleaned) {
      const hit = byKey.get(name.toLowerCase());
      if (hit) {
        tagIds.push(hit.id);
      } else {
        // Upsert on the (ownerId, name) unique so a concurrent create of the
        // same tag can't blow up with a constraint violation.
        const created = await this.prisma.tag.upsert({
          where: { ownerId_name: { ownerId, name } },
          create: { ownerId, name },
          update: {},
        });
        tagIds.push(created.id);
      }
    }

    await this.prisma.$transaction([
      this.prisma.noteTag.deleteMany({
        where: { noteId, tagId: { notIn: tagIds } },
      }),
      ...(tagIds.length
        ? [
            this.prisma.noteTag.createMany({
              data: tagIds.map((tagId) => ({ noteId, tagId })),
              skipDuplicates: true,
            }),
          ]
        : []),
      // Prune tags that no longer label any note.
      this.prisma.tag.deleteMany({
        where: { ownerId, notes: { none: {} }, id: { notIn: tagIds } },
      }),
      // Attribute the edit to the acting user (today always the owner) and bump
      // updatedAt via Prisma's @updatedAt.
      this.prisma.note.update({
        where: { id: noteId },
        data: { lastEditedById: ownerId },
      }),
    ]);

    const current = await this.prisma.noteTag.findMany({
      where: { noteId },
      select: { tag: { select: { name: true } } },
      orderBy: { tag: { name: 'asc' } },
    });
    return { tags: current.map((t) => t.tag.name) };
  }

  /** Deletes one of the caller's tags everywhere (notes keep their other tags). */
  async remove(tagId: string, userId: string): Promise<{ id: string }> {
    const tag = await this.prisma.tag.findUnique({ where: { id: tagId } });
    if (!tag || tag.ownerId !== userId) {
      throw new NotFoundException('Tag not found');
    }
    await this.prisma.tag.delete({ where: { id: tagId } });
    return { id: tagId };
  }
}
