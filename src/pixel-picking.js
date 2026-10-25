// A plain loop: Uint8Array.from over the string's iterator with a map callback is several times slower.
export function decodeHitMask(mask) {
  const binary = atob(mask.bits), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { width: mask.width, bytes };
}

// Screen coordinates are native framebuffer pixels; origin is the projected foot anchor.
// projectedScale is framebuffer pixels per source pixel before mesh scaling.
export function opaqueSpritePixel(sprite, origin, x, y, projectedScale = 1) {
  const { cell, anchor, columns, mask } = sprite.atlas;
  const scaleX = (sprite.mesh?.scaling?.x ?? 1) * projectedScale;
  const scaleY = (sprite.mesh?.scaling?.y ?? 1) * projectedScale;
  if (!scaleX || !scaleY) return false;
  let localX = Math.floor((x - origin.x) / scaleX + anchor[0]);
  const localY = Math.floor((y - origin.y) / scaleY + anchor[1]);
  if (!mask || localX < 0 || localX >= cell || localY < 0 || localY >= cell) return false;
  if (sprite.flip) localX = cell - 1 - localX;
  const pixel = (Math.floor(sprite.frame / columns) * cell + localY) * mask.width
    + (sprite.frame % columns) * cell + localX;
  return (mask.bytes[pixel >> 3] & (1 << (pixel & 7))) !== 0;
}

// Opaque [x0, y0, x1, y1) box of a frame in cell pixels (mirrored for a
// flipped sprite), scanned once from its hit mask. The transparent margin of a
// large cell can never cover anything, so neither phase needs to look there.
const opaqueBoxes = new WeakMap(), unmaskedBoxes = new WeakMap();
function opaqueBox(sprite) {
  const { cell, columns, mask } = sprite.atlas;
  if (!mask) {
    let box = unmaskedBoxes.get(sprite.atlas);
    if (!box || box[2] !== cell) { box = [0, 0, cell, cell]; unmaskedBoxes.set(sprite.atlas, box); }
    return box;
  }
  if (!opaqueBoxes.has(mask)) opaqueBoxes.set(mask, new Map());
  const boxes = opaqueBoxes.get(mask);
  if (!boxes.has(sprite.frame)) {
    const box = [cell, cell, 0, 0];
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
      const pixel = (Math.floor(sprite.frame / columns) * cell + y) * mask.width + (sprite.frame % columns) * cell + x;
      if (!(mask.bytes[pixel >> 3] & (1 << (pixel & 7)))) continue;
      box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.max(box[2], x + 1); box[3] = Math.max(box[3], y + 1);
    }
    boxes.set(sprite.frame, { normal: box, cell, flipped: [cell - box[2], box[1], cell - box[0], box[3]] });
  }
  const box = boxes.get(sprite.frame);
  if (box.cell !== cell) {
    box.cell = cell; box.flipped[0] = cell - box.normal[2]; box.flipped[2] = cell - box.normal[0];
  }
  return sprite.flip ? box.flipped : box.normal;
}

// Screen bounds of a sprite's opaque box, written into `out` as [left, right, top, bottom].
function screenBounds(sprite, origin, projectedScale, out) {
  const { anchor } = sprite.atlas, box = opaqueBox(sprite);
  const scaleX = (sprite.mesh?.scaling?.x ?? 1) * projectedScale;
  const scaleY = (sprite.mesh?.scaling?.y ?? 1) * projectedScale;
  const x0 = origin.x + (box[0] - anchor[0]) * scaleX, x1 = origin.x + (box[2] - anchor[0]) * scaleX;
  const y0 = origin.y + (box[1] - anchor[1]) * scaleY, y1 = origin.y + (box[3] - anchor[1]) * scaleY;
  out[0] = Math.min(x0, x1); out[1] = Math.max(x0, x1); out[2] = Math.min(y0, y1); out[3] = Math.max(y0, y1);
  return out;
}
const frontBounds = new Float64Array(4), backBounds = new Float64Array(4);

