// Fixed-step render interpolation. The simulation advances in whole 1/120 s steps;
// a frame draws each body between its position before the latest step and its
// current one, at alpha = leftover time / step. The drawn state therefore trails
// the simulation by exactly one step and moves evenly at any display rate.
// A body that is new, or that moved further than SNAP_DISTANCE in one step
// (teleport, restart, area reset), is drawn where it is instead of smeared.
export const SNAP_DISTANCE = 1;

function captureBody(previous, next, body) {
  const record = previous.get(body) ?? {};
  record.x = body.x; record.y = body.y;
  next.set(body, record);
}

export class MotionHistory {
  constructor() {
    this.previous = new Map(); this.spare = new Map();
    this.drawn = new WeakMap();
    this.game = null; this.alpha = 1; this.valid = false;
  }

  // Call before every simulation step: remember where each body starts it.
  capture(game) {
    const next = this.spare;
    next.clear();
    captureBody(this.previous, next, game.player);
    for (let i = 0; i < game.enemies.length; i++) captureBody(this.previous, next, game.enemies[i]);
    if (game.projectiles) for (let i = 0; i < game.projectiles.length; i++) captureBody(this.previous, next, game.projectiles[i]);
    if (game.monkShots) for (let i = 0; i < game.monkShots.length; i++) captureBody(this.previous, next, game.monkShots[i]);
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
  // A blended point is reused by the next query for that body; different bodies never alias.
  at(body) {
    const from = this.valid ? this.previous.get(body) : null;
    if (!from || Math.hypot(body.x - from.x, body.y - from.y) > SNAP_DISTANCE) return body;
    const a = this.alpha;
    let point = this.drawn.get(body);
    if (!point) { point = { x: 0, y: 0 }; this.drawn.set(body, point); }
    point.x = from.x * (1 - a) + body.x * a;
    point.y = from.y * (1 - a) + body.y * a;
    return point;
  }
}
