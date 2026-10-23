import './styles.css';
import { createAdventure, updateGame, startDash, startWave, interact, getInteractionPrompt, getObjective } from './game.js';
import { Input } from './input.js';
import { GameAudio } from './audio.js';
import { Renderer } from './render.js';
import { MotionHistory } from './render-interpolation.js';
import { appearanceOptions, appearanceVariant, normalizeAppearance } from './appearance.js';
import { MONK_RULES } from './monk-combat.js';

const $ = id => document.getElementById(id);
const canvas = $('game');
let selectedAppearance = normalizeAppearance();
let game = createRun();
let mode = 'welcome';
let renderer, input;
let worldReady = false;
let accumulator = 0, hitStop = 0, noticeTimer, endTimer;
// Fixed simulation step. Frames draw bodies blended between the last two steps, at
// accumulator / STEP. Pause and menus keep the accumulator, so the frame holds still.
const STEP = 1 / 120;
const motion = new MotionHistory();
const audio = new GameAudio();
// Sound must never stop input or the render loop: a failing call is reported once and skipped.
let audioFailed = false;
function guardAudio(call) {
  try { call(); } catch (error) {
    if (!audioFailed) console.error(error);
    audioFailed = true;
  }
}
// Footsteps read the ground's grass/soil/stone mask; without it they fall back to the area.
const groundMask = () => renderer?.scene.materials.find(material => material.metadata?.surfaceMap)?.metadata.surfaceMap;
const overlay = $('overlay');
const playButton = $('play');
const restartButton = $('restart');
const healthFill = $('health-fill');
const healthBar = $('health-bar');
const healthText = $('health-text');
const killCount = $('kill-count');
const combatState = $('combat-state');
const dashUI = $('skill-dash'), waveUI = $('skill-wave');
const comboPips = [...document.querySelectorAll('.combo-pips i')];
const appearancePicker = $('appearance-picker');
const appearanceLoading = $('appearance-loading');
const appearanceStatus = $('appearance-status');
const appearanceRetry = $('appearance-retry');
const interactionPrompt = $('interaction-prompt');
const minimap = $('minimap');
const zoneIds = ['camp', 'road', 'courtyard'];
let monsterIds = '';
document.body.classList.add('menu-open');

for (const [key, options] of [['skin', appearanceOptions.skins], ['hair', appearanceOptions.hair], ['sash', appearanceOptions.sashes]]) {
  for (const option of options) {
    const label = document.createElement('label');
    label.className = 'appearance-choice';
    label.title = option.label;
    const radio = document.createElement('input');
    radio.type = 'radio'; radio.name = key; radio.value = option.id;
    radio.checked = selectedAppearance[key] === option.id;
    const chip = document.createElement('span');
    chip.className = `appearance-chip ${key === 'hair' ? 'hair-chip' : 'color-chip'}`;
    if (key !== 'hair') {
      const color = document.createElement('i');
      color.className = `choice-color ${key}-${option.id}`;
      color.setAttribute('aria-hidden', 'true');
      chip.append(color);
    }
    const text = document.createElement('span');
    text.className = key === 'hair' ? '' : 'sr-only';
    text.textContent = option.label;
    chip.append(text); label.append(radio, chip);
    $(`${key}-options`).append(label);
  }
}

function updateAppearance() {
  const variant = appearanceVariant(selectedAppearance);
  const skin = appearanceOptions.skins.find(option => option.id === selectedAppearance.skin).label;
  const hair = appearanceOptions.hair.find(option => option.id === selectedAppearance.hair).label;
  const sash = appearanceOptions.sashes.find(option => option.id === selectedAppearance.sash).label;
  const description = `Кожа: ${skin.toLowerCase()}. ${hair}. Пояс: ${sash.toLowerCase()}.`;
  // Assign the newest source directly: no older load callback may restore an earlier choice.
  $('appearance-preview').src = variant.previewUrl;
  $('appearance-preview').alt = description;
  $('hero-portrait').src = variant.previewUrl;
  $('appearance-description').textContent = description;
  $('skin-value').textContent = skin;
  $('sash-value').textContent = sash;
  game.appearance = normalizeAppearance(selectedAppearance);
  updateAppearanceStatus();
}

function updateAppearanceStatus() {
  // Query the current choice even before its first render: an older, loaded
  // atlas must never confirm a new selection or a late retry response.
  const status = renderer ? renderer.getAppearanceStatus(game).status : 'loading';
  const ready = worldReady && status === 'ready';
  playButton.disabled = restartButton.disabled = !ready;
  appearanceLoading.hidden = status === 'ready';
  const message = status === 'error' ? 'Не удалось загрузить облик.' : status === 'loading' ? 'Загружаем облик…' : '';
  if (appearanceStatus.textContent !== message) appearanceStatus.textContent = message;
  appearanceRetry.hidden = appearanceRetry.disabled = status !== 'error';
  if (mode === 'welcome') playButton.firstElementChild.textContent = worldReady ? 'Начать путь' : 'Пробуждаем мир…';
  return ready;
}

