import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Idempotently bootstraps the admin account from ADMIN_EMAIL / ADMIN_PASSWORD on
 * every app start. Creates the admin only if absent (never clobbers an existing
 * password). Runs natively and in Docker, so no separate seed script is needed.
 */
@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const email = this.config.get<string>('ADMIN_EMAIL');
    const password = this.config.get<string>('ADMIN_PASSWORD');

    if (!email || !password) {
      this.logger.warn(
        'ADMIN_EMAIL / ADMIN_PASSWORD not set; skipping admin bootstrap',
      );
      return;
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      this.logger.log(`Admin user already present: ${email}`);
      return;
    }

    const passwordHash = await argon2.hash(password);
    await this.prisma.user.create({
      data: {
        email,
        displayName: 'Admin',
        passwordHash,
        role: 'ADMIN',
        isActive: true,
      },
    });
    this.logger.log(`Bootstrapped admin user: ${email}`);
  }
}
