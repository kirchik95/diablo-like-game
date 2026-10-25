# Normal and height data — HD-2D

Generated locally from the active albedo packages. No source artwork was changed.
Run `python3 -B scripts/build-normal-maps.py`; validate with `--verify-only`.
Python >=3.10 and Pillow >=10,<13. No network, RNG, timestamps or numpy.
`manifest.json` records source SHA256, output SHA256, dimensions, exact cell layout,
compressed download bytes and RGBA8 GPU bytes for every atlas, including all 18
monk appearances, all animations, weapon layers, NPCs, props and used surfaces.

RGB is a **linear** tangent normal: +X screen right, +Y screen up, +Z toward the
viewer. Five unit directions: flat, left, right, up, down. Nearest, no mipmaps.
A stores **height**, not transparency. Zero is outside the source silhouette.
Always use the original albedo alpha for blending, picking and emissive masks.
Do not enable automatic parallax/alpha blending from this texture. This data does
not move geometry, change UVs or displace gameplay/picking masks.

Four cell-local one-pixel erosion bands bevel the silhouette. A filtered,
quantised luminance cue adds shallow folds and stone joints. No processing crosses
a sprite cell. Surface cues wrap at tile edges. Appearance palette swaps share
the first matching hair variant's height/normal geometry after exact alpha checks.
The material must sample the same frame UVs as albedo. Mirrored sprites must also
mirror the tangent X direction (or use the UV-derived tangent handedness).

`normals.install(ctx)` publishes `ctx.renderer.hd2dNormals`:

```js
const data = renderer.hd2dNormals;
const texture = await data.load(sprite.texture); // Texture|null; high only
const ready = data.get(sprite.texture);         // ready texture, no loading
```

A source can be an active albedo URL, Texture, atlas `{texture}`, active registry
key (`monk`, `campNpcs`, `staff`), or manifest `source` path. The loader is demand
only, uploads one texture at a time, shares equal geometry by content hash and
never loads all appearances. `off`/`low` do no transport. A downgrade disposes the
cache and cancels its active Babylon request. Late results cannot reinsert.
Optional load errors resolve null and are cached until the next tier cycle.
`dispose()` releases textures and removes the renderer service.

Lights owns material binding. A material must drop its normal binding on low/off
before the next render. Polling every sprite every frame is unnecessary. `stats`
reports resident texture count/bytes, queue, in-flight, failures, completed
transfers/bytes. The module adds no passes, meshes, draw calls or frame updates.
Pure FX atlases, flames, loot glows and the mountain backdrop are marked
`relight:false` and return null. Per-pixel emission inside mixed prop/monster
atlases still belongs to the lighting shader; normal alpha is not that mask.

Limitations: these are shallow 2.5D cues, not artist-authored anatomical geometry.
Dark painted lines can read as recesses. Broad stone faces retain baked albedo
lighting; spirit glow must remain emissive in the consuming light shader. Thin
weapons/leaves are deliberately only a bevel, without smooth diagonal normals.
