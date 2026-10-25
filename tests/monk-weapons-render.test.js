import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NullEngine, Scene, ArcRotateCamera, Camera, Vector3, Texture } from '@babylonjs/core';
import { Renderer } from '../src/render.js';
import * as pixels from '../src/pixel-scene.js';
import { monkPose, PresentationState } from '../src/pixel-animation.js';
import { createGame, updateGame } from '../src/game.js';
import { LOCATIONS } from '../src/campaign.js';
import { MONK_RULES } from '../src/monk-combat.js';
import { WEAPON_FAMILIES, createItem, pickUpItem } from '../src/items.js';
import { equipItem } from '../src/inventory-actions.js';
import monkPackage from '../assets/game/pixel-v17/monk-side/manifest.json' with { type: 'json' };

const weapons = JSON.parse(readFileSync(new URL('../assets/game/pixel-v17/monk-weapons/manifest.json', import.meta.url), 'utf8'));
const atlas = monkPackage.monk;
const cells = layer => weapons[layer].columns * weapons[layer].rows;
const monk = (extra = {}) => ({ hp: 100, dx: 0, dy: 1, moving: false, distance: 0, dashTime: 0, attack: null, technique: null, ...extra });
// Headings: front (SE), back (NW), screen right and left (side drawings), and their mirrors.
const HEADINGS = [[0, 1], [1, 0], [-1, 0], [0, -1], [-1, 1], [1, -1]];
// Inserted drawings subdivide the original six timing boundaries.
const keyAges = (combo, i, clip) => {
  const hit = combo.hitTime[i], end = combo.duration[i];
  const boundaries = [0, hit / 2, hit, hit + (end - hit) * .25, hit + (end - hit) * .6, end - 1 / 60];
  return clip.sourceKeys.map(phase => {
    const index = Math.floor(phase), fraction = phase - index;
    return boundaries[index] + fraction * (boundaries[Math.min(index + 1, 5)] - boundaries[index]) + 1e-6;
  });
};

test('every strike key of both weapon families resolves a body key and a layer cell, in every heading', () => {
  for (const family of ['knuckles', 'staff']) {
    const combo = WEAPON_FAMILIES[family].combo;
    for (let index = 0; index < combo.strikes; index++) {
      for (const [dx, dy] of HEADINGS) {
        const clip = family === 'knuckles' ? weapons.knuckles.clips[`knuckleStrike${index + 1}`]
          : weapons.staffAttacks.clips[`staffAttack${index + 1}`];
        const keys = keyAges(combo, index, clip).map(age => monkPose(monk({ dx, dy,
          attack: { index, age, weapon: family, strikes: combo.strikes } }), atlas, {}, weapons));
        const side = !!clip.side && Math.abs(dx + dy) < 1e-9;
        const steps = side ? clip.side : clip[dx + dy < 0 ? 'back' : 'front'];
        keys.forEach((pose, key) => {
          const label = `${family} strike ${index + 1} key ${key} heading ${dx},${dy}`;
          assert.ok(Number.isInteger(pose.frame) && pose.frame >= 0 && pose.frame < atlas.frames.length, label);
          assert.equal(pose.frame, steps[key].frame, label);
          const layer = family === 'knuckles' ? 'knuckles' : 'staffAttacks';
          assert.equal(pose.weapon.layer, layer, label);
          assert.equal(pose.weapon.cell, family === 'knuckles' ? steps[key].overlay : steps[key].staff, label);
          assert.ok(pose.weapon.cell >= 0 && pose.weapon.cell < cells(layer), label);
        });
      }
    }
  }
});

test('every monk key carries its knuckles or held staff cell when armed', () => {
  for (const family of ['knuckles', 'staff']) {
    const seen = new Set();
    for (const [name, clip] of Object.entries(atlas.clips)) {
      for (const view of ['front', 'back', 'side']) for (const frame of clip[view] ?? []) {
        assert.ok(frame < cells(family), `${family} has a cell for ${name} key ${frame}`);
        seen.add(frame);
      }
    }
    assert.equal(seen.size, Object.values(atlas.clips).reduce((count, clip) =>
      count + ['front', 'back', 'side'].reduce((count, view) => count + (clip[view]?.length ?? 0), 0), 0),
    'every active body drawing is covered by its held weapon layer');
    // Held, running, side, wave, hurt, dash, crane, deflect, death: the layer cell is the shown key.
    const visuals = [{}, { idleAge: .5 }, { waveAge: .1 }, { hurtAge: .1 }, { castAge: 0 }, { landAge: 0 }];
    const bodies = [monk(), monk({ moving: true, distance: 1.3 }), monk({ dx: -1, dy: 1, moving: true, distance: .6 }),
      monk({ dashTime: .1 }), monk({ hp: 0 }), monk({ technique: { id: 'deflect', t: .2, duration: .4 } }),
      monk({ technique: { id: 'crane', t: .2, duration: .4, fromX: 0, fromY: 0, toX: 0, toY: 3 } })];
    for (const body of bodies) for (const visual of visuals) {
      const pose = monkPose(body, atlas, { ...visual, weapon: family }, weapons);
      assert.deepEqual(pose.weapon, { layer: family, cell: pose.frame, flip: pose.flip });
    }
  }
});

