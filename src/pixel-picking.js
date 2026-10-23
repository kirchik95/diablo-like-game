export function decodeHitMask(mask) {
  return { width: mask.width, bytes: Uint8Array.from(atob(mask.bits), character => character.charCodeAt(0)) };
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
const opaqueBoxes = new WeakMap();
function opaqueBox(sprite) {
  const { cell, columns, mask } = sprite.atlas;
  if (!mask) return [0, 0, cell, cell];
  if (!opaqueBoxes.has(mask)) opaqueBoxes.set(mask, new Map());
  const boxes = opaqueBoxes.get(mask);
  if (!boxes.has(sprite.frame)) {
    const box = [cell, cell, 0, 0];
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
      const pixel = (Math.floor(sprite.frame / columns) * cell + y) * mask.width + (sprite.frame % columns) * cell + x;
      if (!(mask.bytes[pixel >> 3] & (1 << (pixel & 7)))) continue;
      box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.max(box[2], x + 1); box[3] = Math.max(box[3], y + 1);
    }
    boxes.set(sprite.frame, box);
  }
  const [x0, y0, x1, y1] = boxes.get(sprite.frame);
  return sprite.flip ? [cell - x1, y0, cell - x0, y1] : [x0, y0, x1, y1];
}

function screenBounds(sprite, origin, projectedScale = 1) {
  const { anchor } = sprite.atlas, [bx0, by0, bx1, by1] = opaqueBox(sprite);
  const scaleX = (sprite.mesh?.scaling?.x ?? 1) * projectedScale;
  const scaleY = (sprite.mesh?.scaling?.y ?? 1) * projectedScale;
  const x0 = origin.x + (bx0 - anchor[0]) * scaleX, x1 = origin.x + (bx1 - anchor[0]) * scaleX;
  const y0 = origin.y + (by0 - anchor[1]) * scaleY, y1 = origin.y + (by1 - anchor[1]) * scaleY;
  return { left: Math.min(x0, x1), right: Math.max(x0, x1), top: Math.min(y0, y1), bottom: Math.max(y0, y1) };
}

export function obscuresSprite(front, frontOrigin, back, backOrigin, projectedScale = 1) {
  // Billboards share the camera projection. Keep both the broad phase and mask
  // samples in their rendered scale, including the scaled ground anchor.
  const a = screenBounds(front, frontOrigin, projectedScale), b = screenBounds(back, backOrigin, projectedScale);
  if (a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top) return false;
  const { cell, anchor } = back.atlas;
  const scaleX = (back.mesh?.scaling?.x ?? 1) * projectedScale;
  const scaleY = (back.mesh?.scaling?.y ?? 1) * projectedScale;
  // The same 3 px sample lattice, limited to the back sprite's opaque box.
  const box = opaqueBox(back), first = n => 1 + 3 * Math.max(0, Math.ceil((n - 1) / 3));
  let covered = 0, opaque = 0;
  for (let y = first(box[1]); y < box[3]; y += 3) {
    for (let x = first(box[0]); x < box[2]; x += 3) {
      const screenX = backOrigin.x + (x - anchor[0] + .5) * scaleX;
      const screenY = backOrigin.y + (y - anchor[1] + .5) * scaleY;
      if (!opaqueSpritePixel(back, backOrigin, screenX, screenY, projectedScale)) continue;
      opaque++;
      if (opaqueSpritePixel(front, frontOrigin, screenX, screenY, projectedScale)) covered++;
    }
  }
  return opaque > 0 && covered / opaque > .15;
}
