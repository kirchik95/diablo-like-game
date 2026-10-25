// Builds the game music: six looping tracks, one per zone plus combat (README «Музыка»).
//   node scripts/build-music.mjs generate <work-dir> [track ...]   ElevenLabs Music API → <work-dir>/raw/<track>.mp3
//   node scripts/build-music.mjs loop <work-dir> [track ...]       raw → <work-dir>/out/music-<track>.m4a + loops.json
// generate spends credits (about 12.5 per second of music) and skips a track whose raw file exists:
// delete that file to generate it again. The key comes only from ELEVENLABS_API_KEY, into the request header.
// loop needs ffmpeg with the AudioToolbox AAC encoder (macOS). Then copy out/music-*.m4a to
// assets/game/music/ and the loopSeconds from loops.json into TRACKS in src/music.js.
//
// loop, per track:
// 1. Decode to 48 kHz stereo float.
// 2. Find the loop pair (s, e): the window after s sounds most like the window after e
//    (timbre bands + chroma + onset rhythm + level), with e before the track's ending.
// 3. Loop body b = a[s, e); its first X seconds are an equal-power crossfade from
//    a[e, e+X) (fading out) into a[s, s+X) (fading in). So b wraps from a[e-1] into a[e]: no seam.
// 4. Pads: 100 ms of b's tail before it and b's head after it, so decoder or resampler edges never play.
//    The total length is chosen so that AAC priming (2112) plus the file fills whole 1024-sample frames.
// 5. Linear gain to a target loudness, AAC (AudioToolbox) in .m4a, at most 1.6 MB.
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, statSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const RATE = 48000, PRIMING = 2112, FRAME = 1024, PAD = 4800;
const API = 'https://api.elevenlabs.io';
const MODEL = 'music_v2_5';
const FORMAT = 'mp3_48000_192';
const key = () => {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY is not set');
  return process.env.ELEVENLABS_API_KEY;
};

// Shared palette so crossfades between zones do not clash: D minor family,
// the same orchestra and synth colours, no lyrics.
const PALETTE = 'Dark cinematic orchestral score for a dark fantasy action RPG. Key: D minor. '
  + 'Palette: low strings (cellos, double basses), sustained dark synth pads, deep sub drones, '
  + 'distant horns, soft cinematic textures. Modern, polished, wide stereo, high production value. '
  + 'Instrumental only, no lyrics, no spoken words, no sung words. '
  + 'Loopable background music: no intro, no fade-in, no ending, no fade-out, steady texture from start to finish.';

const TRACKS = [
  { name: 'camp', ms: 105000, prompt: `${PALETTE} Mood: calm, warm, safe rest at a campfire at night after a long journey. `
    + 'Tempo around 66 BPM, gentle and slow. Warm solo cello melody over soft string pads, a quiet felt piano, '
    + 'gentle harp, faint warm synth swells, hints of F major and B-flat major brightness within D minor. Tender and hopeful, never tense.' },
  { name: 'road', ms: 105000, prompt: `${PALETTE} Mood: wandering, uneasy, tense journey along a dark country road. `
    + 'Tempo around 80 BPM. Pulsing low string ostinato, a lonely viola and low flute line, '
    + 'soft frame drum heartbeat, subtle synth arpeggio under the orchestra, growing unease without becoming a battle.' },
  { name: 'courtyard', ms: 105000, prompt: `${PALETTE} Mood: ominous ruined monastery courtyard, an occult ritual is near. `
    + 'Tempo around 66 BPM. Slow, heavy and ceremonial: deep wordless choir pads (ahh and ohh only, no words), '
    + 'tolling low church bell, organ-like synth drones, dissonant low brass swells, Phrygian colour (E-flat over D), dread and reverence.' },
  { name: 'cemetery', ms: 100000, prompt: `${PALETTE} Mood: cold, eerie, sparse cemetery at night, mist between graves. `
    + 'Tempo around 60 BPM, very sparse. Glassy high string harmonics, cold airy synth textures, distant low piano notes, '
    + 'icy music box-like plucks, long silences between phrases, quiet sub drone. Haunting and lonely, minimal percussion.' },
  { name: 'orchard', ms: 105000, prompt: `${PALETTE} Mood: melancholic, overgrown abandoned orchard, faded beauty and loss. `
    + 'Tempo around 72 BPM. Bittersweet solo violin and alto flute melody over warm low strings, soft harp and celesta, '
    + 'a gentle hazy synth pad, D minor with moments of B-flat major. Nostalgic, sad and beautiful, not scary.' },
  { name: 'combat', ms: 80000, prompt: `${PALETTE} Mood: intense battle against monsters, driving and relentless. `
    + 'Tempo 130 BPM, steady and constant. Driving taiko and cinematic war drums, staccato low string ostinato, '
    + 'aggressive low brass hits and stabs, dark distorted synth bass pulse, wordless choir accents only (no words). '
    + 'Full energy from the first second to the last, no breakdown, no build-up intro.' },
];