test('an unarmed monk poses exactly as before, with or without the weapon package loaded', () => {
  const visuals = [{}, { idleAge: .9 }, { waveAge: .2 }, { hurtAge: .1 }, { deathAge: .4 }];
  const bodies = [monk(), monk({ dx: 1, dy: 0 }), monk({ moving: true, distance: 2.2 }), monk({ dx: -1, dy: 1, moving: true }),
    monk({ dashTime: .05 }), monk({ hp: 0 }), ...[0, 1, 2].flatMap(index => [.01, .1, .2].map(age => monk({ attack: { index, age } })))];
  for (const body of bodies) for (const visual of visuals) {
    const bare = monkPose(body, atlas, visual);
    assert.deepEqual(Object.keys(bare).sort(), ['flip', 'frame']);
    assert.deepEqual(monkPose(body, atlas, visual, weapons), bare);
    assert.deepEqual(monkPose(body, atlas, { ...visual, weapon: null }, weapons), bare);
  }
  // The bare series keeps attack1-3 at the bare timings.
  for (let index = 0; index < 3; index++) {
    const clip = atlas.clips[`attack${index + 1}`];
    assert.equal(monkPose(monk({ attack: { index, age: MONK_RULES.combo.hitTime[index] } }), atlas, {}, weapons).frame, clip.front[clip.contactKey]);
  }
  // A swing started bare stays bare after a weapon is equipped mid-swing.
  assert.equal(monkPose(monk({ attack: { index: 0, age: .01 } }), atlas, { weapon: 'staff' }, weapons).weapon, undefined);
});

test('flip math: knuckles follow the facing; a staff swing mirrors its body where the clip says, never its staff cell', () => {
  const combo = WEAPON_FAMILIES.staff.combo;
  for (const [dx, dy, flip] of [[0, 1, false], [1, 0, true], [-1, 0, false], [0, -1, true]]) {
    const clip = weapons.staffAttacks.clips.staffAttack3;
    const ages = keyAges(combo, 2, clip);
    const steps = clip[dx + dy < 0 ? 'back' : 'front'];
    ages.forEach((age, key) => {
      const pose = monkPose(monk({ dx, dy, attack: { index: 2, age, weapon: 'staff', strikes: 3 } }), atlas, {}, weapons);
      assert.equal(pose.weapon.flip, flip, `staff cell keeps the facing flip, key ${key}`);
      assert.equal(pose.flip, flip !== steps[key].mirrorBody, `body flip = facing flip XOR mirrorBody, key ${key}`);
    });
    const knuckle = monkPose(monk({ dx, dy, attack: { index: 3, age: .13, weapon: 'knuckles', strikes: 4 } }), atlas, {}, weapons);
    assert.equal(knuckle.flip, flip); assert.equal(knuckle.weapon.flip, flip);
    assert.equal(monkPose(monk({ dx, dy }), atlas, { weapon: 'staff' }, weapons).weapon.flip, flip);
  }
  // The spin really mirrors some body keys, so both branches of the rule are exercised.
  assert.ok(weapons.staffAttacks.clips.staffAttack3.front.some(step => step.mirrorBody));
  // The staff trail lists the tip of each key so far, in swing cell pixels.
  const pose = monkPose(monk({ attack: { index: 0, age: keyAges(combo, 0, weapons.staffAttacks.clips.staffAttack1)[3], weapon: 'staff', strikes: 3 } }), atlas, {}, weapons);
  assert.deepEqual(pose.weapon.trail, weapons.staffAttacks.clips.staffAttack1.front.slice(0, 4).map(step => step.tip));
});

