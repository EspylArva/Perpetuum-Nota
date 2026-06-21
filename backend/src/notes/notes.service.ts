import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Note, Prisma, Visibility } from '@prisma/client';
import type { NoteExportItemDto, ProseMirrorDoc } from '@perpetuum-nota/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  EMPTY_DOC,
  extractSearchText,
  extractWikilinks,
  isProseMirrorDoc,
  previewFromText,
  renameWikilinks,
  rewriteUploadSrcs,
} from '../common/prosemirror-text';
import { UploadsService } from '../uploads/uploads.service';
import { CreateNoteDto } from './dto/create-note.dto';
import { ImportNoteDto } from './dto/import-notes.dto';
import { UpdateNoteDto } from './dto/update-note.dto';
import { UpdateNoteContentDto } from './dto/update-note-content.dto';

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

export interface NoteSummary {
  id: string;
  title: string;
  visibility: Visibility;
  ownerId: string;
  ownerName: string;
  isOwner: boolean;
  /** Whether THIS viewer may edit the note (owner, public, or editor grant). */
  canEdit: boolean;
  lastEditedByName: string | null;
  position: number;
  pinned: boolean;
  wallX: number | null;
  wallY: number | null;
  deletedAt: Date | null;
  dueDate: Date | null;
  /** Organizational folder the note lives in; null = root (no folder). */
  folderId: string | null;
  updatedAt: Date;
  contentUpdatedAt: Date;
  preview: string;
  tags: string[];
  /** False only for a share grant the recipient hasn't opened yet. */
  seen: boolean;
}

