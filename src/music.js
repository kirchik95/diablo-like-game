// Background music: six recorded loops, one per zone plus combat (README «Музыка»).
// The game only moves track levels.
//
//   camp ──────┐
//   road ──────┤
//   courtyard ─┤  source (looping buffer) ─► track gain
//   cemetery ──┼──────────────────────────────────────► music bus (level, pause duck, keep-alive) ─► SFX bus ─► limiter ─► master
//   orchard ───┤
//   combat ────┘  rises over the zone track, which ducks
//
// Memory: each file is a ~1.5 MB AAC download, kept as bytes once fetched. Only the zone
// track, combat and a track still fading out are decoded to an AudioBuffer, at most two zone
// tracks at a time; a phone decodes at 32 kHz. A buffer source loops between loopStart and loopEnd sample-accurately, so the seam
// is gapless. Streaming <audio> elements were not used: their loop leaves a gap, and iOS lets
// each element start only inside a user gesture, while zones change long after the unlock.
//
// Loading starts on the first frame after the unlock, never in the boot preloader: the zone
// track first, then combat, then the other zones, one file at a time. A track that is not
// decoded yet, or whose file failed, stays silent.
export const MUSIC = {
  // The bus sits ~12 dB under the hits. Paused, it ducks to 35 %.
  level: .22, pauseDuck: .35,
  // Combat: packs awake within 11 u start it and duck the zone track to 30 %;
  // it holds 3 s after the last sign of a fight.
  combatRange: 11, combatHold: 3, combatLevel: .85, areaInCombat: .3,
  // Seconds: zone is the equal-power crossfade, combatIn/combatOut the combat track's fades,
  // level the time constant of a level change (duck, defeat), duck the bus's pause duck,
  // smooth the time constant that turns per-frame gains into a smooth curve.
  fade: { zone: 2.5, combatIn: 1.2, combatOut: 3, level: .6, duck: .25, smooth: .04 },
  // Without a pump for this long (hidden tab, stopped loop) the music fades out.
  keepAlive: .8,
  // A phone decodes at 32 kHz: 256 KB per second of stereo float instead of 384 KB at 48 kHz.
  phoneRate: 32000,
  // A stopped zone track keeps its decoded buffer this long, in case the monk walks back,
  // but never more than zoneBuffers zone tracks stay decoded (combat comes on top). A zone track
  // that needs a buffer while both are taken frees an idle one, or cuts the quietest fading
  // track short with a 0.16 s fade.
  keepDecoded: { phone: 5, desktop: 30 }, zoneBuffers: 2,
};

// Loop points from the offline loop tool: the body starts after a 0.1 s pad and the file
// repeats the body's head after it, so a decoder that keeps the AAC priming still loops cleanly.
const track = (name, loopSeconds) => ({
  url: new URL(`../assets/game/music/music-${name}.m4a`, import.meta.url).href,
  loopStart: .1, loopSeconds,
});
export const TRACKS = {
  camp: track('camp', 72.729667),
  road: track('road', 96),
  courtyard: track('courtyard', 87.775333),
  cemetery: track('cemetery', 90.499),
  orchard: track('orchard', 85.005),
  combat: track('combat', 66.459667),
};
export const TRACK_NAMES = Object.keys(TRACKS);
// Each zone plays its own track; a place without one (the listening page's «Стоп») plays none.
export const ZONE_TRACKS = { camp: 'camp', road: 'road', courtyard: 'courtyard', cemetery: 'cemetery', orchard: 'orchard' };
export const zoneTrack = zone => ZONE_TRACKS[zone] ?? null;
// Gain of a track at presence p (0…1). Two tracks crossing with p and 1 − p keep constant power.
export const equalPower = p => Math.sin(Math.max(0, Math.min(1, p)) * Math.PI / 2);

const COMBAT_EVENTS = new Set(['impact', 'block', 'hurt', 'shot', 'slam', 'leap']);
// The zone buffer that gives way first: an idle track before a sounding one, then the longest
// stopped, or the quietest one still fading out.
const givesWay = (a, b) => !a.source !== !b.source ? !a.source : a.source ? a.p < b.p : a.stoppedAt < b.stoppedAt;

// The context that decodes at `rate`: an OfflineAudioContext resamples, or the context decodes
// at its own rate. One target can decode many files.
export function decodeTarget(context, rate) {
  const Offline = globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext;
  if (rate && Offline && rate !== context.sampleRate) {
    try { return new Offline(2, 1, rate); } catch { return context; }
  }
  return context;
}
// decodeAudioData into an AudioBuffer. Old Safari only calls back; newer browsers also return a promise.
export function decodeWith(target, bytes) {
  return new Promise((resolve, reject) => {
    const result = target.decodeAudioData(bytes, resolve, reject);
    result?.then?.(resolve, reject);
  });
}
export const decodeMusic = (context, bytes, rate) => decodeWith(decodeTarget(context, rate), bytes);

