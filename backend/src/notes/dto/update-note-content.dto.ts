import { IsObject, IsOptional, IsString } from 'class-validator';

export class UpdateNoteContentDto {
  // ProseMirror/TipTap document JSON. Structure is validated in the service.
  @IsObject()
  content!: Record<string, unknown>;

  // Optional optimistic-concurrency guard (ISO timestamp of the last known save).
  @IsOptional()
  @IsString()
  baseContentUpdatedAt?: string;
}