appearancePicker.addEventListener('change', event => {
  const { target } = event;
  if (mode !== 'welcome' || !target.matches('input[type="radio"]:checked')) return;
  selectedAppearance = normalizeAppearance({ ...selectedAppearance, [target.name]: target.value });
  updateAppearance();
});
appearanceRetry.addEventListener('click', () => {
  if (mode !== 'welcome' || !renderer || renderer.getAppearanceStatus(game).status !== 'error') return;
  const pending = renderer.retryAppearance(game);
  updateAppearanceStatus();
  // Both outcomes re-read the latest selection instead of applying old status.
  pending.then(updateAppearanceStatus, updateAppearanceStatus);
});
updateAppearance();

function notice(message) {
  clearTimeout(noticeTimer);
  $('notice').textContent = message;
  $('notice').classList.add('show');
  noticeTimer = setTimeout(() => $('notice').classList.remove('show'), 3200);
}

function showPanel(nextMode) {
  mode = nextMode;
  input?.clear(); hitStop = 0;
  overlay.classList.remove('closed');
  overlay.inert = false;
  document.body.classList.add('menu-open');
  appearancePicker.hidden = nextMode !== 'welcome';
  restartButton.hidden = nextMode !== 'paused';
  $('pause-controls').hidden = nextMode !== 'paused';
  $('entry-hint').hidden = nextMode === 'paused';
  const ended = nextMode === 'defeat' || nextMode === 'victory';
  $('run-summary').hidden = !ended;
  $('run-trophy').hidden = nextMode !== 'victory' || !game.adventure.rewardCollected;
  if (ended) {
    const seconds = Math.floor(game.adventure.elapsed);
    $('summary-time').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    $('summary-kills').textContent = game.adventure.totalKills;
    $('summary-secret').textContent = game.adventure.secretFound ? 'Найден' : 'Не найден';
    $('summary-places').textContent = game.adventure.visited.length;
  }
  if (nextMode === 'paused') {
    $('panel-eyebrow').textContent = 'КОРОТКАЯ ПЕРЕДЫШКА';
    $('panel-title').innerHTML = 'Сохрани<br/> дыхание';
    $('panel-copy').textContent = 'Мир подождёт. Продолжай, когда будешь готов.';
    playButton.firstElementChild.textContent = 'Продолжить';
  } else if (nextMode === 'defeat') {
    $('panel-eyebrow').textContent = 'ПУТЬ ЕЩЁ НЕ ОКОНЧЕН';
    $('panel-title').innerHTML = 'Пепел<br/> помнит тебя';
    $('panel-copy').textContent = `Здесь путь оборвался: ${currentArea().title.toLowerCase()}. Собирай дух ударами и разрывай окружение волной или рывком.`;
    playButton.firstElementChild.textContent = 'Попробовать снова';
    $('entry-hint').textContent = 'Новый путь с тем же обликом. Все встречи начнутся заново.';
  } else if (nextMode === 'victory') {
    $('panel-eyebrow').textContent = 'ВОЗВРАЩЕНИЕ К ОГНЮ';
    $('panel-title').innerHTML = 'Тишина<br/> возвращается';
    $('panel-copy').textContent = 'Источник ритуала разрушен. Ты вернулся к огню и получил янтарную бусину.';
    playButton.firstElementChild.textContent = 'Пройти ещё раз';
    $('entry-hint').textContent = 'Трофей этого пути. Облик сохранится при повторе.';
  }
  updateHud();
  updateAppearanceStatus();
  playButton.focus({ preventScroll: true });
}

function createRun() {
  const replay = new URLSearchParams(window.location.search).get('seed');
  const seed = replay !== null && /^\d+$/.test(replay) && Number(replay) <= 0xffffffff
    ? Number(replay) : crypto.getRandomValues(new Uint32Array(1))[0];
  const run = createAdventure(normalizeAppearance(selectedAppearance), { seed });
  canvas.setAttribute('data-run-seed', String(run.seed));
  return run;
}

function begin(fresh = false) {
  if (!updateAppearanceStatus()) return;
  if (fresh || mode === 'welcome' || game.phase !== 'playing') {
    game = createRun(); accumulator = 0;
    clearTimeout(endTimer);
    notice('Следуй по дороге к монастырю · ЛКМ — удары, ПКМ — волна');
  }
  mode = 'playing'; hitStop = 0;
  input.clear(); guardAudio(() => audio.unlock());
  overlay.classList.add('closed'); overlay.inert = true;
  document.body.classList.remove('menu-open');
  updateHud();
  canvas.focus({ preventScroll: true });
}

