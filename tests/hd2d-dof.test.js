import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine, Scene, ArcRotateCamera, Camera, Vector3, Matrix, PassPostProcess } from '@babylonjs/core';
import { install, focusAnchor } from '../src/hd2d/dof.js';
import { createHD2D, effects } from '../src/hd2d/index.js';
import { ZoneGrade } from '../src/zone-grade.js';

function fixture() {
  const engine = new NullEngine({ renderWidth: 633, renderHeight: 292 });
  const scene = new Scene(engine);
  const camera = new ArcRotateCamera('iso', Math.PI / 4, Math.PI / 3, 30, Vector3.Zero(), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.orthoLeft = -12; camera.orthoRight = 12;
  camera.orthoBottom = -6; camera.orthoTop = 6;
  const renderer = { monk: { mesh: { position: new Vector3(0, .025, 0) } }, coarsePointer: true };
  return { engine, scene, camera, renderer, tier: 'off' };
}

const tickReady = async effect => {
  for (let i = 0; i < 30; i++) { effect.update(0, 0); await new Promise(r => setTimeout(r, 5)); }
};
const attached = ctx => ctx.camera._postProcesses.filter(Boolean);

test('off has no postprocess or target and switching back restores the original chain', async () => {
  const ctx = fixture();
  const effect = install(ctx);
  try {
    assert.equal(ctx.engine.postProcesses.length, 0);
    effect.update(1, 1);
    assert.equal(attached(ctx).length, 0);
    effect.setTier('low');
    await tickReady(effect);
    assert.equal(attached(ctx).length, 1);
    const low = attached(ctx)[0];
    assert.ok(low.isReady());
    effect.setTier('high');
    await tickReady(effect);
    assert.equal(attached(ctx).length, 1);
    assert.notEqual(attached(ctx)[0], low);
    effect.setTier('off');
    assert.equal(attached(ctx).length, 0);
    assert.equal(ctx.engine.postProcesses.length, 0);
    effect.setTier('low');
    await tickReady(effect);
    effect.dispose(); effect.dispose();
    effect.update(1, 1); effect.setTier('high');
    assert.equal(attached(ctx).length, 0);
    assert.equal(ctx.engine.postProcesses.length, 0);
  } finally { effect.dispose(); ctx.scene.dispose(); ctx.engine.dispose(); }
});

test('focus uses the drawn monk position and moves with camera lag instead of screen centre', () => {
  const ctx = fixture(), transform = new Matrix(), projected = new Vector3();
  try {
    const centre = focusAnchor(ctx.camera, ctx.renderer.monk.mesh.position, transform, projected);
    assert.ok(Math.abs(centre - .5018) < .002);
    ctx.camera.target.set(3, 0, 3);
    const offset = focusAnchor(ctx.camera, ctx.renderer.monk.mesh.position, transform, projected);
    assert.ok(Math.abs(offset - centre) > .15, `${centre} -> ${offset}`);
    ctx.renderer.monk.mesh.position.set(3, .025, 3);
    assert.ok(Math.abs(focusAnchor(ctx.camera, ctx.renderer.monk.mesh.position, transform, projected) - centre) < 1e-5);
    ctx.engine.setSize(1266, 584);
    assert.ok(Math.abs(focusAnchor(ctx.camera, ctx.renderer.monk.mesh.position, transform, projected) - centre) < 1e-5);
  } finally { ctx.scene.dispose(); ctx.engine.dispose(); }
});

test('DOF alone clears its scene input including depth on every frame', async () => {
  const ctx = fixture(), effect = install({ ...ctx, tier: 'low' });
  const events = [];
  let bound = null;
  const bind = ctx.engine.bindFramebuffer.bind(ctx.engine);
  const restore = ctx.engine.restoreDefaultFramebuffer.bind(ctx.engine);
  const clear = ctx.engine.clear.bind(ctx.engine);
  ctx.engine.bindFramebuffer = (target, ...args) => { bound = target; return bind(target, ...args); };
  ctx.engine.restoreDefaultFramebuffer = (...args) => { bound = null; return restore(...args); };
  ctx.engine.clear = (color, back, depth, stencil) => {
    events.push({ bound, back, depth, stencil });
    return clear(color, back, depth, stencil);
  };
  try {
    await tickReady(effect);
    const pass = attached(ctx)[0];
    ctx.scene.render(); ctx.scene.render();
    const clears = events.filter(e => e.bound === pass.inputTexture && e.back && e.depth && e.stencil);
    assert.equal(clears.length, 2, 'the scene RTT must not retain color or depth from the last frame');
  } finally { effect.dispose(); ctx.scene.dispose(); ctx.engine.dispose(); }
});


test('real production host registers DOF and honors per-effect off and tier changes', async () => {
  const ctx = fixture();
  // Use the production registry entry without installing unrelated future HD modules.
  const modules = effects.filter(module => module.id === 'dof');
  const host = createHD2D(ctx, { tier: 'high', overrides: { dof: 'off' } }, modules);
  try {
    assert.equal(host.active, false);
    assert.equal(ctx.engine.postProcesses.length, 0);
    host.setTier('low');
    assert.equal(host.active, true, 'the production registry must install DOF');
    await tickReady(host);
    assert.equal(attached(ctx).length, 1);
    host.onWorld(ctx.renderer);
    host.setTier({ tier: 'high', overrides: { dof: 'off' } });
    assert.equal(host.active, false);
    assert.equal(attached(ctx).length, 0);
    assert.equal(ctx.engine.postProcesses.length, 0);
    host.setTier('high'); await tickReady(host);
    assert.equal(attached(ctx).length, 1);
    ctx.scene.dispose();
    assert.equal(host.active, false);
    assert.equal(ctx.engine.postProcesses.length, 0);
  } finally { host.dispose(); ctx.scene.dispose(); ctx.engine.dispose(); }
});


test('48 DOF tier cycles restore raw chain slots, foreign passes and stereo rig copies', async () => {
  const ctx = fixture();
  ctx.camera.setCameraRigMode(Camera.RIG_MODE_STEREOSCOPIC_SIDEBYSIDE_PARALLEL, { interaxialDistance: .064 });
  const first = new PassPostProcess('foreign-first', 1, ctx.camera);
  const gap = new PassPostProcess('foreign-gap', 1, ctx.camera);
  const last = new PassPostProcess('foreign-last', 1, ctx.camera);
  ctx.camera.detachPostProcess(gap); gap.dispose();
  const baseline = ctx.camera._postProcesses.slice();
  const rigs = ctx.camera.rigCameras;
  assert.equal(rigs.length, 2);
  const rigBaselines = rigs.map(rig => rig._postProcesses.slice());
  const effect = install(ctx);
  try {
    for (let cycle = 0; cycle < 48; cycle++) {
      effect.setTier(cycle % 2 ? 'high' : 'low');
      await tickReady(effect);
      assert.equal(ctx.camera._postProcesses.length, baseline.length + 1);
      effect.setTier('off');
      assert.equal(ctx.camera._postProcesses.length, baseline.length, `raw slots after cycle ${cycle}`);
      assert.ok(ctx.camera._postProcesses.every((pass, i) => pass === baseline[i]), 'foreign passes and pre-existing null slot stay intact');
      for (let i = 0; i < rigs.length; i++) {
        assert.equal(rigs[i]._postProcesses.length, rigBaselines[i].length, `rig ${i} slots after cycle ${cycle}`);
        assert.ok(rigs[i]._postProcesses.every((pass, j) => pass === rigBaselines[i][j]), 'rig sees the compacted parent chain');
      }
    }
  } finally { effect.dispose(); first.dispose(); last.dispose(); ctx.scene.dispose(); ctx.engine.dispose(); }
});

const readyGrade = async grade => {
  for (let i = 0; i < 40 && !grade.attached; i++) {
    grade.update('road', 0);
    if (!grade.attached) await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.ok(grade.attached, 'the real ZoneGrade must finish compilation and attach');
};

test('DOF orders a late zone grade and independent fallback grade with bloom off', async () => {
  const ctx = fixture();
  const modules = effects.filter(module => module.id === 'bloom' || module.id === 'dof');
  const host = createHD2D(ctx, { tier: 'off', overrides: { dof: 'low' } }, modules);
  const grade = new ZoneGrade(ctx.camera), fallback = new ZoneGrade(ctx.camera);
  let finalPass;
  const names = () => ctx.camera._postProcesses.filter(Boolean).map(pass => pass.name);
  try {
    await tickReady(host);
    assert.deepEqual(names(), ['hd2d-dof'], 'bloom is off and cannot repair the chain');
    await readyGrade(grade);
    host.update(0, 0);
    assert.deepEqual(names(), ['zone-grade', 'hd2d-dof']);

    grade.dispose();
    finalPass = new PassPostProcess('foreign-final', 1, ctx.camera);
    finalPass.metadata = { hd2dOrder: 100 };
    // Atmos uses an independent ZoneGrade when the stage-0 grade is disabled.
    await readyGrade(fallback);
    host.update(0, 0);
    assert.deepEqual(names(), ['zone-grade', 'hd2d-dof', 'foreign-final']);
    assert.equal(ctx.camera._postProcesses[0], null, "do not compact another effect's detached slot");

    host.setTier({ tier: 'off', overrides: { dof: 'high' } });
    let dof;
    for (let frame = 0; frame < 40 && !dof; frame++) {
      host.update(0, 0);
      dof = ctx.camera._postProcesses.find(pass => pass?.name === 'hd2d-dof');
      if (!dof) await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.ok(dof);
    assert.deepEqual(names(), ['zone-grade', 'hd2d-dof', 'foreign-final'], 'the first update that attaches DOF already has the correct order');
    ctx.scene.render();
    const sizes = ctx.camera._postProcesses.filter(Boolean).map(pass => [pass, pass.width]);
    assert.ok(sizes.every(([, width]) => width > 0));
    for (let i = 0; i < 30; i++) host.update(0, 0);
    assert.ok(sizes.every(([pass, width]) => pass.width === width), 'an already ordered update must not invalidate any render target');
    host.setTier('off');
    assert.deepEqual(names(), ['zone-grade', 'foreign-final']);
  } finally { host.dispose(); grade.dispose(); fallback.dispose(); finalPass?.dispose(); ctx.scene.dispose(); ctx.engine.dispose(); }
});
