// Fixed-step render interpolation. The simulation advances in whole 1/120 s steps;
// a frame draws each body between its position before the latest step and its
// current one, at alpha = leftover time / step. The drawn state therefore trails
// the simulation by exactly one step and moves evenly at any display rate.
// A body that is new, or that moved further than SNAP_DISTANCE in one step
// (teleport, restart, area reset), is drawn where it is instead of smeared.
export const SNAP_DISTANCE = 1;

export class MotionHistory {
  constructor() {
    this.previous = new Map(); this.spare = new Map();
    this.game = null; this.alpha = 1; this.valid = false;
  }

  // Call before every simulation step: remember where each body starts it.
  capture(game) {
    const next = this.spare;
    next.clear();
    const keep = body => {
      const record = this.previous.get(body) ?? {};
      record.x = body.x; record.y = body.y;
      next.set(body, record);
    };
    keep(game.player);
    for (const body of game.enemies) keep(body);
    for (const body of game.projectiles ?? []) keep(body);
    this.spare = this.previous; this.previous = next;
    this.game = game; this.revision = game.locationRevision; this.world = game.world;
  }

  // The blend for this frame. History from another run or location never applies.
  blend(game, alpha) {
    this.alpha = Math.min(1, Math.max(0, alpha));
    this.valid = game === this.game && game.locationRevision === this.revision && game.world === this.world;
    return this;
  }

  // Where a body is drawn this frame; the body itself when it must not blend.
  at(body) {
    const from = this.valid ? this.previous.get(body) : null;
    if (!from || Math.hypot(body.x - from.x, body.y - from.y) > SNAP_DISTANCE) return body;
    const a = this.alpha;
    return { x: from.x * (1 - a) + body.x * a, y: from.y * (1 - a) + body.y * a };
  }
}
