import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as B from '@babylonjs/core';
import * as pixels from '../src/pixel-scene.js';
import * as animation from '../src/pixel-animation.js';
import * as picking from '../src/pixel-picking.js';
import * as world from '../src/world.js';
import * as campaign from '../src/campaign.js';
import * as appearance from '../src/appearance.js';
import * as gameApi from '../src/game.js';
import { Input } from '../src/input.js';
import { MotionHistory } from '../src/render-interpolation.js';
import { MONK_RULES } from '../src/monk-combat.js';
import { getOverworldZone } from '../src/overworld.js';
import { PROGRESSION_RULES, damageMultiplier, unspentPoints, xpProgress } from '../src/progression.js';
import { SKILLS, SLOTS, createLoadout } from '../src/skills.js';
import { gainXp, skillParams, slotStates, spendPathPoint } from '../src/run-progress.js';
import { RARITIES, comboStats, createItem, weaponCombo } from '../src/items.js';
import { PanelController, pauseLegend } from '../src/monk-panel.js';
import { physicalCode } from '../src/key-codes.js';
import { GamepadInput, controlKeys, slotKey } from '../src/gamepad.js';
import { TouchInput } from '../src/touch.js';
import { createPerfOverlay } from '../src/perf-overlay.js';
import * as crowdFixture from '../scripts/crowd-fixture.js';
import { createVersionCheck } from '../src/version-check.js';
import { createVersionNotice } from '../src/version-notice.js';
import { createRunAutosave, readSave, restoreRun } from '../src/save-game.js';
import { LevelUpLight } from '../src/level-up-fx.js';
import { createHD2D } from '../src/hd2d/index.js';
import { createAdaptiveHD } from '../src/hd2d/adaptive.js';
import * as staticSpriteState from '../src/static-sprite-state.js';
import { createTierSettings, saveTierSettings, normalizeSettings } from '../src/hd2d/tiers.js';

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const executable = path => source(path).replace(/^import[\s\S]*?;\n/gm, '').replace(/^export /gm, '').replaceAll('import.meta.env.BASE_URL', JSON.stringify('/'));
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Execute the production UI, renderer and texture controller together. Only
// transport, browser DOM/audio and the GPU are replaced, as in the review probe.
function harness(t, { search = '', seeds = [111, 222, 333, 444], audioFailure = null, holdPreload = false, preloadFails = false,
  storage = {}, storageFails = false, coarse = false, phone = false } = {}) {
  let document;
  const context = new Proxy({ canvas: { width: 360, height: 280 } }, {
    get: (object, key) => object[key] ?? (() => key === 'createRadialGradient' ? { addColorStop() {} } : undefined),
  });
  // Inline style keeps plain properties; custom properties go through setProperty, as in the browser.
  class Style {
    setProperty(name, value) { this[name] = String(value); }
    getPropertyValue(name) { return this[name] ?? ''; }
  }
  class Element extends EventTarget {
    constructor(tagName = 'DIV') {
      super();
      Object.assign(this, { tagName, style: new Style(), children: [], hidden: false, disabled: false, textContent: '', attrs: {}, parts: {} });
      const classes = new Set();
      this.classList = { add: name => classes.add(name), remove: name => classes.delete(name),
        toggle: (name, on) => on ? classes.add(name) : classes.delete(name), contains: name => classes.has(name) };
    }
    append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
    get firstElementChild() { return this.children[0]; }
    setAttribute(name, value) { this.attrs[name] = value; }
    getAttribute(name) { return name in this.attrs ? String(this.attrs[name]) : null; }
    querySelector(selector) { return this.parts[selector] ??= new Element(); }
    querySelectorAll() { return []; }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    focus() { document.activeElement = this; }
    click() { this.dispatchEvent(new Event('click')); }
    contains(node) { for (let item = node; item; item = item.parentElement) if (item === this) return true; return false; }
    matches(selector) { return selector === 'input[type="radio"]:checked' && this.tagName === 'INPUT' && this.type === 'radio' && this.checked; }
    getClientRects() { return this.hidden ? [] : [1]; }
    getContext() { return context; }
  }
  // Read actual HTML hooks/initial visibility so a missing recovery control
  // cannot silently pass through an auto-created fake getElementById result.
  const elements = new Map();
  for (const match of source('../index.html').matchAll(/<(\w+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const element = new Element(match[1].toUpperCase());
    element.hidden = /(?:^|\s)hidden(?:\s|=|$)/.test(match[2]);
    element.disabled = /(?:^|\s)disabled(?:\s|=|$)/.test(match[2]);
    elements.set(match[3], element);
  }
  const $ = id => elements.get(id) || null;
  $('play').append(new Element('SPAN'));
  document = Object.assign(new EventTarget(), {
    body: new Element('BODY'), documentElement: { clientWidth: 1440, clientHeight: 900 },
    getElementById: $, createElement: tag => new Element(tag.toUpperCase()),
    querySelector: () => ({ content: 'test-v1' }), baseURI: 'http://game.test/',
    querySelectorAll: () => [new Element(), new Element(), new Element()],
  });
  const previousWindow = globalThis.window;
  const window = globalThis.window = new EventTarget();
  window.location = { search, href: `http://game.test/${search}` };
  window.fetch = async () => new Response('{"buildId":"test-v1"}');
  window.setTimeout = setTimeout; window.clearTimeout = clearTimeout;
  window.performance = performance;
  window.setInterval = setInterval; window.clearInterval = clearInterval;
  // iPhone Safari's visible part: its toolbars resize and move it without a window resize.
  window.visualViewport = new EventTarget();
  // The options of every window listener, to tell a passive one.
  const listening = [], listen = window.addEventListener.bind(window);
  window.addEventListener = (type, listener, options) => { listening.push({ type, options }); listen(type, listener, options); };
  const worldLoad = deferred(), requests = [], errors = [];
  class TestEngine extends B.NullEngine {
    constructor() { super({ renderWidth: 720, renderHeight: 450 }); }
    createCanvas(width, height) { return { width, height, getContext: () => context }; }
    runRenderLoop(callback) { this.tick = callback; }
    stopRenderLoop() { this.stopped = true; }
  }
  const renderDeps = {
    ...B, ...pixels, ...animation, ...picking, ...staticSpriteState, createHD2D,
    Engine: TestEngine, isWalkable: world.isWalkable, clearLine: world.clearLine,
    WRAITH_TIMINGS: campaign.WRAITH_TIMINGS, WRAITH_STATS: campaign.WRAITH_STATS,
    BEETLE_TIMINGS: campaign.BEETLE_TIMINGS, BEETLE_STATS: campaign.BEETLE_STATS,
    appearanceVariant: appearance.appearanceVariant, MONK_RULES, getOverworldZone, LevelUpLight, document, matchMedia: () => ({ matches: false }),
    loadPixelAssets(scene) {
      return { ...Object.fromEntries(Object.entries(pixels.pixelAtlases)
        .map(([name, atlas]) => [name, { ...atlas, texture: new B.Texture(null, scene) }])), ready: worldLoad.promise };
    },
    loadAppearanceTexture(scene, url) {
      const load = deferred();
      requests.push({ url, resolve: () => load.resolve(new B.Texture(null, scene)), reject: load.reject });
      return load.promise;
    },
  };
  const Renderer = new Function(...Object.keys(renderDeps), `${executable('../src/render.js')}\nreturn Renderer;`)(...Object.values(renderDeps));
  Renderer.prototype.resize = function() {
    this.width = 720; this.height = 450;
    Object.assign(this.camera, { orthoLeft: -720 / 64, orthoRight: 720 / 64, orthoTop: 450 / 64, orthoBottom: -450 / 64 });
  };
  Renderer.prototype.drawOverlay = Renderer.prototype.drawMap = function() {};
  // These UI fixtures use unloaded NullEngine textures. Real shader/resource warmup has its own runtime-resource-cost tests.
  Renderer.prototype.warmPrograms = function() {};
  // The first unlock creates the context, as audio.js does; a test sets its state as iOS would.
  const sounds = [];
  class GameAudio {
    constructor() { this.muted = false; this.context = null; this.unlocks = 0; sounds.push(this); }
    unlock() {
      if (audioFailure) throw audioFailure;
      this.unlocks += 1;
      this.context ??= { state: 'running', resumes: 0, resume() { this.resumes += 1; this.state = 'running'; return Promise.resolve(); } };
    }
    play() {}
    frame() { if (audioFailure) throw audioFailure; }
    setMuted(value) { this.muted = value; }
  }
  // The fake DOM cannot draw the «Монах» panel: this stand-in keeps the real controller and only skips drawing.
  class MonkPanel {
    constructor(root, { getGame }) { this.root = root; this.controller = new PanelController(getGame); }
    get isOpen() { return this.controller.isOpen; }
    get tab() { return this.controller.tab; }
    open(tab) { this.controller.open(tab); this.root.hidden = false; }
    close() { this.controller.close(); this.root.hidden = true; }
    key(event) { const result = this.controller.key(physicalCode(event), { shift: !!event.shiftKey }); if (result === 'close') this.close(); return result; }
    reset() { this.controller.reset(); this.root.hidden = true; }
    observe(events) { this.controller.observe(events); }
    moveFocus() {}
    setKeys(keys) { this.controller.keys = keys; }
    holdDrop(target) { this.holds.push(target); return target?.dataset?.bag !== undefined; }
    release() { this.releases++; }
    holds = []; releases = 0;
  }
  // The fake DOM has no touch layer: this stand-in never starts, like a desktop without a touch screen.
  // A test sets blocked as the real layer does under «Поверни телефон» and «Экран слишком мал».
  class TouchUI {
    active = false; compactLoot = false; blocked = false;
    attach() { return this; }
    update() {}
    release() {}
    aimView() { return null; }
  }
  // The fake DOM has no splash to draw (tests/boot-splash.test.js covers it): this stand-in records what main.js reports.
  // Its preload is a sync thenable: the world starts at once, as if every file were cached, unless
  // holdPreload keeps it for the test to start with boot.finishPreload(); preloadFails loses a file.
  class BootSplash {
    preloads = []; worlds = 0; frames = []; failure = null; finishPreload = null; failed = false;
    preload(appearance) {
      this.preloads.push({ ...appearance });
      return { then: start => {
        this.finishPreload = start;
        if (preloadFails) this.failed = true;
        if (!holdPreload) start();
      } };
    }
    worldReady() { this.worlds += 1; }
    frame(lookSettled) { this.frames.push(lookSettled); }
    fail(title, copy) { this.failure = [title, copy]; }
  }
  let now = 0, timer = 0;
  // The page's localStorage; private mode can make it throw.
  const store = new Map(Object.entries(storage));
  const localStorage = {
    getItem(key) { if (storageFails) throw new Error('denied'); return store.get(key) ?? null; },
    setItem(key, value) { if (storageFails) throw new Error('denied'); store.set(key, String(value)); },
  };
  // Fake pads for navigator.getGamepads; tests put snapshots in pads[0].
  const pads = [];
  const mainDeps = { createAdaptiveHD, createTierSettings, saveTierSettings, normalizeSettings, matchMedia: () => ({ matches: coarse }), ...gameApi, ...appearance, ...crowdFixture, MONK_RULES, Input, MotionHistory, Renderer, GameAudio, document, window,
    damageMultiplier, unspentPoints, xpProgress, SKILLS, SLOTS, createLoadout, skillParams, slotStates,
    RARITIES, comboStats, weaponCombo, MonkPanel, pauseLegend, physicalCode, GamepadInput, controlKeys, slotKey,
    TouchInput, TouchUI, BootSplash, createPerfOverlay, createVersionCheck, createVersionNotice, createRunAutosave, readSave, restoreRun, navigator: { getGamepads: () => pads, userAgent: phone ? 'iPhone' : '' },
    crypto: { getRandomValues(array) { array[0] = seeds.shift(); return array; } },
    console: { error: error => errors.push(error) }, performance: { now: () => now },
    setTimeout: () => ++timer, clearTimeout() {}, localStorage };
  const app = new Function(...Object.keys(mainDeps), `${executable('../src/main.js')}
    return { get game() { return game; }, get mode() { return mode; }, get renderer() { return renderer; }, get panel() { return panel; },
      get touchUI() { return touchUI; }, get boot() { return boot; }, versionCheck, begin, showPanel, updateHud, hudEvents };`)(...Object.values(mainDeps));
  t.after(() => {
    app.versionCheck.stop();
    app.renderer?.scene.dispose(); app.renderer?.engine.dispose();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  const tick = async (ms = 1000 / 60) => { now += ms; app.renderer.engine.tick(); await flush(); };
  const chosenUrl = () => appearance.appearanceVariant(app.game.appearance).url;
  return { app, $, document, requests, errors, worldLoad, tick, chosenUrl, pads, sounds, listening, store,
    request: () => requests.findLast(request => request.url === chosenUrl()),
    click(id) {
      const button = $(id);
      assert.ok(button && !button.hidden && !button.disabled, `${id} must be available`);
      button.dispatchEvent(new Event('click'));
    },
    choose(choices) {
      for (const [name, value] of Object.entries(choices)) {
        const radios = $(`${name}-options`).children.map(label => label.firstElementChild);
        for (const radio of radios) radio.checked = radio.value === value;
        const target = radios.find(radio => radio.checked);
        assert.ok(target, `offered choice ${name}:${value}`);
        const event = new Event('change'); Object.defineProperty(event, 'target', { value: target });
        $('appearance-picker').dispatchEvent(event);
      }
    },
    async ready() { worldLoad.resolve(); requests[0].resolve(); await flush(); await tick(); },
  };
}

test('fresh runs choose a new seed while pause and resume retain the current world', async t => {
  const h = harness(t); await h.ready();
  assert.equal(h.app.game.seed, 111);
  h.click('play');
  assert.equal(h.app.game.seed, 222);
  assert.equal(h.$('game').attrs['data-run-seed'], '222');
  const active = h.app.game;
  h.app.showPanel('paused'); h.click('play');
  assert.equal(h.app.game, active);
  h.app.showPanel('paused'); h.click('restart');
  assert.equal(h.app.game.seed, 333);
  assert.notDeepEqual(h.app.game.world.encounters, active.world.encounters);
});

test('an explicit unsigned seed replays the same encounters across restarts', async t => {
  const h = harness(t, { search: '?seed=4294967295' }); await h.ready();
  assert.equal(h.app.game.seed, 4294967295);
  const encounters = h.app.game.world.encounters;
  h.click('play');
  h.app.showPanel('paused'); h.click('restart');
  assert.equal(h.app.game.seed, 4294967295);
  assert.deepEqual(h.app.game.world.encounters, encounters);
  assert.equal(h.$('game').attrs['data-run-seed'], '4294967295');
});

test('an out-of-range replay seed falls back to a fresh run', async t => {
  const h = harness(t, { search: '?seed=4294967296' }); await h.ready();
  assert.equal(h.app.game.seed, 111);
  h.click('play');
  assert.equal(h.app.game.seed, 222);
});

function assertBlocked(h) {
  const before = h.app.game;
  assert.equal(h.$('play').disabled, true, 'start stays disabled for an unready current selection');
  h.app.begin(true); // Guard must work even without native disabled-button protection.
  assert.equal(h.app.mode, 'welcome');
  assert.equal(h.app.game, before, 'blocked start must not reset the run');
}

function assertRecoverable(h) {
  assertBlocked(h);
  assert.equal(h.$('appearance-picker').hidden, false);
  assert.equal(h.$('appearance-loading').hidden, false);
  assert.match(h.$('appearance-status').textContent, /облик/i);
  assert.equal(h.$('appearance-retry').hidden, false);
  assert.equal(h.$('appearance-retry').disabled, false);
  assert.notEqual(h.app.renderer.engine.stopped, true, 'appearance failure must not stop rendering');
}

test('HUD tracks the current area and spirit affordability without replacing the world', async t => {
  const h = harness(t); await h.ready();
  const game = h.app.game;
  game.world = { ...game.world, title: 'Общий мир', zones: [
    { id: 'camp', title: 'Лагерь странников', subtitle: 'Огонь' },
    { id: 'road', title: 'Разбитая дорога', subtitle: 'Путь' },
  ] };
  game.enemies = [{ id: 'road-1', zoneId: 'road', kind: 'hound', hp: 64 },
    { id: 'court-1', zoneId: 'courtyard', kind: 'hound', hp: 64 }];
  game.locationId = 'camp';
  Object.assign(game.player, { spirit: 28, maxSpirit: 100 });
  h.app.updateHud();
  assert.equal(h.$('location-title').textContent, 'Лагерь странников');
  assert.equal(h.$('kill-count').textContent, '');
  assert.equal(h.$('spirit-orb').attrs['aria-valuenow'], 28);
  // The spirit orb fills round(29 × 28 / 100) = 8 whole rows from the glass floor at row 33.
  assert.deepEqual([h.$('spirit-level').attrs.y, h.$('spirit-level').attrs.height], [25, 8]);
  assert.equal(h.$('slot-rmb').classList.contains('insufficient'), true);
  assert.equal(h.$('slot-rmb').querySelector('.skill-cost').textContent, String(MONK_RULES.wave.cost));
  const zoneState = () => ['camp', 'road', 'courtyard'].map(id => [h.$(`zone-${id}`).classList.contains('current'),
    h.$(`zone-${id}`).classList.contains('visited'), h.$(`zone-${id}`).attrs['aria-current']]);
  assert.deepEqual(zoneState(), [[true, true, 'location'], [false, false, 'false'], [false, false, 'false']]);
  game.locationId = 'road'; game.player.spirit = 64; game.adventure.visited.push('road');
  h.app.updateHud();
  assert.equal(h.$('location-title').textContent, 'Разбитая дорога');
  assert.equal(h.$('kill-count').textContent, '1 / 1');
  assert.equal(h.$('slot-rmb').classList.contains('insufficient'), false);
  assert.equal(h.$('spirit-text').innerHTML, '<b>64</b> <i>/ 100</i>');
  assert.deepEqual(zoneState(), [[false, true, 'false'], [true, true, 'location'], [false, false, 'false']]);
  assert.equal(h.$('breath-warning').hidden, true);
  assert.equal(h.$('health-orb').classList.contains('low'), false);
  game.player.hp = 20;
  h.app.updateHud();
  assert.equal(h.$('breath-warning').hidden, false);
  assert.equal(h.$('health-orb').classList.contains('low'), true);
});

test('a side zone joins the map strip after its first entry; the run summary reads «Тайники N из M»', async t => {
  const h = harness(t); await h.ready();
  const game = h.app.game;
  const shown = () => ['camp', 'road', 'cemetery', 'courtyard', 'orchard'].filter(id => !h.$(`zone-${id}`).hidden);
  h.app.updateHud();
  assert.deepEqual(shown(), ['camp', 'road', 'courtyard']);
  game.adventure.visited.push('orchard'); h.app.updateHud();
  assert.deepEqual(shown(), ['camp', 'road', 'courtyard', 'orchard']);
  game.adventure.visited.push('cemetery'); game.locationId = 'cemetery'; h.app.updateHud();
  assert.deepEqual(shown(), ['camp', 'road', 'cemetery', 'courtyard', 'orchard']);
  assert.equal(h.$('zone-cemetery').attrs['aria-current'], 'location');
  // A world without world.caches has the road cache only. OVERWORLD lists its three caches.
  const { caches, shrines, ...unlisted } = game.world;
  game.world = unlisted; delete game.adventure.cachesFound;
  h.app.showPanel('defeat');
  assert.equal(h.$('summary-secret').textContent, '0 из 1');
  game.adventure.secretFound = true; h.app.showPanel('defeat');
  assert.equal(h.$('summary-secret').textContent, '1 из 1');
  game.world = { ...game.world, caches: ['secret', 'cemetery-cache', 'orchard-cache'].map((id, x) => ({ id, x, y: 0 })) };
  game.adventure.cachesFound = ['cemetery-cache', 'secret'];
  game.phase = 'victory'; h.app.showPanel('victory');
  assert.equal(h.$('summary-secret').textContent, '2 из 3');
  // «Пройти ещё раз» starts a new run, which hides the side zones again.
  h.click('play'); h.app.updateHud();
  assert.notEqual(h.app.game, game);
  assert.deepEqual(shown(), ['camp', 'road', 'courtyard']);
});

test('orb HUD shows the level, the free point, slot unlocks, the level-up notice and loot lines', async t => {
  const h = harness(t); await h.ready();
  const game = h.app.game, slot = id => h.$(`slot-${id}`);
  h.app.updateHud();
  // Level 1: Q and F locked, no free point, an empty experience bar, 3 series pips for bare hands.
  assert.equal(h.$('level-value').textContent, '1');
  assert.equal(h.$('point-mark').hidden, true);
  assert.equal(h.$('xp-fill').style.width, '0.000%');
  assert.deepEqual(['q', 'f'].map(id => [slot(id).classList.contains('locked'), slot(id).querySelector('.skill-unlock').textContent]),
    [[true, 'ур. 2'], [true, 'ур. 4']]);
  assert.equal(h.$('combo-pips').children.length, 3);
  // A full orb has no light top row; health 100 / 100 fills all 29 rows.
  assert.deepEqual([h.$('health-level').attrs.y, h.$('health-level').attrs.height, h.$('health-surface').attrs.height], [4, 29, 0]);

  gainXp(game, 90);
  h.app.hudEvents(game.events); h.app.updateHud();
  const notice = h.$('notice');
  assert.deepEqual(notice.children.map(child => child.textContent), ['Уровень 2', '+1 очко пути · Ладонь духа · слот Q · C — путь']);
  assert.equal(notice.classList.contains('show'), true);
  assert.equal(h.$('level-value').textContent, '2');
  assert.equal(h.$('point-mark').hidden, false);
  assert.equal(h.$('point-count').textContent, '1');
  // 90 of the 80–220 band: 10 / 140 = 7.143% (§4.2).
  assert.equal(h.$('xp-fill').style.width, '7.143%');
  assert.deepEqual(['aria-valuenow', 'aria-valuemax', 'aria-valuetext'].map(name => h.$('xp-bar').attrs[name]),
    [10, 140, '90 / 220 опыта']);
  assert.equal(slot('q').classList.contains('locked'), false);
  assert.equal(slot('q').querySelector('.skill-well use').attrs.href, '#icon-palm');
  assert.equal(slot('q').querySelector('.skill-cost').textContent, '20');
  assert.equal(slot('q').classList.contains('new'), true);
  assert.equal(slot('f').classList.contains('locked'), true);
  // The amber dot stays until the first cast.
  h.app.hudEvents([{ type: 'palm' }]); h.app.updateHud();
  assert.equal(slot('q').classList.contains('new'), false);

  // Health below 35: coral ring, the breathing line and a blinking glass; one row stays above zero.
  game.player.hp = 1; h.app.updateHud();
  assert.equal(h.$('health-orb').classList.contains('low'), true);
  assert.equal(h.$('breath-warning').hidden, false);
  assert.deepEqual([h.$('health-level').attrs.y, h.$('health-level').attrs.height, h.$('health-surface').attrs.height], [32, 1, 1]);
  game.player.spirit = 0; h.app.updateHud();
  assert.equal(h.$('spirit-orb').classList.contains('drained'), true);
  assert.equal(h.$('spirit-level').attrs.height, 0);

  // Loot lines compare series damage per second with the equipped weapon (bare hands here), three at most.
  const knuckles = createItem({ id: 'test-knuckles', family: 'knuckles', ilvl: 2, rarity: 'rare', affixes: ['comboDamage', 'maxHp'] });
  h.app.hudEvents([{ type: 'loot-pickup', item: knuckles }]);
  const [line] = h.$('loot-lines').children, [, text] = line.children;
  const scale = damageMultiplier(game.progression, { source: 'combo' });
  const gain = comboStats(knuckles, scale).dps - comboStats(null, scale).dps;
  assert.ok(gain > 0);
  assert.deepEqual(text.children.map(child => child.textContent), ['Редкое: ', knuckles.name, `▲ ${gain} урона/с`]);
  assert.equal(text.children[1].style.color, 'var(--spirit)');
  game.inventory.equipped.weapon = createItem({ id: 'test-staff', family: 'staff' });
  h.app.hudEvents([{ type: 'loot-pickup', item: knuckles }, { type: 'bag-full', notice: 'Сумка полна · I — выбросить лишнее' },
    { type: 'loot-pickup', item: knuckles }]);
  const lines = h.$('loot-lines').children;
  assert.equal(lines.length, 3);
  assert.equal(lines[0].children[1].children[2].textContent, 'другое оружие');
  assert.equal(lines[1].textContent, 'Сумка полна · I — выбросить лишнее');

  // Notices queue: a cleared pack waits while «Уровень 2» shows.
  h.app.hudEvents([{ type: 'pack-cleared', packId: 'road-approach' }, { type: 'xp', source: 'pack', amount: 15 }]);
  assert.equal(notice.children[0].textContent, 'Уровень 2');
});

test('current atlas failure blocks start until a real retry applies the chosen look, including restart', async t => {
  const h = harness(t); await h.ready();
  const initial = h.app.renderer.appearanceController.current;
  h.choose({ skin: 'deep', hair: 'short', sash: 'teal' });
  assertBlocked(h); // No render-loop-sized window to start with the old atlas.
  await h.tick();
  h.request().reject(new Error('current atlas transport failure')); await flush(); await h.tick();
  assert.equal(h.app.renderer.appearanceController.current, initial);
  assertRecoverable(h);
  const failedRequest = h.request();
  h.click('appearance-retry'); await flush();
  assert.notEqual(h.request(), failedRequest, 'retry must issue another texture request');
  assertBlocked(h);
  h.request().resolve(); await flush(); await h.tick();
  assert.equal(h.$('play').disabled, false);
  assert.equal(h.$('appearance-loading').hidden, true);
  assert.equal(h.app.renderer.appearanceController.current, h.chosenUrl());
  h.click('play'); await h.tick();
  assert.equal(h.app.mode, 'playing');
  assert.ok(h.app.game.time > 0);
  const beforeRestart = h.app.game;
  h.app.showPanel('paused'); h.click('restart'); await h.tick();
  assert.notEqual(h.app.game, beforeRestart);
  assert.deepEqual(h.app.game.appearance, { skin: 'deep', hair: 'short', sash: 'teal' });
  assert.equal(h.app.renderer.appearanceController.current, h.chosenUrl());
});

test('initial appearance failure is recoverable within the welcome picker', async t => {
  const h = harness(t);
  h.worldLoad.resolve(); h.request().reject(new Error('initial atlas offline'));
  await flush(); await h.tick();
  assertRecoverable(h);
  assert.equal(h.$('play').hidden, false);
  h.click('appearance-retry'); await flush();
  h.request().reject(new Error('still offline')); await flush(); await h.tick();
  assertRecoverable(h);
  h.click('appearance-retry'); await flush();
  h.request().resolve(); await flush(); await h.tick();
  h.click('play');
  assert.equal(h.app.mode, 'playing');
  assert.equal(h.app.renderer.appearanceController.current, h.chosenUrl());
  assert.equal(h.requests.length, 3, 'each explicit retry makes a new request');
  assert.deepEqual(h.errors, [], 'recoverable appearance errors must not reach the fatal world handler');
});

test('ready appearance cannot start the game while common world assets are pending', async t => {
  const h = harness(t);
  h.request().resolve(); await flush(); await h.tick();
  assertBlocked(h);
  h.worldLoad.resolve(); await flush(); await h.tick();
  h.click('play');
  assert.equal(h.app.mode, 'playing');
});

test('common asset failure keeps the fatal world screen and blocks direct start', async t => {
  const h = harness(t);
  h.request().resolve(); h.worldLoad.reject(new Error('world atlas offline')); await flush();
  assertBlocked(h);
  assert.equal(h.$('appearance-picker').hidden, true);
  assert.equal(h.$('play').hidden, true);
  assert.match(h.$('panel-title').textContent, /Не удалось загрузить мир/);
  assert.equal(h.app.renderer.engine.stopped, true);
  assert.equal(h.errors.length, 1);
});

test('the world starts only after the boot splash has preloaded the files for the chosen look (boot-splash.js)', async t => {
  const h = harness(t, { holdPreload: true });
  const boot = h.app.boot;
  assert.deepEqual(boot.preloads, [h.app.game.appearance], 'one preload, for the look the start screen shows');
  assert.equal(h.app.renderer, undefined, 'no renderer, so no second download of the same files');
  assert.equal(h.$('play').disabled, true, 'the start button waits for the preload');
  boot.finishPreload();
  assert.ok(h.app.renderer, 'the world starts when the files are in');
  assert.equal(h.requests.length, 1);
  await h.ready();
  assert.equal(h.$('play').disabled, false);
});

test('a file the preload lost keeps the world from starting: the splash keeps its message (boot-splash.js)', t => {
  const h = harness(t, { preloadFails: true });
  assert.equal(h.app.boot.preloads.length, 1);
  assert.equal(h.app.renderer, undefined, 'no renderer, no render loop');
  assert.equal(h.requests.length, 0, 'no look request either');
  assert.equal(h.errors.length, 0);
});

test('the boot splash hears the world art and every frame; only a frame with the art and a settled look may end it (boot-splash.js)', async t => {
  const h = harness(t);
  const boot = h.app.boot;
  await h.tick(); await h.tick();
  assert.equal(boot.worlds, 0, 'the world art is still loading');
  assert.deepEqual(boot.frames, [false, false], 'frames before the art cannot end the splash');
  h.worldLoad.resolve(); await flush(); await h.tick();
  assert.equal(boot.worlds, 1);
  assert.equal(boot.frames.at(-1), false, 'the chosen look is still loading');
  h.request().resolve(); await flush(); await h.tick();
  assert.equal(boot.frames.at(-1), true, 'the first frame with the art and the look reaches the splash');
  assert.equal(boot.failure, null);
});

test('a chosen look that fails still ends the boot splash: the start screen offers its retry', async t => {
  const h = harness(t);
  h.worldLoad.resolve(); h.request().reject(new Error('look offline')); await flush(); await h.tick();
  assert.equal(h.app.boot.frames.at(-1), true);
  assert.equal(h.$('appearance-retry').hidden, false);
  assert.equal(h.app.boot.failure, null);
});

test('a world art failure reaches the boot splash with the panel text', async t => {
  const lost = harness(t);
  lost.request().resolve(); lost.worldLoad.reject(new Error('world atlas offline')); await flush();
  assert.deepEqual(lost.app.boot.failure,
    ['Не удалось загрузить мир', 'Один из игровых ресурсов не загрузился. Обнови страницу, чтобы попробовать снова.']);
  assert.equal(lost.app.boot.worlds, 0);
});

for (const [outcome, currentState] of [['resolve', 'loading'], ['reject', 'loading'], ['resolve', 'error'], ['reject', 'error']]) {
  test(`stale retry ${outcome} cannot replace the newer selection's ${currentState} state`, async t => {
    const h = harness(t); await h.ready();
    h.choose({ skin: 'deep' }); await h.tick();
    h.request().reject(new Error('first choice failed')); await flush(); await h.tick();
    assertRecoverable(h);
    h.click('appearance-retry'); await flush();
    const stale = h.request();
    h.choose({ skin: 'pale', sash: 'ochre' });
    assertBlocked(h); await h.tick();
    const current = h.request();
    if (currentState === 'error') {
      current.reject(new Error('newest choice failed')); await flush(); await h.tick();
      assertRecoverable(h);
    }
    stale[outcome](new Error('stale retry failed')); await flush();
    assertBlocked(h); // Also check before the next render could repair stale UI.
    if (currentState === 'loading') {
      assert.equal(h.$('appearance-retry').hidden, true, 'a stale retry must not expose an error for the pending choice');
      current.reject(new Error('newest choice failed')); await flush(); await h.tick();
    }
    assertRecoverable(h);
    h.click('appearance-retry'); await flush();
    h.request().resolve(); await flush(); await h.tick();
    assert.equal(h.$('play').disabled, false);
    assert.equal(h.app.renderer.appearanceController.current, h.chosenUrl());
    assert.deepEqual(h.app.game.appearance, { skin: 'pale', hair: 'shaved', sash: 'ochre' });
  });
}

test('the frame loop draws bodies between steps and holds that frame through pause and resume', async t => {
  const h = harness(t); await h.ready(); h.click('play');
  const r = h.app.renderer, key = (type, code) => globalThis.window.dispatchEvent(Object.assign(new Event(type), { code }));
  key('keydown', 'KeyD');
  // 13 ms frames run one or two 1/120 s steps; after 30 of them the blend is .8 of a step.
  for (let i = 0; i < 30; i++) await h.tick(13);
  const p = h.app.game.player, { motion } = r;
  assert.ok(motion.alpha > .05 && motion.alpha < .95, `fractional blend ${motion.alpha}`);
  const blended = motion.at(p), anchor = r.groundAnchor(blended.x, blended.y);
  const drawn = r.monk.mesh.position.clone(), camera = r.camera.target.clone();
  assert.deepEqual([drawn.x, drawn.z], [anchor.x, anchor.y], 'the monk is drawn at the blend, snapped');
  assert.ok(Math.hypot(blended.x - p.x, blended.y - p.y) > .005, 'the blend trails the running body');
  // Pause keeps the accumulator, so the blend and the camera hold instead of jumping back a step.
  h.app.showPanel('paused');
  for (let i = 0; i < 4; i++) {
    await h.tick(13);
    assert.deepEqual(r.motion.at(p), blended, 'pause holds the blend');
    assert.deepEqual(r.monk.mesh.position.asArray(), drawn.asArray(), 'pause holds the drawn monk');
    assert.deepEqual(r.camera.target.asArray(), camera.asArray(), 'pause holds the camera');
  }
  h.click('play'); await h.tick(13);
  // Screen-right is (-x, +z): resuming finishes the last step forward, never back.
  const forward = (r.monk.mesh.position.z - drawn.z) - (r.monk.mesh.position.x - drawn.x);
  assert.ok(forward >= -1e-9, `resume moves on, never back (${forward})`);
});

test('C, I, K and Tab open the «Монах» panel, which pauses the run until C, I, K or Esc closes it', async t => {
  const h = harness(t); await h.ready(); h.click('play');
  const key = (code, extra = {}) => {
    const event = Object.assign(new Event('keydown', { cancelable: true }), { code, ...extra });
    globalThis.window.dispatchEvent(event);
    return event;
  };
  const game = h.app.game, r = h.app.renderer, panel = h.app.panel;
  await h.tick();
  assert.equal(key('KeyC').defaultPrevented, true);
  await h.tick();
  assert.deepEqual([h.app.mode, panel.isOpen, panel.tab], ['panel', true, 'character']);
  assert.equal(h.$('monk-panel').hidden, false);
  assert.equal(h.document.body.classList.contains('menu-open'), true, 'the HUD dims as in the pause');
  // The simulation and the drawn presentation hold while the panel is open.
  const time = game.time, shown = r.presentation.time;
  for (let i = 0; i < 4; i++) await h.tick(13);
  assert.equal(game.time, time);
  assert.equal(r.presentation.time, shown);
  key('KeyI');
  assert.equal(panel.tab, 'gear');
  assert.equal(key('Tab').defaultPrevented, true);
  assert.equal(panel.tab, 'skills');
  key('Tab', { shiftKey: true });
  assert.equal(panel.tab, 'gear');
  // The key of the shown tab closes the panel; the play input never sees it, so nothing reopens.
  key('KeyI');
  assert.deepEqual([h.app.mode, panel.isOpen, h.$('monk-panel').hidden], ['playing', false, true]);
  await h.tick(13); await h.tick(13);
  assert.equal(h.app.mode, 'playing');
  assert.ok(game.time > time, 'the run goes on');
  // Esc closes the panel without opening the pause.
  key('KeyK'); await h.tick();
  assert.deepEqual([h.app.mode, panel.tab], ['panel', 'skills']);
  key('Escape');
  assert.equal(h.app.mode, 'playing');
  assert.equal(h.$('overlay').classList.contains('closed'), true);
  // Camp supplies (E) open «Снаряжение» for the first weapon choice (§3.6).
  const camp = game.world.zones.find(zone => zone.id === 'camp');
  Object.assign(game.player, { x: campaign.CAMP_SUPPLIES.x + camp.offset.x, y: campaign.CAMP_SUPPLIES.y + camp.offset.y });
  key('KeyE'); await h.tick();
  assert.deepEqual([h.app.mode, panel.tab, panel.controller.firstChoice], ['panel', 'gear', true]);
  assert.equal(game.inventory.bag.filter(Boolean).length, 2);
  key('Escape');
  // The pause legend names the techniques in RMB, Q and F.
  gainXp(game, 80);
  h.app.showPanel('paused');
  assert.equal(h.$('legend-q').classList.contains('locked'), false);
  assert.equal(h.$('legend-q').querySelector('span').textContent, 'ладонь духа: дальний удар · 20 духа');
  assert.equal(h.$('legend-f').classList.contains('locked'), true);
});

test('a successful deflect holds the frame for 70 ms, longer than a heavy impact (§2.3)', async t => {
  const h = harness(t); await h.ready(); h.click('play');
  const game = h.app.game;
  await h.tick(10);
  // Events emitted between frames are read by the next frame, after its simulation step.
  game.events.push({ type: 'deflect-success', x: game.player.x, y: game.player.y });
  await h.tick(10);
  const held = game.time;
  for (let i = 0; i < 7; i++) await h.tick(10);
  assert.equal(game.time, held, '7 frames of 10 ms stay on the deflect');
  await h.tick(10); await h.tick(10);
  assert.ok(game.time > held, 'the run goes on after 70 ms');
  // A heavy impact stops 45 ms: five 10 ms frames hold, the sixth runs, where a deflect still holds.
  game.events.push({ type: 'impact', strength: 'heavy', x: 0, y: 0 });
  await h.tick(10);
  const hit = game.time;
  for (let i = 0; i < 5; i++) await h.tick(10);
  assert.equal(game.time, hit);
  await h.tick(10);
  assert.ok(game.time > hit);
  // Reduced motion never holds the frame.
  h.app.renderer.reducedMotion = true;
  game.events.push({ type: 'deflect-success', x: 0, y: 0 });
  await h.tick(10);
  const calm = game.time;
  await h.tick(10);
  assert.ok(game.time > calm);
});

test('Esc, M and the panel keys work by physical key in the Russian layout', async t => {
  const h = harness(t); await h.ready(); h.click('play');
  const key = (code, letter) => {
    const event = Object.assign(new Event('keydown', { cancelable: true }), { code, key: letter });
    globalThis.window.dispatchEvent(event);
    return event;
  };
  const panel = h.app.panel;
  // Some browsers send an empty code for letters in a non-Latin layout; the typed letter names the key.
  key('', 'ш'); await h.tick();
  assert.deepEqual([h.app.mode, panel.tab], ['panel', 'gear']);
  key('', 'л');
  assert.equal(panel.tab, 'skills');
  key('', 'л');
  assert.equal(h.app.mode, 'playing');
  key('', 'ь');
  assert.deepEqual([h.$('sound').attrs['aria-checked'], h.$('sound').textContent], ['false', 'Выкл'], 'M mutes');
  key('', 'Escape');
  assert.equal(h.app.mode, 'paused');
});

test('«Настройки» shows in the pause menu only; its sound switch mutes, says so and saves the choice', async t => {
  const h = harness(t); await h.ready();
  const sound = h.$('sound'), [audio] = h.sounds;
  assert.deepEqual([sound.attrs['aria-checked'], sound.textContent, sound.title, audio.muted], ['true', 'Вкл', 'Выключить звук (M)', false]);
  assert.equal(h.$('pause-settings').hidden, true, 'the start screen has no settings');
  h.click('play');
  globalThis.window.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { code: 'Escape' }));
  assert.equal(h.app.mode, 'paused');
  assert.equal(h.$('pause-settings').hidden, false);
  h.click('sound');
  assert.deepEqual([sound.attrs['aria-checked'], sound.textContent, sound.title, audio.muted], ['false', 'Выкл', 'Включить звук (M)', true]);
  assert.equal(h.store.get('ritual-sound'), 'off');
  globalThis.window.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { code: 'KeyM' }));
  assert.deepEqual([sound.attrs['aria-checked'], audio.muted, h.store.get('ritual-sound')], ['true', false, 'on'], 'M is the same switch');
  h.click('play');
  assert.deepEqual([h.app.mode, h.$('overlay').classList.contains('closed')], ['playing', true], '«Продолжить» closes the menu and its settings');
});

