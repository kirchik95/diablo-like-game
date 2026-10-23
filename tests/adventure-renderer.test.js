import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NullEngine, Scene, ArcRotateCamera, Camera, Vector3, Matrix, Texture } from '@babylonjs/core';
import * as Babylon from '@babylonjs/core';
import * as rendering from '../src/render.js';
import * as pixels from '../src/pixel-scene.js';
import * as animation from '../src/pixel-animation.js';
import * as picking from '../src/pixel-picking.js';
import * as world from '../src/world.js';
import { createGame } from '../src/game.js';
import { LOCATIONS, WRAITH_TIMINGS, WRAITH_STATS, BEETLE_TIMINGS, BEETLE_STATS } from '../src/campaign.js';
import wraithPackage from '../assets/game/pixel-v3/wraith/manifest.json' with { type: 'json' };
import { appearanceVariant } from '../src/appearance.js';
import { MONK_RULES } from '../src/monk-combat.js';
import { getOverworldZone } from '../src/overworld.js';
import { readPng } from './helpers/png.js';
const { Renderer } = rendering;

function harness(t, location = LOCATIONS.road) {
  const engine = new NullEngine({ renderWidth: 720, renderHeight: 450 });
  engine.createCanvas = (width, height) => ({ width, height, getContext: () => ({
    clearRect() {}, beginPath() {}, arc() {}, stroke() {}, moveTo() {}, lineTo() {}, closePath() {}, fillRect() {},
  }) });
  const scene = new Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  const camera = new ArcRotateCamera('adventure-camera', Math.PI / 4, Math.PI / 3, 30, Vector3.Zero(), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  Object.assign(camera, { orthoLeft: -720 / 64, orthoRight: 720 / 64, orthoTop: 450 / 64, orthoBottom: -450 / 64 });
  const assets = Object.fromEntries(Object.entries({ ...pixels.pixelAtlases, wraith: wraithPackage.wraith })
    .map(([name, atlas]) => [name, { ...atlas, texture: new Texture(null, scene) }]));
  const game = createGame();
  Object.assign(game, { world: location, locationId: location.id, locationRevision: 0,
    adventure: { quest: 'outbound', secretFound: false, rewardCollected: false, visited: [location.id] }, projectiles: [] });
  Object.assign(game.player, location.spawn);
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    engine, scene, camera, assets, game, width: 720, height: 450,
    followTarget: camera.target.clone(), shake: 0, reducedMotion: false,
    presentation: new animation.PresentationState(game), fxSprites: new Map(),
    world: pixels.buildPixelWorld(scene, assets, location),
    monk: pixels.createSprite(scene, 'monk', assets.monk), monkShadow: pixels.createShadow(scene, 'monk-shadow'),
    hounds: game.enemies.map(e => ({ id: e.id, kind: e.kind || 'hound',
      sprite: pixels.createSprite(scene, `hound-${e.id}`, assets.hound),
      shadow: pixels.createShadow(scene, `shadow-${e.id}`), warning: pixels.createSprite(scene, `warning-${e.id}`, assets.effects) })),
    drawOverlay() {}, drawMap() {},
  });
  return { renderer, game, assets, scene };
}

function appearanceRequests(t, r) {
  const requests = [];
  r.monk.mesh.setEnabled(false);
  r.appearanceController = new pixels.SpriteAppearance(r.monk, url => new Promise((resolve, reject) => {
    requests.push({ url, resolve, reject });
  }));
  t.after(() => r.appearanceController.dispose());
  return requests;
}

function textureTransport(t, r) {
  const transport = r.engine.createTexture.bind(r.engine), requests = [];
  t.mock.method(r.engine, 'createTexture', (...args) => {
    const texture = transport(...args.slice(0, 5));
    texture.isReady = false;
    requests.push({ url: args[0],
      resolve() { texture.isReady = true; texture.onLoadedObservable.notifyObservers(texture); args[5]?.(); },
      // NullEngine has no failing network path. Match Babylon's real transport,
      // which marks the internal texture failed before notifying its consumer.
      reject(message) { texture._setError(message); args[6]?.(message); },
    });
    return texture;
  });
  r.appearanceController = new pixels.SpriteAppearance(r.monk, url => pixels.loadAppearanceTexture(r.scene, url));
  t.after(() => r.appearanceController.dispose());
  return requests;
}

