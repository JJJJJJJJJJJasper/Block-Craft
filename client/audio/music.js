// ============================================================================
// Music: an original, generative composer. Nothing is recorded and no existing
// tune is used. Each piece is "written" on the spot from a seed:
//   1. pick a key, a scale (major, lydian, dorian...), a tempo and a chord
//      progression,
//   2. the left hand plays broken chords; the right hand improvises a sparse
//      melody that mostly moves by small steps and rests between phrases,
//   3. everything is played by little synthesizers (a soft piano, warm pads,
//      bells, plucks, a chiptune square) through a big hall reverb.
//
// Background music: every few minutes a quiet piece plays, its mood matching
// the time of day (bright mornings, mellow evenings, slow nights, sparse and
// low in caves). Music discs: each disc has its own fixed style and plays from
// its jukebox, quieter the further away you are.
// ============================================================================

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11], lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10], aeolian: [0, 2, 3, 5, 7, 8, 10],
};
// chord progressions as scale degrees (0 = the home chord)
const PROGRESSIONS = [[0, 3, 0, 4], [0, 5, 3, 4], [5, 3, 0, 4], [0, 4, 5, 3], [1, 4, 0, 0], [0, 3, 5, 4], [3, 0, 4, 5], [0, 2, 3, 3], [0, 6, 5, 4]];

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// ---- Styles ---------------------------------------------------------------------
// The background moods, plus one style per music disc (each disc always plays the same piece).
const MOODS = {
  day: { tempo: [64, 78], scales: ['major', 'lydian'], lh: ['arp', 'arp', 'block'], melody: 0.42, inst: 'piano', pad: 0.5, register: 0 },
  evening: { tempo: [58, 70], scales: ['mixolydian', 'major', 'dorian'], lh: ['arp', 'block'], melody: 0.35, inst: 'piano', pad: 0.8, register: 0 },
  night: { tempo: [50, 62], scales: ['dorian', 'aeolian'], lh: ['block', 'arp'], melody: 0.28, inst: 'piano', pad: 1, register: -2, bells: 0.2 },
  cave: { tempo: [46, 56], scales: ['aeolian', 'dorian'], lh: ['block'], melody: 0.18, inst: 'bell', pad: 1, register: -5 },
};
export const DISC_STYLES = {
  ember: { seed: 11, tempo: [112, 112], scales: ['mixolydian'], lh: ['pulse'], melody: 0.62, inst: 'pluck', pad: 0.2, register: 0, bars: 32 },
  tide: { seed: 22, tempo: [84, 84], scales: ['lydian'], lh: ['arp'], melody: 0.45, inst: 'piano', pad: 0.9, register: 0, bars: 32 },
  meadow: { seed: 33, tempo: [98, 98], scales: ['major'], lh: ['arp'], melody: 0.6, inst: 'piano', pad: 0.3, register: 2, bars: 32 },
  dusk: { seed: 44, tempo: [60, 60], scales: ['aeolian'], lh: ['block'], melody: 0.35, inst: 'piano', pad: 1, register: -2, bars: 28 },
  frost: { seed: 55, tempo: [76, 76], scales: ['lydian'], lh: ['arp'], melody: 0.5, inst: 'bell', pad: 0.7, register: 5, bars: 28 },
  honey: { seed: 66, tempo: [88, 88], scales: ['mixolydian'], lh: ['waltz'], melody: 0.55, inst: 'piano', pad: 0.4, register: 0, meter: 3, sevenths: true, bars: 32 },
  cinder: { seed: 77, tempo: [70, 70], scales: ['aeolian'], lh: ['pulse'], melody: 0.4, inst: 'square', pad: 0.8, register: -4, bars: 28 },
  bloom: { seed: 88, tempo: [104, 104], scales: ['major'], lh: ['waltz'], melody: 0.6, inst: 'pluck', pad: 0.3, register: 2, meter: 3, bars: 32 },
  moss: { seed: 99, tempo: [82, 82], scales: ['dorian'], lh: ['arp'], melody: 0.55, inst: 'pluck', pad: 0.6, register: 0, bars: 32 },
  echo: { seed: 111, tempo: [66, 66], scales: ['dorian'], lh: ['block'], melody: 0.3, inst: 'bell', pad: 0.9, register: 3, bars: 24, echo: true },
  ripple: { seed: 122, tempo: [120, 120], scales: ['lydian'], lh: ['arp'], melody: 0.5, inst: 'piano', pad: 0.4, register: 3, bars: 32 },
  spark: { seed: 133, tempo: [132, 132], scales: ['major'], lh: ['pulse'], melody: 0.7, inst: 'square', pad: 0.1, register: 2, bars: 32 },
};