test('a saved «звук выкл» survives a reload: the sound is muted before the first unlock', async t => {
  const h = harness(t, { storage: { 'ritual-sound': 'off' } }); await h.ready();
  const [audio] = h.sounds;
  assert.deepEqual([audio.muted, audio.unlocks], [true, 0], 'muted before «Начать путь» builds the master gain and the music');
  assert.deepEqual([h.$('sound').attrs['aria-checked'], h.$('sound').textContent], ['false', 'Выкл']);
  h.click('play');
  assert.deepEqual([audio.muted, audio.unlocks], [true, 1]);
});

test('a storage that throws (private mode) leaves the sound on and the switch working', async t => {
  const h = harness(t, { storageFails: true }); await h.ready();
  const [audio] = h.sounds;
  assert.equal(audio.muted, false);
  h.click('sound');
  assert.deepEqual([audio.muted, h.$('sound').attrs['aria-checked']], [true, 'false']);
  assert.deepEqual(h.errors, []);
});

const graphicsLayers = on => ({ propShade: on, lightPools: on, zoneGrade: on });

test('«Графика» switches the picture layers together, says so and saves the choice', async t => {
  const h = harness(t); await h.ready();
  const button = h.$('graphics'), polish = h.app.renderer.polish;
  assert.deepEqual([button.attrs['aria-checked'], button.textContent, button.title], ['true', 'Вкл', 'Выключить эффекты графики']);
  assert.deepEqual({ ...polish.options }, graphicsLayers(true));
  h.click('play');
  globalThis.window.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { code: 'Escape' }));
  h.click('graphics');
  assert.deepEqual([button.attrs['aria-checked'], button.textContent, button.title], ['false', 'Выкл', 'Включить эффекты графики']);
  assert.deepEqual({ ...polish.options }, graphicsLayers(false));
  assert.equal(h.store.get('ritual-graphics'), 'off');
  await h.tick();
  assert.equal(polish.grade.pass, null, 'the grade pass is released');
  h.click('graphics');
  assert.deepEqual([button.attrs['aria-checked'], { ...polish.options }, h.store.get('ritual-graphics')], ['true', graphicsLayers(true), 'on']);
});

