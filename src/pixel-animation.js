import monkPackage from '../assets/game/pixel-v10/monk-side/manifest.json' with { type: 'json' };
import houndPackage from '../assets/game/pixel-v2/hound-world/manifest.json' with { type: 'json' };
import wraithPackage from '../assets/game/pixel-v3/wraith/manifest.json' with { type: 'json' };
import beetlePackage from '../assets/game/pixel-v7/beetle/manifest.json' with { type: 'json' };
import { WRAITH_TIMINGS, BEETLE_TIMINGS } from './campaign.js';
import { MONK_RULES } from './monk-combat.js';

// Screen right is dy - dx and screen down is (dx + dy) / 2 for the fixed +X/+Z isometric camera.
const screenAxes = (dx, dy) => {
  const right = dy - dx, down = (dx + dy) / 2;
  return { right, down, length: Math.hypot(right, down) };
};
// Headings within 20 degrees of screen-horizontal also have a side drawing where an atlas
// authors one (the monk's idle and run). A facing enters the band inside 15 degrees and
// leaves it beyond 25, so a cursor near the edge does not flicker and keyboard diagonals
// (26.6 degrees, the authored SE/NE drawings) never show it. Values are sines.
export const SIDE_BAND = Object.freeze({
  nominal: Math.sin(20 * Math.PI / 180), enter: Math.sin(15 * Math.PI / 180), leave: Math.sin(25 * Math.PI / 180),
});
const facing = body => {
  const { down, length } = screenAxes(body.dx, body.dy);
  return { back: body.dx + body.dy < 0, flip: body.dy - body.dx < 0,
    side: length > 1e-9 && Math.abs(down) < SIDE_BAND.nominal * length };
};
// Pure screen-left/right travel lies exactly on the front/back boundary and pure
// up/down travel on the mirror boundary. A drawing changes only after the heading
// is this far past a boundary, measured as a screen angle (sine of 15 degrees).
export const FACING_HYSTERESIS = Math.sin(15 * Math.PI / 180);
export function stableFacing(previous, dx, dy, band = FACING_HYSTERESIS) {
  if (!previous) return facing({ dx, dy });
  const { right, down, length } = screenAxes(dx, dy);
  if (length < 1e-9) return previous;
  const back = down / length < (previous.back ? band : -band);
  const flip = right / length < (previous.flip ? band : -band);
  const side = Math.abs(down) / length < (previous.side ? SIDE_BAND.leave : SIDE_BAND.enter);
  return back === previous.back && flip === previous.flip && side === !!previous.side ? previous : { back, flip, side };
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

export function clipPose(atlas, name, key, direction = {}) {
  const clip = atlas.clips[name];
  // Clips without a side drawing (attacks, dash, wave, hurt, death) keep the front/back pair.
  const frames = direction.side && clip.side ? clip.side : clip[direction.back ? 'back' : 'front'];
  return { frame: frames[clamp(key, 0, frames.length - 1)], flip: !!direction.flip };
}

export function monkPose(player, atlas = monkPackage.monk, visual = {}) {
  const direction = shownFacing(player, visual);
  const pose = (name, key) => clipPose(atlas, name, key, direction);
  if (player.hp <= 0) return pose('death', oneShot(visual.deathAge ?? 0, .9));
  if (player.dashTime > 0) return pose('dash', oneShot(MONK_RULES.dash.duration - player.dashTime, MONK_RULES.dash.duration));
  if (player.attack) {
    const { index, age } = player.attack;
    const hit = MONK_RULES.combo.hitTime[index], end = MONK_RULES.combo.duration[index];
    // Key 03 is contact. Reserve the last frame before control returns so all six
    // drawings can be shown without extending the simulation's attack duration.
    const boundaries = [0, hit / 2, hit, hit + (end - hit) * .25, hit + (end - hit) * .6, end - 1 / 60];
    const key = boundaries.reduce((current, at, i) => age + 1e-9 >= at ? i : current, 0);
    return pose(`attack${index + 1}`, key);
  }
  if (!player.moving && visual.waveAge != null && visual.waveAge < .5) return pose('wave', oneShot(visual.waveAge, .5));
  if (!player.moving && visual.hurtAge != null && visual.hurtAge < .22) return pose('hurt', oneShot(visual.hurtAge, .22, 4));
  if (player.moving) return pose('run', step(player.distance, MONK_RUN_KEY_DISTANCE) % 6);
  return pose('idle', step(visual.idleAge ?? 0, .2) % 4);
}

export function houndPose(enemy, atlas = houndPackage.hound, visual = {}) {
  const direction = shownFacing(enemy, visual);
  const pose = (name, key) => clipPose(atlas, name, key, direction);
  if (enemy.hp <= 0) return pose('death', oneShot(visual.deathAge ?? 0, .84));
  if (enemy.state === 'windup') return pose('attack', enemy.timer > .275 ? 0 : 1);
  if (enemy.state === 'leap') return pose('attack', enemy.hit || enemy.timer <= .135 ? 3 : 2);
  if (enemy.state === 'recover') return pose('attack', enemy.timer > .35 ? 4 : 5);
  if (enemy.state === 'stunned') return pose('hurt', oneShot(.38 - enemy.timer, .38, 4));
  if (enemy.state === 'chase') return pose('run', step(enemy.distance, .2) % 6);
  return pose('idle', step(visual.idleAge ?? 0, .2) % 4);
}

export function wraithPose(enemy, atlas = wraithPackage.wraith, visual = {}) {
  const direction = shownFacing(enemy, visual);
  const pose = (name, key) => clipPose(atlas, name, key, direction);
  if (enemy.hp <= 0) return pose('death', oneShot(visual.deathAge ?? 0, .9));
  if (enemy.state === 'windup') return pose('attack', oneShot(WRAITH_TIMINGS.windup - enemy.timer, WRAITH_TIMINGS.windup, 4));
  if (enemy.state === 'recover') return pose('attack', 4 + oneShot(WRAITH_TIMINGS.recover - enemy.timer, WRAITH_TIMINGS.recover, 2));
  if (enemy.state === 'stunned') return pose('hurt', oneShot(WRAITH_TIMINGS.stunned - enemy.timer, WRAITH_TIMINGS.stunned, 4));
  if (enemy.state === 'chase') return pose('run', step(enemy.distance ?? 0, .16) % 6);
  return pose('idle', step(visual.idleAge ?? 0, .24) % 4);
}

export function beetlePose(enemy, atlas = beetlePackage.beetle, visual = {}) {
  const direction = shownFacing(enemy, visual);
  const pose = (name, key) => clipPose(atlas, name, key, direction);
  if (enemy.hp <= 0) return pose('death', oneShot(visual.deathAge ?? 0, .84));
  if (enemy.state === 'windup') return pose('windup', oneShot(BEETLE_TIMINGS.windup - enemy.timer, BEETLE_TIMINGS.windup, 5));
  // Key 01 is ground contact; it covers most of the short active window.
  if (enemy.state === 'slam') return pose('slam', enemy.timer > BEETLE_TIMINGS.slam * .8 ? 0 : enemy.timer > .03 ? 1 : 2);
  if (enemy.state === 'recover') return pose('recover', oneShot(BEETLE_TIMINGS.recover - enemy.timer, BEETLE_TIMINGS.recover, 3));
  // Only a guard break stuns the shell, and only an exposed shell shows its underside.
  if (enemy.state === 'stunned' && enemy.exposed) return pose('stunned', step(BEETLE_TIMINGS.exposed - enemy.timer, .16) % 4);
  if (visual.blockAge != null && visual.blockAge < .2) return pose('block', visual.blockAge < .08 ? 0 : 1);
  if (visual.flinchAge != null && visual.flinchAge < .22) return pose('hurt', oneShot(visual.flinchAge, .22, 4));
  if (enemy.state === 'chase') return pose('walk', step(enemy.distance ?? 0, .16) % 6);
  return pose('idle', step(visual.idleAge ?? 0, .25) % 4);
}

export function worldPose(name, atlas, visual, offset = 0) {
  if (name === 'brazier-cyan' || name === 'brazier-magenta') {
    return clipPose(atlas, name, step(visual.time + offset, name === 'brazier-cyan' ? .1 : .12) % 6);
  }
  const age = name === 'shrine' ? visual.shrineAge : visual.gateAge;
  const times = name === 'shrine' ? [0, .1, .24, .4, .62, .9] : [0, .08, .22, .38, .54, .7];
  const key = age == null ? 0 : times.reduce((current, at, i) => age + 1e-9 >= at ? i : current, 0);
  return clipPose(atlas, name, key);
}

export function effectPose(name, atlas, age) {
  const duration = { impact: .3, warning: .55, healing: .5 }[name];
  return age >= duration ? null : clipPose(atlas, name, oneShot(age, duration));
}

const actorState = () => ({ idleAge: 0, idle: true, facing: null, facingDx: 0, facingDy: 0, deathAge: null, deathFacing: null,
  hurtAge: null, waveAge: null, blockAge: null, flinchAge: null, flash: 0, previousFlash: 0 });
const effectLives = { swing: .5, dash: .5, wave: .5, heal: .5, pickup: .35, hurt: .22, damage: .7, impact: .3, death: 1.2,
  'ritual-open': 1.2, 'ritual-destroyed': 1.5, secret: 1, reward: 1.5, block: .3, 'guard-break': .6, slam: .35 };

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
    this.gateAge = game.world && !game.enemies.some(body => body.kind === 'ritual' && body.hp > 0) ? .7 : null;
    this.effects = [];
    this.seenEvents = new WeakSet();
  }

  update(game, dt, mode = 'playing') {
    if (game !== this.game || game.locationRevision !== this.locationRevision || game.world !== this.location) this.reset(game);
    if (mode === 'paused') return 0;
    // Identity follows bodies, not their array slot: reordering must not move a
    // corpse's held pose or hit flash onto a living spirit.
    this.hounds = game.enemies.map(body => {
      const previous = this.bodies.indexOf(body);
      return previous < 0 ? actorState() : this.hounds[previous];
    });
    this.bodies = [...game.enemies];
    dt = Math.max(0, dt);
    this.time += dt;
    for (const effect of this.effects) effect.age += dt;
    this.effects = this.effects.filter(effect => effect.age < effect.life);
    for (const [body, state, duration, idle, locked] of [
      [game.player, this.player, .9, !game.player.moving && !game.player.attack && game.player.dashTime <= 0,
        !!game.player.attack || game.player.dashTime > 0],
      ...game.enemies.map((enemy, i) => [enemy, this.hounds[i], enemy.kind === 'wraith' ? .9 : .84, enemy.state === 'idle',
        enemy.state !== 'idle' && enemy.state !== 'chase']),
    ]) {
      // A committed action holds one heading, so it shows its true quadrant at once.
      if (body.hp > 0) {
        state.facing = locked ? facing(body) : stableFacing(state.facing, body.dx, body.dy);
        state.facingDx = body.dx; state.facingDy = body.dy;
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
      for (const [name, life] of [['hurtAge', .22], ['waveAge', .5], ['blockAge', .2], ['flinchAge', .22]]) {
        if (state[name] != null) {
          state[name] += dt;
          if (state[name] >= life) state[name] = null;
        }
      }
    }
    if (this.shrineAge != null) this.shrineAge = Math.min(.9, this.shrineAge + dt);
    else if (game.shrineUsed) this.shrineAge = 0;
    if (this.gateAge != null) this.gateAge = Math.min(.7, this.gateAge + dt);
    else if (game.world ? !game.enemies.some(e => e.kind === 'ritual' && e.hp > 0)
      : game.enemies.length > 0 && game.kills === game.enemies.length) this.gateAge = 0;

    for (const event of game.events) {
      if (this.seenEvents.has(event)) continue;
      this.seenEvents.add(event);
      if (effectLives[event.type]) this.effects.push({ ...event, age: 0,
        life: event.type === 'swing' ? MONK_RULES.combo.duration[event.index ?? 0] : effectLives[event.type] });
      // A shell that is not staggered still reacts: block on the guarded front, flinch elsewhere.
      if ((event.type === 'block' || event.type === 'impact') && event.id != null) {
        const state = this.hounds[game.enemies.findIndex(body => body.id === event.id)];
        if (state) {
          state.blockAge = event.type === 'block' ? 0 : null;
          state.flinchAge = event.type === 'impact' ? 0 : null;
        }
      }
      if (event.type === 'wave') { this.player.waveAge = 0; this.player.hurtAge = null; }
      if (event.type === 'hurt') { this.player.hurtAge = 0; this.player.waveAge = null; }
      if (event.type === 'swing' || event.type === 'dash') {
        this.player.waveAge = null; this.player.hurtAge = null;
      }
    }
    if (game.player.moving || game.player.hp <= 0 || game.player.dashTime > 0) {
      this.player.waveAge = null; this.player.hurtAge = null;
    }
    return dt;
  }
}
