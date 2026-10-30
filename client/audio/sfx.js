// ============================================================================
// Procedural sound effects with the Web Audio API. There are no sound files:
// each effect is built from two ingredients:
//   - white noise passed through a filter (crunchy/scratchy sounds: stone,
//     gravel, grass, footsteps). The filter frequency decides the "material".
//   - oscillators whose pitch slides (tonal sounds: hurt, pickup, oink).
// Each sound gets a quick attack and an exponential decay "envelope".
// ============================================================================

// Material -> filter settings: [filter type, frequency (Hz), Q, duration (s)]
const MATERIAL = {
  stone: ['bandpass', 1500, 1.2, 0.12],
  wood: ['lowpass', 900, 2, 0.12],
  grass: ['highpass', 2200, 0.7, 0.14],
  gravel: ['bandpass', 900, 0.8, 0.16],
  sand: ['bandpass', 2800, 0.6, 0.18],
  snow: ['highpass', 3500, 0.5, 0.16],
  glass: ['bandpass', 4000, 6, 0.1],
  cloth: ['lowpass', 600, 0.7, 0.12],
};

export class Sfx {
  constructor() {
    this.ctx = null;
    this.volume = 0.7;
    this.muted = false;
  }

  /** Browsers only allow audio after a user gesture; call this from a click. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      // One second of white noise, reused by every noisy sound.
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this._applyVolume();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(v) { this.volume = v; this._applyVolume(); }
  toggleMute() { this.muted = !this.muted; this._applyVolume(); return this.muted; }
  _applyVolume() { if (this.master) this.master.gain.value = this.muted ? 0 : this.volume; }

  get ready() { return this.ctx && this.ctx.state === 'running' && !this.muted && this.volume > 0; }

  _noise(filterType, freq, q, dur, gain, when = 0) {
    if (!(gain > 0.0005)) return; // too quiet (or far away) to hear
    const ctx = this.ctx, t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4; // tiny variation so repeats don't sound robotic
    const f = ctx.createBiquadFilter();
    f.type = filterType; f.frequency.value = freq * (0.9 + Math.random() * 0.2); f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  _tone(type, f0, f1, dur, gain, when = 0) {
    if (!(gain > 0.0005)) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  /** gain multiplier for a sound at a distance (simple falloff). */
  _dist(d) { return d === undefined ? 1 : Math.max(0, 1 - d / 24); }

  break(material = 'stone', dist) {
    if (!this.ready) return;
    const [type, freq, q, dur] = MATERIAL[material] || MATERIAL.stone;
    const v = this._dist(dist);
    if (v <= 0) return;
    this._noise(type, freq, q, dur * 1.8, 0.5 * v);
    this._noise(type, freq * 0.6, q, dur * 1.4, 0.3 * v, 0.03);
    if (material === 'glass') { this._tone('triangle', 2400, 1800, 0.25, 0.15 * v); this._tone('triangle', 3100, 2600, 0.2, 0.1 * v, 0.04); }
    if (material === 'wood') this._tone('sine', 220, 140, 0.12, 0.2 * v);
  }

  /** Soft repeated scratching while mining. */
  hit(material = 'stone') {
    if (!this.ready) return;
    const [type, freq, q, dur] = MATERIAL[material] || MATERIAL.stone;
    this._noise(type, freq, q, dur * 0.8, 0.18);
  }

  place(material = 'stone', dist) {
    if (!this.ready) return;
    const [type, freq, q, dur] = MATERIAL[material] || MATERIAL.stone;
    const v = this._dist(dist);
    if (v <= 0) return;
    this._noise(type, freq * 0.7, q, dur * 1.2, 0.45 * v);
    this._tone('sine', 160, 90, 0.08, 0.25 * v);
  }

  step(material = 'stone') {
    if (!this.ready) return;
    const [type, freq, q, dur] = MATERIAL[material] || MATERIAL.stone;
    this._noise(type, freq, q, dur, 0.12);
  }

  hurt(dist) {
    if (!this.ready) return;
    const v = dist === undefined ? 1 : this._dist(dist);
    if (v <= 0) return;
    this._tone('square', 330, 180, 0.18, 0.12 * v);
    this._tone('sawtooth', 260, 140, 0.2, 0.08 * v, 0.02);
  }