test('a saved «графика выкл» survives a reload: the renderer starts with every layer off', async t => {
  const saved = harness(t, { storage: { 'ritual-graphics': 'off' } }); await saved.ready();
  assert.deepEqual({ ...saved.app.renderer.polish.options }, graphicsLayers(false), 'the renderer starts with the saved choice');
  assert.deepEqual([saved.$('graphics').attrs['aria-checked'], saved.$('graphics').textContent], ['false', 'Выкл']);
});

test('the «FPS» switch shows the performance panel at once and keeps the choice', async t => {
  const h = harness(t); await h.ready();
  const button = h.$('perf');
  assert.deepEqual([button.attrs['aria-checked'], button.textContent], ['false', 'Выкл'], 'off by default');
  h.click('perf');
  assert.deepEqual([button.attrs['aria-checked'], button.textContent, h.store.get('ritual-perf')], ['true', 'Вкл', '1']);
  h.click('perf');
  assert.deepEqual([button.attrs['aria-checked'], button.textContent, h.store.get('ritual-perf')], ['false', 'Выкл', '0']);
  const saved = harness(t, { storage: { 'ritual-perf': '1' } }); await saved.ready();
  assert.deepEqual([saved.$('perf').attrs['aria-checked'], saved.$('perf').textContent], ['true', 'Вкл'], 'the saved choice returns');
});

