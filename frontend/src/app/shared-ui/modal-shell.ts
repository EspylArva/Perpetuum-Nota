import { Component, input, output } from '@angular/core';

/**
 * Generic presentational modal frame: a scrim backdrop centring a surface card,
 * with content projected via `<ng-content>`. Emits `close` on backdrop click
 * (unless disabled) and on Escape. Width is parametrised through the
 * `--modal-w` custom property so callers size the card without restyling.
 *
 * This is the inline, `@if`-rendered dialog idiom (the caller owns when it
 * mounts), factored out of the hand-rolled share/reset dialogs. For transient
 * fire-and-forget prompts, prefer the imperative MatDialog helpers instead
 * (confirm-dialog / name-dialog).
 */
@Component({
  selector: 'app-modal-shell',
  template: `
    <div class="backdrop" (click)="onBackdrop()">
      <div
        class="dialog"
        [style.--modal-w]="width()"
        role="dialog"
        aria-modal="true"
        (click)="$event.stopPropagation()"
      >
        <ng-content />
      </div>
    </div>
  `,
  styles: [
    `
      .backdrop {
        position: fixed; inset: 0;
        background: color-mix(in srgb, var(--mat-sys-scrim) 45%, transparent);
        display: grid; place-items: center; z-index: 60; padding: 1.5rem;
      }
      .dialog {
        width: min(var(--modal-w, 460px), 100%);
        background: var(--mat-sys-surface-container-high);
        color: var(--mat-sys-on-surface);
        border-radius: 16px;
        padding: 1.25rem 1.4rem;
        box-shadow: var(--mat-sys-level5);
      }
    `,
  ],
  host: { '(document:keydown.escape)': 'onEsc()' },
})
export class ModalShell {
  /** Max card width as any CSS length (clamped to 100% of the viewport). */
  readonly width = input<string>('460px');
  /** When false, clicking the scrim does not close the modal. */
  readonly closeOnBackdrop = input<boolean>(true);
  readonly close = output<void>();

  onBackdrop(): void {
    if (this.closeOnBackdrop()) this.close.emit();
  }

  onEsc(): void {
    this.close.emit();
  }
}
