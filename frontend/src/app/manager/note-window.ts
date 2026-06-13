import { Component, ElementRef, inject, input, output } from '@angular/core';
import { CdkDrag, CdkDragHandle } from '@angular/cdk/drag-drop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

/**
 * A floating, NON-MODAL, draggable window shell used in WALL mode to host an
 * open note (or a folder mini-grid) over the grid. Purely presentational: the
 * caller projects the header controls + body (e.g. <app-note-editor>) as
 * content, so this shell owns only the frame, the title bar (= drag handle), the
 * close button, and z-index stacking.
 *
 * The grid stays fully interactive because the window has no backdrop. Multiple
 * windows coexist; clicking one raises it (the host emits a raise so the manager
 * can bump this window's z-index above the others).
 *
 * Resizing is delegated to the browser (CSS `resize: both` on the body) — no
 * custom resize handle (YAGNI).
 */
@Component({
  selector: 'app-note-window',
  imports: [CdkDrag, CdkDragHandle, MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    <div
      class="note-window"
      cdkDrag
      cdkDragBoundary=".content"
      [style.left.px]="left()"
      [style.top.px]="top()"
      [style.zIndex]="zIndex()"
      (pointerdown)="raise.emit()"
    >
      <header class="nw-bar" cdkDragHandle>
        <span class="nw-title">{{ title() || 'Untitled' }}</span>
        <button matIconButton class="nw-close" matTooltip="Close"
                aria-label="Close window" (click)="close.emit()">
          <mat-icon>close</mat-icon>
        </button>
      </header>
      <div class="nw-body">
        <ng-content />
      </div>
    </div>
  `,
  styleUrl: './note-window.scss',
})
export class NoteWindow {
  /** Title shown in the bar. */
  readonly title = input<string>('');
  /** Initial viewport-relative position (cascade is computed by the caller). */
  readonly left = input<number>(40);
  readonly top = input<number>(40);
  /** Stacking order; the manager bumps this when the window is raised. */
  readonly zIndex = input<number>(60);

  /** Close button pressed. */
  readonly close = output<void>();
  /** Window received a pointerdown — ask the manager to raise it to the top. */
  readonly raise = output<void>();

  readonly host = inject(ElementRef);
}
