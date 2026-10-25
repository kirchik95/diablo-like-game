import monkPackage from '../assets/game/pixel-v17/monk-side/manifest.json' with { type: 'json' };
import houndPackage from '../assets/game/pixel-v2/hound-world/manifest.json' with { type: 'json' };
import wraithPackage from '../assets/game/pixel-v3/wraith/manifest.json' with { type: 'json' };
import beetlePackage from '../assets/game/pixel-v7/beetle/manifest.json' with { type: 'json' };
import { WRAITH_TIMINGS, BEETLE_TIMINGS } from './campaign.js';
import { MONK_RULES } from './monk-combat.js';
import { WEAPON_FAMILIES } from './items.js';
import { skillParams } from './run-progress.js';

// Screen right is dy - dx and screen down is (dx + dy) / 2 for the fixed +X/+Z isometric camera.
const EMPTY = Object.freeze({}), EMPTY_LIST = Object.freeze([]), ROAD_SHRINE = Object.freeze(['road-shrine']);
// Finite read-only values can be shared without one actor changing another's heading.
const FACINGS = Array.from({ length: 8 }, (_, i) => Object.freeze({ back: !!(i & 4), flip: !!(i & 2), side: !!(i & 1) }));
const heading = (back, flip, side) => FACINGS[(back ? 4 : 0) + (flip ? 2 : 0) + (side ? 1 : 0)];
// Headings within 20 degrees of screen-horizontal also have a side drawing where an atlas
// authors one (the monk's idle and run). A facing enters the band inside 15 degrees and
// leaves it beyond 25, so a cursor near the edge does not flicker and keyboard diagonals
// (26.6 degrees, the authored SE/NE drawings) never show it. Values are sines.
export const SIDE_BAND = Object.freeze({
  nominal: Math.sin(20 * Math.PI / 180), enter: Math.sin(15 * Math.PI / 180), leave: Math.sin(25 * Math.PI / 180),
});
const facing = body => {
  const dx = body.dx, dy = body.dy, right = dy - dx, down = (dx + dy) / 2, length = Math.hypot(right, down);
  return heading(dx + dy < 0, dy - dx < 0, length > 1e-9 && Math.abs(down) < SIDE_BAND.nominal * length);
};
// Pure screen-left/right travel lies exactly on the front/back boundary and pure
// up/down travel on the mirror boundary. A drawing changes only after the heading
// is this far past a boundary, measured as a screen angle (sine of 15 degrees).
export const FACING_HYSTERESIS = Math.sin(15 * Math.PI / 180);
export function stableFacing(previous, dx, dy, band = FACING_HYSTERESIS) {
  if (!previous) return heading(dx + dy < 0, dy - dx < 0, Math.hypot(dy - dx, (dx + dy) / 2) > 1e-9
    && Math.abs((dx + dy) / 2) < SIDE_BAND.nominal * Math.hypot(dy - dx, (dx + dy) / 2));
  const right = dy - dx, down = (dx + dy) / 2, length = Math.hypot(right, down);
  if (length < 1e-9) return previous;
  const back = down / length < (previous.back ? band : -band);
  const flip = right / length < (previous.flip ? band : -band);
  const side = Math.abs(down) / length < (previous.side ? SIDE_BAND.leave : SIDE_BAND.enter);
  return back === previous.back && flip === previous.flip && side === !!previous.side ? previous : heading(back, flip, side);
}
// Presentation hysteresis applies only to the exact heading it was computed from.
const shownFacing = (body, visual) => body.hp <= 0 ? visual.deathFacing ?? facing(body)
  : visual.facing && visual.facingDx === body.dx && visual.facingDy === body.dy ? visual.facing : facing(body);
// Six run keys cover two steps. While a foot is planted, the front/back drawings sweep it
// back ~17.75 source px per key (keys 4-6 and 7-9 of both clips); the side drawing plants
// it on an exact 18 px track. Screen-left/right travel moves 32 px/u, so .56u per key
// locks that foot to the ground; at 5.4u/s the cadence is ~9.6 keys/s (3.2 steps/s).
// Diagonal runs still slip ~5 px per key.
export const MONK_RUN_KEY_DISTANCE = .56;
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const step = (age, interval) => Math.floor((Math.max(0, age) + 1e-9) / interval);
const oneShot = (age, duration, keys = 6) => clamp(step(age, duration / keys), 0, keys - 1);

