import { Visibility } from '@prisma/client';
import { IsIn } from 'class-validator';

export class SetVisibilityDto {
  @IsIn(['PRIVATE', 'PUBLIC'])
  visibility!: Visibility;
}
