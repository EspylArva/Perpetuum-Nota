// PR1 hardening verification. Requires API on :3000 + admin@example.com/admin12345.
const base = 'http://localhost:3000/api';

function parseCookies(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const jar = {};
  for (const c of raw) {
    const [kv] = c.split(';');
    const i = kv.indexOf('=');
    jar[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  }
  return jar;
}
const cookieHeader = (jar) =>
  Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

(async () => {
  let pass = 0;
  let fail = 0;
  const check = (name, cond, detail = '') => {
    (cond ? pass++ : fail++);
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  };

  // 1. helmet headers present
  let r = await fetch(`${base}/health`);
  check(
    'helmet: X-Content-Type-Options',
    r.headers.get('x-content-type-options') === 'nosniff',
    r.headers.get('x-content-type-options') ?? 'missing',
  );
  check(
    'helmet: X-Frame-Options / frameguard',
    !!r.headers.get('x-frame-options'),
    r.headers.get('x-frame-options') ?? 'missing',
  );

  // 2. login (CSRF-exempt) works and sets auth cookie
  r = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'admin12345' }),
  });
  const authJar = parseCookies(r);
  check('login works without CSRF token (exempt)', r.status === 200 && !!authJar['access_token']);

  // 3. mutation WITHOUT csrf token -> 403
  r = await fetch(`${base}/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader(authJar) },
    body: JSON.stringify({ title: 'should fail' }),
  });
  check('mutation without CSRF token is blocked', r.status === 403, `status ${r.status}`);

  // 4. get a csrf token, then mutation WITH token -> success
  r = await fetch(`${base}/auth/csrf`, { headers: { Cookie: cookieHeader(authJar) } });
  const csrfJar = parseCookies(r);
  const { token } = await r.json();
  const fullJar = { ...authJar, ...csrfJar };
  r = await fetch(`${base}/notes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieHeader(fullJar),
      'X-CSRF-Token': token,
    },
    body: JSON.stringify({ title: 'csrf ok' }),
  });
  const created = r.status === 201 ? await r.json() : null;
  check('mutation with CSRF token succeeds', r.status === 201, `status ${r.status}`);
  if (created) {
    await fetch(`${base}/notes/${created.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookieHeader(fullJar), 'X-CSRF-Token': token },
    });
  }

  // 5. login throttle: 5/min -> the 6th rapid attempt should 429
  let got429 = false;
  for (let i = 0; i < 8; i++) {
    const rr = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nope@example.com', password: 'wrong' }),
    });
    if (rr.status === 429) { got429 = true; break; }
  }
  check('login is rate-limited (429 after burst)', got429);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
