import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { CsrfService } from './csrf.service';
import { CurrentUser } from './current-user.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { ACCESS_TOKEN_COOKIE } from './jwt-auth.guard';
import { Public } from './public.decorator';
import type { AuthenticatedUser } from './types';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

type UserLike = {
  id: string;
  email: string;
  displayName: string;
  role: Role;
};

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    private readonly csrf: CsrfService,
  ) {}

  // Issues a CSRF token (and sets the readable csrf cookie). The SPA calls this
  // on load and echoes the token back via the X-CSRF-Token header on mutations.
  @Public()
  @Get('csrf')
  csrfToken(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): { token: string } {
    return { token: this.csrf.generateToken(req, res) };
  }

  @Public()
  // Tight brute-force limit on login: 5 attempts / minute / IP.
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserLike> {
    const user = await this.auth.validateUser(dto.email, dto.password);
    const token = await this.auth.issueToken(user);
    res.cookie(ACCESS_TOKEN_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      // Secure only when actually served over HTTPS (req.secure reflects the
      // X-Forwarded-Proto from nginx when trust-proxy is on). Lets the app work
      // over plain HTTP locally and stay secure behind TLS.
      secure: req.secure,
      maxAge: SEVEN_DAYS_MS,
      path: '/',
    });
    return this.toDto(user);
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response): { ok: true } {
    res.clearCookie(ACCESS_TOKEN_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  async me(@CurrentUser() current: AuthenticatedUser): Promise<UserLike | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: current.id },
    });
    return user ? this.toDto(user) : null;
  }

  // Same brute-force posture as login: the current password is being guessed.
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('change-password')
  @HttpCode(200)
  async changePassword(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ ok: true }> {
    await this.auth.changePassword(
      current.id,
      dto.currentPassword,
      dto.newPassword,
    );
    return { ok: true };
  }

  private toDto(user: UserLike): UserLike {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
    };
  }
}
