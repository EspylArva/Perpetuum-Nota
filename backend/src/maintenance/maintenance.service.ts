import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  extractReferencedUploadIds,
  extractSearchText,
} from '../common/prosemirror-text';
import { NotesService } from '../notes/notes.service';
import { UploadsService } from '../uploads/uploads.service';

// Sweep cadence and grace windows. Generous on purpose: the sweep must never
// race an in-flight upload or a quick undo.
const SWEEP_INTERVAL_MS = 12 * 60 * 60 * 1000; // every 12h
const FIRST_SWEEP_DELAY_MS = 60 * 1000; // 1 min after boot
const UNREFERENCED_ASSET_GRACE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const ORPHAN_FILE_GRACE_MS = 24 * 60 * 60 * 1000; // 24 h

/**
 * Background maintenance:
 *  1. one-time backfill of Note.contentText for rows created before the
 *     search column existed (idempotent, runs at boot);
 *  2. periodic sweep — purge trash past retention, drop image assets whose
 *     image was removed from the note body (after a grace period), and unlink
 *     disk files that lost their DB row.
 *
 * Plain timers (no @nestjs/schedule dep); single-instance deployment assumed.
 */
@Injectable()
export class MaintenanceService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(MaintenanceService.name);
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notes: NotesService,
    private readonly uploads: UploadsService,
  ) {}

  onApplicationBootstrap(): void {
    void this.backfillContentText();
    this.timer = setTimeout(() => void this.sweep(), FIRST_SWEEP_DELAY_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  /** Extracts search text for notes that predate the contentText column. */
  private async backfillContentText(): Promise<void> {
    try {
      const candidates = await this.prisma.note.findMany({
        where: { contentText: '' },
        select: { id: true, content: true },
      });
      let updated = 0;
      for (const note of candidates) {
        const text = extractSearchText(note.content);
        if (!text) continue; // genuinely empty note
        await this.prisma.note.update({
          where: { id: note.id },
          data: { contentText: text },
        });
        updated++;
      }
      if (updated > 0) {
        this.logger.log(`Backfilled contentText for ${updated} note(s)`);
      }
    } catch (err) {
      this.logger.error(`contentText backfill failed: ${String(err)}`);
    }
  }

  async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const purged = await this.notes.purgeExpiredTrash();
      const droppedAssets = await this.sweepUnreferencedAssets();
      const droppedFiles = await this.sweepOrphanFiles();
      if (purged || droppedAssets || droppedFiles) {
        this.logger.log(
          `Sweep: purged ${purged} trashed note(s), ${droppedAssets} unreferenced asset(s), ${droppedFiles} orphan file(s)`,
        );
      }
    } catch (err) {
      this.logger.error(`Sweep failed: ${String(err)}`);
    } finally {
      this.running = false;
      this.timer = setTimeout(() => void this.sweep(), SWEEP_INTERVAL_MS);
    }
  }

  /**
   * Assets whose image node was removed from their note's body (e.g. deleted
   * from the doc, then autosaved) — kept for a grace window so an undo within
   * a few days never breaks, then removed with their files. Trashed notes are
   * skipped entirely: restore must bring images back intact.
   */
  private async sweepUnreferencedAssets(): Promise<number> {
    const cutoff = new Date(Date.now() - UNREFERENCED_ASSET_GRACE_MS);
    const assets = await this.prisma.imageAsset.findMany({
      where: { createdAt: { lt: cutoff }, note: { deletedAt: null } },
      select: {
        id: true,
        storagePath: true,
        noteId: true,
        note: { select: { content: true } },
      },
    });
    if (assets.length === 0) return 0;

    const referencedByNote = new Map<string, Set<string>>();
    const doomed: { id: string; storagePath: string }[] = [];
    for (const asset of assets) {
      let refs = referencedByNote.get(asset.noteId);
      if (!refs) {
        refs = extractReferencedUploadIds(asset.note.content);
        referencedByNote.set(asset.noteId, refs);
      }
      if (!refs.has(asset.id)) {
        doomed.push({ id: asset.id, storagePath: asset.storagePath });
      }
    }
    if (doomed.length === 0) return 0;

    await this.prisma.imageAsset.deleteMany({
      where: { id: { in: doomed.map((a) => a.id) } },
    });
    await this.uploads.deleteFiles(doomed);
    return doomed.length;
  }

  /** Disk files with no ImageAsset row (e.g. crash between write and insert). */
  private async sweepOrphanFiles(): Promise<number> {
    const files = await this.uploads.listDiskFiles();
    if (files.length === 0) return 0;
    const rows = await this.prisma.imageAsset.findMany({
      select: { storagePath: true },
    });
    const known = new Set(rows.map((r) => r.storagePath));
    const cutoff = Date.now() - ORPHAN_FILE_GRACE_MS;
    const orphans = files.filter(
      (f) => !known.has(f.name) && f.mtimeMs < cutoff,
    );
    await this.uploads.deleteFiles(
      orphans.map((f) => ({ storagePath: f.name })),
    );
    return orphans.length;
  }
}
