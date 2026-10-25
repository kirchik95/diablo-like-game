import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beetlePose, PresentationState } from '../src/pixel-animation.js';
import { pixelAtlases, pixelAssetUrls } from '../src/pixel-assets.js';
import { BEETLE_TIMINGS, BEETLE_STATS } from '../src/campaign.js';
import { createAdventure, createGame, updateGame } from '../src/game.js';

const atlas = pixelAtlases.beetle;
const body = { kind: 'beetle', hp: 160, state: 'idle', dx: 1, dy: 1, timer: 0, distance: 0, exposed: false };
const clip = (name, facing = 'front') => atlas.clips[name][facing];

test('beetle atlas, texture and hit mask are registered with the shared asset tables', () => {
  assert.equal(atlas.cell, 128);
  assert.match(pixelAssetUrls.beetle, /pixel-v7\/beetle\/beetle\.png$/);
  assert.match(readFileSync(new URL('../src/pixel-scene.js', import.meta.url), 'utf8'), /pixel-v7\/beetle\/hit-masks\.json/);
});

test('beetle pose follows facing and committed attack timers', () => {
  assert.deepEqual(beetlePose(body), { frame: clip('idle')[0], flip: false });
  assert.deepEqual(beetlePose({ ...body, dx: -1, dy: 0 }), { frame: clip('idle', 'back')[0], flip: false });
  assert.deepEqual(beetlePose({ ...body, dx: 0, dy: -1 }), { frame: clip('idle', 'back')[0], flip: true });
  const windup = [BEETLE_TIMINGS.windup, BEETLE_TIMINGS.windup * .5, .001]
    .map(timer => beetlePose({ ...body, state: 'windup', timer }).frame);
  assert.deepEqual(windup, [clip('windup')[0], clip('windup')[2], clip('windup')[4]]);
  assert.deepEqual([BEETLE_TIMINGS.slam, .06, .01].map(timer => beetlePose({ ...body, state: 'slam', timer }).frame), clip('slam'));
  assert.equal(beetlePose({ ...body, state: 'recover', timer: .01 }).frame, clip('recover')[2]);
  assert.equal(beetlePose({ ...body, state: 'chase', distance: .17 }).frame, clip('walk')[1]);
  assert.equal(beetlePose({ ...body, hp: 0 }, undefined, { deathAge: 10 }).frame, clip('death')[5]);
});

test('only a guard break shows the exposed underside; guarded hits block or flinch', () => {
  const exposed = beetlePose({ ...body, state: 'stunned', exposed: true, timer: BEETLE_TIMINGS.exposed });
  assert.equal(exposed.frame, clip('stunned')[0]);
  assert.ok(!clip('stunned').includes(beetlePose({ ...body, state: 'stunned', exposed: false, timer: .38 }).frame));
  assert.equal(beetlePose({ ...body, state: 'chase' }, undefined, { blockAge: .1 }).frame, clip('block')[1]);
  assert.equal(beetlePose({ ...body, state: 'chase' }, undefined, { flinchAge: 0 }).frame, clip('hurt')[0]);
  // A committed slam is never replaced by a reaction drawing.
  assert.equal(beetlePose({ ...body, state: 'windup', timer: BEETLE_TIMINGS.windup }, undefined, { blockAge: 0 }).frame, clip('windup')[0]);
});

test('presentation routes block and impact events to the struck beetle only', () => {
  const game = createAdventure({}, { seed: 12345 });
  const view = new PresentationState(game);
  const beetles = game.enemies.filter(e => e.kind === 'beetle' && (e.zoneId === 'road' || e.zoneId === 'courtyard'));
  assert.equal(beetles.length, 8);
  const [a, b] = beetles, ia = game.enemies.indexOf(a), ib = game.enemies.indexOf(b);
  game.events.push({ type: 'block', x: a.x, y: a.y, id: a.id, dx: 1, dy: 0 });
  game.events.push({ type: 'impact', x: b.x, y: b.y, id: b.id, dx: 1, dy: 0 });
  view.update(game, 1 / 60);
  assert.ok(view.hounds[ia].blockAge != null && view.hounds[ia].flinchAge == null);
  assert.ok(view.hounds[ib].flinchAge != null && view.hounds[ib].blockAge == null);
  assert.ok(view.effects.some(effect => effect.type === 'block'));
  view.update(game, .3);
  assert.equal(view.hounds[ia].blockAge, null);
  assert.equal(view.hounds[ib].flinchAge, null);
});

// One reusable open arena: a single beetle mid-slam at the origin.
function slamArena(dx, dy) {
  const game = createGame(), tiles = [];
  for (let x = -6; x <= 6; x++) for (let y = -6; y <= 6; y++) tiles.push({ x, y });
  game.world = { tiles, obstacles: [], shrine: null };
  game.projectiles = [];
  const beetle = { ...game.enemies[0], id: 'shell', kind: 'beetle', radius: BEETLE_STATS.radius, hp: 160, maxHp: 160,
    exposed: false, x: 0, y: 0, homeX: 0, homeY: 0, dx, dy, state: 'slam', timer: BEETLE_TIMINGS.slam, hit: false, path: [] };
  game.enemies = [beetle];
  return { game, beetle };
}

// The real simulation decides a hit: a monk standing at the point loses HP in one tick.
function slamHits(arena, x, y) {
  const { game, beetle } = arena;
  Object.assign(game.player, { x, y, hp: 100, invulnerable: 0, dashTime: 0 });
  Object.assign(beetle, { x: 0, y: 0, state: 'slam', timer: BEETLE_TIMINGS.slam, hit: false });
  game.phase = 'playing';
  updateGame(game, {}, .01);
  return game.player.hp < 100;
}

