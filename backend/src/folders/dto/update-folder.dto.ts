import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdateFolderDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  // New parent folder id (move), or null to move to the root. `null` skips the
  // @IsUUID check (ValidateIf). Omitting parentId leaves the parent unchanged.
  @IsOptional()
  @ValidateIf((o: UpdateFolderDto) => o.parentId !== null)
  @IsUUID()
  parentId?: string | null;
}
