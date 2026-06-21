import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

// One note to import. Content is the app's ProseMirror document JSON, parsed
// from the uploaded Markdown on the client (the editor already owns that
// converter). Structure is validated in the service via isProseMirrorDoc.
export class ImportNoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsObject()
  content!: Record<string, unknown>;
}

export class ImportNotesDto {
  @IsArray()
  @ArrayNotEmpty()
  // Guard against a single request trying to import an unbounded batch.
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ImportNoteDto)
  notes!: ImportNoteDto[];
}
