import { MONK_RUN_KEY_DISTANCE } from './pixel-animation.js';
import { Music } from './music.js';
import { Samples } from './sfx.js';

// Sound effects are short layers of oscillators and filtered noise. The monk's steps and the
// monster voices are recorded (sfx.js); music.js plays the recorded music.
//   layers, recorded sounds → bus → limiter → master (volume, mute) → speakers
// Gains below are peak levels on the bus; the limiter only catches stacked hits.
const MASTER_VOLUME = .2;

// Live layers by priority. Footsteps give way first when combat crowds the mix, monster
// voices before the hits.
export const VOICE_LIMITS = { combat: 32, monster: 24, step: 20, crowd: 12 };
// A coarse pointer (a phone) shares one smaller pool, so stacked hits drop
// before they build a node each. The desktop numbers above stay the cap there.
export const MOBILE_VOICE_LIMITS = { combat: 12, monster: 8, step: 6, crowd: 4 };

// Run cycles have six keys. Feet land on keys `first` and `first + 3`, the
// contact drawings: monk keys 01/04, hound forepaws 03 and hind paws 06,
// beetle tripods 03/06. `key` is the travel per key in pixel-animation.js.
export const GAITS = { monk: { key: MONK_RUN_KEY_DISTANCE, first: 0 }, hound: { key: .2, first: 2 }, beetle: { key: .16, first: 2 } };

// Monster steps share one budget: three at once, five per second refill,
// at most two per frame, only inside the range around the monk.
export const CROWD_STEPS = { range: { hound: 6.5, beetle: 8 }, burst: 3, perSecond: 5, perFrame: 2 };

export const MATERIALS = { hound: 'flesh', wraith: 'spirit', beetle: 'shell', ritual: 'crystal' };

// Monster voices (recorded, sfx.js): an alert plays the notice, a windup the attack cry, a hit
// the hurt cry (not when the body dies that frame), a death the death cry. A voice fades with
// distance like the monster steps and is silent past `range`; each kind waits `cooldown`
// seconds before the same cry again. The hurt cry trails the hit, so the strike stays in front.
export const MONSTER_VOICES = { range: 16, cooldown: { notice: 1.2, attack: .3, hurt: .35, death: .15 }, delay: { hurt: .03 } };
const VOICE_NAMES = Object.fromEntries(['hound', 'wraith', 'beetle'].map(kind =>
  [kind, Object.fromEntries(['notice', 'attack', 'hurt', 'death'].map(action => [action, `${kind}:${action}`]))]));

const osc = (type, from, to, duration, gain, extra = {}) => ({ osc: type, from, to, duration, gain, attack: .003, ...extra });
const hiss = (filter, from, to, duration, gain, extra = {}) => ({ noise: filter, from, to, duration, gain, q: .7, attack: .002, ...extra });

