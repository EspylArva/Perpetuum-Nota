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
  extractWikilinks,
  isProseMirrorDoc,
  previewFromText,
  renameWikilinks,
  rewriteUploadSrcs,
} from '../common/prosemirror-text';
import { UploadsService } from '../uploads/uploads.service';
import { CreateNoteDto } from './dto/create-note.dto';
import { UpdateNoteDto } from './dto/update-note.dto';
import { UpdateNoteContentDto } from './dto/update-note-content.dto';

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
   *
   * @internal Public so collaborator services can reuse the canonical rename
   * propagation; today only NotesService.updateMeta calls it.
   */
  async propagateRename(
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
   *
   * @internal Exposed so collaborator services (NotesBatchService.importNotes)
   * can reuse the canonical link-resolution logic inside their own transaction.
   */
  async recomputeLinks(
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
   *
   * @internal Public so collaborator services can reuse the canonical outgoing-
   * link resolution; today only NotesService.findOne calls it.
   */
  async resolveLinks(noteId: string): Promise<{ id: string; title: string }[]> {
    const links = await this.prisma.noteLink.findMany({
      where: { fromNoteId: noteId, to: { deletedAt: null } },
      select: { to: { select: { id: true, title: true } } },
      orderBy: { to: { title: 'asc' } },
    });
    return links.map((l) => ({ id: l.to.id, title: l.to.title }));
  }

  /**
   * @internal Shared Prisma `include` shape for loading a note with the
   * relations toSummary needs. Public so collaborator services
   * (NotesQueryService) build identically-shaped queries.
   */
  metaInclude(userId: string) {
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

  /**
   * @internal Maps a metaInclude-loaded note row to the wire NoteSummary for a
   * given viewer (canEdit + seen depend on the viewer). Public so collaborator
   * services (NotesQueryService) reuse the exact same mapping.
   */
  toSummary(note: NoteWithMeta, userId: string): NoteSummary {
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
