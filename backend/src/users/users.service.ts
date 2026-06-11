import { ConflictException, Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Active users for the share picker (optionally excluding the caller). */
  list(excludeUserId?: string) {
    return this.prisma.user.findMany({
      where: {
        isActive: true,
        ...(excludeUserId ? { NOT: { id: excludeUserId } } : {}),
      },
      select: { id: true, email: true, displayName: true, role: true },
      orderBy: { displayName: 'asc' },
    });
  }

  /** Full user list for admin management. */
  listAll() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(dto: CreateUserDto) {
    const exists = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (exists) throw new ConflictException('Email already in use');
    const passwordHash = await argon2.hash(dto.password);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        displayName: dto.displayName,
        passwordHash,
        role: dto.role ?? 'USER',
        isActive: true,
      },
    });
    return this.toDto(user);
  }

  async update(id: string, dto: UpdateUserDto) {
    // Lockout guard: never let the last active admin be deactivated or demoted
    // (including by themselves) — with no other admin, the instance would have
    // no way to manage users or recover.
    if (dto.isActive === false || (dto.role !== undefined && dto.role !== 'ADMIN')) {
      const target = await this.prisma.user.findUnique({
        where: { id },
        select: { role: true, isActive: true },
      });
      if (target?.role === 'ADMIN' && target.isActive) {
        const otherAdmins = await this.prisma.user.count({
          where: { role: 'ADMIN', isActive: true, NOT: { id } },
        });
        if (otherAdmins === 0) {
          throw new ConflictException(
            'Cannot deactivate or demote the last active admin',
          );
        }
      }
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.displayName !== undefined
          ? { displayName: dto.displayName }
          : {}),
        ...(dto.role !== undefined ? { role: dto.role } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    return this.toDto(user);
  }

  private toDto(user: User) {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      isActive: user.isActive,
    };
  }
}
