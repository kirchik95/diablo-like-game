import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { material } from './scene-world.js';
import { ink } from './scene-art.js';

function factory(scene, root, shadows) {
  const meshes = [];
  function finish(mesh, position, scale, mat, parent = root) {
    mesh.parent = parent; mesh.position.copyFromFloats(...position);
    mesh.scaling.copyFromFloats(...scale); mesh.material = mat; mesh.isPickable = false;
    mesh.receiveShadows = true; ink(mesh, .009); shadows.addShadowCaster(mesh); meshes.push(mesh); return mesh;
  }
  return {
    meshes,
    sphere: (name, pos, scale, mat, parent) => finish(MeshBuilder.CreateSphere(name, { diameter: 1, segments: 4 }, scene), pos, scale, mat, parent),
    box: (name, pos, scale, mat, parent) => finish(MeshBuilder.CreateBox(name, { size: 1 }, scene), pos, scale, mat, parent),
    cone: (name, pos, top, bottom, height, mat, parent) => finish(MeshBuilder.CreateCylinder(name, { diameterTop: top, diameterBottom: bottom, height, tessellation: 6 }, scene), pos, [1, 1, 1], mat, parent),
    joint: (name, pos, parent = root) => { const node = new TransformNode(name, scene); node.parent = parent; node.position.set(...pos); return node; },
  };
}

export function createMonk(scene, shadows) {
  const root = new TransformNode('monk', scene);
  const f = factory(scene, root, shadows);
  const cloth = material(scene, 'ivory-linen', '#e5dec4');
  const clothShade = material(scene, 'linen-folds', '#aaa797');
  const skin = material(scene, 'skin', '#ce9d7b');
  const pants = material(scene, 'ink-trousers', '#262a35');
  const sash = material(scene, 'crimson-sash', '#982f53');
  const wraps = material(scene, 'bronze-wraps', '#b08f64');
  const detail = material(scene, 'dark-details', '#29242c');
  const body = f.joint('monk-body', [0, 0, 0]);
  f.cone('linen-torso', [0, .96, 0], .49, .29, .49, cloth, body);
  const fold = f.box('wrapped-robe', [.015, .98, .165], [.41, .11, .032], clothShade, body); fold.rotation.z = -.38;
  const fold2 = f.box('overlapping-linen', [-.045, .88, .153], [.28, .14, .035], cloth, body); fold2.rotation.z = -.3;
  f.cone('waist-sash', [0, .71, 0], .32, .34, .11, sash, body);
  f.sphere('neck', [0, 1.23, 0], [.12, .14, .12], skin, body);
  f.sphere('bald-head', [0, 1.38, .01], [.205, .255, .22], skin, body);
  f.sphere('nose', [0, 1.36, .125], [.045, .06, .05], skin, body);
  for (const x of [-.058, .058]) f.box('brow', [x, 1.41, .105], [.054, .014, .023], detail, body);
  f.box('goatee', [0, 1.285, .092], [.035, .045, .03], detail, body);
  const sashTail = f.joint('sash-tail', [.15, .73, -.1], body);
  const tail1 = f.box('sash-tail-long', [0, -.22, -.035], [.12, .5, .035], sash, sashTail); tail1.rotation.x = .25;
  const tail2 = f.box('sash-tail-short', [.08, -.1, -.09], [.08, .28, .035], sash, sashTail); tail2.rotation.z = .35;
  const legs = [], arms = [];
  for (const side of [-1, 1]) {
    const leg = f.joint('leg', [side * .135, .69, 0], body);
    f.sphere('loose-trouser', [0, -.19, -.015], [.215, .47, .24], pants, leg);
    f.cone('shin-wrap', [0, -.455, 0], .115, .10, .24, wraps, leg);
    f.sphere('bare-foot', [0, -.615, .065], [.13, .095, .24], skin, leg); legs.push(leg);
    const arm = f.joint('shoulder', [side * .26, 1.12, 0], body);
    f.sphere('shoulder-muscle', [side * .015, -.05, 0], [.18, .2, .2], skin, arm);
    f.cone('upper-arm', [side * .02, -.15, .035], .16, .13, .24, skin, arm);
    const forearm = f.joint('forearm', [side * .02, -.245, .04], arm);
    forearm.rotation.x = -.6;
    f.cone('wrapped-forearm', [0, -.07, 0], .155, .12, .19, wraps, forearm);
    for (let j = 0; j < 3; j++) f.cone('wrist-band', [0, -.015 - j * .05, 0], .16, .16, .014, clothShade, forearm);
    f.sphere('fist', [0, -.2, 0], [.135, .145, .14], skin, forearm); arms.push(arm);
  }
  for (let i = 0; i < 10; i++) {
    const a = i / 9 * Math.PI;
    f.sphere('prayer-bead', [Math.cos(a) * .17, 1.16 - Math.sin(a) * .17, .17], [.034, .034, .034], wraps, body);
  }
  return { root, body, arms, legs, sashTail, meshes: f.meshes };
}

