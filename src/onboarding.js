import { unspentPoints } from './progression.js';
import { slotStates } from './run-progress.js';

export const ONBOARDING_KEY = 'ritual-onboarding-v1';
const STEPS = ['welcome', 'move', 'attack', 'dash', 'technique', 'pickup', 'points', 'site', 'orientation'];
const TECHNIQUES = new Set(['wave', 'palm', 'crane', 'deflect']);

// No clocks, DOM or game mutations: the caller supplies elapsed visible play time and observations.
export function createOnboarding(storage) {
  let completed = new Set(), finished = false, active = null, shownAt = 0;
  try {
    const saved = JSON.parse(storage?.getItem(ONBOARDING_KEY) ?? 'null');
    if (saved?.version === 1 && Array.isArray(saved.completed)) {
      completed = new Set(saved.completed.filter(id => STEPS.includes(id)));
      finished = saved.finished === true || completed.size === STEPS.length;
    }
  } catch { /* Storage may be denied or contain an interrupted write. */ }
  const persist = () => {
    try { storage?.setItem(ONBOARDING_KEY, JSON.stringify({ version: 1, completed: [...completed], finished })); } catch { /* Page-local progress still works. */ }
  };
  const done = id => {
    if (active !== id) return;
    completed.add(id); active = null;
    finished = completed.size === STEPS.length;
    persist();
  };
  const accomplished = (id, state) => ({
    move: state.distance >= 3, attack: state.hits > 0, dash: state.dashes > 0,
    technique: state.techniques > 0, pickup: state.pickups > 0,
    points: state.panelOpen, site: state.sitesUsed > 0,
  })[id] === true;
  return {
    get finished() { return finished; },
    observe(state = {}) {
      if (finished || !state.started || state.restored || state.visible === false) return null;
      if (active && (accomplished(active, state) || (active !== 'welcome' && state.now - shownAt >= 8))) done(active);
      if (finished) return null;
      if (!active) {
        const after = id => completed.has(id);
        const ready = {
          welcome: true,
          move: after('welcome'),
          attack: after('move') && state.nearestMonster <= 8,
          dash: after('attack') && state.hits > 0,
          technique: after('dash') && state.techniqueReady,
          pickup: after('technique') && (state.groundItems > 0 || state.pickups > 0),
          points: after('technique') && state.levelUps > 0 && state.points > 0,
          site: after('technique') && !!state.nearSite,
          orientation: after('technique') && state.packsCleared > 0,
        };
        active = STEPS.find(id => !after(id) && ready[id]) ?? null;
        shownAt = state.now ?? 0;
      }
      return active ? cardFor(active, state) : null;
    },
    done,
    skip() { finished = true; active = null; persist(); },
    reset() {
      completed = new Set(); finished = false; active = null; shownAt = 0;
      try { storage?.removeItem(ONBOARDING_KEY); } catch { /* Reset also works without storage. */ }
    },
  };
}

function cardFor(id, state) {
  const keys = state.keys ?? {}, touch = state.inputMode === 'touch', pad = state.inputMode === 'pad';
  const shrine = state.nearSite === 'shrine';
  const cards = {
    welcome: ['Ночной ритуал', 'Дойди до источника и разбей ритуал.', keys['nav:ok']],
    move: ['В путь', touch ? 'Стик слева — идти.' : `${keys.move} — идти.`, keys.move],
    attack: ['Серия ударов', touch ? `Держи ${keys.attack} справа.` : `${keys.attack} по врагу — серия ударов.`, keys.attack],
    dash: ['Сквозь врагов', `${keys.dash} — рывок сквозь врагов.`, keys.dash],
    technique: ['Сила духа', `${touch ? 'Кнопка ' : ''}${keys['slot:rmb']} — техника, тратит дух.`, keys['slot:rmb']],
    pickup: ['Находка', 'Подойди к предмету — монах поднимет его.', keys.move],
    points: ['Новый уровень', `Вложи очко пути — ${keys.path}.`, keys.path],
    site: [shrine ? 'Святилище' : 'Тайник', shrine ? 'Подойди — святилище вернёт здоровье.'
      : touch ? `Подойди и нажми «${keys.interact}».` : `Подойди и открой — ${keys.interact}.`, shrine ? keys.move : keys.interact],
    orientation: ['Держи курс', touch ? `Цель — вверху, карта — в меню ${keys.pause}.` : 'Цель — слева вверху, карта — справа вверху.', touch ? keys.pause : '↖  ↗'],
  };
  const [title, text, glyph] = cards[id];
  return { id, title, text, glyph: glyph ?? '', pause: id === 'welcome', inputMode: touch ? 'touch' : pad ? 'pad' : 'keyboard',
    icon: ({ attack: 'combo', dash: 'dash', technique: 'wave' })[id] ?? null,
    target: id === 'points' ? '#level-points-button, #point-mark' : null };
}