test('a storage that throws (private mode) leaves the graphics on and the switch working', async t => {
  const h = harness(t, { storageFails: true }); await h.ready();
  assert.deepEqual({ ...h.app.renderer.polish.options }, graphicsLayers(true));
  h.click('graphics');
  assert.deepEqual([{ ...h.app.renderer.polish.options }, h.$('graphics').attrs['aria-checked']], [graphicsLayers(false), 'false']);
  assert.deepEqual(h.errors, []);
});

test('a failing audio unlock or frame is reported once and never blocks the start, input or rendering', async t => {
  const failure = new Error('audio graph failed');
  const h = harness(t, { audioFailure: failure }); await h.ready();
  h.click('play');
  assert.equal(h.app.mode, 'playing');
  assert.equal(h.$('overlay').classList.contains('closed'), true, 'the menu closes despite the failed unlock');
  const r = h.app.renderer, start = r.presentation.time, x = h.app.game.player.x;
  globalThis.window.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyD' }));
  for (let i = 0; i < 20; i++) await h.tick();
  assert.ok(r.presentation.time > start, 'frames keep rendering');
  assert.notEqual(h.app.game.player.x, x, 'input still moves the monk');
  assert.deepEqual(h.errors, [failure], 'the failure is logged once');
});

test('an idle HUD writes nothing, and the phone never writes the hidden desktop orbs and slots', async t => {
  const h = harness(t); await h.ready();
  h.click('play');
  h.app.updateHud();
  const writes = [];
  const watch = (target, key, label) => {
    let value = target[key];
    Object.defineProperty(target, key, { get: () => value, set: next => { writes.push(label); value = next; }, configurable: true });
  };
  const spy = (target, method, label) => {
    const call = target[method];
    target[method] = (...args) => { writes.push(`${label} ${args[0]}`); return call.apply(target, args); };
  };
  const slot = h.$('slot-rmb');
  watch(h.$('level-value'), 'textContent', 'level');
  watch(h.$('xp-fill').style, 'width', 'xp');
  watch(h.$('point-mark'), 'hidden', 'point');
  watch(h.$('quest-title'), 'textContent', 'quest');
  watch(h.$('location-title'), 'textContent', 'location');
  watch(h.$('kill-count'), 'textContent', 'kills');
  watch(slot.querySelector('.cooldown'), 'textContent', 'cooldown');
  spy(h.$('health-level'), 'setAttribute', 'health');
  spy(h.$('xp-bar'), 'setAttribute', 'xp-bar');
  spy(h.$('zone-camp'), 'setAttribute', 'zone');
  spy(slot.querySelector('.skill-shade').style, 'setProperty', 'shade');
  h.app.updateHud();
  h.app.updateHud();
  assert.deepEqual(writes, [], 'nothing changed: nothing written');
  // A hit and a cast on the phone: the desktop orbs and slots stay as they were (mobile.css hides them).
  h.app.touchUI.active = true;
  h.app.game.player.hp -= 30;
  h.app.game.player.waveCooldown = .5;
  h.app.updateHud();
  assert.deepEqual(writes, []);
  h.app.touchUI.active = false;
  h.app.updateHud();
  assert.deepEqual(writes, ['health y', 'health height', 'shade --shade', 'cooldown'], 'the desktop catches up at once');
});

