// Adaptive background music in an SNES-era adventure style, synthesized like
// the sound effects. One 32-bar score loops forever; the game only moves layer gains.
//
//   camp ───┐  lullaby, G major: triangle "ocarina", rocking harp, soft triangle bass
//   road ───┤  march, D Mixolydian: 25 % pulse lead, harp answers, triangle bass, noise drums
//   court ──┼─► music bus (level, pause duck, keep-alive) ─► SFX bus ─► limiter ─► master
//   combat ─┤  driving 16th pulse, D pedal bass, four-on-the-floor; fits both D modes
//   sting ──┘  victory, defeat
//
// All layers share one 120 BPM step clock, so crossfades stay on the beat.
// The themes are original. The seed only varies ornaments, harp direction and ghost hats.
// A lookahead scheduler, pumped once per rendered frame, books the next notes.
export const MUSIC = {
  tempo: 120, stepsPerBar: 16, bars: 32, lookahead: .3, seed: 0x4d6f6e6b,
  // The bus sits ~12 dB under the hits. Paused, it ducks to 35 %.
  level: .3, pauseDuck: .35,
  // Combat: packs awake within 11 u start it at 70 % and duck the area's layer
  // to 75 %; it holds 3 s after the last sign of a fight.
  combatRange: 11, combatHold: 3, combatLevel: .7, areaInCombat: .75,
  // Fade time constants (s): about three of them reach the new level.
  fade: { zone: 1.5, combatIn: .6, combatOut: 1, duck: .25 },
  // Without a pump for this long (hidden tab, stopped loop) the music fades out.
  keepAlive: .8,
  // Light delayed vibrato on the leads: 5.5 Hz, ±12 cents, after 150 ms.
  vibrato: { rate: 5.5, cents: 12, delay: .15 },
};
export const STEP = 60 / MUSIC.tempo / 4;
export const LOOP_STEPS = MUSIC.stepsPerBar * MUSIC.bars;
export const LAYERS = ['camp', 'road', 'court', 'combat'];

const hz = midi => 440 * 2 ** ((midi - 69) / 12);
const LETTERS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function midiOf(name) {
  const [, letter, accidental, octave] = /^([A-G])(#|b)?(\d)$/.exec(name);
  return 12 * (Number(octave) + 1) + LETTERS[letter] + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0);
}
// "A4:4 D5:6 -:2 …" per bar, bars split by "|"; lengths are 16th steps and every bar holds 16.
function melody(...sections) {
  return sections.join('|').split('|').map((bar, i) => {
    let step = 0;
    const notes = [];
    for (const token of bar.trim().split(/\s+/)) {
      const [name, length] = token.split(':');
      if (name !== '-') notes.push({ midi: midiOf(name), step, length: Number(length) });
      step += Number(length);
    }
    if (step !== MUSIC.stepsPerBar) throw new Error(`bar ${i + 1} holds ${step} steps`);
    return notes;
  });
}
// Root pitch class and triad intervals.
export const CHORDS = { D: [2, [0, 4, 7]], Dm: [2, [0, 3, 7]], Em: [4, [0, 3, 7]], F: [5, [0, 4, 7]],
  G: [7, [0, 4, 7]], Am: [9, [0, 3, 7]], C: [0, [0, 4, 7]] };
const chordTones = (name, octave) => { const [root, triad] = CHORDS[name]; return triad.map(i => 12 * (octave + 1) + root + i); };

// Three original themes. Forms: camp A B A B (8-bar phrases), road A A' B A,
// court A A' B A. Each line ends on its tonic so the loop closes.
const CAMP_A = `D5:8 B4:4 C5:4 | D5:4 E5:4 D5:8 | G4:8 A4:4 B4:4 | A4:16 |
  D5:8 B4:4 C5:4 | D5:4 G5:4 F#5:4 E5:4 | D5:4 C5:4 B4:4 A4:4 | G4:16`;
const CAMP_B = `E5:8 D5:4 C5:4 | B4:8 C5:4 D5:4 | C5:8 B4:4 A4:4 | B4:12 -:4 |
  E5:6 F#5:2 G5:8 | D5:8 B4:8 | C5:4 A4:4 B4:4 F#4:4 | G4:16`;
