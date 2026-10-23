import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import assert from 'node:assert/strict';

// Independent alpha reader for delivered, non-interlaced 8-bit PNG fixtures.
// This deliberately does not consult the hit mask whose correctness is tested.
export function readPng(path) {
  const data = readFileSync(path), compressed = [];
  assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  let width, height, channels, type, transparency;
  for (let offset = 8; offset < data.length;) {
    const length = data.readUInt32BE(offset), name = data.toString('ascii', offset + 4, offset + 8);
    const chunk = data.subarray(offset + 8, offset + 8 + length);
    if (name === 'IHDR') {
      width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4); type = chunk[9];
      assert.equal(chunk[8], 8, 'normalized PNG bit depth');
      assert.equal(chunk[12], 0, 'normalized PNG must not be interlaced');
      channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
      assert.ok(channels, 'supported PNG color type');
    } else if (name === 'IDAT') compressed.push(chunk);
    else if (name === 'tRNS') transparency = chunk;
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(compressed)), stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  const paeth = (a, b, c) => {
    const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
    return da <= db && da <= dc ? a : db <= dc ? b : c;
  };
  assert.equal(raw.length, (stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    assert.ok(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x;
      const left = x >= channels ? pixels[i - channels] : 0;
      const up = y > 0 ? pixels[i - stride] : 0;
      const corner = x >= channels && y > 0 ? pixels[i - stride - channels] : 0;
      const prediction = [0, left, up, Math.floor((left + up) / 2), paeth(left, up, corner)][filter];
      pixels[i] = (raw[y * (stride + 1) + x + 1] + prediction) & 255;
    }
  }
  return { width, height, alpha(x, y) {
    const i = (y * width + x) * channels;
    if (type === 6 || type === 4) return pixels[i + channels - 1];
    if (type === 3) return transparency?.[pixels[i]] ?? 255;
    if (type === 0 && transparency) return pixels[i] === transparency.readUInt16BE(0) ? 0 : 255;
    if (type === 2 && transparency) return [0, 1, 2].every(c => pixels[i + c] === transparency.readUInt16BE(c * 2)) ? 0 : 255;
    return 255;
  } };
}