test('a later touch resumes the sound iOS interrupted, but never starts it on the welcome screen', async t => {
  const h = harness(t); await h.ready();
  const [audio] = h.sounds, lift = type => globalThis.window.dispatchEvent(new Event(type));
  lift('pointerup'); lift('touchend');
  assert.deepEqual([audio.context, audio.unlocks], [null, 0], 'no context before «Начать путь»: the first unlock starts the music');
  h.click('play');
  assert.equal(audio.unlocks, 1);
  audio.context.state = 'interrupted';
  lift('touchend');
  assert.deepEqual([audio.context.state, audio.context.resumes], ['running', 1], 'a call or Siri ended: the next touch resumes');
  audio.context.state = 'suspended';
  lift('pointerup');
  lift('pointerup');
  assert.equal(audio.context.resumes, 2, 'a running context is left alone');
  assert.equal(audio.unlocks, 1, 'a touch never unlocks again');
  // Safari may refuse the resume outside its gesture: nothing is logged and nothing throws.
  Object.assign(audio.context, { state: 'interrupted', resume: () => Promise.reject(new Error('not allowed')) });
  lift('touchend');
  await flush();
  assert.deepEqual(h.errors, []);
  assert.deepEqual(h.listening.filter(entry => entry.type === 'touchend').map(entry => entry.options), [{ passive: true }],
    'the touchend listener never holds a scroll');
});

