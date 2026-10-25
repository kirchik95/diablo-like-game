#!/usr/bin/env python3
"""Monk v3: pixel-grid cut-out in-betweens, all views, appearances and weapons.

Python 3.10+, Pillow >=10,<13. Offline. Never writes v2/v10/v12.
  python3 scripts/build-monk-animation-v3.py
  python3 scripts/build-monk-animation-v3.py --check

Each new pixel records a retained source pixel or a named original palette ramp.
Parts move rigidly on the pixel grid; there is no optical flow, colour blend,
resizing, blur, or cross-fade. Original scripts supply the profile leg rig and
weapon shaft rasterizer. The provenance includes all source and frame hashes.
"""
from __future__ import annotations
import argparse
import base64
import hashlib
import importlib.util
import io
import json
import math
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = Path('assets/game/pixel-v17')
BODY = OUT / 'monk-side'
FRONT = OUT / 'monk'
WEAPON = OUT / 'monk-weapons'
OLD = Path('assets/game/pixel-v10/monk-side')
OLD_WEAPON = Path('assets/game/pixel-v12/monk-weapons')
CELL, ANCHOR, COLS = 96, (48, 84), 16
COUNTS = dict(idle=8, run=8, attack1=8, attack2=8, attack3=8, dash=8, wave=8, hurt=6, death=8)
DURATIONS = dict(idle=800, run=622.222222, attack1=220, attack2=240, attack3=310, dash=200, wave=500, hurt=220, death=900)
PHASES = {name: ([0, .5, 1, 1.5, 2, 2.5, 3, 3.5] if name == 'idle' else
                 [0, .5, 1, 2, 3, 3.5, 4, 5] if name == 'run' else
                 [0, .5, 1, 1.5, 2, 3] if name == 'hurt' else
                 [0, .5, 1, 2, 2.5, 3, 4, 5]) for name in COUNTS}


def source_times(phases, duration, source_count=6, hit=None):
    if hit is None: return [duration * phase / source_count for phase in phases]
    keys = [0, hit / 2, hit, hit + (duration - hit) * .25, hit + (duration - hit) * .6, duration - 1000 / 60]
    return [keys[int(phase)] + (keys[min(int(phase) + 1, 5)] - keys[int(phase)]) * (phase % 1) for phase in phases]

FACINGS = ('front', 'back', 'side')
N4 = ((1, 0), (-1, 0), (0, 1), (0, -1))
N8 = tuple((x, y) for x in (-1, 0, 1) for y in (-1, 0, 1) if x or y)


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def read(path):
    return json.loads((ROOT / path).read_text())


def jbytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()


def png(im):
    out = io.BytesIO(); im.save(out, format='PNG', compress_level=9); return out.getvalue()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def cell(im, i, cols=10, size=(96, 96)):
    x, y = i % cols * size[0], i // cols * size[1]
    return im.crop((x, y, x + size[0], y + size[1]))


def lerp(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def angle(a, b):
    return math.atan2(b[1] - a[1], b[0] - a[0])


def turn(a, b):
    return (b - a + math.pi) % (2 * math.pi) - math.pi


def transform(p, origin, target, rotation):
    x, y = p[0] - origin[0], p[1] - origin[1]
    c, s = math.cos(rotation), math.sin(rotation)
    return round(target[0] + x * c - y * s), round(target[1] + x * s + y * c)


def near_segment(p, a, b):
    vx, vy = b[0] - a[0], b[1] - a[1]
    f = max(0, min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (vx * vx + vy * vy or 1)))
    return math.dist(p, (a[0] + vx * f, a[1] + vy * f))


