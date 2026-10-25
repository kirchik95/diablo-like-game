// Light pools: the camp fire, the braziers, the healing shrines and the cemetery's stone lanterns
// light the ground with a world-texel ordered dither over a smooth falloff, tinted by their flame.
// Actors and props use the same continuous falloff, without dither, so walking never pops their tint.
// Pure data: the renderer uploads the packed
// arrays to the ground shader (country-terrain.js) only when they change.
// tint/add colour the lit ground, `actor` multiplies a sprite's emissive at full light.
export const LIGHT_INKS = {
  amber: { tint: [1.3, 1.08, .8], add: [.05, .025, 0], actor: [1.12, 1, .84], radius: 3.4, power: .7 },
  cyan: { tint: [1, 1.28, 1.36], add: [0, .035, .06], actor: [.92, 1.08, 1.14], radius: 2.6, power: .62 },
  pink: { tint: [1.32, .94, 1.3], add: [.06, 0, .05], actor: [1.1, .92, 1.08], radius: 2.6, power: .62 },
  spirit: { tint: [1, 1.22, 1.25], add: [0, .03, .045], actor: [.95, 1.06, 1.08], radius: 2.2, power: .5 },
  // The cemetery's stone lanterns burn with turquoise windows.
  lantern: { tint: [1, 1.2, 1.24], add: [0, .025, .04], actor: [.96, 1.04, 1.06], radius: 1.6, power: .45 },
};
// The ground shader's light slots (the nearest lights to the view).
export const MAX_LIGHTS = 8;
// The flicker changes in whole steps, this many times a second.
const FLICKER_RATE = 8;

// The world's light sources at their ground contact: [{ x, y, ink, seed }].
export function sceneLights(world) {
  const lights = [];
  const add = (x, y, ink) => lights.push({ x, y, ink, seed: lights.length });
  for (const zone of world.zones ?? [world]) {
    const props = zone.setDressing ?? [];
    const fires = props.filter(p => p.kind === 'campfire-base');
    // The camp fire burns around its stone ring's centre.
    for (const p of fires) add(p.collider?.x ?? p.x, p.collider?.y ?? p.y, 'amber');
    // A zone with a camp fire draws its amber brazier entry as that fire.
    for (const b of zone.braziers ?? []) {
      if (b.color !== 'amber' || !fires.length) add(b.x, b.y, b.color === 'amber' ? 'amber' : b.color === 'cyan' ? 'cyan' : 'pink');
    }
    // A healing shrine lights the ground where the monk stands to heal, in front of its base.
    for (const shrine of zone.shrines ?? []) add(shrine.x, shrine.y, 'spirit');
    for (const p of props) if (p.kind === 'stone-lantern') add(p.collider?.x ?? p.x, p.collider?.y ?? p.y, 'lantern');
  }
  return lights;
}

const flicker = (seed, step) => {
  const n = Math.sin(step * 12.9898 + seed * 78.233) * 43758.5453;
  return n - Math.floor(n) - .5;
};
// Same smoothstep as the ground shader, before its pixel-art ordered quantisation.
const falloff = (distance, radius) => {
  const t = Math.max(0, Math.min(1, 1 - distance / radius));
  return t * t * (3 - 2 * t);
};

// The light of a point in a list of lights, without flicker: { ink, level } or null.
export function lightAt(lights, x, y) {
  let best = null, level = 0;
  for (const light of lights) {
    const ink = LIGHT_INKS[light.ink], g = falloff(Math.hypot(x - light.x, y - light.y), ink.radius) * ink.power;
    if (g > level) { level = g; best = ink; }
  }
  return best ? { ink: best, level } : null;
}

// A sprite emissive in a pool: white keeps the art, full light multiplies it by the ink's `actor`.
export function tintEmissive(color, light, strength = 1) {
  const k = light.level / .7 * strength, actor = light.ink.actor;
  color.set(color.r * (1 + (actor[0] - 1) * k), color.g * (1 + (actor[1] - 1) * k), color.b * (1 + (actor[2] - 1) * k));
}

// The ground shader's packed lights: per slot, position, radius and power (`pos`), the ground tint
// and the added light. The nearest lights are chosen again only when the view moves to another
// 4 u cell; the flickered radius and power change only on a new flicker step.
const nearerLight = (a, b) => a.d - b.d;

export class LightPack {
  constructor(lights) {
    this.lights = lights;
    this.pos = new Array(MAX_LIGHTS * 4).fill(0);
    this.tint = new Array(MAX_LIGHTS * 4).fill(0);
    this.add = new Array(MAX_LIGHTS * 4).fill(0);
    this.chosen = [];
    this.ranked = []; this.rankPool = [];
    this.cellX = null; this.cellY = null; this.step = null;
    this.hit = { ink: null, level: 0 };
  }

  // Returns true when the arrays changed. `still` (reduced motion) holds the flicker.
  update(x, y, time, still = false) {
    const cellX = Math.floor(x / 4), cellY = Math.floor(y / 4);
    const step = still ? -1 : Math.floor(time * FLICKER_RATE), moved = cellX !== this.cellX || cellY !== this.cellY;
    if (!moved && step === this.step) return false;
    if (moved) {
      this.cellX = cellX; this.cellY = cellY;
      const ranked = this.ranked, pool = this.rankPool;
      // Refill authored order before a stable sort, including after an equal-distance tie.
      ranked.length = this.lights.length;
      for (let i = 0; i < this.lights.length; i++) {
        const light = this.lights[i], entry = pool[i] ??= { light: null, d: 0 };
        entry.light = light; entry.d = Math.hypot(light.x - x, light.y - y); ranked[i] = entry;
      }
      for (let i = this.lights.length; i < pool.length; i++) pool[i].light = null;
      ranked.sort(nearerLight);
      this.chosen.length = Math.min(MAX_LIGHTS, ranked.length);
      this.tint.fill(0); this.add.fill(0); this.pos.fill(0);
      for (let i = 0; i < this.chosen.length; i++) {
        const light = this.chosen[i] = ranked[i].light, ink = LIGHT_INKS[light.ink];
        for (let k = 0; k < 3; k++) { this.tint[i * 4 + k] = ink.tint[k]; this.add[i * 4 + k] = ink.add[k]; }
      }
    }
    this.step = step;
    for (let i = 0; i < this.chosen.length; i++) {
      const light = this.chosen[i], ink = LIGHT_INKS[light.ink], breathe = still ? 0 : flicker(light.seed, step);
      this.pos[i * 4] = light.x; this.pos[i * 4 + 1] = light.y;
      this.pos[i * 4 + 2] = ink.radius * (1 + breathe * .08); this.pos[i * 4 + 3] = ink.power * (1 + breathe * .12);
    }
    return true;
  }

  // The light of a point in the packed (flickered) pools, before the ground dither: { ink, level } or
  // null. The result is reused by the next call.
  at(x, y) {
    let best = null, level = 0;
    for (let i = 0; i < this.chosen.length; i++) {
      const light = this.chosen[i];
      const g = falloff(Math.hypot(x - light.x, y - light.y), this.pos[i * 4 + 2]) * this.pos[i * 4 + 3];
      if (g > level) { level = g; best = LIGHT_INKS[light.ink]; }
    }
    if (!best) return null;
    this.hit.ink = best; this.hit.level = level;
    return this.hit;
  }
}
