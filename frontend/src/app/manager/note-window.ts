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
 * minimize + close buttons, and z-index stacking.
 *
 * The grid stays fully interactive because the window has no backdrop. Multiple
 * windows coexist; clicking one raises it (the host emits a raise so the manager
 * can bump this window's z-index above the others).
 *
 * Resizing uses a DEDICATED bottom-right grip rather than the browser's native
 * `resize: both`. Native resize lives on the window frame, but the scrollable
 * body sits on the same corner and swallows the pointer first (you scroll instead
 * of resize). The grip is its own element stacked above the body, so the resize
 * zone and the scroll zone no longer overlap — the resize is driven directly via
 * pointer events.
 */
@Component({
  selector: 'app-note-window',
  imports: [CdkDrag, CdkDragHandle, MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    <div
      class="note-window"
      [class.unclip]="unclip()"
      cdkDrag
      cdkDragBoundary=".content"
      [cdkDragFreeDragPosition]="position()"
      (cdkDragEnded)="moved.emit($event.source.getFreeDragPosition())"
      [style.left.px]="left()"
      [style.top.px]="top()"
      [style.zIndex]="zIndex()"
      (pointerdown)="raise.emit()"
    >
      <header class="nw-bar" cdkDragHandle (dblclick)="headerDblclick.emit()">
        <span class="nw-title">{{ title() || 'Untitled' }}</span>
        <button matIconButton class="nw-min" matTooltip="Minimize"
                aria-label="Minimize window" (click)="minimize.emit()">
          <mat-icon>remove</mat-icon>
        </button>
        <button matIconButton class="nw-close" matTooltip="Close"
                aria-label="Close window" (click)="close.emit()">
          <mat-icon>close</mat-icon>
        </button>
      </header>
      <div class="nw-body">
        <ng-content />
      </div>
      <div
        class="nw-resize"
        aria-hidden="true"
        (pointerdown)="startResize($event)"
        (pointermove)="onResize($event)"
        (pointerup)="endResize($event)"
        (pointercancel)="endResize($event)"
      ></div>
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
  /** Drop window clipping so projected tiles can be dragged out (folder windows). */
  readonly unclip = input<boolean>(false);
  /**
   * Persisted drag offset (relative to the cascade left()/top()). Re-applied on
   * re-mount so a window restored from a minimized bubble reappears exactly where
   * the user last dragged it, not back at the cascade origin.
   */
  readonly position = input<{ x: number; y: number }>({ x: 0, y: 0 });

  /** Drag finished — reports the new free-drag offset so the caller can persist it. */
  readonly moved = output<{ x: number; y: number }>();
  /** Close button pressed. */
  readonly close = output<void>();
  /** Minimize button pressed. */
  readonly minimize = output<void>();
  /** Window received a pointerdown — ask the manager to raise it to the top. */
  readonly raise = output<void>();
  /** Title bar double-clicked (folder windows use it to rename the folder). */
  readonly headerDblclick = output<void>();

  readonly host = inject(ElementRef);

  // --- resize (dedicated bottom-right grip) ---
  /** Lower bounds, kept in sync with the CSS min-width/min-height. */
  private readonly MIN_W = 320;
  private readonly MIN_H = 240;
  /** The frame being resized + the gesture's starting geometry (null = idle). */
  private resizeWin: HTMLElement | null = null;
  private startX = 0;
  private startY = 0;
  private startW = 0;
  private startH = 0;

  startResize(event: PointerEvent): void {
    if (event.button !== 0) return;
    const win = (event.target as HTMLElement).closest(
      '.note-window',
    ) as HTMLElement | null;
    if (!win) return;
    // Don't let the drag-to-move handler or the raise/pan logic also react.
    event.preventDefault();
    event.stopPropagation();
    const rect = win.getBoundingClientRect();
    this.resizeWin = win;
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.startW = rect.width;
    this.startH = rect.height;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  }

  onResize(event: PointerEvent): void {
    if (!this.resizeWin) return;
    const w = Math.max(this.MIN_W, this.startW + (event.clientX - this.startX));
    const h = Math.max(this.MIN_H, this.startH + (event.clientY - this.startY));
    this.resizeWin.style.width = `${w}px`;
    this.resizeWin.style.height = `${h}px`;
  }

  endResize(event: PointerEvent): void {
    if (!this.resizeWin) return;
    this.resizeWin = null;
    const handle = event.target as HTMLElement;
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
  }
}