// Crossfade seconds and loudness target (LUFS) per track. Quiet zones sit a little lower.
const SETTINGS = {
  camp: { fade: 4, lufs: -17 }, road: { fade: 3.5, lufs: -16.5 }, courtyard: { fade: 4, lufs: -16.5 },
  cemetery: { fade: 4, lufs: -17.5 }, orchard: { fade: 4, lufs: -17 }, combat: { fade: 2, lufs: -15.5 },
};

function decode(file) {
  const run = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '2', '-ar', String(RATE), '-'],
    { maxBuffer: 1 << 30 });
  if (run.status) throw new Error(run.stderr.toString());
  const bytes = run.stdout;
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4).slice();
}

// In-place radix-2 FFT.
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

// Frame features at `hop`: 28 log bands, 12 chroma bins, log energy and spectral flux.
function features(mono, hop) {
  const N = 4096, frames = Math.floor((mono.length - N) / hop), window = new Float32Array(N);
  for (let i = 0; i < N; i++) window[i] = .5 - .5 * Math.cos(2 * Math.PI * i / N);
  const bandEdges = Array.from({ length: 29 }, (_, i) => 40 * (16000 / 40) ** (i / 28));
  const binHz = RATE / N, re = new Float64Array(N), im = new Float64Array(N);
  const bands = [], chroma = [], energy = new Float64Array(frames), flux = new Float64Array(frames);
  let previous = null;
  for (let f = 0; f < frames; f++) {
    const start = f * hop;
    for (let i = 0; i < N; i++) { re[i] = mono[start + i] * window[i]; im[i] = 0; }
    fft(re, im);
    const mag = new Float64Array(N / 2);
    let total = 0;
    for (let k = 1; k < N / 2; k++) { mag[k] = re[k] * re[k] + im[k] * im[k]; total += mag[k]; }
    energy[f] = 10 * Math.log10(total + 1e-12);
    const band = new Float64Array(28), chr = new Float64Array(12);
    for (let k = 1; k < N / 2; k++) {
      const hz = k * binHz;
      if (hz >= 40 && hz < 16000) band[Math.min(27, Math.floor(28 * Math.log(hz / 40) / Math.log(400)))] += mag[k];
      if (hz >= 70 && hz < 4200) chr[((Math.round(12 * Math.log2(hz / 440)) % 12) + 12 + 9) % 12] += mag[k];
    }
    const logBand = band.map(v => Math.log10(v + 1e-10));
    if (previous) { let s = 0; for (let b = 0; b < 28; b++) s += Math.max(0, logBand[b] - previous[b]); flux[f] = s; }
    previous = logBand;
    bands.push(logBand); chroma.push(chr);
  }
  return { frames, hop, bands, chroma, energy, flux };
}

