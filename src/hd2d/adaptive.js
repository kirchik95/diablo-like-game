import { TIERS, HD_STORAGE_KEY, defaultTier, normalizeSettings, parseHD, saveTierSettings } from './tiers.js';

const WARMUP_MS = 3000;
const WINDOW_MS = 4000;
// Budget is 60 Hz even on 90/120/144 Hz displays. Never infer it from screen FPS.
const TARGET_FRAME_MS = 1000 / 60;
const P95_LIMIT_MS = TARGET_FRAME_MS * 1.05; // 17.5 ms
const LONG_FRAME_MS = 33;
const isTier = value => TIERS.includes(value);

function readPreference(storage) {
  try {
    const raw = storage?.getItem(HD_STORAGE_KEY);
    if (isTier(raw)) return raw;
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/** Presentation-only governor. Call frame with the raw monotonic timestamp, before
 * simulation clamps dt. Menus, onboarding pauses and hidden tabs reset the window.
 * A downgrade stays visit-local; only an explicit settings choice writes storage.
 */
export function createAdaptiveHD({ storage = null, search = '', coarse = false, phone = false, getHost = () => null } = {}) {
  const initialTier = defaultTier({ coarse, phone });
  const saved = readPreference(storage);
  let automatic = saved?.mode === 'auto' || !(isTier(saved) || isTier(saved?.tier));
  let settings = normalizeSettings(automatic ? initialTier : saved, initialTier);
  const url = new URLSearchParams(search).get('hd');
  if (isTier(url) || (url && url.split(',').some(token => /^[a-z][a-z0-9-]*:(off|low|high)$/.test(token.trim())))) {
    settings = parseHD(url, settings);
    automatic = false; // Explicit QA overrides must remain reproducible.
  }
  let previous = NaN, warmup = 0, elapsed = 0, samples = 0, slow = 0, long = 0;
  function clearWindow() { elapsed = 0; samples = 0; slow = 0; long = 0; }
  function suspend() { previous = NaN; warmup = 0; clearWindow(); }
  function apply() { getHost()?.setTier(settings); }
  return {
    get settings() { return settings; },
    get tier() { return settings.tier; },
    get choice() { return automatic ? 'auto' : settings.tier; },
    suspend,
    select(choice) {
      if (choice !== 'auto' && !isTier(choice)) return;
      automatic = choice === 'auto';
      settings = normalizeSettings(automatic ? initialTier : choice);
      suspend(); apply();
      if (automatic) {
        try { storage?.setItem(HD_STORAGE_KEY, JSON.stringify({ mode: 'auto', ...settings })); } catch { /* Private mode. */ }
      } else saveTierSettings(storage, settings);
    },
    frame(now, playing, hidden = false) {
      if (!automatic || settings.tier === 'off' || !playing || hidden || !Number.isFinite(now)) { suspend(); return; }
      const dt = now - previous;
      previous = now;
      if (!Number.isFinite(dt)) return;
      if (dt < 0) { suspend(); return; }
      if (dt === 0) return;
      if (warmup < WARMUP_MS) { warmup += dt; return; }
      elapsed += dt; samples++;
      if (dt > P95_LIMIT_MS) slow++;
      if (dt > LONG_FRAME_MS) long++;
      if (elapsed < WINDOW_MS) return;
      // Nearest-rank p95 > limit iff that rank lies in the slow suffix. Counters
      // give the exact threshold decision without allocating/sorting frame arrays.
      if (slow > samples - Math.ceil(samples * .95) || long > 2) {
        settings = normalizeSettings(settings.tier === 'high' ? 'low' : 'off');
        apply();
      }
      clearWindow();
    },
  };
}
