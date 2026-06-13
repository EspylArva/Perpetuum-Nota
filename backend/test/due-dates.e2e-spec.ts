/**
 * Due-date e2e — setting/clearing a note's due date and filtering the list by
 * an inclusive dueAfter/dueBefore window.
 *
 * Runs against the dev Postgres in an isolated `e2e_due` schema (created/
 * migrated on the fly), so it never touches dev data.
 */
import { execSync } from 'child_process';
import * as path from 'path';

// Must be set BEFORE AppModule (and thus PrismaClient) is loaded.
// Distinct schema so this suite does not conflict with the other e2e specs.
const BASE_DB =
  process.env.E2E_DATABASE_URL ??
  'postgresql://stickynotes:stickynotes_dev_pw@localhost:5432/stickynotes';
process.env.DATABASE_URL = `${BASE_DB}?schema=e2e_due`;
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

// Fixed reference dates (UTC) for deterministic boundary assertions.
const D_JAN10 = '2026-01-10T12:00:00.000Z';
const D_JAN15 = '2026-01-15T12:00:00.000Z';
const D_JAN20 = '2026-01-20T12:00:00.000Z';

describe('Due dates (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaClient;

  let owner: string;
  let other: string;

  // owner's notes
  let noteJan10: string; // dueDate = Jan 10
  let noteJan15: string; // dueDate = Jan 15
  let noteJan20: string; // dueDate = Jan 20
  let noteNoDue: string; // no dueDate
  // a non-owner note with a due date, for the filter=mine combination test
  let otherNote: string;

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

  async function setDue(
    cookie: string,
    id: string,
    dueDate: string | null,
  ): Promise<request.Response> {
    return request(server)
      .patch(`/api/notes/${id}`)
      .set('Cookie', cookie)
      .send({ dueDate });
  }

  function ids(res: request.Response): string[] {
    return res.body.map((n: { id: string }) => n.id);
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
    const mk = (email: string) =>
      prisma.user.create({
        data: { email, displayName: email, passwordHash: hash },
      });
    await Promise.all([mk('due-owner@test.io'), mk('due-other@test.io')]);

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

    owner = await login('due-owner@test.io');
    other = await login('due-other@test.io');

    noteJan10 = await createNote(owner, 'jan 10');
    noteJan15 = await createNote(owner, 'jan 15');
    noteJan20 = await createNote(owner, 'jan 20');
    noteNoDue = await createNote(owner, 'no due');
    otherNote = await createNote(other, 'other due');

    await setDue(owner, noteJan10, D_JAN10).then((r) => expect(r.status).toBe(200));
    await setDue(owner, noteJan15, D_JAN15).then((r) => expect(r.status).toBe(200));
    await setDue(owner, noteJan20, D_JAN20).then((r) => expect(r.status).toBe(200));
    await setDue(other, otherNote, D_JAN15).then((r) => expect(r.status).toBe(200));
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  describe('setting a due date', () => {
    it('PATCH stores the dueDate and returns it as ISO', async () => {
      const res = await request(server)
        .get(`/api/notes/${noteJan15}`)
        .set('Cookie', owner)
        .expect(200);
      expect(new Date(res.body.dueDate).toISOString()).toBe(D_JAN15);
    });

    it('clears the dueDate with null', async () => {
      const tmp = await createNote(owner, 'temp');
      await setDue(owner, tmp, D_JAN10).then((r) => expect(r.status).toBe(200));

      const cleared = await setDue(owner, tmp, null);
      expect(cleared.status).toBe(200);
      expect(cleared.body.dueDate).toBeNull();

      const fetched = await request(server)
        .get(`/api/notes/${tmp}`)
        .set('Cookie', owner)
        .expect(200);
      expect(fetched.body.dueDate).toBeNull();
    });

    it('rejects a non-ISO date string with 400', async () => {
      const res = await setDue(owner, noteJan10, 'not-a-date' as string);
      expect(res.status).toBe(400);
    });
  });

  describe('filtering by due window', () => {
    it('dueAfter only — inclusive lower bound (note ON the bound included)', async () => {
      const res = await request(server)
        .get(`/api/notes?filter=mine&dueAfter=${encodeURIComponent(D_JAN15)}`)
        .set('Cookie', owner)
        .expect(200);
      const got = ids(res);
      expect(got).toContain(noteJan15); // exactly on the bound
      expect(got).toContain(noteJan20);
      expect(got).not.toContain(noteJan10);
      expect(got).not.toContain(noteNoDue); // null excluded
    });

    it('dueBefore only — inclusive upper bound (note ON the bound included)', async () => {
      const res = await request(server)
        .get(`/api/notes?filter=mine&dueBefore=${encodeURIComponent(D_JAN15)}`)
        .set('Cookie', owner)
        .expect(200);
      const got = ids(res);
      expect(got).toContain(noteJan15); // exactly on the bound
      expect(got).toContain(noteJan10);
      expect(got).not.toContain(noteJan20);
      expect(got).not.toContain(noteNoDue); // null excluded
    });

    it('both bounds — only notes inside [after, before] inclusive', async () => {
      const res = await request(server)
        .get(
          `/api/notes?filter=mine&dueAfter=${encodeURIComponent(
            D_JAN15,
          )}&dueBefore=${encodeURIComponent(D_JAN20)}`,
        )
        .set('Cookie', owner)
        .expect(200);
      const got = ids(res);
      expect(got).toEqual(
        expect.arrayContaining([noteJan15, noteJan20]),
      );
      expect(got).not.toContain(noteJan10);
      expect(got).not.toContain(noteNoDue);
    });

    it('excludes notes with a null dueDate whenever a bound is present', async () => {
      const res = await request(server)
        .get(`/api/notes?filter=mine&dueBefore=${encodeURIComponent(D_JAN20)}`)
        .set('Cookie', owner)
        .expect(200);
      expect(ids(res)).not.toContain(noteNoDue);
    });

    it('combines with filter=mine — never leaks another user\'s due note', async () => {
      const res = await request(server)
        .get(`/api/notes?filter=mine&dueAfter=${encodeURIComponent(D_JAN15)}`)
        .set('Cookie', other)
        .expect(200);
      const got = ids(res);
      // other only owns otherNote (due Jan 15) — owner's notes never appear
      expect(got).toContain(otherNote);
      expect(got).not.toContain(noteJan15);
      expect(got).not.toContain(noteJan20);
    });

    it('without bounds, all notes (incl. null dueDate) are listed', async () => {
      const res = await request(server)
        .get('/api/notes?filter=mine')
        .set('Cookie', owner)
        .expect(200);
      expect(ids(res)).toContain(noteNoDue);
    });
  });
});
