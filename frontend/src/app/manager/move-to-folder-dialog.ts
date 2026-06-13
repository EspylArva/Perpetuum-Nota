import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { Observable } from 'rxjs';
import type { FolderDto } from '@stickynotes/shared';
import { buildFolderTree, type FolderNode } from './folder-tree.util';

export interface MoveToFolderData {
  folders: FolderDto[];
  /** The note's current folder id (highlighted), or null = root. */
  currentFolderId: string | null;
}

/**
 * Result of the dialog: the chosen folder id, or null for "No folder (root)".
 * The dialog closes with `undefined` when cancelled (no change).
 */
export type MoveToFolderResult = string | null;

interface FlatRow {
  id: string;
  name: string;
  depth: number;
}

@Component({
  selector: 'app-move-to-folder-dialog',
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <h2 mat-dialog-title>Move to folder</h2>
    <mat-dialog-content>
      <div class="folder-list">
        <button
          type="button"
          class="folder-opt"
          [class.selected]="selectedId() === null"
          (click)="selectedId.set(null)"
        >
          <mat-icon inline>folder_off</mat-icon>
          <span>No folder (root)</span>
          @if (currentFolderId === null) {
            <span class="badge">Current</span>
          }
        </button>
        @for (row of rows(); track row.id) {
          <button
            type="button"
            class="folder-opt"
            [class.selected]="selectedId() === row.id"
            [style.paddingLeft.px]="10 + row.depth * 16"
            (click)="selectedId.set(row.id)"
          >
            <mat-icon inline>folder</mat-icon>
            <span class="name">{{ row.name }}</span>
            @if (currentFolderId === row.id) {
              <span class="badge">Current</span>
            }
          </button>
        }
        @if (rows().length === 0) {
          <p class="muted">You have no folders yet. Create one from the sidebar.</p>
        }
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton mat-dialog-close>Cancel</button>
      <button matButton="filled" (click)="confirm()">Move here</button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      .folder-list {
        display: flex;
        flex-direction: column;
        gap: 0.1rem;
        min-width: 280px;
        max-height: 50vh;
        overflow: auto;
      }
      .folder-opt {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        border: none;
        background: transparent;
        color: inherit;
        cursor: pointer;
        text-align: left;
        padding: 0.45rem 0.6rem;
        border-radius: 6px;
        font: inherit;
        font-size: 0.9rem;
        &:hover {
          background: var(--mat-sys-surface-container-high);
        }
        &.selected {
          background: var(--mat-sys-secondary-container);
          color: var(--mat-sys-on-secondary-container);
        }
        .name {
          flex: 1 1 auto;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .badge {
          font-size: 0.68rem;
          padding: 0.05rem 0.4rem;
          border-radius: 999px;
          background: var(--mat-sys-surface-container-highest);
          color: var(--mat-sys-on-surface-variant);
        }
      }
      .muted {
        color: var(--mat-sys-on-surface-variant);
        font-size: 0.85rem;
        padding: 0.5rem;
      }
    `,
  ],
})
export class MoveToFolderDialog {
  readonly data = inject<MoveToFolderData>(MAT_DIALOG_DATA);
  private readonly ref =
    inject<MatDialogRef<MoveToFolderDialog, MoveToFolderResult>>(MatDialogRef);

  readonly currentFolderId = this.data.currentFolderId;
  readonly selectedId = signal<string | null>(this.data.currentFolderId);

  /** Flattened tree (depth-first) so the dialog list mirrors the sidebar tree. */
  readonly rows = computed<FlatRow[]>(() => {
    const out: FlatRow[] = [];
    const walk = (nodes: FolderNode[]) => {
      for (const n of nodes) {
        out.push({ id: n.id, name: n.name, depth: n.depth });
        walk(n.children);
      }
    };
    walk(buildFolderTree(this.data.folders));
    return out;
  });

  confirm(): void {
    this.ref.close(this.selectedId());
  }
}

/** Opens the move-to-folder dialog; resolves with the chosen folder id, null
 * (root), or undefined when cancelled. */
export function openMoveToFolder(
  dialog: MatDialog,
  data: MoveToFolderData,
): Observable<MoveToFolderResult | undefined> {
  return dialog
    .open<MoveToFolderDialog, MoveToFolderData, MoveToFolderResult>(
      MoveToFolderDialog,
      { data, width: '360px', autoFocus: false },
    )
    .afterClosed();
}