test('the world refits when iPhone Safari toolbars resize or move the visible part', async t => {
  const h = harness(t); await h.ready();
  const r = h.app.renderer, resize = r.resize;
  let fits = 0;
  r.resize = function() { fits += 1; return resize.call(this); };
  for (const type of ['resize', 'scroll']) globalThis.window.visualViewport.dispatchEvent(new Event(type));
  globalThis.window.dispatchEvent(new Event('resize'));
  assert.equal(fits, 3);
});

// A pad snapshot like Chrome's for the main.js loop: standard mapping, analog RT, one shared actuator.
const DUALSENSE = 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)';
function padSnapshot({ id = DUALSENSE, axes = [0, 0, 0, 0], pressed = [], values = {}, actuator } = {}) {
  const buttons = Array.from({ length: 18 }, (_, i) => {
    const value = values[i] ?? (pressed.includes(i) ? 1 : 0);
    return { pressed: value > .12, value };
  });
  return { id, index: 0, mapping: 'standard', connected: true, axes, buttons, vibrationActuator: actuator };
}

test('a DualSense starts, moves, swings, pauses and rumbles; the keycaps follow the last used device', async t => {
  const h = harness(t); await h.ready();
  const rumbles = [], actuator = { playEffect: (type, params) => { rumbles.push([type, params]); return Promise.resolve('complete'); } };
  const pad = async (options = {}) => { h.pads[0] = padSnapshot({ actuator, ...options }); await h.tick(); };
  const keycap = slot => h.$(`slot-${slot}`).querySelector('.keycap').textContent;
  // ✕ on the start screen presses «Начать путь»; the same press does not dash in the new run.
  await pad({ pressed: [0] });
  assert.equal(h.app.mode, 'playing');
  await pad();
  const game = h.app.game, p = game.player;
  assert.equal(p.dashCooldown, 0, 'the start press is not a dash');
  assert.deepEqual(['lmb', 'space', 'rmb', 'q', 'f'].map(keycap), ['R2', '✕', '□', '△', '○']);
  assert.equal(h.$('interaction-key').textContent, 'R1');
  assert.deepEqual(['move', 'attack', 'dash', 'rmb', 'q', 'f', 'panel', 'interact'].map(row => h.$(`legend-${row}`).querySelector('kbd').textContent),
    ['L-стик', 'R2', '✕', '□', '△', '○', 'Create', 'R1']);
  assert.equal(h.$('legend-system').querySelector('span kbd').textContent, 'Options');
  assert.equal(h.$('legend-aim').textContent, 'Удерживай R2 для серии. Целься правым стиком.');
  assert.deepEqual([h.$('monk-close').textContent, h.$('monk-tabs-hint').textContent], ['○', 'L1 / R1 — вкладки']);
  assert.equal(h.document.body.classList.contains('pad-input'), true, 'the pad focus ring is on');
  // The left stick walks screen-right: the same iso turn as D.
  const x = p.x, y = p.y;
  for (let i = 0; i < 10; i++) await pad({ axes: [1, 0, 0, 0] });
  assert.ok(p.x < x && p.y > y, `screen-right moves (-x, +y): ${p.x - x}, ${p.y - y}`);
  // R2 held swings the series; ✕ dashes.
  await pad({ values: { 7: 1 } });
  assert.ok(p.attack, 'R2 starts the series');
  await pad();
  for (let i = 0; i < 40 && (p.attack || p.dashTime > 0); i++) await pad();
  await pad({ pressed: [0] });
  assert.ok(p.dashCooldown > 0, '✕ dashes');
  // A heavy hit rumbles the pad.
  game.events.push({ type: 'impact', strength: 'heavy', x: p.x, y: p.y });
  await pad();
  assert.deepEqual(rumbles.at(-1), ['dual-rumble', { startDelay: 0, duration: 110, strongMagnitude: .55, weakMagnitude: .55 }]);
  // Options pauses and resumes; ○ also resumes from the pause.
  await pad({ pressed: [9] });
  assert.equal(h.app.mode, 'paused');
  await pad();
  await pad({ pressed: [9] });
  assert.equal(h.app.mode, 'playing');
  await pad();
  await pad({ pressed: [9] }); await pad(); await pad({ pressed: [1] });
  assert.equal(h.app.mode, 'playing', '○ steps back from the pause into the run');
  await pad();
  // A pointermove without travel keeps the pad keycaps; a key brings the keyboard labels back.
  const pointer = (clientX, clientY) => globalThis.window.dispatchEvent(Object.assign(new Event('pointermove'), { clientX, clientY }));
  pointer(100, 100); pointer(100, 100);
  assert.equal(keycap('space'), '✕');
  globalThis.window.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyW' }));
  assert.deepEqual(['lmb', 'space', 'rmb', 'q', 'f'].map(keycap), ['ЛКМ', 'Пробел', 'ПКМ', 'Q', 'F']);
  assert.deepEqual([h.$('interaction-key').textContent, h.$('legend-move').querySelector('kbd').textContent, h.$('monk-close').textContent],
    ['E', 'WASD', 'Esc']);
  assert.equal(h.$('legend-aim').textContent, 'Удерживай ЛКМ для серии. Целься мышью.');
  assert.equal(h.document.body.classList.contains('pad-input'), false);
  // The pad takes them back on its next input; a mouse that travels returns them again.
  await pad({ axes: [0, 1, 0, 0] });
  assert.equal(keycap('space'), '✕');
  pointer(140, 100);
  assert.equal(keycap('space'), 'Пробел');
  // The keyboard is in use: a hit does not rumble the pad.
  const before = rumbles.length;
  game.events.push({ type: 'impact', strength: 'heavy', x: p.x, y: p.y });
  h.pads[0] = padSnapshot({ actuator }); await h.tick();
  assert.equal(rumbles.length, before);
});

