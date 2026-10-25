import test from 'node:test';
import assert from 'node:assert/strict';
import { Renderer, worldScale } from '../src/render.js';

const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`);

test('touch screens count device pixels: the spec table (docs/design/mobile-touch.md §3)', () => {
  for (const [name, width, height, dpr, k, renderWidth, renderHeight] of [
    ['iPhone 14', 844, 390, 3, 4, 633, 292],
    ['Pixel 7', 915, 412, 2.625, 4, 600, 270],
    ['iPhone SE', 667, 375, 2, 2, 667, 375],
  ]) {
    const fit = worldScale({ width, height, dpr, coarse: true });
    assert.equal(fit.devicePerPixel, k, name);
    assert.deepEqual([fit.renderWidth, fit.renderHeight], [renderWidth, renderHeight], name);
    near(fit.cssPerPixel, k / dpr, name);
    // Every world pixel is k whole device pixels, and the box starts on a device pixel.
    for (const [value, label] of [[fit.box.width, 'width'], [fit.box.height, 'height'], [fit.box.left, 'left'], [fit.box.top, 'top']]) {
      near(value * dpr, Math.round(value * dpr), `${name} ${label} on device pixels`);
    }
    near(fit.box.width * dpr, renderWidth * k, `${name} box width`);
    assert.ok(fit.box.left + fit.box.width <= width + 1e-9 && fit.box.top + fit.box.height <= height + 1e-9, `${name} fits`);
  }
  // A tall tablet still keeps at least two device pixels per world pixel and scales up with height.
  assert.equal(worldScale({ width: 1366, height: 1024, dpr: 2, coarse: true }).devicePerPixel, 7);
  assert.equal(worldScale({ width: 400, height: 200, dpr: 1, coarse: true }).devicePerPixel, 2);
});

test('the desktop scale is unchanged: whole CSS px, max(2, floor(min(W / 640, H / 360)))', () => {
  for (let width = 640; width <= 3840; width += 97) for (let height = 360; height <= 2160; height += 71) {
    for (const dpr of [1, 2]) {
      const fit = worldScale({ width, height, dpr });
      const scale = Math.max(2, Math.floor(Math.min(width / 640, height / 360)));
      const displayWidth = Math.floor(width / scale) * scale, displayHeight = Math.floor(height / scale) * scale;
      assert.deepEqual(fit, { cssPerPixel: scale, renderWidth: displayWidth / scale, renderHeight: displayHeight / scale,
        box: { width: displayWidth, height: displayHeight,
          left: Math.floor((width - displayWidth) / 2), top: Math.floor((height - displayHeight) / 2) } });
    }
  }
  assert.deepEqual([worldScale({ width: 1174, height: 813 }).renderWidth, worldScale({ width: 1174, height: 813 }).renderHeight], [587, 406]);
});

test('Renderer.resize applies the touch scale to the engine, both canvases and the orthographic camera', t => {
  const restore = { document: globalThis.document, dpr: globalThis.devicePixelRatio };
  t.after(() => { globalThis.document = restore.document; globalThis.devicePixelRatio = restore.dpr; });
  globalThis.document = { documentElement: { clientWidth: 844, clientHeight: 390 } };
  globalThis.devicePixelRatio = 3;
  const calls = [];
  const engine = {
    size: [0, 0], level: 1,
    setHardwareScalingLevel(level) { this.level = level; calls.push(['level', level]); },
    // Babylon reads the rounded CSS size here: one world pixel short on this phone.
    resize() { this.size = [Math.floor(844 / this.level), Math.floor(390 / this.level)]; },
    setSize(width, height) { this.size = [width, height]; calls.push(['size', width, height]); },
    getRenderWidth() { return this.size[0]; }, getRenderHeight() { return this.size[1]; },
  };
  const canvas = { style: {} }, overlay = { style: {} };
  const r = Object.assign(Object.create(Renderer.prototype), { engine, canvas, overlay, camera: {}, ctx: {}, coarsePointer: true });
  r.resize();
  near(engine.level, 4 / 3, 'four device pixels per world pixel');
  assert.deepEqual([r.width, r.height], [633, 292]);
  assert.deepEqual([overlay.width, overlay.height], [633, 292]);
  for (const box of [canvas.style, overlay.style]) {
    near(parseFloat(box.width), 844, 'box width'); near(parseFloat(box.height), 292 * 4 / 3, 'box height');
  }
  near(r.camera.orthoTop, 292 * 1.2 / 64, 'the camera shows the same world per world pixel');
  near(r.camera.orthoRight, 633 * 1.2 / 64, 'half width');
  assert.equal(r.ctx.imageSmoothingEnabled, false);
  // The desktop path keeps its whole CSS pixels.
  r.coarsePointer = false;
  r.resize();
  assert.equal(engine.level, 2);
  assert.deepEqual([r.width, r.height], [422, 195]);
});

test('a phone sizes the world from the visual viewport (iPhone toolbar); desktop keeps the layout viewport', t => {
  const restore = { document: globalThis.document, dpr: globalThis.devicePixelRatio, visual: globalThis.visualViewport };
  t.after(() => { globalThis.document = restore.document; globalThis.devicePixelRatio = restore.dpr; globalThis.visualViewport = restore.visual; });
  // Safari landscape: the layout viewport is 390 tall, the toolbar leaves 340 visible, scrolled 12.4 px down.
  globalThis.document = { documentElement: { clientWidth: 844, clientHeight: 390 } };
  globalThis.devicePixelRatio = 3;
  globalThis.visualViewport = { width: 844, height: 340, offsetLeft: 0, offsetTop: 12.4 };
  const engine = {
    size: [0, 0], level: 1,
    setHardwareScalingLevel(level) { this.level = level; }, resize() {}, setSize(width, height) { this.size = [width, height]; },
    getRenderWidth() { return this.size[0]; }, getRenderHeight() { return this.size[1]; },
  };
  const canvas = { style: {} }, overlay = { style: {} };
  const r = Object.assign(Object.create(Renderer.prototype), { engine, canvas, overlay, camera: {}, ctx: {}, coarsePointer: true });
  r.resize();
  const phone = worldScale({ width: 844, height: 340, dpr: 3, coarse: true });
  assert.deepEqual([r.width, r.height], [phone.renderWidth, phone.renderHeight], 'the world fits the visible 340 px');
  near(parseFloat(canvas.style.height), phone.box.height, 'box height');
  near(parseFloat(canvas.style.top), phone.box.top + Math.round(12.4 * 3) / 3, 'the canvas follows the visual viewport down');
  near(parseFloat(canvas.style.top) * 3, Math.round(parseFloat(canvas.style.top) * 3), 'on a device pixel');
  assert.equal(overlay.style.top, canvas.style.top);
  // A desktop pinch-zoom changes the visual viewport; the world keeps the layout viewport.
  r.coarsePointer = false;
  globalThis.devicePixelRatio = 1;
  r.resize();
  const desktop = worldScale({ width: 844, height: 390 });
  assert.deepEqual([r.width, r.height], [desktop.renderWidth, desktop.renderHeight]);
  assert.equal(canvas.style.top, `${desktop.box.top}px`);
  // Without a visual viewport a phone falls back to the layout viewport.
  r.coarsePointer = true; globalThis.devicePixelRatio = 3; globalThis.visualViewport = undefined;
  r.resize();
  assert.deepEqual([r.width, r.height], [633, 292]);
});
