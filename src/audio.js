import { MONK_RUN_KEY_DISTANCE } from './pixel-animation.js';
import { Music } from './music.js';

// All sound is synthesized: short layers of oscillators and filtered noise.
//   layers → bus → limiter → master (volume, mute) → speakers
// Gains below are peak levels on the bus; the limiter only catches stacked hits.
const MASTER_VOLUME = .2;

// Live layers by priority. Footsteps give way first when combat crowds the mix.
export const VOICE_LIMITS = { combat: 32, step: 20, crowd: 12 };

// Run cycles have six keys. Feet land on keys `first` and `first + 3`, the
// contact drawings: monk keys 01/04, hound forepaws 03 and hind paws 06,
// beetle tripods 03/06. `key` is the travel per key in pixel-animation.js.
export const GAITS = { monk: { key: MONK_RUN_KEY_DISTANCE, first: 0 }, hound: { key: .2, first: 2 }, beetle: { key: .16, first: 2 } };

// Monster steps share one budget: three at once, five per second refill,
// at most two per frame, only inside the range around the monk.
export const CROWD_STEPS = { range: { hound: 6.5, beetle: 8 }, burst: 3, perSecond: 5, perFrame: 2 };

export const MATERIALS = { hound: 'flesh', wraith: 'spirit', beetle: 'shell', ritual: 'crystal' };

const osc = (type, from, to, duration, gain, extra = {}) => ({ osc: type, from, to, duration, gain, attack: .003, ...extra });
const hiss = (filter, from, to, duration, gain, extra = {}) => ({ noise: filter, from, to, duration, gain, q: .7, attack: .002, ...extra });

// Each cue is a list of layers. Frequencies in Hz, times in seconds.
export const CUES = {
  // Whooshes swell toward the strike frame; the third is longer, lower and pushes air.
  'swing:0': [hiss('bandpass', 900, 2600, .13, .26, { q: 1.3, attack: .05 })],
  'swing:1': [hiss('bandpass', 2800, 1000, .15, .3, { q: 1.1, attack: .06 })],
  'swing:2': [hiss('bandpass', 450, 1700, .26, .39, { q: .8, attack: .1 }), osc('sine', 160, 70, .22, .13, { attack: .07 })],
  // Fleshy thump: a falling triangle body, a dull low smack and a short slap edge.
  'impact:flesh': [osc('triangle', 190, 62, .13, .5), hiss('lowpass', 1100, 280, .09, .42, { q: .8 }),
    hiss('bandpass', 1700, 1700, .025, .22, { q: 1.4, attack: .001 })],
  // Airy and glassy: a breathy hiss, an inharmonic ring (1 : 2.76) and a soft body.
  'impact:spirit': [hiss('bandpass', 3000, 1200, .2, .22, { q: .6, attack: .012 }), osc('sine', 1240, 930, .24, .1),
    osc('sine', 3420, 2600, .14, .055), osc('sine', 240, 120, .07, .22)],
  // Shell crack: a sharp crack, a splinter 12 ms later, a hollow knock and a chitin click.
  'impact:shell': [hiss('bandpass', 3200, 3200, .03, .48, { q: 2.2, attack: .001 }),
    hiss('bandpass', 1900, 1900, .045, .3, { q: 1.8, delay: .012 }), osc('triangle', 140, 75, .12, .42), osc('square', 420, 260, .04, .07)],
  // Crystal: a C6/G6 ring with a high partial, a shatter tick and a low hum.
  'impact:crystal': [osc('sine', 1046.5, 1046.5, .55, .12), osc('sine', 1568, 1568, .42, .085), osc('sine', 2793, 2793, .3, .05),
    hiss('highpass', 4200, 4200, .06, .25), osc('sine', 131, 110, .35, .16)],
  // Heavy hits add a low-end kick; the 220 Hz click lets laptop speakers hear it.
  punch: [osc('sine', 120, 42, .2, .45, { attack: .002 }), osc('triangle', 220, 90, .05, .14, { attack: .001 })],
  // The beetle's guarded front: a dull stone clack.
  block: [osc('square', 520, 380, .05, .1), hiss('bandpass', 2300, 2300, .045, .34, { q: 3 }), osc('triangle', 170, 120, .08, .23)],
  // A cracking burst when the shell opens.
  'guard-break': [hiss('bandpass', 2600, 900, .16, .48, { q: 1.2 }), hiss('bandpass', 1400, 1400, .05, .34, { q: 1.6, delay: .03 }),
    osc('sawtooth', 160, 55, .32, .26, { attack: .008 })],
  // Barefoot steps: brushed blades on grass, a dull thud on packed earth, a crisp slap on stone.
  'step:grass': [hiss('bandpass', 2600, 1500, .08, .09, { attack: .01 }), osc('sine', 95, 60, .05, .05)],
  'step:earth': [osc('triangle', 115, 62, .075, .13), hiss('lowpass', 700, 300, .06, .1)],
  'step:stone': [hiss('bandpass', 2100, 1500, .032, .13, { q: 1.3, attack: .001 }), osc('triangle', 240, 170, .03, .065),
    osc('sine', 120, 85, .04, .065)],
  // Monster feet: a hound's paired soft pads, a beetle's heavy step with a chitin tick.
  'step:hound': [hiss('lowpass', 650, 350, .045, .14), hiss('lowpass', 600, 320, .045, .1, { delay: .035 })],
  'step:beetle': [osc('sine', 72, 44, .13, .11, { attack: .004 }), hiss('bandpass', 380, 380, .09, .055, { q: 1 }),
    hiss('bandpass', 2400, 2400, .015, .025, { q: 3 })],
  dash: [hiss('bandpass', 1700, 1700, .29, .55, { q: .6 }), osc('sine', 250, 650, .24, .15, { attack: .008 })],
  wave: [osc('sine', 80, 30, .6, .8, { attack: .008 }), hiss('bandpass', 650, 650, .45, .5, { q: .6 }),
    osc('sine', 470, 235, .65, .17, { attack: .008 })],
  hurt: [osc('sawtooth', 90, 30, .25, .3, { attack: .008 }), hiss('bandpass', 450, 450, .2, .5, { q: .6 })],
  death: [hiss('bandpass', 270, 270, .5, .55, { q: .6 }), osc('triangle', 80, 25, .4, .45, { attack: .008 })],
  windup: [osc('triangle', 240, 380, .18, .16, { attack: .008 })],
  leap: [hiss('bandpass', 600, 600, .18, .2, { q: .6 })],
  // A heavy ground thud for the slam.
  slam: [osc('triangle', 60, 28, .35, .7, { attack: .008 }), hiss('bandpass', 380, 380, .22, .5, { q: .6 })],
  chime: [293.66, 440, 587.33, 880].map((n, i) => osc('sine', n, n, 1.4, .28, { attack: .008, delay: i * .16 })),
  defeat: [osc('triangle', 130, 40, 1.4, .3, { attack: .008 })],
};
const STEADY = new Set(['chime', 'defeat']);

