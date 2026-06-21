import { Component, computed, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import type { FolderDto } from '@perpetuum-nota/shared';
import { buildFolderTree, type FolderNode } from './folder-tree.util';

/**
 * Recursive sidebar folder tree. Takes the flat folder list (built into a tree
 * client-side), the currently active folder id, and the set of expanded ids.
 * Emits intent events; the parent (Manager) owns all state + API calls.
 */
@Component({
  selector: 'app-folder-tree',
  imports: [MatIconModule, MatMenuModule],
  templateUrl: './folder-tree.html',
  styleUrl: './folder-tree.scss',
})
export class FolderTree {
  /** Flat folder list from the API (built into a tree internally). */
  readonly folders = input<FolderDto[]>([]);
  /** Pre-built nodes — set on recursive child instances instead of `folders`. */
  readonly nodes = input<FolderNode[] | null>(null);
  /** Id of the folder currently filtering the list, if any. */
  readonly activeId = input<string | null>(null);
  /** Set of expanded folder ids (shared across the whole tree). */
  readonly expanded = input<ReadonlySet<string>>(new Set<string>());

  readonly select = output<string>();
  readonly toggle = output<string>();
  readonly newSubfolder = output<FolderNode>();
  readonly rename = output<FolderNode>();
  readonly moveTo = output<FolderNode>();
  readonly remove = output<FolderNode>();

  /** Roots to render: pre-built nodes if given, else build from the flat list. */
  readonly roots = computed<FolderNode[]>(
    () => this.nodes() ?? buildFolderTree(this.folders()),
  );

  isExpanded(id: string): boolean {
    return this.expanded().has(id);
  }
}
