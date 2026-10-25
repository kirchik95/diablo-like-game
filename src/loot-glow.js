// Loot light and labels live in the existing canvas overlay: zero additional WebGL draws.
// All light geometry uses the same 32 source pixels per world unit as the item atlas.
const PIXELS_PER_UNIT = 32;
const COLORS = Object.freeze({ common: '#eee0ce', rare: '#6dd6cb', relic: '#e5b66e' });
const EMPTY = Object.freeze([]), ZERO_DROP = Object.freeze({ height: 0, shift: 0, flash: 0 });
const NO_OPTIONS = Object.freeze({});
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function lootLabelVisible(ground, hero, { alt = false, touch = false } = NO_OPTIONS) {
  return (ground.x - hero.x) ** 2 + (ground.y - hero.y) ** 2 <= 36 || (alt && !touch);
}

// Stable order prevents a pile from changing its layout when the state array is reordered.
// Prefer nearby free rows or side columns; omit only when the viewport has no free rectangle.
const labelOrder = (a, b) => a.y - b.y || String(a.id).localeCompare(String(b.id));
const sortedLabels = [], labelXs = [], labelYs = [];
function appendEdges(xs, box, w, width, margin, gap) {
  xs.push(Math.round(clamp(box.x - w - gap, margin, width - w - margin)),
    Math.round(clamp(box.x + box.width + gap, margin, width - w - margin)));
}
function blockedBy(boxes, x, y, width, height, gap = 0) {
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (x < b.x + b.width + gap && x + width + gap > b.x && y < b.y + b.height + gap && y + height + gap > b.y) return true;
  }
  return false;
}
export function placeLootLabels(labels, { width, height, blockers = EMPTY }) {
  if (!labels.length) return EMPTY;
  // Only the returned value records are new; candidate coordinates and ordering storage are scratch.
  const placed = [], margin = 2, gap = 2, xs = labelXs, ys = labelYs, sorted = sortedLabels;
  sorted.length = labels.length;
  for (let i = 0; i < labels.length; i++) sorted[i] = labels[i];
  sorted.sort(labelOrder);
  for (let i = 0; i < sorted.length; i++) {
    const label = sorted[i], w = Math.min(label.width, width - margin * 2), h = label.height;
    if (w <= 0 || h > height - margin * 2) continue;
    const preferredX = Math.round(clamp(label.x - w / 2, margin, width - w - margin));
    const preferredY = Math.round(clamp(label.y - h - 5, margin, height - h - margin));
    xs.length = 0; xs.push(preferredX);
    for (let x = margin; x <= width - w - margin; x += Math.max(1, Math.floor(w / 2))) xs.push(x);
    xs.push(width - w - margin);
    for (let j = 0; j < blockers.length; j++) appendEdges(xs, blockers[j], w, width, margin, gap);
    for (let j = 0; j < placed.length; j++) appendEdges(xs, placed[j], w, width, margin, gap);
    ys.length = 0;
    for (let y = preferredY; y >= margin; y -= h + gap) ys.push(y);
    ys.push(margin);
    let chosen = false, chosenX = 0, chosenY = 0, best = Infinity;
    for (let j = 0; j < xs.length; j++) {
      const x = xs[j];
      for (let k = 0; k < ys.length; k++) {
        const y = ys[k], cost = (x - preferredX) ** 2 + (y - preferredY) ** 2;
        if (cost >= best) continue;
        if (blockedBy(blockers, x, y, w, h, gap) || blockedBy(placed, x, y, w, h, gap)) continue;
        chosen = true; chosenX = x; chosenY = y; best = cost;
      }
    }
    if (chosen) placed.push({ ...label, x: chosenX, y: chosenY, width: w, height: h });
  }
  sorted.length = 0;
  return placed;
}

const GLOW_PHASES = [.65, .85, 1, .85], PILLAR_PHASES = [.65, .75, .85, .75];
const lightStates = new Map();
function statesFor(color) {
  let states = lightStates.get(color);
  if (!states) {
    states = [];
    const common = color === COLORS.common;
    for (let phase = 0; phase < 5; phase++) states.push(Object.freeze({ color,
      glowAlpha: (common ? .18 : .42) * GLOW_PHASES[phase], pillarAlpha: common ? 0 : PILLAR_PHASES[phase], pillarHeight: common ? 0 : 1.75 }));
    lightStates.set(color, states);
  }
  return states;
}

export function lootLightState(rarity, time, reducedMotion = false) {
  const color = COLORS[rarity] ?? COLORS.common;
  const phase = reducedMotion ? 1 : Math.floor((((time % 2) + 2) % 2) / .5);
  return statesFor(color)[Number.isNaN(phase) ? 4 : phase];
}

// A .32 s parabolic toss followed by a .16 s landing glint. No game-state fields change.
export function lootDropPose(age, reducedMotion = false) {
  if (reducedMotion || !Number.isFinite(age)) return ZERO_DROP;
  const t = clamp(age / .32, 0, 1);
  const height = .8 * 4 * t * (1 - t), shift = t === 1 ? 0 : -6 * (1 - t);
  const flash = age < .32 ? 0 : Math.max(0, 1 - (age - .32) / .16);
  return height === 0 && shift === 0 && flash === 0 ? ZERO_DROP : { height, shift, flash };
}

// Rectangles, rather than gradients, keep the glow pixel-crisp. The three stepped ellipses
// are a small pool, not a large luminous circle. Skip actor silhouettes in the overlay.
export function drawLootLight(c, { x, y, tipY, unit, rarity, time, reducedMotion = false, blockers = EMPTY }) {
  const light = lootLightState(rarity, time, reducedMotion), texel = unit / PIXELS_PER_UNIT;
  for (let row = -5; row <= 5; row++) {
    const half = Math.round(Math.sqrt(Math.max(0, 1 - (row / 6) ** 2)) * 14);
    drawRect(c, blockers, x - half * texel, y + row * texel, half * 2 * texel, texel, light.glowAlpha * .35, light.color);
    if (Math.abs(row) < 3) drawRect(c, blockers, x - (9 - Math.abs(row)) * texel, y + row * texel, (18 - Math.abs(row) * 2) * texel, texel, light.glowAlpha, light.color);
  }
  if (light.pillarHeight) {
    const bottom = y - 3 * texel, top = tipY, length = Math.max(1, bottom - top);
    // Two source pixels at the core and a one-pixel night edge stay readable on pale stone.
    const core = Math.max(1, Math.round(2 * texel)), left = x - Math.floor(core / 2);
    for (let row = 0; row < length; row++) {
      const fade = .7 + .3 * row / length;
      drawRect(c, blockers, left - 1, top + row, core + 2, 1, .45, '#0d0a14');
      drawRect(c, blockers, left, top + row, core, 1, light.pillarAlpha * fade, light.color);
    }
    drawRect(c, blockers, left, top, core, 2 * texel, .9, '#fff7e4');
  }
  c.globalAlpha = 1;
}

function drawRect(c, blockers, left, top, width, height, alpha, ink) {
  const x = Math.round(left), y = Math.round(top), w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
  if (blockedBy(blockers, x, y, w, h)) return;
  c.fillStyle = ink; c.globalAlpha = alpha; c.fillRect(x, y, w, h);
}
