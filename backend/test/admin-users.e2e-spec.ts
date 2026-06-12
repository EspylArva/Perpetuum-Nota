/**
 * Admin user-management e2e — password reset endpoint.
 *
 * Runs against the dev Postgres in an isolated `e2e` schema (created/migrated
 * on the fly), so it never touches dev data.
 */
import { execSync } from 'child_process';
import * as path from 'path';

// Must be set BEFORE AppModule (and thus PrismaClient) is loaded.
// Use a distinct schema so this suite does not conflict with access-matrix.e2e-spec.ts.
const BASE_DB =
  process.env.E2E_DATABASE_URL ??
  'postgresql://stickynotes:stickynotes_dev_pw@localhost:5432/stickynotes';
process.env.DATABASE_URL = `${BASE_DB}?schema=e2e_admin`;
process.env.ADMIN_EMAIL = '';
process.env.ADMIN_PASSWORD = '';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ExpressAdapter,
  NestExpressApplication,
} from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';

const PASSWORD = 'initial-pw-99';
const NEW_PASSWORD = 'new-temp-pw-123';
const SHORT_PASSWORD = 'short7';

describe('Admin password reset (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaClient;

  let admin: string;
  let user: string;
  let userId: string;

  async function login(email: string, pw: string = PASSWORD): Promise<string> {
    const res = await request(server)
      .post('/api/auth/login')
      .send({ email, password: pw })
      .expect(200);
    const cookies = res.get('Set-Cookie') ?? [];
    const auth = cookies.find((c: string) => c.startsWith('access_token='));
    if (!auth) throw new Error('no auth cookie issued');
    return auth.split(';')[0];
  }

  beforeAll(async () => {
    execSync('npx prisma migrate deploy', {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env },
      stdio: 'pipe',
    });

    prisma = new PrismaClient();
    await prisma.noteTag.deleteMany();
    await prisma.tag.deleteMany();
    await prisma.imageAsset.deleteMany();
    await prisma.noteShare.deleteMany();
    await prisma.note.deleteMany();
    await prisma.invite.deleteMany();
    await prisma.user.deleteMany();

    const hash = await argon2.hash(PASSWORD);
    const mk = (email: string, role: 'USER' | 'ADMIN' = 'USER') =>
      prisma.user.create({
        data: { email, displayName: email, passwordHash: hash, role },
      });

    const [adminUser, regularUser] = await Promise.all([
      mk('pw-admin@test.io', 'ADMIN'),
      mk('pw-user@test.io', 'USER'),
    ]);
    userId = regularUser.id;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(
      new ExpressAdapter(),
    );
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    server = app.getHttpServer();

    admin = await login('pw-admin@test.io');
    user = await login('pw-user@test.io');

    // suppress unused-variable warning — adminUser used only for seeding
    void adminUser;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  describe('admin resets a user password', () => {
    it('succeeds: user can log in with the new password', async () => {
      await request(server)
        .post(`/api/users/${userId}/password`)
        .set('Cookie', admin)
        .send({ password: NEW_PASSWORD })
        .expect(200);

      // new password works
      await login('pw-user@test.io', NEW_PASSWORD);
    });

    it('old password no longer works after reset', async () => {
      await request(server)
        .post('/api/auth/login')
        .send({ email: 'pw-user@test.io', password: PASSWORD })
        .expect(401);
    });
  });

  describe('access control', () => {
    it('non-admin gets 403', async () => {
      // re-login with the new password since we already reset it above
      const userCookie = await login('pw-user@test.io', NEW_PASSWORD);
      await request(server)
        .post(`/api/users/${userId}/password`)
        .set('Cookie', userCookie)
        .send({ password: 'another-pw-456' })
        .expect(403);
    });

    it('unauthenticated gets 401', async () => {
      await request(server)
        .post(`/api/users/${userId}/password`)
        .send({ password: NEW_PASSWORD })
        .expect(401);
    });
  });

  describe('validation', () => {
    it('unknown user id → 404', async () => {
      await request(server)
        .post('/api/users/00000000-0000-0000-0000-000000000000/password')
        .set('Cookie', admin)
        .send({ password: NEW_PASSWORD })
        .expect(404);
    });

    it('password shorter than 8 chars → 400', async () => {
      await request(server)
        .post(`/api/users/${userId}/password`)
        .set('Cookie', admin)
        .send({ password: SHORT_PASSWORD })
        .expect(400);
    });
  });
});