const clipFrames = (clip, direction = EMPTY) => direction.side && clip.side ? clip.side : clip[direction.back ? 'back' : 'front'];
const frameCount = (atlas, name, direction) => clipFrames(atlas.clips[name], direction).length;
function phaseKey(clip, phase) {
  let key = 0;
  for (let i = 0; i < clip.sourceKeys.length; i++) if (phase + 1e-8 >= clip.sourceKeys[i]) key = i;
  return key;
}
const plainPoses = [new WeakMap(), new WeakMap()];

// Poses are finite read-only values shared by matching atlas/frame/flip queries.
export function clipPose(atlas, name, key, direction = EMPTY) {
  const clip = atlas.clips[name];
  // Clips without a side drawing (attacks, dash, wave, hurt, death) keep the front/back pair.
  const frames = clipFrames(clip, direction);
  const frame = frames[clamp(key, 0, frames.length - 1)], flip = !!direction.flip;
  const poses = plainPoses[flip ? 1 : 0];
  let cached = poses.get(atlas);
  if (!cached) { cached = new Map(); poses.set(atlas, cached); }
  let result = cached.get(frame);
  if (!result) { result = Object.freeze({ frame, flip }); cached.set(frame, result); }
  return result;
}

// The series of a strike or a swing event: its weapon family's combo, or bare hands.
export const attackCombo = attack => WEAPON_FAMILIES[attack?.weapon]?.combo ?? MONK_RULES.combo;
// Bare-hand strike drawings: attack1-3. Without the weapon package an armed series reuses them,
// its last strike on the heavy attack3 (knuckles: 1, 2, 1, 3).
const bareStrike = (index, strikes = 3) => index >= strikes - 1 ? 'attack3' : index % 2 ? 'attack2' : 'attack1';
// Placeholder technique poses (§2.3) from the existing clips. The dash leap carries the crane
// flight, attack1 the palm cast, attack3's guard key 01 (forearms crossed) the deflect stance
// and its strike keys the riposte. Gesture lengths are seconds.
export const TECHNIQUE_POSES = Object.freeze({ cast: .2, landing: .16, riposte: .22, guard: .06 });
// Crane flight keys: crouch, rise, soar, tuck, then dash keys 04-05 land once he is down.
const CRANE_KEYS = [.15, .4, .7, .9];
// The sprite's height above the ground at mid-flight, in world units.
export const CRANE_PEAK = 1.1;

// Crane flight progress 0..1 at a drawn ground point: its share of the take-off to landing
// line, so the arc follows the blended body. A jump that cannot move runs on its clock.
export function craneProgress(technique, at = null) {
  const lx = technique.toX - technique.fromX, ly = technique.toY - technique.fromY, length2 = lx * lx + ly * ly;
  if (at && length2 > 1e-6) return clamp(((at.x - technique.fromX) * lx + (at.y - technique.fromY) * ly) / length2, 0, 1);
  return technique.duration > 0 ? clamp(technique.t / technique.duration, 0, 1) : 1;
}

// Weapon layers (pixel-v12 monk-weapons, §3.8). `weapons` is that package's manifest, which
// loadPixelAssets fetches. An armed pose adds `weapon: { layer, cell, flip }`:
//   - any monk key: the knuckles or staff cell of that key, with the monk's flip;
//   - a knuckle strike: its body key and overlay cell from knuckleStrike1-4 (front/back);
//   - a staff swing: staffAttack1-3 (front/back/side). The body key is mirrored where the clip
//     says (mirrorBody); the 160 × 144 swing cell keeps the facing's flip and shares the monk's
//     ground anchor. `trail` lists the staff tip of each key so far, in swing cell pixels.
// The swing's own weapon decides during a strike, the equipped one (visual.weapon) otherwise.
// Without the package, armed strikes keep the bare-hand drawings and no layer is drawn.
const weaponStrikes = new WeakMap(), armedPoses = new WeakMap(), poseContexts = new WeakMap();
function weaponStrike(weapons, family, index, key, direction) {
  const flip = !!direction.flip, clip = family === 'knuckles' ? weapons.knuckles.clips[`knuckleStrike${index + 1}`]
    : weapons.staffAttacks.clips[`staffAttack${index + 1}`];
  const steps = clipFrames(clip, direction), step = steps[key], slot = key * 2 + (flip ? 1 : 0);
  let poses = weaponStrikes.get(steps);
  if (!poses) { poses = []; weaponStrikes.set(steps, poses); }
  const layer = family === 'knuckles' ? 'knuckles' : 'staffAttacks';
  const cell = family === 'knuckles' ? step.overlay : step.staff, bodyFlip = family === 'knuckles' ? flip : flip !== step.mirrorBody;
  const cached = poses[slot];
  let same = cached && cached.frame === step.frame && cached.flip === bodyFlip && cached.weapon.layer === layer
    && cached.weapon.cell === cell && cached.weapon.flip === flip;
  if (same && family !== 'knuckles') {
    if (cached.weapon.trail.length !== key + 1) same = false;
    else for (let i = 0; i <= key; i++) if (cached.weapon.trail[i] !== steps[i].tip) { same = false; break; }
  }
  if (!same) {
    if (family === 'knuckles') poses[slot] = Object.freeze({ frame: step.frame, flip,
      weapon: Object.freeze({ layer, cell, flip }) });
    else {
      const trail = [];
      for (let i = 0; i <= key; i++) trail.push(steps[i].tip);
      poses[slot] = Object.freeze({ frame: step.frame, flip: bodyFlip,
        weapon: Object.freeze({ layer, cell, flip, trail: Object.freeze(trail) }) });
    }
  }
  return poses[slot];
}

