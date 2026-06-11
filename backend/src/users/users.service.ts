import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { User } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {}

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

  /**
   * Permanently deletes a user and (via cascade) their notes, shares, tags,
   * and image rows; image FILES are unlinked explicitly. Deleting yourself is
   * blocked (deactivate-by-another-admin is the supported off-boarding for
   * admins), as is deleting the last active admin.
   */
  async remove(id: string, callerId: string): Promise<{ id: string }> {
    if (id === callerId) {
      throw new ConflictException(
        'You cannot delete your own account while logged in',
      );
    }
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('User not found');
    if (target.role === 'ADMIN' && target.isActive) {
      const otherAdmins = await this.prisma.user.count({
        where: { role: 'ADMIN', isActive: true, NOT: { id } },
      });
      if (otherAdmins === 0) {
        throw new ConflictException('Cannot delete the last active admin');
      }
    }

    // Files for every asset row the cascade will remove: assets on their notes
    // and assets they uploaded (identical sets in the MVP, but stay future-proof).
    const assets = await this.prisma.imageAsset.findMany({
      where: { OR: [{ uploadedById: id }, { note: { ownerId: id } }] },
      select: { storagePath: true },
    });
    await this.prisma.user.delete({ where: { id } });
    await this.uploads.deleteFiles(assets);
    return { id };
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
