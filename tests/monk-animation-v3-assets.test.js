import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { monkPose } from '../src/pixel-animation.js';
import { MONK_RULES } from '../src/monk-combat.js';
import { WEAPON_FAMILIES } from '../src/items.js';
import { readPng } from './helpers/png.js';
import { decodeHitMask } from '../src/pixel-picking.js';

const root = new URL('../assets/game/pixel-v17/monk-side/', import.meta.url);
const read = name => JSON.parse(readFileSync(new URL(name, root)));
const pkg = read('manifest.json'), atlas = pkg.monk, metrics = read('metrics-2.json');
const weapons = JSON.parse(readFileSync(new URL('../monk-weapons/manifest.json', root)));
const headings = [[0, 1, 'front'], [-1, 0, 'back'], [-1, 1, 'side']];
const player = { hp: 100, dx: 0, dy: 1, moving: false, distance: 0, dashTime: 0 };

function bbox(png, frame, columns) {
  const left = frame % columns * 96, top = Math.floor(frame / columns) * 96;
  let x0 = 96, y0 = 96, x1 = 0, y1 = 0;
  for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) if (png.alpha(left + x, top + y)) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1);
  }
  return [x0, y0, x1, y1];
}

test('every frame is measured and every in-between stays in the old-key envelope', () => {
  assert.equal(metrics.frames.length, atlas.frames.length);
  assert.deepEqual(metrics.violations, []);
  assert.equal(metrics.paletteColors, 34);
  const im = readPng(new URL(atlas.path, root));
  const original = readPng(new URL('../../pixel-v10/monk-side/monk-side.png', root));
  let between = 0;
  for (const row of metrics.frames) {
    const actual = bbox(im, row.index, atlas.columns);
    assert.deepEqual(actual, row.measured.bbox, row.name);
    assert.equal(row.measured.width, actual[2] - actual[0]);
    assert.equal(row.measured.height, actual[3] - actual[1]);
    assert.equal(row.legsPreserved, true, row.name);
    assert.deepEqual(row.violations, []);
    for (let j = 0; j < 2; j++) {
      const ref = bbox(original, row.neighbours[j], 10);
      assert.equal(row.neighbourMeasures[j].width, ref[2] - ref[0]);
      assert.equal(row.neighbourMeasures[j].height, ref[3] - ref[1]);
    }
    if (row.kind !== 'in-between') continue;
    between++;
    const flatten = m => [m.width, m.height, m.hipY, m.headTop, ...m.feet.flat()];
    const a = flatten(row.neighbourMeasures[0]), b = flatten(row.neighbourMeasures[1]);
    flatten(row.measured).forEach((value, i) => assert.ok(value >= Math.min(a[i], b[i]) - 1 && value <= Math.max(a[i], b[i]) + 1, `${row.name} measure ${i}`));
  }
  assert.ok(between >= 24, 'the package must contain actual bounded part edits, not just copied keys');
});

test('the quality gate checks actual delivered PNGs, including leg colours, gaps and orphan pixels', () => {
  const result = spawnSync('python3', ['scripts/build-monk-animation-v3.py', '--check', '--metrics-only'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /METRICS OK/);
});

test('inserted phases retain every original key and do not shorten a clip', () => {
  for (const [name, clip] of Object.entries(atlas.clips)) {
    assert.equal(clip.sourceKeys.length, clip.front.length);
    assert.equal(clip.front.length, metrics.clipCounts[name]);
    for (let i = 0; i < clip.sourceCount; i++) assert.ok(clip.sourceKeys.includes(i), `${name} old key ${i}`);
    assert.ok(clip.sourceKeys.every((phase, i, all) => i === 0 || phase > all[i - 1]));
    for (const [, , view] of headings) assert.equal(clip[view].length, clip.front.length);
  }
  assert.equal(atlas.runCycleDistance, 3.36);
  assert.equal(atlas.clips.run.front.length, 8);
  assert.equal(atlas.clips.death.front.length, 6, 'unclean death in-betweens are deliberately omitted');
});

test('every weapon and bare strike keeps exact contact and all original windows in every view', () => {
  for (const family of [null, 'knuckles', 'staff']) {
    const combo = family ? WEAPON_FAMILIES[family].combo : MONK_RULES.combo;
    for (let index = 0; index < combo.duration.length; index++) for (const [dx, dy, view] of headings) {
      const clip = family === 'knuckles' ? weapons.knuckles.clips[`knuckleStrike${index + 1}`]
        : family === 'staff' ? weapons.staffAttacks.clips[`staffAttack${index + 1}`] : atlas.clips[`attack${index + 1}`];
      const hit = combo.hitTime[index], end = combo.duration[index];
      const boundaries = [0, hit / 2, hit, hit + (end - hit) * .25, hit + (end - hit) * .6, end - 1 / 60];
      for (const [k, phase] of clip.sourceKeys.entries()) {
        const i = Math.floor(phase), f = phase - i, age = boundaries[i] + (boundaries[Math.min(5, i + 1)] - boundaries[i]) * f;
        const pose = monkPose({ ...player, dx, dy, attack: { index, age, weapon: family } }, atlas, {}, weapons);
        assert.equal(pose.frame, family ? clip[view][k].frame : clip[view][k]);
        if (family) assert.equal(pose.weapon.cell, clip[view][k].overlay ?? clip[view][k].staff);
      }
      assert.equal(monkPose({ ...player, dx, dy, attack: { index, age: hit, weapon: family } }, atlas, {}, weapons).frame,
        family ? clip[view][clip.contactKey].frame : clip[view][clip.contactKey]);
    }
  }
});

test('body masks match the actual pixels and all appearances share their geometry', () => {
  const im = readPng(new URL(atlas.path, root)), mask = decodeHitMask(read('hit-masks.json')[atlas.path]);
  assert.ok(im.width <= 4096 && im.height <= 4096);
  for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) {
    const a = im.alpha(x, y), i = y * mask.width + x;
    if (a !== 0 && a !== 255) assert.fail('non-binary alpha');
    if (!!a !== !!(mask.bytes[i >> 3] & 1 << (i & 7))) assert.fail(`mask ${x},${y}`);
  }
  assert.equal(pkg.appearance.variants.length, 18);
  for (const variant of pkg.appearance.variants) {
    const data = readFileSync(new URL(variant.path, root));
    assert.deepEqual([data.readUInt32BE(16), data.readUInt32BE(20)], [im.width, im.height]);
  }
});

test('every clip/view/family has comparisons and requested bare clips have 3x crop sheets', () => {
  const timing = read('previews/timing.json');
  assert.equal(Object.keys(timing).length, 102);
  for (const entry of Object.values(timing)) {
    assert.ok(existsSync(new URL(entry.sheet, root)));
    assert.ok(existsSync(new URL(entry.gif, root)));
    assert.ok(entry.frameTimesMs.at(-1) < entry.durationMs);
    if (entry.hitTimeMs != null) assert.ok(entry.frameTimesMs.includes(entry.hitTimeMs));
  }
  for (const name of ['idle', 'run', 'attack1', 'attack2', 'attack3', 'dash']) for (const [, , view] of headings) {
    const data = readFileSync(new URL(`previews/review-2/${name}-${view}.png`, root));
    assert.equal(data.readUInt32BE(16), 96 * Math.max(atlas.clips[name].sourceCount, atlas.clips[name].front.length) * 3);
    assert.equal(data.readUInt32BE(20), 218 * 3);
  }
});
