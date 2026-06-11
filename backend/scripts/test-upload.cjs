// Dev verification: image upload + permission-checked serving across users.
// Requires the API running on :3000 and users admin@example.com / bob@example.com.
const base = 'http://localhost:3000/api';
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function login(email, password) {
  const r = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = r.headers.get('set-cookie');
  if (!setCookie) throw new Error(`no cookie for ${email} (status ${r.status})`);
  return setCookie.split(';')[0]; // access_token=...
}

(async () => {
  const admin = await login('admin@example.com', 'admin12345');

  let r = await fetch(`${base}/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: admin },
    body: JSON.stringify({ title: 'Image note' }),
  });
  const note = await r.json();
  console.log('created note:', note.id);

  const form = new FormData();
  form.append(
    'file',
    new Blob([Buffer.from(PNG_B64, 'base64')], { type: 'image/png' }),
    'pixel.png',
  );
  r = await fetch(`${base}/notes/${note.id}/images`, {
    method: 'POST',
    headers: { Cookie: admin },
    body: form,
  });
  console.log('upload status:', r.status);
  const up = await r.json();
  console.log('upload result:', JSON.stringify(up));

  r = await fetch(`${base}/uploads/${up.id}`, { headers: { Cookie: admin } });
  const bytes = (await r.arrayBuffer()).byteLength;
  console.log(
    `admin serve: status=${r.status} ctype=${r.headers.get('content-type')} bytes=${bytes}`,
  );

  const bob = await login('bob@example.com', 'bob12345');
  r = await fetch(`${base}/uploads/${up.id}`, { headers: { Cookie: bob } });
  console.log(`bob serve: status=${r.status} (expect 404)`);

  r = await fetch(`${base}/uploads/${up.id}`);
  console.log(`anon serve: status=${r.status} (expect 401)`);

  r = await fetch(`${base}/notes/${note.id}`, {
    method: 'DELETE',
    headers: { Cookie: admin },
  });
  console.log(`cleanup delete: status=${r.status}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
