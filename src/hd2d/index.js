import * as normals from './normals.js';
import * as water from './water.js';
import * as lights from './lights.js';
import * as shadows from './shadows.js';
import * as particles from './particles.js';
import * as atmos from './atmos.js';
import * as bloom from './bloom.js';
import * as dof from './dof.js';
import { effectTier, normalizeSettings } from './tiers.js';

// HD-2D core: merge-time registry. Add static namespace imports here, e.g.
// import * as bloom from './bloom.js'; and then add bloom to effects.
export const effects = Object.freeze([normals, water, lights, shadows, particles, atmos, bloom, dof]);

// Tiny opt-in diagnostic effect. The game registry never installs it.
export const probe = Object.freeze({
  id: 'probe', order: 0,
  install({ tier }) {
    return { tier, frames: 0, disposed: false,
      setTier(value) { this.tier = value; },
      update() { this.frames++; },
      dispose() { this.disposed = true; },
    };
  },
});

export function createHD2D(ctx, initialSettings = 'off', modules = effects) {
  let settings = normalizeSettings(initialSettings), active = [], disposed = false;
  const installed = [];
  let disposeObserver;
  const host = {
    active: false,
    get settings() { return settings; },
    setTier(value) {
      if (disposed) return;
      settings = normalizeSettings(value, settings.tier);
      active = [];
      for (const entry of installed) {
        const tier = effectTier(settings, entry.id);
        if (tier !== entry.tier) { entry.instance.setTier(tier); entry.tier = tier; }
        if (tier !== 'off') active.push(entry.instance);
      }
      host.active = active.length > 0;
    },
    update(dt, time) {
      // Renderer checks active first. This guard also makes direct off calls free of effect work.
      if (!host.active) return;
      for (let i = 0; i < active.length; i++) active[i].update(dt, time);
    },
    onWorld(renderer = ctx.renderer) {
      if (disposed) return;
      for (const entry of installed) entry.instance.onWorld?.(renderer);
    },
    dispose() {
      if (disposed) return;
      disposed = true; host.active = false; active.length = 0;
      if (disposeObserver) ctx.scene.onDisposeObservable.remove(disposeObserver);
      // Release post effects before resources they depend on, even if one cleanup throws.
      let failure;
      for (let i = installed.length - 1; i >= 0; i--) {
        try { installed[i].instance.dispose(); }
        catch (error) { failure ??= error; }
      }
      installed.length = 0;
      if (failure) throw failure;
    },
  };
  try {
    for (const module of [...modules].sort((a, b) => a.order - b.order)) {
      if (installed.some(entry => entry.id === module.id)) throw Error(`Duplicate HD-2D effect: ${module.id}`);
      const tier = effectTier(settings, module.id);
      const instance = module.install({ ...ctx, tier });
      installed.push({ id: module.id, tier, instance });
      if (tier !== 'off') active.push(instance);
    }
    host.active = active.length > 0;
    disposeObserver = ctx.scene.onDisposeObservable.addOnce(() => host.dispose());
    return host;
  } catch (error) {
    try { host.dispose(); } catch { /* Preserve the installation error after cleanup. */ }
    throw error;
  }
}