test('the pad drives «Монах»: Create opens and closes, L1 / R1 switch tabs, the D-pad moves the focus, ✕ presses, ○ closes', async t => {
  const h = harness(t); await h.ready(); h.click('play');
  const pad = async (options = {}) => { h.pads[0] = padSnapshot(options); await h.tick(); };
  const press = async (...buttons) => { await pad({ pressed: buttons }); await pad(); };
  const panel = h.app.panel, steps = [];
  panel.moveFocus = step => steps.push(step);
  await pad();
  await press(8);
  assert.deepEqual([h.app.mode, panel.isOpen, panel.tab], ['panel', true, 'character']);
  const time = h.app.game.time;
  await press(5);
  assert.equal(panel.tab, 'gear', 'R1 is the next tab');
  await press(5);
  assert.equal(panel.tab, 'skills');
  await press(4);
  assert.equal(panel.tab, 'gear', 'L1 is the previous tab');
  assert.equal(h.app.game.time, time, 'the bumpers do not interact while the panel pauses the run');
  await press(13); await press(15); await press(12); await press(14);
  assert.deepEqual(steps, [1, 1, -1, -1], 'the D-pad moves the focus');
  // ✕ with nothing focused in the panel focuses the first control; on a focused control it presses it.
  await press(0);
  assert.deepEqual(steps.at(-1), 1);
  let clicks = 0;
  const control = h.document.createElement('button');
  control.addEventListener('click', () => clicks++);
  h.$('monk-panel').append(control); control.focus();
  await press(0);
  assert.equal(clicks, 1, '✕ presses the focused control');
  // ○ closes the panel without casting F or pausing; ✕ and ○ presses inside the panel never reach the run.
  await press(1);
  assert.deepEqual([h.app.mode, panel.isOpen], ['playing', false]);
  assert.equal(h.app.game.player.dashCooldown, 0);
  // Create opens and closes; Options in the panel closes it like Esc, not into the pause.
  await press(8);
  assert.equal(h.app.mode, 'panel');
  await press(8);
  assert.equal(h.app.mode, 'playing');
  await press(8); await press(9);
  assert.deepEqual([h.app.mode, h.$('overlay').classList.contains('closed')], ['playing', true]);
});

test('a full right-stick tilt reaches the crane range of the current modifier', async t => {
  const h = harness(t); await h.ready(); h.click('play');
  const game = h.app.game, p = game.player;
  gainXp(game, 100000);
  await h.tick();
  assert.equal(game.loadout.slots.f, 'crane', 'the crane sits in F');
  assert.equal(h.app.panel.controller.chooseModifier('crane', 'lightCrane').ok, true);
  const range = skillParams(game, 'crane').range;
  assert.ok(range > 5, `the light crane reaches further than the default ${range}`);
  p.spirit = p.maxSpirit;
  // Aim with the right stick and press ○ in the same frame; try headings until one line is open for the full range.
  for (const axes of [[0, 0, 1, 0], [0, 0, -1, 0], [0, 0, 0, 1], [0, 0, 0, -1]]) {
    p.technique = null; p.cooldowns = {};
    h.pads[0] = padSnapshot({ axes }); await h.tick();
    h.pads[0] = padSnapshot({ axes, pressed: [1] }); await h.tick();
    const flight = game.player.technique;
    if (flight?.id !== 'crane') continue;
    const reach = Math.hypot(flight.toX - flight.fromX, flight.toY - flight.fromY);
    if (reach > range - .11) return;
  }
  assert.fail('no heading reached the light crane range');
});

test('on the pad the notices, the empty slot, the panel keys, the pause legend and a held □ name or use the pad buttons', async t => {
  const h = harness(t); await h.ready();
  const pad = async (options = {}) => { h.pads[0] = padSnapshot(options); await h.tick(); };
  const key = code => globalThis.window.dispatchEvent(Object.assign(new Event('keydown'), { code }));
  // A D-pad press on the start screen makes the pad the device in use without starting the run.
  await pad({ pressed: [13] }); await pad();
  assert.equal(h.app.mode, 'welcome');
  assert.equal(h.$('slot-q').querySelector('.skill-blank').textContent, 'Create', 'an empty slot names the panel button');
  assert.equal(h.app.panel.controller.keys, controlKeys('playstation'), 'the panel draws its hints with the pad keys');
  gainXp(h.app.game, 90);
  h.app.hudEvents(h.app.game.events);
  assert.deepEqual(h.$('notice').children.map(child => child.textContent), ['Уровень 2', '+1 очко пути · Ладонь духа · слот △ · Create — путь']);
  h.app.hudEvents([{ type: 'bag-full', notice: 'Сумка полна · I — выбросить лишнее' }]);
  assert.equal(h.$('loot-lines').children.at(-1).textContent, 'Сумка полна · Create — выбросить лишнее');
  // ✕ starts the run; its first notice names R2 and □.
  await pad({ pressed: [0] }); await pad();
  assert.equal(h.app.mode, 'playing');
  assert.equal(h.$('notice').textContent, 'Следуй по дороге к монастырю · R2 — удары, □ — волна');
  // An empty RMB slot reads «Create — умения» in the pause legend, and «K — умения» once a key is pressed.
  const game = h.app.game;
  game.loadout = { ...game.loadout, slots: { ...game.loadout.slots, rmb: null } };
  await pad({ pressed: [9] }); await pad();
  assert.equal(h.app.mode, 'paused');
  assert.equal(h.$('legend-rmb').querySelector('span').textContent, 'пусто · Create — умения');
  key('KeyW');
  assert.equal(h.$('legend-rmb').querySelector('span').textContent, 'пусто · K — умения');
  assert.equal(h.$('slot-q').querySelector('.skill-blank').textContent, 'K');
  assert.equal(h.app.panel.controller.keys, controlKeys(null));
  await pad({ pressed: [9] }); await pad();
  assert.equal(h.app.mode, 'playing');
  // In the panel a held □ on the focused bag cell starts the drop hold; letting go of □ ends it.
  const panel = h.app.panel;
  await pad({ pressed: [8] }); await pad();
  assert.equal(h.app.mode, 'panel');
  const cell = h.document.createElement('button');
  cell.dataset = { bag: '0' }; cell.focus();
  await pad({ pressed: [2] });
  assert.deepEqual(panel.holds, [cell]);
  await pad({ pressed: [2] }); await pad({ pressed: [2] });
  assert.equal(panel.releases, 0, 'the hold lasts while □ is down');
  await pad();
  assert.equal(panel.releases, 1, 'letting go of □ releases the hold');
  await pad();
  assert.equal(panel.releases, 1);
});

test('under «Поверни телефон» Options, ✕, Esc, «Продолжить» and «Начать заново» keep the run paused (mobile-touch §11.2)', async t => {
  const h = harness(t); await h.ready();
  const pad = async (options = {}) => { h.pads[0] = padSnapshot(options); await h.tick(); };
  const key = code => globalThis.window.dispatchEvent(Object.assign(new Event('keydown'), { code }));
  const touchUI = h.app.touchUI;
  // A page opened in portrait never starts the run.
  touchUI.blocked = true;
  h.app.begin();
  assert.equal(h.app.mode, 'welcome');
  touchUI.blocked = false;
  h.app.begin();
  assert.equal(h.app.mode, 'playing');
  // The real layer pauses on the turn to portrait and then reports blocked.
  h.app.showPanel('paused');
  touchUI.blocked = true;
  const time = h.app.game.time, seed = h.app.game.seed;
  await pad(); await pad({ pressed: [9] }); await pad();
  assert.equal(h.app.mode, 'paused', 'Options');
  await pad({ pressed: [0] }); await pad();
  assert.equal(h.app.mode, 'paused', '✕ presses «Продолжить»');
  key('Escape');
  assert.equal(h.app.mode, 'paused', 'Esc');
  h.$('play').dispatchEvent(new Event('click'));
  h.$('restart').dispatchEvent(new Event('click'));
  assert.equal(h.app.mode, 'paused', 'the menu buttons');
  await h.tick(500);
  assert.equal(h.app.game.time, time, 'no step under the rotate screen');
  assert.equal(h.app.game.seed, seed, 'the run was not restarted');
  // The turn back keeps the pause; the next Esc resumes.
  touchUI.blocked = false;
  await h.tick(500);
  assert.equal(h.app.mode, 'paused');
  key('Escape');
  assert.equal(h.app.mode, 'playing');
});

