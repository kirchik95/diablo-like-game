// No service worker: compare the loaded document with a fresh same-origin marker.
export function createVersionCheck({
  doc = globalThis.document, win = globalThis.window,
  currentVersion = doc.querySelector('meta[name="ritual-version"]')?.content,
  versionUrl = new URL('version.json', doc.baseURI).href,
  fetchVersion = win.fetch.bind(win), getState,
  showUpdate = () => {}, reload = url => win.location.replace(url),
} = {}) {
  let pending = null, inFlight = null, stopped = false, navigating = false, lastCanReload;
  let requestController;
  const visible = () => !doc.hidden;
  const canReload = () => {
    const state = getState();
    return state.hasUnsavedProgress === false && ['welcome', 'paused', 'victory', 'defeat'].includes(state.mode);
  };
  const requestReload = () => {
    // Re-read at the moment of navigation: a menu button may outlive its safe state.
    if (stopped || navigating || !visible() || !pending || !canReload()) return false;
    navigating = true;
    const url = new URL(win.location.href);
    if (url.searchParams.get('__ritual_update') === pending) url.searchParams.set('__ritual_retry', String(Date.now()));
    url.searchParams.set('__ritual_update', pending);
    reload(url.href);
    return true;
  };
  const stateChanged = () => {
    if (stopped || navigating || !pending || !visible()) return;
    const safe = canReload();
    // The query also prevents an automatic reload loop if an intermediary still serves old HTML.
    if (safe && getState().mode === 'welcome'
      && new URL(win.location.href).searchParams.get('__ritual_update') !== pending) {
      requestReload();
    } else if (lastCanReload !== safe) {
      lastCanReload = safe;
      showUpdate({ canReload: safe, reload: requestReload });
    }
  };
  const check = () => {
    if (stopped || navigating || !visible() || !currentVersion) return Promise.resolve();
    if (inFlight) return inFlight;
    requestController = new AbortController();
    const timeout = win.setTimeout(() => requestController.abort(), 10000);
    inFlight = (async () => {
      try {
        const response = await fetchVersion(versionUrl, { cache: 'no-store', signal: requestController.signal });
        if (!response.ok) return;
        const { buildId } = await response.json();
        if (stopped || typeof buildId !== 'string' || !buildId.trim() || buildId.length > 200) return;
        if (buildId === currentVersion) {
          if (pending) { pending = null; lastCanReload = undefined; showUpdate(null); }
          return;
        }
        pending = buildId;
        stateChanged();
      } catch { /* Offline, timeout, proxy HTML or an incomplete deploy: try again later. */ }
      finally { win.clearTimeout(timeout); inFlight = null; }
    })();
    return inFlight;
  };
  const foreground = () => { if (visible()) void check(); };
  const pageshow = event => { if (event.persisted) foreground(); };
  doc.addEventListener('visibilitychange', foreground);
  win.addEventListener('pageshow', pageshow);
  const interval = win.setInterval(foreground, 180000);
  void check();
  return {
    check, stateChanged,
    stop() {
      stopped = true;
      requestController?.abort();
      win.clearInterval(interval);
      doc.removeEventListener('visibilitychange', foreground);
      win.removeEventListener('pageshow', pageshow);
    },
  };
}
