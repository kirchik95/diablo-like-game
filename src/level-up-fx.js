// The level-up light, in the spirit of Diablo's: a column of warm gold rises over the monk, a ring runs
// out over the ground, a pool of light glows around him, motes climb, and «Новый уровень N» shows above
// him; it all fades out in LEVEL_UP_LIGHT.life seconds. It draws on the effects canvas in hard-edged
// pixel shapes: whole-pixel rows and rects, no gradients and no blur. A fixed pool of bursts and
// motes is allocated once; drawing allocates nothing (palette strings are constants).
// Reduced motion keeps the pool, a still column and the text: no ring and no motes.

export const LEVEL_UP_LIGHT = Object.freeze({
  life: 1.8,
  // Bursts at once (a level gained while another plays starts its own) and motes per burst.
  bursts: 3, motes: 44,
  // A level gained this soon after the last joins its burst and shows the higher level.
  join: .2,
  // World units: the pool and ring radii, the column height and widths, the text height.
  pool: 2.4, ring: [.35, 3.1], column: 4.4, widths: [2, 1.3, .76, .2], text: 2.85,
  // Seconds: the column grows, holds and fades; the ring runs out; the text shows and fades.
  grow: .22, hold: .85, fadeColumn: 1.5, ringTime: .75, textIn: .3, textOut: 1.4,
});

