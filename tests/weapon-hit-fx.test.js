import test from 'node:test';
import assert from 'node:assert/strict';
import { WeaponHitFx } from '../src/render.js';

const image = { complete: true, naturalWidth: 1152 };
const game = { player: { attack: null }, inventory: { equipped: { weapon: null } } };
const swing = (weapon, strength = 'light') => ({ type: 'swing', weapon, source: 'combo', strength, index: 0, age: .1 });
const hit = (strength = 'light', type = 'impact') => ({ type, source: 'combo', strength, age: 0, x: 2, y: 3, dx: 1, dy: 0 });
const matrix = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 50, 50, 0, 1]);
function draw(fx, calm = false) {
  const calls = [], c = { globalAlpha: .4, globalCompositeOperation: 'screen', imageSmoothingEnabled: true,
    drawImage(...args) { calls.push(args); } };
  fx.draw(c, matrix, 32, 200, 200, calm);
  assert.equal(c.globalAlpha, .4);
  assert.equal(c.globalCompositeOperation, 'screen');
  assert.equal(c.imageSmoothingEnabled, true);
  return calls;
}

test('combo contacts select distinct family art and bigger finisher art from the originating swing', () => {
  for (const [weapon, row] of [[null, 0], ['knuckles', 16], ['staff', 32]]) {
    for (const [strength, extra] of [['light', 0], ['heavy', 8]]) {
      const fx = new WeaponHitFx(image), event = Object.freeze(hit(strength));
      fx.sync([swing(weapon, strength), event], game);
      const cell = draw(fx)[0];
      assert.equal(cell[1], row + extra >= 24 ? 576 : 0);
      assert.equal(cell[2], ((row + extra) % 24) * 96);
      assert.equal(fx.replaces(event), true);
    }
  }
});

test('a captured contact retains its weapon when a later swing or equipment changes', () => {
  const fx = new WeaponHitFx(image), event = hit();
  fx.sync([swing('staff'), event], game);
  event.age = .04;
  fx.sync([event, swing('knuckles')], game);
  assert.equal(draw(fx)[0][2], 768);
});

test('only normal melee contacts use the new effect; shell block remains an additional reaction', () => {
  const fx = new WeaponHitFx(image), block = hit('light', 'block');
  const wave = { ...hit(), source: 'wave' };
  fx.sync([swing('knuckles'), block, wave], game);
  assert.equal(draw(fx).length, 1);
  assert.equal(fx.replaces(block), false);
  assert.equal(fx.replaces(wave), false);
});

test('pool storage stays bounded and slots are reused; expiry and a reset leave no stale contacts', () => {
  const fx = new WeaponHitFx(image), slots = fx.slots, first = slots[0];
  const events = [swing('knuckles'), ...Array.from({ length: 180 }, () => hit())];
  fx.sync(events, game);
  assert.ok(draw(fx).length <= 96);
  fx.sync(events, game);
  assert.ok(draw(fx).length <= 96);
  for (const e of events) e.age = 1;
  fx.sync(events, game);
  assert.equal(draw(fx).length, 0);
  fx.sync([], game);
  fx.sync([swing('staff'), hit()], game);
  assert.equal(draw(fx).length, 1);
  assert.equal(fx.slots, slots);
  assert.equal(fx.slots[0], first);
});

test('presentation ages freeze the drawing while paused and reduced motion holds the first frame', () => {
  const fx = new WeaponHitFx(image), event = hit();
  fx.sync([swing('staff'), event], game);
  event.age = .09;
  const normal = draw(fx), paused = draw(fx), calm = draw(fx, true);
  assert.deepEqual(normal, paused);
  assert.ok(normal[0][1] > 576);
  assert.equal(calm[0][1], 576);
});

test('the atlas follows world strike direction and does not draw offscreen contacts', () => {
  const fx = new WeaponHitFx(image), event = { ...hit(), dx: 0, dy: 1 };
  fx.sync([swing('staff'), event], game);
  assert.equal(draw(fx)[0][2], 960);
  fx.sync([], game); event.x = 1000; event.age = 0;
  fx.sync([swing('staff'), event], game);
  assert.equal(draw(fx).length, 0);
});

test('an unavailable atlas keeps the original impact path available without throwing', () => {
  const fx = new WeaponHitFx({ complete: true, naturalWidth: 0 }), event = hit();
  fx.sync([swing('staff'), event], game);
  assert.equal(fx.replaces(event), false);
  assert.equal(draw(fx).length, 0);
});