/** Compose a piece: a list of note events {t, midi, dur, vel, inst} plus its total length in seconds. */
export function compose(style, seed) {
  const r = rng(seed);
  const tempo = style.tempo[0] + r() * (style.tempo[1] - style.tempo[0]);
  const beat = 60 / tempo, meter = style.meter || 4, bar = beat * meter, eighth = beat / 2;
  const scale = SCALES[pick(r, style.scales)];
  const root = 48 + Math.floor(r() * 7) + (style.register || 0);            // somewhere around C3..F#3
  const prog = pick(r, PROGRESSIONS);
  const bars = style.bars || 20 + Math.floor(r() * 12);
  const deg = (d) => root + scale[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
  const lhStyle = pick(r, style.lh);
  const events = [];
  const note = (t, midi, dur, vel, inst) => events.push({ t, midi, dur, vel, inst });
  let melodyDeg = 7 + 2 * Math.floor(r() * 3); // start on a chord tone an octave up
  for (let b = 0; b < bars; b++) {
    const t0 = b * bar;
    const last = b === bars - 1;
    const chord = prog[Math.floor(b / 2) % prog.length];       // each chord lasts two bars
    const tones = [chord, chord + 2, chord + 4];
    if (style.sevenths && r() < 0.6) tones.push(chord + 6);
    // ---- pad: the chord held softly underneath ----
    if (style.pad && b % 2 === 0 && r() < style.pad) for (const d of tones) note(t0, deg(d) + 12, bar * 2, 0.16, 'pad');
    // ---- left hand ----
    const low = deg(chord) - 12;
    if (last) { note(t0, low, bar * 2, 0.5, style.inst); for (const d of tones) note(t0 + 0.04, deg(d), bar * 2, 0.35, style.inst); break; }
    if (lhStyle === 'arp') {
      const pattern = [low, deg(chord), deg(chord + 4), deg(chord + 7), deg(chord + 2) + 12, deg(chord + 4)];
      for (let i = 0; i < meter * 2 && i < pattern.length + 2; i++) note(t0 + i * eighth, pattern[i % pattern.length], beat * 2.5, 0.32 - i * 0.02, style.inst);
    } else if (lhStyle === 'block') {
      note(t0, low, bar * 1.5, 0.4, style.inst);
      for (const d of tones) note(t0 + 0.05 + r() * 0.04, deg(d), bar * 1.4, 0.24, style.inst);
    } else if (lhStyle === 'waltz') {
      note(t0, low, beat * 1.5, 0.42, style.inst);
      for (let k = 1; k < meter; k++) for (const d of tones) note(t0 + k * beat, deg(d), beat * 0.9, 0.2, style.inst);
    } else { // pulse: steady repeated eighths
      for (let i = 0; i < meter * 2; i++) note(t0 + i * eighth, i % 2 ? deg(chord + 4) : deg(chord), eighth * 1.6, i % 2 ? 0.18 : 0.26, style.inst);
      note(t0, low, bar, 0.35, 'bass');
    }
    // ---- right hand: a sparse melody in four-bar phrases ----
    const phraseRest = b % 4 === 3 && r() < 0.6;
    for (let i = 0; i < meter * 2 && !phraseRest; i++) {
      if (r() > style.melody * (i % 2 ? 0.6 : 1)) continue;
      const move = r();
      if (move < 0.35) melodyDeg += 1; else if (move < 0.7) melodyDeg -= 1;
      else if (move < 0.85) melodyDeg += r() < 0.5 ? 2 : -2;
      else melodyDeg = 7 + pick(r, tones) % 7 + (r() < 0.3 ? 7 : 0);  // leap to a chord tone
      melodyDeg = Math.max(5, Math.min(16, melodyDeg));
      const len = (r() < 0.3 ? 3 : r() < 0.6 ? 2 : 1) * eighth;
      note(t0 + i * eighth, deg(melodyDeg) + 12, len * 1.8, 0.3 + r() * 0.12, style.inst);
      if (style.echo) note(t0 + i * eighth + beat * 0.75, deg(melodyDeg) + 12, len, 0.12, style.inst);
    }
    if (style.bells && r() < style.bells) note(t0 + beat * Math.floor(r() * meter), deg(pick(r, tones)) + 24, beat * 3, 0.12, 'bell');
  }
  const length = bars * bar + bar * 2.5;
  return { events, length };
}

// ---- Synth voices -------------------------------------------------------------------
function voice(ctx, out, inst, freq, t, dur, vel) {
  const g = ctx.createGain();
  g.connect(out);
  const osc = (type, f, gain, detune = 0) => {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = detune;
    const og = ctx.createGain(); og.gain.value = gain; o.connect(og).connect(g);
    o.start(t); o.stop(t + dur + 3);
    return o;
  };
  const env = (attack, decay) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vel), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  };
  if (inst === 'piano') {
    // a fundamental plus two softer overtones; higher notes fade faster, like a real piano
    osc('sine', freq, 1, -3); osc('sine', freq, 0.5, 4); osc('sine', freq * 2, 0.32); osc('sine', freq * 3, 0.1);
    env(0.006, Math.min(dur + 0.6, 3.2 * Math.pow(220 / freq, 0.35)));
  } else if (inst === 'pad') {
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1100; f.connect(out); g.disconnect(); g.connect(f);
    osc('triangle', freq, 0.6, -7); osc('triangle', freq, 0.6, 7); osc('sine', freq / 2, 0.4);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vel, t + 1.2);
    g.gain.setValueAtTime(vel, t + Math.max(1.3, dur - 0.5)); g.gain.linearRampToValueAtTime(0.0001, t + dur + 1.5);
  } else if (inst === 'bell') {
    osc('sine', freq, 1); osc('sine', freq * 2.76, 0.35); osc('sine', freq * 5.4, 0.12);
    env(0.004, 2.8);
  } else if (inst === 'pluck') {
    osc('triangle', freq, 1); osc('sine', freq * 2, 0.3);
    env(0.004, 0.55 + Math.min(dur, 0.6));
  } else if (inst === 'square') {
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2400; f.connect(out); g.disconnect(); g.connect(f);
    osc('square', freq, 0.35);
    env(0.004, Math.min(dur, 0.5) + 0.15);
  } else { // bass
    osc('sine', freq, 1); osc('triangle', freq, 0.25);
    env(0.01, dur + 0.3);
  }
}