test('without the weapon package, armed strikes keep the bare drawings and draw no layer', () => {
  const pose = monkPose(monk({ attack: { index: 3, age: .13, weapon: 'knuckles', strikes: 4 } }), atlas, { weapon: 'knuckles' });
  assert.deepEqual(Object.keys(pose).sort(), ['flip', 'frame']);
  assert.equal(pose.frame, atlas.clips.attack3.front[atlas.clips.attack3.contactKey], 'contact on the heavy bare drawing');
});

function harness(t) {
  const engine = new NullEngine({ renderWidth: 720, renderHeight: 450 });
  engine.createCanvas = (width, height) => ({ width, height, getContext: () => ({
    clearRect() {}, beginPath() {}, arc() {}, stroke() {}, moveTo() {}, lineTo() {}, closePath() {}, fillRect() {},
  }) });
  const scene = new Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  const camera = new ArcRotateCamera('weapon-camera', Math.PI / 4, Math.PI / 3, 30, Vector3.Zero(), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  Object.assign(camera, { orthoLeft: -720 / 64, orthoRight: 720 / 64, orthoTop: 450 / 64, orthoBottom: -450 / 64 });
  const assets = Object.fromEntries(Object.entries(pixels.pixelAtlases).map(([name, a]) => [name, { ...a, texture: new Texture(null, scene) }]));
  assets.monkWeapons = { failed: false, manifest: weapons, ...Object.fromEntries(['knuckles', 'staff', 'staffAttacks']
    .map(name => [name, { ...pixels.monkWeaponAtlas(weapons[name]), texture: new Texture(null, scene) }])) };
  const location = LOCATIONS.road, game = createGame();
  Object.assign(game, { world: location, locationId: location.id, locationRevision: 0, enemies: [], projectiles: [],
    adventure: { quest: 'outbound', secretFound: false, rewardCollected: false, visited: [location.id] } });
  Object.assign(game.player, location.spawn);
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    engine, scene, camera, assets, game, width: 720, height: 450, locationRevision: 0,
    followTarget: camera.target.clone(), shake: 0, reducedMotion: false,
    presentation: new PresentationState(game), fxSprites: new Map(),
    world: pixels.buildPixelWorld(scene, assets, location),
    monk: pixels.createSprite(scene, 'monk', assets.monk), monkShadow: pixels.createShadow(scene, 'monk-shadow'),
    hounds: [], drawOverlay() {}, drawMap() {},
  });
  return { renderer, game, scene };
}
// Equips the family's test item, from the bag when it is already there.
const equip = (game, family) => {
  let slot = game.inventory.bag.findIndex(item => item?.family === family);
  if (slot < 0) slot = pickUpItem(game.inventory, createItem({ id: `test-${family}`, family })).slot;
  assert.equal(equipItem(game, slot).ok, true);
};
const shown = r => Object.entries(r.weaponSprites ?? {}).filter(([, sprite]) => sprite.mesh.isEnabled()).map(([name]) => name);

test('renderer: the equipped layer rides on the monk key, swaps with the weapon and hides when unarmed', t => {
  const { renderer: r, game } = harness(t);
  r.render(game, 0);
  assert.deepEqual(shown(r), []);
  equip(game, 'knuckles');
  r.render(game, 1 / 60);
  const knuckles = r.weaponSprites.knuckles;
  assert.deepEqual(shown(r), ['knuckles']);
  assert.deepEqual([knuckles.frame, knuckles.flip], [r.monk.frame, r.monk.flip]);
  assert.ok(knuckles.mesh.position.equals(r.monk.mesh.position));
  assert.equal(knuckles.material.zOffsetUnits, -2, 'drawn just in front of the monk billboard');
  equip(game, 'staff');
  r.render(game, 1 / 60);
  assert.deepEqual(shown(r), ['staff']);
  assert.equal(r.weaponSprites.staff.frame, r.monk.frame);
  // A staff swing: the active cell shares the monk's ground anchor and mirrors about it.
  game.player.dx = 1; game.player.dy = 0;
  for (let i = 0; i < 40 && !(game.player.attack?.index === 2 && game.player.attack.age > .14); i++) {
    updateGame(game, { moveX: 0, moveY: 0, aimX: 1, aimY: 0, attack: true }, 1 / 60);
    r.render(game, 1 / 60);
  }
  assert.equal(game.player.attack?.index, 2, 'the spin is running');
  const swing = r.weaponSprites.staffAttacks;
  assert.deepEqual(shown(r), ['staffAttacks']);
  assert.ok(swing.mesh.position.equals(r.monk.mesh.position));
  assert.equal(swing.flip, true, 'facing screen-left keeps the staff cell mirrored');
  const box = swing.mesh.getBoundingInfo().boundingBox;
  assert.ok(Math.abs(box.minimum.x + box.maximum.x) < 1e-9, 'the cell is centred on the anchor column');
  assert.ok(Math.abs(box.maximum.y - 104 / 32) < 1e-6 && Math.abs(box.minimum.y + 40 / 32) < 1e-6, 'anchor row 104 of 144');
  // Unequipping hides every layer; a hidden monk hides its weapon too.
  game.player.attack = null;
  game.inventory.equipped.weapon = null;
  r.render(game, 1 / 60);
  assert.deepEqual(shown(r), []);
  equip(game, 'knuckles');
  r.monk.mesh.setEnabled(false);
  r.render(game, 1 / 60);
  assert.deepEqual(shown(r), []);
});

