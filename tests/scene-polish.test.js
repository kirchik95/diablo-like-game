import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine, Scene, Texture, ArcRotateCamera, Camera, Vector3 } from '@babylonjs/core';
import { OVERWORLD } from '../src/overworld.js';
import { layoutLandscape } from '../src/landscape.js';
import { buildPixelWorld, pixelAtlases, createSprite } from '../src/pixel-scene.js';
import { propShadeCasters, bakePropShade, shrineContact, SHADE_PIXELS } from '../src/prop-shade.js';
import { sceneLights, lightAt, LightPack, LIGHT_INKS, MAX_LIGHTS, tintEmissive } from '../src/scene-light.js';
import { ZONE_GRADES, blendGrade } from '../src/zone-grade.js';
import { ScenePolish, GRAPHICS_DEFAULTS } from '../src/scene-polish.js';

const layout = layoutLandscape(OVERWORLD);
const zone = id => OVERWORLD.zones.find(z => z.id === id);
const near = (casters, x, y, d = .05) => casters.filter(c => Math.hypot(c.x - x, c.y - y) < d);

test('prop shade casters come from footprints and skip flat art and light sources', () => {
  const casters = propShadeCasters(OVERWORLD, layout);
  assert.ok(casters.length > 300, `${casters.length} casters`);
  // Flat art (tufts, carpets, flagstones, grave plots) lies on the ground and casts nothing.
  for (const p of [...layout.scenery, ...OVERWORLD.zones.flatMap(z => z.setDressing ?? [])].filter(p => p.layer === 'ground')) {
    const at = p.footprint ?? p.contact ?? p;
    assert.equal(near(casters, at.x, at.y, .01).length, 0, `${p.kind ?? p.frame} at ${at.x},${at.y}`);
  }
  // The camp fire's stones and the braziers are lit by their own pools, never shaded.
  const fire = zone('camp').setDressing.find(p => p.kind === 'campfire-base').collider;
  assert.equal(near(casters, fire.x, fire.y + fire.radius * .12).length, 0);
  for (const b of zone('courtyard').braziers) assert.equal(near(casters, b.x, b.y + .28 * .12).length, 0);
  // Every value is a circle or a box with a positive extent and a strength in (0, 1].
  for (const c of casters) {
    assert.ok(c.strength > 0 && c.strength <= 1);
    assert.ok(c.radius > 0 || (c.halfWidth > 0 && c.halfDepth > 0 && c.reach > 0), JSON.stringify(c));
  }
});

test('authored colliders cast one shade each and broad crowns add a light canopy', () => {
  const casters = propShadeCasters(OVERWORLD, layout);
  // A multi-post prop (a gate, a broken obelisk) casts one shade per collider.
  const multi = OVERWORLD.zones.flatMap(z => z.setDressing ?? []).find(p => p.colliders?.length > 1 && p.layer !== 'ground');
  for (const c of multi.colliders) assert.ok(near(casters, c.x, c.y + (c.radius ?? 0) * .12).length >= 1, JSON.stringify(c));
  // A yew in the cemetery shades its trunk fully and its crown at half strength.
  const yew = zone('cemetery').setDressing.find(p => p.kind === 'yew-round');
  const at = yew.contact ?? yew.collider;
  const canopy = near(casters, at.x, at.y + .25).find(c => c.strength === .5);
  assert.ok(canopy, 'yew canopy');
  assert.equal(canopy.radius, pixelAtlases.cemetery.footprints['yew-round'].canopy * yew.scale);
  // The road's pillars and both healing shrines stand in their own shade.
  for (const pillar of zone('road').pillars) assert.ok(near(casters, pillar.x, pillar.y, .01).length >= 1, `pillar ${pillar.x},${pillar.y}`);
  for (const shrine of OVERWORLD.zones.flatMap(z => z.shrines)) {
    const c = shrineContact(shrine);
    assert.ok(near(casters, c.x, c.y, .01).length === 1, shrine.id);
  }
});