test('blur and a hidden page end the «Монах» drop hold in any mode; □ let go later ends nothing (mobile-touch §10.7)', async t => {
  const h = harness(t); await h.ready();
  const pad = async (options = {}) => { h.pads[0] = padSnapshot(options); await h.tick(); };
  h.app.begin();
  await pad(); await pad({ pressed: [8] }); await pad();
  assert.equal(h.app.mode, 'panel');
  const panel = h.app.panel, cell = h.document.createElement('button');
  cell.dataset = { bag: '0' }; cell.focus();
  await pad({ pressed: [2] });
  assert.equal(panel.holds.length, 1);
  globalThis.window.dispatchEvent(new Event('blur'));
  assert.equal(panel.releases, 1, 'blur over the panel ends the hold');
  assert.equal(h.app.mode, 'panel', 'the panel stays open');
  await pad({ pressed: [2] }); await pad();
  assert.equal(panel.releases, 1, 'the □ hold was already over');
  // A call or another tab hides the page: the panel hold ends there too.
  panel.holdDrop(cell);
  h.document.hidden = true;
  h.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(panel.releases, 2, 'a hidden page ends the hold');
  h.document.hidden = false;
  h.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(panel.releases, 2, 'the page coming back ends nothing');
});


test('the points button appears after a level and disappears when the last point is spent', async t => {
  const h = harness(t); await h.ready(); h.click('play');
  const game = h.app.game;
  assert.equal(h.$('level-points-button').hidden, true, 'no points at the start');
  gainXp(game, PROGRESSION_RULES.levelXp[1]);
  h.app.hudEvents(game.events); h.app.updateHud();
  assert.equal(h.$('level-points-button').hidden, false);
  assert.equal(h.$('point-count').textContent, '1');
  assert.equal(spendPathPoint(game, 'tempering').ok, true);
  h.app.updateHud();
  assert.equal(h.$('level-points-button').hidden, true, 'no empty action remains');
});

test('clicking the points button opens the character path after another tab and pauses play', async t => {
  const h = harness(t); await h.ready(); h.click('play');
  gainXp(h.app.game, PROGRESSION_RULES.levelXp[1]); h.app.updateHud();
  h.app.panel.open('skills'); h.app.panel.close();
  h.click('level-points-button');
  assert.equal(h.app.mode, 'panel');
  assert.equal(h.app.panel.isOpen, true);
  assert.equal(h.app.panel.tab, 'character');
  assert.ok(h.app.panel.controller.characterView().nodes.length > 0);
  const before = h.app.game.adventure.elapsed;
  await h.tick(250);
  assert.equal(h.app.game.adventure.elapsed, before, 'the panel pauses the simulation');
});

test('the level notice names the path point and keeps an unslotted technique marked as new', async t => {
  const h = harness(t); await h.ready();
  const game = h.app.game;
  gainXp(game, PROGRESSION_RULES.levelXp[4]);
  h.app.hudEvents(game.events.filter(event => event.type === 'level-up' && event.level === 5
    || event.type === 'technique-learned' && event.technique === 'deflect'));
  assert.deepEqual(h.$('notice').children.map(child => child.textContent),
    ['Уровень 5', '+1 очко пути · Отражение · без слота · K — умения']);
  assert.ok(game.newTechniques.includes('deflect'));
  assert.ok(h.app.panel.controller.newSkills.has('deflect'));
});


test('the minimap switch defaults on, persists off and on, and tolerates denied storage', async t => {
  const h = harness(t); await h.ready();
  assert.deepEqual([h.$('minimap-toggle').attrs['aria-checked'], h.$('minimap-toggle').textContent], ['true', 'Вкл']);
  h.click('minimap-toggle');
  assert.deepEqual([h.store.get('ritual-minimap'), h.document.body.classList.contains('minimap-off')], ['0', true]);
  const saved = harness(t, { storage: { 'ritual-minimap': '0' } }); await saved.ready();
  assert.deepEqual([saved.$('minimap-toggle').attrs['aria-checked'], saved.document.body.classList.contains('minimap-off')], ['false', true]);
  saved.click('minimap-toggle');
  assert.deepEqual([saved.store.get('ritual-minimap'), saved.document.body.classList.contains('minimap-off')], ['1', false]);
  const denied = harness(t, { storageFails: true }); await denied.ready();
  denied.click('minimap-toggle');
  assert.equal(denied.$('minimap-toggle').textContent, 'Выкл');
});


test('HD-2D phone default, URL overrides and user choice reach the host without changing stage-0 graphics', async t => {
  const h = harness(t, { coarse: true, search: '?hd=bloom:high,dof:off' }); await h.ready();
  assert.deepEqual(h.app.renderer.hd2d.settings, { tier: 'low', overrides: { bloom: 'high', dof: 'off' } });
  assert.equal(h.$('hd2d-low').getAttribute('aria-pressed'), 'true');
  assert.equal(h.store.has('ritual-hd'), false, 'URL does not persist');
  h.$('hd2d-off').click();
  assert.deepEqual(h.app.renderer.hd2d.settings, { tier: 'off', overrides: {} });
  assert.deepEqual(JSON.parse(h.store.get('ritual-hd')), { tier: 'off', overrides: {} });
  assert.equal(h.$('hd2d-off').getAttribute('aria-pressed'), 'true');
  assert.equal(h.$('hd2d-low').getAttribute('aria-pressed'), 'false');
  assert.equal(h.$('graphics').getAttribute('aria-checked'), 'true');
  h.$('graphics').click();
  assert.equal(h.app.renderer.hd2d.settings.tier, 'off');
});

test('HD-2D saved high wins over phone low, URL off wins over saved high, denied storage still permits choice', async t => {
  const saved = { 'ritual-hd': '{"tier":"high","overrides":{}}' };
  const h = harness(t, { phone: true, storage: saved }); await h.ready();
  assert.equal(h.app.renderer.hd2d.settings.tier, 'high');
  const url = harness(t, { phone: true, storage: saved, search: '?hd=off' }); await url.ready();
  assert.equal(url.app.renderer.hd2d.settings.tier, 'off');
  const denied = harness(t, { storageFails: true }); await denied.ready();
  assert.equal(denied.app.renderer.hd2d.settings.tier, 'high');
  denied.$('hd2d-low').click();
  assert.equal(denied.app.renderer.hd2d.settings.tier, 'low');
  assert.equal(denied.$('hd2d-low').getAttribute('aria-pressed'), 'true');
});


test('Auto is the default and measures only raw playing frames; choosing high suspends it until reset', async t => {
  const h = harness(t); await h.ready();
  assert.equal(h.$('hd2d-auto')?.getAttribute('aria-pressed'), 'true');
  for (let i = 0; i < 190; i++) await h.tick(40);
  assert.equal(h.app.renderer.hd2d.settings.tier, 'high', 'welcome is not sampled');
  h.click('play');
  for (let i = 0; i < 180; i++) await h.tick(40);
  assert.equal(h.app.renderer.hd2d.settings.tier, 'low');
  assert.equal(h.$('hd2d-auto').getAttribute('aria-pressed'), 'true');
  assert.equal(h.store.has('ritual-hd'), false);
  h.$('hd2d-high').click();
  for (let i = 0; i < 180; i++) await h.tick(40);
  assert.equal(h.app.renderer.hd2d.settings.tier, 'high');
  h.$('hd2d-auto').click();
  for (let i = 0; i < 180; i++) await h.tick(40);
  assert.equal(h.app.renderer.hd2d.settings.tier, 'low');
  assert.equal(JSON.parse(h.store.get('ritual-hd')).mode, 'auto');
  assert.equal(h.errors.length, 0);
});

test('pause and visibility gaps do not lower Auto quality in the real main loop', async t => {
  const h = harness(t); await h.ready(); h.click('play');
  for (let i = 0; i < 170; i++) await h.tick(40);
  h.app.showPanel('paused');
  await h.tick(90000);
  h.click('play'); await h.tick(90000);
  assert.equal(h.app.renderer.hd2d.settings.tier, 'high');
  for (let i = 0; i < 170; i++) await h.tick(40);
  h.document.hidden = true;
  h.document.dispatchEvent(new Event('visibilitychange'));
  h.document.hidden = false;
  h.document.dispatchEvent(new Event('visibilitychange'));
  h.click('play'); await h.tick(90000);
  assert.equal(h.app.renderer.hd2d.settings.tier, 'high');
  for (let i = 0; i < 180; i++) await h.tick(40);
  assert.equal(h.app.renderer.hd2d.settings.tier, 'low');
});