// Normalised feature vectors: z-scored bands (timbre) and unit chroma (harmony).
function vectors(feat) {
  // Half-second moving average: compare phrases, not single transients.
  const span = Math.max(1, Math.round(.5 * RATE / feat.hop)), avg = list => list.map((_, f) => {
    const from = Math.max(0, f - (span >> 1)), to = Math.min(list.length, from + span), sum = new Float64Array(list[0].length);
    for (let g = from; g < to; g++) for (let d = 0; d < sum.length; d++) sum[d] += list[g][d] / (to - from);
    return sum;
  });
  feat = { ...feat, bands: avg(feat.bands), chroma: avg(feat.chroma) };
  const dims = 28, mean = new Float64Array(dims), sd = new Float64Array(dims);
  for (const b of feat.bands) for (let d = 0; d < dims; d++) mean[d] += b[d] / feat.frames;
  for (const b of feat.bands) for (let d = 0; d < dims; d++) sd[d] += (b[d] - mean[d]) ** 2 / feat.frames;
  for (let d = 0; d < dims; d++) sd[d] = Math.sqrt(sd[d]) || 1;
  return feat.bands.map((b, f) => {
    const t = b.map((v, d) => (v - mean[d]) / sd[d]);
    const tn = Math.hypot(...t) || 1;
    const c = feat.chroma[f], cn = Math.hypot(...c) || 1;
    return { timbre: t.map(v => v / tn), chroma: Array.from(c, v => v / cn) };
  });
}
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

function corr(x, a, b, n) {
  let ma = 0, mb = 0;
  for (let k = 0; k < n; k++) { ma += x[a + k]; mb += x[b + k]; }
  ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let k = 0; k < n; k++) { const u = x[a + k] - ma, v = x[b + k] - mb; sab += u * v; saa += u * u; sbb += v * v; }
  return sab / (Math.sqrt(saa * sbb) || 1);
}

// The end of the music: the last frame whose 3 s loudness is within 5 dB of the track's median.
function musicEnd(feat) {
  const span = Math.round(3 * RATE / feat.hop), smooth = [];
  for (let f = 0; f + span < feat.frames; f++) {
    let s = 0; for (let k = 0; k < span; k++) s += 10 ** (feat.energy[f + k] / 10);
    smooth.push(10 * Math.log10(s / span));
  }
  const median = [...smooth].sort((a, b) => a - b)[smooth.length >> 1];
  let last = smooth.length - 1;
  while (last > 0 && smooth[last] < median - 5) last--;
  return { frame: last + span, median };
}

function search(feat, vec, { fade, sRange, minLoop, lengthWeight = .5 }) {
  const buckets = {};
  const hop = feat.hop, W = Math.round(fade * RATE / hop), end = musicEnd(feat);
  const eHi = end.frame - W, eLo = Math.max(Math.round(minLoop * RATE / hop), eHi - Math.round(40 * RATE / hop));
  const sLo = Math.round(sRange[0] * RATE / hop), sHi = Math.round(sRange[1] * RATE / hop);
  let best = null;
  for (let s = sLo; s <= sHi; s++) {
    for (let e = Math.max(eLo, s + Math.round(minLoop * RATE / hop)); e <= eHi; e++) {
      let timbre = 0, harmony = 0, level = 0;
      for (let k = 0; k < W; k += 2) {
        timbre += dot(vec[s + k].timbre, vec[e + k].timbre);
        harmony += dot(vec[s + k].chroma, vec[e + k].chroma);
        level += Math.abs(feat.energy[s + k] - feat.energy[e + k]);
      }
      const n = Math.ceil(W / 2);
      timbre /= n; harmony /= n; level /= n;
      const rhythm = corr(feat.flux, s, e, W);
      // Longer loops win ties; a level mismatch costs.
      const seam = .35 * timbre + .35 * harmony + .3 * rhythm - .03 * level;
      const score = seam + lengthWeight * (e - s) / feat.frames;
      const bucket = Math.floor((e - s) * hop / RATE / 5) * 5;
      if (!buckets[bucket] || seam > buckets[bucket].seam) buckets[bucket] = { s, e, seam, timbre, harmony, rhythm, level };
      // A seam must keep the chord and the level; among those, longer loops win ties.
      if (harmony >= .75 && level <= 2.5 && (!best || score > best.score)) best = { s, e, score, seam, timbre, harmony, rhythm, level };
    }
  }
  for (const [len, b] of Object.entries(buckets)) console.log(`  loop ${len}-${+len + 5} s: seam ${b.seam.toFixed(3)} (t ${b.timbre.toFixed(2)} h ${b.harmony.toFixed(2)} r ${b.rhythm.toFixed(2)} lv ${b.level.toFixed(1)} dB) s=${(b.s * hop / RATE).toFixed(1)} e=${(b.e * hop / RATE).toFixed(1)}`);
  return { ...best, W, end };
}

