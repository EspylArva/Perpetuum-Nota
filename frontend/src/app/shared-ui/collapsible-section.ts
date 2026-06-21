import { Component, OnInit, input, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

const STORAGE_PREFIX = 'aux-collapsed:';

/**
 * Generic collapsible sidebar section: a uniform title bar (label + optional
 * projected action buttons) over arbitrary projected content. Clicking the title
 * bar toggles the body; the open/closed state is persisted to localStorage under
 * `storageKey`. Used to homogenize the Tags / Folders / Calendar auxiliary
 * sections in the manager sidebar.
 */
@Component({
  selector: 'app-collapsible-section',
  imports: [MatIconModule],
  template: `
    <div class="aux-section" [class.collapsed]="!expanded()">
      <div
        class="aux-header"
        role="button"
        tabindex="0"
        [attr.aria-expanded]="expanded()"
        (click)="toggle()"
        (keydown.enter)="toggle($event)"
        (keydown.space)="toggle($event)"
      >
        <mat-icon class="aux-twisty">{{
          expanded() ? 'expand_more' : 'chevron_right'
        }}</mat-icon>
        <span class="aux-title">{{ title() }}</span>
        <span class="aux-actions" (click)="$event.stopPropagation()">
          <ng-content select="[headerAction]"></ng-content>
        </span>
      </div>
      @if (expanded()) {
        <div class="aux-body"><ng-content></ng-content></div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .aux-header {
        display: flex;
        align-items: center;
        gap: 0.15rem;
        margin: 0.8rem 0 0.2rem;
        padding: 0.1rem 0.4rem;
        cursor: pointer;
        border-radius: 6px;

        &:hover {
          background: var(--mat-sys-surface-container-high);

          .aux-twisty {
            visibility: visible;
          }
        }
      }

      .aux-twisty {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 1.1rem;
        width: 1.1rem;
        height: 1.1rem;
        color: var(--mat-sys-on-surface-variant);
        flex: 0 0 auto;
        visibility: hidden;
      }

      .aux-title {
        flex: 1 1 auto;
        font-size: var(--sn-text-2xs);
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--mat-sys-on-surface-variant);
      }

      .aux-actions {
        display: inline-flex;
        align-items: center;
        flex: 0 0 auto;
      }
    `,
  ],
})
export class CollapsibleSection implements OnInit {
  /** Header label. */
  readonly title = input<string>('');
  /** Stable id used to persist the collapsed state across reloads. */
  readonly storageKey = input.required<string>();

  private readonly _expanded = signal(true);
  readonly expanded = this._expanded.asReadonly();

  ngOnInit(): void {
    const stored = localStorage.getItem(STORAGE_PREFIX + this.storageKey());
    if (stored !== null) this._expanded.set(stored === '0');
  }

  /** Toggle the section; `event` (when from a key handler) is prevented. */
  toggle(event?: Event): void {
    event?.preventDefault();
    const next = !this._expanded();
    this._expanded.set(next);
    localStorage.setItem(STORAGE_PREFIX + this.storageKey(), next ? '0' : '1');
  }
}