/** A long stereo "hall" reverb made from decaying noise. */
function makeReverb(ctx) {
  const len = Math.floor(ctx.sampleRate * 3.8);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  const c = ctx.createConvolver();
  c.buffer = buf;
  return c;
}

/** One piece being played: schedules its notes a little ahead of time. */
class Performance {
  constructor(ctx, out, piece) {
    this.ctx = ctx; this.out = out; this.piece = piece;
    this.start = ctx.currentTime + 0.1;
    this.next = 0;
    this.piece.events.sort((a, b) => a.t - b.t);
  }
  get done() { return this.ctx.currentTime > this.start + this.piece.length; }
  pump() {
    const until = this.ctx.currentTime + 0.6;
    const ev = this.piece.events;
    while (this.next < ev.length && this.start + ev[this.next].t < until) {
      const e = ev[this.next++];
      voice(this.ctx, this.out, e.inst, mtof(e.midi), this.start + e.t, e.dur, e.vel * 0.5);
    }
  }
  stop() {
    this.next = this.piece.events.length;
    this.out.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.4);
    setTimeout(() => { try { this.out.disconnect(); } catch { /* already gone */ } }, 3000);
  }
}

export class Music {
  constructor(sfx) {
    this.sfx = sfx;
    this.volume = 0.5;
    this.bg = null;
    this.discs = new Map();              // "x,y,z" -> {perf, pan, pos}
    this.nextBg = performance.now() + 20000; // first piece about 20 s after joining
  }

