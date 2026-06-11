import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
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
}
