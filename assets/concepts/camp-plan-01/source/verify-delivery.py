"""Read-only verification of the Paper delivery and its relative provenance."""
import hashlib
import json
import subprocess
from pathlib import Path
from PIL import Image

package = Path(__file__).resolve().parent.parent
repo = package.parents[2]
read = lambda p: json.loads(p.read_text())
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
manifest = read(package / 'manifest.json')
actual = {str(p.relative_to(package)) for p in package.rglob('*')
          if p.is_file() and p != package / 'manifest.json' and p.name != '.DS_Store'}
assert actual == set(manifest['files']), 'manifest inventory differs from package'
for name, record in manifest['files'].items():
    relative = Path(name)
    assert not relative.is_absolute() and '..' not in relative.parts, name
    path = package / relative
    assert path.stat().st_size == record['bytes'], name
    assert sha(path) == record['sha256'], name
for board in manifest['boards']:
    with Image.open(package / board['export']) as image:
        image.load()
        assert list(image.size) == board['pixels'], board['id']
source = package / 'source'
provenance = read(source / 'renderer-overview-provenance.json')
for ref in provenance['references']:
    assert not Path(ref['path']).is_absolute(), ref['path']
    assert sha(repo / ref['path']) == ref['sha256'], ref['path']
assert sha(repo / provenance['original']) == sha(repo / provenance['savedCopy']) == provenance['sha256']
metrics = read(source / 'metrics.json')
projection = read(source / 'plan-projection.json')
assert sha(source / 'layout.json') == manifest['layoutSha256'] == metrics['layoutSha256'] == projection['sourceLayoutSha256']
assert provenance['layoutSha256'] == manifest['layoutSha256']
layout = read(source / 'layout.json')
current = subprocess.run(['node', '--input-type=module', '-e',
                          "import {CAMP_LAYOUT} from './src/camp-layout.js'; process.stdout.write(JSON.stringify(CAMP_LAYOUT));"],
                         cwd=repo, check=True, text=True, capture_output=True)
assert json.loads(current.stdout) == layout, 'saved layout differs from current production contract'
nav = read(source / 'navigation.json')
assert len(layout['setDressing']) == 198
assert sum('collider' in p for p in layout['setDressing']) == 190
assert len(nav['tiles']) == 1534 and len(nav['paving']) == 100
assert len(projection['keys']) == 11
contacts = read(source / 'natural-contacts.json')
assert sha(repo / contacts['atlas']) == contacts['atlasSha256']
for name, expected in read(source / 'r1-data-freeze.json')['hashes'].items():
    assert sha(repo / name) == expected, f'R1 freeze changed: {name}'
for item in read(source / 'paper-imports.json')['imports']:
    assert sha(package / item['importFile']) == sha(package / item['canonicalFile']) == item['sha256']
    assert item['paperAssetUrl'] in (package / item['jsx']).read_text(), item['nodeId']
plan = (source / 'plan-paper.jsx').read_text()
assert '57 проверок навигации и gameplay' in plan
assert '54 проверки' not in plan
styles = read(source / 'final-paper-styles.json')['styles']
for node in ['17Z-0', '180-0', '1D9-0']:
    assert styles[node]['height'] == 'fit-content'
qa = read(source / 'paper-qa.json')
assert qa['finishWorkingOnNodes']['result'] == 'OK'
old = package / 'history/pre-r1/renderer-overview.png'
assert sha(old) == '3ef08ea2d76e43e4a9463588b000fd396d1713c2456aaf4b86c006740f65b979'
assert sha(old) != provenance['sha256']
print(f"PASS: {len(manifest['files'])} package files, 2 real Paper PNG exports, byte-identical 1280x720 v2 capture, relative provenance, current layout/diagram/import agreement, R1 freeze and preserved history.")
print(f"Acceptance status: {manifest['acceptance']['status']}; this check does not grant stage acceptance.")