class Builder:
    def __init__(self):
        self.side = module('side_v3_source', 'scripts/build-monk-side-animation.py')
        self.w = module('weapon_v3_source', 'scripts/build-monk-weapons.py')
        # New anticipation grips need 16px more margin on each side.
        self.w.SWING_CELL, self.w.SWING_ANCHOR, self.w.SWING_OFFSET = (192, 144), (96, 104), (48, 20)
        self.oldmeta = read(OLD / 'manifest.json')
        self.old = Image.open(ROOT / OLD / 'monk-side.png').convert('RGBA')
        self.reference = self.side.ramps()
        self.lookup = {c: (m, i) for m, ramp in self.reference.items() for i, c in enumerate(ramp)}
        self.oldhands = self.w.hands_of(self.old, self.lookup, {**self.w.HANDS, **self.w.side_points()})
        self.oldposes, _, _ = self.w.staff_layers(self.old, self.oldhands)
        self.frames, self.names, self.info = [], [], []
        self.headboxes = {h['index']: h['box'] for h in read('assets/game/pixel-v3/appearance/source/head-regions.json')['heads']}
        for i, key in enumerate(read(OLD / 'source/rig.json')['keys']):
            box, (dx, dy) = self.headboxes[key['upperFrame']], key['upperOffset']
            self.headboxes[100 + i] = [box[0] + dx, box[1] + dy, box[2] + dx, box[3] + dy]
        self.sourcecells = [cell(self.old, i) for i in range(110)]
        self.bodycolors = {c[:3] for im in self.sourcecells for c in self.side.flat(im) if c[3]}
        self.rigs = {i: self.rig(i) for i in range(110)}
        self.reference_measures = {i: self.measure(im, i) for i, im in enumerate(self.sourcecells)}
        self.pose_cache = {}
        self.pending = None
        self.rejected = []
        self.files, self.previews, self.metrics = {}, [], {}
        self.clipmeta = {}
        for i, name in enumerate(self.oldmeta['monk']['frames']):
            mapping = {(x, y): (i, x, y) for y in range(CELL) for x in range(CELL) if self.old.getpixel((i % 10 * CELL + x, i // 10 * CELL + y))[3]}
            self.add(name, mapping, dict(source=i, facing=self.w.facing_of(i), oldPhase=0))

    def groups(self, points):
        remaining, groups = set(points), []
        while remaining:
            seed = min(remaining); remaining.remove(seed); group, todo = {seed}, [seed]
            while todo:
                x, y = todo.pop()
                for dx, dy in N8:
                    q = (x + dx, y + dy)
                    if q in remaining: remaining.remove(q); group.add(q); todo.append(q)
            groups.append(group)
        return sorted(groups, key=lambda g: (-len(g), min(g)))

    def rig(self, index):
        image = self.sourcecells[index]
        pixels = {(x, y): image.getpixel((x, y)) for y in range(CELL) for x in range(CELL) if image.getpixel((x, y))[3]}
        cloth_colors = set(self.reference['cloth'])
        clusters = self.groups({p for p, color in pixels.items() if color[:3] in cloth_colors})
        cloth = clusters[0] if clusters else set(pixels)
        hip = (round(sum(x for x, y in cloth) / len(cloth)), max(y for x, y in cloth) + 1)
        box = self.headboxes[index]
        head = {p for p in pixels if box[0] - 1 <= p[0] <= box[2] and box[1] - 1 <= p[1] <= box[3] + 1}
        hands = set().union(*(hand['cover'] for hand in self.oldhands[index])) if self.oldhands[index] else set()
        sash = set(self.reference['sash'])
        foot_colors = set(self.reference['skin'] + self.reference['bronze'] + self.reference['beads'])
        lower = {p for p, color in pixels.items() if p[1] >= max(hip[1] - 3, 42) and p not in hands and p not in head
                 and color[:3] in foot_colors}
        if hip[1] > 65 and box[1] > 45:
            lower = {p for p in lower if p[0] < box[0] - 7}
        clusters = [g for g in self.groups(lower) if len(g) >= 3]
        # Each visible bare foot is a separate skin/bronze cluster, including a
        # raised foot that crosses the pelvis centre in a passing pose.
        clusters = sorted(clusters, key=lambda g: (-max(y for x, y in g), -len(g), min(g)))[:2]
        clusters.sort(key=lambda g: sum(x for x, y in g) / len(g))
        feet = []
        for group in clusters:
            mask = set(group)
            mask |= {q for x, y in group for dx, dy in N8 if (q := (x + dx, y + dy)) in pixels
                     and pixels[q][:3] in set(self.reference['ink'])}
            bottom = max(y for x, y in mask)
            edge = {p for p in mask if p[1] >= bottom - 1}
            point = [round(sum(x for x, y in edge) / len(edge)), bottom]
            feet.append(dict(point=point, mask=mask, visible=True))
        while len(feet) < 2:
            # A fully occluded foot has no independent visible contact. Retain an
            # explicitly marked source anchor rather than fabricating new pixels.
            lower_alpha = {p for p in pixels if p[1] >= hip[1] and p not in hands and p not in head and pixels[p][:3] not in sash}
            lower_alpha = lower_alpha or set(pixels)
            bottom = max(y for x, y in lower_alpha)
            edge = {p for p in lower_alpha if p[1] == bottom}
            point = [round(sum(x for x, y in edge) / len(edge)), bottom]
            feet.append(dict(point=point, mask=edge, visible=False))
        # The lower half (including the gap) stays byte-for-byte identical to a key.
        protected = {(x, y) for y in range(max(0, hip[1] - 1), CELL) for x in range(CELL)}
        protected |= set().union(*(foot['mask'] for foot in feet))
        shoulder = {(x, y) for y in range(max(0, min(y for x, y in cloth) - 2), min(CELL, hip[1]))
                    for x in range(max(0, min(x for x, y in cloth) - 1), min(CELL, max(x for x, y in cloth) + 2))}
        return dict(pixels=pixels, hip=hip, head=head, headBox=box, feet=feet, protected=protected, shoulder=shoulder)

    def measure(self, image, source):
        rig = self.rigs[source]
        pixels = {(x, y): image.getpixel((x, y)) for y in range(CELL) for x in range(CELL) if image.getpixel((x, y))[3]}
        bbox = image.getbbox()
        cloth = self.groups({p for p, color in pixels.items() if color[:3] in set(self.reference['cloth'])})
        hip_y = max(y for x, y in cloth[0]) + 1 if cloth else rig['hip'][1]
        box = rig['headBox']
        head = {p for p in pixels if box[0] - 2 <= p[0] < box[2] + 2 and box[1] - 2 <= p[1] < box[3] + 2}
        head_top = min(y for x, y in head) if head else bbox[1]
        feet = []
        for foot in rig['feet']:
            candidates = {q for q in foot['mask'] if q in pixels}
            bottom = max((y for x, y in candidates), default=foot['point'][1])
            edge = {q for q in candidates if q[1] >= bottom - 1}
            feet.append([round(sum(x for x, y in edge) / len(edge)), bottom] if edge else foot['point'])
        return dict(bbox=list(bbox), width=bbox[2] - bbox[0], height=bbox[3] - bbox[1], hipY=hip_y,
                    headTop=head_top, feet=feet, footVisibility=[foot['visible'] for foot in rig['feet']])

    def geometric_violations(self, actual, a, b):
        ma, mb = self.reference_measures[a], self.reference_measures[b]
        def numbers(m): return [m['width'], m['height'], m['hipY'], m['headTop'], *sum(m['feet'], []), *m['bbox']]
        labels = ['width', 'height', 'hipY', 'headTop', 'leftFootX', 'leftFootY', 'rightFootX', 'rightFootY', 'bboxLeft', 'bboxTop', 'bboxRight', 'bboxBottom']
        return [dict(measure=label, actual=value, minimum=min(lo, hi), maximum=max(lo, hi), tolerance=1)
                for label, value, lo, hi in zip(labels, numbers(actual), numbers(ma), numbers(mb))
                if not min(lo, hi) - 1 <= value <= max(lo, hi) + 1]

    def add(self, name, mapping, info):
        pending = self.pending if hasattr(self, 'pending') else None
        if pending: info = {**info, **pending}
        else: info = {**info, 'a': info['source'], 'b': info['source'], 'fraction': 0, 'isKey': True}
        self.names.append(name); self.frames.append(mapping); self.info.append(info)
        return len(self.frames) - 1

    def candidate(self, source, target, part, delta):
        rig = self.rigs[source]
        mapping = {p: (source, *p) for p in rig['pixels']}
        part = {p for p in part if p in mapping}
        if not part or any(p in rig['protected'] for p in part): return None
        dx, dy = delta
        destinations = {(x + dx, y + dy) for x, y in part}
        if any(not (1 <= x < 95 and 1 <= y < 95) or (x, y) in rig['protected'] for x, y in destinations): return None
        for p in part: mapping.pop(p)
        for x, y in sorted(part): mapping[(x + dx, y + dy)] = (source, x, y)
        # Repaint only newly exposed pixels at the cut, never a whole limb or torso.
        source_edges = {p for p in rig['pixels'] if any((p[0] + x, p[1] + y) not in rig['pixels'] for x, y in N4)}
        ink = next(p for p, c in rig['pixels'].items() if c[:3] == self.reference['ink'][0])
        for p, value in list(mapping.items()):
            if p in rig['protected']: continue
            if any((p[0] + x, p[1] + y) not in mapping for x, y in N4) and value[1:] not in source_edges:
                mapping[p] = (source, *ink)
        image = self.render_frame(mapping, self.sourcecells)
        if self.geometric_violations(self.measure(image, source), source, target): return None
        # Protected legs and shoulder cloth are exact source pixels; a new streak cannot enter them.
        for p in rig['protected']:
            if image.getpixel(p) != self.sourcecells[source].getpixel(p): return None
        for p in rig['shoulder']:
            if (rig['pixels'].get(p, (0, 0, 0, 0))[:3] in set(self.reference['cloth']) or image.getpixel(p)[:3] in set(self.reference['cloth'])) and image.getpixel(p) != self.sourcecells[source].getpixel(p): return None
        groups = self.groups(set(mapping)); source_groups = self.groups(set(rig['pixels']))
        if any(not any(group == original for original in source_groups[1:]) for group in groups[1:]): return None
        if image.tobytes() == self.sourcecells[source].tobytes(): return None
        return mapping

    def _cut_pose(self, a, b, f, profile=False, sway=0, defer_joins=False):
        source = a if f <= .5 else b
        target = b if source == a else a
        self.pending = dict(a=a, b=b, fraction=f, isKey=f == 0 or a == b)
        if f == 0 or a == b:
            return {p: (source, *p) for p in self.rigs[source]['pixels']}, source
        # Move complete registered hands/head only one grid pixel toward the other
        # key. Original legs, stance, proportions, shading and key poses survive.
        own, other = self.oldhands[source], self.oldhands[target]
        choices = []
        for hand in own:
            if not other: continue
            match = min(other, key=lambda h: math.dist(hand['centre'], h['centre']))
            vx, vy = match['centre'][0] - hand['centre'][0], match['centre'][1] - hand['centre'][1]
            deltas = [(int(math.copysign(1, vx)) if abs(vx) >= .5 else 0, int(math.copysign(1, vy)) if abs(vy) >= .5 else 0)]
            if abs(vx) >= .5: deltas.append((int(math.copysign(1, vx)), 0))
            if abs(vy) >= .5: deltas.append((0, int(math.copysign(1, vy))))
            part = hand['cover'] - {p for p in self.rigs[source]['head']}
            for delta in deltas:
                if delta != (0, 0): choices.append((part, delta))
        ba, bb = self.headboxes[source], self.headboxes[target]
        vx, vy = (bb[0] + bb[2] - ba[0] - ba[2]) / 2, (bb[1] + bb[3] - ba[1] - ba[3]) / 2
        for delta in [(0, int(math.copysign(1, vy))) if abs(vy) >= .5 else (0, 0),
                      (int(math.copysign(1, vx)), 0) if abs(vx) >= .5 else (0, 0)]:
            if delta != (0, 0): choices.append((self.rigs[source]['head'], delta))
        for part, delta in choices:
            result = self.candidate(source, target, part, delta)
            if result is not None: return result, source
        self.pending['rejected'] = True
        return {p: (source, *p) for p in self.rigs[source]['pixels']}, source

    def cut_pose(self, a, b, f, profile=False, sway=0, defer_joins=False):
        key = (a, b, round(f, 8))
        if key in self.pose_cache:
            mapping, source, pending = self.pose_cache[key]
            self.pending = dict(pending)
            return mapping, source
        mapping, source = self._cut_pose(a, b, f, profile, sway, defer_joins)
        self.pose_cache[key] = (mapping, source, dict(self.pending))
        return mapping, source

    def make_clips(self):
        for name in COUNTS:
            source_count = len(self.oldmeta['monk']['clips'][name]['front'])
            accepted = list(range(source_count))
            candidates = [phase for phase in PHASES[name] if phase != int(phase)]
            candidates += [i + .5 for i in range(source_count if name == 'idle' or name == 'run' else source_count - 1)
                           if i + .5 not in candidates]
            for phase in candidates:
                if len(accepted) >= COUNTS[name]: break
                passed = True
                for facing in FACINGS:
                    old = self.oldmeta['monk']['clips'][name].get(facing, self.oldmeta['monk']['clips'][name]['front'])
                    a = int(phase); b = (a + 1) % len(old)
                    mapping, source = self.cut_pose(old[a], old[b], phase % 1)
                    if self.pending.get('rejected'):
                        passed = False
                        self.rejected.append(dict(clip=name, phase=phase, view=facing, reason='no clean bounded part edit'))
                        break
                if passed: accepted.append(phase)
            accepted.sort()
            meta = dict(sourceKeys=accepted, sourceCount=source_count, durationMs=DURATIONS[name], timing='source-subdivide')
            if name.startswith('attack'): meta['contactKey'] = accepted.index(2)
            for facing in FACINGS:
                old = self.oldmeta['monk']['clips'][name].get(facing, self.oldmeta['monk']['clips'][name]['front'])
                indices = []
                for k, phase in enumerate(accepted):
                    a = int(phase); b = (a + 1) % len(old) if name == 'idle' else min(a + 1, len(old) - 1)
                    mapping, source = self.cut_pose(old[a], old[b], phase % 1)
                    indices.append(self.add(f'{name}-{facing}-{k + 1:02d}-v3', mapping,
                        dict(source=source, facing=facing, oldPhase=phase)))
                meta[facing] = indices
            self.clipmeta[name] = meta

    def extra_body(self, name, a, b, f, facing):
        mapping, source = self.cut_pose(a, b, f)
        if self.pending.get('rejected'):
            # An armed in-between may hold a body key while the real weapon rig
            # moves. It is not presented as an invented body pose in the metrics.
            self.pending.update(a=source, b=source, fraction=0, isKey=True)
        return self.add(name, mapping, dict(source=source, facing=facing, oldPhase=f))

    def weapon_clips(self):
        self.weaponmeta = read(OLD_WEAPON / 'manifest.json')
        self.knuckle, self.swing = {}, {}
        for strike in self.w.KNUCKLE_STRIKES:
            meta = dict(contactKey=3, sourceKeys=PHASES['attack1'], sourceCount=6, keyTimesMs=[])
            if strike['id'] != 'knuckleStrike4':
                meta.update(sourceKeys=self.clipmeta[strike['source']]['sourceKeys'], contactKey=self.clipmeta[strike['source']]['contactKey'])
            for facing in FACINGS:
                indices = []
                if strike['id'] != 'knuckleStrike4':
                    indices = self.clipmeta[strike['source']][facing]
                else:
                    keys = strike.get(facing, strike['front'])
                    for k, phase in enumerate(PHASES['attack1']):
                        a, f = int(phase), phase % 1
                        indices.append(self.extra_body(f"{strike['id']}-{facing}-{k + 1:02d}", keys[a], keys[min(a + 1, 5)], f, facing))
                meta[facing] = [dict(frame=i) for i in indices]
            hit, end = {'knuckleStrike1': (60, 150), 'knuckleStrike2': (60, 150), 'knuckleStrike3': (80, 170), 'knuckleStrike4': (130, 270)}[strike['id']]
            meta['keyTimesMs'] = source_times(meta['sourceKeys'], end, hit=hit)
            self.knuckle[strike['id']] = meta
        for attack in self.w.STAFF_ATTACKS:
            meta = dict(contactKey=3, sourceKeys=PHASES['attack1'], sourceCount=6, name=attack['name'], arc=attack['arc'])
            for facing in FACINGS:
                steps = []
                keys = attack['facings'][facing]
                for k, phase in enumerate(PHASES['attack1']):
                    a, f = int(phase), phase % 1; b = min(a + 1, 5)
                    sa, sb = keys[a], keys[b]
                    # Turning contact keys keep their authored mirror and quadrant.
                    same = sa['mirror'] == sb['mirror']
                    frame = self.extra_body(f"{attack['id']}-{facing}-{k + 1:02d}", sa['body'], sb['body'] if same else sa['body'], f if same else 0, facing)
                    nearest = sa if f <= .5 else sb
                    spec = dict(nearest); spec['body'] = frame
                    if sa['phi'] is not None and sb['phi'] is not None:
                        spec['phi'] = sa['phi'] + (sb['phi'] - sa['phi']) * f
                        spec['elev'] = sa['elev'] + (sb['elev'] - sa['elev']) * f
                    steps.append(dict(frame=frame, mirrorBody=bool(nearest['mirror']), spec=spec))
                meta[facing] = steps
            hit, end = {'staffAttack1': (130, 300), 'staffAttack2': (140, 320), 'staffAttack3': (220, 440)}[attack['id']]
            meta['keyTimesMs'] = source_times(meta['sourceKeys'], end, hit=hit)
            self.swing[attack['id']] = meta

    def render_frame(self, mapping, sources, table=None):
        im = Image.new('RGBA', (CELL, CELL)); px = im.load()
        for p, value in mapping.items():
            if isinstance(value[0], str):
                m, k = value; px[p] = (*(table or self.reference)[m][k], 255)
            else:
                i, x, y = value; px[p] = sources[i].getpixel((x, y))
        return im

    def atlas(self, frames, size=(CELL, CELL)):
        atlas = Image.new('RGBA', (COLS * size[0], math.ceil(len(frames) / COLS) * size[1]))
        for i, frame in enumerate(frames): atlas.paste(frame, (i % COLS * size[0], i // COLS * size[1]))
        return atlas

    def render_bodies(self):
        self.look = read('assets/game/pixel-v3/appearance/manifest.json')
        ramps = read('assets/game/pixel-v3/appearance/source/palette-ramps.json')
        tables = self.side.variant_tables(self.reference, self.look, ramps)
        default = '-'.join(self.look['default'][k] for k in ('skin', 'hair', 'sash'))
        for look in self.look['variants']:
            source = Image.open(ROOT / OLD / 'appearance' / (look['id'] + '.png')).convert('RGBA')
            sources = [cell(source, i) for i in range(110)]
            frames = [self.render_frame(m, sources, tables[look['id']]) for m in self.frames]
            atlas = self.atlas(frames)
            alpha = atlas.getchannel('A').tobytes()
            if not hasattr(self, 'appearance_alpha'): self.appearance_alpha = alpha
            assert self.appearance_alpha == alpha, (look['id'], 'appearance alpha drift')
            self.files[BODY / 'appearance' / (look['id'] + '.png')] = png(atlas)
            if look['id'] == default:
                self.bodyframes, self.bodyatlas = frames, atlas
        self.files[BODY / 'monk-side.png'] = png(self.bodyatlas)
        self.files[FRONT / 'monk-v3.png'] = png(self.bodyatlas)
        packed = self.side.make_mask(self.bodyatlas)
        self.files[BODY / 'hit-masks.json'] = jbytes({'monk-side.png': packed})
        self.files[FRONT / 'hit-masks.json'] = jbytes({'monk-v3.png': packed})
        self.bodymeta = dict(path='monk-side.png', cell=CELL, columns=COLS, rows=self.bodyatlas.height // CELL,
                             anchor=list(ANCHOR), frames=self.names, clips=self.clipmeta, filter='nearest', mipmaps=False,
                             animationVersion=3, runCycleDistance=3.36, legacyFrames=110)
        package = dict(schemaVersion=3, status='ready', nativePixelsPerUnit=32, monk=self.bodymeta, hitMasks='hit-masks.json',
                       authoredFacings=dict(front='SE', back='NE', side='E for idle/run; retained original action fallback'),
                       inheritedFrom=str(OLD / 'manifest.json'), appearance=dict(default=self.look['default'], variants=[
                           {**v, 'path': f"appearance/{v['id']}.png"} for v in self.look['variants']]),
                       provenance='provenance.json', frameHashes='frame-hashes.json', previews='previews/index.html')
        self.files[BODY / 'manifest.json'] = jbytes(package)
        self.files[FRONT / 'manifest.json'] = jbytes({**package, 'monk': {**self.bodymeta, 'path': 'monk-v3.png'}, 'appearance': None})

    def mapped_hands(self, index):
        info, mapping = self.info[index], self.frames[index]
        source = info['source']; result = []
        for h in self.oldhands[source]:
            matches = [(p, value[1:]) for p, value in mapping.items() if not isinstance(value[0], str) and value[0] == source and value[1:] in h['mask']]
            if len(matches) < 3: continue
            mask = {p for p, _ in matches}; skin = {p for p, q in matches if q in h['skin']}
            centre = (sum(x + .5 for x, y in mask) / len(mask), sum(y + .5 for x, y in mask) / len(mask))
            result.append(dict(centre=centre, axis=h['axis'], mask=mask, skin=skin,
                               cover=mask | {(x + dx, y + dy) for x, y in mask for dx, dy in N8}))
        return result

    def render_weapons(self):
        w = self.w
        hands = {i: self.mapped_hands(i) for i in range(len(self.frames))}
        alpha = {i: set(m) for i, m in enumerate(self.frames)}
        bands, held, poses = [], [], {}
        original_staff_pose = {i: dict(pose) for i, pose in w.STAFF_POSE.items()}
        for i in range(len(self.frames)):
            band = {}
            for h in hands[i]: band.update(w.knuckle_band(h))
            bands.append(band)
            info = self.info[i]; source = info['source']
            oldspec = original_staff_pose.get(source)
            if oldspec is not None: w.STAFF_POSE[i] = dict(oldspec)
            elif i in w.STAFF_POSE: del w.STAFF_POSE[i]
            # A hidden hand uses the original explicit held grip, never a guessed skin pixel.
            if not hands[i]:
                oldpose = self.oldposes[source]
                w.STAFF_POSE[i] = dict(grip=oldpose['grips'][0] if oldpose['grips'] else (52, 48), free=(oldpose['butt'], oldpose['tip']), depth=oldpose['depth'])
            pose = w.held_staff(i, hands[i], info['facing'])
            poses[i] = pose
            covers = [h['cover'] for h in w.gripping(hands[i], pose['grips'])]
            held.append(w.paint_staff((CELL, CELL), pose['butt'], pose['tip'], pose['depth'], alpha[i], covers))
        overlays = list(bands)
        for name, clip in self.knuckle.items():
            for facing in FACINGS:
                for k, step in enumerate(clip[facing]):
                    frame = step['frame']; layer = dict(bands[frame])
                    lead = w.striking_hand(hands[frame])
                    kind = 'heavy' if name == 'knuckleStrike4' and k == clip['contactKey'] else 'hit' if k == clip['contactKey'] else 'fade' if k == clip['contactKey'] + 1 else None
                    if kind and lead: layer.update(w.accent(kind, lead))
                    step['overlay'] = len(overlays); overlays.append(layer)
        swings = []
        old_facing = w.facing_of
        w.facing_of = lambda i: self.info[i]['facing']
        for name, clip in self.swing.items():
            for facing in FACINGS:
                previous = None
                for step in clip[facing]:
                    spec = step.pop('spec'); own = hands[step['frame']]
                    if own:
                        if spec['hand'] == 'mid' and len(own) < 2: spec['hand'] = 0
                        elif isinstance(spec['hand'], int): spec['hand'] = min(spec['hand'], len(own) - 1)
                        drawn = w.swing_key(spec, hands, alpha, poses, facing, previous)
                    else:
                        drawn = dict(layer=held[step['frame']], butt=(48, 103), tip=(108, 85), grip=[(80, 100)], depth=[1, 1], tipWorld=None)
                        drawn['layer'] = {(x + 48, y + 20): c for (x, y), c in drawn['layer'].items()}
                    previous = drawn['tipWorld'] or previous
                    step.update(staff=len(swings), grip=w.r2(drawn['grip'][0]) if drawn['grip'] else None,
                                butt=w.r2(drawn['butt']), tip=w.r2(drawn['tip']), depth=drawn['depth'])
                    swings.append(drawn['layer'])
        w.facing_of = old_facing
        def paint(layer, size):
            im = Image.new('RGBA', size)
            for p, c in layer.items():
                if 0 <= p[0] < size[0] and 0 <= p[1] < size[1]: im.putpixel(p, (*c, 255))
            return im
        self.weaponframes = dict(knuckles=[paint(m, (96, 96)) for m in overlays], staff=[paint(m, (96, 96)) for m in held],
                                 staffAttacks=[paint(m, w.SWING_CELL) for m in swings])
        self.wmeta = dict(schemaVersion=2, status='ready', nativePixelsPerUnit=32, appearanceIndependent=True,
                          monkAtlas=dict(manifest=str(BODY / 'manifest.json'), keys=len(self.frames)), palette=w.PALETTE)
        for name, frames in self.weaponframes.items():
            size = w.SWING_CELL if name == 'staffAttacks' else (96, 96)
            atlas = self.atlas(frames, size)
            path = 'staff-attacks.png' if name == 'staffAttacks' else name + '.png'
            meta = dict(path=path, cell=list(size) if name == 'staffAttacks' else 96, columns=COLS, rows=atlas.height // size[1],
                        anchor=list(w.SWING_ANCHOR if name == 'staffAttacks' else ANCHOR), filter='nearest', mipmaps=False)
            if name == 'knuckles': meta['clips'] = self.knuckle
            if name == 'staffAttacks': meta['clips'] = self.swing
            self.wmeta[name] = meta; self.files[WEAPON / path] = png(atlas)
        self.files[WEAPON / 'manifest.json'] = jbytes(self.wmeta)

    def composite(self, frame, family='bare', step=None):
        if step and family == 'staffAttacks':
            im = Image.new('RGBA', (192, 144)); body = self.bodyframes[frame]
            if step['mirrorBody']: body = body.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            im.alpha_composite(body, (48, 20)); im.alpha_composite(self.weaponframes[family][step['staff']]); return im
        im = self.bodyframes[frame].copy()
        if family != 'bare': im.alpha_composite(self.weaponframes[family][step['overlay'] if step and family == 'knuckles' else frame])
        out = Image.new('RGBA', (192, 144)); out.alpha_composite(im, (48, 20)); return out

    def preview(self, name, facing, family, new, old, duration, hit=None):
        if name in self.clipmeta:
            phases = self.clipmeta[name]['sourceKeys']
        else:
            phases = (self.knuckle if name.startswith('knuckle') else self.swing)[name]['sourceKeys']
        key_times = source_times(phases, duration, len(old), hit) + [duration]
        old_times = source_times(list(range(len(old))), duration, len(old), hit)
        def old_at(k):
            return old[max(i for i, at in enumerate(old_times) if at <= key_times[k] + 1e-6)]
        # Synchronized two rows sampled at the new frame times; old frames are held.
        sheet = Image.new('RGB', (192 * len(new), 324), '#2c2935'); d = ImageDraw.Draw(sheet)
        d.text((8, 3), f'{name} / {facing} / {family}: OLD above, NEW below; same duration {duration} ms', fill='white')
        for k, frame in enumerate(new):
            oldframe = old_at(k)
            sheet.paste(oldframe, (k * 192, 18), oldframe); sheet.paste(frame, (k * 192, 177), frame)
        path = BODY / 'previews' / f'{name}-{facing}-{family}.png'
        self.files[path] = png(sheet); self.previews.append(str(path.relative_to(BODY)))
        # PNG filmstrip + exact per-frame durations is the canonical timing evidence.
        # GIF is a convenient approximation limited to GIF's 10ms clock.
        key_times = [round(at, 6) for at in key_times]
        timed = []
        for k, frame in enumerate(new):
            canvas = Image.new('RGB', (384, 164), '#2c2935'); draw = ImageDraw.Draw(canvas)
            draw.text((5, 3), 'OLD', fill='white'); draw.text((197, 3), 'NEW', fill='white')
            oldframe = old_at(k)
            canvas.paste(oldframe, (0, 20), oldframe); canvas.paste(frame, (192, 20), frame)
            timed.append(canvas)
        stream = io.BytesIO()
        timed[0].save(stream, format='GIF', save_all=True, append_images=timed[1:], duration=[max(10, key_times[i + 1] - key_times[i]) for i in range(len(new))], loop=0, disposal=2)
        gifpath = path.with_suffix('.gif'); self.files[gifpath] = stream.getvalue()
        return dict(sheet=str(path.relative_to(BODY)), gif=str(gifpath.relative_to(BODY)), frameTimesMs=key_times[:-1], durationMs=duration, hitTimeMs=hit)

    def previews_all(self):
        oldknuckle = Image.open(ROOT / OLD_WEAPON / 'knuckles.png').convert('RGBA')
        oldstaff = Image.open(ROOT / OLD_WEAPON / 'staff.png').convert('RGBA')
        oldswing = Image.open(ROOT / OLD_WEAPON / 'staff-attacks.png').convert('RGBA')
        def old_composite(i, family='bare', step=None):
            body = cell(self.old, i)
            out = Image.new('RGBA', (192, 144))
            if family == 'staffAttacks':
                if step['mirrorBody']: body = body.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                out.alpha_composite(body, (48, 20)); out.alpha_composite(cell(oldswing, step['staff'], size=(160, 144)), (16, 0)); return out
            if family != 'bare': body.alpha_composite(cell(oldknuckle if family == 'knuckles' else oldstaff, step['overlay'] if step and family == 'knuckles' else i))
            out.alpha_composite(body, (48, 20)); return out
        evidence = {}
        for name, clip in self.clipmeta.items():
            for facing in FACINGS:
                for family in ('bare', 'knuckles', 'staff'):
                    oldclip = self.oldmeta['monk']['clips'][name].get(facing, self.oldmeta['monk']['clips'][name]['front'])
                    new = [self.composite(i, family) for i in clip[facing]]
                    old = [old_composite(i, family) for i in oldclip]
                    duration = round(3.36 / 5.4 * 1000, 6) if name == 'run' else DURATIONS[name]
                    hit = {'attack1': 90, 'attack2': 110, 'attack3': 160}.get(name)
                    evidence[f'{name}/{facing}/{family}'] = self.preview(name, facing, family, new, old, duration, hit)
        for family, clips in (('knuckles', self.knuckle), ('staffAttacks', self.swing)):
            for name, clip in clips.items():
                for facing in FACINGS:
                    oldclip = self.weaponmeta[family]['clips'][name]
                    oldsteps = oldclip.get(facing, oldclip['front'])
                    new = [self.composite(s['frame'], family, s) for s in clip[facing]]
                    old = [old_composite(s['frame'], family, s) for s in oldsteps]
                    # Weapon series timings are read from the original manifest's clocks.
                    duration = ({'knuckleStrike1': 150, 'knuckleStrike2': 150, 'knuckleStrike3': 170, 'knuckleStrike4': 270,
                                 'staffAttack1': 300, 'staffAttack2': 320, 'staffAttack3': 440})[name]
                    hit = {'knuckleStrike1': 60, 'knuckleStrike2': 60, 'knuckleStrike3': 80, 'knuckleStrike4': 130,
                           'staffAttack1': 130, 'staffAttack2': 140, 'staffAttack3': 220}[name]
                    evidence[f'{name}/{facing}/{family}'] = self.preview(name, facing, family, new, old, duration, hit)
        self.files[BODY / 'previews/timing.json'] = jbytes(evidence)
        rows = ''.join(f'<h2>{key}</h2><img src="{v["gif"][9:]}"/><details><summary>Frame sheet</summary><img src="{v["sheet"][9:]}"/></details>' for key, v in evidence.items())
        self.files[BODY / 'previews/index.html'] = ('<!doctype html><meta charset="utf-8"><title>Monk v3 / old versus new</title><style>body{background:#201e28;color:#eee;font:14px system-ui}img{image-rendering:pixelated;max-width:100%}h2{margin-top:2em}</style><h1>Monk v3: old / new</h1><p>Same gameplay durations. All original key poses and leg pixels are retained. In-between geometry is bounded by neighbouring keys. PNG sheets plus timing.json are exact; GIF timing rounds to 10ms.</p>' + rows).encode()

    def review_crops(self):
        for name in ('run', 'idle', 'attack1', 'attack2', 'attack3', 'dash'):
            for facing in FACINGS:
                old = self.oldmeta['monk']['clips'][name].get(facing, self.oldmeta['monk']['clips'][name]['front'])
                new = self.clipmeta[name][facing]
                out = Image.new('RGBA', (96 * max(len(old), len(new)), 218), (43, 40, 51, 255))
                draw = ImageDraw.Draw(out)
                for k, index in enumerate(old):
                    out.alpha_composite(self.sourcecells[index], (k * 96, 12))
                    draw.text((k * 96 + 3, 0), str(k), fill='white')
                for k, index in enumerate(new):
                    out.alpha_composite(self.bodyframes[index], (k * 96, 122))
                    phase = self.clipmeta[name]['sourceKeys'][k]
                    draw.text((k * 96 + 3, 110), str(phase) + (' KEY' if phase == int(phase) else ' BETWEEN'), fill='white')
                out = out.resize((out.width * 3, out.height * 3), Image.Resampling.NEAREST)
                self.files[BODY / 'previews/review-2' / f'{name}-{facing}.png'] = png(out)

    def check_metrics(self):
        package = read(BODY / 'manifest.json')['monk']
        delivered = Image.open(ROOT / BODY / package['path']).convert('RGBA')
        metrics = read(BODY / 'metrics-2.json')
        errors = []
        for row in metrics['frames']:
            image = cell(delivered, row['index'], package['columns'])
            actual = self.measure(image, row['source'])
            if actual != row['measured']: errors.append((row['index'], 'recorded measurements differ from PNG', actual))
            if row['kind'] == 'in-between':
                errors += [(row['index'], bad) for bad in self.geometric_violations(actual, *row['neighbours'])]
            source = self.sourcecells[row['source']]
            if any(image.getpixel(p) != source.getpixel(p) for p in self.rigs[row['source']]['protected']):
                errors.append((row['index'], 'leg pixels or their background gap changed'))
            colors = {color[:3] for color in self.side.flat(image) if color[3]}
            if not colors <= self.bodycolors: errors.append((row['index'], 'new colour'))
            if not set(self.side.flat(image.getchannel('A'))) <= {0, 255}: errors.append((row['index'], 'non-binary alpha'))
            groups = self.groups({(x, y) for y in range(CELL) for x in range(CELL) if image.getpixel((x, y))[3]})
            original = self.groups(set(self.rigs[row['source']]['pixels']))
            if any(not any(group == old for old in original[1:]) for group in groups[1:]): errors.append((row['index'], 'new orphan component'))
            if row['kind'] == 'key' and image.tobytes() != source.tobytes(): errors.append((row['index'], 'original key changed'))
        if errors: raise ValueError(errors[:10])
        print(f"METRICS OK: {len(metrics['frames'])} actual PNG frames; 1px envelope; original leg pixels and gaps")

    def validate(self):
        assert self.bodyatlas.width <= 4096 and self.bodyatlas.height <= 4096
        assert set(self.side.flat(self.bodyatlas.getchannel('A'))) <= {0, 255}
        colors = {c[:3] for c in self.side.flat(self.bodyatlas) if c[3]}
        assert colors <= self.bodycolors and len(colors) <= 34, colors - self.bodycolors
        rows, violations = [], []
        for index, (image, info) in enumerate(zip(self.bodyframes, self.info)):
            source, a, b = info['source'], info['a'], info['b']
            measured = self.measure(image, source)
            bad = [] if info['isKey'] else self.geometric_violations(measured, a, b)
            protected = self.rigs[source]['protected']
            leg_pixels = b''.join(bytes(image.getpixel(p)) for p in sorted(protected))
            source_leg_pixels = b''.join(bytes(self.sourcecells[source].getpixel(p)) for p in sorted(protected))
            if leg_pixels != source_leg_pixels: bad.append(dict(measure='legPixels', actual='changed'))
            row = dict(index=index, name=self.names[index], source=source, neighbours=[a, b], fraction=info['fraction'],
                       kind='key' if info['isKey'] else 'in-between', measured=measured,
                       neighbourMeasures=[self.reference_measures[a], self.reference_measures[b]],
                       legsPreserved=leg_pixels == source_leg_pixels, legPixelHash=sha(leg_pixels), violations=bad)
            rows.append(row)
            violations += [dict(frame=index, **v) for v in bad]
        assert not violations, violations[:5]
        for name, clip in self.clipmeta.items():
            for facing in FACINGS:
                hashes = [sha(self.bodyframes[i].tobytes()) for i in clip[facing]]
                assert len(set(hashes)) == len(hashes), (name, facing, 'duplicate in-between')
        metrics = dict(schemaVersion=2, tolerancePixels=1, paletteColors=len(colors),
                       definitions=dict(hipY='main shirt hem plus one pixel: consistent waist line',
                                        feet='left-to-right visible bare-foot cluster sole; occluded source anchors marked separately',
                                        headTop='opaque top in the authored head registration box',
                                        legPixelHash='RGBA of the full unchanged lower-body rectangle including its background gap'),
                       method='actual RGBA bbox and cloth/registered-head/foot measurements; unchanged lower-body pixel proof',
                       frames=rows, violations=violations, reducedPhases=self.rejected,
                       clipCounts={name: len(clip['front']) for name, clip in self.clipmeta.items()})
        self.files[BODY / 'metrics-2.json'] = jbytes(metrics)
        self.files[BODY / 'source/rig.json'] = jbytes(self.info)
        self.files[BODY / 'frame-hashes.json'] = jbytes({name: sha(im.tobytes()) for name, im in zip(self.names, self.bodyframes)})
        self.files[WEAPON / 'frame-hashes.json'] = jbytes({name: [sha(im.tobytes()) for im in frames] for name, frames in self.weaponframes.items()})
        self.files[BODY / 'qa-report.json'] = jbytes(dict(frames=len(self.frames), paletteColors=len(colors),
                    violations=0, allLegPixelsPreserved=True, clipCounts=metrics['clipCounts']))

    def build(self, previews=True):
        print('Posing body clips...', flush=True); self.make_clips()
        print('Posing weapon clips...', flush=True); self.weapon_clips()
        print('Rendering appearances...', flush=True); self.render_bodies()
        print('Rendering weapons...', flush=True); self.render_weapons()
        if previews:
            print('Rendering comparison sheets and GIFs...', flush=True); self.previews_all(); self.review_crops()
        print('Validating frame/track hashes...', flush=True); self.validate()
        inputs = [OLD / 'monk-side.png', OLD / 'manifest.json', OLD / 'source/rig.json', OLD_WEAPON / 'manifest.json',
                  Path('scripts/build-monk-animation-v3.py'), Path('scripts/build-monk-side-animation.py'), Path('scripts/build-monk-weapons.py'),
                  Path('assets/game/pixel-v2/monk/palette.json'), Path('assets/game/pixel-v3/appearance/manifest.json'),
                  Path('assets/game/pixel-v3/appearance/source/palette-ramps.json'),
                  Path('assets/game/pixel-v3/appearance/source/head-regions.json'),
                  *(OLD / 'appearance' / (v['id'] + '.png') for v in self.look['variants']),
                  *(OLD_WEAPON / name for name in ('knuckles.png', 'staff.png', 'staff-attacks.png'))]
        provenance = dict(method='bounded one-pixel part posing; exact original keys and leg pixels; no morph, resizing, cross-fade or new colours',
                          rights='Derived from retained project art. Original v2/v3/v10/v12 provenance and restrictions apply. No new licence grant.',
                          inputs={str(p): sha((ROOT / p).read_bytes()) for p in inputs},
                          outputs={str(p): sha(data) for p, data in sorted(self.files.items())})
        self.files[BODY / 'provenance.json'] = jbytes(provenance)
        self.files[FRONT / 'provenance.json'] = jbytes(provenance)
        self.files[WEAPON / 'provenance.json'] = jbytes(provenance)
        return self.files


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--check', action='store_true'); parser.add_argument('--metrics-only', action='store_true'); args = parser.parse_args()
    if args.metrics_only:
        if not args.check: parser.error('--metrics-only requires --check')
        Builder().check_metrics(); return
    files = Builder().build()
    if args.check:
        errors = [str(p) for p, data in files.items() if not (ROOT / p).exists() or (ROOT / p).read_bytes() != data]
        if errors: raise SystemExit('MISMATCH: ' + ', '.join(errors))
        print(f'CHECK OK: {len(files)} files; body and weapon frame hashes identical; old assets untouched')
    else:
        for path, data in files.items():
            dest = ROOT / path; dest.parent.mkdir(parents=True, exist_ok=True); dest.write_bytes(data)
        print(f'BUILT: {len(files)} files in {OUT}; measured key envelopes; 18 appearances')


if __name__ == '__main__': main()
