// Ambient presentation only. No simulation body, RNG, events, target or interaction.
import { CAMP_NPC_SPOTS } from './camp-layout.js';

export function campNpcPlacements(offset = { x: 0, y: 0 }) {
  return CAMP_NPC_SPOTS.map(spot => ({ ...spot, x: spot.x + (offset?.x ?? 0), y: spot.y + (offset?.y ?? 0) }));
}

export function campNpcFrame(atlas, npc, time, reducedMotion = false) {
  const clip = atlas.clips[npc.kind];
  if (reducedMotion) return clip.frames[0];
  const seconds = Number.isFinite(time) && time > 0 ? time : 0;
  // Epsilon keeps exact frame boundaries stable after full-cycle additions.
  const key = Math.floor((seconds + npc.phase) * 1000 / clip.frameDurationMs + 1e-9) % clip.frames.length;
  return clip.frames[key];
}

// Keep the JS doubles until the destination typed array performs its original conversion.
const npcQuadUvs = new Float64Array(8);

// Babylon plane vertex order: bottom-left, bottom-right, top-right, top-left.
// Each quad keeps its own UV rectangle; the atlas texture matrix stays identity.
export function writeCampNpcUvs(uvs, quad, atlas, frame, flip = false) {
  const left = frame % atlas.columns / atlas.columns, right = left + 1 / atlas.columns;
  const bottom = 1 - (Math.floor(frame / atlas.columns) + 1) / atlas.rows, top = bottom + 1 / atlas.rows;
  const a = flip ? right : left, b = flip ? left : right;
  npcQuadUvs[0] = a; npcQuadUvs[1] = bottom; npcQuadUvs[2] = b; npcQuadUvs[3] = bottom;
  npcQuadUvs[4] = b; npcQuadUvs[5] = top; npcQuadUvs[6] = a; npcQuadUvs[7] = top;
  uvs.set(npcQuadUvs, quad * 8);
}