export class Music {
  constructor(context, { output, muted = false, coarse = false, tracks = TRACKS,
    fetchFile = globalThis.fetch?.bind(globalThis), decode = (bytes, rate) => decodeMusic(context, bytes, rate) } = {}) {
    this.context = context; this.muted = muted; this.coarse = !!coarse;
    this.fetchFile = fetchFile; this.decode = decode;
    this.rate = this.coarse ? MUSIC.phoneRate : null;
    this.keepDecoded = this.coarse ? MUSIC.keepDecoded.phone : MUSIC.keepDecoded.desktop;
    this.bus = context.createGain(); this.bus.gain.value = 0; this.bus.connect(output);
    // Per track: presence p moves linearly to 0 or 1, level eases to the mix value,
    // gain = equalPower(p) · level. offset is the playhead inside the loop, kept across stops.
    this.tracks = Object.fromEntries(Object.entries(tracks).map(([name, spec]) => {
      const node = context.createGain(); node.gain.value = 0; node.connect(this.bus);
      return [name, { name, spec, node, p: 0, level: 0, gain: 0, target: 0,
        state: 'idle', bytes: null, buffer: null, source: null, startedAt: 0, offset: 0, stoppedAt: -Infinity }];
    }));
    this.mix = Object.fromEntries(Object.keys(tracks).map(name => [name, 0]));
    this.zone = null; this.fetching = false; this.decoding = false;
    this.level = 0; this.armedAt = -Infinity; this.game = null; this.combatUntil = -Infinity; this.time = null;
    this.unfetched = t => t.state === 'idle';
    // Decoded: the zone track, combat, and any track still sounding.
    this.undecoded = t => !!t.bytes && !t.buffer && (t.name === this.zone || t.name === 'combat' || t.target > 0 || t.p > 0);
  }

  setMuted(value) { this.muted = value; }