test('the shade field is one byte per texel, row-aligned, full under a caster and clear around it', () => {
  assert.equal(bakePropShade([]), null);
  const field = bakePropShade([{ x: 2, y: 3, radius: 1, strength: 1 }, { x: 2.5, y: 3, radius: 1, strength: 1 },
    { x: 8, y: 3, halfWidth: .5, halfDepth: .5, reach: .3, strength: .5 }]);
  assert.equal(field.width % 4, 0);
  assert.equal(field.data.length, field.width * field.height);
  assert.deepEqual(field.bounds.slice(2), [field.width / SHADE_PIXELS, field.height / SHADE_PIXELS]);
  const at = (x, y) => field.data[Math.floor((y - field.bounds[1]) * SHADE_PIXELS) * field.width + Math.floor((x - field.bounds[0]) * SHADE_PIXELS)];
  // Overlapping circles deepen to full shade, never past it.
  assert.equal(at(2.25, 3), 255);
  assert.ok(at(2, 3) > 240);
  // A box is .62 deep under its footprint (times its strength) and falls off over its reach.
  assert.ok(Math.abs(at(8, 3) - Math.round((1 - .62 * .62) * .5 * 255)) <= 1, `${at(8, 3)}`);
  assert.equal(at(8.95, 3), 0);
  assert.equal(at(5.2, 3), 0);
  assert.equal(at(field.bounds[0] + .1, field.bounds[1] + .1), 0);
});

test('the overworld lights are the camp fire, the braziers, the shrines and the stone lanterns', () => {
  const lights = sceneLights(OVERWORLD);
  const fire = zone('camp').setDressing.find(p => p.kind === 'campfire-base').collider;
  assert.deepEqual(lights.filter(l => l.ink === 'amber').map(l => [l.x, l.y]), [[fire.x, fire.y]]);
  const braziers = OVERWORLD.zones.filter(z => z.id !== 'camp').flatMap(z => z.braziers);
  assert.equal(lights.filter(l => l.ink === 'cyan' || l.ink === 'pink').length, braziers.length);
  assert.deepEqual(lights.filter(l => l.ink === 'spirit').map(l => [l.x, l.y]),
    OVERWORLD.zones.flatMap(z => z.shrines).map(s => [s.x, s.y]));
  const lanterns = zone('cemetery').setDressing.filter(p => p.kind === 'stone-lantern');
  assert.deepEqual(lights.filter(l => l.ink === 'lantern').map(l => [l.x, l.y]), lanterns.map(p => [p.collider.x, p.collider.y]));
  assert.ok(lights.every(l => LIGHT_INKS[l.ink]));
  assert.deepEqual(lights.map(l => l.seed), lights.map((_, i) => i));
  // A single location without a camp fire keeps its amber braziers as lights.
  assert.deepEqual(sceneLights({ id: 'x', braziers: [{ x: 1, y: 2, color: 'amber' }], shrines: [] }),
    [{ x: 1, y: 2, ink: 'amber', seed: 0 }]);
});

test('a pool fades continuously from its source to the radius without actor tint steps', () => {
  const lights = [{ x: 0, y: 0, ink: 'amber', seed: 0 }], ink = LIGHT_INKS.amber;
  for (const [distance, share] of [[0, 1], [.25, .84375], [.5, .5], [.75, .15625], [.9, .028]]) {
    const hit = lightAt(lights, ink.radius * distance, 0);
    assert.ok(Math.abs(hit.level - ink.power * share) < 1e-12, `falloff at ${distance}`);
  }
  assert.ok(lightAt(lights, ink.radius * .999, 0).level > 0, 'no unlit band inside the radius');
  assert.equal(lightAt(lights, ink.radius, 0), null);
  assert.equal(lightAt(lights, ink.radius * 1.01, 0), null);
  // Crossing any former step boundary must not make a sprite's emissive pop.
  for (const fraction of [.2166667, .55, .8833333]) {
    const colors = [-1, 1].map(side => {
      const color = { r: 1, g: 1, b: 1, set(r, g, b) { Object.assign(this, { r, g, b }); } };
      tintEmissive(color, lightAt(lights, ink.radius * (fraction + side * .00001), 0));
      return color;
    });
    for (const channel of ['r', 'g', 'b']) assert.ok(Math.abs(colors[0][channel] - colors[1][channel]) < .00001);
  }
});