const ROAD_A = `A4:4 D5:6 C5:2 B4:2 A4:2 | G4:2 A4:2 B4:4 E4:8 | F#4:3 G4:1 A4:4 D5:4 E5:4 | F#5:8 E5:4 D5:4 |
  C5:4 D5:2 C5:2 B4:4 G4:4 | A4:6 B4:2 A4:4 F#4:4 | G4:4 E4:4 A4:4 C5:4 | D5:12 -:4`;
const ROAD_A2 = `A4:4 D5:6 C5:2 B4:2 A4:2 | G4:2 A4:2 B4:4 E4:8 | F#4:3 G4:1 A4:4 D5:4 E5:4 | F#5:8 E5:4 D5:4 |
  C5:4 E5:4 D5:2 C5:2 B4:4 | A4:4 D5:4 F#5:4 A5:4 | G5:6 F#5:2 E5:4 C5:4 | D5:8 A4:4 D5:4`;
const ROAD_B = `G4:2 G4:2 B4:2 D5:2 G5:6 -:2 | F#5:2 E5:2 D5:2 B4:2 D5:8 | C5:2 C5:2 E5:2 G5:2 E5:6 -:2 | D5:2 C5:2 B4:2 G4:2 A4:8 |
  G4:2 B4:2 D5:4 B4:2 D5:2 G5:4 | F#5:4 E5:4 D5:4 C5:4 | B4:4 C5:2 D5:2 E5:4 F#5:4 | A5:4 G5:2 F#5:2 E5:8`;
const COURT_A = `D5:6 E5:2 F5:8 | E5:4 C5:4 D5:8 | B4:6 C5:2 D5:4 G5:4 | F5:12 -:4 |
  A5:6 G5:2 F5:4 E5:4 | F5:4 D5:4 C5:8 | E5:6 D5:2 C5:4 E5:4 | D5:16`;
const COURT_A2 = `D5:6 E5:2 F5:8 | E5:4 C5:4 D5:8 | B4:6 C5:2 D5:4 G5:4 | F5:12 -:4 |
  A4:6 B4:2 C5:4 E5:4 | D5:4 B4:4 A4:8 | G4:6 A4:2 B4:4 C5:4 | D5:16`;
const COURT_B = `C5:4 F5:4 E5:4 D5:4 | C5:8 A4:8 | G4:4 C5:4 B4:4 A4:4 | B4:12 -:4 |
  A4:4 D5:4 C5:4 A4:4 | G4:4 A4:4 B4:4 C5:4 | D5:4 F5:4 E5:4 C5:4 | E5:8 A4:8`;
const campChords = 'G C G D G Em D G C G D Em Em G D G'.split(' ');
const roadA = 'D Em D D C D C D'.split(' ');
const courtA = 'Dm C G Dm Dm Dm Am Dm'.split(' ');
export const THEMES = {
  camp: { key: 'G major', scale: [7, 9, 11, 0, 2, 4, 6], melody: melody(CAMP_A, CAMP_B, CAMP_A, CAMP_B),
    chords: [...campChords, ...campChords] },
  road: { key: 'D Mixolydian', scale: [2, 4, 6, 7, 9, 11, 0], melody: melody(ROAD_A, ROAD_A2, ROAD_B, ROAD_A),
    chords: [...roadA, ...roadA, ...'G D C G G D Em Am'.split(' '), ...roadA] },
  court: { key: 'D Dorian', scale: [2, 4, 5, 7, 9, 11, 0], melody: melody(COURT_A, COURT_A2, COURT_B, COURT_A),
    chords: [...courtA, ...'Dm C G Dm Am G C Dm'.split(' '), ...'F F C G Dm G Am Am'.split(' '), ...courtA] },
};
// Combat uses only D, E, G, A and C: the notes both D modes share.
const COMBAT_PULSE = [['D4', 'D4', 'A4', 'D4', 'D5', 'D4', 'A4', 'D4', 'D4', 'D4', 'A4', 'D4', 'C5', 'D4', 'A4', 'G4'],
  ['C4', 'C4', 'G4', 'C4', 'C5', 'C4', 'G4', 'C4', 'D4', 'D4', 'A4', 'D4', 'D5', 'C5', 'A4', 'G4']].map(bar => bar.map(midiOf));
