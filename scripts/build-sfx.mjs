// Builds recorded effects: monster voices, barefoot steps and weapon foley (README «Звуки»).
//   node scripts/build-sfx.mjs generate <work-dir> [sound ...]   ElevenLabs Sound Effects API → <work-dir>/raw/<sound>-<n>.mp3
//   node scripts/build-sfx.mjs process <work-dir> [sound ...]    raw → <work-dir>/out/<sound>-<n>.m4a + sfx.json
// A sound is a name from SOUNDS below, such as step-grass or hound-hurt; each has `variants` files.
// generate spends about 10 credits per second of requested audio (the counter in October 2026; the docs
// say up to 40) and skips a file that exists in raw/:
// delete that file to generate it again. The key comes only from ELEVENLABS_API_KEY, into the request header.
// process needs ffmpeg with the AudioToolbox AAC encoder (macOS). Then copy out/*.m4a to assets/game/sfx/.
//
// process, per file:
// 1. Decode to 48 kHz mono float.
// 2. Start 3 ms before the onset: a creature sound's first 10 ms window within 30 dB of its loudest one, a
//    footstep's loudest window with at most 80 ms of attack before it. End where the sound has decayed,
//    at most `max` seconds later. A footstep keeps one footfall: a second onset after the first one's decay is cut off.
// 3. 2 ms fade-in, cosine fade-out over the last quarter (at most 40 ms).
// 4. Gain: the loudest 50 ms window reaches `rms` dBFS, the peak at most -1 dBFS.
// 5. AAC (AudioToolbox) in .m4a, mono, 80 kbps.
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, statSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const RATE = 48000;
const API = 'https://api.elevenlabs.io';
const MODEL = 'eleven_text_to_sound_v3';
const FORMAT = 'mp3_44100_128';
const CREDITS_PER_SECOND = 10;
const key = () => {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY is not set');
  return process.env.ELEVENLABS_API_KEY;
};

const STEP = 'Isolated one-shot, close perspective, dry, no music, no voice.';
const step = (surface, text) => ({ name: `step-${surface}`, variants: 5, seconds: .5, influence: .6, max: .38, single: true, rms: -14,
  prompt: `Single barefoot running footstep ${text} ${STEP}` });
const CREATURE = 'Dark fantasy creature, realistic, no music, no human voice, no words.';
const voice = (kind, action, variants, seconds, max, text) => ({ name: `${kind}-${action}`, variants, seconds, influence: .45, max, rms: -12,
  prompt: `${text} ${CREATURE}` });
const weapon = (family, action, seconds, max, text) => ({ name: `weapon-${family}-${action}`, variants: 3,
  seconds, max, influence: .65, single: true, rms: action === 'swing' ? -16 : -14,
  prompt: `${text} Grounded dark fantasy combat foley. Isolated one-shot, immediate onset, close perspective, dry, no reverb, no music, no voice, no background ambience, no repeated strikes.` });

