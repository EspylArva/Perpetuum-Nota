import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateFolderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  // Parent folder id, or null/omitted to create at the root. `null` skips the
  // @IsUUID check (ValidateIf) so it passes validation as a root folder.
  @IsOptional()
  @ValidateIf((o: CreateFolderDto) => o.parentId !== null)
  @IsUUID()
  parentId?: string | null;
}