  _setup() {
    const ctx = this.sfx.ctx;
    if (!ctx || this.bus) return !!ctx;
    this.bus = ctx.createGain();
    this.bus.connect(ctx.destination);
    const rev = makeReverb(ctx), wet = ctx.createGain(), dry = ctx.createGain();
    wet.gain.value = 0.55; dry.gain.value = 0.8;
    this.input = ctx.createGain();
    this.input.connect(dry).connect(this.bus);
    this.input.connect(rev).connect(wet).connect(this.bus);
    this._applyVolume();
    return true;
  }

  setVolume(v) { this.volume = v; this._applyVolume(); }
  _applyVolume() { if (this.bus) this.bus.gain.value = this.sfx.muted ? 0 : this.volume * 0.9; }

  /** Start or stop a jukebox. disc = item name like 'music_disc_tide', or null to stop. */
  setDisc(key, pos, disc) {
    const old = this.discs.get(key);
    if (old) { old.perf.stop(); this.discs.delete(key); }
    if (!disc || !this._setup()) return;
    const style = DISC_STYLES[disc.replace('music_disc_', '')];
    if (!style) return;
    const ctx = this.sfx.ctx;
    const out = ctx.createGain(); out.gain.value = 0;
    const pan = ctx.createStereoPanner();
    out.connect(pan).connect(this.input);
    const perf = new Performance(ctx, out, compose(style, style.seed));
    this.discs.set(key, { perf, pan, out, pos });
  }

  /**
   * Called every frame. listener = {x, y, z, yaw}; mood = 'day' | 'evening' | 'night' | 'cave'.
   */
  update(listener, mood) {
    if (!this.sfx.ctx || this.sfx.ctx.state !== 'running' || !this._setup()) return;
    this._applyVolume();
    // ---- jukeboxes: louder when close, panned left/right ----
    let nearDisc = 0;
    for (const [key, d] of this.discs) {
      if (d.perf.done) { d.perf.stop(); this.discs.delete(key); continue; }
      d.perf.pump();
      const dx = d.pos.x + 0.5 - listener.x, dz = d.pos.z + 0.5 - listener.z, dy = d.pos.y - listener.y;
      const dist = Math.hypot(dx, dy, dz);
      const g = Math.pow(Math.max(0, 1 - dist / 48), 1.6);
      nearDisc = Math.max(nearDisc, g);
      d.out.gain.setTargetAtTime(g * 1.3, this.sfx.ctx.currentTime, 0.1);
      // which side is it on? (camera looks along -Z at yaw 0)
      const right = { x: Math.cos(listener.yaw), z: -Math.sin(listener.yaw) };
      d.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, (dx * right.x + dz * right.z) / Math.max(1, dist))) * 0.8, this.sfx.ctx.currentTime, 0.1);
    }
    // ---- background pieces, now and then ----
    if (this.bg) {
      this.bg.pump();
      this.bg.out.gain.setTargetAtTime(nearDisc > 0.05 ? 0.0001 : 1, this.sfx.ctx.currentTime, 1.5); // quiet down near a jukebox
      if (this.bg.done) { this.bg.stop(); this.bg = null; this.nextBg = performance.now() + (150 + Math.random() * 210) * 1000; }
    } else if (performance.now() > this.nextBg && nearDisc < 0.05) {
      const ctx = this.sfx.ctx;
      const out = ctx.createGain(); out.gain.value = 1; out.connect(this.input);
      this.bg = new Performance(ctx, out, compose(MOODS[mood] || MOODS.day, (Math.random() * 1e9) | 0));
      this.bg.out = out;
    }
  }

  /** Play a background piece right away (from the settings menu). */
  playNow() { this.nextBg = 0; if (this.bg) { this.bg.stop(); this.bg = null; } }
}
