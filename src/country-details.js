import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { PIXELS_PER_UNIT } from './pixel-assets.js';

// The game uses a fixed pi/4, pi/3 isometric camera. Bake its billboard basis
// into one mesh: no per-sprite material/texture clones or per-frame updates.
export function buildCountryDetails(scene, atlas, details) {
  if (!details.length) return null;
  const vertices = new VertexData(), positions = [], indices = [], uvs = [];
  const right = [-Math.SQRT1_2, 0, Math.SQRT1_2];
  const up = [-Math.SQRT1_2 / 2, Math.sqrt(3) / 2, -Math.SQRT1_2 / 2];
  for (const p of details) {
    const frame = atlas.frames.indexOf(p.frame);
    if (frame < 0) throw new Error(`Unknown country detail: ${p.frame}`);
    const start = positions.length / 3;
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      const x = (u * atlas.cell - atlas.anchor[0]) / PIXELS_PER_UNIT;
      const y = ((v - 1) * atlas.cell + atlas.anchor[1]) / PIXELS_PER_UNIT;
      positions.push(p.x + right[0] * x + up[0] * y, p.height + .03 + up[1] * y,
        p.y + right[2] * x + up[2] * y);
      uvs.push((frame % atlas.columns + (p.flip ? 1 - u : u)) / atlas.columns,
        1 - (Math.floor(frame / atlas.columns) + 1 - v) / atlas.rows);
    }
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  Object.assign(vertices, { positions, indices, uvs });
  const mesh = new Mesh('country-details', scene);
  vertices.applyToMesh(mesh);
  const material = new StandardMaterial('country-details-ink', scene);
  material.disableLighting = true;
  material.diffuseColor = material.emissiveColor = Color3.White();
  material.specularColor = Color3.Black();
  material.diffuseTexture = atlas.texture;
  material.useAlphaFromDiffuseTexture = true;
  material.transparencyMode = Material.MATERIAL_ALPHATEST;
  material.alphaCutOff = .5;
  material.backFaceCulling = false;
  mesh.material = material;
  mesh.isPickable = false;
  mesh.renderingGroupId = 0;
  mesh.metadata = { countryDetails: true };
  mesh.freezeWorldMatrix();
  return mesh;
}
