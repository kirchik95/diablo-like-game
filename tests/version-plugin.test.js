import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { versionPlugin } from '../build/version-plugin.js';

function setup(base = '/') {
  const plugin = versionPlugin();
  plugin.configResolved({ root: '/game', base });
  const watcher = new EventEmitter();
  let middleware;
  plugin.configureServer({ watcher, middlewares: { use(fn) { middleware = fn; } } });
  const request = url => {
    const headers = {};
    const res = { setHeader(key, value) { headers[key] = value; }, end(body) { this.body = body; } };
    let next = false;
    middleware({ url, headers: { accept: 'text/html' } }, res, () => { next = true; });
    return { ...res, headers, next };
  };
  return { plugin, watcher, request };
}

test('build emits the same nonempty id embedded in the loaded HTML', () => {
  const plugin = versionPlugin();
  plugin.configResolved({ root: '/game', base: '/' });
  const tags = plugin.transformIndexHtml();
  const meta = tags.find(tag => tag.attrs?.name === 'ritual-version');
  const emitted = [];
  plugin.generateBundle.call({ emitFile: file => emitted.push(file) });
  assert.equal(emitted[0].fileName, 'version.json');
  assert.ok(meta.attrs.content.length > 8);
  assert.equal(JSON.parse(emitted[0].source).buildId, meta.attrs.content);
  assert.notEqual(versionPlugin().transformIndexHtml()[0].attrs.content, meta.attrs.content);
});

test('dev id changes for source, public and entry edits, including across base paths', () => {
  const { plugin, watcher, request } = setup('/game/');
  let oldId = JSON.parse(request('/game/version.json?fresh=1').body).buildId;
  assert.equal(plugin.transformIndexHtml()[0].attrs.content, oldId);
  for (const file of ['/game/src/main.js', '/game/index.html', '/game/public/icons/a.png', '/game/assets/a.png']) {
    watcher.emit('all', 'change', file);
    const result = request('/game/version.json');
    const id = JSON.parse(result.body).buildId;
    assert.notEqual(id, oldId);
    assert.equal(result.headers['Cache-Control'], 'no-store');
    oldId = id;
  }
  assert.equal(request('/elsewhere/version.json').next, true);
});

test('dev and preview documents revalidate without changing asset responses', () => {
  const { request } = setup();
  assert.equal(request('/?seed=42').headers['Cache-Control'], 'no-cache');
  assert.equal(request('/index.html?x=1').headers['Cache-Control'], 'no-cache');
  assert.equal(request('/src/main.js').headers['Cache-Control'], undefined);
  const plugin = versionPlugin();
  plugin.configResolved({ root: '/game', base: '/' });
  let middleware;
  plugin.configurePreviewServer({ middlewares: { use(fn) { middleware = fn; } } });
  const headers = {};
  middleware({ url: '/version.json' }, { setHeader: (k, v) => { headers[k] = v; } }, () => {});
  assert.equal(headers['Cache-Control'], 'no-store');
});

test('dev ignores test output and unrelated files', () => {
  const { watcher, request } = setup();
  const first = request('/version.json').body;
  watcher.emit('all', 'change', '/game/dist/assets/main.js');
  watcher.emit('all', 'change', '/game/tests/version-check.test.js');
  assert.equal(request('/version.json').body, first);
});
