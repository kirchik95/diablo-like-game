import { MUSIC, decodeTarget, decodeWith } from './music.js';

// Recorded sound effects: barefoot steps, monster voices and weapon swings/contacts.
// scripts/build-sfx.mjs holds their prompts and processing settings (README «Звуки»).
// Target-material impacts and the remaining combat cues stay synthesized in audio.js.
//
//   sound name ─► one decoded variant (not the last one again) ─► buffer source ─► gain ─► SFX bus
//
// Memory: 60 mono AAC files, 0.5 MB to download, 41 s in all. A file stays decoded once loaded:
// 5.3 MB of float samples at the phone's 32 kHz, 7.9 MB at 48 kHz; 18 optional weapon files come after them.
//
// Loading starts on the first frame after the unlock, never in the boot preloader: the steps
// first, then the monster voices, three files at a time. A variant whose file is still loading,
// or failed, is skipped; a sound with no decoded variant stays silent.
export const SFX = { parallel: 3 };

// Variants per sound and the level that puts its files on the SFX bus, in dB. The files reach
// up to -14 dBFS (steps) and -12 dBFS (voices) in their loudest 50 ms. On the bus the steps sit near
// the old synthesized steps (about -32 dB); a hurt cry sits 8 dB under a flesh hit, an attack
// cry where the old windup tone was, a death cry close to the hit.
// Filename-ordered corrections reduce the measured 50 ms RMS spread without changing the files.
const sound = (count, db, variantDb) => ({ count, db, gain: 10 ** (db / 20), variantDb });
const voices = kind => ({
  [`${kind}:notice`]: sound(2, -8), [`${kind}:attack`]: sound(3, -10),
  [`${kind}:hurt`]: sound(3, -14), [`${kind}:death`]: sound(2, -6),
});
// Weapon files may be absent until generated; the combat synth remains their fallback.
const weapon = (family, { hitDb = -11, hitVariantDb } = {}) => ({
  [`weapon:${family}:swing`]: { ...sound(3, -17), optional: true },
  [`weapon:${family}:hit`]: { ...sound(3, hitDb, hitVariantDb), optional: true },
});
export const SOUNDS = {
  'step:grass': sound(5, -18), 'step:earth': sound(5, -17), 'step:stone': sound(5, -18, [0, .4, -3, -3, .6]),
  'step:gravel': sound(5, -19), 'step:leaves': sound(5, -19, [0, 0, 3, 0, 0]), 'step:rug': sound(5, -21, [0, 0, 0, 3, 0]),
  ...voices('hound'), ...voices('wraith'), ...voices('beetle'),
  ...weapon('bare', { hitDb: -8, hitVariantDb: [-.5, 1.1, 0] }),
  ...weapon('knuckles', { hitVariantDb: [1, -.1, -1] }),
  ...weapon('staff', { hitVariantDb: [2.7, -.5, -.2] }),
};
export const SURFACES = ['grass', 'earth', 'stone', 'gravel', 'leaves', 'rug'];

