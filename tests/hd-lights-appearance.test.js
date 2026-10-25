import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import { SpriteAppearance, createSprite } from '../src/pixel-scene.js';
import * as lights from '../src/hd2d/lights.js';
// Appearance loading replaces the diffuse atlas; high must keep the matching normal atlas.
test('appearance selection retains the atlas normal binding', async () => {
  const engine=new NullEngine(),scene=new Scene(engine);
  const texture=()=>RawTexture.CreateRGBATexture(new Uint8Array([128,128,255,255]),1,1,scene,false,false);
  const atlas={texture:texture(),normalTexture:texture(),cell:1,columns:1,rows:1,anchor:[.5,1]};
  const sprite=createSprite(scene,'monk',atlas);
  const renderer={world:{data:{}},camera:{target:new Vector3()}};
  const effect=lights.install({scene,engine,camera:renderer.camera,renderer,tier:'high'});
  const plugin=sprite.material.pluginManager.getPlugin('HdPointLighting');
  assert.equal(plugin.normalTexture(),atlas.normalTexture);
  const appearance=new SpriteAppearance(sprite,async()=>texture());
  await appearance.select('test-appearance.png');
  assert.equal(plugin.normalTexture(),atlas.normalTexture);
  appearance.dispose();effect.dispose();scene.dispose();engine.dispose();
});


// The normal service is lazy; enabling lights alone must not fetch normals at low/off.
test('high consumes the host normal service lazily and survives its tier reset', async () => {
  const engine=new NullEngine(),scene=new Scene(engine);
  const texture=()=>RawTexture.CreateRGBATexture(new Uint8Array([128,128,255,255]),1,1,scene,false,false);
  const atlas={texture:texture(),cell:1,columns:1,rows:1,anchor:[.5,1]};
  const sprite=createSprite(scene,'monk',atlas),first=texture(),second=texture();
  let downloads=0;
  const service={tier:'high',load(source){assert.equal(source._texture,sprite.texture._texture);downloads++;return Promise.resolve(downloads===1?first:second);}};
  const renderer={hd2dNormals:service,world:{data:{}},camera:{target:new Vector3()}};
  const fx=lights.install({scene,engine,camera:renderer.camera,renderer,tier:'low'});
  fx.update(0,0);assert.equal(downloads,0);
  fx.setTier('high');fx.update(0,0);await Promise.resolve();
  const plugin=sprite.material.pluginManager.getPlugin('HdPointLighting');
  assert.ok(plugin.normalTexture()===first);assert.equal(downloads,1);
  fx.update(0,1);fx.update(0,2);assert.equal(downloads,1);
  service.tier='off';fx.update(0,3);
  service.tier='high';fx.update(0,4);await Promise.resolve();
  assert.ok(plugin.normalTexture()===second);assert.equal(downloads,2);
  fx.dispose();scene.dispose();engine.dispose();
});