// Execute the real constructor with only the browser engine and image transport
// replaced. No loading/status logic is copied into this fixture.
function loadingRenderer(t, maskError) {
  const requests = [];
  const context = { clearRect() {}, beginPath() {}, arc() {}, stroke() {}, moveTo() {}, lineTo() {}, closePath() {}, fillRect() {} };
  class HeadlessEngine extends NullEngine {
    createCanvas(width, height) { return { width, height, getContext: () => context }; }
  }
  const dependencies = { ...Babylon, ...pixels, ...animation, ...picking, ...world,
    WRAITH_TIMINGS, WRAITH_STATS, BEETLE_TIMINGS, BEETLE_STATS, appearanceVariant, MONK_RULES, getOverworldZone, Engine: HeadlessEngine,
    matchMedia: () => ({ matches: false }),
    loadAppearanceTexture(scene, url) {
      const token = {};
      scene.addPendingData(token);
      return new Promise((resolve, reject) => requests.push({ url,
        resolve(texture) { scene.removePendingData(token); resolve(texture); },
        reject(error) { scene.removePendingData(token); reject(error); },
      }));
    },
  };
  const source = readFileSync(new URL('../src/render.js', import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?;\n/gm, '').replace(/^export /gm, '');
  const LoadedRenderer = new Function(...Object.keys(dependencies), `${source}\nreturn Renderer;`)(...Object.values(dependencies));
  LoadedRenderer.prototype.resize = function() {};
  t.mock.method(globalThis, 'fetch', async url => {
    if (maskError) throw maskError;
    return new Response(readFileSync(new URL(url)));
  });
  const canvas = { getContext: () => context }, game = createGame();
  const renderer = new LoadedRenderer(canvas, canvas, canvas, game);
  t.after(() => { renderer.scene.dispose(); renderer.engine.dispose(); });
  return { renderer, game, requests };
}

test('initial appearance failure leaves common assets ready and the hidden hero recoverable', async t => {
  const { renderer: r, game, requests } = loadingRenderer(t);
  assert.equal(r.monk.mesh.isEnabled(), false);
  const ready = assert.doesNotReject(r.ready, 'initial appearance failure must not stop the renderer');
  const error = new Error('initial appearance transport failed');
  requests[0].reject(error);
  await ready;
  assert.deepEqual(r.getAppearanceStatus(game), { status: 'error', error });
  assert.equal(r.monk.mesh.isEnabled(), false);
  const retry = r.retryAppearance(game);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, requests[0].url);
  assert.deepEqual(r.getAppearanceStatus(game), { status: 'loading' });
  assert.equal(r.monk.mesh.isEnabled(), false);
  const texture = new Texture(null, r.scene);
  requests[1].resolve(texture); await retry;
  assert.equal(r.monk.texture, texture);
  assert.equal(r.monk.mesh.isEnabled(), true);
  assert.deepEqual(r.getAppearanceStatus(game), { status: 'ready' });
});

test('common asset readiness does not wait for a pending appearance in the scene', async t => {
  const { renderer: r, game, requests } = loadingRenderer(t);
  let timer;
  t.after(() => clearTimeout(timer));
  const result = await Promise.race([
    r.ready.then(() => 'ready'),
    new Promise(resolve => { timer = setTimeout(() => resolve('still waiting for appearance'), 1000); }),
  ]);
  assert.equal(result, 'ready');
  assert.equal(r.scene.isLoading, true, 'appearance transport is still pending');
  assert.equal(r.monk.mesh.isEnabled(), false);
  assert.deepEqual(r.getAppearanceStatus(game), { status: 'loading' });
  requests[0].resolve(new Texture(null, r.scene));
  await r.updateAppearance(game);
  assert.deepEqual(r.getAppearanceStatus(game), { status: 'ready' });
});

test('common asset failure still rejects renderer readiness after an appearance applies', async t => {
  const error = new Error('shared hit mask transport failed');
  const { renderer: r, game, requests } = loadingRenderer(t, error);
  const rejected = assert.rejects(r.ready, error);
  requests[0].resolve(new Texture(null, r.scene));
  await Promise.all([rejected, r.updateAppearance(game)]);
  assert.deepEqual(r.getAppearanceStatus(game), { status: 'ready' });
});

