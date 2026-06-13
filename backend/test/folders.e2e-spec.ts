/**
 * Folders e2e — nested folder CRUD, cycle-safe move, reparent-on-delete, note
 * assignment, and listing notes by folder.
 *
 * Runs against the dev Postgres in an isolated `e2e_folders` schema (created/
 * migrated on the fly), so it never touches dev data.
 */
import { execSync } from 'child_process';
import * as path from 'path';

// Must be set BEFORE AppModule (and thus PrismaClient) is loaded.
// Distinct schema so this suite does not conflict with the other e2e specs.
const BASE_DB =
  process.env.E2E_DATABASE_URL ??
  'postgresql://stickynotes:stickynotes_dev_pw@localhost:5432/stickynotes';
process.env.DATABASE_URL = `${BASE_DB}?schema=e2e_folders`;
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

interface FolderRow {
  id: string;
  name: string;
  parentId: string | null;
  noteCount: number;
}

describe('Folders (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaClient;

  let owner: string;
  let other: string;

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

  async function createFolder(
    cookie: string,
    name: string,
    parentId?: string | null,
  ): Promise<request.Response> {
    return request(server)
      .post('/api/folders')
      .set('Cookie', cookie)
      .send({ name, ...(parentId !== undefined ? { parentId } : {}) });
  }

  async function listFolders(cookie: string): Promise<FolderRow[]> {
    const res = await request(server)
      .get('/api/folders')
      .set('Cookie', cookie)
      .expect(200);
    return res.body as FolderRow[];
  }

  function byId(rows: FolderRow[], id: string): FolderRow | undefined {
    return rows.find((r) => r.id === id);
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
    const mk = (email: string) =>
      prisma.user.create({
        data: { email, displayName: email, passwordHash: hash },
      });
    await Promise.all([mk('fold-owner@test.io'), mk('fold-other@test.io')]);

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

    owner = await login('fold-owner@test.io');
    other = await login('fold-other@test.io');
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  describe('create + list', () => {
    it('creates a root folder and a child folder; list is tree-able flat data', async () => {
      const rootRes = await createFolder(owner, 'Root A');
      expect(rootRes.status).toBe(201);
      expect(rootRes.body.parentId).toBeNull();
      expect(rootRes.body.noteCount).toBe(0);
      const rootId = rootRes.body.id as string;

      const childRes = await createFolder(owner, 'Child A1', rootId);
      expect(childRes.status).toBe(201);
      expect(childRes.body.parentId).toBe(rootId);
      const childId = childRes.body.id as string;

      const rows = await listFolders(owner);
      expect(byId(rows, rootId)?.parentId).toBeNull();
      expect(byId(rows, childId)?.parentId).toBe(rootId);
    });

    it('noteCount reflects live notes directly in the folder', async () => {
      const fRes = await createFolder(owner, 'Counted');
      const fId = fRes.body.id as string;
      const n1 = await createNote(owner, 'in folder 1');
      const n2 = await createNote(owner, 'in folder 2');

      await request(server)
        .patch(`/api/notes/${n1}`)
        .set('Cookie', owner)
        .send({ folderId: fId })
        .expect(200);
      await request(server)
        .patch(`/api/notes/${n2}`)
        .set('Cookie', owner)
        .send({ folderId: fId })
        .expect(200);

      const rows = await listFolders(owner);
      expect(byId(rows, fId)?.noteCount).toBe(2);
    });

    it('rejects creating under a parent not owned by the caller (404)', async () => {
      const fRes = await createFolder(owner, "Owner's folder");
      const fId = fRes.body.id as string;
      const res = await createFolder(other, 'sneaky child', fId);
      expect(res.status).toBe(404);
    });

    it('rejects an empty name (400)', async () => {
      const res = await createFolder(owner, '');
      expect(res.status).toBe(400);
    });
  });

  describe('rename + move', () => {
    it('renames a folder', async () => {
      const fRes = await createFolder(owner, 'Before');
      const fId = fRes.body.id as string;
      const res = await request(server)
        .patch(`/api/folders/${fId}`)
        .set('Cookie', owner)
        .send({ name: 'After' })
        .expect(200);
      expect(res.body.name).toBe('After');
    });

    it('moves a folder under another (reparents)', async () => {
      const a = (await createFolder(owner, 'MoveA')).body.id as string;
      const b = (await createFolder(owner, 'MoveB')).body.id as string;
      const res = await request(server)
        .patch(`/api/folders/${a}`)
        .set('Cookie', owner)
        .send({ parentId: b })
        .expect(200);
      expect(res.body.parentId).toBe(b);
    });

    it('moves a folder back to the root with parentId: null', async () => {
      const parent = (await createFolder(owner, 'P')).body.id as string;
      const child = (await createFolder(owner, 'C', parent)).body.id as string;
      const res = await request(server)
        .patch(`/api/folders/${child}`)
        .set('Cookie', owner)
        .send({ parentId: null })
        .expect(200);
      expect(res.body.parentId).toBeNull();
    });
  });

  describe('cycle safety', () => {
    it('rejects moving a folder under its own descendant (400)', async () => {
      // A > B > C ; moving A under C would create a cycle.
      const a = (await createFolder(owner, 'CycleA')).body.id as string;
      const b = (await createFolder(owner, 'CycleB', a)).body.id as string;
      const c = (await createFolder(owner, 'CycleC', b)).body.id as string;

      const res = await request(server)
        .patch(`/api/folders/${a}`)
        .set('Cookie', owner)
        .send({ parentId: c });
      expect(res.status).toBe(400);
    });

    it('rejects making a folder its own parent (400)', async () => {
      const a = (await createFolder(owner, 'SelfParent')).body.id as string;
      const res = await request(server)
        .patch(`/api/folders/${a}`)
        .set('Cookie', owner)
        .send({ parentId: a });
      expect(res.status).toBe(400);
    });
  });

  describe('cross-owner isolation', () => {
    it("user B cannot see user A's folders in the list", async () => {
      const a = (await createFolder(owner, 'PrivateToOwner')).body.id as string;
      const rows = await listFolders(other);
      expect(byId(rows, a)).toBeUndefined();
    });

    it("user B cannot rename user A's folder (404)", async () => {
      const a = (await createFolder(owner, 'NoTouch')).body.id as string;
      const res = await request(server)
        .patch(`/api/folders/${a}`)
        .set('Cookie', other)
        .send({ name: 'hacked' });
      expect(res.status).toBe(404);
    });

    it("user B cannot delete user A's folder (404)", async () => {
      const a = (await createFolder(owner, 'NoDelete')).body.id as string;
      const res = await request(server)
        .delete(`/api/folders/${a}`)
        .set('Cookie', other);
      expect(res.status).toBe(404);
    });

    it("user B cannot move their folder under user A's folder (404)", async () => {
      const aFolder = (await createFolder(owner, 'OwnerTarget')).body
        .id as string;
      const bFolder = (await createFolder(other, 'OtherSource')).body
        .id as string;
      const res = await request(server)
        .patch(`/api/folders/${bFolder}`)
        .set('Cookie', other)
        .send({ parentId: aFolder });
      expect(res.status).toBe(404);
    });
  });

  describe('delete reparents contents', () => {
    it('deleting a middle folder moves its child folders + notes up to the parent', async () => {
      // grand > mid > leaf ; a note lives in mid.
      const grand = (await createFolder(owner, 'Grand')).body.id as string;
      const mid = (await createFolder(owner, 'Mid', grand)).body.id as string;
      const leaf = (await createFolder(owner, 'Leaf', mid)).body.id as string;

      const note = await createNote(owner, 'note in mid');
      await request(server)
        .patch(`/api/notes/${note}`)
        .set('Cookie', owner)
        .send({ folderId: mid })
        .expect(200);

      await request(server)
        .delete(`/api/folders/${mid}`)
        .set('Cookie', owner)
        .expect(200);

      const rows = await listFolders(owner);
      // mid is gone; leaf reparented to grand.
      expect(byId(rows, mid)).toBeUndefined();
      expect(byId(rows, leaf)?.parentId).toBe(grand);

      // the note moved up to grand.
      const noteRes = await request(server)
        .get(`/api/notes/${note}`)
        .set('Cookie', owner)
        .expect(200);
      expect(noteRes.body.folderId).toBe(grand);
    });

    it('deleting a root folder sets its notes folderId to null', async () => {
      const root = (await createFolder(owner, 'RootDel')).body.id as string;
      const note = await createNote(owner, 'note in root folder');
      await request(server)
        .patch(`/api/notes/${note}`)
        .set('Cookie', owner)
        .send({ folderId: root })
        .expect(200);

      await request(server)
        .delete(`/api/folders/${root}`)
        .set('Cookie', owner)
        .expect(200);

      const noteRes = await request(server)
        .get(`/api/notes/${note}`)
        .set('Cookie', owner)
        .expect(200);
      expect(noteRes.body.folderId).toBeNull();
    });
  });

  describe('note assignment via PATCH meta', () => {
    it('files a note into a folder and clears it with null', async () => {
      const f = (await createFolder(owner, 'Assign')).body.id as string;
      const note = await createNote(owner, 'to assign');

      const filed = await request(server)
        .patch(`/api/notes/${note}`)
        .set('Cookie', owner)
        .send({ folderId: f })
        .expect(200);
      expect(filed.body.folderId).toBe(f);

      const cleared = await request(server)
        .patch(`/api/notes/${note}`)
        .set('Cookie', owner)
        .send({ folderId: null })
        .expect(200);
      expect(cleared.body.folderId).toBeNull();
    });

    it("rejects filing a note into another user's folder (404)", async () => {
      const ownerFolder = (await createFolder(owner, 'OwnerOnly')).body
        .id as string;
      const otherNote = await createNote(other, 'others note');
      const res = await request(server)
        .patch(`/api/notes/${otherNote}`)
        .set('Cookie', other)
        .send({ folderId: ownerFolder });
      expect(res.status).toBe(404);
    });
  });

  describe('list notes by folder', () => {
    it('returns only notes directly in that folder, and combines with filter=mine', async () => {
      const f = (await createFolder(owner, 'ListFolder')).body.id as string;
      const inFolder = await createNote(owner, 'in list folder');
      const elsewhere = await createNote(owner, 'not in folder');
      await request(server)
        .patch(`/api/notes/${inFolder}`)
        .set('Cookie', owner)
        .send({ folderId: f })
        .expect(200);

      const res = await request(server)
        .get(`/api/notes?filter=mine&folderId=${f}`)
        .set('Cookie', owner)
        .expect(200);
      const ids = res.body.map((n: { id: string }) => n.id);
      expect(ids).toContain(inFolder);
      expect(ids).not.toContain(elsewhere);
    });

    it("never returns another owner's notes for a folder id", async () => {
      const f = (await createFolder(owner, 'OwnerListFolder')).body
        .id as string;
      const ownerNote = await createNote(owner, 'owner note');
      await request(server)
        .patch(`/api/notes/${ownerNote}`)
        .set('Cookie', owner)
        .send({ folderId: f })
        .expect(200);

      // other user queries owner's folder id — gets nothing of owner's.
      const res = await request(server)
        .get(`/api/notes?folderId=${f}`)
        .set('Cookie', other)
        .expect(200);
      const ids = res.body.map((n: { id: string }) => n.id);
      expect(ids).not.toContain(ownerNote);
    });
  });
});
