import test from 'node:test';
import assert from 'node:assert/strict';
import { CacheGlow, CACHE_TIMING, CACHE_FRAMES } from '../src/cache-glow.js';

test('unopened seal breathes over 1.6 seconds and the motes cycle', () => {
  const glow = new CacheGlow();
  const dim = { ...glow.update(false, 0) };
  const bright = { ...glow.update(false, .8) };
  const loop = { ...glow.update(false, 1.6) };
  assert.equal(CACHE_TIMING.pulse, 1.6);
  assert.equal(dim.frame, 0);
  assert.equal(bright.frame, 3);
  assert.equal(loop.frame, dim.frame);
  assert.ok(bright.moteAlpha > dim.moteAlpha && bright.poolAlpha > dim.poolAlpha);
  assert.notEqual(bright.moteFrame, dim.moteFrame);
  assert.equal(glow.update(false, 2.4).moteFrame, dim.moteFrame);
});

test('opening plays three lid frames, bursts outward and fades over half a second', () => {
  const glow = new CacheGlow();
  glow.update(false, .8);
  assert.equal(glow.update(true, .8).frame, 4);
  const a = { ...glow.update(true, .91) };
  const b = { ...glow.update(true, 1.01) };
  assert.equal(a.frame, 5);
  assert.equal(b.frame, 6);
  assert.ok(a.moteFrame >= CACHE_FRAMES.burst && a.moteFrame < CACHE_FRAMES.steady);
  assert.ok(b.moteFrame > a.moteFrame, 'outward burst advances before fading');
  assert.ok(a.moteAlpha > b.moteAlpha && b.moteAlpha > 0);
  const done = { ...glow.update(true, 1.31) };
  assert.equal(done.frame, 7);
  assert.equal(done.poolAlpha, 0);
  assert.equal(done.moteAlpha, 0);
  assert.deepEqual(glow.update(true, 99), done);
});

test('graphics off hides only the ground pool and leaves the rune and motes animated', () => {
  const on = new CacheGlow(), off = new CacheGlow();
  const a = { ...on.update(false, .8) };
  const b = { ...off.update(false, .8, { lightPools: false }) };
  assert.equal(b.frame, a.frame);
  assert.equal(b.moteFrame, a.moteFrame);
  assert.equal(b.moteAlpha, a.moteAlpha);
  assert.equal(b.poolAlpha, 0);
  assert.ok(a.poolAlpha > 0);
  assert.equal(off.update(false, .8).poolAlpha, a.poolAlpha);
});

test('pause repeats exactly the same pose; reduced motion holds a clear lit seal', () => {
  const glow = new CacheGlow();
  const pose = { ...glow.update(false, .6) };
  assert.deepEqual(glow.update(false, .6), pose);
  const a = { ...glow.update(false, .7, { reducedMotion: true }) };
  assert.deepEqual(glow.update(false, 99, { reducedMotion: true }), a);
  assert.equal(a.frame, 3);
  assert.equal(a.moteFrame, CACHE_FRAMES.steady);
  assert.equal(glow.update(true, 99, { reducedMotion: true }).frame, 7);
});

test('a restored opened cache is empty with no replay; a new run resets it', () => {
  const glow = new CacheGlow();
  const restored = glow.update(true, 0);
  assert.equal(restored.frame, 7);
  assert.equal(restored.moteAlpha, 0);
  assert.equal(restored.poolAlpha, 0);
  assert.equal(glow.update(false, 0).frame, 0);
  assert.equal(glow.update(true, .1).frame, 4);
});

test('each cache owns an independent opening timer, even after a clock reset', () => {
  const a = new CacheGlow(), b = new CacheGlow();
  a.update(false, 2); b.update(false, 2);
  a.update(true, 3);
  assert.equal(a.update(true, 3.2).frame, 6);
  assert.ok(b.update(false, 3.2).moteAlpha > 0);
  assert.equal(a.update(false, 0).frame, 0);
});

import { readFileSync } from 'node:fs';
import { readPng } from './helpers/png.js';
import { NullEngine, Scene, Texture } from '@babylonjs/core';
import { buildPixelWorld, pixelAtlases } from '../src/pixel-scene.js';
import { Renderer } from '../src/render.js';