// Pitch and level per hit: the combo's three strikes, a dash-through and the wave.
const HIT_SHAPE = { combo: [{ pitch: 1, gain: .9 }, { pitch: 1.08, gain: 1 }, { pitch: .86, gain: 1.15 }],
  dash: { pitch: .95, gain: 1.05, punch: .8 }, wave: { pitch: .9, gain: .9, delay: .03, punch: 0 } };
// The wave's own boom carries its low end, so wave hits add no kick.
const punchLevel = event => event.type === 'guard-break' ? .9
  : event.type === 'impact' && event.strength === 'heavy' ? HIT_SHAPE[event.source]?.punch ?? 1 : 0;

const paving = new WeakMap();
// The renderer's ground mask stores grass, soil and stone weights as RGB.
// Without it, the worn path is earth (stone in the courtyard) and the rest grass.
export function surfaceAt(game, x, y, map) {
  if (map) {
    const column = Math.floor((x - map.origin.x) * map.pixelsPerUnit), row = Math.floor((y - map.origin.y) * map.pixelsPerUnit);
    if (column >= 0 && row >= 0 && column < map.width && row < map.height) {
      const i = (row * map.width + column) * 4, grass = map.data[i], earth = map.data[i + 1], stone = map.data[i + 2];
      return stone >= earth && stone >= grass ? 'stone' : earth >= grass ? 'earth' : 'grass';
    }
  }
  const world = game.world;
  if (!world?.paving) return 'stone';
  if (!paving.has(world)) paving.set(world, new Set(world.paving.map(p => `${p.x},${p.y}`)));
  if (!paving.get(world).has(`${Math.round(x)},${Math.round(y)}`)) return 'grass';
  return game.locationId === 'courtyard' ? 'stone' : 'earth';
}

// Counts landed feet the same way the run drawing picks its key.
export function contactIndex(distance, gait) {
  return Math.floor((Math.floor((Math.max(0, distance) + 1e-9) / gait.key) + 3 - gait.first) / 3);
}