class PoseContext {
  count(name) { return frameCount(this.atlas, name, this.direction); }
  shot(name, age, duration) {
    const clip = this.atlas.clips[name];
    return clip.sourceCount ? phaseKey(clip, Math.max(0, age) / duration * clip.sourceCount)
      : oneShot(age, duration, this.count(name));
  }
  source(name, oldKey) {
    const keys = this.atlas.clips[name].sourceKeys;
    if (!keys) return oldKey;
    let best = 0;
    for (let i = 0; i < keys.length; i++) if (Math.abs(keys[i] - oldKey) < Math.abs(keys[best] - oldKey)) best = i;
    return best;
  }
  pose(name, key) {
    const shown = clipPose(this.atlas, name, key, this.direction);
    if (!this.armed) return shown;
    let layers = armedPoses.get(this.armed);
    if (!layers) { layers = { knuckles: new WeakMap(), staff: new WeakMap() }; armedPoses.set(this.armed, layers); }
    const poses = layers[this.family];
    let result = poses.get(shown);
    if (!result) { result = Object.freeze({ frame: shown.frame, flip: shown.flip,
      weapon: Object.freeze({ layer: this.family, cell: shown.frame, flip: shown.flip }) }); poses.set(shown, result); }
    return result;
  }
}
function poseContext(body, atlas, direction, armed = null, family = null) {
  let context = poseContexts.get(body);
  if (!context) { context = new PoseContext(); poseContexts.set(body, context); }
  context.atlas = atlas; context.direction = direction; context.armed = armed; context.family = family;
  return context;
}
function strikeBoundary(index, hit, end) {
  switch (index) {
    case 0: return 0; case 1: return hit / 2; case 2: return hit;
    case 3: return hit + (end - hit) * .25; case 4: return hit + (end - hit) * .6; case 5: return end - 1 / 60;
  }
}

function craneKey(f) {
  let key = 0;
  for (let i = 0; i < CRANE_KEYS.length; i++) if (f + 1e-9 >= CRANE_KEYS[i]) key++;
  return key;
}