const COMBAT_BASS = [['D2', 'D3', 'D2', 'D3', 'D2', 'D3', 'C3', 'A2'], ['C2', 'C3', 'C2', 'C3', 'G2', 'G3', 'A2', 'C3']].map(bar => bar.map(midiOf));

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The whole loop as notes per step and layer. Same seed, same music.
export function composeScore(seed = MUSIC.seed) {
  const random = seeded(seed), human = () => .92 + random() * .16;
  const score = Object.fromEntries(LAYERS.map(name => [name, Array.from({ length: LOOP_STEPS }, () => [])]));
  const put = (layer, bar, step, note) => score[layer][bar * MUSIC.stepsPerBar + step].push(note);
  const leads = { camp: 'ocarina', road: 'lead', court: 'square' };
  for (const [layer, theme] of Object.entries(THEMES)) {
    const above = midi => { for (let m = midi + 1; ; m++) if (theme.scale.includes(m % 12)) return m; };
    theme.melody.forEach((bar, b) => {
      for (const n of bar) {
        // Camp only: some long notes open with a one-step grace from the scale note above.
        if (layer === 'camp' && n.length >= 8 && n.step === 0 && b % 8 && random() < .35) {
          put(layer, b, 0, { voice: leads[layer], midi: above(n.midi), length: 1, velocity: .7 });
          put(layer, b, 1, { voice: leads[layer], midi: n.midi, length: n.length - 1, velocity: human() });
        } else put(layer, b, n.step, { voice: leads[layer], midi: n.midi, length: n.length, velocity: human() });
      }
    });
    theme.chords.forEach((chord, b) => {
      const [low, mid] = [chordTones(chord, 2), chordTones(chord, 3)], high = chordTones(chord, 4);
      if (layer === 'camp') {
        // Rocking eighth-note harp, up or down by bar; soft root half notes.
        const rock = [mid[0], mid[2], high[1], mid[2], high[0], mid[2], high[1], mid[2]];
        (random() < .5 ? rock : [...rock].reverse()).forEach((midi, i) => put(layer, b, i * 2, { voice: 'harp', midi, velocity: .55 + random() * .15 }));
        put(layer, b, 0, { voice: 'bass', midi: low[0], length: 7 }); put(layer, b, 8, { voice: 'bass', midi: low[2], length: 7 });
        put(layer, b, 4, { voice: 'hat', velocity: .35 }); put(layer, b, 12, { voice: 'hat', velocity: .35 });
      } else if (layer === 'road') {
        // March: root-fifth quarter bass, a harp answer in the second half, noise drums.
        [low[0], low[2], low[0] + 12, low[2]].forEach((midi, i) => put(layer, b, i * 4, { voice: 'bass', midi, length: 3 }));
        [high[0], high[1], high[2], high[0] + 12].forEach((midi, i) => put(layer, b, 8 + i * 2, { voice: 'harp', midi, velocity: .6 }));
        put(layer, b, 0, { voice: 'kick', velocity: .9 }); put(layer, b, 8, { voice: 'kick', velocity: .7 });
        put(layer, b, 4, { voice: 'snare', velocity: .6 }); put(layer, b, 12, { voice: 'snare', velocity: .7 });
        for (let step = 0; step < 16; step += 2) put(layer, b, step, { voice: 'hat', velocity: step % 4 ? .35 : .5 });
        if (b % 8 === 7) [13, 14, 15].forEach((step, i) => put(layer, b, step, { voice: 'snare', velocity: .35 + i * .15 }));
        else if (random() < .4) put(layer, b, 15, { voice: 'hat', velocity: .25 });
      } else {
        // Court: an eighth-note triangle ostinato, a harp figure on beat 1, sparse low drum, a bell every 4 bars.
        [low[0], low[2], mid[0], low[2], low[1], low[2], mid[0], low[2]].forEach((midi, i) => put(layer, b, i * 2, { voice: 'bass', midi, length: 1.6 }));
        [mid[0], mid[2], high[0], high[1]].forEach((midi, i) => put(layer, b, i, { voice: 'harp', midi, velocity: .45 }));
        put(layer, b, 0, { voice: 'kick', velocity: .6, pitch: .8 });
        put(layer, b, 10, { voice: 'hat', velocity: .3 });
        if (random() < .3) put(layer, b, 14, { voice: 'hat', velocity: .2 });
        if (b % 4 === 0) put(layer, b, 0, { voice: 'bell', midi: 74 });
      }
    });
  }
  for (let b = 0; b < MUSIC.bars; b++) {
    const turn = b % 4 === 3 ? 1 : 0;
    COMBAT_PULSE[turn].forEach((midi, step) => put('combat', b, step, { voice: 'pulse', midi, velocity: step % 4 ? .7 : 1 }));
    COMBAT_BASS[turn].forEach((midi, i) => put('combat', b, i * 2, { voice: 'bass', midi, length: 1.6, velocity: .7 }));
    // Lighter on 1 and 3, where the road's own kick already lands.
    for (const step of [0, 4, 8, 12]) put('combat', b, step, { voice: 'kick', velocity: step % 8 ? .7 : .45 });
    put('combat', b, 4, { voice: 'snare', velocity: .8 }); put('combat', b, 12, { voice: 'snare', velocity: .9 });
    for (let step = 0; step < 16; step++) put('combat', b, step, { voice: 'hat', velocity: step % 2 ? .25 : .45 });
    if (b % 8 === 7) [12, 13, 14, 15].forEach((step, i) => put('combat', b, step, { voice: 'snare', velocity: .4 + i * .15 }));
  }
  return score;
}