export class GameAudio {
  constructor({ AudioContext = globalThis.AudioContext ?? globalThis.webkitAudioContext, random = Math.random, music = Music } = {}) {
    this.AudioContext = AudioContext; this.random = random; this.Music = music;
    this.context = null; this.muted = false;
    this.voiceEnds = []; this.stepGame = null; this.foot = 0;
  }
  unlock() {
    if (!this.context) {
      if (!this.AudioContext) return;
      const context = this.context = new this.AudioContext();
      this.bus = context.createGain();
      // Near-limiter: a single hit passes almost untouched, six at once stay below clipping.
      this.limiter = context.createDynamicsCompressor();
      for (const [name, value] of [['threshold', -4], ['knee', 4], ['ratio', 12], ['attack', .003], ['release', .14]]) {
        this.limiter[name].value = value;
      }
      this.master = context.createGain();
      this.master.gain.value = this.muted ? 0 : MASTER_VOLUME;
      this.bus.connect(this.limiter); this.limiter.connect(this.master); this.master.connect(context.destination);
      this.noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      // Music starts with the first unlock, under the same limiter as the effects.
      if (this.Music) this.music = new this.Music(context, { output: this.bus, noise: this.noise, muted: this.muted });
    }
    this.context.resume().catch(() => {});
  }
  setMuted(value) {
    this.muted = value;
    this.music?.setMuted(value);
    if (this.context) this.master.gain.setTargetAtTime(value ? 0 : MASTER_VOLUME, this.context.currentTime, .03);
  }
  vary(amount) { return 1 + (this.random() * 2 - 1) * amount; }

  // A layer claims a voice until it ends; a full priority class drops it.
  claim(end, priority) {
    const now = this.context.currentTime;
    this.voiceEnds = this.voiceEnds.filter(time => time > now);
    if (this.voiceEnds.length >= VOICE_LIMITS[priority]) return false;
    this.voiceEnds.push(end);
    return true;
  }
  layer(spec, { pitch = 1, gain = 1, delay = 0, priority = 'combat' } = {}) {
    const context = this.context, t = context.currentTime + delay + (spec.delay ?? 0), end = t + spec.duration;
    if (!this.claim(end, priority)) return false;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(.0001, t);
    envelope.gain.linearRampToValueAtTime(Math.max(.0002, spec.gain * gain), t + Math.min(spec.attack, spec.duration / 2));
    envelope.gain.exponentialRampToValueAtTime(.0001, end);
    envelope.connect(this.bus);
    let source, nodes;
    if (spec.osc) {
      source = context.createOscillator(); source.type = spec.osc;
      source.frequency.setValueAtTime(spec.from * pitch, t);
      source.frequency.exponentialRampToValueAtTime(Math.max(1, spec.to * pitch), end);
      source.connect(envelope); nodes = [source, envelope];
      source.start(t);
    } else {
      const filter = context.createBiquadFilter();
      filter.type = spec.noise; filter.Q.value = spec.q;
      filter.frequency.setValueAtTime(spec.from * pitch, t);
      filter.frequency.exponentialRampToValueAtTime(Math.max(1, spec.to * pitch), end);
      source = context.createBufferSource(); source.buffer = this.noise; source.loop = true;
      source.connect(filter); filter.connect(envelope); nodes = [source, filter, envelope];
      // A random read position gives every burst its own grain.
      source.start(t, this.random() * .9);
    }
    source.stop(end + .01);
    source.onended = () => { for (const node of nodes) node.disconnect(); };
    return true;
  }
  // Plays one cue with per-play jitter (±vary in pitch, ±2·vary in level). Returns the layers played.
  cue(name, { pitch = 1, gain = 1, delay = 0, priority = 'combat', vary = STEADY.has(name) ? 0 : .05 } = {}) {
    if (!this.context || this.muted || !CUES[name]) return 0;
    const options = { pitch: pitch * this.vary(vary), gain: gain * this.vary(vary * 2), delay, priority };
    let played = 0;
    for (const spec of CUES[name]) played += this.layer(spec, options);
    return played;
  }