test('delivered atlas keeps its footprint and its mask matches PNG alpha exactly', () => {
  const pkg = new URL('../assets/game/pixel-v15/cache/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', pkg)));
  assert.equal(manifest.nativePixelsPerUnit, 32);
  assert.deepEqual(manifest.footprint, { width: .68, depth: .44, lidWidth: .73, lidDepth: .49,
    collision: 'unchanged; owned by world layout', pickable: false });
  assert.equal(pixelAtlases.cache.frames[7], 'open-empty');
  const png = readPng(new URL('cache.png', pkg));
  const mask = JSON.parse(readFileSync(new URL('hit-masks.json', pkg)))['cache.png'];
  const bits = Buffer.from(mask.bits, 'base64');
  assert.equal(png.width, mask.width);
  assert.equal(png.height, mask.height);
  assert.equal(bits.length * 8, png.width * png.height);
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const i = y * png.width + x;
    assert.equal(!!(bits[i >> 3] & (1 << (i & 7))), png.alpha(x, y) >= 128);
    if (y < 128) assert.ok([0, 255].includes(png.alpha(x, y)), 'chest alpha is binary');
  }
  assert.equal(manifest.visualScale, 1.32);
  assert.equal(manifest.beacon.poolRadius, 1.5);
  assert.equal(manifest.beacon.shaftHeight, 2);
  assert.equal(manifest.beacon.motes, 8);
  const cell = manifest.cache.cell, columns = manifest.cache.columns;
  assert.equal(cell, 128);
  assert.deepEqual(manifest.cache.anchor, [64, 96]);
  const poolFrame = manifest.cache.frames.indexOf('ground-pool');
  const px = poolFrame % columns * cell, py = Math.floor(poolFrame / columns) * cell;
  const levels = new Set(), bins = Array.from({ length: 5 }, () => []);
  for (let y=0;y<cell;y++) for(let x=0;x<cell;x++) {
    const radius = Math.hypot((x-64)/48,(y-96)/24), alpha=png.alpha(px+x,py+y);
    levels.add(alpha);
    if(radius < 1) bins[Math.min(4,Math.floor(radius*5))].push(alpha);
    else assert.equal(alpha,0,'no rim beyond 1.5u');
  }
  assert.deepEqual([...levels].sort((a,b)=>a-b), [0,48,96,144,192]);
  const means=bins.map(bin=>bin.reduce((a,b)=>a+b,0)/bin.length);
  assert.ok(means.every((v,i)=>!i || v<means[i-1]), 'dither coverage falls without hard rings');
  // The opaque chest itself is larger; effects do not count towards the measured bounds.
  const frameAlpha=(frame,x,y)=>png.alpha(frame%columns*cell+x,Math.floor(frame/columns)*cell+y);
  const shaftYs=Array.from({length:cell},(_,y)=>y).filter(y=>frameAlpha(CACHE_FRAMES.motes+2,64,y)>0);
  assert.ok(Math.max(...shaftYs)-Math.min(...shaftYs)>=54,'the peak shaft reaches about 2u');
  assert.ok(Array.from({length:cell},(_,y)=>frameAlpha(CACHE_FRAMES.motes+10,64,y)).every(a=>a===0),'no shaft between calls');
  const points=new Set();
  for(let y=0;y<cell;y++)for(let x=0;x<cell;x++)if(frameAlpha(CACHE_FRAMES.motes+10,x,y))points.add(y*cell+x);
  let clusters=0;
  while(points.size){
    clusters++;
    const first=points.values().next().value, pending=[first]; points.delete(first);
    while(pending.length){
      const i=pending.pop(),x=i%cell,y=Math.floor(i/cell);
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const nx=x+dx,ny=y+dy,j=ny*cell+nx;
        if(nx>=0&&nx<cell&&ny>=0&&ny<cell&&points.delete(j))pending.push(j);
      }
    }
  }
  assert.equal(clusters,8,'eight distinct mote clusters remain between calls');
  const burstWidth=frame=>{
    const xs=[];
    for(let y=0;y<cell;y++)for(let x=0;x<cell;x++)if(frameAlpha(frame,x,y))xs.push(x);
    return Math.max(...xs)-Math.min(...xs)+1;
  };
  assert.ok(burstWidth(CACHE_FRAMES.burst+7)>burstWidth(CACHE_FRAMES.burst)+30,'opening motes expand outward');
  const old=readPng(new URL('../assets/game/pixel-v14/cache/cache.png',import.meta.url));
  const bounds=(image,size) => {
    const xs=[],ys=[];
    for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(image.alpha(x,y)) {xs.push(x);ys.push(y);}
    return [Math.max(...xs)-Math.min(...xs)+1,Math.max(...ys)-Math.min(...ys)+1];
  };
  const large=bounds(png,cell), small=bounds(old,96);
  for(let i=0;i<2;i++) assert.ok(large[i]/small[i]>=1.25 && large[i]/small[i]<=1.4, '1.25–1.4x chest silhouette');

});