// The monk runs barefoot (docs/art-direction.md). Monsters: a low, long feral hound; a floating
// wraith that shoots spirit bolts; a wide armored beetle that slams.
export const SOUNDS = [
  step('grass', 'on soft meadow grass: a soft swish of blades and a muffled thud.'),
  step('earth', 'on a packed dirt road: a dull earthy thud with a faint scuff of dust.'),
  step('stone', 'slapping on old stone flagstones: a crisp skin-on-stone slap with a very short courtyard echo.'),
  step('gravel', 'on loose gravel: a short crunch of small stones.'),
  step('leaves', 'on dry fallen leaves: a short crisp crackle and rustle of leaves.'),
  step('rug', 'on a thick woven wool rug: a very soft muffled thump.'),
  voice('hound', 'notice', 2, 1.4, 1.6, 'A large feral demonic hound notices its prey: a low menacing growl that rises into a sharp snarl.'),
  voice('hound', 'attack', 3, .9, 1.1, 'A large feral demonic hound lunges to bite: a vicious short snarl and an aggressive snap of jaws.'),
  voice('hound', 'hurt', 3, .6, .7, 'A large feral demonic hound is struck: one short pained yelp.'),
  voice('hound', 'death', 2, 1.6, 1.8, 'A large feral demonic hound dies: a choked whimper fading into a last rattling breath.'),
  voice('wraith', 'notice', 2, 1.5, 1.7, 'A ghostly floating wraith senses the living: an eerie rising breathy hiss with cold whispering air and a spectral reverb.'),
  voice('wraith', 'attack', 3, 1, 1.2, 'A ghostly floating wraith hurls a bolt of spirit energy: a sharp spectral shriek with a rushing airy whoosh.'),
  voice('wraith', 'hurt', 3, .7, .8, 'A ghostly floating wraith is struck: a short distorted glassy spectral wail.'),
  voice('wraith', 'death', 2, 2, 2.2, 'A ghostly floating wraith is destroyed: a long fading ghostly wail dissolving into cold wind and faint whispers.'),
  voice('beetle', 'notice', 2, 1.3, 1.5, 'A giant armored beetle rears up: rapid chitinous mandible clicks and a low rasping insect hiss.'),
  voice('beetle', 'attack', 3, 1, 1.2, 'A giant armored beetle rears to slam the ground: an aggressive rasping insect screech with clattering heavy chitin plates.'),
  voice('beetle', 'hurt', 3, .6, .7, 'A giant armored beetle is struck: a short shrill insect screech with a chitin click.'),
  voice('beetle', 'death', 2, 1.8, 2, 'A giant armored beetle dies: a cracking shell, a dying rasping insect screech and fading twitching clicks.'),
  weapon('bare', 'swing', .5, .22, 'One fast bare-handed punch through air, a soft robe sleeve flutter and compact breath of displaced air. No impact.'),
  weapon('bare', 'hit', .5, .18, 'One bare fist striking a padded flesh target, a close skin-and-bone slap over a compact dull knuckle thud. No grunt, no gore.'),
  weapon('knuckles', 'swing', .5, .16, 'One tight fast punch wearing solid bronze knuckle dusters, a short narrow air swish with a tiny dry metal rattle. No blade, no sword, no impact.'),
  weapon('knuckles', 'hit', .5, .20, 'One bronze knuckle duster punching a thick leather pad: a dense hard metallic thud with a 100 ms body and a short damped bronze resonance. Soft initial click. One impact, not a click-only snap. No blade, no ringing bell.'),
  weapon('staff', 'swing', .7, .34, 'One long heavy hardwood quarterstaff sweeping through air, a low broad wooden whoosh with a subtle shaft creak. No blade, no impact.'),
  weapon('staff', 'hit', .65, .30, 'One heavy ash-wood quarterstaff striking a padded solid target, a resonant hardwood thwack with a short warm hollow wooden body and a dry sharp attack. No metal, no splintering, no breaking weapon.'),
];

async function subscription() {
  const response = await fetch(`${API}/v1/user/subscription`, { headers: { 'xi-api-key': key() } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`subscription ${response.status} ${JSON.stringify(body).slice(0, 400)}`);
  return { tier: body.tier, used: body.character_count, limit: body.character_limit };
}

async function soundEffect(sound) {
  const response = await fetch(`${API}/v1/sound-generation?output_format=${FORMAT}`, {
    method: 'POST',
    headers: { 'xi-api-key': key(), 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text: sound.prompt, duration_seconds: sound.seconds, prompt_influence: sound.influence, model_id: MODEL }),
  });
  if (!response.ok) throw new Error(`sound-generation ${sound.name} ${response.status} ${(await response.text()).slice(0, 800)}`);
  return Buffer.from(await response.arrayBuffer());
}

export function validatePrompts(sounds) {
  for (const sound of sounds) {
    if (sound.prompt.length > 450) throw new Error(`${sound.name}: prompt exceeds 450 characters (${sound.prompt.length})`);
  }
}

async function generate(work, names) {
  const selected = SOUNDS.filter(s => names.includes(s.name));
  validatePrompts(selected);
  const raw = join(work, 'raw');
  mkdirSync(raw, { recursive: true });
  const log = (...args) => appendFileSync(join(work, 'generate.log'), `${new Date().toISOString()} ${args.join(' ')}\n`);
  const before = await subscription();
  console.log('subscription', JSON.stringify(before));
  let seconds = 0;
  for (const sound of selected) {
    for (let n = 1; n <= sound.variants; n++) {
      const file = join(raw, `${sound.name}-${n}.mp3`);
      if (existsSync(file)) continue;
      // A refusal (auth, quota, plan) stops the run: nothing is retried here.
      const bytes = await soundEffect(sound);
      writeFileSync(file, bytes);
      seconds += sound.seconds;
      console.log(`ok ${sound.name}-${n}: ${bytes.length} bytes`);
      log('ok', `${sound.name}-${n}`, bytes.length);
    }
  }
  // The credit counter lags by a minute or more: check it again later for the exact cost.
  const after = await subscription();
  console.log(`requested ${seconds.toFixed(1)} s ≈ ${Math.round(seconds * CREDITS_PER_SECOND)} credits; counter so far ${after.used - before.used}`);
  log('requested seconds', seconds.toFixed(1), 'counter so far', after.used - before.used);
}

function decode(file) {
  const run = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '1', '-ar', String(RATE), '-'], { maxBuffer: 1 << 28 });
  if (run.status) throw new Error(run.stderr.toString());
  return new Float32Array(run.stdout.buffer, run.stdout.byteOffset, run.stdout.length / 4).slice();
}