export function createHound(scene, shadows, id, mats) {
  const root = new TransformNode(`hound-${id}`, scene);
  const f = factory(scene, root, shadows);
  const body = f.joint('hound-body', [0, 0, 0]);
  f.sphere('lean-body', [0, .5, -.12], [.39, .42, .85], mats.hide, body);
  f.sphere('high-shoulders', [0, .57, .2], [.43, .52, .4], mats.hide, body);
  f.sphere('haunch', [0, .48, -.45], [.33, .34, .34], mats.hide, body);
  const neck = f.sphere('neck', [0, .64, .38], [.3, .3, .41], mats.hide, body); neck.rotation.x = -.35;
  const skull = f.sphere('wolf-skull', [0, .69, .55], [.29, .24, .43], mats.plate, body); skull.rotation.x = .18;
  const snout = f.cone('tapered-wolf-snout', [0, .625, .8], .12, .24, .35, mats.hide, body); snout.rotation.x = Math.PI / 2;
  f.box('jaw-line', [0, .56, .81], [.16, .035, .3], mats.black, body);
  for (const side of [-1, 1]) {
    f.sphere('glowing-eye', [side * .134, .735, .66], [.05, .035, .068], mats.eye, body);
    const ear = f.cone('pointed-ear', [side * .12, .9, .43], 0, .17, .35, mats.plate, body); ear.rotation.z = side * -.2;
    const horn = f.cone('curved-horn', [side * .2, .83, .35], 0, .12, .38, mats.horn, body); horn.rotation.x = -.7; horn.rotation.z = -side * .3;
    const fang = f.cone('fang', [side * .074, .54, .82], .035, 0, .09, mats.horn, body);
    fang.rotation.x = .2;
  }
  for (let i = 0; i < 5; i++) {
    const spine = f.cone('dorsal-spike', [0, .79 - i * .04, .08 - i * .14], 0, .14, .32 - i * .027, mats.plate, body); spine.rotation.x = -.6;
  }
  const legs = [];
  for (const z of [-.38, .26]) for (const side of [-1, 1]) {
    const leg = f.joint('hound-leg', [side * .19, .52, z], body);
    const upper = f.cone('upper-leg', [side * .015, -.12, -.04], .13, .075, .29, mats.hide, leg); upper.rotation.x = .25;
    const lower = f.cone('lower-leg', [side * .02, -.34, -.02], .07, .05, .21, mats.plate, leg); lower.rotation.x = -.4;
    f.sphere('clawed-paw', [side * .02, -.46, .055], [.13, .08, .2], mats.hide, leg);
    legs.push(leg);
  }
  const tail = f.joint('hound-tail', [0, .53, -.63], body);
  const tailMesh = f.cone('blade-tail', [0, .08, -.26], 0, .10, .6, mats.plate, tail); tailMesh.rotation.x = Math.PI / 2 - .3;
  return { root, body, legs, tail, meshes: f.meshes };
}

export function updateMonk(model, player, time) {
  const { root, body, arms, legs, sashTail } = model;
  root.position.set(player.x, 0, player.y);
  root.rotation.y = Math.atan2(player.dx, player.dy);
  const stride = player.distance * 8;
  const moving = player.moving && player.dashTime <= 0;
  const attack = player.attack;
  const punch = attack ? Math.sin(Math.min(1, attack.age / [.29, .32, .42][attack.index]) * Math.PI) : 0;
  body.position.y = moving ? Math.abs(Math.sin(stride)) * .047 : Math.sin(time * 2) * .012;
  body.rotation.x = player.dashTime > 0 ? .45 : moving ? .08 : 0;
  body.rotation.z = attack ? punch * (attack.index === 1 ? -.12 : .12) : 0;
  legs[0].rotation.x = moving ? Math.sin(stride) * .6 : -.12;
  legs[1].rotation.x = moving ? -Math.sin(stride) * .6 : .14;
  arms[0].rotation.x = moving ? -Math.sin(stride) * .45 : -.75;
  arms[1].rotation.x = moving ? Math.sin(stride) * .45 : -1.05;
  arms[0].rotation.z = .18; arms[1].rotation.z = -.18;
  if (attack) {
    const hand = attack.index === 1 ? 0 : 1;
    arms[hand].rotation.x = -.7 - punch * 1.15;
    arms[1 - hand].rotation.x = -.45;
    if (attack.index === 2) arms[0].rotation.x = -1.3 * punch - .5;
  }
  if (player.dashTime > 0) { arms[0].rotation.x = .7; arms[1].rotation.x = .7; }
  sashTail.rotation.x = Math.sin(time * 6) * .08 + (moving || player.dashTime > 0 ? .5 : 0);
}

export function updateHound(model, enemy, time) {
  model.root.position.set(enemy.x, 0, enemy.y);
  model.root.rotation.y = Math.atan2(enemy.dx, enemy.dy);
  if (enemy.hp <= 0) {
    model.root.scaling.scaleInPlace(.88);
    model.root.position.y = -.12;
    if (model.root.scaling.x < .03) model.root.setEnabled(false);
    return;
  }
  model.root.setEnabled(true); model.root.scaling.setAll(1);
  const crouch = enemy.state === 'windup';
  const leap = enemy.state === 'leap';
  model.body.position.y = crouch ? -.12 : leap ? Math.sin((.27 - enemy.timer) / .27 * Math.PI) * .36 : Math.sin(time * 3 + enemy.id) * .015;
  model.body.rotation.x = crouch ? -.13 : leap ? -.1 : 0;
  for (let i = 0; i < model.legs.length; i++) {
    model.legs[i].rotation.x = enemy.state === 'chase' ? Math.sin(enemy.distance * 10 + (i === 0 || i === 3 ? 0 : Math.PI)) * .7 : leap ? (i < 2 ? .6 : -.6) : crouch ? .35 : 0;
  }
  model.tail.rotation.y = Math.sin(time * 3 + enemy.id) * .16;
}