test('current appearance failure is reported, deduplicated across frames/restart, and explicitly retried', async t => {
  const { renderer: r, game, scene } = harness(t, LOCATIONS.camp);
  const requests = appearanceRequests(t, r);
  const initial = r.updateAppearance(game), previous = new Texture(null, scene);
  requests[0].resolve(previous); await initial;
  game.appearance = { skin: 'deep', hair: 'short', sash: 'teal' };
  assert.deepEqual(r.getAppearanceStatus(game), { status: 'loading' }, 'unrequested choice is not ready');
  const current = r.updateAppearance(game), error = new Error('selected appearance transport failed');
  assert.deepEqual(r.getAppearanceStatus(game), { status: 'loading' });
  assert.equal(r.monk.texture, previous);
  requests[1].reject(error);
  await assert.rejects(current, error);
  assert.deepEqual(r.getAppearanceStatus(game), { status: 'error', error });
  for (let i = 0; i < 12; i++) r.render(game, 0, 'paused');
  const fresh = { ...game, appearance: { ...game.appearance }, player: { ...game.player } };
  r.render(fresh, 0);
  await assert.rejects(r.updateAppearance(fresh), error);
  assert.equal(requests.length, 2, 'frames and restart must not silently retry a failed URL');
  const retry = r.retryAppearance(fresh);
  assert.equal(requests.length, 3);
  assert.equal(requests[2].url, appearanceVariant(fresh.appearance).url);
  assert.deepEqual(r.getAppearanceStatus(fresh), { status: 'loading' });
  assert.equal(r.monk.texture, previous, 'retain the complete previous texture until replacement');
  pixels.setSpriteFrame(r.monk, { frame: 78, flip: true });
  const atlas = r.monk.atlas, accepted = new Texture(null, scene);
  requests[2].resolve(accepted); await retry;
  assert.deepEqual(r.getAppearanceStatus(fresh), { status: 'ready' });
  assert.equal(r.monk.texture, accepted);
  assert.equal(r.monk.material.diffuseTexture, accepted);
  assert.equal(r.monk.atlas, atlas);
  assert.equal(r.monk.frame, 78); assert.equal(r.monk.flip, true);
  assert.equal(accepted.uScale, -.1);
  assert.ok(!scene.textures.includes(previous), 'replaced texture must be disposed');
});

test('retry follows the current selection even before a render frame and ignores a stale failure', async t => {
  const { renderer: r, game, scene } = harness(t);
  const requests = appearanceRequests(t, r);
  const old = r.updateAppearance(game);
  game.appearance = { skin: 'pale', hair: 'short', sash: 'ochre' };
  assert.deepEqual(r.getAppearanceStatus(game), { status: 'loading' });
  const current = r.retryAppearance(game);
  assert.equal(requests[1].url, appearanceVariant(game.appearance).url);
  requests[0].reject(new Error('stale choice failed')); await old;
  assert.deepEqual(r.getAppearanceStatus(game), { status: 'loading' });
  assert.equal(r.monk.mesh.isEnabled(), false);
  requests[1].resolve(new Texture(null, scene)); await current;
  assert.deepEqual(r.getAppearanceStatus(game), { status: 'ready' });
});

test('same-URL retry wins races against stale success and failure', async t => {
  for (const status of ['loading', 'ready', 'error']) for (const outcome of ['success', 'error']) await t.test(`${status}, stale ${outcome}`, async t => {
    const { renderer: r, game, scene } = harness(t);
    const requests = appearanceRequests(t, r);
    const old = r.updateAppearance(game), retried = r.retryAppearance(game);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, requests[1].url);
    const previous = r.monk.texture, accepted = new Texture(null, scene), error = new Error('current retry failed');
    if (status === 'ready') { requests[1].resolve(accepted); await retried; }
    if (status === 'error') { requests[1].reject(error); await assert.rejects(retried, error); }
    if (outcome === 'success') {
      const discarded = new Texture(null, scene);
      requests[0].resolve(discarded); await old;
      assert.ok(!scene.textures.includes(discarded));
    } else {
      requests[0].reject(new Error('superseded attempt failed')); await old;
    }
    assert.deepEqual(r.getAppearanceStatus(game), status === 'error' ? { status, error } : { status });
    assert.equal(r.monk.texture, status === 'ready' ? accepted : previous);
    assert.equal(r.monk.mesh.isEnabled(), status === 'ready');
    if (status === 'loading') {
      requests[1].resolve(accepted); await retried;
      assert.deepEqual(r.getAppearanceStatus(game), { status: 'ready' });
    }
  });
});

test('returning to the applied appearance cancels stale work, but explicit retry still loads it anew', async t => {
  const { renderer: r, game, scene } = harness(t);
  const requests = appearanceRequests(t, r), original = { ...game.appearance };
  const initial = r.updateAppearance(game), accepted = new Texture(null, scene);
  requests[0].resolve(accepted); await initial;
  game.appearance = { skin: 'deep', hair: 'short', sash: 'teal' };
  const old = r.updateAppearance(game);
  game.appearance = original;
  await r.updateAppearance(game);
  assert.equal(requests.length, 2);
  assert.deepEqual(r.getAppearanceStatus(game), { status: 'ready' });
  requests[1].reject(new Error('abandoned choice')); await old;
  assert.deepEqual(r.getAppearanceStatus(game), { status: 'ready' });
  const retry = r.retryAppearance(game);
  assert.equal(requests.length, 3, 'explicit retry must issue a new request even for an applied URL');
  const error = new Error('refresh failed'); requests[2].reject(error);
  await assert.rejects(retry, error);
  assert.deepEqual(r.getAppearanceStatus(game), { status: 'error', error });
  assert.equal(r.monk.texture, accepted);
});

