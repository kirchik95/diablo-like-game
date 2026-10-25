import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { gunzipSync } from 'node:zlib';
import { createDistHandler } from '../scripts/serve-dist.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ritual-dist-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, 'dist'); await mkdir(join(root, 'assets'), { recursive: true });
  const files = { 'index.html': '<html>Ночной ритуал</html>', 'version.json': '{"buildId":"qa"}',
    'manifest.webmanifest': '{}', 'assets/main-aB1_cD2-.js': 'export const ready = true;'.repeat(100),
    'assets/music-aB1_cD2-.m4a': 'audio bytes', 'assets/masks-aB1_cD2-.json': '{"width":128}',
    'assets/atlas-aB1_cD2-.png': 'png bytes', 'plain.js': 'no hash' };
  await Promise.all(Object.entries(files).map(([name, body]) => writeFile(join(root, name), body)));
  await writeFile(join(dir, 'outside.txt'), 'private');
  await symlink(join(dir, 'outside.txt'), join(root, 'leak.txt'));
  const handle = createDistHandler(root);
  return async (url, { method = 'GET', headers = {} } = {}) => {
    const chunks = [], responseHeaders = {};
    const response = new Writable({ write(chunk, encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
    response.statusCode = 200;
    response.setHeader = (key, value) => { responseHeaders[key.toLowerCase()] = String(value); };
    await handle({ url, method, headers }, response);
    return { status: response.statusCode, headers: responseHeaders, body: Buffer.concat(chunks) };
  };
}

test('HTML and version bypass cache; only hashed assets are immutable; MIME matches the file', async t => {
  const request = await fixture(t);
  for (const name of ['/', '/index.html?update=1', '/version.json']) {
    const r = await request(name); assert.equal(r.status, 200); assert.equal(r.headers['cache-control'], 'no-store');
  }
  for (const [name, mime] of [['main-aB1_cD2-.js','text/javascript'], ['music-aB1_cD2-.m4a','audio/mp4'],
    ['masks-aB1_cD2-.json','application/json'], ['atlas-aB1_cD2-.png','image/png']]) {
    const r = await request(`/assets/${name}`);
    assert.equal(r.status, 200); assert.equal(r.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.ok(r.headers['content-type'].startsWith(mime), name);
  }
  assert.equal((await request('/manifest.webmanifest')).headers['content-type'], 'application/manifest+json; charset=utf-8');
  assert.equal((await request('/plain.js')).headers['cache-control'], 'no-cache');
});

test('text gzip is lossless; HEAD has no body; binary assets are unchanged', async t => {
  const request = await fixture(t), url = '/assets/main-aB1_cD2-.js';
  const raw = await request(url), zipped = await request(url, { headers: { 'accept-encoding': 'br, gzip' } });
  assert.equal(zipped.headers['content-encoding'], 'gzip');
  assert.equal(zipped.headers.vary, 'Accept-Encoding');
  assert.deepEqual(gunzipSync(zipped.body), raw.body);
  assert.ok(zipped.body.length < raw.body.length);
  assert.equal((await request(url, { headers: { 'accept-encoding': 'gzip;q=0, br' } })).headers['content-encoding'], undefined);
  const head = await request(url, { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(head.body.length, 0);
  assert.equal(Number(head.headers['content-length']), raw.body.length);
  assert.equal((await request('/assets/music-aB1_cD2-.m4a', { headers: { 'accept-encoding': 'gzip' } })).headers['content-encoding'], undefined);
});

test('missing, malformed, traversal, hidden, symlink and unsupported requests never expose other files', async t => {
  const request = await fixture(t);
  assert.equal((await request('/missing.js')).status, 404);
  assert.equal((await request('/assets/')).status, 404);
  assert.equal((await request('/%E0%A4%A')).status, 400);
  for (const url of ['/../outside.txt', '/%2e%2e/outside.txt', '/.env', '/leak.txt', '/assets/../../outside.txt']) {
    const r = await request(url); assert.equal(r.status, 403, url); assert.ok(!r.body.includes('private'));
  }
  const post = await request('/', { method: 'POST' });
  assert.equal(post.status, 405); assert.equal(post.headers.allow, 'GET, HEAD');
});