// Each cue is a list of layers. Frequencies in Hz, times in seconds.
export const CUES = {
  // Whooshes swell toward the strike frame; the third is longer, lower and pushes air.
  'swing:0': [hiss('bandpass', 900, 2600, .13, .26, { q: 1.3, attack: .05 })],
  'swing:1': [hiss('bandpass', 2800, 1000, .15, .3, { q: 1.1, attack: .06 })],
  'swing:2': [hiss('bandpass', 450, 1700, .26, .39, { q: .8, attack: .1 }), osc('sine', 160, 70, .22, .13, { attack: .07 })],
  // The knuckles' fourth strike: shorter than the third, lower and with more body.
  'swing:3': [hiss('bandpass', 380, 1500, .2, .42, { q: .9, attack: .08 }), osc('sine', 140, 55, .18, .17, { attack: .05 })],
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
  // Monster feet: a hound's paired soft pads, a beetle's heavy step with a chitin tick.
  'step:hound': [hiss('lowpass', 650, 350, .045, .14), hiss('lowpass', 600, 320, .045, .1, { delay: .035 })],
  'step:beetle': [osc('sine', 72, 44, .13, .11, { attack: .004 }), hiss('bandpass', 380, 380, .09, .055, { q: 1 }),
    hiss('bandpass', 2400, 2400, .015, .025, { q: 3 })],
  dash: [hiss('bandpass', 1700, 1700, .29, .55, { q: .6 }), osc('sine', 250, 650, .24, .15, { attack: .008 })],
  wave: [osc('sine', 80, 30, .6, .8, { attack: .008 }), hiss('bandpass', 650, 650, .45, .5, { q: .6 }),
    osc('sine', 470, 235, .65, .17, { attack: .008 })],
  hurt: [osc('sawtooth', 90, 30, .25, .3, { attack: .008 }), hiss('bandpass', 450, 450, .2, .5, { q: .6 })],
  // The ritual source's death; monsters have recorded death cries.
  death: [hiss('bandpass', 270, 270, .5, .55, { q: .6 }), osc('triangle', 80, 25, .4, .45, { attack: .008 })],
  leap: [hiss('bandpass', 600, 600, .18, .2, { q: .6 })],
  // A heavy ground thud for the slam.
  slam: [osc('triangle', 60, 28, .35, .7, { attack: .008 }), hiss('bandpass', 380, 380, .22, .5, { q: .6 })],
  chime: [293.66, 440, 587.33, 880].map((n, i) => osc('sine', n, n, 1.4, .28, { attack: .008, delay: i * .16 })),
  defeat: [osc('triangle', 130, 40, 1.4, .3, { attack: .008 })],
  // «Ладонь духа»: a breathy push that rises; its touch adds a short spirit ping to the hit.
  palm: [hiss('bandpass', 1300, 3400, .14, .28, { q: 1.4, attack: .012 }), osc('sine', 520, 900, .13, .1, { attack: .006 }),
    osc('sine', 1560, 1380, .1, .04, { attack: .006 })],
  'palm:hit': [osc('sine', 1100, 620, .1, .1, { attack: .002 }), hiss('highpass', 3600, 2600, .05, .12)],
  // «Прыжок журавля»: a rising whoosh with a robe flap; the landing is a heavy thud with grit.
  crane: [hiss('bandpass', 500, 1900, .32, .34, { q: .9, attack: .07 }), osc('sine', 170, 400, .24, .1, { attack: .03 }),
    hiss('lowpass', 900, 500, .05, .14, { delay: .02 })],
  'crane-land': [osc('sine', 110, 36, .32, .6, { attack: .002 }), hiss('lowpass', 1500, 280, .24, .45),
    osc('triangle', 240, 95, .06, .16, { attack: .001 })],
  // «Отражение»: a quiet ready tick; a deflected blow rings like struck bronze; an empty stance sighs.
  deflect: [hiss('highpass', 5000, 5000, .04, .1), osc('sine', 1180, 1240, .16, .05, { attack: .004 })],
  'deflect-success': [osc('triangle', 1320, 1250, .32, .17, { attack: .001 }), osc('sine', 3640, 3420, .22, .07, { attack: .001 }),
    hiss('bandpass', 4200, 4200, .035, .42, { q: 2.4, attack: .001 }), osc('sine', 196, 130, .14, .3, { attack: .002 })],
  'deflect-whiff': [hiss('bandpass', 1200, 500, .16, .12, { q: .8, attack: .01 })],
  // The staff knocks a spirit shot out; a marked monster bursts; «Тихий гром» crackles along its chain.
  'shot-destroyed': [hiss('bandpass', 3000, 1400, .1, .2, { q: 1 }), osc('sine', 980, 700, .1, .07)],
  'palm-burst': [osc('sine', 150, 48, .26, .42, { attack: .003 }), hiss('bandpass', 1300, 380, .2, .4, { q: .7 })],
  'relic-chain': [hiss('highpass', 3600, 3600, .06, .16), osc('square', 1700, 600, .07, .04, { attack: .001 })],
  // Loot: a clink on the ground with a shimmer for rare and a rising E chord for a relic; a soft pat into the bag.
  'loot-drop': [osc('triangle', 640, 560, .07, .14, { attack: .001 }), osc('triangle', 960, 900, .05, .08, { attack: .001, delay: .06 }),
    hiss('bandpass', 2600, 2600, .03, .12, { q: 2 })],
  'loot-drop:rare': [osc('sine', 1318.5, 1318.5, .5, .07, { attack: .02, delay: .05 }),
    osc('sine', 1975.5, 1975.5, .4, .05, { attack: .02, delay: .12 })],
  'loot-drop:relic': [659.25, 987.77, 1318.5].map((n, i) => osc('sine', n, n, .8, .09, { attack: .01, delay: .05 + i * .09 })),
  'loot-pickup': [hiss('lowpass', 900, 480, .06, .18), osc('sine', 660, 990, .08, .08, { attack: .004, delay: .03 })],
  // «Последний вздох»: a deep breath in (rising filtered air over a low swell) and a quiet ring as it holds.
  'last-breath': [hiss('bandpass', 320, 1300, .55, .26, { q: .9, attack: .3 }), osc('sine', 110, 165, .6, .22, { attack: .25 }),
    osc('sine', 880, 880, .7, .045, { attack: .05, delay: .3 }), osc('sine', 1318.5, 1318.5, .6, .03, { attack: .05, delay: .36 })],
  // A rising A-major arpeggio over a soft swell.
  'level-up': [...[440, 554.37, 659.25, 880].map((n, i) => osc('sine', n, n, .9, .2, { attack: .006, delay: i * .07 })),
    hiss('bandpass', 2000, 4200, .6, .06, { attack: .2 })],
};
const OSCILLATOR_TYPES = [...new Set(Object.values(CUES).flat().map(layer => layer.osc).filter(Boolean))];
const STEADY = new Set(['chime', 'defeat', 'level-up', 'loot-drop:rare', 'loot-drop:relic']);