function togglePause() {
  if (mode === 'playing' && game.phase === 'playing') showPanel('paused');
  else if (mode === 'paused') begin();
}
function toggleSound() {
  audio.setMuted(!audio.muted);
  $('sound').setAttribute('aria-pressed', String(audio.muted));
  $('sound').setAttribute('aria-label', audio.muted ? 'Включить звук' : 'Выключить звук');
  $('sound').title = `${audio.muted ? 'Включить' : 'Выключить'} звук (M)`;
}

playButton.addEventListener('click', () => begin());
restartButton.addEventListener('click', () => begin(true));
$('pause').addEventListener('click', togglePause);
$('sound').addEventListener('click', toggleSound);
window.addEventListener('keydown', e => {
  if (mode !== 'playing' && e.code === 'Tab') {
    const focusable = [...overlay.querySelectorAll('button:not([disabled]), input:checked')]
      .filter(element => !element.hidden && element.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (first && (!focusable.includes(document.activeElement) || (e.shiftKey ? document.activeElement === first : document.activeElement === last))) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
  }
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === 'Escape') { e.preventDefault(); togglePause(); }
  if (e.code === 'KeyM') toggleSound();
});
window.addEventListener('blur', () => { if (mode === 'playing' && game.phase === 'playing') showPanel('paused'); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && mode === 'playing' && game.phase === 'playing') showPanel('paused');
});

function currentArea() {
  return game.world.zones?.find(zone => zone.id === game.locationId) ?? game.world;
}

// The map frame shows the canvas at half size and crops render.js captions, which the
// HUD shows itself. Keep a 2× backing store so the tile band fills the frame exactly.
function fitMinimap() {
  const width = Math.round(minimap.clientWidth * 2), height = Math.round(minimap.clientHeight * 2);
  if (width > 0 && height > 0 && (minimap.width !== width || minimap.height !== height)) {
    minimap.width = width; minimap.height = height;
  }
}

function updateHud() {
  const p = game.player;
  const area = currentArea();
  healthFill.style.width = `${p.hp / p.maxHp * 100}%`;
  healthBar.setAttribute('aria-valuenow', p.hp);
  healthBar.setAttribute('aria-valuemax', p.maxHp);
  healthText.innerHTML = `${p.hp} <i>/ ${p.maxHp}</i>`;
  const spirit = p.spirit ?? MONK_RULES.spirit.initial;
  const maxSpirit = p.maxSpirit ?? MONK_RULES.spirit.max;
  $('spirit-fill').style.width = `${spirit / maxSpirit * 100}%`;
  $('spirit-bar').setAttribute('aria-valuenow', spirit);
  $('spirit-bar').setAttribute('aria-valuemax', maxSpirit);
  $('spirit-text').textContent = `${spirit} / ${maxSpirit}`;
  waveUI.classList.toggle('insufficient', spirit < MONK_RULES.wave.cost);
  $('wave-cost').textContent = String(MONK_RULES.wave.cost);
  waveUI.title = `Волна духа · ${MONK_RULES.wave.cost} духа · ПКМ / Q`;
  const monsters = game.enemies.filter(enemy => enemy.kind !== 'ritual'
    && (!enemy.zoneId || enemy.zoneId === game.locationId));
  const remaining = monsters.filter(enemy => enemy.hp > 0).length;
  const ids = `${game.locationId}:${monsters.map(enemy => enemy.id).join(',')}`;
  if (ids !== monsterIds) {
    $('kill-dots').replaceChildren(...monsters.map(() => document.createElement('i')));
    monsterIds = ids;
  }
  killCount.textContent = monsters.length ? `${remaining} / ${monsters.length}` : '';
  $('encounter-label').textContent = monsters.length ? 'Осталось здесь' : 'Безопасная стоянка';
  $('kill-dots').hidden = monsters.length === 0;
  [...$('kill-dots').children].forEach((dot, i) => dot.classList.toggle('done', monsters[i].hp <= 0));
  $('total-kills').textContent = game.adventure.totalKills;
  $('location-title').textContent = area.title;
  $('location-title').title = area.subtitle;
  minimap.setAttribute('aria-label', `Карта: ${area.title}`);
  for (const id of zoneIds) {
    const zone = $(`zone-${id}`);
    zone.classList.toggle('current', id === game.locationId);
    zone.classList.toggle('visited', !!game.adventure.visited?.includes(id));
    zone.setAttribute('aria-current', id === game.locationId ? 'location' : 'false');
  }
  combatState.textContent = p.hp < 35 ? 'ДЫШИ. И ПРОДОЛЖАЙ.' : p.invulnerable > 0 ? 'СОБЕРИСЬ' : 'ДЫХАНИЕ РОВНОЕ';
  combatState.classList.toggle('warning', p.hp < 35);
  for (const [element, current, max] of [[dashUI, p.dashCooldown, MONK_RULES.dash.cooldown], [waveUI, p.waveCooldown, MONK_RULES.wave.cooldown]]) {
    element.querySelector('.skill-shade').style.height = `${current / max * 100}%`;
    element.querySelector('.cooldown').textContent = current > .05 ? current.toFixed(1) : '';
  }
  comboPips.forEach((pip, i) => pip.classList.toggle('on', !!p.attack && i <= p.attack.index));
  const objective = getObjective(game);
  $('quest-title').textContent = objective.title;
  $('quest-copy').textContent = objective.copy;
  const prompt = mode === 'playing' && game.phase === 'playing' ? getInteractionPrompt(game) : '';
  interactionPrompt.hidden = !prompt;
  const promptCopy = prompt.replace(/^E\s*[—–:-]\s*/, '');
  if ($('interaction-copy').textContent !== promptCopy) $('interaction-copy').textContent = promptCopy;
}