// One literal URL per file: the build hashes each one, and the dev server serves nothing for a
// file until the game fetches it (a URL built from a template becomes 60 eager imports).
const FILES = {
  'weapon:bare:swing': [
    new URL('../assets/game/sfx/weapon-bare-swing-1.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/weapon-bare-swing-2.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/weapon-bare-swing-3.m4a', import.meta.url).href,
  ],
  'weapon:bare:hit': [
    new URL('../assets/game/sfx/weapon-bare-hit-1.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/weapon-bare-hit-2.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/weapon-bare-hit-3.m4a', import.meta.url).href,
  ],
  'weapon:knuckles:swing': [
    new URL('../assets/game/sfx/weapon-knuckles-swing-1.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/weapon-knuckles-swing-2.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/weapon-knuckles-swing-3.m4a', import.meta.url).href,
  ],
  'weapon:knuckles:hit': [
    new URL('../assets/game/sfx/weapon-knuckles-hit-1.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/weapon-knuckles-hit-2.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/weapon-knuckles-hit-3.m4a', import.meta.url).href,
  ],
  'weapon:staff:swing': [
    new URL('../assets/game/sfx/weapon-staff-swing-1.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/weapon-staff-swing-2.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/weapon-staff-swing-3.m4a', import.meta.url).href,
  ],
  'weapon:staff:hit': [
    new URL('../assets/game/sfx/weapon-staff-hit-1.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/weapon-staff-hit-2.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/weapon-staff-hit-3.m4a', import.meta.url).href,
  ],
  'step:grass': [
    new URL('../assets/game/sfx/step-grass-1.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/step-grass-2.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/step-grass-3.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/step-grass-4.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/step-grass-5.m4a', import.meta.url).href,
  ],
  'step:earth': [
    new URL('../assets/game/sfx/step-earth-1.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/step-earth-2.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/step-earth-3.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/step-earth-4.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/step-earth-5.m4a', import.meta.url).href,
  ],
  'step:stone': [
    new URL('../assets/game/sfx/step-stone-1.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/step-stone-2.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/step-stone-3.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/step-stone-4.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/step-stone-5.m4a', import.meta.url).href,
  ],
  'step:gravel': [
    new URL('../assets/game/sfx/step-gravel-1.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/step-gravel-2.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/step-gravel-3.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/step-gravel-4.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/step-gravel-5.m4a', import.meta.url).href,
  ],
  'step:leaves': [
    new URL('../assets/game/sfx/step-leaves-1.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/step-leaves-2.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/step-leaves-3.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/step-leaves-4.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/step-leaves-5.m4a', import.meta.url).href,
  ],
  'step:rug': [
    new URL('../assets/game/sfx/step-rug-1.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/step-rug-2.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/step-rug-3.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/step-rug-4.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/step-rug-5.m4a', import.meta.url).href,
  ],
  'hound:notice': [
    new URL('../assets/game/sfx/hound-notice-1.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/hound-notice-2.m4a', import.meta.url).href,
  ],
  'hound:attack': [
    new URL('../assets/game/sfx/hound-attack-1.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/hound-attack-2.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/hound-attack-3.m4a', import.meta.url).href,
  ],
  'hound:hurt': [
    new URL('../assets/game/sfx/hound-hurt-1.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/hound-hurt-2.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/hound-hurt-3.m4a', import.meta.url).href,
  ],
  'hound:death': [
    new URL('../assets/game/sfx/hound-death-1.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/hound-death-2.m4a', import.meta.url).href,
  ],
  'wraith:notice': [
    new URL('../assets/game/sfx/wraith-notice-1.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/wraith-notice-2.m4a', import.meta.url).href,
  ],
  'wraith:attack': [
    new URL('../assets/game/sfx/wraith-attack-1.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/wraith-attack-2.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/wraith-attack-3.m4a', import.meta.url).href,
  ],
  'wraith:hurt': [
    new URL('../assets/game/sfx/wraith-hurt-1.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/wraith-hurt-2.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/wraith-hurt-3.m4a', import.meta.url).href,
  ],
  'wraith:death': [
    new URL('../assets/game/sfx/wraith-death-1.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/wraith-death-2.m4a', import.meta.url).href,
  ],
  'beetle:notice': [
    new URL('../assets/game/sfx/beetle-notice-1.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/beetle-notice-2.m4a', import.meta.url).href,
  ],
  'beetle:attack': [
    new URL('../assets/game/sfx/beetle-attack-1.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/beetle-attack-2.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/beetle-attack-3.m4a', import.meta.url).href,
  ],
  'beetle:hurt': [
    new URL('../assets/game/sfx/beetle-hurt-1.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/beetle-hurt-2.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/beetle-hurt-3.m4a', import.meta.url).href,
  ],
  'beetle:death': [
    new URL('../assets/game/sfx/beetle-death-1.m4a', import.meta.url).href,
    new URL('../assets/game/sfx/beetle-death-2.m4a', import.meta.url).href,
  ],
};
// 'hound:hurt', variant 2 → assets/game/sfx/hound-hurt-2.m4a.
export const soundUrl = (name, variant) => FILES[name][variant - 1];

export class Samples {
  constructor(context, { coarse = false, sounds = SOUNDS, fetchFile = globalThis.fetch?.bind(globalThis), decode } = {}) {
    this.sounds = sounds; this.fetchFile = fetchFile;
    this.rate = coarse ? MUSIC.phoneRate : null;
    let target = null;
    this.decode = decode ?? ((bytes, rate) => decodeWith(target ??= decodeTarget(context, rate), bytes));
    // Per sound: its decoded variants and the one it played last. Files load in table order.
    this.buffers = Object.create(null); this.last = Object.create(null);
    this.variantGains = new WeakMap();
    this.files = [];
    for (const name in sounds) {
      this.buffers[name] = []; this.last[name] = null;
      for (let n = 1; n <= sounds[name].count; n++) this.files.push({ name, variant: n, url: soundUrl(name, n), state: 'idle' });
    }
    this.next = 0; this.loading = 0;
  }
  has(name) { return name in this.buffers; }
  ready(name) { return (this.buffers[name]?.length ?? 0) > 0; }
  gain(name, buffer = this.last[name]) { return this.sounds[name].gain * (this.variantGains.get(buffer) ?? 1); }

  // Starts files while fewer than SFX.parallel load. Never throws, never retries a failed file.
  load() {
    if (!this.fetchFile) return;
    while (this.loading < SFX.parallel && this.next < this.files.length) this.loadFile(this.files[this.next++]);
  }
  async loadFile(file) {
    this.loading++; file.state = 'loading';
    try {
      const response = await this.fetchFile(file.url);
      if (!response.ok) throw new Error(`${response.status} ${file.url}`);
      const buffer = await this.decode(await response.arrayBuffer(), this.rate);
      const db = this.sounds[file.name].variantDb?.[file.variant - 1] ?? 0;
      this.variantGains.set(buffer, 10 ** (db / 20));
      this.buffers[file.name].push(buffer);
      file.state = 'ready';
    } catch {
      file.state = 'failed';
    } finally {
      this.loading--;
    }
  }

  // A decoded variant, never the one played last while the sound has another. Null while none is decoded.
  pick(name, random) {
    const list = this.buffers[name];
    if (!list?.length) return null;
    let i = Math.min(list.length - 1, Math.floor(random() * list.length));
    if (list.length > 1 && list[i] === this.last[name]) i = (i + 1) % list.length;
    return (this.last[name] = list[i]);
  }
  // Decoded float samples, in bytes.
  get bytes() {
    let total = 0;
    for (const name in this.buffers) for (const buffer of this.buffers[name]) total += buffer.length * buffer.numberOfChannels * 4;
    return total;
  }
}