// One white-noise buffer for every context. A fixed generator, not Math.random,
// so a second AudioContext copies it instead of filling another second of samples.
let noiseSamples = null;
let noiseBuilds = 0;
function sharedNoise(length) {
  if (!noiseSamples || noiseSamples.length !== length) {
    const data = new Float32Array(length);
    let a = 0x6d6f6e6b;
    for (let i = 0; i < length; i++) {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      data[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296 * 2 - 1;
    }
    noiseSamples = data;
    noiseBuilds++;
  }
  return noiseSamples;
}
export function noiseBuildCount() { return noiseBuilds; }

function coarsePointer(matchMedia) {
  try { return typeof matchMedia === 'function' && !!matchMedia('(pointer: coarse)')?.matches; }
  catch { return false; }
}
// Group keys repeat every fight. The first frame builds them; later frames reuse the string.
// Hits, deaths, alerts and windups group per monster kind, so each kind keeps its own voice.
const KIND_KEYS = Object.create(null);
for (const type of ['impact', 'death', 'alert', 'windup']) KIND_KEYS[type] = Object.create(null);
const LOOT_KEYS = Object.create(null);
function groupKey(type, kind, rarity) {
  const bucket = KIND_KEYS[type];
  if (bucket) {
    const id = kind === undefined ? '\0' : kind;
    return bucket[id] || (bucket[id] = `${type}:${kind}`);
  }
  if (type === 'loot-drop') {
    const id = rarity === undefined ? '\0' : rarity;
    return LOOT_KEYS[id] || (LOOT_KEYS[id] = `loot-drop:${rarity}`);
  }
  return type;
}
function enemyKind(enemies, id) {
  if (!enemies || id == null) return undefined;
  for (let i = 0; i < enemies.length; i++) if (enemies[i].id === id) return enemies[i].kind;
  return undefined;
}
// A wanderer's alert and a hound's windup carry no id: the living body where the event happened.
function kindAt(enemies, x, y) {
  if (!enemies || x == null) return undefined;
  let kind, best = 1.5;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i], distance = Math.hypot(e.x - x, e.y - y);
    if (e.hp > 0 && distance < best) { best = distance; kind = e.kind; }
  }
  return kind;
}
// Events whose monster may only be known by where it stands.
const PLACED_EVENTS = new Set(['alert', 'windup']);
function writeEnvelope(param, t, peak, attack, end, reuse) {
  if (reuse) param.cancelScheduledValues(t);
  param.setValueAtTime(.0001, t);
  param.linearRampToValueAtTime(peak, t + attack);
  param.exponentialRampToValueAtTime(.0001, end);
}
function writeSweep(param, t, from, to, end, reuse) {
  if (reuse) param.cancelScheduledValues(t);
  param.setValueAtTime(from, t);
  param.exponentialRampToValueAtTime(to, end);
}
// Technique and loot events that play their own cue.
const OWN_CUES = new Set(['palm', 'crane', 'crane-land', 'deflect', 'deflect-success', 'deflect-whiff', 'shot-destroyed',
  'palm-burst', 'relic-chain', 'loot-pickup', 'level-up', 'last-breath']);

// Pitch and level per hit: the series' strikes (a fourth for the knuckles' finisher), a dash-through,
// the wave and the techniques.
const HIT_SHAPE = { combo: [{ pitch: 1, gain: .9 }, { pitch: 1.08, gain: 1 }, { pitch: .86, gain: 1.15 }, { pitch: .78, gain: 1.25 }],
  dash: { pitch: .95, gain: 1.05, punch: .8 }, wave: { pitch: .9, gain: .9, delay: .03, punch: 0 },
  palm: { pitch: 1.12, gain: .8, punch: .5 }, crane: { pitch: .9, gain: 1.05, punch: .6 }, deflect: { pitch: .94, gain: 1.1, punch: .7 },
  relic: { pitch: 1.04, gain: .7 } };
// The swing and hit shape of a strike: light strikes alternate 0 and 1, a finisher is 2 (3 for the
// knuckles' fourth). Events without a strength keep their index.
const strikeShape = (index = 0, strength) => strength === 'heavy' ? Math.min(3, Math.max(2, index))
  : strength ? index % 2 : Math.max(0, Math.min(3, index));
// Heavier weapons swing lower.
const SWING_PITCH = { knuckles: 1.1, staff: .82 };
const WEAPON_AUDIO = Object.fromEntries(['bare', 'knuckles', 'staff'].map(family =>
  [family, { swing: `weapon:${family}:swing`, hit: `weapon:${family}:hit` }]));
