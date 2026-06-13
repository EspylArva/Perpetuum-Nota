/**
 * Note-to-note wikilink + graph e2e — link resolution on content save, the
 * single-note DTO `links`, and the GET /api/notes/graph shape with viewability.
 *
 * Runs against the dev Postgres in an isolated `e2e_links` schema (created/
 * migrated on the fly), so it never touches dev data.
 */
import { execSync } from 'child_process';
import * as path from 'path';

// Must be set BEFORE AppModule (and thus PrismaClient) is loaded.
// Distinct schema so this suite does not conflict with the other e2e specs.
const BASE_DB =
  process.env.E2E_DATABASE_URL ??
  'postgresql://stickynotes:stickynotes_dev_pw@localhost:5432/stickynotes';
process.env.DATABASE_URL = `${BASE_DB}?schema=e2e_links`;
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

/** ProseMirror doc with one paragraph of the given text. */
function doc(text: string) {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

describe('Note links + graph (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaClient;

  let alice: string;
  let bob: string;

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

  async function setContent(
    cookie: string,
    id: string,
    text: string,
  ): Promise<void> {
    await request(server)
      .patch(`/api/notes/${id}/content`)
      .set('Cookie', cookie)
      .send({ content: doc(text) })
      .expect(200);
  }

  function getNote(cookie: string, id: string): request.Test {
    return request(server).get(`/api/notes/${id}`).set('Cookie', cookie);
  }

  function linkTitles(res: request.Response): string[] {
    return (res.body.links as { id: string; title: string }[]).map(
      (l) => l.title,
    );
  }

  beforeAll(async () => {
    execSync('npx prisma migrate deploy', {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env },
      stdio: 'pipe',
    });

    prisma = new PrismaClient();
    await prisma.noteLink.deleteMany();
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
    await Promise.all([mk('links-alice@test.io'), mk('links-bob@test.io')]);

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

    alice = await login('links-alice@test.io');
    bob = await login('links-bob@test.io');
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  describe('link resolution on content save', () => {
    it('creates a link when A references [[B]] by exact title', async () => {
      const a = await createNote(alice, 'Apple');
      await createNote(alice, 'Banana');
      await setContent(alice, a, 'go to [[Banana]] now');

      const res = await getNote(alice, a).expect(200);
      expect(linkTitles(res)).toEqual(['Banana']);
    });

    it('matches case-insensitively', async () => {
      const a = await createNote(alice, 'Cherry');
      await createNote(alice, 'Date');
      await setContent(alice, a, 'see [[dAtE]]');

      const res = await getNote(alice, a).expect(200);
      expect(linkTitles(res)).toEqual(['Date']); // target's stored casing
    });

    it('resolves ambiguity to the most recently updated target', async () => {
      const a = await createNote(alice, 'Elder');
      const older = await createNote(alice, 'Fig');
      const newer = await createNote(alice, 'Fig');
      // Touch `newer` last so it is the most recently updated "Fig".
      await setContent(alice, older, 'older fig body');
      await setContent(alice, newer, 'newer fig body');
      await setContent(alice, a, 'pick a [[Fig]]');

      const res = await getNote(alice, a).expect(200);
      const links = res.body.links as { id: string }[];
      expect(links).toHaveLength(1);
      expect(links[0].id).toBe(newer);
    });

    it('produces no link for an unresolved title', async () => {
      const a = await createNote(alice, 'Grape');
      await setContent(alice, a, 'link to [[Nonexistent Note]]');

      const res = await getNote(alice, a).expect(200);
      expect(res.body.links).toEqual([]);
    });

    it('skips a self-link (a note linking its own title)', async () => {
      const a = await createNote(alice, 'Hazel');
      await setContent(alice, a, 'I am [[Hazel]] myself');

      const res = await getNote(alice, a).expect(200);
      expect(res.body.links).toEqual([]);
    });

    it('a 409 conflict leaves existing links untouched (no recompute)', async () => {
      const a = await createNote(alice, 'OptA');
      const target = await createNote(alice, 'OptTarget');
      await setContent(alice, a, 'see [[OptTarget]]');

      // Fetch current contentUpdatedAt to build a STALE base for a conflict.
      const before = await getNote(alice, a).expect(200);
      const stale = new Date(
        new Date(before.body.contentUpdatedAt).getTime() - 60_000,
      ).toISOString();

      // Conflicting write that drops the link — must 409 and NOT change links.
      await request(server)
        .patch(`/api/notes/${a}/content`)
        .set('Cookie', alice)
        .send({ content: doc('no link here'), baseContentUpdatedAt: stale })
        .expect(409);

      const after = await getNote(alice, a).expect(200);
      const links = after.body.links as { id: string }[];
      expect(links).toHaveLength(1);
      expect(links[0].id).toBe(target); // link preserved despite the 409
    });

    it('resolves only within the OWNER namespace (not the viewer/other user)', async () => {
      // Bob owns a public "Iris"; Alice links [[Iris]] but owns no such note.
      const bobIris = await createNote(bob, 'Iris');
      await request(server)
        .patch(`/api/notes/${bobIris}/visibility`)
        .set('Cookie', bob)
        .send({ visibility: 'PUBLIC' })
        .expect(200);

      const a = await createNote(alice, 'Juniper');
      await setContent(alice, a, 'link to [[Iris]]');

      const res = await getNote(alice, a).expect(200);
      expect(res.body.links).toEqual([]); // Iris is not in Alice's namespace
    });
  });

  describe('rename + delete behaviour', () => {
    it('rename of the target follows the id-link: GET shows the new title', async () => {
      const a = await createNote(alice, 'Kiwi');
      const target = await createNote(alice, 'Lemon');
      await setContent(alice, a, 'taste the [[Lemon]]');

      let res = await getNote(alice, a).expect(200);
      expect(linkTitles(res)).toEqual(['Lemon']);

      // Rename the target; the source text is NOT rewritten.
      await request(server)
        .patch(`/api/notes/${target}`)
        .set('Cookie', alice)
        .send({ title: 'Lime' })
        .expect(200);

      res = await getNote(alice, a).expect(200);
      const links = res.body.links as { id: string; title: string }[];
      expect(links).toHaveLength(1);
      expect(links[0].id).toBe(target);
      expect(links[0].title).toBe('Lime'); // current title, link row persisted
    });

    it('deleting the target removes the row (cascade) so GET no longer lists it', async () => {
      const a = await createNote(alice, 'Mango');
      const target = await createNote(alice, 'Nectarine');
      await setContent(alice, a, 'a ripe [[Nectarine]]');

      let res = await getNote(alice, a).expect(200);
      expect(linkTitles(res)).toEqual(['Nectarine']);

      // Hard-delete the target → NoteLink row cascades away.
      await request(server)
        .delete(`/api/notes/${target}`)
        .set('Cookie', alice)
        .expect(200);
      await request(server)
        .delete(`/api/notes/${target}/permanent`)
        .set('Cookie', alice)
        .expect(200);

      res = await getNote(alice, a).expect(200);
      expect(res.body.links).toEqual([]);
    });
  });

  describe('GET /api/notes/graph', () => {
    let g1: string;
    let g2: string;

    it('returns nodes + a single undirected edge for a one-way link', async () => {
      g1 = await createNote(alice, 'GraphOne');
      g2 = await createNote(alice, 'GraphTwo');
      await setContent(alice, g1, 'see [[GraphTwo]]');
      // Bidirectional reference must still dedupe to ONE edge.
      await setContent(alice, g2, 'back to [[GraphOne]]');

      const res = await request(server)
        .get('/api/notes/graph')
        .set('Cookie', alice)
        .expect(200);

      const nodeIds = (res.body.nodes as { id: string }[]).map((n) => n.id);
      expect(nodeIds).toEqual(expect.arrayContaining([g1, g2]));

      const edges = res.body.edges as { a: string; b: string }[];
      const between = edges.filter(
        (e) => (e.a === g1 && e.b === g2) || (e.a === g2 && e.b === g1),
      );
      expect(between).toHaveLength(1); // undirected dedupe
    });

    it('omits an edge when one endpoint is not viewable by the requester', async () => {
      // Alice has a PRIVATE note linking another of her private notes; Bob can
      // see neither, so Bob's graph contains neither node nor the edge.
      const res = await request(server)
        .get('/api/notes/graph')
        .set('Cookie', bob)
        .expect(200);

      const nodeIds = (res.body.nodes as { id: string }[]).map((n) => n.id);
      expect(nodeIds).not.toContain(g1);
      expect(nodeIds).not.toContain(g2);

      const edges = res.body.edges as { a: string; b: string }[];
      expect(
        edges.some((e) => e.a === g1 || e.b === g1 || e.a === g2 || e.b === g2),
      ).toBe(false);
    });

    it("does not leak another user's private notes as graph nodes", async () => {
      const priv = await createNote(alice, 'AliceSecret');
      await setContent(alice, priv, 'private body, no links');

      const res = await request(server)
        .get('/api/notes/graph')
        .set('Cookie', bob)
        .expect(200);
      const nodeIds = (res.body.nodes as { id: string }[]).map((n) => n.id);
      expect(nodeIds).not.toContain(priv);
    });
  });
});
