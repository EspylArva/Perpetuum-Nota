import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsString, ValidateNested } from 'class-validator';

/** One share grant: who, and whether they may edit (vs read-only). */
export class ShareGrantInput {
  @IsString()
  userId!: string;

  @IsBoolean()
  canEdit!: boolean;
}

export class SetSharesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShareGrantInput)
  grants!: ShareGrantInput[];
}
