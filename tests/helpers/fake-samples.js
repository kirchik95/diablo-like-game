import { SOUNDS, Samples } from '../../src/sfx.js';

// A fake decoded buffer: `seconds` long at `rate`, mono.
export const fakeBuffer = (name, variant, seconds = .3, rate = 8000) =>
  ({ name, variant, duration: seconds, length: Math.round(seconds * rate), sampleRate: rate, numberOfChannels: 1 });

// Required recorded sounds decoded at once, without a network: 0.3 s per variant.
// Optional weapon samples are supplied explicitly by their routing tests.
export class LoadedSamples extends Samples {
  constructor(context, options) {
    super(context, { ...options, fetchFile: null });
    for (const name in this.buffers) if (!SOUNDS[name].optional) {
      for (let n = 1; n <= SOUNDS[name].count; n++) this.buffers[name].push(fakeBuffer(name, n));
    }
  }
}

// Records cue() and sound() calls of a GameAudio into one list: synthesized and recorded sounds.
export function recordSounds(audio) {
  const played = [];
  for (const method of ['cue', 'sound']) {
    const play = audio[method];
    audio[method] = function(name, options = {}) { played.push({ name, method, ...options }); return play.call(this, name, options); };
  }
  return played;
}
