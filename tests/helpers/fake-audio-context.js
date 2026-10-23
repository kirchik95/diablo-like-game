// A WebAudio stand-in for node tests. It records every node and automation
// call; time moves only through advance(), which also ends stopped sources.
export class FakeParam {
  constructor(value = 0) { this.value = value; this.calls = []; }
  setValueAtTime(value, time) { this.calls.push(['set', value, time]); this.value = value; }
  linearRampToValueAtTime(value, time) { this.calls.push(['linear', value, time]); }
  exponentialRampToValueAtTime(value, time) { this.calls.push(['exponential', value, time]); }
  setTargetAtTime(value, time, constant) { this.calls.push(['target', value, time, constant]); }
  cancelScheduledValues(time) { this.calls.push(['cancel', time]); }
}

export class FakeContext {
  constructor() {
    this.currentTime = 0; this.sampleRate = 8000; this.nodes = []; this.started = []; this.playing = [];
    this.destination = this.node('destination');
  }
  node(kind, params = {}) {
    const node = { kind, outputs: [], connect: target => { node.outputs.push(target); return target; },
      disconnect(target) { node.outputs = target ? node.outputs.filter(output => output !== target) : []; } };
    for (const [name, value] of Object.entries(params)) node[name] = new FakeParam(value);
    this.nodes.push(node);
    return node;
  }
  source(kind, params) {
    const node = this.node(kind, params);
    node.start = (time, offset) => { node.startedAt = time; node.offset = offset; this.started.push(node); this.playing.push(node); };
    node.stop = time => { node.stoppedAt = time; };
    return node;
  }
  // Moves the clock and fires onended for every source whose stop time passed.
  advance(seconds) {
    this.currentTime += seconds;
    this.playing = this.playing.filter(source => {
      if (source.stoppedAt == null || source.stoppedAt > this.currentTime) return true;
      source.ended = true;
      source.onended?.();
      return false;
    });
  }
  connected() { return this.nodes.filter(node => node.outputs.length > 0).length; }
  resume() { return Promise.resolve(); }
  createGain() { return this.node('gain', { gain: 1 }); }
  createDynamicsCompressor() { return this.node('compressor', { threshold: -24, knee: 30, ratio: 12, attack: .003, release: .25 }); }
  createBiquadFilter() { return this.node('filter', { frequency: 350, Q: 1 }); }
  createOscillator() {
    const node = this.source('oscillator', { frequency: 440, detune: 0 });
    node.setPeriodicWave = wave => { node.wave = wave; };
    return node;
  }
  createPeriodicWave(real, imag) { return { real, imag }; }
  createBufferSource() { return this.source('noise', { playbackRate: 1 }); }
  createBuffer(_channels, length) { const data = new Float32Array(length); return { length, getChannelData: () => data }; }
}
