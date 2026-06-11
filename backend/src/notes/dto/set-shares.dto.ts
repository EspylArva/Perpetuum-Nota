import { IsArray, IsString } from 'class-validator';

export class SetSharesDto {
  @IsArray()
  @IsString({ each: true })
  userIds!: string[];
}
