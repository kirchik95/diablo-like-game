// The renderer's three optional picture layers, each behind its own switch:
//   propShade  — contact shade under the props (prop-shade.js, baked with the world);
//   lightPools — ground pools of the fire, braziers, shrines and lanterns (scene-light.js);
//   zoneGrade  — a per-zone colour grade with a stepped vignette (zone-grade.js).
// Static work happens once per world or per switch change; a frame only uploads the pools when
// they change and tints the actors that stand in one.
import { Vector4 } from '@babylonjs/core/Maths/math.vector.js';
import { sceneLights, lightAt, tintEmissive, LightPack } from './scene-light.js';
import { ZoneGrade } from './zone-grade.js';
import { getOverworldZone } from './overworld.js';

export const GRAPHICS_DEFAULTS = Object.freeze({ propShade: true, lightPools: true, zoneGrade: true });
// Props take a softer share of a pool's light than the actors.
const PROP_LIGHT = .55;
// Light sources keep their own art.
const SOURCE_KINDS = new Set(['campfire-base', 'brazier', 'stone-lantern']);

export class ScenePolish {
  constructor(renderer, options = {}) {
    this.renderer = renderer;
    this.options = { ...GRAPHICS_DEFAULTS };
    this.set(options);
    this.grade = new ZoneGrade(renderer.camera);
    this.world = null;
    this.flags = new Vector4(0, 0, 0, 0);
  }

  // Changes any of the switches; the next frame applies them.
  set(options = {}) {
    for (const key of Object.keys(GRAPHICS_DEFAULTS)) if (key in options) this.options[key] = !!options[key];
    this.dirty = true;
  }

  update(game, dt) {
    const renderer = this.renderer, world = renderer.world, ground = world?.landscape?.groundMaterial ?? null;
    if (world !== this.world) {
      this.world = world;
      this.lights = ground && game.world ? sceneLights(game.world) : [];
      this.pack = new LightPack(this.lights);
      this.litProps = this.findLitProps(world);
      this.dirty = true;
    }
    const pools = this.options.lightPools && this.lights.length > 0;
    if (this.dirty) {
      this.dirty = false;
      if (ground) {
        this.flags.set(Number(this.options.propShade && !!ground.metadata?.propShade), Number(pools), 0, 0);
        ground.setVector4('artFlags', this.flags);
      }
      for (const { material, base, light } of this.litProps) {
        material.emissiveColor.copyFrom(base);
        if (pools) tintEmissive(material.emissiveColor, light, PROP_LIGHT);
      }
      this.pack = new LightPack(this.lights);
    }
    if (pools) {
      const monk = renderer.monk.mesh.position;
      if (this.pack.update(monk.x, monk.z, renderer.presentation.time, renderer.reducedMotion)) {
        ground.setArray4('lightPos', this.pack.pos);
        ground.setArray4('lightTint', this.pack.tint);
        ground.setArray4('lightAdd', this.pack.add);
      }
      this.tintActors(game);
    }
    const zone = !this.options.zoneGrade || !game.world ? null
      : game.world.zones ? getOverworldZone(game.player.x, game.player.y).id : game.world.id;
    this.grade.update(zone, dt);
  }

  // Props that stand in a pool, with their own emissive to return to: [{ material, base, light }].
  findLitProps(world) {
    if (!this.lights.length) return [];
    const sources = new Set([...(world.fires ?? []).flatMap(fire => [fire.sprite, fire.base]),
      ...(world.shrines ?? []).map(shrine => shrine.sprite)]);
    const lit = [];
    for (const sprite of world.props ?? []) {
      if (!sprite?.material || sources.has(sprite) || SOURCE_KINDS.has(sprite.placement?.kind)) continue;
      const at = sprite.placement?.contact ?? { x: sprite.mesh.position.x, y: sprite.mesh.position.z };
      const light = lightAt(this.lights, at.x, at.y);
      if (light) lit.push({ material: sprite.material, base: sprite.material.emissiveColor.clone(), light });
    }
    return lit;
  }

  // The monk and the enemies take the flickering pool they stand in, over this frame's emissive
  // (render() sets it every frame, so the tint never accumulates). No allocation per actor.
  tintActors(game) {
    const renderer = this.renderer, weapons = renderer.weaponSprites;
    this.tintSprite(renderer.monk);
    for (const layer in weapons) {
      const sprite = weapons[layer];
      if (sprite.mesh.isEnabled()) sprite.material.emissiveColor.copyFrom(renderer.monk.material.emissiveColor);
    }
    for (let i = 0; i < renderer.hounds.length; i++) {
      if (game.enemies[i]?.kind !== 'ritual') this.tintSprite(renderer.hounds[i].sprite);
    }
  }

  tintSprite(sprite) {
    const at = sprite.mesh.position, light = this.pack.at(at.x, at.z);
    if (light) tintEmissive(sprite.material.emissiveColor, light);
  }

  dispose() {
    this.grade.dispose();
  }
}
