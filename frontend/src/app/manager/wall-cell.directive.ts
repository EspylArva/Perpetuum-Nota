import {
  Directive,
  ElementRef,
  OnDestroy,
  OnInit,
  inject,
  input,
  output,
} from '@angular/core';

export const WALL_CELL = 40; // grid cell size in px
export const WALL_CARD_CELLS = 6; // card footprint width in cells
export const WALL_GUTTER = 8; // visual inset inside the snapped footprint

/**
 * Snaps a wall card's height up to the nearest grid multiple ("fill available
 * space limited to the nearest grid line") and reports its footprint height in
 * cells so the layout can avoid overlaps.
 */
@Directive({ selector: '[appWallCell]' })
export class WallCellDirective implements OnInit, OnDestroy {
  /** Identifies the card in heightCells events. */
  readonly appWallCell = input.required<string>();
  readonly heightCells = output<{ id: string; cells: number }>();

  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  private observer?: ResizeObserver;
  private lastCells = 0;

  ngOnInit(): void {
    const node = this.el.nativeElement;
    this.observer = new ResizeObserver(() => this.snap(node));
    this.observer.observe(node);
    this.snap(node);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  private snap(node: HTMLElement): void {
    // Natural content height (clear our own min-height so shrinking works).
    node.style.minHeight = '0';
    const natural = node.scrollHeight + WALL_GUTTER;
    const cells = Math.max(2, Math.ceil(natural / WALL_CELL));
    node.style.minHeight = `${cells * WALL_CELL - WALL_GUTTER}px`;
    if (cells !== this.lastCells) {
      this.lastCells = cells;
      this.heightCells.emit({ id: this.appWallCell(), cells });
    }
  }
}