updateHud();

try {
  fitMinimap();
  renderer = new Renderer(canvas, $('effects'), minimap, game);
  input = new Input(canvas, renderer, () => mode === 'playing' && game.phase === 'playing');
  window.addEventListener('resize', () => { fitMinimap(); renderer.resize(); });
  let last = performance.now(), lastHud = 0;
  renderer.engine.runRenderLoop(() => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, .05); last = now;
    game.events.length = 0;
    if (mode === 'playing' && game.phase === 'playing') {
      const controls = input.sample(game.player);
      let ended = false;
      for (const action of controls.actions) {
        if (action === 'dash') {
          const moving = Math.hypot(controls.moveX, controls.moveY) > .01;
          startDash(game, moving ? controls.moveX : controls.aimX, moving ? controls.moveY : controls.aimY);
        } else if (action === 'wave') {
          if (!startWave(game) && game.player.spirit < MONK_RULES.wave.cost) {
            notice('Нужно больше духа · попадай обычными ударами');
          }
        }
        else if (action === 'interact') {
          interact(game);
          if (game.phase !== 'playing') {
            input.clear(); hitStop = 0;
            ended = true;
            break;
          }
        }
      }
      if (ended) updateHud();
      else if (hitStop > 0) hitStop -= dt;
      else {
        accumulator += dt;
        while (accumulator >= STEP) {
          motion.capture(game);
          updateGame(game, controls, STEP);
          accumulator -= STEP;
        }
      }
      for (const event of game.events) {
        if (event.type === 'impact' && !renderer.reducedMotion) {
          hitStop = Math.max(hitStop, event.strength === 'heavy' ? .045 : .015);
        }
        if (event.type === 'heal' && event.source !== 'pickup') notice('Святилище возвращает силы');
        if (event.type === 'area-enter') notice(`${currentArea().title} · ${currentArea().subtitle}`);
        if (event.type === 'secret') notice('Найден тайник забытой тропы');
        if (event.type === 'ritual-open') notice('Печать пала. Разбей источник ударами.');
        if (event.type === 'ritual-destroyed') notice('Источник разрушен. Вернись к огню в лагере.');
        if (event.type === 'reward') notice('Янтарная бусина получена · путь завершён');
      }
      if (game.phase !== 'playing') {
        input.clear();
        endTimer = setTimeout(() => showPanel(game.phase), 850);
      }
    }
    // Every mode: this frame's events, footsteps, and music that ducks in pause.
    guardAudio(() => audio.frame(game, groundMask, mode));
    renderer.render(game, dt, mode, motion.blend(game, accumulator / STEP));
    if (mode === 'welcome') updateAppearanceStatus();
    if (now - lastHud > 70) { updateHud(); lastHud = now; }
  });
  renderer.ready.then(() => {
    worldReady = true;
    updateAppearanceStatus();
  }).catch(error => {
    console.error(error);
    renderer.engine.stopRenderLoop();
    appearancePicker.hidden = true;
    $('panel-title').textContent = 'Не удалось загрузить мир';
    $('panel-copy').textContent = 'Один из игровых ресурсов не загрузился. Обнови страницу, чтобы попробовать снова.';
    playButton.hidden = true;
  });
} catch (error) {
  console.error(error);
  appearancePicker.hidden = true;
  $('panel-title').textContent = 'Не удалось открыть мир';
  $('panel-copy').textContent = 'Для игры нужен браузер с WebGL. Включи аппаратное ускорение или попробуй актуальную версию Chrome, Edge, Firefox или Safari.';
  playButton.hidden = true;
}
