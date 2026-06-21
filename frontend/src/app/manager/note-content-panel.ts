import { Component, computed, input, output, signal } from '@angular/core';
import {
  MatAutocompleteModule,
  MatAutocompleteSelectedEvent,
  MatAutocompleteTrigger,
} from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatChipInputEvent, MatChipsModule } from '@angular/material/chips';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import type { NoteSummaryDto, TagDto } from '@perpetuum-nota/shared';
import { NoteEditor } from '../editor/note-editor';
import type { NoteLinkRef } from '../editor/open-notes.store';
import { authorLine } from './author-line';
import { tagColor } from './tag-color';
import { filterTagOptions } from './tag-filter';

/**
 * The note "detail body" — author meta, tag editor, due-date control, linked-note
 * pills, and the rich-text editor. Presentational + self-contained: it owns the
 * tag-input/autocomplete interaction locally and emits the resulting intents
 * (`tagsChange`, `dueChange`, `openLink`) for the host to persist. Used by BOTH
 * the LIST pane and a WALL note window, so the body lives in exactly one place.
 *
 * `:host { display: contents }` keeps the wrapper transparent to the host's flex
 * column, so the editor still stretches to fill the pane/window.
 */
@Component({
  selector: 'app-note-content-panel',
  imports: [
    MatAutocompleteModule,
    MatButtonModule,
    MatChipsModule,
    MatDatepickerModule,
    MatIconModule,
    MatTooltipModule,
    RouterLink,
    NoteEditor,
  ],
  templateUrl: './note-content-panel.html',
  styleUrl: './note-content-panel.scss',
})
export class NoteContentPanel {
  /** Id of the note hosted by the editor (the loop/tab id; always present). */
  readonly noteId = input.required<string>();
  /** Summary of the note (title/tags/dueDate/author). May lag briefly on open. */
  readonly note = input<NoteSummaryDto | undefined>(undefined);
  /** Whether the current user may edit (gates the tag + due editors). */
  readonly editable = input<boolean>(false);
  /** All of the user's tags, for autocomplete (minus the note's own). */
  readonly allTags = input<TagDto[]>([]);
  /** Outgoing wikilinks of the note, shown as pills. */
  readonly links = input<NoteLinkRef[]>([]);

  /** The note's full tag list after an add/remove — host persists it. */
  readonly tagsChange = output<string[]>();
  /** New due date (or null to clear) — host persists it. */
  readonly dueChange = output<Date | null>();
  /** A linked-note pill was activated — host decides in-app vs new tab. */
  readonly openLink = output<{ id: string; event: MouseEvent }>();

  readonly tagColor = tagColor;
  readonly authorLine = authorLine;

  /** Current text in the tag input — narrows the autocomplete options. */
  private readonly tagQuery = signal('');
  readonly tagOptions = computed(() =>
    filterTagOptions(this.allTags(), this.note()?.tags ?? [], this.tagQuery()),
  );

  setTagQuery(value: string): void {
    this.tagQuery.set(value);
  }

  /** Converts a stored ISO due date (or null/undefined) to a Date for the picker. */
  dueAsDate(iso: string | null | undefined): Date | null {
    return iso ? new Date(iso) : null;
  }

  addFromChip(event: MatChipInputEvent, trigger: MatAutocompleteTrigger): void {
    // If an autocomplete option is highlighted, its (optionSelected) owns the
    // Enter — bail so the tag isn't added twice.
    if (trigger.activeOption) {
      event.chipInput.clear();
      return;
    }
    const note = this.note();
    const name = event.value.trim();
    event.chipInput.clear();
    this.tagQuery.set('');
    if (!note || !name) return;
    this.tagsChange.emit([...note.tags, name]);
  }

  addFromOption(event: MatAutocompleteSelectedEvent, inputEl: HTMLInputElement): void {
    const note = this.note();
    const name = event.option.viewValue.trim();
    inputEl.value = '';
    this.tagQuery.set('');
    if (!note || !name) return;
    this.tagsChange.emit([...note.tags, name]);
  }

  removeTag(name: string): void {
    const note = this.note();
    if (!note) return;
    this.tagsChange.emit(note.tags.filter((t) => t !== name));
  }
}
