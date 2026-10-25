// Pure presentation: the renderer's paused-aware clock never writes to simulation state.
// Chest keys 0–7 retain the original closed/opening/empty contract. One effect sprite
// holds the 2.4-second beacon, the opening burst or a reduced-motion still.
export const CACHE_TIMING = Object.freeze({ pulse: 1.6, call: 2.4, shaft: .6, moteStep: .1, openingStep: .1, fade: .5 });
export const CACHE_FRAMES = Object.freeze({ motes: 8, burst: 32, steady: 40, pool: 41 });
const clamp = value => Math.max(0, Math.min(1, value));

export class CacheGlow {
  constructor() {
    this.found = null;
    this.openedAt = null;
    this.heldLight = 1;
    this.pose = { frame: 0, moteFrame: CACHE_FRAMES.motes, moteAlpha: 0, poolAlpha: 0 };
  }

  update(found, time, { lightPools = true, reducedMotion = false } = {}) {
    const pose = this.pose;
    if (!found) {
      this.openedAt = null;
      const phase = Math.max(0, time) % CACHE_TIMING.pulse;
      const pulse = reducedMotion ? 1 : (1 - Math.cos(phase / CACHE_TIMING.pulse * Math.PI * 2)) / 2;
      pose.frame = Math.round(pulse * 3);
      const call = Math.max(0, time) % CACHE_TIMING.call;
      pose.moteFrame = reducedMotion ? CACHE_FRAMES.steady
        : CACHE_FRAMES.motes + Math.floor((call + 1e-8) / CACHE_TIMING.moteStep) % 24;
      this.heldLight = .8 + pulse * .2;
      pose.moteAlpha = this.heldLight;
      pose.poolAlpha = lightPools ? this.heldLight : 0;
    } else {
      if (this.found !== true) {
        // A restored opened cache starts empty; only a witnessed interaction bursts.
        this.openedAt = this.found === false ? time : time - CACHE_TIMING.fade;
      }
      const age = Math.max(0, time - this.openedAt);
      pose.frame = reducedMotion ? 7 : Math.min(7, 4 + Math.floor((age + 1e-8) / CACHE_TIMING.openingStep));
      const t = clamp(age / CACHE_TIMING.fade);
      const fade = 1 - t * t * (3 - 2 * t);
      pose.moteFrame = reducedMotion ? CACHE_FRAMES.steady : CACHE_FRAMES.burst + Math.min(7, Math.floor(t * 8));
      pose.moteAlpha = Math.min(1, this.heldLight * 1.2) * fade;
      pose.poolAlpha = lightPools ? this.heldLight * fade : 0;
    }
    this.found = !!found;
    return pose;
  }
}
