/**
 * Authorship e2e — every note carries its author (ownerName), last editor
 * (lastEditedByName) and last edit timestamp (updatedAt). Verifies that
 * lastEditedById is written on each mutating path: content PATCH, meta PATCH,
 * and tags PUT.
 *
 * Runs against the dev Postgres in an isolated `e2e_author` schema (created/
 * migrated on the fly), so it never touches dev data.
 */
import { execSync } from 'child_process';
import * as path from 'path';

// Must be set BEFORE AppModule (and thus PrismaClient) is loaded.
// Distinct schema so this suite does not conflict with the other e2e specs.
const BASE_DB =
  process.env.E2E_DATABASE_URL ??
  'postgresql://stickynotes:stickynotes_dev_pw@localhost:5432/stickynotes';
process.env.DATABASE_URL = `${BASE_DB}?schema=e2e_author`;
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

const PASSWORD = 'password-123';
const OWNER_EMAIL = 'author-owner@test.io';
const OWNER_NAME = 'Olivia Owner';

// A minimal valid ProseMirror doc with some text.
const DOC = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'hello world' }] },
  ],
};

describe('Authorship (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaClient;

  let owner: string;

  async function login(email: string): Promise<string> {
    const res = await request(server)
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const cookies = res.get('Set-Cookie') ?? [];
    const auth = cookies.find((c: string) => c.startsWith('access_token='));
    if (!auth) throw new Error('no auth cookie issued');
    return auth.split(';')[0];
  }

  async function createNote(cookie: string, title: string): Promise<string> {
    const res = await request(server)
      .post('/api/notes')
      .set('Cookie', cookie)
      .send({ title })
      .expect(201);
    return res.body.id as string;
  }

  function get(cookie: string, id: string): request.Test {
    return request(server).get(`/api/notes/${id}`).set('Cookie', cookie);
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
    await prisma.user.create({
      data: { email: OWNER_EMAIL, displayName: OWNER_NAME, passwordHash: hash },
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

    owner = await login(OWNER_EMAIL);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('a freshly created note: ownerName = creator, lastEditedByName = null', async () => {
    const id = await createNote(owner, 'fresh');
    const res = await get(owner, id).expect(200);
    expect(res.body.ownerName).toBe(OWNER_NAME);
    expect(res.body.lastEditedByName).toBeNull();
  });

  it('the list endpoint also carries ownerName and a null lastEditedByName for unedited notes', async () => {
    const res = await request(server)
      .get('/api/notes?filter=mine')
      .set('Cookie', owner)
      .expect(200);
    expect(res.body.length).toBeGreaterThan(0);
    for (const n of res.body) {
      expect(n.ownerName).toBe(OWNER_NAME);
      expect(n).toHaveProperty('lastEditedByName');
    }
  });

  it('a content PATCH sets lastEditedByName to the editor and advances updatedAt', async () => {
    const id = await createNote(owner, 'content edit');
    const before = await get(owner, id).expect(200);
    expect(before.body.lastEditedByName).toBeNull();
    const beforeUpdatedAt = new Date(before.body.updatedAt).getTime();

    // Small gap so the @updatedAt bump is observable.
    await new Promise((r) => setTimeout(r, 25));

    await request(server)
      .patch(`/api/notes/${id}/content`)
      .set('Cookie', owner)
      .send({ content: DOC })
      .expect(200);

    const after = await get(owner, id).expect(200);
    expect(after.body.lastEditedByName).toBe(OWNER_NAME);
    expect(new Date(after.body.updatedAt).getTime()).toBeGreaterThan(
      beforeUpdatedAt,
    );
  });

  it('a meta PATCH (title) sets lastEditedByName', async () => {
    const id = await createNote(owner, 'meta edit');
    expect((await get(owner, id)).body.lastEditedByName).toBeNull();

    await request(server)
      .patch(`/api/notes/${id}`)
      .set('Cookie', owner)
      .send({ title: 'renamed' })
      .expect(200);

    const after = await get(owner, id).expect(200);
    expect(after.body.lastEditedByName).toBe(OWNER_NAME);
    expect(after.body.title).toBe('renamed');
  });

  it('a tags PUT sets lastEditedByName', async () => {
    const id = await createNote(owner, 'tags edit');
    expect((await get(owner, id)).body.lastEditedByName).toBeNull();

    await request(server)
      .put(`/api/notes/${id}/tags`)
      .set('Cookie', owner)
      .send({ names: ['work', 'urgent'] })
      .expect(200);

    const after = await get(owner, id).expect(200);
    expect(after.body.lastEditedByName).toBe(OWNER_NAME);
    expect(after.body.tags).toEqual(['urgent', 'work']);
  });
});