export function monkPose(player, atlas = monkPackage.monk, visual = EMPTY, weapons = null) {
  const settling = atlas.animationVersion >= 3 && !player.moving && visual.runSettle != null
    && player.hp > 0 && !player.attack && player.dashTime <= 0 && !player.technique;
  const direction = settling && visual.runFacing ? visual.runFacing : shownFacing(player, visual);
  const family = player.attack ? player.attack.weapon ?? null : visual.weapon ?? null;
  const armed = family === 'knuckles' || family === 'staff' ? weapons : null;
  const dense = atlas.animationVersion >= 3;
  const context = poseContext(player, atlas, direction, armed, family);
  const technique = player.technique;
  if (player.hp <= 0) return context.pose('death', context.shot('death', visual.deathAge ?? 0, .9));
  if (technique?.id === 'crane') {
    const f = craneProgress(technique);
    return context.pose('dash', context.source('dash', craneKey(f)));
  }
  if (player.dashTime > 0) return context.pose('dash', context.shot('dash', MONK_RULES.dash.duration - player.dashTime, MONK_RULES.dash.duration));
  if (player.attack) {
    const { index, age } = player.attack, combo = attackCombo(player.attack);
    const strikes = player.attack.strikes ?? combo.duration.length, i = clamp(index, 0, combo.duration.length - 1);
    const hit = combo.hitTime[i], end = combo.duration[i];
    // Key 03 is contact. Reserve the last frame before control returns so all six
    // drawings can be shown without extending the simulation's attack duration.
    const clip = armed ? (family === 'knuckles' ? armed.knuckles.clips[`knuckleStrike${i + 1}`]
      : armed.staffAttacks.clips[`staffAttack${i + 1}`]) : atlas.clips[bareStrike(index, strikes)];
    const contact = clip.contactKey ?? 2, keys = clipFrames(clip, direction).length;
    let key = 0;
    if (clip.sourceCount) {
      for (let k = 0; k < clip.sourceKeys.length; k++) {
        const phase = clip.sourceKeys[k], i = Math.floor(phase), f = phase - i;
        const at = strikeBoundary(i, hit, end) + (strikeBoundary(Math.min(i + 1, 5), hit, end) - strikeBoundary(i, hit, end)) * f;
        if (age + 1e-9 >= at) key = k;
      }
    } else if (keys === 6 && contact === 2) {
      for (let k = 0; k < 6; k++) if (age + 1e-9 >= strikeBoundary(k, hit, end)) key = k;
    } else key = age + 1e-9 < hit ? Math.min(contact - 1, step(age, hit / contact))
      : contact + oneShot(age - hit, end - hit, keys - contact);
    return armed ? weaponStrike(armed, family, i, key, direction) : context.pose(bareStrike(index, strikes), key);
  }
  if (visual.riposteAge != null && visual.riposteAge < TECHNIQUE_POSES.riposte) {
    return context.pose('attack3', dense ? context.source('attack3', 2) + oneShot(visual.riposteAge, TECHNIQUE_POSES.riposte, context.count('attack3') - context.source('attack3', 2)) : 2 + oneShot(visual.riposteAge, TECHNIQUE_POSES.riposte, 4));
  }
  if (technique?.id === 'deflect') return context.pose('attack3', context.source('attack3', technique.t < TECHNIQUE_POSES.guard ? 0 : 1));
  if (visual.landAge != null && visual.landAge < TECHNIQUE_POSES.landing) {
    return context.pose('dash', dense ? context.source('dash', 4) + oneShot(visual.landAge, TECHNIQUE_POSES.landing, context.count('dash') - context.source('dash', 4)) : 4 + oneShot(visual.landAge, TECHNIQUE_POSES.landing, 2));
  }
  if (!player.moving && visual.castAge != null && visual.castAge < TECHNIQUE_POSES.cast) {
    return context.pose('attack1', dense ? context.source('attack1', 2) + oneShot(visual.castAge, TECHNIQUE_POSES.cast, context.count('attack1') - context.source('attack1', 2)) : 2 + oneShot(visual.castAge, TECHNIQUE_POSES.cast, 4));
  }
  if (!player.moving && visual.waveAge != null && visual.waveAge < .5) return context.pose('wave', context.shot('wave', visual.waveAge, .5));
  if (!player.moving && visual.hurtAge != null && visual.hurtAge < .22) return context.pose('hurt', context.shot('hurt', visual.hurtAge, .22));
  if (player.moving || dense && visual.runSettle != null) {
    const distance = player.moving ? dense ? visual.runPosition ?? player.distance : player.distance : visual.runSettle;
    const cycle = atlas.runCycleDistance ?? MONK_RUN_KEY_DISTANCE * 6, clip = atlas.clips.run;
    return context.pose('run', clip.sourceCount ? phaseKey(clip, ((distance % cycle) + cycle) % cycle / cycle * clip.sourceCount)
      : step(distance, cycle / context.count('run')) % context.count('run'));
  }
  const idle = atlas.clips.idle;
  return context.pose('idle', idle.sourceCount ? phaseKey(idle, (Math.max(0, visual.idleAge ?? 0) % .8) / .8 * idle.sourceCount)
    : step(visual.idleAge ?? 0, .8 / context.count('idle')) % context.count('idle'));
}

// Rule A's search cone in degrees either side of F (TOUCH_RULES.cone in touch.js).
export const AUTO_AIM_CONE = 60;