export class Music {
  constructor(context, { output, noise, seed = MUSIC.seed, muted = false }) {
    this.context = context; this.noise = noise; this.muted = muted;
    this.score = composeScore(seed);
    const now = context.currentTime, gain = (value, to) => {
      const node = context.createGain(); node.gain.value = value; node.connect(to); return node;
    };
    const filter = (type, frequency, q, to) => {
      const node = context.createBiquadFilter(); node.type = type; node.frequency.value = frequency; node.Q.value = q;
      node.connect(to); return node;
    };
    this.bus = gain(0, output);
    this.layers = Object.fromEntries(LAYERS.map(name => [name, { node: gain(0, this.bus), target: 0, silentAt: -Infinity }]));
    // Shared noise filters per layer: snare band-pass 1.8 kHz, hat high-pass 7 kHz.
    for (const layer of Object.values(this.layers)) {
      layer.snare = filter('bandpass', 1800, .9, layer.node);
      layer.hat = filter('highpass', 7000, .7, layer.node);
    }
    this.sting = { node: gain(1, this.bus) };
    // A 25 % pulse from its first 24 harmonics: the bright, slightly soft SNES lead.
    const real = new Float32Array(25), imag = new Float32Array(25);
    for (let n = 1; n < 25; n++) real[n] = 2 / (n * Math.PI) * Math.sin(n * Math.PI * .25);
    this.pulseWave = context.createPeriodicWave(real, imag);
    // One held vibrato oscillator; each lead note taps it through its own depth gain.
    this.vibrato = context.createOscillator(); this.vibrato.frequency.value = MUSIC.vibrato.rate; this.vibrato.start(now);
    this.persistent = [this.vibrato];
    this.step = 0; this.nextTime = now + .1;
    this.level = 0; this.armedAt = -Infinity; this.game = null; this.combatUntil = -Infinity;
  }

  setMuted(value) { this.muted = value; }

  // Call once per rendered frame with the UI mode: 'playing', 'paused', 'victory', 'defeat' or 'welcome'.
  update(game, mode = 'playing') {
    const now = this.context.currentTime, p = game.player;
    if (game !== this.game) { this.game = game; this.combatUntil = -Infinity; }
    for (const event of game.events) {
      if (event.type === 'victory' || event.type === 'defeat') this.playSting(event.type, now);
      if (['impact', 'block', 'hurt', 'shot', 'slam', 'leap'].includes(event.type)) this.combatUntil = now + MUSIC.combatHold;
    }
    const live = mode === 'playing' && game.phase === 'playing';
    if (live && game.enemies.some(e => e.hp > 0 && e.kind !== 'ritual' && !e.returning && (e.active || (e.state && e.state !== 'idle'))
      && Math.hypot(e.x - p.x, e.y - p.y) < MUSIC.combatRange)) this.combatUntil = now + MUSIC.combatHold;
    const zone = game.adventure ? game.locationId : 'road', fighting = live && now < this.combatUntil;
    const area = fighting ? MUSIC.areaInCombat : 1;
    // After victory the camp lullaby plays in full; after defeat, softly.
    const targets = game.phase === 'victory' ? { camp: 1, road: 0, court: 0, combat: 0 }
      : game.phase === 'defeat' ? { camp: .4, road: 0, court: 0, combat: 0 }
      : { camp: zone === 'camp' ? area : 0, road: zone === 'road' ? area : 0, court: zone === 'courtyard' ? area : 0,
        combat: fighting ? MUSIC.combatLevel : 0 };
    for (const name of LAYERS) {
      const layer = this.layers[name], target = targets[name];
      if (target === layer.target) continue;
      const tau = name !== 'combat' ? MUSIC.fade.zone : target > layer.target ? MUSIC.fade.combatIn : MUSIC.fade.combatOut;
      layer.node.gain.setTargetAtTime(target, now, tau);
      layer.target = target;
      // Below -60 dB after ~7 time constants: stop booking its notes then.
      layer.silentAt = target > 0 ? Infinity : now + tau * 7;
    }
    const level = MUSIC.level * (mode === 'paused' ? MUSIC.pauseDuck : 1);
    if (level !== this.level || now - this.armedAt > .2) {
      // Keep-alive: every pump re-arms a fade to silence just beyond the next pump.
      const g = this.bus.gain;
      g.cancelScheduledValues(now);
      g.setTargetAtTime(level, now, MUSIC.fade.duck);
      g.setTargetAtTime(0, now + MUSIC.keepAlive, .3);
      this.level = level; this.armedAt = now;
    }
    this.pump(now);
  }

