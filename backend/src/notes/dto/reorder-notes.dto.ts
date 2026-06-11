import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';

export class ReorderNotesDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  orderedIds!: string[];
}