function targetFixture(flip = false) {
  const cell = 16, bytes = new Uint8Array(cell * cell / 8);
  // A deliberately asymmetric body: [2,2,12,14), anchor [8,15].
  for (let y = 2; y < 14; y++) for (let x = 2; x < 12; x++) {
    const p = y * cell + x; bytes[p >> 3] |= 1 << (p & 7);
  }
  const atlas = { cell, columns: 1, rows: 1, anchor: [8,15], mask: { width:16, bytes } };
  const sprite = { atlas, frame:0, flip, mesh:{position:{x:2,y:.025,z:3},scaling:{x:1,y:1}} };
  return { atlas, views:[{id:7,kind:'hound',sprite}], event:{...hit(),id:7} };
}

test('contacts use the upper body mask on the monk-facing side instead of a fixed ground height', () => {
  const {atlas,views,event}=targetFixture();
  const g={...game,player:{x:-2,y:3,attack:null}};
  const fx=new WeaponHitFx(image,{hound:atlas});
  fx.sync([swing(null),event],g,views);
  const slot=fx.slots.find(s=>s.event===event);
  assert.ok(slot.offsetY < -7,'contact lies above the lower body');
  assert.ok(slot.offsetX > -1,'the monk is screen-right of this target');
  assert.equal(slot.height,.025,'anchor follows the rendered body, including its lift');
});

test('mask bounds are prepared once into fixed storage and mirrored poses keep body placement', () => {
  const {atlas,views,event}=targetFixture(true);
  const fx=new WeaponHitFx(image,{hound:atlas}), g={...game,player:{x:-2,y:3,attack:null}};
  fx.sync([swing(null),event],g,views);
  const cached=fx.silhouettes[0].bounds;
  const x=fx.slots.find(s=>s.event===event).offsetX;
  assert.ok(x>1,'mirrored asymmetric mask moves the contact with the body');
  fx.sync([swing(null),event],g,views);
  assert.equal(fx.silhouettes[0].bounds,cached);
});

test('staff crescent orientation follows the actual weapon-tip sweep', () => {
  const fx=new WeaponHitFx(image), event=hit();
  fx.sync([swing('staff'),event],game,null,{trail:[[20,20],[30,20]],flip:false});
  assert.equal(fx.slots.find(s=>s.event===event).row,33,'horizontal tip motion gives a vertical crescent normal');
});

test('phone effects are enlarged and finishers get an extra size boost', () => {
  const light=new WeaponHitFx(image), heavy=new WeaponHitFx(image);
  light.sync([swing('knuckles'),hit()],game);
  heavy.sync([swing('knuckles','heavy'),hit('heavy')],game);
  assert.ok(draw(light)[0][7]>=160,'light diameter is at least 1.65 times the original 96px cell');
  assert.ok(draw(heavy)[0][7]>draw(light)[0][7]);
});


test('knuckle core uses three bright keys during the first 50 ms, then changes to sparks', () => {
  const fx=new WeaponHitFx(image), event=hit();
  fx.sync([swing('knuckles'),event],game);
  for (const [age,key] of [[0,0],[.018,1],[.036,2],[.051,3]]) {
    event.age=age;
    assert.equal(draw(fx)[0][1],key*96);
  }
});

test('all 40 targets of a crowd staff finisher receive a pooled replacement', () => {
  const fx=new WeaponHitFx(image), contacts=Array.from({length:40},()=>hit('heavy'));
  fx.sync([swing('staff','heavy'),...contacts],game);
  assert.equal(draw(fx).length,40);
});

test('bare-hand dust stays at 1.15/1.4 size and below .75 effective alpha while breaking up quickly', () => {
  for (const [strength,size,life] of [['light',110,.23],['heavy',134,.29]]) {
    const fx=new WeaponHitFx(image), event=hit(strength);
    fx.sync([swing(null,strength),event],game);
    const samples=[];
    const c={globalAlpha:1,globalCompositeOperation:'source-over',imageSmoothingEnabled:false,
      drawImage(...args){samples.push({size:args[7],alpha:this.globalAlpha});}};
    for(const age of [0,.05,.15]) { event.age=age;fx.draw(c,matrix,32,200,200); }
    assert.equal(samples[0].size,size);
    assert.ok(samples.every(s=>s.alpha<=.75));
    assert.ok(samples[2].alpha<samples[0].alpha*.3,'late dust must reveal the silhouette');
    event.age=life;assert.equal(draw(fx).length,0);
  }
});