// The ground marker of a technique held on a touch screen (mobile-touch §8, board 05), in world
// units from `origin` (the drawn monk). A technique with one reach (the palm) draws a line to that
// reach along the aim, and in auto mode rule A's cone; the others (crane, bell) a landing point at
// the aim's distance kept within min..max, with the zone the technique strikes there.
export function touchAimMarker(game, preview, origin = game.player) {
  const length = Math.hypot(preview.aimX, preview.aimY);
  const dx = length > 1e-6 ? preview.aimX / length : game.player.dx;
  const dy = length > 1e-6 ? preview.aimY / length : game.player.dy;
  const line = preview.min === preview.max, reach = line ? preview.max : clamp(length, preview.min, preview.max);
  return { x: origin.x, y: origin.y, dx, dy, min: preview.min, max: preview.max, kind: line ? 'line' : 'point',
    end: { x: origin.x + dx * reach, y: origin.y + dy * reach },
    zone: line ? 0 : skillParams(game, preview.skill)?.radius ?? 0,
    cone: line && preview.mode === 'auto' ? AUTO_AIM_CONE : 0, cancel: !!preview.cancel };
}

export function houndPose(enemy, atlas = houndPackage.hound, visual = EMPTY) {
  const direction = shownFacing(enemy, visual);
  const context = poseContext(enemy, atlas, direction);
  if (enemy.hp <= 0) return context.pose('death', oneShot(visual.deathAge ?? 0, .84));
  if (enemy.state === 'windup') return context.pose('attack', enemy.timer > .275 ? 0 : 1);
  if (enemy.state === 'leap') return context.pose('attack', enemy.hit || enemy.timer <= .135 ? 3 : 2);
  if (enemy.state === 'recover') return context.pose('attack', enemy.timer > .35 ? 4 : 5);
  if (enemy.state === 'stunned') return context.pose('hurt', oneShot(.38 - enemy.timer, .38, 4));
  if (enemy.state === 'chase') return context.pose('run', step(enemy.distance, .2) % 6);
  return context.pose('idle', step(visual.idleAge ?? 0, .2) % 4);
}

export function wraithPose(enemy, atlas = wraithPackage.wraith, visual = EMPTY) {
  const direction = shownFacing(enemy, visual);
  const context = poseContext(enemy, atlas, direction);
  if (enemy.hp <= 0) return context.pose('death', oneShot(visual.deathAge ?? 0, .9));
  if (enemy.state === 'windup') return context.pose('attack', oneShot(WRAITH_TIMINGS.windup - enemy.timer, WRAITH_TIMINGS.windup, 4));
  if (enemy.state === 'recover') return context.pose('attack', 4 + oneShot(WRAITH_TIMINGS.recover - enemy.timer, WRAITH_TIMINGS.recover, 2));
  if (enemy.state === 'stunned') return context.pose('hurt', oneShot(WRAITH_TIMINGS.stunned - enemy.timer, WRAITH_TIMINGS.stunned, 4));
  if (enemy.state === 'chase') return context.pose('run', step(enemy.distance ?? 0, .16) % 6);
  return context.pose('idle', step(visual.idleAge ?? 0, .24) % 4);
}

export function beetlePose(enemy, atlas = beetlePackage.beetle, visual = EMPTY) {
  const direction = shownFacing(enemy, visual);
  const context = poseContext(enemy, atlas, direction);
  if (enemy.hp <= 0) return context.pose('death', oneShot(visual.deathAge ?? 0, .84));
  if (enemy.state === 'windup') return context.pose('windup', oneShot(BEETLE_TIMINGS.windup - enemy.timer, BEETLE_TIMINGS.windup, 5));
  // Key 01 is ground contact; it covers most of the short active window.
  if (enemy.state === 'slam') return context.pose('slam', enemy.timer > BEETLE_TIMINGS.slam * .8 ? 0 : enemy.timer > .03 ? 1 : 2);
  if (enemy.state === 'recover') return context.pose('recover', oneShot(BEETLE_TIMINGS.recover - enemy.timer, BEETLE_TIMINGS.recover, 3));
  // Only a guard break stuns the shell, and only an exposed shell shows its underside.
  if (enemy.state === 'stunned' && enemy.exposed) return context.pose('stunned', step(BEETLE_TIMINGS.exposed - enemy.timer, .16) % 4);
  if (visual.blockAge != null && visual.blockAge < .2) return context.pose('block', visual.blockAge < .08 ? 0 : 1);
  if (visual.flinchAge != null && visual.flinchAge < .22) return context.pose('hurt', oneShot(visual.flinchAge, .22, 4));
  if (enemy.state === 'chase') return context.pose('walk', step(enemy.distance ?? 0, .16) % 6);
  return context.pose('idle', step(visual.idleAge ?? 0, .25) % 4);
}

