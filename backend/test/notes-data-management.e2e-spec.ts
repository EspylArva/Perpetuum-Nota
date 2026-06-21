/**
 * Notes export/import e2e (Settings → Account → Data management).
 *
 * Runs against the dev Postgres in an isolated `e2e_datamgmt` schema (created/
 * migrated on the fly), so it never touches dev data.
 */
import { execSync } from 'child_process';
import * as path from 'path';

// Must be set BEFORE AppModule (and thus PrismaClient) is loaded.
const BASE_DB =
  process.env.E2E_DATABASE_URL ??
  'postgresql://perpetuum_nota:perpetuum_nota_dev_pw@localhost:5432/perpetuum_nota';
process.env.DATABASE_URL = `${BASE_DB}?schema=e2e_datamgmt`;
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

const PASSWORD = 'datamgmt-pw-99';

/** A minimal ProseMirror doc with a single paragraph of text. */
function para(text: string) {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

describe('Notes data management (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaClient;

  let alice: string; // the acting user
  let aliceId: string;
  let bobId: string;

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
    await prisma.noteLink.deleteMany();
    await prisma.note.deleteMany();
    await prisma.folder.deleteMany();
    await prisma.user.deleteMany();

    const hash = await argon2.hash(PASSWORD);
    const mk = (email: string) =>
      prisma.user.create({
        data: { email, displayName: email, passwordHash: hash },
      });
    const [a, b] = await Promise.all([
      mk('alice@test.io'),
      mk('bob@test.io'),
    ]);
    aliceId = a.id;
    bobId = b.id;

    // Alice owns one note.
    await prisma.note.create({
      data: { ownerId: aliceId, title: 'Alice private', content: para('mine') },
    });
    // Bob owns a PUBLIC note (visible to Alice via the 'public' scope).
    await prisma.note.create({
      data: {
        ownerId: bobId,
        title: 'Bob public',
        content: para('public'),
        visibility: 'PUBLIC',
      },
    });
    // Bob owns a PRIVATE note explicitly shared with Alice ('shared' scope).
    const shared = await prisma.note.create({
      data: { ownerId: bobId, title: 'Bob shared', content: para('shared') },
    });
    await prisma.noteShare.create({
      data: { noteId: shared.id, userId: aliceId, canEdit: false },
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

    alice = await login('alice@test.io');
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  describe('export', () => {
    it('mine scope returns only the user\'s own notes', async () => {
      const res = await request(server)
        .get('/api/notes/export?mine=1&shared=0&public=0')
        .set('Cookie', alice)
        .expect(200);
      expect(res.body.count).toBe(1);
      expect(res.body.notes[0].title).toBe('Alice private');
      // Content is included so the client can render Markdown/JSON.
      expect(res.body.notes[0].content.type).toBe('doc');
    });

    it('public scope returns other users\' public notes only', async () => {
      const res = await request(server)
        .get('/api/notes/export?mine=0&shared=0&public=1')
        .set('Cookie', alice)
        .expect(200);
      const titles = res.body.notes.map((n: { title: string }) => n.title);
      expect(titles).toEqual(['Bob public']);
    });

    it('shared scope returns notes explicitly shared with the user', async () => {
      const res = await request(server)
        .get('/api/notes/export?mine=0&shared=1&public=0')
        .set('Cookie', alice)
        .expect(200);
      const titles = res.body.notes.map((n: { title: string }) => n.title);
      expect(titles).toEqual(['Bob shared']);
    });

    it('combined scopes union without duplicates', async () => {
      const res = await request(server)
        .get('/api/notes/export?mine=1&shared=1&public=1')
        .set('Cookie', alice)
        .expect(200);
      expect(res.body.count).toBe(3);
    });

    it('no scopes selected returns nothing', async () => {
      const res = await request(server)
        .get('/api/notes/export?mine=0&shared=0&public=0')
        .set('Cookie', alice)
        .expect(200);
      expect(res.body.count).toBe(0);
    });

    it('requires authentication', async () => {
      await request(server).get('/api/notes/export?mine=1').expect(401);
    });
  });

  describe('import', () => {
    it('bulk-creates notes as the caller\'s own, with search text', async () => {
      const res = await request(server)
        .post('/api/notes/import')
        .set('Cookie', alice)
        .send({
          notes: [
            { title: 'Imported A', content: para('first imported body') },
            { title: 'Imported B', content: para('second imported body') },
          ],
        })
        .expect(200);
      expect(res.body).toMatchObject({ created: 2 });

      const a = await prisma.note.findFirst({
        where: { ownerId: aliceId, title: 'Imported A' },
      });
      expect(a).toBeTruthy();
      // contentText is extracted for search at import time.
      expect(a!.contentText).toContain('first imported body');
      expect(a!.visibility).toBe('PRIVATE');
    });

    it('resolves wikilinks between imported notes regardless of order', async () => {
      // "Beta" links to "Alpha", but is sent first — the second pass resolves it.
      const res = await request(server)
        .post('/api/notes/import')
        .set('Cookie', alice)
        .send({
          notes: [
            {
              title: 'Beta',
              content: {
                type: 'doc',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'wikilink', attrs: { title: 'Alpha' } }],
                  },
                ],
              },
            },
            { title: 'Alpha', content: para('alpha body') },
          ],
        })
        .expect(200);
      expect(res.body.created).toBe(2);

      const beta = await prisma.note.findFirst({
        where: { ownerId: aliceId, title: 'Beta' },
      });
      const alpha = await prisma.note.findFirst({
        where: { ownerId: aliceId, title: 'Alpha' },
      });
      const link = await prisma.noteLink.findFirst({
        where: { fromNoteId: beta!.id, toNoteId: alpha!.id },
      });
      expect(link).toBeTruthy();
    });

    it('rejects a non-ProseMirror content doc (400)', async () => {
      await request(server)
        .post('/api/notes/import')
        .set('Cookie', alice)
        .send({ notes: [{ title: 'Bad', content: { not: 'a doc' } }] })
        .expect(400);
    });

    it('rejects an empty notes array (400)', async () => {
      await request(server)
        .post('/api/notes/import')
        .set('Cookie', alice)
        .send({ notes: [] })
        .expect(400);
    });

    it('requires authentication', async () => {
      await request(server)
        .post('/api/notes/import')
        .send({ notes: [{ title: 'X', content: para('y') }] })
        .expect(401);
    });
  });
});
