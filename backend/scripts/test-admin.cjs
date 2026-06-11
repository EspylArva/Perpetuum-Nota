// Dev verification: admin user management + role enforcement.
const base = 'http://localhost:3000/api';

async function login(email, password) {
  const r = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return { status: r.status, cookie: r.headers.get('set-cookie')?.split(';')[0] };
}
const j = (cookie, method, path, body) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body ? JSON.stringify(body) : undefined,
  });

(async () => {
  const admin = (await login('admin@example.com', 'admin12345')).cookie;
  const bob = (await login('bob@example.com', 'bob12345')).cookie;

  let r = await j(bob, 'GET', '/users/manage');
  console.log(`bob GET /users/manage -> ${r.status} (expect 403)`);

  r = await j(bob, 'POST', '/users', { email: 'x@x.com', displayName: 'X', password: 'xxxxxx' });
  console.log(`bob POST /users -> ${r.status} (expect 403)`);

  r = await j(admin, 'GET', '/users/manage');
  const all = await r.json();
  console.log(`admin GET /users/manage -> ${r.status}, count=${all.length}`);

  r = await j(admin, 'POST', '/users', {
    email: 'carol@example.com',
    displayName: 'Carol',
    password: 'carol123',
    role: 'USER',
  });
  const carol = await r.json();
  console.log(`admin create carol -> ${r.status} id=${carol.id} active=${carol.isActive}`);

  let c = await login('carol@example.com', 'carol123');
  console.log(`carol login -> ${c.status} (expect 200)`);

  r = await j(admin, 'PATCH', `/users/${carol.id}`, { isActive: false });
  console.log(`admin deactivate carol -> ${r.status}`);

  c = await login('carol@example.com', 'carol123');
  console.log(`carol login after deactivation -> ${c.status} (expect 401)`);

  // duplicate email
  r = await j(admin, 'POST', '/users', {
    email: 'carol@example.com',
    displayName: 'Dup',
    password: 'dup123x',
  });
  console.log(`admin create duplicate email -> ${r.status} (expect 409)`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