  // Call once per rendered frame with the UI mode. Same-frame events of one kind
  // merge into one louder layer (a wave across six hounds is one flesh hit),
  // then feet land and the music follows the area and the fight.
  frame(game, ground, mode = 'playing') {
    const groups = new Map();
    let punch = 0;
    for (const event of game.events) {
      const kind = event.id != null ? game.enemies.find(e => e.id === event.id)?.kind : undefined;
      const key = event.type === 'impact' || event.type === 'death' ? `${event.type}:${kind}` : event.type;
      const group = groups.get(key);
      if (group) { group.count++; if (event.strength === 'heavy') group.event = event; }
      else groups.set(key, { event, kind, count: 1 });
      punch = Math.max(punch, punchLevel(event));
    }
    for (const { event, kind, count } of groups.values()) this.play(event, { game, kind, count, punch: false });
    // One low-end kick per frame, however many bodies the heavy hit reached.
    if (punch > 0) this.cue('punch', { gain: punch, vary: .03 });
    this.footsteps(game, ground, mode);
    this.music?.update(game, mode);
  }
  play(event, { game, kind, count = 1, punch = true } = {}) {
    kind ??= event.id != null ? game?.enemies.find(e => e.id === event.id)?.kind : undefined;
    const crowd = Math.min(1.6, 1 + .25 * Math.log2(count));
    switch (event.type) {
      case 'swing': this.cue(`swing:${Math.max(0, Math.min(2, event.index ?? 0))}`); break;
      case 'impact': {
        const shape = event.source === 'combo' || !HIT_SHAPE[event.source]
          ? HIT_SHAPE.combo[game?.player.attack?.index ?? (event.strength === 'heavy' ? 2 : 0)] : HIT_SHAPE[event.source];
        const name = `impact:${MATERIALS[kind] ?? 'flesh'}`;
        this.cue(name, { pitch: shape.pitch, gain: shape.gain * crowd, delay: shape.delay ?? 0 });
        // Several bodies at once: a quieter flam 22 ms later reads as many hits.
        if (count > 1) this.cue(name, { pitch: shape.pitch * .94, gain: shape.gain * .4, delay: (shape.delay ?? 0) + .022 });
        if (punch && punchLevel(event) > 0) this.cue('punch', { gain: punchLevel(event), vary: .03 });
        break;
      }
      case 'block': this.cue('block', { gain: crowd }); break;
      case 'guard-break':
        this.cue('guard-break', { gain: crowd });
        if (punch) this.cue('punch', { gain: punchLevel(event), vary: .03 });
        break;
      case 'dash': case 'wave': case 'hurt': case 'windup': case 'leap': case 'slam': case 'defeat':
        this.cue(event.type, { gain: crowd }); break;
      case 'death': this.cue('death', { gain: crowd }); break;
      case 'heal': this.cue('chime'); break;
      // With music running, its victory sting replaces the chime.
      case 'victory': if (!this.music) this.cue('chime'); break;
      default: break;
    }
  }

  // Footfalls follow the drawing's contact keys, never a timer. Dashes, pauses,
  // defeat and menus stay silent; the stride re-syncs after a dash or a new run.
  footsteps(game, ground, mode = 'playing') {
    const p = game.player, live = mode === 'playing' && game.phase === 'playing' && p.hp > 0;
    if (this.stepGame !== game) { this.stepGame = game; this.strides = new WeakMap(); this.dashing = false; }
    const landed = this.landed(p, GAITS.monk), dashing = p.dashTime > 0 || this.dashing;
    this.dashing = p.dashTime > 0;
    if (landed && live && !dashing) {
      this.foot ^= 1;
      const surface = surfaceAt(game, p.x, p.y, typeof ground === 'function' ? ground() : ground);
      // Feet alternate slightly in pitch and weight; steps under a strike stay quiet.
      this.cue(`step:${surface}`, { priority: 'step', vary: .07,
        pitch: this.foot ? 1.03 : .97, gain: (this.foot ? 1 : .88) * (p.attack ? .55 : 1) });
    }
    const now = this.context?.currentTime ?? 0;
    this.crowdTokens = Math.min(CROWD_STEPS.burst,
      (this.crowdTokens ?? CROWD_STEPS.burst) + Math.max(0, now - (this.crowdTime ?? now)) * CROWD_STEPS.perSecond);
    this.crowdTime = now;
    const steps = [];
    for (const e of game.enemies) {
      const gait = GAITS[e.kind];
      if (!gait || !this.landed(e, gait) || !live || e.hp <= 0) continue;
      const range = CROWD_STEPS.range[e.kind], distance = Math.hypot(e.x - p.x, e.y - p.y);
      if (distance < range) steps.push({ kind: e.kind, level: (1 - distance / range) ** 1.5 });
    }
    // The nearest feet win the shared budget.
    steps.sort((a, b) => b.level - a.level);
    for (const step of steps.slice(0, CROWD_STEPS.perFrame)) {
      if (this.crowdTokens < 1) break;
      if (this.cue(`step:${step.kind}`, { priority: 'crowd', vary: .08, gain: step.level })) this.crowdTokens--;
    }
  }
  // True when the body reached a new contact key since the last frame.
  landed(body, gait) {
    const index = contactIndex(body.distance ?? 0, gait), previous = this.strides.get(body);
    this.strides.set(body, index);
    return previous !== undefined && index > previous;
  }
}