test('renderer: a real knuckle series shows all four strike overlays and a staff swing draws its tip trail', t => {
  const { renderer: r, game } = harness(t);
  equip(game, 'knuckles');
  const overlays = new Set();
  for (let i = 0; i < 120; i++) {
    updateGame(game, { moveX: 0, moveY: 0, aimX: 0, aimY: 1, attack: true }, 1 / 120);
    r.render(game, 1 / 120);
    if (game.player.attack) overlays.add(r.weaponSprites.knuckles.frame);
  }
  const strikeCells = Object.values(weapons.knuckles.clips).flatMap(clip => clip.front.map(step => step.overlay));
  for (const index of [0, 1, 2, 3]) {
    const clip = weapons.knuckles.clips[`knuckleStrike${index + 1}`].front.map(step => step.overlay);
    assert.ok(clip.some(cell => overlays.has(cell)), `strike ${index + 1} shows its overlay`);
  }
  assert.ok([...overlays].every(cell => strikeCells.includes(cell) || cell < atlas.frames.length));
  // The trail: finite afterimage coordinates from the swing cell tips.
  const strokes = [];
  r.ctx = new Proxy({}, { get(target, key) {
    if (key in target) return target[key];
    if (key === 'createRadialGradient') return () => ({ addColorStop() {} });
    return (...args) => {
      assert.ok(args.every(value => typeof value !== 'number' || Number.isFinite(value)), `${String(key)} got a non-finite value`);
      if (key === 'fillRect') strokes.push(args);
    };
  } });
  game.inventory.equipped.weapon = null; game.player.attack = null; game.player.combo = 0;
  equip(game, 'staff');
  for (let i = 0; i < 20; i++) {
    updateGame(game, { moveX: 0, moveY: 0, aimX: 0, aimY: 1, attack: i === 0 }, 1 / 120);
    r.render(game, 1 / 120);
  }
  assert.equal(r.monkShown.weapon.layer, 'staffAttacks');
  assert.ok(r.monkShown.weapon.trail.length >= 2);
  Renderer.prototype.drawOverlay.call(r, game, r.presentation.time, 'playing');
  assert.ok(strokes.some(([, , w, h]) => w === 2 && h === 2), 'afterimages mark the earlier tips');
});

test('loading: the weapon manifest is fetched; a failed package leaves the world ready and the monk unarmed', async t => {
  for (const failing of [false, true]) {
    const engine = new NullEngine(), scene = new Scene(engine);
    t.after(() => { scene.dispose(); engine.dispose(); });
    const fetched = [];
    t.mock.method(globalThis, 'fetch', async url => {
      fetched.push(String(url));
      if (failing && String(url).includes('monk-weapons')) return new Response('missing', { status: 404 });
      return new Response(readFileSync(new URL(url)));
    });
    const assets = pixels.loadPixelAssets(scene);
    await assert.doesNotReject(assets.ready);
    assert.ok(fetched.some(url => url === pixels.monkWeaponsManifestUrl));
    assert.equal(assets.monkWeapons.failed, failing);
    if (failing) { assert.equal(assets.monkWeapons.manifest, null); continue; }
    assert.deepEqual(assets.monkWeapons.manifest.knuckles.clips, weapons.knuckles.clips);
    assert.deepEqual(assets.monkWeapons.staffAttacks.frameSize, weapons.staffAttacks.cell);
    assert.deepEqual(assets.monkWeapons.staffAttacks.anchor, weapons.staffAttacks.anchor);
    assert.equal(assets.monkWeapons.knuckles.cell, 96);
    t.mock.restoreAll();
  }
});
