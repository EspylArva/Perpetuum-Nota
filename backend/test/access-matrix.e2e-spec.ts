/**
 * Access-matrix e2e — the IDOR guard for the whole API surface.
 *
 * Exercises owner / non-owner / PUBLIC / share-granted across notes AND their
 * images, plus the trash visibility rules, optimistic-concurrency 409s,
 * password change, and the last-admin lockout guard.
 *
 * Runs against the dev Postgres in an isolated `e2e` schema (created/migrated
 * on the fly), so it never touches dev data.
 */
import { execSync } from 'child_process';
import * as path from 'path';

// Must be set BEFORE AppModule (and thus PrismaClient) is loaded.
const BASE_DB =
  process.env.E2E_DATABASE_URL ??
  'postgresql://stickynotes:stickynotes_dev_pw@localhost:5432/stickynotes';
process.env.DATABASE_URL = `${BASE_DB}?schema=e2e`;
process.env.ADMIN_EMAIL = ''; // disable bootstrap seeding; the test seeds itself
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

// 1x1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };
const PASSWORD = 'password-123';

describe('Access matrix (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaClient;

  // cookies per persona
  let owner: string;
  let grantee: string;
  let stranger: string;
  let admin: string;

  let ownerId: string;
  let granteeId: string;
  let strangerId: string;

  // fixtures
  let privateNote: string; // owner's, PRIVATE, no grants
  let grantedNote: string; // owner's, PRIVATE, granted to grantee
  let publicNote: string; // owner's, PUBLIC
  let privateImg: string;
  let grantedImg: string;
  let publicImg: string;

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

  async function uploadImage(cookie: string, noteId: string): Promise<string> {
    const res = await request(server)
      .post(`/api/notes/${noteId}/images`)
      .set('Cookie', cookie)
      .attach('file', PNG, { filename: 'p.png', contentType: 'image/png' })
      .expect(201);
    return res.body.id as string;
  }

  beforeAll(async () => {
    execSync('npx prisma migrate deploy', {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env },
      stdio: 'pipe',
    });

    prisma = new PrismaClient();
    // Order respects FKs (all cascade from User, but be explicit).
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
    const [o, g, s] = await Promise.all([
      mk('owner@test.io'),
      mk('grantee@test.io'),
      mk('stranger@test.io'),
    ]);
    await mk('admin@test.io', 'ADMIN');
    ownerId = o.id;
    granteeId = g.id;
    strangerId = s.id;

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

    owner = await login('owner@test.io');
    grantee = await login('grantee@test.io');
    stranger = await login('stranger@test.io');
    admin = await login('admin@test.io');

    privateNote = await createNote(owner, 'private note');
    grantedNote = await createNote(owner, 'granted note');
    publicNote = await createNote(owner, 'public note');

    await request(server)
      .put(`/api/notes/${grantedNote}/shares`)
      .set('Cookie', owner)
      .send({ userIds: [granteeId] })
      .expect(200);
    await request(server)
      .patch(`/api/notes/${publicNote}/visibility`)
      .set('Cookie', owner)
      .send({ visibility: 'PUBLIC' })
      .expect(200);

    privateImg = await uploadImage(owner, privateNote);
    grantedImg = await uploadImage(owner, grantedNote);
    publicImg = await uploadImage(owner, publicNote);

    // Reference the uploaded image from the public note's body (as the real
    // editor does) so duplication has a src to remap.
    await request(server)
      .patch(`/api/notes/${publicNote}/content`)
      .set('Cookie', owner)
      .send({
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'public body' }],
            },
            { type: 'image', attrs: { src: `/api/uploads/${publicImg}` } },
          ],
        },
      })
      .expect(200);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  // ---------- view ----------
  describe('viewing notes', () => {
    it('owner sees all own notes', async () => {
      for (const id of [privateNote, grantedNote, publicNote]) {
        await request(server).get(`/api/notes/${id}`).set('Cookie', owner).expect(200);
      }
    });

    it('grantee sees granted + public, not private (404 hides existence)', async () => {
      await request(server).get(`/api/notes/${grantedNote}`).set('Cookie', grantee).expect(200);
      await request(server).get(`/api/notes/${publicNote}`).set('Cookie', grantee).expect(200);
      await request(server).get(`/api/notes/${privateNote}`).set('Cookie', grantee).expect(404);
    });

    it('stranger sees only public', async () => {
      await request(server).get(`/api/notes/${publicNote}`).set('Cookie', stranger).expect(200);
      await request(server).get(`/api/notes/${privateNote}`).set('Cookie', stranger).expect(404);
      await request(server).get(`/api/notes/${grantedNote}`).set('Cookie', stranger).expect(404);
    });

    it('unauthenticated gets 401 everywhere', async () => {
      await request(server).get(`/api/notes/${publicNote}`).expect(401);
      await request(server).get(`/api/uploads/${publicImg}`).expect(401);
    });
  });

  // ---------- images mirror note access ----------
  describe('image serving mirrors note access', () => {
    it('owner streams all', async () => {
      for (const id of [privateImg, grantedImg, publicImg]) {
        await request(server).get(`/api/uploads/${id}`).set('Cookie', owner).expect(200);
      }
    });

    it('grantee: granted + public yes, private no', async () => {
      await request(server).get(`/api/uploads/${grantedImg}`).set('Cookie', grantee).expect(200);
      await request(server).get(`/api/uploads/${publicImg}`).set('Cookie', grantee).expect(200);
      await request(server).get(`/api/uploads/${privateImg}`).set('Cookie', grantee).expect(404);
    });

    it('stranger: only public', async () => {
      await request(server).get(`/api/uploads/${publicImg}`).set('Cookie', stranger).expect(200);
      await request(server).get(`/api/uploads/${privateImg}`).set('Cookie', stranger).expect(404);
      await request(server).get(`/api/uploads/${grantedImg}`).set('Cookie', stranger).expect(404);
    });
  });

  // ---------- mutation is owner-only ----------
  describe('mutation is owner-only', () => {
    const cases: [string, () => string][] = [
      ['grantee on granted', () => grantee],
      ['stranger on public', () => stranger],
    ];

    it.each(cases)('%s cannot mutate (403 on viewable, 404 on hidden)', async (_label, who) => {
      const cookie = who();
      const note = cookie === grantee ? grantedNote : publicNote;
      await request(server).patch(`/api/notes/${note}`).set('Cookie', cookie).send({ title: 'x' }).expect(403);
      await request(server)
        .patch(`/api/notes/${note}/content`)
        .set('Cookie', cookie)
        .send({ content: EMPTY_DOC })
        .expect(403);
      await request(server).delete(`/api/notes/${note}`).set('Cookie', cookie).expect(403);
      await request(server).delete(`/api/notes/${note}/permanent`).set('Cookie', cookie).expect(403);
      await request(server)
        .patch(`/api/notes/${note}/visibility`)
        .set('Cookie', cookie)
        .send({ visibility: 'PUBLIC' })
        .expect(403);
      await request(server).get(`/api/notes/${note}/shares`).set('Cookie', cookie).expect(403);
      await request(server)
        .put(`/api/notes/${note}/shares`)
        .set('Cookie', cookie)
        .send({ userIds: [] })
        .expect(403);
      await request(server)
        .put(`/api/notes/${note}/tags`)
        .set('Cookie', cookie)
        .send({ names: ['x'] })
        .expect(403);
      await request(server)
        .post(`/api/notes/${note}/images`)
        .set('Cookie', cookie)
        .attach('file', PNG, { filename: 'p.png', contentType: 'image/png' })
        .expect(403);
    });

    it('grantee cannot upload to a hidden private note (404)', async () => {
      await request(server)
        .post(`/api/notes/${privateNote}/images`)
        .set('Cookie', grantee)
        .attach('file', PNG, { filename: 'p.png', contentType: 'image/png' })
        .expect(404);
    });

    it('batch-delete silently skips notes the caller does not own', async () => {
      const res = await request(server)
        .post('/api/notes/batch-delete')
        .set('Cookie', stranger)
        .send({ ids: [privateNote, grantedNote, publicNote] })
        .expect(200);
      expect(res.body.deleted).toEqual([]);
      // notes untouched
      await request(server).get(`/api/notes/${publicNote}`).set('Cookie', owner).expect(200);
    });

    it('reorder ignores foreign ids', async () => {
      const res = await request(server)
        .post('/api/notes/reorder')
        .set('Cookie', stranger)
        .send({ orderedIds: [publicNote] })
        .expect(200);
      expect(res.body.updated).toEqual([]);
    });
  });

  // ---------- listing ----------
  describe('listing', () => {
    it('mine / shared / all are scoped correctly', async () => {
      const mine = await request(server).get('/api/notes?filter=mine').set('Cookie', grantee).expect(200);
      expect(mine.body.map((n: { id: string }) => n.id)).toEqual(
        expect.not.arrayContaining([privateNote, grantedNote, publicNote]),
      );

      const shared = await request(server).get('/api/notes?filter=shared').set('Cookie', grantee).expect(200);
      const sharedIds = shared.body.map((n: { id: string }) => n.id);
      expect(sharedIds).toEqual(expect.arrayContaining([grantedNote, publicNote]));
      expect(sharedIds).not.toContain(privateNote);

      const all = await request(server).get('/api/notes?filter=all').set('Cookie', stranger).expect(200);
      const allIds = all.body.map((n: { id: string }) => n.id);
      expect(allIds).toContain(publicNote);
      expect(allIds).not.toContain(privateNote);
      expect(allIds).not.toContain(grantedNote);
    });

    it('search never leaks unviewable notes', async () => {
      // "private note" matches the title of owner's private note
      const res = await request(server)
        .get('/api/notes?filter=all&q=private%20note')
        .set('Cookie', stranger)
        .expect(200);
      expect(res.body.map((n: { id: string }) => n.id)).not.toContain(privateNote);
    });
  });

  // ---------- trash ----------
  describe('trash', () => {
    let trashed: string;
    let trashedImg: string;

    beforeAll(async () => {
      trashed = await createNote(owner, 'doomed');
      await request(server)
        .put(`/api/notes/${trashed}/shares`)
        .set('Cookie', owner)
        .send({ userIds: [granteeId] })
        .expect(200);
      trashedImg = await uploadImage(owner, trashed);
      await request(server).delete(`/api/notes/${trashed}`).set('Cookie', owner).expect(200);
    });

    it('grantee loses note AND image access the moment it is trashed', async () => {
      await request(server).get(`/api/notes/${trashed}`).set('Cookie', grantee).expect(404);
      await request(server).get(`/api/uploads/${trashedImg}`).set('Cookie', grantee).expect(404);
    });

    it('owner still views the trashed note and its image', async () => {
      await request(server).get(`/api/notes/${trashed}`).set('Cookie', owner).expect(200);
      await request(server).get(`/api/uploads/${trashedImg}`).set('Cookie', owner).expect(200);
    });

    it('trashed notes appear only in filter=trash, only for the owner', async () => {
      const ownTrash = await request(server).get('/api/notes?filter=trash').set('Cookie', owner).expect(200);
      expect(ownTrash.body.map((n: { id: string }) => n.id)).toContain(trashed);

      const ownAll = await request(server).get('/api/notes?filter=all').set('Cookie', owner).expect(200);
      expect(ownAll.body.map((n: { id: string }) => n.id)).not.toContain(trashed);

      const granteeTrash = await request(server).get('/api/notes?filter=trash').set('Cookie', grantee).expect(200);
      expect(granteeTrash.body.map((n: { id: string }) => n.id)).not.toContain(trashed);
    });

    it('only the owner can restore; restore brings grant access back', async () => {
      await request(server).post(`/api/notes/${trashed}/restore`).set('Cookie', grantee).expect(404);
      await request(server).post(`/api/notes/${trashed}/restore`).set('Cookie', owner).expect(201);
      await request(server).get(`/api/notes/${trashed}`).set('Cookie', grantee).expect(200);
    });

    it('permanent delete removes note and image for everyone', async () => {
      await request(server).delete(`/api/notes/${trashed}`).set('Cookie', owner).expect(200);
      await request(server).delete(`/api/notes/${trashed}/permanent`).set('Cookie', owner).expect(200);
      await request(server).get(`/api/notes/${trashed}`).set('Cookie', owner).expect(404);
      await request(server).get(`/api/uploads/${trashedImg}`).set('Cookie', owner).expect(404);
    });
  });

  // ---------- duplicate ----------
  describe('duplicate', () => {
    it('viewer can duplicate a public note into their own account, reset to PRIVATE', async () => {
      const res = await request(server)
        .post(`/api/notes/${publicNote}/duplicate`)
        .set('Cookie', stranger)
        .expect(201);
      expect(res.body.isOwner).toBe(true);
      expect(res.body.visibility).toBe('PRIVATE');
      // the copy's image is a fresh asset owned by the copy — owner of the
      // original cannot be deprived, and the copy survives the original
      const copy = await request(server)
        .get(`/api/notes/${res.body.id}`)
        .set('Cookie', stranger)
        .expect(200);
      const src = JSON.stringify(copy.body.content).match(/\/api\/uploads\/([0-9a-f-]{36})/);
      expect(src).not.toBeNull();
      expect(src![1]).not.toBe(publicImg);
      await request(server).get(`/api/uploads/${src![1]}`).set('Cookie', stranger).expect(200);
      // original owner cannot view the copy
      await request(server).get(`/api/notes/${res.body.id}`).set('Cookie', owner).expect(404);
    });

    it('stranger cannot duplicate a hidden private note', async () => {
      await request(server)
        .post(`/api/notes/${privateNote}/duplicate`)
        .set('Cookie', stranger)
        .expect(404);
    });
  });

  // ---------- optimistic concurrency ----------
  describe('autosave concurrency', () => {
    it('stale baseContentUpdatedAt is rejected with 409, fresh one accepted', async () => {
      const note = await request(server).get(`/api/notes/${privateNote}`).set('Cookie', owner).expect(200);
      const base = note.body.contentUpdatedAt as string;

      const first = await request(server)
        .patch(`/api/notes/${privateNote}/content`)
        .set('Cookie', owner)
        .send({ content: EMPTY_DOC, baseContentUpdatedAt: base })
        .expect(200);

      // replay with the now-stale base → conflict
      await request(server)
        .patch(`/api/notes/${privateNote}/content`)
        .set('Cookie', owner)
        .send({ content: EMPTY_DOC, baseContentUpdatedAt: base })
        .expect(409);

      // fresh base → accepted
      await request(server)
        .patch(`/api/notes/${privateNote}/content`)
        .set('Cookie', owner)
        .send({ content: EMPTY_DOC, baseContentUpdatedAt: first.body.contentUpdatedAt })
        .expect(200);
    });

    it('non-doc content is a 400, not a conflict', async () => {
      await request(server)
        .patch(`/api/notes/${privateNote}/content`)
        .set('Cookie', owner)
        .send({ content: { type: 'paragraph' } })
        .expect(400);
    });
  });

  // ---------- share visibility lifecycle ----------
  describe('revocation', () => {
    it('revoking a grant cuts note and image access immediately', async () => {
      await request(server)
        .put(`/api/notes/${grantedNote}/shares`)
        .set('Cookie', owner)
        .send({ userIds: [] })
        .expect(200);
      await request(server).get(`/api/notes/${grantedNote}`).set('Cookie', grantee).expect(404);
      await request(server).get(`/api/uploads/${grantedImg}`).set('Cookie', grantee).expect(404);
      // restore the grant for any later assertions
      await request(server)
        .put(`/api/notes/${grantedNote}/shares`)
        .set('Cookie', owner)
        .send({ userIds: [granteeId] })
        .expect(200);
    });

    it('flipping public→private cuts stranger access', async () => {
      await request(server)
        .patch(`/api/notes/${publicNote}/visibility`)
        .set('Cookie', owner)
        .send({ visibility: 'PRIVATE' })
        .expect(200);
      await request(server).get(`/api/notes/${publicNote}`).set('Cookie', stranger).expect(404);
      await request(server).get(`/api/uploads/${publicImg}`).set('Cookie', stranger).expect(404);
      await request(server)
        .patch(`/api/notes/${publicNote}/visibility`)
        .set('Cookie', owner)
        .send({ visibility: 'PUBLIC' })
        .expect(200);
    });
  });

  // ---------- tags are owner-scoped ----------
  describe('tags', () => {
    it('owner tags; tag listing is per-user', async () => {
      await request(server)
        .put(`/api/notes/${privateNote}/tags`)
        .set('Cookie', owner)
        .send({ names: ['Work', 'work', '  Ideas  '] })
        .expect(200)
        .expect((res) => {
          // case-insensitive dedupe + trim
          expect(res.body.tags).toEqual(['Ideas', 'Work']);
        });

      const ownerTags = await request(server).get('/api/tags').set('Cookie', owner).expect(200);
      expect(ownerTags.body.map((t: { name: string }) => t.name)).toEqual(
        expect.arrayContaining(['Ideas', 'Work']),
      );

      const granteeTags = await request(server).get('/api/tags').set('Cookie', grantee).expect(200);
      expect(granteeTags.body).toEqual([]);
    });

    it("cannot delete someone else's tag", async () => {
      const ownerTags = await request(server).get('/api/tags').set('Cookie', owner).expect(200);
      const tagId = ownerTags.body[0].id as string;
      await request(server).delete(`/api/tags/${tagId}`).set('Cookie', grantee).expect(404);
      // still there
      const after = await request(server).get('/api/tags').set('Cookie', owner).expect(200);
      expect(after.body.map((t: { id: string }) => t.id)).toContain(tagId);
    });
  });

  // ---------- account safety ----------
  describe('account safety', () => {
    it('password change requires the correct current password', async () => {
      await request(server)
        .post('/api/auth/change-password')
        .set('Cookie', stranger)
        .send({ currentPassword: 'wrong-password', newPassword: 'new-password-1' })
        .expect(401);

      await request(server)
        .post('/api/auth/change-password')
        .set('Cookie', stranger)
        .send({ currentPassword: PASSWORD, newPassword: 'new-password-1' })
        .expect(200);

      // old password rejected, new one works
      await request(server)
        .post('/api/auth/login')
        .send({ email: 'stranger@test.io', password: PASSWORD })
        .expect(401);
      await request(server)
        .post('/api/auth/login')
        .send({ email: 'stranger@test.io', password: 'new-password-1' })
        .expect(200);
    });

    it('non-admin cannot reach admin user management', async () => {
      await request(server).get('/api/users/manage').set('Cookie', owner).expect(403);
      await request(server)
        .patch(`/api/users/${strangerId}`)
        .set('Cookie', owner)
        .send({ isActive: false })
        .expect(403);
    });

    it('the last active admin cannot be deactivated or demoted', async () => {
      const admins = await request(server).get('/api/users/manage').set('Cookie', admin).expect(200);
      const adminUser = admins.body.find((u: { email: string }) => u.email === 'admin@test.io');

      await request(server)
        .patch(`/api/users/${adminUser.id}`)
        .set('Cookie', admin)
        .send({ isActive: false })
        .expect(409);
      await request(server)
        .patch(`/api/users/${adminUser.id}`)
        .set('Cookie', admin)
        .send({ role: 'USER' })
        .expect(409);

      // still active + admin
      const after = await request(server).get('/api/users/manage').set('Cookie', admin).expect(200);
      const self = after.body.find((u: { id: string }) => u.id === adminUser.id);
      expect(self.isActive).toBe(true);
      expect(self.role).toBe('ADMIN');
    });

    it('deactivated users lose access on their next request', async () => {
      const tmp = await prisma.user.create({
        data: {
          email: 'temp@test.io',
          displayName: 'temp',
          passwordHash: await argon2.hash(PASSWORD),
        },
      });
      const tmpCookie = await login('temp@test.io');
      await request(server).get('/api/notes').set('Cookie', tmpCookie).expect(200);
      await prisma.user.update({ where: { id: tmp.id }, data: { isActive: false } });
      await request(server).get('/api/notes').set('Cookie', tmpCookie).expect(401);
    });
  });

  // ---------- user deletion ----------
  describe('user deletion (admin)', () => {
    it('non-admin cannot delete users', async () => {
      await request(server)
        .delete(`/api/users/${strangerId}`)
        .set('Cookie', owner)
        .expect(403);
    });

    it('an admin cannot delete their own account', async () => {
      const admins = await request(server).get('/api/users/manage').set('Cookie', admin).expect(200);
      const self = admins.body.find((u: { email: string }) => u.email === 'admin@test.io');
      await request(server).delete(`/api/users/${self.id}`).set('Cookie', admin).expect(409);
    });

    it('deleting a user removes their notes, shares, and image rows', async () => {
      const victim = await prisma.user.create({
        data: {
          email: 'victim@test.io',
          displayName: 'victim',
          passwordHash: await argon2.hash(PASSWORD),
        },
      });
      const victimCookie = await login('victim@test.io');
      const noteId = await createNote(victimCookie, 'victim note');
      const imgId = await uploadImage(victimCookie, noteId);
      // grant + make sure the grantee could see it pre-delete
      await request(server)
        .put(`/api/notes/${noteId}/shares`)
        .set('Cookie', victimCookie)
        .send({ userIds: [granteeId] })
        .expect(200);
      await request(server).get(`/api/notes/${noteId}`).set('Cookie', grantee).expect(200);

      await request(server)
        .delete(`/api/users/${victim.id}`)
        .set('Cookie', admin)
        .expect(200);

      // session dead, data gone for everyone
      await request(server).get('/api/notes').set('Cookie', victimCookie).expect(401);
      await request(server).get(`/api/notes/${noteId}`).set('Cookie', grantee).expect(404);
      await request(server).get(`/api/uploads/${imgId}`).set('Cookie', grantee).expect(404);
      expect(await prisma.note.count({ where: { ownerId: victim.id } })).toBe(0);
      expect(await prisma.imageAsset.count({ where: { uploadedById: victim.id } })).toBe(0);
    });
  });
});