  // Call once per rendered frame with the UI mode: 'playing', 'paused', 'victory', 'defeat' or 'welcome'.
  update(game, mode = 'playing') {
    const now = this.context.currentTime, p = game.player, events = game.events, enemies = game.enemies;
    const dt = this.time === null ? 0 : Math.max(0, Math.min(.25, now - this.time));
    this.time = now;
    if (game !== this.game) { this.game = game; this.combatUntil = -Infinity; }
    for (let i = 0; i < events.length; i++) if (COMBAT_EVENTS.has(events[i].type)) this.combatUntil = now + MUSIC.combatHold;
    const live = mode === 'playing' && game.phase === 'playing';
    if (live) {
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (e.hp > 0 && e.kind !== 'ritual' && !e.returning && (e.active || (e.state && e.state !== 'idle'))
          && Math.hypot(e.x - p.x, e.y - p.y) < MUSIC.combatRange) {
          this.combatUntil = now + MUSIC.combatHold;
          break;
        }
      }
    }
    const fighting = live && now < this.combatUntil;
    // After victory the camp track plays in full; after defeat, softly.
    const ended = game.phase === 'victory' || game.phase === 'defeat';
    const zone = this.zone = ended ? 'camp' : zoneTrack(game.adventure ? game.locationId : 'road');
    const area = game.phase === 'defeat' ? .4 : fighting ? MUSIC.areaInCombat : 1;
    for (const name in this.mix) this.mix[name] = name === 'combat' ? (fighting ? MUSIC.combatLevel : 0) : name === zone ? area : 0;
    this.load(now);
    for (const name in this.tracks) this.move(this.tracks[name], this.mix[name], now, dt);
    this.trim(now);
    const level = MUSIC.level * (mode === 'paused' ? MUSIC.pauseDuck : 1);
    if (level !== this.level || now - this.armedAt > .2) {
      // Keep-alive: every pump re-arms a fade to silence just beyond the next pump.
      const g = this.bus.gain;
      g.cancelScheduledValues(now);
      g.setTargetAtTime(level, now, MUSIC.fade.duck);
      g.setTargetAtTime(0, now + MUSIC.keepAlive, .3);
      this.level = level; this.armedAt = now;
    }
  }

  // One track's frame: presence toward its goal, level toward the mix, then the gain node.
  move(track, target, now, dt) {
    track.target = target;
    if (target === 0 && track.p === 0 && track.gain === 0 && !track.source) return;
    if (target > 0 && track.buffer && !track.source) this.start(track, now);
    const combat = track.name === 'combat';
    // Presence only grows while the track sounds: a late file fades in from silence.
    if (target > 0 && track.source) track.p = Math.min(1, track.p + dt / (combat ? MUSIC.fade.combatIn : MUSIC.fade.zone));
    else if (target === 0) track.p = Math.max(0, track.p - dt / (combat ? MUSIC.fade.combatOut : MUSIC.fade.zone));
    // A fading track keeps the level it had; a sounding one eases to its new level.
    if (target > 0) {
      track.level = track.level === 0 ? target : target + (track.level - target) * Math.exp(-dt / MUSIC.fade.level);
      if (Math.abs(track.level - target) < 1e-4) track.level = target;
    }
    // Small steps wait for the next frame; the end of a fade is always written exactly.
    const gain = equalPower(track.p) * track.level;
    if (gain !== track.gain && (Math.abs(gain - track.gain) > 1e-4 || track.p === 0 || track.p === 1)) {
      track.node.gain.setTargetAtTime(gain, now, MUSIC.fade.smooth);
      track.gain = gain;
    }
    if (target === 0 && track.p === 0 && track.source) this.stop(track, now);
  }
  // Frees decoded zone buffers: a stopped track's after keepDecoded seconds, and the longest-stopped
  // one at once while more than zoneBuffers are decoded. Combat stays decoded: a fight can start anywhere.
  trim(now) {
    let decoded = 0, oldest = null;
    for (const name in this.tracks) {
      const track = this.tracks[name];
      if (!track.buffer || name === 'combat') continue;
      const idle = !track.source && track.target === 0 && name !== this.zone;
      if (idle && now - track.stoppedAt >= this.keepDecoded) { track.buffer = null; continue; }
      decoded++;
      if (idle && (!oldest || track.stoppedAt < oldest.stoppedAt)) oldest = track;
    }
    if (decoded > MUSIC.zoneBuffers && oldest) oldest.buffer = null;
  }
  // Frees zone buffers until one more fits in zoneBuffers. A sounding track fades out in
  // 4 smoothing constants and stops; it does not come back unless the monk returns to its zone.
  makeRoom(now) {
    for (;;) {
      let decoded = 0, victim = null;
      for (const name in this.tracks) {
        const track = this.tracks[name];
        if (!track.buffer || name === 'combat') continue;
        decoded++;
        if (name !== this.zone && (!victim || givesWay(track, victim))) victim = track;
      }
      if (decoded < MUSIC.zoneBuffers || !victim) return;
      if (victim.source) {
        victim.node.gain.cancelScheduledValues(now);
        victim.node.gain.setTargetAtTime(0, now, MUSIC.fade.smooth);
        this.stop(victim, now);
      }
      victim.p = 0; victim.gain = 0; victim.buffer = null;
    }
  }

  // Zone tracks resume where they stopped; combat starts each fight from its top.
  start(track, now) {
    const { loopStart, loopSeconds } = track.spec, source = this.context.createBufferSource();
    source.buffer = track.buffer; source.loop = true;
    source.loopStart = loopStart; source.loopEnd = loopStart + loopSeconds;
    source.connect(track.node);
    source.start(now, loopStart + track.offset);
    track.source = source; track.startedAt = now; track.level = 0;
  }
  stop(track, now) {
    const { loopSeconds } = track.spec;
    track.offset = track.name === 'combat' ? 0 : (track.offset + now - track.startedAt) % loopSeconds;
    // A few smoothing constants later the gain node is truly silent: no click at the cut.
    const source = track.source;
    source.onended = () => source.disconnect();
    source.stop(now + 4 * MUSIC.fade.smooth);
    track.source = null; track.stoppedAt = now; track.level = 0;
  }

  // One fetch and one decode at a time, wanted tracks first. A zone track decodes only once it fits
  // in the zone budget. Never throws, never retries a failed file.
  load(now) {
    if (!this.fetching && this.fetchFile) {
      const next = this.first(this.unfetched);
      if (next) this.fetchTrack(next);
    }
    if (!this.decoding) {
      const next = this.first(this.undecoded);
      if (next && next.name !== 'combat') this.makeRoom(now);
      if (next) this.decodeTrack(next);
    }
  }
  // The zone track, then combat, then the others in TRACKS order.
  first(wanted) {
    const zone = this.tracks[this.zone], combat = this.tracks.combat;
    if (zone && wanted(zone)) return zone;
    if (combat && wanted(combat)) return combat;
    for (const name in this.tracks) if (wanted(this.tracks[name])) return this.tracks[name];
    return null;
  }
  async fetchTrack(track) {
    this.fetching = true; track.state = 'fetching';
    try {
      const response = await this.fetchFile(track.spec.url);
      if (!response.ok) throw new Error(`${response.status} ${track.spec.url}`);
      track.bytes = await response.arrayBuffer();
      track.state = 'fetched';
    } catch {
      track.state = 'failed';
    } finally {
      this.fetching = false;
    }
  }
  async decodeTrack(track) {
    this.decoding = true;
    try {
      // decodeAudioData detaches its input: decode a copy and keep the bytes for a later decode.
      track.buffer = await this.decode(track.bytes.slice(0), this.rate);
    } catch {
      track.state = 'failed'; track.bytes = null;
    } finally {
      this.decoding = false;
    }
  }
}
