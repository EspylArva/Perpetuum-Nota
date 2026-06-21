import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NoteSummary, NotesService } from './notes.service';

export type NoteFilter = 'mine' | 'shared' | 'all' | 'trash';
export type NoteSort = 'position' | 'updated' | 'created' | 'title' | 'dueDate';

export interface ListOptions {
  filter: NoteFilter;
  q?: string;
  tag?: string;
  sort?: NoteSort;
  // Inclusive due-date window (plain timestamp comparison; the client computes
  // local-day bounds). Notes with a null dueDate are excluded when either is set.
  dueAfter?: Date;
  dueBefore?: Date;
  // Organizational folder filter — notes directly in this folder (owner only).
  folderId?: string;
}

/**
 * Read-side note queries (list + wikilink graph) split out of NotesService as
 * part of the god-file refactor; method bodies are relocated verbatim. Depends
 * on NotesService for the shared metaInclude + toSummary helpers so list rows
 * map identically to every other endpoint.
 */
@Injectable()
export class NotesQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notes: NotesService,
  ) {}

  async listViewable(
    userId: string,
    opts: ListOptions,
  ): Promise<NoteSummary[]> {
    const { filter, q, tag, dueAfter, dueBefore, folderId } = opts;

    if (filter === 'trash') {
      // Trash is strictly the viewer's own notes; shared/public notes in
      // someone else's trash are invisible (and unviewable, see NoteAccessService).
      const notes = await this.prisma.note.findMany({
        where: { ownerId: userId, deletedAt: { not: null } },
        include: this.notes.metaInclude(userId),
        orderBy: { deletedAt: 'desc' },
      });
      return notes.map((n) => this.notes.toSummary(n, userId));
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

    // Due-date window — inclusive bounds via gte/lte. The {not:null} clause is
    // implied by gte/lte (a NULL dueDate never satisfies a comparison), so
    // null-dueDate notes drop out whenever either bound is present.
    if (dueAfter || dueBefore) {
      and.push({
        dueDate: {
          ...(dueAfter ? { gte: dueAfter } : {}),
          ...(dueBefore ? { lte: dueBefore } : {}),
        },
      });
    }

    // Folder filter — notes directly in this folder. Owner-scoped: only the
    // owner's own folder ids match (the note's owner clause above already
    // narrows the candidate set, and folders never cross accounts).
    if (folderId) {
      and.push({ folderId, ownerId: userId });
    }

    const notes = await this.prisma.note.findMany({
      where: { AND: and },
      include: this.notes.metaInclude(userId),
      orderBy: this.orderBy(opts.sort),
    });
    return notes.map((n) => this.notes.toSummary(n, userId));
  }

  /**
   * Live notes the user may view (owner OR public OR shared-with-them; never
   * trashed). The same scope the list uses for filter='all', factored out so the
   * graph endpoint reuses identical viewability rules.
   */
  private viewableScope(userId: string): Prisma.NoteWhereInput {
    return {
      AND: [
        {
          OR: [
            { ownerId: userId },
            {
              ownerId: { not: userId },
              OR: [{ visibility: 'PUBLIC' }, { shares: { some: { userId } } }],
            },
          ],
        },
        { deletedAt: null },
      ],
    };
  }

  /**
   * Wikilink graph for the requesting user: nodes are the notes they can view,
   * and an undirected edge joins two nodes when a NoteLink exists in EITHER
   * direction AND BOTH endpoints are viewable (a link to a note the requester
   * can't see yields no edge). Undirected pairs are deduped to a single edge
   * (canonical a<b ordering).
   */
  async graph(userId: string): Promise<{
    nodes: { id: string; title: string }[];
    edges: { a: string; b: string }[];
  }> {
    const nodes = await this.prisma.note.findMany({
      where: this.viewableScope(userId),
      select: { id: true, title: true },
      orderBy: { title: 'asc' },
    });
    const ids = new Set(nodes.map((n) => n.id));

    // Pull every edge touching a viewable note in either direction; keep only
    // those whose BOTH endpoints are viewable, then collapse to undirected pairs.
    const links = await this.prisma.noteLink.findMany({
      where: {
        OR: [{ fromNoteId: { in: [...ids] } }, { toNoteId: { in: [...ids] } }],
      },
      select: { fromNoteId: true, toNoteId: true },
    });

    const seen = new Set<string>();
    const edges: { a: string; b: string }[] = [];
    for (const { fromNoteId, toNoteId } of links) {
      if (fromNoteId === toNoteId) continue; // (self-links never persisted, guard anyway)
      if (!ids.has(fromNoteId) || !ids.has(toNoteId)) continue;
      const [a, b] =
        fromNoteId < toNoteId ? [fromNoteId, toNoteId] : [toNoteId, fromNoteId];
      const key = `${a}|${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ a, b });
    }

    return { nodes, edges };
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

  private orderBy(sort?: NoteSort): Prisma.NoteOrderByWithRelationInput[] {
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
      case 'dueDate':
        return [
          pinnedFirst,
          { dueDate: { sort: 'asc', nulls: 'last' } },
          { position: 'asc' },
        ];
      default:
        return [pinnedFirst, { position: 'asc' }, { updatedAt: 'desc' }];
    }
  }
}
