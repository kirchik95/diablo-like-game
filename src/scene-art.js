import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import '@babylonjs/core/Rendering/outlineRenderer.js';

const random = n => { const v = Math.sin(n * 71.73 + 16.2) * 43758.5453; return v - Math.floor(v); };

export function ink(mesh, width = .012) {
  mesh.renderOutline = true;
  mesh.outlineColor = Color3.FromHexString('#171420');
  mesh.outlineWidth = width;
}

export function stoneTexture(scene, name, masonry = false) {
  const texture = new DynamicTexture(name, { width: 256, height: 256 }, scene, false);
  const c = texture.getContext();
  c.fillStyle = masonry ? '#d3cbd3' : '#c4c3c9'; c.fillRect(0, 0, 256, 256);
  // Broad painted planes, dry-brush flecks and irregular cut edges.
  for (let i = 0; i < 28; i++) {
    const x = random(i) * 256, y = random(i + 30) * 256;
    c.beginPath(); c.moveTo(x, y);
    c.lineTo(x + 20 + random(i + 60) * 65, y - 9);
    c.lineTo(x + 35 + random(i + 90) * 70, y + 13 + random(i + 120) * 20);
    c.lineTo(x - 8, y + 12);
    c.closePath(); c.fillStyle = i % 3 ? '#ffffff0d' : '#34293c0a'; c.fill();
  }
  for (let i = 0; i < 1400; i++) {
    c.fillStyle = i % 2 ? '#ffffff15' : '#32253712';
    c.fillRect(random(i + 171) * 256, random(i + 2000) * 256, random(i + 81) * 4 + 1, random(i + 91) * 2 + .5);
  }
  c.lineJoin = 'round';
  c.strokeStyle = '#fff3ec45'; c.lineWidth = 3;
  c.beginPath(); c.moveTo(4, 246); c.lineTo(5, 9); c.lineTo(75, 7); c.lineTo(89, 10); c.lineTo(244, 5); c.stroke();
  c.strokeStyle = '#2c233b99'; c.lineWidth = 2.8;
  c.beginPath(); c.moveTo(2, 251); c.lineTo(61, 249); c.lineTo(75, 244); c.lineTo(81, 250); c.lineTo(249, 252); c.lineTo(251, 157); c.lineTo(246, 147); c.lineTo(251, 130); c.lineTo(251, 2); c.stroke();
  const cracks = masonry ? [[0, 95, 51, 97, 66, 115, 97, 113], [193, 256, 196, 225, 212, 211]] : [[54, 0, 63, 27, 47, 41, 53, 62], [256, 162, 228, 177, 207, 173, 183, 189], [1, 234, 27, 220, 39, 224]];
  c.lineWidth = 2; c.strokeStyle = '#342638a6';
  for (const points of cracks) {
    c.beginPath(); c.moveTo(points[0], points[1]);
    for (let j = 2; j < points.length; j += 2) c.lineTo(points[j], points[j + 1]);
    c.stroke();
  }
  c.strokeStyle = '#f2e4df48'; c.lineWidth = 1;
  c.beginPath(); c.moveTo(226, 180); c.lineTo(209, 178); c.lineTo(184, 193); c.stroke();
  texture.update();
  return texture;
}

export function flameMaterial(scene, name, cyan = false) {
  const texture = new DynamicTexture(`${name}-paint`, { width: 128, height: 192 }, scene, false);
  texture.hasAlpha = true;
  const mat = new StandardMaterial(name, scene);
  mat.diffuseTexture = texture; mat.opacityTexture = texture;
  mat.emissiveColor = Color3.White(); mat.disableLighting = true;
  mat.backFaceCulling = false; mat.useAlphaFromDiffuseTexture = true;
  const c = texture.getContext();
  const update = time => {
    c.clearRect(0, 0, 128, 192);
    const sway = Math.sin(time * 7) * 9;
    const gradient = c.createLinearGradient(0, 175, 0, 14);
    gradient.addColorStop(0, cyan ? '#0d8c9c' : '#b41660');
    gradient.addColorStop(.45, cyan ? '#42ebd6' : '#ff2a82');
    gradient.addColorStop(1, cyan ? '#9dfff0' : '#ff82be');
    c.beginPath(); c.moveTo(63, 182);
    c.bezierCurveTo(17, 183, 11, 158, 32, 114);
    c.bezierCurveTo(29, 138, 49, 139, 43, 97);
    c.bezierCurveTo(31, 72, 52 + sway, 36, 68 + sway, 12);
    c.bezierCurveTo(48, 67, 99, 82, 87, 127);
    c.bezierCurveTo(97, 114, 103, 112, 100, 95);
    c.bezierCurveTo(123, 150, 112, 182, 63, 182);
    c.fillStyle = gradient; c.fill();
    c.beginPath(); c.moveTo(64, 180);
    c.bezierCurveTo(27, 173, 51, 153, 47, 129);
    c.bezierCurveTo(57, 147, 70, 130, 64 + sway * .2, 96);
    c.bezierCurveTo(94, 136, 89, 175, 64, 180);
    c.fillStyle = cyan ? '#cdfff1' : '#ffd2eb'; c.fill();
    texture.update();
  };
  update(0);
  return { material: mat, update };
}