test('the packed pool uses the same continuous falloff with flickered radius and power', () => {
  for (const inkName of Object.keys(LIGHT_INKS)) {
    const ink = LIGHT_INKS[inkName], lights = [{ x: 0, y: 0, ink: inkName, seed: 0 }];
    const pack = new LightPack(lights);
    pack.update(0, 0, .375, true);
    for (const fraction of [.25, .5, .75, .99]) {
      const x = ink.radius * fraction;
      const packed = pack.at(x, 0), direct = lightAt(lights, x, 0);
      assert.ok(packed && direct, `${inkName} stays lit inside the radius`);
      assert.equal(packed.level, direct.level, inkName);
    }
    pack.update(0, 0, .375);
    assert.ok(Math.abs(pack.at(pack.pos[2] * .5, 0).level - pack.pos[3] * .5) < 1e-12, inkName);
    assert.equal(pack.at(pack.pos[2], 0), null, inkName);
    assert.equal(pack.at(pack.pos[2] * 1.01, 0), null, inkName);
  }
});

test('the light pack uploads only on a new cell or flicker step and keeps eight slots', () => {
  const lights = sceneLights(OVERWORLD), ink = LIGHT_INKS.amber;
  const fire = lights.find(l => l.ink === 'amber');
  const pack = new LightPack(lights);
  assert.equal(pack.update(fire.x, fire.y, 0, true), true);
  assert.equal(pack.update(fire.x + .1, fire.y, 5, true), false, 'still: no flicker, same cell');
  assert.ok(pack.chosen.length <= MAX_LIGHTS && pack.chosen[0] === fire);
  assert.equal(pack.pos[2], ink.radius);
  assert.equal(pack.at(fire.x, fire.y).level, ink.power);
  // Slots past the chosen lights stay off (power 0) for the shader.
  for (let i = pack.chosen.length; i < MAX_LIGHTS; i++) assert.equal(pack.pos[i * 4 + 3], 0);
  const moving = new LightPack(lights);
  moving.update(fire.x, fire.y, 0);
  assert.equal(moving.update(fire.x, fire.y, .1), false, 'the same 1/8 s step');
  assert.equal(moving.update(fire.x, fire.y, .13), true, 'a new flicker step');
  assert.ok(Math.abs(moving.pos[2] / ink.radius - 1) <= .04 + 1e-9);
  assert.ok(Math.abs(moving.pos[3] / ink.power - 1) <= .06 + 1e-9);
});

test('every zone has a subtle grade and the courtyard keeps its contrast', () => {
  for (const z of OVERWORLD.zones) {
    const g = ZONE_GRADES[z.id];
    assert.ok(g, z.id);
    assert.ok(g.saturation >= .75 && g.saturation <= 1, z.id);
    assert.ok(g.contrast >= 1 && g.contrast <= 1.1, z.id);
    assert.ok(g.vignette > 0 && g.vignette <= .06, z.id);
    assert.ok(g.gain.every(v => v >= .85 && v <= 1), z.id);
  }
  // The courtyard's pale stone and dark grass: nearly neutral, no darker than the art.
  const court = ZONE_GRADES.courtyard;
  assert.ok(court.saturation >= .93 && court.gain.every(v => v >= .95) && court.cool <= .3);
  let current = blendGrade(null, ZONE_GRADES.road, 0);
  assert.deepEqual(current, { ...ZONE_GRADES.road, gain: [...ZONE_GRADES.road.gain] });
  current = blendGrade(current, court, 0);
  assert.equal(current.saturation, ZONE_GRADES.road.saturation, 'a pause holds the grade');
  for (let i = 0; i < 300; i++) current = blendGrade(current, court, 1 / 60);
  assert.ok(Math.abs(current.saturation - court.saturation) < 1e-3 && Math.abs(current.gain[1] - court.gain[1]) < 1e-3);
});

