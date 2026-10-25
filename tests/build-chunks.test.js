import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const distDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const assetsDir = join(distDir, 'assets');
const indexPath = join(distDir, 'index.html');
const maxChunkBytes = 500 * 1024;
const skip = existsSync(indexPath) ? false : 'dist/ is missing; run `npm run build` first';

test('every built JS chunk is at most 500 kB', { skip }, () => {
  const chunks = readdirSync(assetsDir).filter((name) => name.endsWith('.js'));
  assert.ok(chunks.length > 1, 'expected the build to emit several JS chunks');
  for (const name of chunks) {
    const size = statSync(join(assetsDir, name)).size;
    assert.ok(size <= maxChunkBytes, `${name} is ${size} bytes (limit ${maxChunkBytes})`);
  }
});

// Game code grows (gamepad, touch); the entry chunk keeps this much of the budget free.
const entryHeadroomBytes = 80 * 1024;

test('the entry chunk keeps at least 80 kB of the chunk budget free', { skip }, () => {
  const entry = readdirSync(assetsDir).find((name) => /^index-.*\.js$/.test(name));
  assert.ok(entry, 'expected an index-*.js entry chunk');
  const size = statSync(join(assetsDir, entry)).size;
  assert.ok(size <= maxChunkBytes - entryHeadroomBytes,
    `${entry} is ${size} bytes; split game code in vite.config.js to keep ${entryHeadroomBytes} bytes free`);
});

test('recorded sounds stay separate files and are never inlined into a chunk', { skip }, () => {
  const inlined = readdirSync(assetsDir).filter((name) => name.endsWith('.js'))
    .filter((name) => readFileSync(join(assetsDir, name), 'utf8').includes('data:audio/'));
  assert.deepEqual(inlined, []);
});

test('dist/index.html references only existing files', { skip }, () => {
  const html = readFileSync(indexPath, 'utf8');
  const urls = [...html.matchAll(/\b(?:src|href)="(\/[^"]*)"/g)].map((match) => match[1]);
  assert.ok(urls.some((url) => url.endsWith('.js')), 'expected at least one script reference');
  for (const url of urls) {
    const file = join(distDir, decodeURIComponent(url.split(/[?#]/)[0]));
    assert.ok(existsSync(file), `${url} does not exist in dist/`);
  }
});

test('every Babylon vendor chunk evaluates without a module-order error', { skip }, async () => {
  const { pathToFileURL } = await import('node:url');
  const chunks = readdirSync(assetsDir).filter((name) => /^babylon-.*\.js$/.test(name));
  assert.ok(chunks.length > 0, 'expected Babylon vendor chunks');
  for (const name of chunks) {
    // A cyclic chunk that runs before its dependency throws while it loads.
    await assert.doesNotReject(import(pathToFileURL(join(assetsDir, name)).href), name);
  }
});

test('the built entry runs every vendor chunk before it needs the DOM', { skip }, async () => {
  const { spawnSync } = await import('node:child_process');
  const entry = readdirSync(assetsDir).find((name) => /^index-.*\.js$/.test(name));
  assert.ok(entry, 'expected an index-*.js entry chunk');
  // A fresh process loads the entry in the real dependency order. In Node it can
  // only stop at the first DOM access; a TypeError inside Babylon means bad order.
  const script = `import(${JSON.stringify(join(assetsDir, entry))}).then(() => console.log('LOADED'), (e) => console.log(e.name + ': ' + e.message))`;
  const { stdout } = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.match(stdout.trim(), /^(LOADED|ReferenceError: document is not defined)$/, stdout);
});
