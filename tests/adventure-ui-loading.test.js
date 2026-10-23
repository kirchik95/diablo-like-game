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

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const executable = path => source(path).replace(/^import[\s\S]*?;\n/gm, '').replace(/^export /gm, '');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Execute the production UI, renderer and texture controller together. Only
// transport, browser DOM/audio and the GPU are replaced, as in the review probe.
function harness(t, { search = '', seeds = [111, 222, 333, 444], audioFailure = null } = {}) {
  let document;
  const context = new Proxy({ canvas: { width: 360, height: 280 } }, {
    get: (object, key) => object[key] ?? (() => key === 'createRadialGradient' ? { addColorStop() {} } : undefined),
  });
  class Element extends EventTarget {
    constructor(tagName = 'DIV') {
      super();
      Object.assign(this, { tagName, style: {}, children: [], hidden: false, disabled: false, textContent: '', attrs: {}, parts: {} });
      const classes = new Set();
      this.classList = { add: name => classes.add(name), remove: name => classes.delete(name),
        toggle: (name, on) => on ? classes.add(name) : classes.delete(name), contains: name => classes.has(name) };
    }
    append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
    get firstElementChild() { return this.children[0]; }
    setAttribute(name, value) { this.attrs[name] = value; }
    querySelector(selector) { return this.parts[selector] ??= new Element(); }
    querySelectorAll() { return []; }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    focus() { document.activeElement = this; }
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
    querySelectorAll: () => [new Element(), new Element(), new Element()],
  });
  const previousWindow = globalThis.window;
  const window = globalThis.window = new EventTarget();
  window.location = { search };
  const worldLoad = deferred(), requests = [], errors = [];
  class TestEngine extends B.NullEngine {
    constructor() { super({ renderWidth: 720, renderHeight: 450 }); }
    createCanvas(width, height) { return { width, height, getContext: () => context }; }
    runRenderLoop(callback) { this.tick = callback; }
    stopRenderLoop() { this.stopped = true; }
  }
  const renderDeps = {
    ...B, ...pixels, ...animation, ...picking,
    Engine: TestEngine, isWalkable: world.isWalkable, clearLine: world.clearLine,
    WRAITH_TIMINGS: campaign.WRAITH_TIMINGS, WRAITH_STATS: campaign.WRAITH_STATS,
    BEETLE_TIMINGS: campaign.BEETLE_TIMINGS, BEETLE_STATS: campaign.BEETLE_STATS,
    appearanceVariant: appearance.appearanceVariant, MONK_RULES, getOverworldZone, document, matchMedia: () => ({ matches: false }),
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
  class GameAudio {
    constructor() { this.muted = false; }
    unlock() { if (audioFailure) throw audioFailure; }
    play() {}
    frame() { if (audioFailure) throw audioFailure; }
    setMuted(value) { this.muted = value; }
  }
  let now = 0, timer = 0;
  const mainDeps = { ...gameApi, ...appearance, MONK_RULES, Input, MotionHistory, Renderer, GameAudio, document, window,
    crypto: { getRandomValues(array) { array[0] = seeds.shift(); return array; } },
    console: { error: error => errors.push(error) }, performance: { now: () => now },
    setTimeout: () => ++timer, clearTimeout() {} };
  const app = new Function(...Object.keys(mainDeps), `${executable('../src/main.js')}
    return { get game() { return game; }, get mode() { return mode; }, get renderer() { return renderer; }, begin, showPanel, updateHud };`)(...Object.values(mainDeps));
  t.after(() => {
    app.renderer?.scene.dispose(); app.renderer?.engine.dispose();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  const tick = async (ms = 1000 / 60) => { now += ms; app.renderer.engine.tick(); await flush(); };
  const chosenUrl = () => appearance.appearanceVariant(app.game.appearance).url;
  return { app, $, document, requests, errors, worldLoad, tick, chosenUrl,
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
  assert.equal(h.$('spirit-bar').attrs['aria-valuenow'], 28);
  assert.ok(Math.abs(parseFloat(h.$('spirit-fill').style.width) - 28) < 1e-8);
  assert.equal(h.$('skill-wave').classList.contains('insufficient'), true);
  assert.equal(h.$('wave-cost').textContent, String(MONK_RULES.wave.cost));
  const zoneState = () => ['camp', 'road', 'courtyard'].map(id => [h.$(`zone-${id}`).classList.contains('current'),
    h.$(`zone-${id}`).classList.contains('visited'), h.$(`zone-${id}`).attrs['aria-current']]);
  assert.deepEqual(zoneState(), [[true, true, 'location'], [false, false, 'false'], [false, false, 'false']]);
  game.locationId = 'road'; game.player.spirit = 64; game.adventure.visited.push('road');
  h.app.updateHud();
  assert.equal(h.$('location-title').textContent, 'Разбитая дорога');
  assert.equal(h.$('kill-count').textContent, '1 / 1');
  assert.equal(h.$('skill-wave').classList.contains('insufficient'), false);
  assert.equal(h.$('spirit-text').textContent, '64 / 100');
  assert.deepEqual(zoneState(), [[false, true, 'false'], [true, true, 'location'], [false, false, 'false']]);
  assert.equal(h.$('combat-state').classList.contains('warning'), false);
  game.player.hp = 20;
  h.app.updateHud();
  assert.equal(h.$('combat-state').classList.contains('warning'), true);
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