// Fine alignment: shift e by ±range samples to line up the onset envelopes (1 ms resolution).
function refine(mono, sSample, eSample, fadeSamples) {
  const hop = 48, n = Math.floor(fadeSamples / hop), env = (start, count) => {
    const out = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      let s = 0;
      for (let k = 0; k < hop; k++) { const j = start + i * hop + k; const d = mono[j] - mono[j - 1]; s += d * d; }
      out[i] = Math.log10(s + 1e-9);
    }
    return out;
  };
  const a = env(sSample, n);
  let best = { shift: 0, c: -Infinity };
  for (let shift = -960; shift <= 960; shift += 48) {
    const b = env(eSample + shift, n);
    const c = corr(Float64Array.from([...a, ...b]), 0, n, n);
    if (c > best.c) best = { shift, c };
  }
  return best;
}

function loudness(file) {
  const run = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  // The summary block comes last; per-frame lines carry their own "I:" values.
  const text = run.stderr.slice(run.stderr.lastIndexOf('Summary:'));
  return { I: Number(/\bI:\s+(-?[\d.]+) LUFS/.exec(text)?.[1]), peak: Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(text)?.[1]),
    LRA: Number(/LRA:\s+(-?[\d.]+) LU/.exec(text)?.[1]) };
}

function writeRaw(file, data) {
  writeFileSync(file, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
}

async function subscription() {
  const response = await fetch(`${API}/v1/user/subscription`, { headers: { 'xi-api-key': key() } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`subscription ${response.status} ${JSON.stringify(body).slice(0, 400)}`);
  return { tier: body.tier, used: body.character_count, limit: body.character_limit, status: body.status };
}

async function compose(track) {
  const started = Date.now();
  const response = await fetch(`${API}/v1/music?output_format=${FORMAT}`, {
    method: 'POST',
    headers: { 'xi-api-key': key(), 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ prompt: track.prompt, music_length_ms: track.ms, model_id: MODEL, force_instrumental: true }),
  });
  const headers = Object.fromEntries([...response.headers].filter(([name]) => name !== 'set-cookie'));
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`compose ${track.name} ${response.status} ${text.slice(0, 800)}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return { bytes, headers, seconds: (Date.now() - started) / 1000 };
}

async function loop(work, names) {
  const out = join(work, 'out');
  mkdirSync(out, { recursive: true });
  const report = existsSync(join(out, 'loops.json')) ? JSON.parse(readFileSync(join(out, 'loops.json'), 'utf8')) : {};
  for (const name of names) {
    const { fade, lufs } = SETTINGS[name];
    const a = decode(join(work, 'raw', `${name}.mp3`)), frames = a.length / 2;
    const mono = new Float32Array(frames);
    for (let i = 0; i < frames; i++) mono[i] = (a[2 * i] + a[2 * i + 1]) / 2;
    const feat = features(mono, 2048), vec = vectors(feat);
    const minLoop = name === 'combat' ? 50 : 65;
    const found = search(feat, vec, { fade, sRange: [.3, 25], minLoop });
    const X = Math.round(fade * RATE);
    let s = found.s * feat.hop, e = found.e * feat.hop;
    const fine = refine(mono, s, e, X);
    e += fine.shift;
    const L = e - s;
    // Loop body with the crossfade baked into its head.
    const body = new Float32Array(L * 2);
    body.set(a.subarray(2 * s, 2 * e));
    for (let k = 0; k < X; k++) {
      const t = (k + .5) / X, fin = Math.sin(t * Math.PI / 2), fout = Math.cos(t * Math.PI / 2);
      for (let c = 0; c < 2; c++) body[2 * k + c] = a[2 * (s + k) + c] * fin + a[2 * (e + k) + c] * fout;
    }
    // Pads: the tail before, the head after; total + priming fills whole AAC frames.
    let post = PAD;
    while ((PRIMING + PAD + L + post) % FRAME) post++;
    const total = PAD + L + post, file = new Float32Array(total * 2);
    file.set(body.subarray(2 * (L - PAD)), 0);
    file.set(body, 2 * PAD);
    file.set(body.subarray(0, 2 * post), 2 * (PAD + L));
    const raw = join(out, `${name}.f32`);
    writeRaw(raw, file);
    // Loudness of the body alone sets the gain.
    const bodyPath = join(out, `${name}-body.wav`);
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(RATE), '-ac', '2', '-i', raw, '-ss', String(PAD / RATE), '-t', String(L / RATE), bodyPath]);
    const measured = loudness(bodyPath);
    let gainDb = lufs - measured.I;
    // Keep true peak at or under -1 dBFS.
    if (measured.peak + gainDb > -1) gainDb = -1 - measured.peak;
    const seconds = total / RATE;
    const kbps = Math.max(96, Math.min(128, Math.floor(1.55e6 * 8 / seconds / 1000)));
    const m4a = join(out, `music-${name}.m4a`);
    const enc = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(RATE), '-ac', '2', '-i', raw,
      '-af', `volume=${gainDb.toFixed(2)}dB`, '-c:a', 'aac_at', '-aac_at_mode', 'cvbr', '-b:a', `${kbps}k`,
      '-movflags', '+faststart', m4a], { encoding: 'utf8' });
    if (enc.status) throw new Error(enc.stderr);
    const size = statSync(m4a).size, final = loudness(m4a);
    report[name] = {
      loopStartSample: PAD, loopSamples: L, fileSamples: total, rate: RATE,
      loopStart: PAD / RATE, loopSeconds: L / RATE, fileSeconds: seconds,
      rawStart: s / RATE, rawEnd: e / RATE, musicEnd: found.end.frame * feat.hop / RATE, fade,
      seam: { score: +found.seam.toFixed(3), timbre: +found.timbre.toFixed(3), harmony: +found.harmony.toFixed(3),
        rhythm: +found.rhythm.toFixed(3), levelDb: +found.level.toFixed(2), shiftMs: fine.shift / 48, onsetCorr: +fine.c.toFixed(3) },
      gainDb: +gainDb.toFixed(2), kbps, bytes: size, loudness: final,
    };
    console.log(name, JSON.stringify(report[name]));
  }
  writeFileSync(join(out, 'loops.json'), JSON.stringify(report, null, 2));
}

async function generate(work, names) {
  const raw = join(work, 'raw');
  mkdirSync(raw, { recursive: true });
  const log = (...args) => appendFileSync(join(work, 'generate.log'), `${new Date().toISOString()} ${args.join(' ')}\n`);
  const before = await subscription();
  console.log('subscription', JSON.stringify(before));
  for (const track of TRACKS.filter(t => names.includes(t.name))) {
    const file = join(raw, `${track.name}.mp3`);
    if (existsSync(file)) { console.log(`skip ${track.name}: ${file} exists`); continue; }
    // A refusal (auth, quota, plan) stops the run: nothing is retried here.
    const { bytes, headers, seconds } = await compose(track);
    writeFileSync(file, bytes);
    writeFileSync(file.replace(/\.mp3$/, '.json'), JSON.stringify({ name: track.name, bytes: bytes.length, requestMs: track.ms,
      seconds, model: MODEL, format: FORMAT, songId: headers['song-id'], prompt: track.prompt }, null, 2));
    console.log(`ok ${track.name}: ${bytes.length} bytes in ${seconds.toFixed(1)} s`);
    log('ok', track.name, bytes.length, 'song-id', headers['song-id'] ?? '-');
  }
  // The credit counter lags by a minute or more: check it again later for the exact cost.
  const after = await subscription();
  console.log('subscription', JSON.stringify(after), 'spent so far', after.used - before.used);
  log('spent so far', after.used - before.used);
}

const [command, workDir, ...picked] = process.argv.slice(2);
const names = picked.length ? picked : TRACKS.map(t => t.name);
if (!['generate', 'loop'].includes(command) || !workDir) {
  console.error('usage: node scripts/build-music.mjs generate|loop <work-dir> [track ...]');
  process.exit(1);
}
const work = resolve(workDir);
if (command === 'generate') await generate(work, names);
else await loop(work, names);
