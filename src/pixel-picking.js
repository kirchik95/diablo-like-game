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

function screenBounds(sprite, origin, projectedScale = 1) {
  const { cell, anchor } = sprite.atlas;
  const scaleX = (sprite.mesh?.scaling?.x ?? 1) * projectedScale;
  const scaleY = (sprite.mesh?.scaling?.y ?? 1) * projectedScale;
  const x0 = origin.x - anchor[0] * scaleX, x1 = x0 + cell * scaleX;
  const y0 = origin.y - anchor[1] * scaleY, y1 = y0 + cell * scaleY;
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
  let covered = 0, opaque = 0;
  for (let y = 1; y < cell; y += 3) {
    for (let x = 1; x < cell; x += 3) {
      const screenX = backOrigin.x + (x - anchor[0] + .5) * scaleX;
      const screenY = backOrigin.y + (y - anchor[1] + .5) * scaleY;
      if (!opaqueSpritePixel(back, backOrigin, screenX, screenY, projectedScale)) continue;
      opaque++;
      if (opaqueSpritePixel(front, frontOrigin, screenX, screenY, projectedScale)) covered++;
    }
  }
  return opaque > 0 && covered / opaque > .15;
}