test('cache sprites keep picking and positions unchanged, fade after opening and release all resources', t => {
  const engine = new NullEngine(), scene = new Scene(engine);
  engine.createCanvas = (width, height) => ({ width, height, getContext: () => ({
    clearRect() {}, beginPath() {}, arc() {}, stroke() {}, moveTo() {}, lineTo() {}, closePath() {}, fillRect() {},
  }) });
  t.after(() => { scene.dispose(); engine.dispose(); });
  const assets = Object.fromEntries(Object.entries(pixelAtlases).map(([name, atlas]) =>
    [name, { ...atlas, texture: new Texture(null, scene) }]));
  const count = () => [scene.meshes.length, scene.materials.length, scene.textures.length];
  const baseline = count();
  const world = buildPixelWorld(scene, assets, {
    id: 'legacy', tiles: [{x:0,y:0}], pillars: [], braziers: [], shrine: null, exit: null,
    caches: [{id:'secret',x:2,y:3}], shrines: [], portals: [],
  });
  const cache = world.caches[0];
  const meshes = [cache.sprite, cache.motes, cache.pool].map(s => s.mesh);
  assert.equal(meshes.length, 3, 'three draws replace the old four');
  assert.ok(meshes.every(mesh => !mesh.isPickable));
  assert.ok(meshes.every(mesh => mesh.position.x === 2 && mesh.position.z === 3));
  assert.ok(!world.props.includes(cache.sprite), 'cache art does not join the scenery picking list');
  const renderer = {world, reducedMotion:false, polish:{options:{lightPools:true}}};
  const game = {adventure:{cachesFound:[]}};
  Renderer.prototype.updateLocationState.call(renderer,game,0);
  assert.ok(cache.pool.mesh.isEnabled());
  renderer.polish.options.lightPools = false;
  Renderer.prototype.updateLocationState.call(renderer,game,.8);
  assert.equal(cache.sprite.frame,3);
  assert.equal(cache.pool.mesh.isEnabled(),false);
  assert.ok(cache.motes.mesh.isEnabled());
  Renderer.prototype.freezeWorld.call(renderer);
  assert.ok(meshes.every(mesh => mesh.isWorldMatrixFrozen));
  game.adventure.cachesFound.push('secret');
  Renderer.prototype.updateLocationState.call(renderer,game,1);
  assert.equal(cache.sprite.frame,4);
  Renderer.prototype.updateLocationState.call(renderer,game,1.6);
  assert.equal(cache.sprite.frame,7);
  assert.equal(cache.motes.mesh.isEnabled(),false);
  assert.equal(cache.pool.mesh.isEnabled(),false);
  world.dispose(); world.dispose();
  assert.deepEqual(count(),baseline);
});

test('the shaft calls for 0.6 s every 2.4 s and remains with graphics off', () => {
  const glow=new CacheGlow();
  assert.equal(CACHE_TIMING.call,2.4);
  assert.equal(CACHE_TIMING.shaft,.6);
  assert.equal(glow.update(false,0).moteFrame,CACHE_FRAMES.motes);
  assert.equal(glow.update(false,.24).moteFrame,CACHE_FRAMES.motes+2);
  assert.equal(glow.update(false,.6).moteFrame,CACHE_FRAMES.motes+6);
  assert.equal(glow.update(false,2.4).moteFrame,CACHE_FRAMES.motes);
  const on={...glow.update(false,.24)};
  const off=glow.update(false,.24,{lightPools:false});
  assert.equal(off.moteFrame,on.moteFrame);
  assert.equal(off.moteAlpha,on.moteAlpha);
  assert.equal(off.poolAlpha,0);
});

test('reduced motion holds the shaft and motes steady even during opening', () => {
  const glow=new CacheGlow();
  const closed={...glow.update(false,.2,{reducedMotion:true})};
  assert.equal(closed.moteFrame,CACHE_FRAMES.steady);
  assert.deepEqual(glow.update(false,2,{reducedMotion:true}),closed);
  const opened={...glow.update(true,2,{reducedMotion:true})};
  assert.equal(opened.moteFrame,CACHE_FRAMES.steady);
  assert.equal(opened.frame,7);
  assert.equal(glow.update(true,2.6,{reducedMotion:true}).moteAlpha,0);
});
