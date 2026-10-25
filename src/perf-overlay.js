const noop = () => {};
const DISABLED = Object.freeze({ enabled: false, frameStart: noop, simDone: noop, renderDone: noop, frameEnd: noop, dispose: noop });
const CAPACITY = 8192;
const FPS_WINDOW = 1000;
const FRAME_WINDOW = 5000;
const LONG_FRAME_MS = 33;
const number = value => Number.isFinite(value) && value >= 0 ? value : null;
const rounded = value => value === null ? null : Math.round(value * 1000) / 1000;
const display = value => value === null ? '—' : value.toFixed(1);
// The panel shows a scale as «×1.33»; the JSON keeps the full value.
const scale = value => value === null ? '—' : String(Math.round(value * 100) / 100);

/**
 * Opt-in phone diagnostics. Frame time is start-to-start cadence, not CPU work.
 * simDone reports accumulate within a frame; simulation/render means use only
 * reported frames in the last five seconds. No browser resources exist off opt-in.
 */
export function createPerfOverlay({ win = globalThis.window, doc = win?.document, engine, scene, enabled: wanted, getHD } = {}) {
  // The «FPS» setting passes its choice; without it, ?perf=1 or the saved choice opts in.
  let enabled = wanted ?? new URLSearchParams(win?.location?.search ?? '').get('perf') === '1';
  if (!enabled && wanted === undefined) {
    try { enabled = win?.localStorage?.getItem('ritual-perf') === '1'; } catch { /* Private mode can deny storage. */ }
  }
  if (!enabled || !doc?.body) return DISABLED;

  const clock = () => win.performance.now();
  const origin = clock();
  const renderingEngine = engine ?? scene?.getEngine?.();
  // 8192 samples cover five seconds at up to 1638 FPS, bounded even in a runaway loop.
  const timestamps = new Float64Array(CAPACITY), frames = new Float64Array(CAPACITY);
  const steps = new Float64Array(CAPACITY), simulations = new Float64Array(CAPACITY);
  const renders = new Float64Array(CAPACITY), sorted = new Float64Array(CAPACITY);
  let head = 0, count = 0, previousStart = NaN, fpsOrigin = origin;
  let frameMs = NaN, simSteps = NaN, simMs = NaN, renderMs = NaN, inFrame = false, disposed = false;
  let instrumentation = null, observer = null, longTasksSupported = false, longTaskCount = 0, longTaskMs = 0;

  // The panel starts as one «FPS 121» line; a tap on it shows the full metrics and «Копировать». It sits
  // below the top HUD row (orbs, experience, quest line and a two-line notice, which ends at 55u), so it
  // covers none of them. A page can move it with --perf-top, --perf-left and --perf-shift: mobile.css puts
  // it on the left edge under the health orb once html.touch-ui is on.
  const panel = doc.createElement('div'), toggle = doc.createElement('button');
  const metrics = doc.createElement('pre'), button = doc.createElement('button');
  let expanded = false, fpsText = '—';
  panel.setAttribute('data-perf-overlay', '');
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', 'Производительность');
  Object.assign(panel.style, {
    position: 'fixed', top: 'var(--perf-top, calc(env(safe-area-inset-top, 0px) + var(--u, 2px) * 58))',
    left: 'var(--perf-left, 50%)', transform: 'var(--perf-shift, translateX(-50%))',
    zIndex: '2147483647', width: 'max-content',
    maxWidth: 'calc(100vw - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px) - 16px)',
    padding: '5px 7px', border: '1px solid var(--stone-dark, #44394f)', borderRadius: '4px',
    background: 'var(--coal, #211a2b)', color: 'var(--ivory, #eee0ce)',
    fontFamily: 'system-ui, sans-serif', fontSize: '10px', fontWeight: '400', lineHeight: '1.35',
    pointerEvents: 'none', boxSizing: 'border-box',
  });
  Object.assign(metrics.style, { margin: '3px 0 0', font: 'inherit', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', pointerEvents: 'none' });
  toggle.type = 'button';
  toggle.setAttribute('data-perf', 'toggle');
  toggle.setAttribute('aria-label', 'Показатели производительности');
  Object.assign(toggle.style, {
    display: 'block', pointerEvents: 'auto', margin: '0', padding: '0', border: '0', background: 'none',
    font: 'inherit', fontWeight: '600', color: 'inherit', cursor: 'pointer', touchAction: 'manipulation',
  });
  button.type = 'button';
  button.setAttribute('data-perf', 'copy');
  button.textContent = 'Копировать';
  button.setAttribute('aria-label', 'Копировать показатели производительности');
  Object.assign(button.style, {
    pointerEvents: 'auto', font: 'inherit', color: 'var(--amber, #e5b66e)', background: 'var(--ink, #171321)',
    border: '1px solid var(--stone-dark, #44394f)', borderRadius: '3px', padding: '2px 7px', marginTop: '3px',
    cursor: 'pointer', touchAction: 'manipulation',
  });
  panel.append(toggle, metrics, button);
  doc.body.appendChild(panel);
  function showState() {
    // HD-2D adaptive: current host tier stays visible even with metrics collapsed.
    const hdTier = getHD?.();
    toggle.textContent = `FPS ${fpsText}${hdTier ? ` · HD ${hdTier}` : ''} ${expanded ? '▾' : '▸'}`;
    toggle.setAttribute('aria-expanded', String(expanded));
    metrics.hidden = !expanded;
    button.hidden = !expanded;
  }
  function flip(event) {
    event.preventDefault(); event.stopPropagation();
    if (disposed) return;
    expanded = !expanded;
    refresh();
  }
  toggle.addEventListener('click', flip);

  // Loading Babylon's instrumentation is deferred past opt-in. Its scene counter
  // supplies draw calls and scene CPU render time; GPU timer queries are unnecessary.
  if (scene) {
    import('@babylonjs/core/Instrumentation/sceneInstrumentation.js').then(({ SceneInstrumentation }) => {
      if (disposed || scene.isDisposed) return;
      instrumentation = new SceneInstrumentation(scene);
      instrumentation.captureFrameTime = true;
    }).catch(() => { /* Missing instrumentation must not interrupt play. */ });
  }

  const Observer = win.PerformanceObserver;
  if (Observer && (!Observer.supportedEntryTypes || Observer.supportedEntryTypes.includes('longtask'))) {
    try {
      observer = new Observer(list => {
        if (disposed) return;
        const entries = list.getEntries();
        longTaskCount += entries.length;
        for (let i = 0; i < entries.length; i++) longTaskMs += number(entries[i].duration) ?? 0;
      });
      observer.observe({ type: 'longtask', buffered: true });
      longTasksSupported = true;
    } catch {
      observer?.disconnect();
      observer = null;
    }
  }

  function snapshot() {
    const now = clock();
    let samples = 0, fpsSamples = 0, simSamples = 0, renderSamples = 0, totalSteps = 0, totalSim = 0, totalRender = 0, longFrames = 0;
    for (let i = 0; i < count; i++) {
      const index = (head - count + i + CAPACITY) % CAPACITY;
      const age = now - timestamps[index];
      if (age < 0 || age >= FRAME_WINDOW) continue;
      sorted[samples++] = frames[index];
      if (frames[index] > LONG_FRAME_MS) longFrames++;
      if (age < FPS_WINDOW) fpsSamples++;
      if (Number.isFinite(simulations[index])) {
        simSamples++; totalSteps += steps[index]; totalSim += simulations[index];
      }
      if (Number.isFinite(renders[index])) { renderSamples++; totalRender += renders[index]; }
    }
    // This view and the snapshot objects allocate only on refresh/copy, never in frame hooks.
    sorted.subarray(0, samples).sort();
    const percentile = p => samples ? rounded(sorted[Math.ceil(samples * p) - 1]) : null;
    const memory = win.performance.memory;
    return {
      version: 1,
      // HD-2D adaptive: copy the same current tier shown in the FPS line.
      hdTier: getHD?.() ?? null,
      elapsedMs: rounded(now - origin),
      windowMs: { fps: FPS_WINDOW, frame: FRAME_WINDOW },
      fps: rounded(fpsSamples * 1000 / Math.max(1, Math.min(FPS_WINDOW, now - fpsOrigin))),
      frameMs: { samples, p50: percentile(.5), p95: percentile(.95), max: samples ? rounded(sorted[samples - 1]) : null },
      longFrames: { thresholdMs: LONG_FRAME_MS, count: longFrames, windowMs: FRAME_WINDOW },
      simulation: { samples: simSamples, stepsPerFrame: simSamples ? rounded(totalSteps / simSamples) : null,
        ms: simSamples ? rounded(totalSim / simSamples) : null },
      renderMs: renderSamples ? rounded(totalRender / renderSamples) : null,
      jsHeap: memory ? { usedBytes: number(memory.usedJSHeapSize), totalBytes: number(memory.totalJSHeapSize), limitBytes: number(memory.jsHeapSizeLimit) } : null,
      devicePixelRatio: number(win.devicePixelRatio),
      canvas: { width: number(renderingEngine?.getRenderWidth?.()), height: number(renderingEngine?.getRenderHeight?.()),
        hardwareScaling: number(renderingEngine?.getHardwareScalingLevel?.()) },
      babylon: { drawCalls: number(instrumentation?.drawCallsCounter.current), activeMeshes: number(scene?.getActiveMeshes?.().length),
        totalVertices: number(scene?.getTotalVertices?.()) },
      longTasks: { supported: longTasksSupported, count: longTaskCount, totalDurationMs: rounded(longTaskMs) },
    };
  }

  function refresh() {
    if (disposed) return;
    const s = snapshot(), f = s.frameMs, sim = s.simulation, canvas = s.canvas, b = s.babylon;
    fpsText = s.fps === null ? '—' : String(Math.round(s.fps));
    showState();
    const heap = s.jsHeap ? `${display(s.jsHeap.usedBytes === null ? null : s.jsHeap.usedBytes / 1048576)} MiB` : '—';
    metrics.textContent = `FPS ${display(s.fps)} · frame 5s p50/p95/max ${display(f.p50)}/${display(f.p95)}/${display(f.max)} ms\n`
      + `long frames >${s.longFrames.thresholdMs}ms ${s.longFrames.count}/5s\n`
      + `sim ${display(sim.stepsPerFrame)} steps/frame · ${display(sim.ms)} ms · render ${display(s.renderMs)} ms\n`
      + `heap ${heap} · DPR ${s.devicePixelRatio ?? '—'} · canvas ${canvas.width ?? '—'}×${canvas.height ?? '—'} ×${scale(canvas.hardwareScaling)}\n`
      + `draw ${b.drawCalls ?? '—'} · meshes ${b.activeMeshes ?? '—'} · vertices ${b.totalVertices ?? '—'} · long tasks ${s.longTasks.supported ? s.longTasks.count : '—'}`;
  }

  function legacyCopy(json) {
    const textarea = doc.createElement('textarea'), previousFocus = doc.activeElement;
    textarea.value = json;
    textarea.setAttribute('readonly', '');
    Object.assign(textarea.style, { position: 'fixed', top: '0', left: '0', opacity: '0', pointerEvents: 'none', fontSize: '16px' });
    doc.body.appendChild(textarea);
    try {
      textarea.focus(); textarea.select();
      // Explicit range selection also supports older iOS Safari.
      textarea.setSelectionRange?.(0, json.length);
      return doc.execCommand?.('copy') === true;
    } catch { return false; }
    finally { textarea.remove(); previousFocus?.focus?.({ preventScroll: true }); }
  }

  async function copy(event) {
    event.preventDefault(); event.stopPropagation();
    if (disposed) return;
    const json = JSON.stringify(snapshot(), null, 2);
    win.console?.info('[ritual-perf]', json);
    let copied = false;
    try {
      if (win.navigator?.clipboard?.writeText) { await win.navigator.clipboard.writeText(json); copied = true; }
    } catch { /* HTTP LAN origins and denied permission need the textarea fallback. */ }
    if (disposed) return;
    if (!copied) copied = legacyCopy(json);
    button.textContent = copied ? 'Скопировано' : 'В консоли';
  }
  button.addEventListener('click', copy);

  function visibilityChanged() {
    if (disposed) return;
    // Exclude browser background throttling and the first cadence after a resume.
    count = 0; head = 0; previousStart = NaN; inFrame = false; fpsOrigin = clock();
  }
  doc.addEventListener('visibilitychange', visibilityChanged);
  refresh();
  const timer = win.setInterval(refresh, 1000);

  return {
    enabled: true,
    frameStart() {
      if (disposed || doc.hidden) return;
      const now = clock();
      frameMs = now - previousStart;
      if (!Number.isFinite(previousStart)) fpsOrigin = now;
      previousStart = now;
      simSteps = NaN; simMs = NaN; renderMs = NaN; inFrame = true;
    },
    simDone(reportedSteps, ms) {
      if (disposed || !inFrame || !Number.isInteger(reportedSteps) || number(reportedSteps) === null || number(ms) === null) return;
      simSteps = (Number.isFinite(simSteps) ? simSteps : 0) + reportedSteps;
      simMs = (Number.isFinite(simMs) ? simMs : 0) + ms;
    },
    renderDone(ms) {
      if (disposed || !inFrame || number(ms) === null) return;
      renderMs = ms;
    },
    frameEnd() {
      if (disposed || !inFrame) return;
      inFrame = false;
      if (!Number.isFinite(frameMs) || frameMs <= 0) return;
      timestamps[head] = clock(); frames[head] = frameMs; steps[head] = simSteps; simulations[head] = simMs;
      const counter = instrumentation?.frameTimeCounter;
      renders[head] = Number.isFinite(renderMs) ? renderMs : counter?.count > 0 ? counter.current : NaN;
      head = (head + 1) % CAPACITY;
      if (count < CAPACITY) count++;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      win.clearInterval(timer);
      doc.removeEventListener('visibilitychange', visibilityChanged);
      button.removeEventListener('click', copy);
      toggle.removeEventListener('click', flip);
      observer?.disconnect();
      instrumentation?.dispose();
      panel.remove();
    },
  };
}