function weaponAudio(event, game) {
  // Attack snapshots survive an inventory change during a strike; {} is explicitly bare-handed.
  const family = event.weapon ?? (game?.player.attack ? game.player.attack.weapon : game?.inventory?.equipped?.weapon?.family);
  return WEAPON_AUDIO[family === 'staff' || family === 'knuckles' ? family : 'bare'];
}
// The wave's own boom carries its low end, so wave hits add no kick.
const punchLevel = event => event.type === 'guard-break' ? .9
  : event.type === 'impact' && event.strength === 'heavy' ? HIT_SHAPE[event.source]?.punch ?? 1 : 0;

// Walkable ground art lies over the ground mask: the camp rug, gravel and rubble, leaf litter,
// stepping slabs, moss and grave earth. Each covers a box around its contact point.
export const DECAL_SURFACES = {
  'woven-carpet': 'rug', 'gravel-path': 'gravel', 'rubble-scatter': 'gravel',
  'leaf-litter': 'leaves', 'fallen-olives': 'leaves', 'pruned-branches': 'leaves',
  'stepping-slabs': 'stone', 'flagstones-broken': 'stone', 'flagstone-cracks': 'stone', 'ritual-plinth': 'stone',
  'moss-patch': 'grass', 'moss-graves': 'grass', 'grave-ash': 'earth', 'grave-plot-x': 'earth', 'grave-plot-y': 'earth',
};
const decals = new WeakMap();
function decalAt(world, x, y) {
  if (!world?.zones) return null;
  let list = decals.get(world);
  if (!list) {
    list = [];
    for (const zone of world.zones) for (const p of zone.setDressing ?? []) {
      const surface = DECAL_SURFACES[p.kind];
      if (surface && p.layer === 'ground' && p.contact && p.area) {
        list.push({ surface, x: p.contact.x, y: p.contact.y, halfWidth: p.area.halfWidth, halfDepth: p.area.halfDepth });
      }
    }
    decals.set(world, list);
  }
  for (let i = 0; i < list.length; i++) {
    const d = list[i];
    if (Math.abs(x - d.x) < d.halfWidth && Math.abs(y - d.y) < d.halfDepth) return d.surface;
  }
  return null;
}