// Read existing simulation output. The session belongs to this UI, never to the saved/game state.
export function onboardingState(game, session) {
  for (const event of game.events ?? []) {
    if ((event.type === 'impact' || event.type === 'block') && event.source === 'combo') session.hits++;
    if (event.type === 'dash') session.dashes++;
    if (TECHNIQUES.has(event.type)) session.techniques++;
    if (event.type === 'loot-pickup' && event.source !== 'camp-supplies') session.pickups++;
    if (event.type === 'level-up') session.levelUps++;
    if (event.type === 'secret' || (event.type === 'heal' && event.source === 'shrine')) session.sitesUsed++;
    if (event.type === 'pack-cleared') session.packsCleared++;
  }
  const p = game.player, world = game.world ?? {};
  let nearestMonster = Infinity, nearSite = null, nearestSite = 5;
  for (const enemy of game.enemies) {
    if (enemy.hp > 0 && enemy.kind !== 'ritual') nearestMonster = Math.min(nearestMonster, Math.hypot(enemy.x - p.x, enemy.y - p.y));
  }
  const checkSite = (site, kind) => {
    const distance = Math.hypot(site.x - p.x, site.y - p.y);
    if (distance <= nearestSite) { nearestSite = distance; nearSite = kind; }
  };
  for (const site of world.caches ?? []) if (!game.adventure?.cachesFound?.includes(site.id)) checkSite(site, 'cache');
  for (const site of world.shrines ?? []) if (!game.shrinesUsed?.includes(site.id) && p.hp < p.maxHp) checkSite(site, 'shrine');
  return { ...session, distance: Math.max(0, p.distance - session.distance), nearestMonster, nearSite,
    groundItems: game.groundItems?.length ?? 0, points: unspentPoints(game.progression),
    techniqueReady: slotStates(game).some(slot => slot.slot === 'rmb' && slot.ready) };
}

