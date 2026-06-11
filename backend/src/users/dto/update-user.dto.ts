import { Role } from '@prisma/client';
import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  displayName?: string;

  @IsOptional()
  @IsIn(['USER', 'ADMIN'])
  role?: Role;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