  // Books every step that starts before now + lookahead. After a stall the
  // missed steps are skipped, not played late, and the loop stays in phase.
  pump(now = this.context.currentTime) {
    if (this.nextTime < now) {
      const missed = Math.ceil((now - this.nextTime) / STEP);
      this.step += missed; this.nextTime += missed * STEP;
    }
    while (this.nextTime < now + MUSIC.lookahead) {
      if (!this.muted) {
        for (const name of LAYERS) {
          const layer = this.layers[name];
          if (this.nextTime >= layer.silentAt) continue;
          for (const note of this.score[name][this.step % LOOP_STEPS]) this.note(note, this.nextTime, layer);
        }
      }
      this.step++; this.nextTime += STEP;
    }
  }

  playSting(kind, now) {
    if (this.muted) return;
    const t = now + .05, at = (step, note) => this.note(note, t + step * .09, this.sting);
    if (kind === 'victory') {
      // A rising D major call in two pulse voices, a long top D, a falling harp and a bass root.
      ['D5', 'F#5', 'A5'].forEach((name, i) => at(i, { voice: 'lead', midi: midiOf(name), length: .6, velocity: 1.1 }));
      ['A4', 'D5', 'F#5'].forEach((name, i) => at(i, { voice: 'square', midi: midiOf(name), length: .6, velocity: .8 }));
      at(3, { voice: 'lead', midi: midiOf('D6'), length: 6, velocity: 1.1 });
      at(3, { voice: 'square', midi: midiOf('A5'), length: 6, velocity: .8 });
      ['D6', 'A5', 'F#5', 'D5', 'A4', 'F#4', 'D4'].forEach((name, i) => at(4 + i * .5, { voice: 'harp', midi: midiOf(name), velocity: .8 }));
      at(3, { voice: 'bass', midi: midiOf('D3'), length: 6 });
    } else {
      // A slow fall A, F, D, then the leading C♯ that resolves to a long D.
      ['A4', 'F4', 'D4', 'C#4'].forEach((name, i) => at(i * 3.3, { voice: 'square', midi: midiOf(name), length: 2.2, velocity: 1 }));
      at(13.2, { voice: 'square', midi: midiOf('D4'), length: 9, velocity: 1 });
      at(13.2, { voice: 'bass', midi: midiOf('D2'), length: 9, velocity: .6 });
      at(13.2, { voice: 'harp', midi: midiOf('D5'), velocity: .5 });
    }
  }