// The back drawing's samples: the 3 px lattice inside its opaque box, kept where its own mask is
// set, as cell pixels [x, y, x, y, …], once per mask, frame and flip. A lattice point projected to the
// screen and back lands on its own pixel, so the back mask needs no screen round trip.
const backSamples = new WeakMap();
const firstSample = n => 1 + 3 * Math.max(0, Math.ceil((n - 1) / 3));
function opaqueSamples(sprite) {
  const { cell, columns, mask } = sprite.atlas;
  if (!backSamples.has(mask)) backSamples.set(mask, new Map());
  const byFrame = backSamples.get(mask), key = sprite.flip ? -1 - sprite.frame : sprite.frame;
  if (!byFrame.has(key)) {
    const box = opaqueBox(sprite), samples = [];
    const row = Math.floor(sprite.frame / columns) * cell, column = (sprite.frame % columns) * cell;
    for (let y = firstSample(box[1]); y < box[3]; y += 3) {
      for (let x = firstSample(box[0]); x < box[2]; x += 3) {
        const pixel = (row + y) * mask.width + column + (sprite.flip ? cell - 1 - x : x);
        if (mask.bytes[pixel >> 3] & (1 << (pixel & 7))) samples.push(x, y);
      }
    }
    byFrame.set(key, Int16Array.from(samples));
  }
  return byFrame.get(key);
}

// True when the front drawing covers more than 15% of the back drawing's opaque samples (a 3 px
// lattice in its opaque box). Both use their rendered scale, including the scaled ground anchor.
// The front pixel of each sample is read as opaqueSpritePixel reads it, with the same arithmetic;
// the count stops as soon as the answer cannot change.
export function obscuresSprite(front, frontOrigin, back, backOrigin, projectedScale = 1) {
  const a = screenBounds(front, frontOrigin, projectedScale, frontBounds), b = screenBounds(back, backOrigin, projectedScale, backBounds);
  if (a[1] <= b[0] || b[1] <= a[0] || a[3] <= b[2] || b[3] <= a[2]) return false;
  const backScaleX = (back.mesh?.scaling?.x ?? 1) * projectedScale, backScaleY = (back.mesh?.scaling?.y ?? 1) * projectedScale;
  if (!back.atlas.mask || !backScaleX || !backScaleY) return false;
  const frontMask = front.atlas.mask;
  const frontScaleX = (front.mesh?.scaling?.x ?? 1) * projectedScale, frontScaleY = (front.mesh?.scaling?.y ?? 1) * projectedScale;
  if (!frontMask || !frontScaleX || !frontScaleY) return false;
  const samples = opaqueSamples(back), opaque = samples.length / 2;
  if (!opaque) return false;
  const { anchor } = back.atlas, { cell, columns, anchor: frontAnchor } = front.atlas;
  const row = Math.floor(front.frame / columns) * cell, column = (front.frame % columns) * cell, width = frontMask.width;
  let covered = 0;
  for (let i = 0; i < samples.length; i += 2) {
    const screenX = backOrigin.x + (samples[i] - anchor[0] + .5) * backScaleX;
    const screenY = backOrigin.y + (samples[i + 1] - anchor[1] + .5) * backScaleY;
    let localX = Math.floor((screenX - frontOrigin.x) / frontScaleX + frontAnchor[0]);
    const localY = Math.floor((screenY - frontOrigin.y) / frontScaleY + frontAnchor[1]);
    if (localX >= 0 && localX < cell && localY >= 0 && localY < cell) {
      if (front.flip) localX = cell - 1 - localX;
      const pixel = (row + localY) * width + column + localX;
      if (frontMask.bytes[pixel >> 3] & (1 << (pixel & 7))) {
        covered++;
        if (covered / opaque > .15) return true;
      }
    }
    if ((covered + (samples.length - i - 2) / 2) / opaque <= .15) return false;
  }
  return covered / opaque > .15;
}
