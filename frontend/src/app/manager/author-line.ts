import type { NoteSummaryDto } from '@perpetuum-nota/shared';
import { timeAgo } from './time-ago';

/**
 * One-line attribution shown under list rows, in the note panel header, and as
 * the wall-card tooltip: "by {owner} · edited {when}[ by {editor}]". The
 * "by {editor}" segment is omitted when the note has never had a distinct editor.
 */
export function authorLine(note: NoteSummaryDto): string {
  let line = `by ${note.ownerName} · edited ${timeAgo(note.updatedAt)}`;
  if (note.lastEditedByName) line += ` by ${note.lastEditedByName}`;
  return line;
}