  pickup() {
    if (!this.ready) return;
    this._tone('sine', 900 + Math.random() * 300, 1600, 0.08, 0.12);
  }

  eat() {
    if (!this.ready) return;
    for (let i = 0; i < 3; i++) this._noise('bandpass', 1200, 1.5, 0.08, 0.25, i * 0.12);
  }

  /** Skeleton bones clacking, a spider's hiss, a Rumbler's low grind. */
  rattle(dist) { const v = this._dist(dist); if (this.ready && v > 0) for (let i = 0; i < 3; i++) this._noise('bandpass', 2600, 6, 0.04, 0.2 * v, i * 0.07); }
  hiss(dist) { const v = this._dist(dist); if (this.ready && v > 0) this._noise('highpass', 4000, 0.8, 0.35, 0.15 * v); }
  rumble(dist) { const v = this._dist(dist); if (this.ready && v > 0) { this._tone('sawtooth', 70, 50, 0.5, 0.08 * v); this._noise('lowpass', 300, 1, 0.5, 0.25 * v); } }

  /** A soft rising chord as the sun comes up in the sleep cutscene. */
  dawn() {
    if (!this.ready) return;
    [262, 330, 392, 523].forEach((f, i) => this._tone('sine', f, f * 1.002, 2.8, 0.07, i * 0.35));
  }

  /** A hissing fuse (lit TNT). */
  fuse(dist) {
    if (!this.ready) return;
    const v = this._dist(dist);
    if (v > 0) this._noise('highpass', 3500, 0.7, 1.2, 0.25 * v);
  }

  /** An explosion: a low thump plus a long rumble of noise. */
  boom(dist) {
    if (!this.ready) return;
    const v = Math.max(0.15, 1 - (dist || 0) / 60);
    this._tone('sine', 90, 30, 0.6, 0.6 * v);
    this._noise('lowpass', 600, 0.6, 1.4, 0.7 * v);
    this._noise('bandpass', 1800, 0.8, 0.5, 0.3 * v, 0.02);
  }

  /** Bow string / throwing whoosh. */
  twang() { if (this.ready) { this._tone('triangle', 520, 260, 0.15, 0.15); this._noise('bandpass', 2200, 2, 0.12, 0.12); } }
  whoosh() { if (this.ready) this._noise('bandpass', 900, 1.2, 0.18, 0.2); }

  splash() {
    if (!this.ready) return;
    this._noise('lowpass', 1400, 0.5, 0.45, 0.35);
  }

  click() {
    if (!this.ready) return;
    this._tone('square', 1200, 900, 0.03, 0.05);
  }

  oink(dist) {
    if (!this.ready) return;
    const v = this._dist(dist);
    if (v <= 0) return;
    this._tone('sawtooth', 300, 200, 0.12, 0.12 * v);
    this._tone('sawtooth', 280, 180, 0.12, 0.1 * v, 0.15);
  }

  moo(dist) {
    if (!this.ready) return;
    const v = this._dist(dist);
    if (v <= 0) return;
    this._tone('sawtooth', 140, 105, 0.7, 0.1 * v);
    this._tone('triangle', 70, 60, 0.7, 0.08 * v);
  }

  baa(dist) {
    if (!this.ready) return;
    const v = this._dist(dist);
    if (v <= 0) return;
    for (let i = 0; i < 4; i++) this._tone('sawtooth', 420 - i * 15, 380 - i * 15, 0.09, 0.07 * v, i * 0.09);
  }

  cluck(dist) {
    if (!this.ready) return;
    const v = this._dist(dist);
    if (v <= 0) return;
    this._tone('square', 900, 600, 0.05, 0.06 * v);
    this._tone('square', 1000, 650, 0.05, 0.05 * v, 0.12);
  }

  hmm(dist) {
    if (!this.ready) return;
    const v = this._dist(dist);
    if (v <= 0) return;
    this._tone('triangle', 180, 140, 0.35, 0.12 * v);
  }

  groan(dist) {
    if (!this.ready) return;
    const v = this._dist(dist);
    if (v <= 0) return;
    this._tone('sawtooth', 110, 80, 0.6, 0.1 * v);
    this._noise('lowpass', 400, 1, 0.5, 0.06 * v);
  }