const SHRINE_TIMES = [0, .1, .24, .4, .62, .9], GATE_TIMES = [0, .08, .22, .38, .54, .7];
const EFFECT_DURATIONS = { impact: .3, warning: .55, healing: .5 };

// A shrine with an id shows its own age (visual.shrineAges); without one, the single shrineAge.
export function worldPose(name, atlas, visual, offset = 0, id = null) {
  if (name === 'brazier-cyan' || name === 'brazier-magenta') {
    return clipPose(atlas, name, step(visual.time + offset, name === 'brazier-cyan' ? .1 : .12) % 6);
  }
  const age = name !== 'shrine' ? visual.gateAge : id == null ? visual.shrineAge : visual.shrineAges?.[id];
  const times = name === 'shrine' ? SHRINE_TIMES : GATE_TIMES;
  let key = 0;
  if (age != null) for (let i = 0; i < times.length; i++) if (age + 1e-9 >= times[i]) key = i;
  return clipPose(atlas, name, key);
}

export function effectPose(name, atlas, age) {
  const duration = EFFECT_DURATIONS[name];
  return age >= duration ? null : clipPose(atlas, name, oneShot(age, duration));
}

// The used shrines by id; before game.shrinesUsed, the road shrine's single flag (shrineUsed).
const usedShrines = game => game.shrinesUsed ?? (game.shrineUsed ? ROAD_SHRINE : EMPTY_LIST);

const ACTOR_TIMERS = [['hurtAge', .22], ['waveAge', .5], ['blockAge', .2], ['flinchAge', .22],
  ['castAge', TECHNIQUE_POSES.cast], ['landAge', TECHNIQUE_POSES.landing], ['riposteAge', TECHNIQUE_POSES.riposte]];
const actorState = () => ({ idleAge: 0, idle: true, facing: null, facingDx: 0, facingDy: 0, deathAge: null, deathFacing: null,
  hurtAge: null, waveAge: null, blockAge: null, flinchAge: null, flash: 0, previousFlash: 0,
  castAge: null, landAge: null, riposteAge: null, gestureFrom: 0, weapon: null, breathAge: null, breathLife: 0, wasRunning: false, runSettle: null, runStop: 0, runDistance: 0, runSpeed: 5.4, runSettleSpeed: 5.4, runFacing: null, runPosition: null, runSyncFrom: 0, runSyncVisual: 0, runSyncTo: null });
const effectLives = { swing: .5, dash: .5, wave: .5, heal: .5, pickup: .35, hurt: .22, damage: .7, impact: .3, death: 1.2,
  'ritual-open': 1.2, 'ritual-destroyed': 1.5, secret: 1, reward: 1.5, block: .3, 'guard-break': .6, slam: .35,
  palm: .25, crane: .4, 'crane-land': .45, deflect: .4, 'deflect-success': .35, 'deflect-whiff': .35, 'shot-fade': .25,
  'shot-destroyed': .3, 'palm-burst': .45, 'relic-wave': .5, 'relic-chain': .3, 'loot-drop': 1.2, 'loot-pickup': .5,
  'level-up': .6, 'last-breath': 1.5 };
// Events that carry their own length: a swing lasts its strike, a flight and a stance their window.
const effectLife = event => event.type === 'swing'
  ? attackCombo(event).duration[clamp(event.index ?? 0, 0, attackCombo(event).duration.length - 1)]
  : event.type === 'crane' ? event.duration ?? effectLives.crane : event.type === 'deflect' ? event.window ?? effectLives.deflect
    : event.type === 'last-breath' ? event.invulnerable ?? effectLives['last-breath'] : effectLives[event.type];
// Technique gestures end when the monk travels on after them, dashes or falls.
const GESTURES = ['castAge', 'landAge', 'riposteAge'];
const EVENT_GESTURES = { palm: 'castAge', 'crane-land': 'landAge', 'deflect-success': 'riposteAge' };
const CANCEL_GESTURES = ['wave', 'hurt', 'swing', 'dash', 'crane', 'deflect'];
function livingRitual(enemies) {
  for (let i = 0; i < enemies.length; i++) if (enemies[i].kind === 'ritual' && enemies[i].hp > 0) return true;
  return false;
}

// Presentation owns no gameplay fields. In particular, defeat stops game.time,
// but it must not freeze the first death drawing or leave a permanent hit tint.
export class PresentationState {
  constructor(game) { this.reset(game); }