type NoteWithMeta = Note & {
  tags: { tag: { name: string } }[];
  shares: { seenAt: Date | null; canEdit: boolean }[];
  owner: { displayName: string };
  lastEditedBy: { displayName: string } | null;
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
    const { filter, q, tag, dueAfter, dueBefore, folderId } = opts;

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
      include: this.metaInclude(userId),
      orderBy: this.orderBy(opts.sort),
    });
    return notes.map((n) => this.toSummary(n, userId));
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
        return [pinnedFirst, { dueDate: { sort: 'asc', nulls: 'last' } }, { position: 'asc' }];
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
    const links = await this.resolveLinks(noteId);
    return { ...this.toSummary(note, userId), content: note.content, links };
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
    // When filing into a folder, the target folder must belong to the acting
    // user, and the note being filed must be owned by them (a folder is the
    // owner's private organization; you never file someone else's note). null
    // clears the folder (move to root).
    if (dto.folderId !== undefined && dto.folderId !== null) {
      const note = await this.prisma.note.findUnique({
        where: { id: noteId },
        select: { ownerId: true },
      });
      if (!note || note.ownerId !== userId) {
        throw new NotFoundException('Note not found');
      }
      const folder = await this.prisma.folder.findUnique({
        where: { id: dto.folderId },
        select: { ownerId: true },
      });
      if (!folder || folder.ownerId !== userId) {
        throw new NotFoundException('Folder not found');
      }
    }

    // On a rename, capture the old title so we can rewrite `[[Old Title]]`
    // references in other notes once the new title is committed.
    let oldTitle: string | null = null;
    if (dto.title !== undefined) {
      const cur = await this.prisma.note.findUnique({
        where: { id: noteId },
        select: { title: true },
      });
      oldTitle = cur?.title ?? null;
    }

    const note = await this.prisma.note.update({
      where: { id: noteId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.pinned !== undefined ? { pinned: dto.pinned } : {}),
        ...(dto.wallX !== undefined ? { wallX: dto.wallX } : {}),
        ...(dto.wallY !== undefined ? { wallY: dto.wallY } : {}),
        // null clears the column; an ISO string sets it.
        ...(dto.dueDate !== undefined
          ? { dueDate: dto.dueDate === null ? null : new Date(dto.dueDate) }
          : {}),
        // null clears the folder (move to root); a uuid files it.
        ...(dto.folderId !== undefined ? { folderId: dto.folderId } : {}),
        // Attribute the edit to the acting user (today always the owner).
        lastEditedById: userId,
      },
      include: this.metaInclude(userId),
    });

    if (oldTitle !== null && oldTitle !== note.title) {
      await this.propagateRename(noteId, oldTitle, note.title);
    }

    return this.toSummary(note, userId);
  }

  /**
   * Keeps referencing notes in sync after a rename: rewrites `[[Old Title]]`
   * (node or legacy text form) → `[[New Title]]` in every note that links to the
   * renamed note, then recomputes that note's links + search text. NoteLink edges
   * are stored by id, so they survive a rename on their own — but the body text
   * and the inline pill would still show the old title, and the next content save
   * of the referencing note would drop the edge (the old title no longer resolves)
   * without this rewrite. Best-effort across all referencing notes (incl. trashed,
   * so a later restore stays consistent).
   */
  private async propagateRename(
    targetId: string,
    oldTitle: string,
    newTitle: string,
  ): Promise<void> {
    const refs = await this.prisma.noteLink.findMany({
      where: { toNoteId: targetId },
      select: { fromNoteId: true },
    });
    const fromIds = [...new Set(refs.map((r) => r.fromNoteId))].filter(
      (id) => id !== targetId,
    );
    if (fromIds.length === 0) return;

    await this.prisma.$transaction(async (tx) => {
      const notes = await tx.note.findMany({
        where: { id: { in: fromIds } },
        select: { id: true, content: true },
      });
      const now = new Date();
      for (const n of notes) {
        const { doc, changed } = renameWikilinks(n.content, oldTitle, newTitle);
        if (!changed) continue;
        await tx.note.update({
          where: { id: n.id },
          data: {
            content: doc as Prisma.InputJsonValue,
            contentText: extractSearchText(doc),
            contentUpdatedAt: now,
          },
        });
        await this.recomputeLinks(tx, n.id, doc);
      }
    });
  }

  async updateContent(
    noteId: string,
    userId: string,
    dto: UpdateNoteContentDto,
  ) {
    if (!isProseMirrorDoc(dto.content)) {
      throw new BadRequestException('content must be a ProseMirror "doc" node');
    }
    const contentText = extractSearchText(dto.content);
    const now = new Date();
    const data = {
      content: dto.content as Prisma.InputJsonValue,
      contentText,
      contentUpdatedAt: now,
      // Attribute the edit to the acting user (today always the owner).
      lastEditedById: userId,
    };

    let base: Date | undefined;
    if (dto.baseContentUpdatedAt) {
      base = new Date(dto.baseContentUpdatedAt);
      if (Number.isNaN(base.getTime())) {
        throw new BadRequestException(
          'baseContentUpdatedAt must be an ISO timestamp',
        );
      }
    }

    // Content write + wikilink recompute share one transaction so the stored
    // links always match the persisted body. On the optimistic-concurrency path
    // (base set) we only recompute links AFTER confirming the write landed
    // (updateMany matched a row); a 0-row match is a 409 and leaves links alone.
    return this.prisma.$transaction(async (tx) => {
      if (base) {
        const res = await tx.note.updateMany({
          where: { id: noteId, contentUpdatedAt: base },
          data,
        });
        if (res.count === 0) {
          throw new ConflictException('Note was modified elsewhere');
        }
        const links = await this.recomputeLinks(tx, noteId, dto.content);
        return { contentUpdatedAt: now, links };
      }

      const note = await tx.note.update({
        where: { id: noteId },
        data,
        select: { contentUpdatedAt: true },
      });
      const links = await this.recomputeLinks(tx, noteId, dto.content);
      return { contentUpdatedAt: note.contentUpdatedAt, links };
    });
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
          await this.recomputeLinks(tx, c.id, c.content);
        }
      },
      // Generous ceiling — an import can be up to a few hundred notes.
      { timeout: 60_000 },
    );

    return { created: titles.length, titles };
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
    let finalContent: unknown = src.content;
    if (idMap.size > 0) {
      finalContent = rewriteUploadSrcs(src.content, idMap);
      await this.prisma.note.update({
        where: { id: created.id },
        data: { content: finalContent as Prisma.InputJsonValue },
      });
    }

    // Resolve the clone's wikilinks against the NEW owner's namespace.
    await this.prisma.$transaction((tx) =>
      this.recomputeLinks(tx, created.id, finalContent),
    );

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

  /**
   * Recomputes a note's OUTGOING wikilinks from its content and rewrites the
   * NoteLink rows for that note, inside the caller's transaction. Resolution
   * rules: titles are matched case-insensitively against the note OWNER's live
   * (non-trashed) notes; on >1 match the most recently `updatedAt` wins; titles
   * that resolve to nothing produce no row; a note linking its own title is
   * skipped. Links are stored BY ID, so renaming a target later does not rewrite
   * this source's text — the stored edge keeps working and the UI shows the
   * target's current title. Called on every content-persisting write.
   */
  private async recomputeLinks(
    tx: Prisma.TransactionClient,
    noteId: string,
    content: unknown,
  ): Promise<{ id: string; title: string }[]> {
    const self = await tx.note.findUnique({
      where: { id: noteId },
      select: { ownerId: true },
    });
    if (!self) return [];

    const titles = extractWikilinks(content);

    // Resolve titles → target ids within the owner's namespace. One query for
    // all candidate matches, then pick per title (most-recent on ambiguity).
    const targetIds: string[] = [];
    const resolved: { id: string; title: string }[] = [];
    if (titles.length > 0) {
      const candidates = await tx.note.findMany({
        where: {
          ownerId: self.ownerId,
          deletedAt: null,
          // Case-insensitive exact title match for any of the requested titles.
          OR: titles.map((t) => ({
            title: { equals: t, mode: 'insensitive' as const },
          })),
        },
        select: { id: true, title: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' }, // first match per title = most recent
      });

      for (const title of titles) {
        const lower = title.toLowerCase();
        const match = candidates.find((c) => c.title.toLowerCase() === lower);
        if (!match) continue; // unresolved → no row
        if (match.id === noteId) continue; // skip self-links
        if (!targetIds.includes(match.id)) {
          targetIds.push(match.id);
          resolved.push({ id: match.id, title: match.title });
        }
      }
    }

    // Replace the note's outgoing edge set wholesale.
    await tx.noteLink.deleteMany({ where: { fromNoteId: noteId } });
    if (targetIds.length > 0) {
      await tx.noteLink.createMany({
        data: targetIds.map((toNoteId) => ({ fromNoteId: noteId, toNoteId })),
        skipDuplicates: true,
      });
    }

    // Return the resolved links (id + current title) in the same alphabetical
    // order resolveLinks() uses, so callers can echo the fresh link set back to
    // the client without a second round-trip.
    resolved.sort((a, b) => a.title.localeCompare(b.title));
    return resolved;
  }

  /**
   * Resolves a note's outgoing links for the single-note DTO: each target's id
   * and CURRENT title, excluding trashed targets. Edges are stored by id so a
   * renamed target surfaces here under its new title automatically.
   */
  private async resolveLinks(
    noteId: string,
  ): Promise<{ id: string; title: string }[]> {
    const links = await this.prisma.noteLink.findMany({
      where: { fromNoteId: noteId, to: { deletedAt: null } },
      select: { to: { select: { id: true, title: true } } },
      orderBy: { to: { title: 'asc' } },
    });
    return links.map((l) => ({ id: l.to.id, title: l.to.title }));
  }

  private metaInclude(userId: string) {
    return {
      tags: {
        select: { tag: { select: { name: true } } },
        orderBy: { tag: { name: 'asc' as const } },
      },
      shares: { where: { userId }, select: { seenAt: true, canEdit: true } },
      owner: { select: { displayName: true } },
      lastEditedBy: { select: { displayName: true } },
    };
  }

  private toSummary(note: NoteWithMeta, userId: string): NoteSummary {
    const grant = note.shares[0];
    const isOwner = note.ownerId === userId;
    // Editable when: owner, PUBLIC (everyone-editable), or an editor grant.
    const canEdit =
      isOwner || note.visibility === 'PUBLIC' || (grant?.canEdit ?? false);
    return {
      id: note.id,
      title: note.title,
      visibility: note.visibility,
      ownerId: note.ownerId,
      ownerName: note.owner.displayName,
      isOwner,
      canEdit,
      lastEditedByName: note.lastEditedBy?.displayName ?? null,
      position: note.position,
      pinned: note.pinned,
      wallX: note.wallX,
      wallY: note.wallY,
      deletedAt: note.deletedAt,
      dueDate: note.dueDate,
      folderId: note.folderId,
      updatedAt: note.updatedAt,
      contentUpdatedAt: note.contentUpdatedAt,
      preview: previewFromText(note.contentText),
      tags: note.tags.map((t) => t.tag.name),
      seen: note.ownerId === userId || !grant || grant.seenAt !== null,
    };
  }
}