function polishHarness(t) {
  const engine = new NullEngine({ renderWidth: 720, renderHeight: 450 }), scene = new Scene(engine);
  engine.createCanvas = (width, height) => ({ width, height, getContext: () => ({
    clearRect() {}, beginPath() {}, arc() {}, stroke() {}, moveTo() {}, lineTo() {}, closePath() {}, fillRect() {},
  }) });
  t.after(() => { scene.dispose(); engine.dispose(); });
  const camera = new ArcRotateCamera('test-camera', Math.PI / 4, Math.PI / 3, 30, Vector3.Zero(), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  const assets = Object.fromEntries(Object.entries(pixelAtlases).map(([name, atlas]) =>
    [name, { ...atlas, texture: new Texture(null, scene) }]));
  const world = buildPixelWorld(scene, assets, OVERWORLD);
  const fire = sceneLights(OVERWORLD).find(l => l.ink === 'amber');
  const game = { world: OVERWORLD, player: { x: fire.x + .5, y: fire.y }, enemies: [] };
  const monk = createSprite(scene, 'monk', assets.monk);
  monk.mesh.position.set(fire.x + .5, 0, fire.y);
  const renderer = { scene, camera, world, monk, hounds: [], presentation: { time: 0 }, reducedMotion: true };
  return { scene, world, game, renderer, ground: world.landscape.groundMaterial };
}

test('the world owns its baked shade and the switches drive the ground, the props, the actors and the grade', async t => {
  const { scene, world, game, renderer, ground } = polishHarness(t);
  assert.equal(ground.metadata.propShade, true);
  const shade = scene.textures.filter(texture => texture.name === 'prop-shade');
  assert.equal(shade.length, 1);
  const flags = [], arrays = [];
  t.mock.method(ground, 'setVector4', function(name, value) { if (name === 'artFlags') flags.push(value.asArray()); return this; });
  t.mock.method(ground, 'setArray4', function(name) { arrays.push(name); return this; });
  const polish = new ScenePolish(renderer);
  assert.deepEqual({ ...polish.options }, { ...GRAPHICS_DEFAULTS });
  polish.update(game, 1 / 60);
  assert.deepEqual(flags.at(-1), [1, 1, 0, 0]);
  assert.deepEqual(arrays, ['lightPos', 'lightTint', 'lightAdd']);
  // The monk by the fire is warm; the props in the fire's pool are baked warm once.
  const warm = renderer.monk.material.emissiveColor;
  assert.ok(warm.r > 1 && warm.b < 1, warm.toString());
  assert.ok(polish.litProps.length > 0);
  const prop = polish.litProps[0].material.emissiveColor;
  assert.ok(prop.r !== 1 || prop.g !== 1 || prop.b !== 1);
  assert.equal(polish.grade.pass?.name, 'zone-grade');
  // The pass joins the camera only once its shaders are ready: never a blank frame.
  assert.equal(polish.grade.attached, polish.grade.pass.isReady());
  for (let i = 0; i < 100 && !polish.grade.attached; i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
    polish.update(game, 1 / 60);
  }
  assert.ok(polish.grade.attached, 'attached once compiled');
  // A still frame uploads nothing again.
  polish.update(game, 1 / 60);
  assert.equal(arrays.length, 3);
  // Off: the ground loses shade and pools, the props return to their art, the grade pass goes.
  renderer.monk.material.emissiveColor.set(1, 1, 1);
  polish.set({ propShade: false, lightPools: false, zoneGrade: false });
  polish.update(game, 1 / 60);
  assert.deepEqual(flags.at(-1), [0, 0, 0, 0]);
  assert.deepEqual(polish.litProps.map(p => p.material.emissiveColor.asArray()), polish.litProps.map(() => [1, 1, 1]));
  assert.deepEqual(renderer.monk.material.emissiveColor.asArray(), [1, 1, 1]);
  assert.equal(polish.grade.pass, null);
  // Each switch is independent.
  polish.set({ lightPools: true });
  polish.update(game, 1 / 60);
  assert.deepEqual(flags.at(-1), [0, 1, 0, 0]);
  polish.dispose();
  world.dispose();
  assert.equal(scene.textures.filter(texture => texture.name === 'prop-shade').length, 0, 'the shade goes with its world');
});