// A DOM adapter keeps the hooks in main.js local. Only the welcome card gates simulation.
export function createOnboardingUI({ root, replay, doc = document, onRelease = () => {}, storage } = {}) {
  if (storage === undefined) { try { storage = globalThis.localStorage; } catch { /* SecurityError from the getter. */ } }
  const machine = createOnboarding(storage);
  let run = null, session = null, current = null, clock = 0, highlighted = null, signature = '';
  root.innerHTML = '<div class="onboarding-card" role="status" aria-live="polite" aria-atomic="true">'
    + '<span class="onboarding-glyph" aria-hidden="true"></span><div class="onboarding-copy"><strong></strong><p></p></div>'
    + '<div class="onboarding-actions"><button class="onboarding-start" type="button">Начать</button>'
    + '<button class="onboarding-skip" type="button">Пропустить обучение</button></div></div>';
  const pointer = doc.createElement('i'); pointer.className = 'onboarding-pointer'; pointer.hidden = true; root.after(pointer);
  const card = root.firstElementChild, glyph = root.querySelector('.onboarding-glyph');
  const start = root.querySelector('.onboarding-start'), skip = root.querySelector('.onboarding-skip');
  const unpoint = () => { highlighted?.classList.remove('onboarding-target'); highlighted = null; pointer.hidden = true; };
  const hide = () => { root.hidden = true; unpoint(); };
  const release = () => { current = null; signature = ''; hide(); onRelease(); };
  start.addEventListener('click', () => { machine.done('welcome'); release(); });
  skip.addEventListener('click', () => { machine.skip(); release(); });
  replay?.addEventListener('click', () => {
    machine.reset(); run = null; session = null; current = null; clock = 0; hide();
    replay.textContent = 'Начнётся после паузы';
  });
  const newSession = game => {
    run = game; clock = 0; current = null; signature = '';
    session = { distance: game.player.distance, hits: 0, dashes: 0, techniques: 0, pickups: 0,
      levelUps: 0, sitesUsed: 0, packsCleared: 0 };
    if (replay) replay.textContent = 'Пройти заново';
  };
  return {
    get paused() { return current?.pause === true; },
    startRun(game) { newSession(game); },
    menu(action) {
      if (!current?.pause || root.hidden) return false;
      if (action === 'nav:ok') start.click();
      else if (action === 'nav:back') skip.click();
      else if (action.startsWith('nav:')) (doc.activeElement === start ? skip : start).focus();
      return true;
    },
    update(game, { mode, keys, inputMode, dt = 0, hidden = false } = {}) {
      if (mode !== 'playing' || game.phase !== 'playing' || hidden) { hide(); return; }
      // An explicit replay can start in the existing run. Restored runs never call startRun.
      if (!session && replay?.textContent === 'Начнётся после паузы') newSession(game);
      if (run !== game || !session || machine.finished) { current = null; hide(); return; }
      clock += Math.min(dt, .05);
      current = machine.observe({ ...onboardingState(game, session), now: clock, started: true,
        visible: true, keys, inputMode, panelOpen: false });
      if (!current) { signature = ''; hide(); return; }
      const nextSignature = JSON.stringify(current);
      if (nextSignature !== signature) {
        const firstWelcome = current.pause && !signature;
        signature = nextSignature;
        root.dataset.step = current.id;
        card.querySelector('strong').textContent = current.title;
        card.querySelector('p').textContent = current.text;
        glyph.replaceChildren();
        if (inputMode === 'touch' && current.icon) {
          const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('viewBox', '0 0 24 24');
          const use = doc.createElementNS('http://www.w3.org/2000/svg', 'use');
          use.setAttribute('href', `#icon-${current.icon}`); svg.append(use); glyph.append(svg);
        }
        const keycap = doc.createElement('kbd'); keycap.textContent = current.glyph; glyph.append(keycap);
        start.hidden = !current.pause;
        root.classList.toggle('onboarding-welcome', current.pause);
        root.hidden = false;
        if (firstWelcome) start.focus({ preventScroll: true });
      }
      root.hidden = false;
      unpoint();
      if (current.target) {
        highlighted = [...doc.querySelectorAll(current.target)].find(element => !element.hidden && element.getClientRects().length) ?? null;
        highlighted?.classList.add('onboarding-target');
        if (highlighted) {
          const box = highlighted.getBoundingClientRect();
          const height = doc.defaultView?.visualViewport?.height ?? doc.documentElement.clientHeight;
          const above = box.bottom + 18 > height;
          pointer.style.left = `${box.left + box.width / 2}px`;
          pointer.style.top = `${above ? box.top - 14 : box.bottom + 6}px`;
          pointer.style.transform = `translateX(-50%)${above ? ' rotate(180deg)' : ''}`;
          pointer.hidden = false;
        }
      }
    },
    panelOpened() { if (current?.id === 'points') { machine.done('points'); current = null; signature = ''; hide(); } },
  };
}

// The optional HUD owns its controller. The step machine remains usable without a document.
const onboardingRoot = globalThis.document?.getElementById('onboarding');
if (onboardingRoot) {
  onboardingRoot.controller = createOnboardingUI({ root: onboardingRoot, replay: document.getElementById('onboarding-replay'),
    onRelease: () => onboardingRoot.dispatchEvent(new Event('onboarding-release')) });
}