  reset(game) {
    this.game = game;
    this.locationRevision = game.locationRevision;
    this.location = game.world;
    this.time = 0;
    this.player = actorState();
    this.hounds = game.enemies.map(body => ({ ...actorState(), ...(game.world && body.hp <= 0
      ? { deathAge: body.kind === 'wraith' ? .9 : .84, deathFacing: facing(body) } : {}) }));
    this.bodies = [...game.enemies];
    this.shrineAge = game.world && game.shrineUsed ? .9 : null;
    // Every shrine used before this location loaded shows fully spent.
    this.shrineAges = Object.fromEntries(game.world ? usedShrines(game).map(id => [id, .9]) : []);
    this.gateAge = game.world && !livingRitual(game.enemies) ? .7 : null;
    this.effects = [];
    this.seenEvents = new WeakSet();
  }

  update(game, dt, mode = 'playing') {
    if (game !== this.game || game.locationRevision !== this.locationRevision || game.world !== this.location) this.reset(game);
    // The equipped family picks the monk's held weapon layer (monkPose), also while the gear panel pauses.
    this.player.weapon = game.inventory?.equipped.weapon?.family ?? null;
    if (mode === 'paused') return 0;
    // Identity follows bodies, not their array slot: reordering must not move a
    // corpse's held pose or hit flash onto a living spirit.
    let changed = this.bodies.length !== game.enemies.length;
    if (!changed) for (let i = 0; i < this.bodies.length; i++) if (this.bodies[i] !== game.enemies[i]) { changed = true; break; }
    if (changed) {
      const states = this.stateScratch ??= new Map();
      for (let i = 0; i < this.bodies.length; i++) states.set(this.bodies[i], this.hounds[i]);
      this.hounds.length = game.enemies.length; this.bodies.length = game.enemies.length;
      for (let i = 0; i < game.enemies.length; i++) {
        this.bodies[i] = game.enemies[i]; this.hounds[i] = states.get(game.enemies[i]) ?? actorState();
      }
      states.clear();
    }
    dt = Math.max(0, dt);
    // Finish the released step on the visual clock only. Actions always cancel it.
    const p = game.player, run = this.player;
    const running = p.moving && p.hp > 0 && !p.attack && p.dashTime <= 0 && !p.technique;
    if (running) {
      if (!run.wasRunning) {
        const stride = MONK_RUN_KEY_DISTANCE * 3;
        if (run.runSettle != null && run.runPosition > p.distance + 1e-9) {
          run.runSyncFrom = p.distance;
          run.runSyncVisual = run.runPosition;
          run.runSyncTo = Math.ceil((p.distance - 1e-9) / stride) * stride;
        } else run.runSyncTo = null;
      }
      // An interrupted settle keeps moving forwards and rejoins the unchanged
      // audio/gameplay contact at the next real half-stride. No persistent offset.
      if (run.runSyncTo != null && p.distance < run.runSyncTo - 1e-9) {
        const progress = clamp((p.distance - run.runSyncFrom) / (run.runSyncTo - run.runSyncFrom), 0, 1);
        run.runPosition = run.runSyncVisual + (run.runSyncTo - run.runSyncVisual) * progress;
      } else { run.runPosition = p.distance; run.runSyncTo = null; }
      const travel = p.distance - run.runDistance;
      if (run.wasRunning && dt > 0 && travel > 0) run.runSpeed = clamp(travel / dt, .5, 16);
      run.runSettle = null;
    } else if (p.hp > 0 && !p.attack && p.dashTime <= 0 && !p.technique) {
      if (run.wasRunning) {
        const stride = MONK_RUN_KEY_DISTANCE * 3;
        run.runSettle = run.runPosition ?? p.distance;
        run.runStop = Math.ceil((run.runSettle - 1e-9) / stride) * stride;
        run.runSettleSpeed = Math.max(run.runSpeed, (run.runStop - run.runSettle) / .16);
      }
      if (run.runSettle != null) {
        run.runSettle = Math.min(run.runStop, run.runSettle + dt * run.runSettleSpeed);
        run.runPosition = run.runSettle;
        if (run.runSettle >= run.runStop - 1e-9) { run.runSettle = null; run.runPosition = null; run.runSyncTo = null; }
      }
    } else { run.runSettle = null; run.runPosition = null; run.runSyncTo = null; }
    run.wasRunning = running;
    run.runDistance = p.distance;
    this.time += dt;
    let live = 0;
    for (let i = 0; i < this.effects.length; i++) {
      const effect = this.effects[i]; effect.age += dt;
      if (effect.age < effect.life) this.effects[live++] = effect;
    }
    this.effects.length = live;
    // Walk the existing arrays directly: no actor tuples or timer tables per frame.
    for (let i = -1; i < game.enemies.length; i++) {
      const body = i < 0 ? game.player : game.enemies[i], state = i < 0 ? this.player : this.hounds[i];
      const duration = i < 0 || body.kind === 'wraith' ? .9 : .84;
      const idle = i < 0 ? !body.moving && !body.attack && body.dashTime <= 0 && !body.technique : body.state === 'idle';
      const locked = i < 0 ? !!body.attack || body.dashTime > 0 || !!body.technique : body.state !== 'idle' && body.state !== 'chase';
      // A committed action holds one heading, so it shows its true quadrant at once.
      if (body.hp > 0) {
        state.facing = locked ? facing(body) : stableFacing(state.facing, body.dx, body.dy);
        state.facingDx = body.dx; state.facingDy = body.dy;
        if (i < 0 && running) state.runFacing = state.facing;
      }
      state.idleAge = idle && state.idle ? state.idleAge + dt : 0;
      state.idle = idle;
      state.flash = Math.max(0, state.flash - dt);
      if (body.hitFlash > state.previousFlash) state.flash = body.hitFlash;
      state.previousFlash = body.hitFlash || 0;
      if (body.hp <= 0) {
        if (state.deathAge == null) { state.deathAge = 0; state.deathFacing = state.facing ?? facing(body); }
        else state.deathAge = Math.min(duration, state.deathAge + dt);
      }
      for (let timer = 0; timer < ACTOR_TIMERS.length; timer++) {
        const pair = ACTOR_TIMERS[timer], name = pair[0], life = pair[1];
        if (state[name] != null) {
          state[name] += dt;
          if (state[name] >= life) state[name] = null;
        }
      }
    }
    if (this.shrineAge != null) this.shrineAge = Math.min(.9, this.shrineAge + dt);
    else if (game.shrineUsed) this.shrineAge = 0;
    for (const id of usedShrines(game)) this.shrineAges[id] = this.shrineAges[id] == null ? 0 : Math.min(.9, this.shrineAges[id] + dt);
    if (this.gateAge != null) this.gateAge = Math.min(.7, this.gateAge + dt);
    else if (game.world ? !livingRitual(game.enemies)
      : game.enemies.length > 0 && game.kills === game.enemies.length) this.gateAge = 0;

    for (const event of game.events) {
      if (this.seenEvents.has(event)) continue;
      this.seenEvents.add(event);
      if (effectLives[event.type]) this.effects.push({ ...event, age: 0, life: effectLife(event) });
      // A shell that is not staggered still reacts: block on the guarded front, flinch elsewhere.
      if ((event.type === 'block' || event.type === 'impact') && event.id != null) {
        let index = -1;
        for (let i = 0; i < game.enemies.length; i++) if (game.enemies[i].id === event.id) { index = i; break; }
        const state = this.hounds[index];
        if (state) {
          state.blockAge = event.type === 'block' ? 0 : null;
          state.flinchAge = event.type === 'impact' ? 0 : null;
        }
      }
      const gesture = EVENT_GESTURES[event.type];
      if (gesture || CANCEL_GESTURES.includes(event.type)) {
        this.player.waveAge = null; this.player.hurtAge = null;
        for (const name of GESTURES) this.player[name] = null;
      }
      if (event.type === 'wave') this.player.waveAge = 0;
      if (event.type === 'hurt') this.player.hurtAge = 0;
      if (gesture) { this.player[gesture] = 0; this.player.gestureFrom = game.player.distance; }
      // «Последний вздох»: the renderer shows its shield while this runs and the monk is invulnerable.
      if (event.type === 'last-breath') { this.player.breathAge = 0; this.player.breathLife = event.invulnerable ?? 1.5; }
    }
    if (game.player.moving || game.player.hp <= 0 || game.player.dashTime > 0) {
      this.player.waveAge = null; this.player.hurtAge = null;
    }
    if (this.player.breathAge != null) {
      this.player.breathAge += dt;
      if (this.player.breathAge >= this.player.breathLife || game.player.hp <= 0) this.player.breathAge = null;
    }
    // A landing frame still moved the monk; only travel after the gesture began cancels it.
    if (game.player.hp <= 0 || game.player.dashTime > 0 || game.player.distance > this.player.gestureFrom + 1e-6) {
      for (const name of GESTURES) this.player[name] = null;
    }
    return dt;
  }
}