test('real appearance texture loader disposes a failed texture and can reload the same URL', async t => {
  const { renderer: r, game, scene } = harness(t);
  const requests = textureTransport(t, r);
  const baseline = scene.textures.length, initial = r.updateAppearance(game);
  assert.equal(scene.textures.length, baseline + 1);
  requests[0].reject('network unavailable');
  await assert.rejects(initial, /network unavailable/);
  assert.equal(scene.textures.length, baseline);
  const retry = r.retryAppearance(game);
  assert.equal(requests.length, 2, 'failed Babylon texture cache must not swallow the new request');
  assert.equal(requests[1].url, requests[0].url);
  requests[1].resolve(); await retry;
  assert.deepEqual(r.getAppearanceStatus(game), { status: 'ready' });
  assert.equal(r.monk.texture.samplingMode, Texture.NEAREST_SAMPLINGMODE);
  assert.equal(r.monk.texture.noMipmap, true);
});

test('real appearance retry does not join an older in-flight Babylon request for the same URL', async t => {
  const { renderer: r, game } = harness(t);
  const requests = textureTransport(t, r);
  const old = r.updateAppearance(game), retry = r.retryAppearance(game);
  assert.equal(requests.length, 2, 'an explicit retry must own a new request');
  assert.equal(requests[0].url, requests[1].url);
  requests[0].reject('old attempt failed'); await old;
  assert.deepEqual(r.getAppearanceStatus(game), { status: 'loading' });
  requests[1].resolve(); await retry;
  assert.deepEqual(r.getAppearanceStatus(game), { status: 'ready' });
});

test('adventure scenery consumes actual location tiles and releases every local resource', t => {
  const { renderer: r, assets, scene } = harness(t, LOCATIONS.camp);
  assert.ok(r.world.shrine === null, 'camp must not inherit the legacy shrine');
  assert.equal(r.world.columns.length, 2);
  assert.equal(r.world.fires[0].color, 'amber');
  assert.equal(typeof r.world.dispose, 'function');
  r.world.dispose();
  const baseline = [scene.meshes.length, scene.materials.length, scene.textures.length];
  for (const world of [LOCATIONS.road, LOCATIONS.courtyard, LOCATIONS.camp, LOCATIONS.road]) {
    const built = pixels.buildPixelWorld(scene, assets, world);
    const bounds = built.floor.getBoundingInfo().boundingBox;
    const xs = world.tiles.map(p => p.x), ys = world.tiles.map(p => p.y);
    assert.equal(bounds.minimumWorld.x, Math.min(...xs) - .5);
    assert.equal(bounds.maximumWorld.z, Math.max(...ys) + .5);
    assert.equal(built.portals.length, world.portals.length);
    built.dispose();
    assert.deepEqual([scene.meshes.length, scene.materials.length, scene.textures.length], baseline,
      `${world.id} leaked location resources`);
  }
  assert.ok(scene.textures.includes(assets.floor.texture), 'shared floor texture must survive transitions');
});

test('revision change replaces equal-length enemies, clears actions and snaps the camera to entry', t => {
  const { renderer: r, game } = harness(t);
  r.render(game, .1);
  game.events.push({ type: 'impact', x: 0, y: 17 });
  r.render(game, 0);
  const oldBody = r.hounds[0].sprite.mesh, oldWorld = r.world, oldFx = [...r.fxSprites.values()][0].mesh;
  game.locationRevision++;
  game.world = LOCATIONS.courtyard; game.locationId = 'courtyard';
  game.enemies = [{ ...game.enemies[0], id: 'court-spirit', kind: 'wraith', hp: 64, x: -3, y: -5 }];
  game.events = []; Object.assign(game.player, LOCATIONS.courtyard.spawn);
  r.render(game, 0);
  assert.equal(oldBody.isDisposed(), true);
  assert.equal(oldFx.isDisposed(), true);
  assert.notEqual(r.world, oldWorld);
  assert.equal(r.hounds[0].sprite.atlas, r.assets.wraith);
  assert.equal(r.fxSprites.size, 0);
  assert.equal(r.presentation.hounds[0].deathAge, null);
  assert.ok(Math.abs(r.camera.target.x - game.player.x) < .04);
  assert.ok(Math.abs(r.camera.target.z - (game.player.y - .7)) < .04,
    'long road entry must be centered rather than half-following from the old location');
  assert.equal(r.shake, 0);
});