const paving = new WeakMap();
// Ground art first. Then the renderer's ground mask, which stores grass, soil and stone weights
// as RGB. Without it, the worn path is earth (stone in the courtyard) and the rest grass.
export function surfaceAt(game, x, y, map) {
  const decal = decalAt(game.world, x, y);
  if (decal) return decal;
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
  constructor({ AudioContext = globalThis.AudioContext ?? globalThis.webkitAudioContext, random = Math.random, music = Music,
    samples = Samples, matchMedia = globalThis.matchMedia } = {}) {
    this.AudioContext = AudioContext; this.random = random; this.Music = music; this.Samples = samples;
    // Independent cosmetic variation: recorded weapon layers must not advance other cues' RNG.
    let weaponSeed = 0x77656170;
    this.weaponRandom = () => {
      weaponSeed = (Math.imul(weaponSeed, 1664525) + 1013904223) >>> 0;
      return weaponSeed / 4294967296;
    };
    this.context = null; this.muted = false;
    this.coarse = coarsePointer(matchMedia);
    this.limits = this.coarse ? MOBILE_VOICE_LIMITS : VOICE_LIMITS;
    this.voiceEnds = []; this.live = []; this.gainPool = []; this.filterPool = [];
    // Counterfactual legacy admission keeps RNG/cooldowns stable when optional weapon voices fill the real cap.
    this.variationEnds = []; this.audibleLast = Object.create(null); this.variationPlayed = false;
    this.variationClaims = 0; this.variationCuePlayed = 0;
    // Phones keep a handful of running voices and retrigger them. Desktops still
    // build a source per layer (tests count those starts) and only reuse the
    // gain and filter, which cannot be restarted once stopped.
    this.slots = this.coarse ? [] : null;
    this.groups = []; this.stepSlots = [];
    this.tune = { pitch: 1, gain: 1, delay: 0, priority: 'combat' };
    this.playOpts = { game: null, kind: undefined, count: 1, punch: false, dying: null };
    this.stepGame = null; this.foot = 0;
    // Monster kinds that die this frame, and when each cry may play again.
    this.dying = new Set(); this.voiceUntil = Object.create(null);
  }
  unlock() {
    if (!this.context) {
      if (!this.AudioContext) return;
      const context = this.context = new this.AudioContext();
      // iOS drops the gesture if resume() follows the noise fill below.
      const resume = context.resume();
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
      this.noise.getChannelData(0).set(sharedNoise(this.noise.length));
      // Prepare native waveform tables during unlock, before the first fight.
      // The silent, unstarted slot is reused by the normal mobile voice pool.
      if (this.coarse) {
        const slot = this.addSlot();
        for (const type of OSCILLATOR_TYPES) slot.osc.type = type;
        slot.osc.type = 'sine';
      }
      // Music starts with the first unlock, under the same limiter as the effects. Its files load from the first frame on.
      if (this.Music) this.music = new this.Music(context, { output: this.bus, muted: this.muted, coarse: this.coarse });
      // The recorded effects load from the first frame on too; a phone decodes them at 32 kHz.
      if (this.Samples) this.samples = new this.Samples(context, { coarse: this.coarse });
      resume.catch(() => {});
    }
    else this.context.resume().catch(() => {});
  }
  setMuted(value) {
    this.muted = value;
    this.music?.setMuted(value);
    if (this.context) this.master.gain.setTargetAtTime(value ? 0 : MASTER_VOLUME, this.context.currentTime, .03);
  }
  vary(amount) { return 1 + (this.random() * 2 - 1) * amount; }

  // Drop finished one-shots and hand their gain and filter back. In-place, so a
  // busy frame does not allocate a new list.
  compactVoices(now = this.context.currentTime, ends = this.voiceEnds) {
    let n = 0;
    for (let i = 0; i < ends.length; i++) if (ends[i] > now) ends[n++] = ends[i];
    ends.length = n;
  }
  reclaim(now = this.context.currentTime) {
    const live = this.live;
    let n = 0;
    for (let i = 0; i < live.length; i++) {
      const voice = live[i];
      if (!voice.done && voice.end <= now) this.finishVoice(voice);
      if (!voice.done) live[n++] = voice;
    }
    live.length = n;
  }
  finishVoice(voice) {
    if (voice.done) return;
    voice.done = true;
    voice.source.onended = null;
    voice.source.disconnect();
    voice.env.disconnect();
    if (voice.filter) voice.filter.disconnect();
    this.gainPool.push(voice.env);
    if (voice.filter) this.filterPool.push(voice.filter);
  }
  // A layer claims a voice until it ends; a full priority class drops it.
  claim(end, priority) {
    this.compactVoices();
    if (this.voiceEnds.length >= this.limits[priority]) return false;
    this.voiceEnds.push(end);
    return true;
  }
  claimVariation(end, priority) {
    this.compactVoices(this.context.currentTime, this.variationEnds);
    if (this.variationEnds.length >= this.limits[priority]) return false;
    this.variationEnds.push(end);
    this.variationClaims = (this.variationClaims + 1) >>> 0;
    return true;
  }
  // A phone slot: oscillator and noise stay running; a hit only retunes them.
  addSlot() {
    const context = this.context;
    const env = context.createGain();
    env.gain.value = .0001;
    env.connect(this.bus);
    const osc = context.createOscillator();
    const filter = context.createBiquadFilter();
    const noise = context.createBufferSource();
    noise.buffer = this.noise; noise.loop = true; noise.connect(filter);
    const slot = { env, osc, filter, noise, busyUntil: -Infinity, oscOn: false, noiseOn: false, mode: '',
      offset: (this.slots.length + 1) * .137 % .9 };
    this.slots.push(slot);
    return slot;
  }
  takeSlot(now) {
    const slots = this.slots;
    for (let i = 0; i < slots.length; i++) if (slots[i].busyUntil <= now) return slots[i];
    if (slots.length < this.limits.combat) return this.addSlot();
    return null;
  }
  triggerSlot(slot, spec, pitch, gain, t, end) {
    const peak = Math.max(.0002, spec.gain * gain);
    const attack = Math.min(spec.attack, spec.duration / 2);
    writeEnvelope(slot.env.gain, t, peak, attack, end, true);
    if (spec.osc) {
      if (slot.mode !== 'osc') {
        if (slot.mode === 'noise') slot.filter.disconnect();
        slot.osc.connect(slot.env);
        slot.mode = 'osc';
      }
      slot.osc.type = spec.osc;
      writeSweep(slot.osc.frequency, t, spec.from * pitch, Math.max(1, spec.to * pitch), end, true);
      if (!slot.oscOn) { slot.osc.start(t); slot.oscOn = true; }
    } else {
      if (slot.mode !== 'noise') {
        if (slot.mode === 'osc') slot.osc.disconnect();
        slot.filter.connect(slot.env);
        slot.mode = 'noise';
      }
      slot.filter.type = spec.noise; slot.filter.Q.value = spec.q;
      writeSweep(slot.filter.frequency, t, spec.from * pitch, Math.max(1, spec.to * pitch), end, true);
      if (!slot.noiseOn) { slot.noise.start(t, slot.offset); slot.noiseOn = true; }
    }
    slot.busyUntil = end;
  }
  fireOneShot(spec, pitch, gain, t, end, noiseOffset) {
    const context = this.context;
    let env = this.gainPool.pop();
    const reuseEnv = !!env;
    if (!env) env = context.createGain();
    const peak = Math.max(.0002, spec.gain * gain);
    const attack = Math.min(spec.attack, spec.duration / 2);
    writeEnvelope(env.gain, t, peak, attack, end, reuseEnv);
    env.connect(this.bus);
    let source, filter = null;
    if (spec.osc) {
      source = context.createOscillator(); source.type = spec.osc;
      writeSweep(source.frequency, t, spec.from * pitch, Math.max(1, spec.to * pitch), end, false);
      source.connect(env);
      source.start(t);
    } else {
      filter = this.filterPool.pop();
      const reuseFilter = !!filter;
      if (!filter) filter = context.createBiquadFilter();
      filter.type = spec.noise; filter.Q.value = spec.q;
      writeSweep(filter.frequency, t, spec.from * pitch, Math.max(1, spec.to * pitch), end, reuseFilter);
      source = context.createBufferSource(); source.buffer = this.noise; source.loop = true;
      source.connect(filter); filter.connect(env);
      // A random read position gives every burst its own grain.
      source.start(t, noiseOffset ?? this.random() * .9);
    }
    source.stop(end + .01);
    const voice = { source, env, filter, end, done: false };
    source.onended = () => this.finishVoice(voice);
    this.live.push(voice);
  }
  layer(spec, { pitch = 1, gain = 1, delay = 0, priority = 'combat' } = {}) {
    const context = this.context, t = context.currentTime + delay + (spec.delay ?? 0), end = t + spec.duration;
    if (!this.claimVariation(end, priority)) return false;
    const noiseOffset = spec.noise && !this.slots ? this.random() * .9 : undefined;
    if (!this.claim(end, priority)) return false;
    // The limiter's voice cap already refused this layer: nothing above claim()
    // builds a node. A phone retriggers a warm slot; a desktop builds a source
    // and reuses the gain and filter from the last time this shape ended.
    if (this.slots) {
      const slot = this.takeSlot(context.currentTime);
      if (slot) { this.triggerSlot(slot, spec, pitch, gain, t, end); return true; }
    }
    this.fireOneShot(spec, pitch, gain, t, end, noiseOffset);
    return true;
  }
  // Plays one cue with per-play jitter (±vary in pitch, ±2·vary in level). Returns the layers played.
  cue(name, { pitch = 1, gain = 1, delay = 0, priority = 'combat', vary = STEADY.has(name) ? 0 : .05 } = {}) {
    this.variationCuePlayed = 0;
    if (!this.context || this.muted || !CUES[name]) return 0;
    const tune = this.tune;
    tune.pitch = pitch * this.vary(vary); tune.gain = gain * this.vary(vary * 2); tune.delay = delay; tune.priority = priority;
    this.reclaim();
    this.compactVoices();
    this.compactVoices(this.context.currentTime, this.variationEnds);
    // Every layer would be dropped, so don't walk the cue or build its graph.
    if (this.variationEnds.length >= this.limits[priority]) return 0;
    const specs = CUES[name];
    const before = this.variationClaims;
    let played = 0;
    for (let i = 0; i < specs.length; i++) played += this.layer(specs[i], tune);
    this.variationCuePlayed = (this.variationClaims - before) >>> 0;
    return played;
  }
  // Plays one recorded sound (sfx.js) with the same jitter and voice cap as a cue: one buffer
  // source through a pooled gain. Returns 1, or 0 when it is muted, capped or not decoded yet.
  sound(name, { pitch = 1, gain = 1, delay = 0, priority = 'combat', vary = .05, random = this.random } = {}) {
    this.variationPlayed = false;
    const samples = this.samples;
    if (!this.context || this.muted || !samples?.has(name)) return 0;
    this.reclaim();
    this.compactVoices();
    this.compactVoices(this.context.currentTime, this.variationEnds);
    const legacy = random === this.random, budget = legacy ? this.variationEnds : this.voiceEnds;
    if (budget.length >= this.limits[priority]) return 0;
    let buffer = samples.pick(name, random);
    if (!buffer) return 0;
    const context = this.context, rate = pitch * (1 + (random() * 2 - 1) * vary),
      variedGain = gain * (1 + (random() * 2 - 1) * vary * 2);
    const t = context.currentTime + delay;
    if (legacy) {
      this.variationPlayed = this.claimVariation(t + buffer.duration / rate, priority);
      if (!this.variationPlayed) return 0;
    }
    // A virtually selected but dropped cue must not make the next audible cue repeat.
    const list = samples.buffers?.[name];
    if (buffer === this.audibleLast[name] && list?.length > 1) buffer = list[(list.indexOf(buffer) + 1) % list.length];
    const end = t + buffer.duration / rate, level = variedGain * samples.gain(name, buffer);
    if (!this.claim(end, priority)) return 0;
    let env = this.gainPool.pop();
    if (env) env.gain.cancelScheduledValues(t);
    else env = context.createGain();
    env.gain.setValueAtTime(level, t);
    env.connect(this.bus);
    const source = context.createBufferSource();
    source.buffer = buffer; source.playbackRate.value = rate;
    source.connect(env);
    source.start(t);
    source.stop(end);
    const voice = { source, env, filter: null, end, done: false };
    source.onended = () => this.finishVoice(voice);
    this.live.push(voice);
    this.audibleLast[name] = buffer;
    return 1;
  }
  weaponSound(name, { pitch = 1, gain = 1 } = {}) {
    if (!this.samples?.ready?.(name)) return 0;
    return this.sound(name, { pitch, gain, random: this.weaponRandom });
  }
  // One monster cry: `action` is notice, attack, hurt or death; `at` is where it happened.
  voice(game, kind, action, at, crowd = 1) {
    const name = VOICE_NAMES[kind]?.[action];
    if (!name || !this.context) return 0;
    const now = this.context.currentTime;
    if ((this.voiceUntil[name] ?? -Infinity) > now) return 0;
    const p = game?.player, distance = p && at?.x != null ? Math.hypot(at.x - p.x, at.y - p.y) : 0;
    if (distance >= MONSTER_VOICES.range) return 0;
    const played = this.sound(name, { priority: 'monster', delay: MONSTER_VOICES.delay[action] ?? 0,
      gain: (1 - distance / MONSTER_VOICES.range) ** 1.5 * Math.min(1.25, crowd) });
    if (played || this.variationPlayed) this.voiceUntil[name] = now + MONSTER_VOICES.cooldown[action];
    return played;
  }

  // Call once per rendered frame with the UI mode. Same-frame events of one kind
  // merge into one louder layer (a wave across six hounds is one flesh hit),
  // then feet land and the music follows the area and the fight.
  frame(game, ground, mode = 'playing') {
    if (this.context) this.reclaim();
    const events = game.events, enemies = game.enemies, list = this.groups, dying = this.dying;
    let n = 0, punch = 0;
    dying.clear();
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      let kind = enemyKind(enemies, event.id);
      if (kind === undefined && PLACED_EVENTS.has(event.type)) kind = event.kind ?? kindAt(enemies, event.x, event.y);
      if (event.type === 'death' && kind !== undefined) dying.add(kind);
      const key = groupKey(event.type, kind, event.type === 'loot-drop' ? event.item?.rarity : undefined);
      let group = null;
      for (let g = 0; g < n; g++) if (list[g].key === key) { group = list[g]; break; }
      if (group) { group.count++; if (event.strength === 'heavy') group.event = event; }
      else {
        group = list[n] || (list[n] = { key: '', event: null, kind: undefined, count: 0 });
        group.key = key; group.event = event; group.kind = kind; group.count = 1;
        n++;
      }
      const hit = punchLevel(event);
      if (hit > punch) punch = hit;
    }
    const opts = this.playOpts;
    opts.game = game; opts.punch = false; opts.dying = dying;
    for (let g = 0; g < n; g++) {
      opts.kind = list[g].kind; opts.count = list[g].count;
      this.play(list[g].event, opts);
    }
    // One low-end kick per frame, however many bodies the heavy hit reached.
    if (punch > 0) this.cue('punch', { gain: punch, vary: .03 });
    this.footsteps(game, ground, mode);
    this.music?.update(game, mode);
    this.samples?.load();
  }
  play(event, { game, kind, count = 1, punch = true, dying = null } = {}) {
    kind ??= enemyKind(game?.enemies, event.id);
    const crowd = Math.min(1.6, 1 + .25 * Math.log2(count));
    switch (event.type) {
      case 'swing': {
        const index = strikeShape(event.index, event.strength), weapon = weaponAudio(event, game);
        if (this.weaponSound(weapon.swing, { pitch: HIT_SHAPE.combo[index].pitch, gain: HIT_SHAPE.combo[index].gain })) {
          // Reserve the legacy swing's layers/draws even though one recording replaces them.
          this.random(); this.random();
          for (const spec of CUES[`swing:${index}`]) {
            const end = this.context.currentTime + (spec.delay ?? 0) + spec.duration;
            if (this.claimVariation(end, 'combat') && spec.noise && !this.slots) this.random();
          }
        } else this.cue(`swing:${index}`, { pitch: SWING_PITCH[event.weapon] ?? 1 });
        break;
      }
      case 'impact': {
        const shape = event.source === 'combo' || !HIT_SHAPE[event.source]
          ? HIT_SHAPE.combo[strikeShape(game?.player.attack?.index ?? (event.strength === 'heavy' ? 2 : 0), event.strength)]
          : HIT_SHAPE[event.source];
        const name = `impact:${MATERIALS[kind] ?? 'flesh'}`;
        this.cue(name, { pitch: shape.pitch, gain: shape.gain * crowd, delay: shape.delay ?? 0 });
        // Several bodies at once: a quieter flam 22 ms later reads as many hits.
        if (count > 1) this.cue(name, { pitch: shape.pitch * .94, gain: shape.gain * .4, delay: (shape.delay ?? 0) + .022 });
        if (event.source === 'palm' && event.strength !== 'heavy') this.cue('palm:hit', { gain: crowd });
        if (punch && punchLevel(event) > 0) this.cue('punch', { gain: punchLevel(event), vary: .03 });
        if (!dying?.has(kind)) this.voice(game, kind, 'hurt', event);
        // Only physical combo contacts add a weapon layer. Material, techniques and hurt stay first.
        if (event.source === 'combo') this.weaponSound(weaponAudio(event, game).hit, { pitch: shape.pitch,
          gain: Math.min(1.25, shape.gain * crowd) });
        break;
      }
      case 'block':
        this.cue('block', { gain: crowd });
        if (event.source === 'combo') this.weaponSound(weaponAudio(event, game).hit, { gain: Math.min(1.25, crowd) });
        break;
      case 'guard-break':
        this.cue('guard-break', { gain: crowd });
        if (punch) this.cue('punch', { gain: punchLevel(event), vary: .03 });
        break;
      case 'dash': case 'wave': case 'hurt': case 'leap': case 'slam': case 'defeat':
        this.cue(event.type, { gain: crowd }); break;
      case 'alert': this.voice(game, kind, 'notice', event, crowd); break;
      case 'windup': this.voice(game, kind, 'attack', event, crowd); break;
      case 'death':
        if (VOICE_NAMES[kind]) this.voice(game, kind, 'death', event, crowd);
        else this.cue('death', { gain: crowd });
        break;
      // The staff relic's small wave: the wave boom, quieter and higher.
      case 'relic-wave': this.cue('wave', { gain: .45 * crowd, pitch: 1.25 }); break;
      case 'loot-drop': this.cue('loot-drop', { gain: crowd }); this.cue(`loot-drop:${event.item?.rarity}`); break;
      case 'heal': case 'victory': this.cue('chime'); break;
      default: if (OWN_CUES.has(event.type)) this.cue(event.type, { gain: crowd }); break;
    }
  }

  // Footfalls follow the drawing's contact keys, never a timer. Dashes, pauses,
  // defeat and menus stay silent; the stride re-syncs after a dash or a new run.
  footsteps(game, ground, mode = 'playing') {
    const p = game.player, live = mode === 'playing' && game.phase === 'playing' && p.hp > 0;
    if (this.stepGame !== game) { this.stepGame = game; this.strides = new WeakMap(); this.dashing = false; }
    const landed = this.landed(p, GAITS.monk), dashing = p.dashTime > 0 || p.technique?.id === 'crane' || this.dashing;
    this.dashing = p.dashTime > 0 || p.technique?.id === 'crane';
    if (landed && live && !dashing) {
      this.foot ^= 1;
      const surface = surfaceAt(game, p.x, p.y, typeof ground === 'function' ? ground() : ground);
      // Feet alternate slightly in pitch and weight; steps under a strike stay quiet.
      this.sound(`step:${surface}`, { priority: 'step',
        pitch: this.foot ? 1.03 : .97, gain: (this.foot ? 1 : .88) * (p.attack ? .55 : 1) });
    }
    const now = this.context?.currentTime ?? 0;
    this.crowdTokens = Math.min(CROWD_STEPS.burst,
      (this.crowdTokens ?? CROWD_STEPS.burst) + Math.max(0, now - (this.crowdTime ?? now)) * CROWD_STEPS.perSecond);
    this.crowdTime = now;
    const steps = this.stepSlots, enemies = game.enemies;
    let stepCount = 0;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i], gait = GAITS[e.kind];
      if (!gait || !this.landed(e, gait) || !live || e.hp <= 0) continue;
      const range = CROWD_STEPS.range[e.kind], distance = Math.hypot(e.x - p.x, e.y - p.y);
      if (distance < range) {
        const slot = steps[stepCount] || (steps[stepCount] = { kind: '', level: 0 });
        slot.kind = e.kind; slot.level = (1 - distance / range) ** 1.5;
        stepCount++;
      }
    }
    // The nearest feet win the shared budget. The top of the list, no copy.
    const keep = stepCount < CROWD_STEPS.perFrame ? stepCount : CROWD_STEPS.perFrame;
    for (let i = 0; i < keep; i++) {
      let best = i;
      for (let j = i + 1; j < stepCount; j++) if (steps[j].level > steps[best].level) best = j;
      if (best !== i) { const swap = steps[i]; steps[i] = steps[best]; steps[best] = swap; }
    }
    for (let i = 0; i < keep; i++) {
      if (this.crowdTokens < 1) break;
      if (this.cue(`step:${steps[i].kind}`, { priority: 'crowd', vary: .08, gain: steps[i].level }) || this.variationCuePlayed) this.crowdTokens--;
    }
  }
  // True when the body reached a new contact key since the last frame.
  landed(body, gait) {
    const index = contactIndex(body.distance ?? 0, gait), previous = this.strides.get(body);
    this.strides.set(body, index);
    return previous !== undefined && index > previous;
  }
}