  // One note: one oscillator (or noise) through one envelope into its layer.
  note(note, t, layer) {
    const c = this.context, v = note.velocity ?? 1, f = hz(note.midi ?? 0), nodes = [], taps = [];
    const length = (note.length ?? 1) * STEP;
    const envelope = (peak, attack, hold, release, out) => {
      const env = c.createGain(), g = env.gain, end = t + attack + hold + release;
      g.setValueAtTime(.0001, t); g.linearRampToValueAtTime(peak, t + attack);
      if (hold > 0) g.setValueAtTime(peak, t + attack + hold);
      g.exponentialRampToValueAtTime(.0001, end);
      env.connect(out); nodes.push(env);
      return { env, end };
    };
    const tone = (type, to, { frequency = f, from = frequency, glide = 0, vibrato = false } = {}) => {
      const o = c.createOscillator();
      if (type === 'pulse') o.setPeriodicWave(this.pulseWave); else o.type = type;
      o.frequency.setValueAtTime(from, t);
      if (glide) o.frequency.exponentialRampToValueAtTime(frequency, t + glide);
      if (vibrato) {
        const depth = c.createGain(), { cents, delay } = MUSIC.vibrato;
        depth.gain.setValueAtTime(0, t); depth.gain.setValueAtTime(0, t + delay);
        depth.gain.linearRampToValueAtTime(cents, t + delay + .2);
        this.vibrato.connect(depth); depth.connect(o.detune);
        nodes.push(depth); taps.push(depth);
      }
      o.connect(to); nodes.push(o);
      return o;
    };
    const noise = to => {
      const source = c.createBufferSource(); source.buffer = this.noise; source.loop = true;
      source.connect(to); nodes.push(source);
      return source;
    };
    let source, end;
    switch (note.voice) {
      case 'lead': { // Road lead: 25 % pulse, 10 ms attack, gated at 90 %, delayed vibrato.
        const e = envelope(.09 * v, .01, Math.max(0, length * .9 - .01), .08, layer.node); end = e.end;
        source = tone('pulse', e.env, { vibrato: true });
        break;
      }
      case 'ocarina': { // Camp lead: soft triangle, 50 ms breath in, 0.25 s release, delayed vibrato.
        const e = envelope(.12 * v, .05, Math.max(0, length * .92 - .05), .25, layer.node); end = e.end;
        source = tone('triangle', e.env, { vibrato: true });
        break;
      }
      case 'square': { // Court lead and sting voice: 50 % square, 30 ms attack, 0.2 s release, vibrato.
        const e = envelope(.06 * v, .03, Math.max(0, length * .9 - .03), .2, layer.node); end = e.end;
        source = tone('square', e.env, { vibrato: true });
        break;
      }
      case 'pulse': { // Combat ostinato: 25 % pulse, 70 ms staccato.
        const e = envelope(.05 * v, .004, .03, .04, layer.node); end = e.end;
        source = tone('pulse', e.env);
        break;
      }
      case 'harp': { // Plucked triangle, 0.5 % sharp for 20 ms, 0.9 s decay.
        const e = envelope(.085 * v, .004, 0, .9, layer.node); end = e.end;
        source = tone('triangle', e.env, { from: f * 1.005, glide: .02 });
        break;
      }
      case 'bass': { // Triangle bass, gated at 85 %.
        const e = envelope(.15 * v, .005, Math.max(0, length * .85 - .005), .05, layer.node); end = e.end;
        source = tone('triangle', e.env);
        break;
      }
      case 'bell': { // Soft sine bell, 1.6 s ring.
        const e = envelope(.07, .004, 0, 1.6, layer.node); end = e.end;
        source = tone('sine', e.env);
        break;
      }
      case 'kick': { // Sine 140 → 50 Hz in 0.1 s, 0.14 s decay.
        const e = envelope(.17 * v, .003, 0, .14, layer.node); end = e.end;
        const pitch = note.pitch ?? 1;
        source = tone('sine', e.env, { frequency: 50 * pitch, from: 140 * pitch, glide: .1 });
        break;
      }
      case 'snare': { // Noise through the 1.8 kHz band-pass, 0.12 s.
        const e = envelope(.11 * v, .002, 0, .12, layer.snare ?? layer.node); end = e.end;
        source = noise(e.env);
        break;
      }
      case 'hat': { // Noise through the 7 kHz high-pass, 35 ms.
        const e = envelope(.05 * v, .001, 0, .035, layer.hat ?? layer.node); end = e.end;
        source = noise(e.env);
        break;
      }
      default: return;
    }
    for (const node of nodes) {
      if (!node.start) continue;
      // A fixed read position per voice keeps noise hits alike and the score repeatable.
      if (node.buffer) node.start(t, (note.velocity * 7919) % .9); else node.start(t);
      node.stop(end + .01);
    }
    source.onended = () => {
      for (const tap of taps) this.vibrato.disconnect(tap);
      for (const node of nodes) node.disconnect();
    };
  }
}