test('presentation resets death/effects on a same-length location change and preserves pause', () => {
  const game = createGame(); game.locationRevision = 0;
  const view = new animation.PresentationState(game);
  game.enemies[0].hp = 0; game.events.push({ type: 'impact', x: 0, y: 0 });
  view.update(game, .2); view.update(game, .2);
  game.locationRevision++;
  game.enemies = [{ ...game.enemies[0], id: 'new-spirit', kind: 'wraith', hp: 64 }]; game.events = [];
  view.update(game, 0);
  assert.equal(view.hounds[0].deathAge, null);
  assert.equal(view.effects.length, 0);
  const before = JSON.stringify(view);
  view.update(game, 10, 'paused');
  assert.equal(JSON.stringify(view), before);
});

test('wraith uses authored front/back, locked anticipation and recovery keys, then holds death', () => {
  assert.equal(typeof animation.wraithPose, 'function');
  const body = { hp: 64, dx: 0, dy: 1, state: 'idle', distance: 0 };
  assert.deepEqual(animation.wraithPose(body), { frame: 0, flip: false });
  assert.deepEqual(animation.wraithPose({ ...body, dx: -1, dy: 0 }), { frame: 26, flip: false });
  assert.deepEqual(animation.wraithPose({ ...body, dx: 0, dy: -1 }), { frame: 26, flip: true });
  assert.deepEqual([.8, .55, .28, .01].map(timer => animation.wraithPose({ ...body, state: 'windup', timer }).frame),
    [10, 11, 12, 13]);
  assert.deepEqual([.6, .1].map(timer => animation.wraithPose({ ...body, state: 'recover', timer }).frame), [14, 15]);
  assert.equal(animation.wraithPose({ ...body, hp: 0 }, undefined, { deathAge: 10 }).frame, 25);
});

test('selected appearance cannot be replaced by a late texture response or change masks/frame', async t => {
  const { renderer: r, scene } = harness(t);
  assert.equal(typeof pixels.SpriteAppearance, 'function');
  const pending = new Map();
  const selection = new pixels.SpriteAppearance(r.monk, url => new Promise(resolve => pending.set(url, resolve)));
  t.after(() => selection.dispose());
  pixels.setSpriteFrame(r.monk, { frame: 78, flip: true });
  const mask = r.monk.atlas;
  const old = selection.select('deep-short-teal');
  const newer = selection.select('pale-short-ochre');
  const accepted = new Texture(null, scene), stale = new Texture(null, scene);
  pending.get('pale-short-ochre')(accepted); await newer;
  pending.get('deep-short-teal')(stale); await old;
  assert.equal(r.monk.texture, accepted);
  assert.equal(r.monk.material.diffuseTexture, accepted);
  assert.equal(r.monk.atlas, mask);
  assert.equal(r.monk.frame, 78); assert.equal(r.monk.flip, true);
  assert.equal(accepted.uScale, -.1); assert.ok(Math.abs(accepted.vOffset - (1 - 8 / r.monk.atlas.rows)) < 1e-8);
  assert.ok(!scene.textures.includes(stale));
});

test('wraith windup and live shot render at distinct floor/flight heights and freeze on pause', t => {
  const { renderer: r, game } = harness(t);
  Object.assign(game.enemies[0], { id: 'spirit', kind: 'wraith', state: 'windup', timer: .4, x: 1, y: 2, dx: 0, dy: -1 });
  game.projectiles = [{ id: 'shot-1', x: 1, y: 1, dx: 0, dy: -1, radius: .13, life: 2 }];
  r.render(game, .2);
  const warning = r.hounds[0].warning, shot = r.projectiles.get('shot-1');
  assert.equal(warning.frame, 9);
  assert.equal(warning.mesh.position.y, .035);
  assert.equal(shot.mesh.position.y, .65);
  assert.equal(shot.shadow.position.y, .026);
  const frozen = { target: r.camera.target.asArray(), shot: shot.mesh.position.asArray(), rotation: shot.mesh.rotation.asArray(), frame: r.hounds[0].sprite.frame };
  r.render(game, 5, 'paused');
  assert.deepEqual({ target: r.camera.target.asArray(), shot: shot.mesh.position.asArray(), rotation: shot.mesh.rotation.asArray(), frame: r.hounds[0].sprite.frame }, frozen);
  game.projectiles = []; r.render(game, 0);
  assert.equal(shot.mesh.isDisposed(), true); assert.equal(shot.shadow.isDisposed(), true);
  assert.equal(r.projectiles.size, 0);
});

