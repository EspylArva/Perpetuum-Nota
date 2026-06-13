import {
  IsBoolean,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class UpdateNoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  // Wall grid coordinates (cell units). Sent together when a card is dropped.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  wallX?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  wallY?: number;

  // Due date as an ISO 8601 string, or explicit null to clear it. `null` skips
  // the @IsISO8601 check (ValidateIf) so it passes validation and clears the
  // column; any other non-ISO value is rejected with 400.
  @IsOptional()
  @ValidateIf((o: UpdateNoteDto) => o.dueDate !== null)
  @IsISO8601()
  dueDate?: string | null;
}