// RMS in dBFS of 10 ms windows.
function envelope(a) {
  const hop = RATE / 100, out = new Float64Array(Math.ceil(a.length / hop));
  for (let w = 0; w < out.length; w++) {
    let s = 0, n = 0;
    for (let i = w * hop; i < Math.min(a.length, (w + 1) * hop); i++, n++) s += a[i] * a[i];
    out[w] = 10 * Math.log10(s / Math.max(1, n) + 1e-12);
  }
  return out;
}

function shape(a, sound) {
  const env = envelope(a), hop = RATE / 100;
  const top = Math.max(...env), topAt = env.indexOf(top);
  // A creature sound starts at its first window within 30 dB of the top. A footstep's onset
  // belongs to its loudest window: walk back at most 80 ms of attack, so room noise or an
  // earlier scuff never starts the cut.
  let first = topAt;
  if (!sound.single) first = env.findIndex(e => e > top - 30);
  else while (first > 0 && topAt - first < 8 && env[first - 1] > top - 30) first--;
  let last = first, peakAt = first;
  for (let w = first; w < env.length && (w - first) * hop < sound.max * RATE; w++) {
    if (env[w] > env[peakAt]) peakAt = w;
    // One footfall: once it has decayed by 18 dB, a rise back near the top is the next step.
    if (sound.single && w > peakAt + 3 && env[w] > env[peakAt] - 8 && Math.min(...env.slice(peakAt, w)) < env[peakAt] - 18) break;
    if (env[w] > top - 45) last = w;
  }
  const start = Math.max(0, first * hop - RATE * .003), end = Math.min(a.length, (last + 1) * hop);
  const out = a.slice(start, end);
  const fadeIn = Math.round(RATE * .002), fadeOut = Math.min(Math.round(RATE * .04), Math.floor(out.length / 4));
  for (let i = 0; i < fadeIn; i++) out[i] *= i / fadeIn;
  for (let i = 0; i < fadeOut; i++) out[out.length - 1 - i] *= .5 - .5 * Math.cos(Math.PI * i / fadeOut);
  // Gain: the loudest 50 ms window to the target RMS, the peak capped at -1 dBFS.
  const win = RATE * .05;
  let loudest = 0, sum = 0, peak = 0;
  for (let i = 0; i < out.length; i++) {
    sum += out[i] * out[i];
    if (i >= win) sum -= out[i - win] * out[i - win];
    loudest = Math.max(loudest, sum / Math.min(i + 1, win));
    peak = Math.max(peak, Math.abs(out[i]));
  }
  const rmsDb = 10 * Math.log10(loudest + 1e-12), peakDb = 20 * Math.log10(peak + 1e-12);
  const gainDb = Math.min(sound.rms - rmsDb, -1 - peakDb);
  const gain = 10 ** (gainDb / 20);
  for (let i = 0; i < out.length; i++) out[i] *= gain;
  return { out, seconds: out.length / RATE, gainDb, rmsDb: rmsDb + gainDb, peakDb: peakDb + gainDb, cutAt: start / RATE };
}

async function processAll(work, names) {
  const out = join(work, 'out');
  mkdirSync(out, { recursive: true });
  const reportPath = join(out, 'sfx.json');
  const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : {};
  for (const sound of SOUNDS.filter(s => names.includes(s.name))) {
    for (let n = 1; n <= sound.variants; n++) {
      const id = `${sound.name}-${n}`, source = join(work, 'raw', `${id}.mp3`);
      if (!existsSync(source)) { console.log(`missing ${source}`); continue; }
      const shaped = shape(decode(source), sound);
      const pcm = join(out, `${id}.f32`), file = join(out, `${id}.m4a`);
      writeFileSync(pcm, Buffer.from(shaped.out.buffer, shaped.out.byteOffset, shaped.out.byteLength));
      const enc = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(RATE), '-ac', '1', '-i', pcm,
        '-c:a', 'aac_at', '-b:a', '80k', '-movflags', '+faststart', file], { encoding: 'utf8' });
      if (enc.status) throw new Error(enc.stderr);
      report[id] = { seconds: +shaped.seconds.toFixed(3), bytes: statSync(file).size, gainDb: +shaped.gainDb.toFixed(1),
        rmsDb: +shaped.rmsDb.toFixed(1), peakDb: +shaped.peakDb.toFixed(1), cutAt: +shaped.cutAt.toFixed(3) };
      console.log(id, JSON.stringify(report[id]));
    }
  }
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
}

const [command, workDir, ...picked] = process.argv.slice(2);
const names = picked.length ? picked : SOUNDS.map(s => s.name);
if (!['generate', 'process'].includes(command) || !workDir) {
  console.error('usage: node scripts/build-sfx.mjs generate|process <work-dir> [sound ...]');
  process.exit(1);
}
const work = resolve(workDir);
if (command === 'generate') await generate(work, names);
else await processAll(work, names);