test('ritual lock, vulnerability and destruction remain distinct on returning to the court', t => {
  const { renderer: r, game } = harness(t, LOCATIONS.courtyard);
  game.enemies = [{ ...game.enemies[0], id: 'ritual', kind: 'ritual', hp: 132, maxHp: 132,
    x: 0, y: -6, sealed: true, state: 'sealed' }];
  r.render(game, 0);
  const ritual = r.world.ritual, source = r.hounds[0].sprite;
  // The restyled pixel-v11 source carries its own colours: no tint, no fade.
  assert.equal(source.atlas, r.assets.monasteryWorld);
  const untinted = () => assert.deepEqual(source.material.emissiveColor.asArray(), [1, 1, 1]);
  assert.ok(ritual.shards.every(mesh => mesh.isVisible));
  assert.equal(r.hounds[0].sprite.frame, 12); untinted();
  game.enemies[0].sealed = false; game.enemies[0].state = 'idle'; r.render(game, .1);
  assert.ok(ritual.shards.every(mesh => !mesh.isVisible));
  assert.ok(r.hounds[0].sprite.frame >= 14); untinted();
  game.enemies[0].hp = 0; game.enemies[0].state = 'dead'; r.render(game, .1);
  assert.ok(ritual.rings.every(mesh => !mesh.isVisible));
  assert.equal(r.hounds[0].sprite.frame, 17); untinted();
  assert.equal(source.mesh.visibility, 1, 'the dark broken key reads as dead without fading out');
  game.locationRevision++; r.render(game, 0);
  assert.ok(r.world.ritual.rings.every(mesh => !mesh.isVisible));
});

test('the outdoor courtyard uses a permanently open ruin arch without adding a transition', t => {
  const { renderer: r, game, assets } = harness(t, LOCATIONS.courtyard);
  const portals = JSON.stringify(game.world.portals);
  // The courtyard layout's freestanding ruin arch, never the legacy dungeon door.
  assert.ok(r.world.gate.atlas === assets.monasteryRuins && r.world.gate.placement.id === 'arch',
    'a dungeon door must not replace the outdoor arch');
  const arch = assets.monasteryRuins.frames.indexOf('arch-gate');
  assert.equal(r.world.gate.frame, arch);
  r.render(game, .2);
  game.adventure.quest = 'return';
  r.render(game, .2);
  assert.equal(r.world.gate.frame, arch, 'quest animation must not turn the outdoor arch back into a door');
  assert.equal(JSON.stringify(game.world.portals), portals);
});

test('map fits the entire forked road and distinguishes portals, cache, shrine and reward', () => {
  assert.equal(typeof rendering.adventureMapLayout, 'function');
  for (const world of Object.values(LOCATIONS)) {
    const game = { world, enemies: [], shrineUsed: false, adventure: { secretFound: false, rewardCollected: false } };
    const layout = rendering.adventureMapLayout(game, 360, 280);
    for (const tile of world.tiles) {
      for (const dx of [-.5, .5]) for (const dy of [-.5, .5]) {
        const p = layout.project(tile.x + dx, tile.y + dy);
        assert.ok(p.x >= 11.9 && p.x <= 348.1 && p.y >= 33.9 && p.y <= 250.1, `map clips ${world.id}`);
      }
    }
    assert.equal(layout.markers.filter(m => m.kind === 'portal').length, world.portals.length);
    if (world.secret) assert.ok(layout.markers.some(m => m.kind === 'secret'));
    if (world.shrine) assert.ok(layout.markers.some(m => m.kind === 'shrine'));
    if (world.reward) assert.ok(layout.markers.some(m => m.kind === 'reward'));
  }
});

test('real overlay and minimap draw safely in all three locations including an empty camp', t => {
  const { renderer: r, game } = harness(t, LOCATIONS.camp);
  const operations = [];
  const context = new Proxy({}, { get(target, key) {
    if (key in target) return target[key];
    if (key === 'createRadialGradient') return () => ({ addColorStop() {} });
    return (...args) => {
      assert.ok(args.every(value => typeof value !== 'number' || Number.isFinite(value)), `${String(key)} received non-finite coordinates`);
      operations.push([key, ...args]);
    };
  } });
  r.ctx = context; r.map = context;
  for (const world of Object.values(LOCATIONS)) {
    game.world = world; game.locationId = world.id; game.locationRevision++;
    game.enemies = []; Object.assign(game.player, world.spawn);
    r.render(game, 0);
    assert.doesNotThrow(() => Renderer.prototype.drawOverlay.call(r, game, 0, 'playing'));
    assert.doesNotThrow(() => Renderer.prototype.drawMap.call(r, game));
  }
  assert.ok(operations.some(([name]) => name === 'fillText'));
});

test('ranged warning stops at the first solid obstacle, along the locked shot direction', () => {
  assert.equal(typeof rendering.warningLength, 'function');
  const world = { tiles: Array.from({ length: 10 }, (_, x) => ({ x, y: 0 })), obstacles: [{ x: 4, y: 0, radius: .4 }] };
  const body = { kind: 'wraith', x: 0, y: 0, dx: 1, dy: 0 };
  const distance = rendering.warningLength(body, world);
  assert.ok(distance > 3.2 && distance < 3.5, `warning passed through the obstacle: ${distance}`);
});