const GOLD = '#ffc35a', GOLD_LIGHT = '#ffd27a', PALE = '#ffe9a8', WHITE = '#fff6e0', DEEP = '#ffb347';
const PLATE = '#120e18', PLATE_LINE = '#e5b66e', INK = '#f6e7c4';
const FONT = '600 9px -apple-system, "Segoe UI", Arial, sans-serif';
const MOTE_TONES = [GOLD_LIGHT, WHITE, PALE, GOLD];
// Pool bands (radius share, alpha), rings (delay, alpha, tone) and column bands (width index, alpha, tone).
const POOL = [1, .14, .66, .16, .36, .2];
const RINGS = [0, 1, GOLD_LIGHT, .1, .5, PALE];
const BANDS = [0, .12, DEEP, 1, .22, GOLD, 2, .36, GOLD_LIGHT];
// Per mote: angle, radius, delay, life, rise speed, spin, size, tone. Sparks ride the ring.
const STRIDE = 8, SPARKS = 18;
const hash = (a, b) => {
  let n = Math.imul(a, 374761393) ^ Math.imul(b, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
const easeOut = t => 1 - (1 - t) * (1 - t);
const clamp01 = t => t < 0 ? 0 : t > 1 ? 1 : t;

export class LevelUpLight {
  constructor() {
    const { bursts, motes } = LEVEL_UP_LIGHT;
    this.bursts = Array.from({ length: bursts }, () => ({ live: false, age: 0, level: 0, text: '', textWidth: 0, serial: 0 }));
    this.motes = new Float32Array(bursts * motes * STRIDE);
    this.seen = new WeakSet();
    this.serial = 0;
  }

  // Starts a burst for every level-up event not seen before (events stay in the list for a frame).
  observe(events) {
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      if (event.type !== 'level-up' || this.seen.has(event)) continue;
      this.seen.add(event);
      this.start(event.level);
    }
  }

  start(level) {
    let joined = null;
    for (let i = 0; i < this.bursts.length; i++) {
      const burst = this.bursts[i];
      if (burst.live && burst.age < LEVEL_UP_LIGHT.join) { joined = burst; break; }
    }
    if (joined) {
      if (level > joined.level) { joined.level = level; joined.text = `Новый уровень ${level}`; joined.textWidth = 0; }
      return joined;
    }
    // A free slot, or the oldest burst gives way.
    let index = 0;
    for (let i = 0; i < this.bursts.length; i++) {
      const burst = this.bursts[i];
      if (!burst.live ? this.bursts[index].live : this.bursts[index].live && burst.age > this.bursts[index].age) index = i;
    }
    const burst = this.bursts[index], serial = ++this.serial, { motes } = LEVEL_UP_LIGHT;
    burst.live = true; burst.age = 0; burst.level = level; burst.text = `Новый уровень ${level}`; burst.textWidth = 0; burst.serial = serial;
    for (let m = 0; m < motes; m++) {
      const o = (index * motes + m) * STRIDE, salt = serial * 97 + m;
      this.motes[o] = hash(salt, 1) * Math.PI * 2;
      this.motes[o + 1] = .7 + hash(salt, 2) * 1.3;
      this.motes[o + 2] = hash(salt, 3) * .6;
      this.motes[o + 3] = .7 + hash(salt, 4) * .6;
      this.motes[o + 4] = 1.3 + hash(salt, 5) * 1.6;
      this.motes[o + 5] = (hash(salt, 6) - .5) * 3;
      this.motes[o + 6] = hash(salt, 7) < .5 ? 2 : 1;
      this.motes[o + 7] = Math.floor(hash(salt, 8) * MOTE_TONES.length);
    }
    return burst;
  }

  update(dt) {
    for (let i = 0; i < this.bursts.length; i++) {
      const burst = this.bursts[i];
      if (!burst.live) continue;
      burst.age += dt;
      if (burst.age >= LEVEL_UP_LIGHT.life) burst.live = false;
    }
  }

  // A new run starts dark: every burst goes out (the pool and the mote buffer stay).
  reset() {
    for (let i = 0; i < this.bursts.length; i++) this.bursts[i].live = false;
  }

  get active() {
    let count = 0;
    for (let i = 0; i < this.bursts.length; i++) if (this.bursts[i].live) count++;
    return count;
  }

  // view: x, y: the screen point on the ground under the monk; unit: screen pixels per world unit on
  // the ground across the screen (half that down it); rise: screen pixels per world unit of height.
  // The shared effects canvas keeps its state: alpha, blending, font and text anchors come back after.
  draw(c, view) {
    if (!this.active) return;
    c.save?.();
    for (let index = 0; index < this.bursts.length; index++) {
      const burst = this.bursts[index];
      if (burst.live) this.drawBurst(c, view, burst, index);
    }
    c.restore?.();
  }

  drawBurst(c, view, burst, index) {
    const L = LEVEL_UP_LIGHT, t = burst.age, calm = view.reducedMotion;
    const x = Math.round(view.x), y = Math.round(view.y), unit = view.unit, rise = view.rise;

    // The pool of warm light: three nested ellipses, a hard edge each, brightest at the flash.
    const pool = (t < .08 ? t / .08 : 1) * clamp01((L.life - .2 - t) / 1.1) * (calm ? .7 : 1);
    if (pool > 0) {
      c.globalCompositeOperation = 'source-over';
      c.fillStyle = PALE;
      const flash = calm ? 1 : 1 + .8 * clamp01(1 - t / .3);
      for (let k = 0; k < POOL.length; k += 2) {
        c.globalAlpha = Math.min(1, pool * POOL[k + 1] * flash);
        ellipse(c, x, y, L.pool * POOL[k] * unit, L.pool * POOL[k] * unit / 2, 0);
      }
    }
    c.globalCompositeOperation = 'lighter';
    // A white flash at the monk's feet as the light breaks.
    if (!calm && t < .12) {
      c.globalAlpha = 1 - t / .12; c.fillStyle = WHITE;
      ellipse(c, x, y, .55 * unit, .275 * unit, 0);
    }

    // The ring runs out over the ground and thins; a fainter second ring follows it.
    if (!calm && t < L.ringTime + .1) {
      for (let k = 0; k < RINGS.length; k += 3) {
        const delay = RINGS[k], p = clamp01((t - delay) / L.ringTime);
        if (p <= 0 || p >= 1) continue;
        const radius = (L.ring[0] + (L.ring[1] - L.ring[0]) * easeOut(p)) * unit;
        c.globalAlpha = RINGS[k + 1] * (1 - p * p);
        c.fillStyle = RINGS[k + 2];
        ellipse(c, x, y, radius, radius / 2, p < .5 ? 3 : 2);
        if (k === 0) {
          c.fillStyle = WHITE; c.globalAlpha = (1 - p) * .9;
          ellipse(c, x, y, radius - 1, (radius - 1) / 2, 1);
          // Sparks ride the ring's front, lifted a little.
          for (let m = 0; m < SPARKS; m++) {
            const a = m / SPARKS * Math.PI * 2 + burst.serial;
            c.fillRect(Math.round(x + Math.cos(a) * (radius + 2)), Math.round(y + Math.sin(a) * (radius + 2) / 2 - p * 6), 2, 1);
          }
        }
      }
    }

    // The column: three hard glow bands and a white core, grown from the ground, then narrowed and faded.
    const grown = calm ? 1 : easeOut(clamp01(t / L.grow));
    const fade = t < L.hold ? 1 : clamp01(1 - (t - L.hold) / (L.fadeColumn - L.hold));
    if (fade > 0) {
      const height = Math.round(L.column * rise * grown), narrow = .5 + .5 * fade;
      for (let k = 0; k <= BANDS.length; k += 3) {
        const core = k === BANDS.length, width = L.widths[core ? 3 : BANDS[k]];
        const w = Math.max(2, Math.round(width * unit * narrow / 2) * 2);
        c.globalAlpha = (core ? calm ? .45 : t < .15 ? 1 : .6 : BANDS[k + 1]) * fade * (calm ? .8 : 1);
        c.fillStyle = core ? WHITE : BANDS[k + 2];
        c.fillRect(x - w / 2, y - height, w, height);
      }
      // Bright rows climb the column; the top of the column is a short taper.
      if (!calm) {
        const core = Math.max(2, Math.round(L.widths[2] * unit * narrow / 2) * 2);
        c.fillStyle = WHITE;
        for (let k = 0; k < 5; k++) {
          const climb = (t * 1.4 + k / 5) % 1, row = Math.round(y - climb * height);
          c.globalAlpha = fade * (1 - climb) * .9;
          c.fillRect(x - core / 2, row, core, 1);
        }
      }
      const tip = Math.max(2, Math.round(L.widths[3] * unit * narrow / 2) * 2);
      c.globalAlpha = fade * .6; c.fillStyle = PALE;
      c.fillRect(x - tip / 2, y - height - 3, tip, 3);
    }

    // Motes climb in a slow spiral, twinkle and fade: the larger ones are pixel crosses.
    if (!calm) {
      c.globalCompositeOperation = 'source-over';
      const motes = L.motes, base = index * motes * STRIDE;
      for (let m = 0; m < motes; m++) {
        const o = base + m * STRIDE, local = t - this.motes[o + 2], life = this.motes[o + 3];
        if (local < 0 || local > life) continue;
        const k = local / life, angle = this.motes[o] + this.motes[o + 5] * local, radius = this.motes[o + 1] * (1 - .35 * k);
        const sx = Math.round(x + Math.cos(angle) * radius * unit);
        const sy = Math.round(y + Math.sin(angle) * radius * unit / 2 - this.motes[o + 4] * local * rise * (1 - .25 * k));
        const twinkle = ((local * 14 + m) | 0) % 4 === 0 ? .45 : 1;
        c.globalAlpha = twinkle * clamp01(k / .1) * clamp01((1 - k) / .3);
        c.fillStyle = MOTE_TONES[this.motes[o + 7]];
        if (this.motes[o + 6] > 1) { c.fillRect(sx - 1, sy, 3, 1); c.fillRect(sx, sy - 1, 1, 3); }
        else c.fillRect(sx, sy, 1, 1);
      }
    }

    // «Новый уровень N» on a plate like the HUD banners: night ground, an amber top line.
    const shown = clamp01((t - L.textIn) / .15) * clamp01((L.life - t) / (L.life - L.textOut));
    if (shown > 0) {
      c.globalCompositeOperation = 'source-over';
      c.font = FONT; c.textAlign = 'center'; c.textBaseline = 'middle';
      // Measured once per burst; a context without metrics falls back to 5 px a letter.
      if (!burst.textWidth) burst.textWidth = Math.ceil(c.measureText?.(burst.text)?.width ?? burst.text.length * 5);
      const w = burst.textWidth + 10, h = 13, lift = calm ? 0 : Math.round(t * 4);
      const top = Math.round(y - L.text * rise) - h - lift, left = x - Math.round(w / 2);
      c.globalAlpha = shown * .86; c.fillStyle = PLATE; c.fillRect(left, top, w, h);
      c.globalAlpha = shown; c.fillStyle = PLATE_LINE; c.fillRect(left, top, w, 1);
      c.fillStyle = INK; c.fillText(burst.text, x, top + 7);
      // Also back by hand: other overlay text (damage numbers) assumes the default baseline.
      c.textBaseline = 'alphabetic';
    }
  }
}

// A filled ellipse (width 0) or its rim of `width` pixels, in whole-pixel rows: hard edges, no blur.
function ellipse(c, cx, cy, rx, ry, width) {
  rx = Math.max(1, rx); ry = Math.max(1, ry);
  const rows = Math.ceil(ry), innerX = rx - width, innerY = ry - width / 2;
  c.beginPath();
  for (let dy = -rows; dy <= rows; dy++) {
    const v = dy / ry;
    if (v * v > 1) continue;
    const half = Math.round(rx * Math.sqrt(1 - v * v));
    const inner = !width || innerY <= 0 || Math.abs(dy) >= innerY ? -1 : Math.round(innerX * Math.sqrt(Math.max(0, 1 - (dy / innerY) ** 2)));
    if (inner < 0 || inner >= half) c.rect(cx - half, cy + dy, half * 2 + 1, 1);
    else { c.rect(cx - half, cy + dy, half - inner, 1); c.rect(cx + inner + 1, cy + dy, half - inner, 1); }
  }
  c.fill();
}