function inside(polygon, x, y) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}

function edgeDistance(polygon, x, y) {
  let best = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i], ex = b.x - a.x, ey = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / (ex * ex + ey * ey)));
    best = Math.min(best, Math.hypot(x - a.x - ex * t, y - a.y - ey * t));
  }
  return best;
}

test('beetle telegraph outlines exactly the sector its slam strikes, and the overlay draws that outline', async () => {
  // A failed import must fail here; it must never skip the geometry check.
  const { warningShape, Renderer } = await import('../src/render.js');
  for (const angle of [0, -Math.PI / 2, Math.PI / 4, .5]) {
    const arena = slamArena(Math.cos(angle), Math.sin(angle));
    const shape = warningShape(arena.beetle, arena.game.world);
    let hits = 0;
    for (let x = -1.5; x <= 1.5 + 1e-9; x += .05) for (let y = -1.5; y <= 1.5 + 1e-9; y += .05) {
      const hit = slamHits(arena, x, y), drawn = inside(shape, x, y), margin = edgeDistance(shape, x, y);
      if (hit) hits++;
      // Every damaging spot is drawn; the drawing promises no safe spot as dangerous.
      if (hit) assert.ok(drawn || margin < .01, `angle ${angle}: hit at ${x.toFixed(2)},${y.toFixed(2)} outside the telegraph`);
      if (drawn && margin > .03) assert.ok(hit, `angle ${angle}: telegraph covers safe ground at ${x.toFixed(2)},${y.toFixed(2)}`);
    }
    assert.ok(hits > 400, `angle ${angle}: too few hit samples (${hits})`);
  }

  // drawOverlay fills that outline, and the hound ring-and-chevron stays hidden.
  const { game, beetle } = slamArena(1, 0);
  Object.assign(beetle, { state: 'windup', timer: BEETLE_TIMINGS.windup / 2 });
  const operations = [];
  const ctx = new Proxy({}, { get(target, key) {
    if (key in target) return target[key];
    if (key === 'createRadialGradient') return () => ({ addColorStop() {} });
    return (...args) => operations.push([key, ...args]);
  } });
  const view = Object.assign(Object.create(Renderer.prototype), {
    ctx, width: 640, height: 360, camera: { orthoTop: 5 }, reducedMotion: true,
    world: { fires: [], portals: [], bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 } },
    presentation: { hounds: [{ flash: 0 }], effects: [], player: { flash: 0 } },
    hounds: [{ warning: { mesh: { isVisible: true } } }], fxSprites: new Map(), assets: {},
    project: (x, y) => ({ x, y }), groundAnchor: (x, y) => ({ x, y }),
  });
  view.drawOverlay(game, 0, 'playing');
  const close = operations.findIndex(([name]) => name === 'closePath');
  const begin = operations.slice(0, close).map(([name]) => name).lastIndexOf('beginPath');
  const path = operations.slice(begin + 1, close).map(([, x, y]) => ({ x, y }));
  assert.deepEqual(path, warningShape(beetle, game.world));
  view.updateEffects(game);
  assert.equal(view.hounds[0].warning.mesh.isVisible, false);
});

test('the beetle telegraph stops at walls, pillars and braziers yet still covers every spot its slam reaches', async () => {
  const { warningShape } = await import('../src/render.js');
  // Each blocker is set before the arena's first walkability lookup caches its tiles.
  const blockers = {
    pillar: world => { world.obstacles = [{ x: .85, y: 0, halfSize: .15 }]; },
    brazier: world => { world.obstacles = [{ x: .7, y: .45, radius: .22 }]; },
    wall: world => { world.tiles = world.tiles.filter(p => !(p.x >= 1 && p.y >= 0)); },
  };
  for (const [name, block] of Object.entries(blockers)) for (const angle of [0, .4, -.4]) {
    const free = slamArena(Math.cos(angle), Math.sin(angle)), open = warningShape(free.beetle, free.game.world);
    const arena = slamArena(Math.cos(angle), Math.sin(angle));
    block(arena.game.world);
    const shape = warningShape(arena.beetle, arena.game.world);
    let hits = 0, shadow = 0, overdrawn = 0;
    for (let x = -1.5; x <= 1.5 + 1e-9; x += .05) for (let y = -1.5; y <= 1.5 + 1e-9; y += .05) {
      const hit = slamHits(arena, x, y), drawn = inside(shape, x, y);
      if (hit) hits++;
      if (hit) assert.ok(drawn || edgeDistance(shape, x, y) < .01, `${name} ${angle}: hit at ${x.toFixed(2)},${y.toFixed(2)} outside the telegraph`);
      // Ground the unclipped sector would promise, but the blocker shields.
      if (!hit && inside(open, x, y)) { shadow++; if (drawn) overdrawn++; }
    }
    assert.ok(hits > 150, `${name} ${angle}: too few hit samples (${hits})`);
    assert.ok(shadow > 20 && overdrawn < shadow * .3, `${name} ${angle}: ${overdrawn} of ${shadow} shielded samples still drawn`);
  }
  const pillar = slamArena(1, 0); blockers.pillar(pillar.game.world);
  assert.equal(inside(warningShape(pillar.beetle, pillar.game.world), 1.2, 0), false, 'ground behind the pillar is not promised');
  const wall = slamArena(1, 0); blockers.wall(wall.game.world);
  assert.equal(inside(warningShape(wall.beetle, wall.game.world), 1, .3), false, 'ground beyond the wall is not promised');
});