test('wraith target picking follows per-frame alpha through front, back, mirror and death', t => {
  const { renderer: r, game, assets } = harness(t);
  const enemy = game.enemies[0]; Object.assign(enemy, { kind: 'wraith', x: 0, y: 12, state: 'idle' });
  const atlas = assets.wraith, width = atlas.columns * atlas.cell;
  atlas.mask = { width, bytes: new Uint8Array(width * atlas.rows * atlas.cell / 8) };
  // A deliberately sparse frame silhouette makes padding vs body unambiguous.
  for (let frame = 0; frame < 52; frame++) {
    const pixel = (Math.floor(frame / atlas.columns) * 96 + 47) * width + (frame % atlas.columns) * 96 + 42;
    atlas.mask.bytes[pixel >> 3] |= 1 << (pixel & 7);
  }
  r.canvas = { getBoundingClientRect: () => ({ left: 137.25, top: 61.5, width: 1441, height: 901 }) };
  function probe(x, y) {
    const sprite = r.hounds[0].sprite;
    const world = Vector3.TransformCoordinates(new Vector3((x + .5 - 48) / 32, (84 - y - .5) / 32, 0), sprite.mesh.computeWorldMatrix(true));
    const screen = Vector3.Project(world, Matrix.Identity(), r.scene.getTransformMatrix(), r.camera.viewport.toGlobal(720, 450));
    return r.screenToWorld(137.25 + screen.x * 1441 / 720, 61.5 + screen.y * 901 / 450);
  }
  for (const [dx, dy, flip] of [[0, 1, false], [1, 0, true], [-1, 0, false], [0, -1, true]]) {
    Object.assign(enemy, { dx, dy }); r.render(game, 0);
    const hit = probe(flip ? 53 : 42, 47), padding = probe(0, 0);
    assert.ok(Math.hypot(hit.x - enemy.x, hit.y - enemy.y) < 1e-4);
    assert.ok(Math.hypot(padding.x - enemy.x, padding.y - enemy.y) > .1);
  }
  enemy.hp = 0; enemy.state = 'dead'; r.render(game, 1);
  const corpse = probe(53, 47);
  assert.ok(Math.hypot(corpse.x - enemy.x, corpse.y - enemy.y) > .1, 'dead spirits must not capture pointer aim');
});

test('repeated location round trips release enemies, projectiles and effects as well as scenery', t => {
  const { renderer: r, game, scene } = harness(t, LOCATIONS.camp);
  const enemy = { ...game.enemies[0] };
  game.enemies = []; r.render(game, 0);
  const counts = () => [scene.meshes.length, scene.materials.length, scene.multiMaterials.length, scene.textures.length];
  const baseline = counts();
  for (let i = 0; i < 3; i++) {
    game.world = LOCATIONS.road; game.locationId = 'road'; game.locationRevision++;
    game.enemies = [{ ...enemy, id: `spirit-${i}`, kind: 'wraith' }];
    game.projectiles = [{ id: i, x: 0, y: 10, dx: 0, dy: 1, life: 1, radius: .13 }];
    game.events = [{ type: 'impact', x: 0, y: 10 }]; r.render(game, .1);
    game.world = LOCATIONS.camp; game.locationId = 'camp'; game.locationRevision++;
    game.enemies = []; game.events = []; game.projectiles = []; r.render(game, 0);
    assert.deepEqual(counts(), baseline, `round trip ${i} leaks a GPU resource`);
  }
});

test('a failed stale appearance load cannot surface an error after a newer look is applied', async t => {
  const { renderer: r, scene } = harness(t);
  const pending = new Map();
  const selection = new pixels.SpriteAppearance(r.monk, url => new Promise((resolve, reject) => pending.set(url, { resolve, reject })));
  const old = selection.select('old');
  const current = selection.select('current');
  const texture = new Texture(null, scene); pending.get('current').resolve(texture); await current;
  pending.get('old').reject(new Error('old request failed'));
  assert.equal(await old, false);
  assert.ok(r.monk.texture === texture);
  const late = selection.select('late'); selection.dispose();
  const discarded = new Texture(null, scene); pending.get('late').resolve(discarded);
  assert.equal(await late, false); assert.ok(!scene.textures.includes(discarded));
});

