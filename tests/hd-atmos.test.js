import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine, Scene, ArcRotateCamera, Vector3, ShaderMaterial } from '@babylonjs/core';
import { ZoneGrade, ZONE_GRADES } from '../src/zone-grade.js';

// A missing off-restore or an eager resource allocation breaks the presentation contract.
test('HD grade returns immediately to the stage-0 profile when disabled', () => {
  const e = new NullEngine(), s = new Scene(e), c = new ArcRotateCamera('qa', 0, 1, 30, Vector3.Zero(), s);
  const grade = new ZoneGrade(c);
  try {
    grade.update('camp', 1);
    grade.setAtmosphere('low'); grade.update('camp', 1);
    assert.ok(grade.current.gain[0] < ZONE_GRADES.camp.gain[0]);
    grade.setAtmosphere('off'); grade.update('camp', 0);
    assert.deepEqual(grade.current.gain, ZONE_GRADES.camp.gain);
  } finally { grade.dispose(); s.dispose(); e.dispose(); }
});

test('atmos off allocates nothing; toggles and world rebuild release owned shafts', async () => {
  const { install } = await import('../src/hd2d/atmos.js');
  const e = new NullEngine(), s = new Scene(e), c = new ArcRotateCamera('qa', Math.PI/4, Math.PI/3, 30, Vector3.Zero(), s);
  const ground = new ShaderMaterial('ground', s, {}, { uniforms: ['hdAtmos', 'hdFocus', 'hdHaze', 'hdTime'] });
  const grade = new ZoneGrade(c);
  const data = { id: 'orchard', setDressing: [{kind:'olive-tree-a',contact:{x:0,y:0}}, {kind:'olive-tree-b',contact:{x:4,y:0}}] };
  const renderer = { world: {data, landscape:{groundMaterial:ground}}, polish:{grade,options:{zoneGrade:true}}, game:{world:data,player:{x:0,y:0}}, reducedMotion:false };
  const before = [s.meshes.length,s.materials.length,s.postProcesses.length];
  const effect = install({scene:s, engine:e, camera:c, renderer, tier:'off'});
  try {
    effect.update(1/60, 1); assert.deepEqual([s.meshes.length,s.materials.length,s.postProcesses.length],before);
    effect.setTier('low'); effect.update(1/60, 1);
    assert.equal(s.meshes.length,1); assert.equal(s.meshes[0].isPickable,false);
    const old = s.meshes[0]; effect.update(1/60,2); assert.equal(s.meshes[0],old);
    effect.setTier('high'); effect.update(1/60,3); assert.equal(s.meshes[0],old);
    renderer.world = {data,landscape:{groundMaterial:ground}}; effect.onWorld(renderer);
    assert.ok(old.isDisposed()); assert.equal(s.meshes.length,1);
    effect.setTier('off'); assert.equal(s.meshes.length,0); assert.equal(ground._floats.hdAtmos,0);
    effect.setTier('low'); effect.dispose(); effect.dispose(); assert.equal(s.meshes.length,0);
    assert.equal(ground._floats.hdAtmos,0);
  } finally { effect.dispose(); grade.dispose(); s.dispose(); e.dispose(); }
});

// Removing the shadow mask or letting it snap across a paused zone boundary breaks this contract.
test('courtyard shadow tint fades between zones, holds on pause and clears immediately in off', () => {
  const e = new NullEngine(), s = new Scene(e), c = new ArcRotateCamera('qa', 0, 1, 30, Vector3.Zero(), s);
  const grade = new ZoneGrade(c), uploaded = {};
  const gpu = { setFloat(name,value) { uploaded[name]=value; }, setFloat2() {}, setFloat3() {}, setFloat4() {} };
  const step = (zone,dt) => { grade.update(zone,dt); grade.pass.onApplyObservable.notifyObservers(gpu); return uploaded.hdCourtyard; };
  try {
    grade.setAtmosphere('low'); assert.equal(step('courtyard',0),1);
    assert.equal(step('road',0),1,'paused camera does not advance the colour transition');
    assert.ok(step('road',.2) > .60 && uploaded.hdCourtyard < .61);
    for(let i=0;i<120;i++)step('road',.03);
    assert.ok(uploaded.hdCourtyard < .001);
    grade.setAtmosphere('off'); assert.equal(step('courtyard',0),0);
  } finally { grade.dispose(); s.dispose(); e.dispose(); }
});
