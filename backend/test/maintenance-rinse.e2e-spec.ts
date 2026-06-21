/**
 * Maintenance "rinse database" e2e — wipes all content, keeps user accounts.
 *
 * Runs against the dev Postgres in an isolated `e2e_rinse` schema (created/
 * migrated on the fly), so it never touches dev data.
 */
import { execSync } from 'child_process';
import * as path from 'path';

// Must be set BEFORE AppModule (and thus PrismaClient) is loaded.
const BASE_DB =
  process.env.E2E_DATABASE_URL ??
  'postgresql://perpetuum_nota:perpetuum_nota_dev_pw@localhost:5432/perpetuum_nota';
process.env.DATABASE_URL = `${BASE_DB}?schema=e2e_rinse`;
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

const PASSWORD = 'rinse-pw-99';
const EMPTY_DOC = { type: 'doc', content: [] };

describe('Maintenance rinse (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaClient;

  let admin: string;
  let user: string;

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
    await prisma.folder.deleteMany();
    await prisma.invite.deleteMany();
    await prisma.user.deleteMany();

    const hash = await argon2.hash(PASSWORD);
    const mk = (email: string, role: 'USER' | 'ADMIN' = 'USER') =>
      prisma.user.create({
        data: { email, displayName: email, passwordHash: hash, role },
      });

    const [, regularUser] = await Promise.all([
      mk('rinse-admin@test.io', 'ADMIN'),
      mk('rinse-user@test.io', 'USER'),
    ]);

    // Seed content the rinse must wipe: a folder, a note in it, and a tag.
    const folder = await prisma.folder.create({
      data: { ownerId: regularUser.id, name: 'Box' },
    });
    await prisma.note.create({
      data: {
        ownerId: regularUser.id,
        folderId: folder.id,
        content: EMPTY_DOC,
      },
    });
    await prisma.tag.create({
      data: { ownerId: regularUser.id, name: 'todo' },
    });

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

    admin = await login('rinse-admin@test.io');
    user = await login('rinse-user@test.io');
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  describe('access control', () => {
    it('non-admin gets 403 on stats and rinse', async () => {
      await request(server)
        .get('/api/maintenance/stats')
        .set('Cookie', user)
        .expect(403);
      await request(server)
        .post('/api/maintenance/rinse')
        .set('Cookie', user)
        .expect(403);
    });

    it('unauthenticated gets 401', async () => {
      await request(server).get('/api/maintenance/stats').expect(401);
      await request(server).post('/api/maintenance/rinse').expect(401);
    });
  });

  describe('rinse', () => {
    it('stats report the seeded content before the rinse', async () => {
      const res = await request(server)
        .get('/api/maintenance/stats')
        .set('Cookie', admin)
        .expect(200);
      expect(res.body).toMatchObject({
        notes: 1,
        folders: 1,
        tags: 1,
        users: 2,
      });
    });

    it('admin rinse wipes content and keeps users', async () => {
      const res = await request(server)
        .post('/api/maintenance/rinse')
        .set('Cookie', admin)
        .expect(200);
      expect(res.body).toMatchObject({ notes: 1, folders: 1, tags: 1 });

      // Content is gone…
      expect(await prisma.note.count()).toBe(0);
      expect(await prisma.folder.count()).toBe(0);
      expect(await prisma.tag.count()).toBe(0);
      // …but the accounts survive.
      expect(await prisma.user.count()).toBe(2);
    });

    it('a second rinse is a no-op (idempotent)', async () => {
      const res = await request(server)
        .post('/api/maintenance/rinse')
        .set('Cookie', admin)
        .expect(200);
      expect(res.body).toMatchObject({ notes: 0, folders: 0, tags: 0 });
    });
  });
});
