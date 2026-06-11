// Dev verification: visibility + per-user share grants across users.
const base = 'http://localhost:3000/api';

async function login(email, password) {
  const r = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return r.headers.get('set-cookie').split(';')[0];
}
const j = (cookie, method, path, body) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body ? JSON.stringify(body) : undefined,
  });

(async () => {
  const admin = await login('admin@example.com', 'admin12345');
  const bob = await login('bob@example.com', 'bob12345');

  const users = await (await j(admin, 'GET', '/users')).json();
  const bobUser = users.find((u) => u.email === 'bob@example.com');
  console.log(
    `GET /users: count=${users.length} hasBob=${!!bobUser} hasSelf=${users.some((u) => u.email === 'admin@example.com')}`,
  );

  const note = await (await j(admin, 'POST', '/notes', { title: 'Share test' })).json();
  console.log('note:', note.id);

  const bobSees = async (label, expect) => {
    const r = await j(bob, 'GET', `/notes/${note.id}`);
    console.log(`${label}: bob GET -> ${r.status} (expect ${expect})`);
  };

  await bobSees('PRIVATE default', 404);

  await j(admin, 'PATCH', `/notes/${note.id}/visibility`, { visibility: 'PUBLIC' });
  await bobSees('after PUBLIC', 200);
  const bobList = await (await j(bob, 'GET', '/notes?filter=shared')).json();
  console.log(`bob shared-list includes it: ${bobList.some((n) => n.id === note.id)}`);

  await j(admin, 'PATCH', `/notes/${note.id}/visibility`, { visibility: 'PRIVATE' });
  await bobSees('back to PRIVATE', 404);

  await j(admin, 'PUT', `/notes/${note.id}/shares`, { userIds: [bobUser.id] });
  await bobSees('after grant to bob', 200);
  const shares = await (await j(admin, 'GET', `/notes/${note.id}/shares`)).json();
  console.log(
    `GET shares: visibility=${shares.visibility} sharedWith=[${shares.sharedWith.map((u) => u.email).join(',')}]`,
  );

  await j(admin, 'PUT', `/notes/${note.id}/shares`, { userIds: [] });
  await bobSees('after revoke', 404);

  // bob cannot change visibility (not owner)
  const r = await j(bob, 'PATCH', `/notes/${note.id}/visibility`, { visibility: 'PUBLIC' });
  console.log(`bob PATCH visibility -> ${r.status} (expect 404, hidden)`);

  await j(admin, 'DELETE', `/notes/${note.id}`);
  console.log('cleanup done');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