  // ---- The other animals and monsters (all simple synthesized sounds) ----
  _say(dist, fn) { const v = this._dist(dist); if (this.ready && v > 0) fn(v); }
  bark(dist) { this._say(dist, v => { this._tone('square', 520, 260, 0.08, 0.08 * v); this._tone('square', 480, 240, 0.08, 0.07 * v, 0.16); }); }
  meow(dist) { this._say(dist, v => { this._tone('triangle', 600, 900, 0.12, 0.08 * v); this._tone('triangle', 900, 500, 0.2, 0.08 * v, 0.12); }); }
  neigh(dist) { this._say(dist, v => { for (let i = 0; i < 5; i++) this._tone('sawtooth', 700 - i * 60, 600 - i * 60, 0.07, 0.06 * v, i * 0.07); }); }
  bray(dist) { this._say(dist, v => { this._tone('sawtooth', 300, 500, 0.25, 0.08 * v); this._tone('sawtooth', 500, 250, 0.35, 0.08 * v, 0.25); }); }
  squish(dist) { this._say(dist, v => { this._noise('lowpass', 500, 2, 0.15, 0.2 * v); this._tone('sine', 160, 90, 0.15, 0.1 * v); }); }
  cackle(dist) { this._say(dist, v => { for (let i = 0; i < 4; i++) this._tone('square', 700 + (i % 2) * 120, 600, 0.06, 0.05 * v, i * 0.09); }); }
  clank(dist) { this._say(dist, v => { this._tone('square', 140, 90, 0.2, 0.08 * v); this._noise('bandpass', 1800, 4, 0.15, 0.1 * v); }); }
  bubble(dist) { this._say(dist, v => { for (let i = 0; i < 3; i++) this._tone('sine', 300 + i * 120, 600 + i * 120, 0.08, 0.06 * v, i * 0.1); }); }
  squeak(dist) { this._say(dist, v => this._tone('sine', 2400, 3000, 0.06, 0.04 * v)); }
  growl(dist) { this._say(dist, v => { this._tone('sawtooth', 90, 70, 0.6, 0.1 * v); this._noise('lowpass', 250, 1, 0.6, 0.12 * v); }); }
  chirp(dist) { this._say(dist, v => { this._tone('sine', 1800, 2600, 0.05, 0.05 * v); this._tone('sine', 2000, 2800, 0.05, 0.05 * v, 0.08); }); }
  whisper(dist) { this._say(dist, v => { this._noise('bandpass', 700, 3, 0.9, 0.08 * v); this._tone('sine', 220, 207, 0.9, 0.03 * v); }); }
  hrm(dist) { this._say(dist, v => this._tone('sawtooth', 150, 120, 0.25, 0.08 * v)); }
  heart() { if (this.ready) { this._tone('sine', 880, 880, 0.12, 0.05); this._tone('sine', 1320, 1320, 0.15, 0.04, 0.1); } }
  zap(dist) { this._say(dist, v => { this._tone('sawtooth', 200, 1200, 1.8, 0.04 * v); }); }
  snap(dist) { this._say(dist, v => { this._noise('bandpass', 1200, 2, 0.08, 0.2 * v); this._tone('square', 240, 120, 0.08, 0.06 * v); }); }
  spell(dist) { this._say(dist, v => { for (let i = 0; i < 4; i++) this._tone('triangle', 400 + i * 200, 600 + i * 200, 0.2, 0.04 * v, i * 0.08); }); }
  /** Firework: a whoosh going up, then a bang and crackles (quieter far away). */
  launch(dist) { this._say(dist, v => this._noise('bandpass', 1400, 1.5, 0.6, 0.18 * v)); }
  burst(dist) {
    const v = Math.max(0, 1 - (dist || 0) / 120);
    if (!this.ready || v <= 0) return;
    const delay = (dist || 0) / 340; // sound takes a moment to arrive
    this._noise('lowpass', 900, 1, 0.5, 0.35 * v, delay);
    for (let i = 0; i < 10; i++) this._noise('highpass', 3000, 1, 0.03, 0.08 * v, delay + 0.4 + Math.random() * 0.8);
  }

  mobHurt(dist) {
    if (!this.ready) return;
    this._tone('square', 500, 250, 0.12, 0.1 * this._dist(dist));
  }
}

export const sfx = new Sfx();