test('backtracking shows retained corpses and spent shrine endpoints without replaying their actions', () => {
  const game = createGame(); Object.assign(game, { world: LOCATIONS.road, locationRevision: 0 });
  const view = new animation.PresentationState(game);
  game.enemies[0].hp = 0; game.shrineUsed = true;
  view.update(game, 0); view.update(game, 2);
  const corpse = animation.houndPose(game.enemies[0], undefined, view.hounds[0]);
  game.locationRevision += 2; view.update(game, 0);
  assert.deepEqual(animation.houndPose(game.enemies[0], undefined, view.hounds[0]), corpse);
  assert.equal(animation.worldPose('shrine', pixels.pixelAtlases.world, view).frame, 17);
});

test('ritual pedestal contact center sits on its target and ground seal', t => {
  const { renderer: r, game } = harness(t, LOCATIONS.courtyard);
  game.enemies = [{ ...game.enemies[0], kind: 'ritual', id: 'ritual', x: 0, y: -6, sealed: true }];
  r.render(game, 0);
  const sprite = r.hounds[0].sprite;
  // Measured v2 shrine base diamond: center (80,124), foot anchor (80,144).
  const contact = Vector3.TransformCoordinates(new Vector3(0, 20 / 32, 0), sprite.mesh.computeWorldMatrix(true));
  const project = point => Vector3.Project(point, Matrix.Identity(), r.scene.getTransformMatrix(), r.camera.viewport.toGlobal(720, 450));
  // On a raised dais (footprint `standOn`) the pedestal stands on its top.
  const actual = project(contact), expected = project(new Vector3(0, r.world.ritual.standOn ?? 0, -6));
  assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) < .51, 'ritual seal and its pedestal have different ground centers');
});

test('published spirit package loads masks matching real front/back frames and uses nearest textures', { timeout: 10000 }, async t => {
  const { renderer: r, game } = harness(t);
  // Only browser fetch is replaced; atlas registration, mask decode and texture
  // setup run through the same loader as the application on the NullEngine.
  t.mock.method(globalThis, 'fetch', async url => new Response(readFileSync(new URL(url))));
  const assets = pixels.loadPixelAssets(r.scene);
  await assets.ready;
  const atlas = assets.wraith, png = readPng(new URL(pixels.pixelAssetUrls.wraith));
  assert.equal(atlas.texture.samplingMode, Texture.NEAREST_SAMPLINGMODE);
  assert.equal(atlas.texture.noMipmap, true);
  assert.equal(atlas.mask.width, png.width);
  const enemy = game.enemies[0]; Object.assign(enemy, { kind: 'wraith', x: 0, y: 12, hp: 64 });
  r.assets = assets;
  for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
    Object.assign(enemy, { dx, dy }); r.render(game, 0);
    const sprite = r.hounds[0].sprite, frame = sprite.frame;
    const x0 = frame % atlas.columns * 96, y0 = Math.floor(frame / atlas.columns) * 96;
    let opaque = null, score = Infinity;
    for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) {
      if (png.alpha(x0 + x, y0 + y) !== 255) continue;
      const distance = (x - 48) ** 2 + (y - 48) ** 2;
      if (distance < score) { opaque = [x, y]; score = distance; }
    }
    assert.ok(opaque, 'the authored frame must contain the spirit');
    const x = sprite.flip ? 95 - opaque[0] : opaque[0];
    const point = Vector3.TransformCoordinates(new Vector3((x + .5 - 48) / 32, (84 - opaque[1] - .5) / 32, 0), sprite.mesh.computeWorldMatrix(true));
    const screen = Vector3.Project(point, Matrix.Identity(), r.scene.getTransformMatrix(), r.camera.viewport.toGlobal(720, 450));
    const picked = r.screenToWorld(screen.x, screen.y);
    assert.ok(Math.hypot(picked.x - enemy.x, picked.y - enemy.y) < 1e-4, 'real opaque spirit pixel must target its body');
  }
});

test('appearance applies the helper URL and retains the selected atlas through a fresh run', async t => {
  const { renderer: r, game, scene } = harness(t);
  const look = { skin: 'deep', hair: 'short', sash: 'teal' };
  const urls = [];
  r.appearanceController = new pixels.SpriteAppearance(r.monk, async url => {
    urls.push(url); return pixels.loadAppearanceTexture(scene, url);
  });
  game.appearance = look;
  await r.updateAppearance(game);
  assert.deepEqual(urls, [appearanceVariant(look).url]);
  assert.equal(r.monk.texture.samplingMode, Texture.NEAREST_SAMPLINGMODE);
  assert.equal(r.monk.texture.noMipmap, true);
  const selected = r.monk.texture;
  const fresh = { ...game, player: { ...game.player }, appearance: { ...look }, enemies: [], locationRevision: 0 };
  r.render(fresh, 0); await r.updateAppearance(fresh);
  assert.equal(urls.length, 1);
  assert.ok(r.monk.texture === selected);
  assert.deepEqual(fresh.appearance, look);
});
