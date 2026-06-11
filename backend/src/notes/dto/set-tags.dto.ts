import { IsArray, IsString, MaxLength } from 'class-validator';

export class SetTagsDto {
  @IsArray()
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  names!: string[];
}
