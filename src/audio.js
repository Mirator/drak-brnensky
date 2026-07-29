/**
 * All sound is synthesised at runtime — no asset downloads.
 */
export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.musicGain = null;
    this._noise = null;
    this.volume = 0.55;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);

    // shared noise buffer
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noise = buf;

    this.startMusic();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  get t() { return this.ctx.currentTime; }

  _noiseSource(dur, playbackRate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = this._noise;
    s.loop = true;
    s.playbackRate.value = playbackRate;
    s.start(this.t, Math.random() * 1.5, dur + 0.05);
    return s;
  }

  _env(gain, peak, attack, decay, when = 0) {
    const t0 = this.t + when;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    return t0 + attack + decay;
  }

  /* ---------------- one-shots ---------------- */
  shoot(vol = 0.5) {
    if (!this.ctx) return;
    const g = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(1800, this.t);
    f.frequency.exponentialRampToValueAtTime(420, this.t + 0.14);
    f.Q.value = 1.4;
    const n = this._noiseSource(0.2, 1.6);
    n.connect(f);
    f.connect(g);
    g.connect(this.master);
    this._env(g, 0.32 * vol, 0.003, 0.13);

    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(760, this.t);
    o.frequency.exponentialRampToValueAtTime(140, this.t + 0.12);
    const og = this.ctx.createGain();
    o.connect(og);
    og.connect(this.master);
    this._env(og, 0.22 * vol, 0.002, 0.11);
    o.start(this.t);
    o.stop(this.t + 0.2);
    n.stop(this.t + 0.22);
  }

  dryFire() {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 180;
    const g = this.ctx.createGain();
    o.connect(g); g.connect(this.master);
    this._env(g, 0.12, 0.002, 0.05);
    o.start(this.t); o.stop(this.t + 0.09);
  }

  reload() {
    if (!this.ctx) return;
    for (const [when, freq] of [[0, 320], [0.16, 240], [0.62, 420], [0.8, 560]]) {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = freq;
      const g = this.ctx.createGain();
      o.connect(g); g.connect(this.master);
      const t0 = this.t + when;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.14, t0 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
      o.start(t0); o.stop(t0 + 0.12);
    }
  }

  hit(vol = 0.4) {
    if (!this.ctx) return;
    const n = this._noiseSource(0.1, 0.8);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    const g = this.ctx.createGain();
    n.connect(f); f.connect(g); g.connect(this.master);
    this._env(g, 0.3 * vol, 0.002, 0.08);
    n.stop(this.t + 0.14);
  }

  kill() {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(420, this.t);
    o.frequency.exponentialRampToValueAtTime(70, this.t + 0.3);
    const g = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1200;
    o.connect(f); f.connect(g); g.connect(this.master);
    this._env(g, 0.2, 0.005, 0.3);
    o.start(this.t); o.stop(this.t + 0.4);
  }

  explosion(vol = 1) {
    if (!this.ctx) return;
    const n = this._noiseSource(0.9, 0.55);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1400, this.t);
    f.frequency.exponentialRampToValueAtTime(120, this.t + 0.7);
    const g = this.ctx.createGain();
    n.connect(f); f.connect(g); g.connect(this.master);
    this._env(g, 0.5 * vol, 0.006, 0.75);

    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, this.t);
    o.frequency.exponentialRampToValueAtTime(28, this.t + 0.6);
    const og = this.ctx.createGain();
    o.connect(og); og.connect(this.master);
    this._env(og, 0.45 * vol, 0.01, 0.6);
    o.start(this.t); o.stop(this.t + 0.8);
    n.stop(this.t + 1.0);
  }

  hurt() {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(150, this.t);
    o.frequency.exponentialRampToValueAtTime(60, this.t + 0.25);
    const g = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 700;
    o.connect(f); f.connect(g); g.connect(this.master);
    this._env(g, 0.34, 0.004, 0.26);
    o.start(this.t); o.stop(this.t + 0.35);
  }

  step(intensity = 0.5) {
    if (!this.ctx) return;
    const n = this._noiseSource(0.08, 0.4 + Math.random() * 0.3);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 220 + Math.random() * 120;
    f.Q.value = 0.9;
    const g = this.ctx.createGain();
    n.connect(f); f.connect(g); g.connect(this.master);
    this._env(g, 0.07 + intensity * 0.07, 0.002, 0.07);
    n.stop(this.t + 0.12);
  }

  jump() {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(260, this.t);
    o.frequency.exponentialRampToValueAtTime(480, this.t + 0.12);
    const g = this.ctx.createGain();
    o.connect(g); g.connect(this.master);
    this._env(g, 0.1, 0.004, 0.1);
    o.start(this.t); o.stop(this.t + 0.2);
  }

  dash() {
    if (!this.ctx) return;
    const n = this._noiseSource(0.3, 2.2);
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.setValueAtTime(400, this.t);
    f.frequency.exponentialRampToValueAtTime(2600, this.t + 0.22);
    const g = this.ctx.createGain();
    n.connect(f); f.connect(g); g.connect(this.master);
    this._env(g, 0.16, 0.004, 0.22);
    n.stop(this.t + 0.32);
  }

  pickup() {
    if (!this.ctx) return;
    [660, 880, 1320].forEach((fr, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = fr;
      const g = this.ctx.createGain();
      o.connect(g); g.connect(this.master);
      const t0 = this.t + i * 0.06;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.13, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
      o.start(t0); o.stop(t0 + 0.2);
    });
  }

  roar(big = true) {
    if (!this.ctx) return;
    const dur = big ? 1.8 : 0.7;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    const base = big ? 62 : 130;
    o.frequency.setValueAtTime(base * 1.6, this.t);
    o.frequency.exponentialRampToValueAtTime(base, this.t + dur * 0.6);
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = big ? 7 : 12;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = big ? 22 : 16;
    lfo.connect(lfoGain);
    lfoGain.connect(o.frequency);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1800, this.t);
    f.frequency.exponentialRampToValueAtTime(300, this.t + dur);
    const dist = this.ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 128) - 1;
      curve[i] = Math.tanh(x * 3.2);
    }
    dist.curve = curve;
    const g = this.ctx.createGain();
    o.connect(f); f.connect(dist); dist.connect(g); g.connect(this.master);
    this._env(g, big ? 0.5 : 0.24, 0.06, dur);
    o.start(this.t); lfo.start(this.t);
    o.stop(this.t + dur + 0.3); lfo.stop(this.t + dur + 0.3);

    // breath noise layer
    const n = this._noiseSource(dur, 0.7);
    const nf = this.ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 420;
    nf.Q.value = 0.6;
    const ng = this.ctx.createGain();
    n.connect(nf); nf.connect(ng); ng.connect(this.master);
    this._env(ng, big ? 0.22 : 0.1, 0.1, dur);
    n.stop(this.t + dur + 0.2);
  }

  flame() {
    if (!this.ctx || this._flameOn) return;
    this._flameOn = true;
    const n = this._noiseSource(2.4, 0.9);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 700;
    f.Q.value = 0.5;
    const g = this.ctx.createGain();
    n.connect(f); f.connect(g); g.connect(this.master);
    g.gain.setValueAtTime(0.0001, this.t);
    g.gain.linearRampToValueAtTime(0.3, this.t + 0.15);
    g.gain.setValueAtTime(0.3, this.t + 1.6);
    g.gain.exponentialRampToValueAtTime(0.0001, this.t + 2.1);
    n.stop(this.t + 2.2);
    setTimeout(() => { this._flameOn = false; }, 2000);
  }

  waveHorn() {
    if (!this.ctx) return;
    [0, 0.28].forEach((when, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = i ? 174 : 130;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 900;
      const g = this.ctx.createGain();
      o.connect(f); f.connect(g); g.connect(this.master);
      const t0 = this.t + when;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.18, t0 + 0.08);
      g.gain.setValueAtTime(0.18, t0 + 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
      o.start(t0); o.stop(t0 + 1.0);
    });
  }

  /* ---------------- ambient music bed ---------------- */
  startMusic() {
    if (!this.ctx || this.musicGain) return;
    const g = this.ctx.createGain();
    g.gain.value = 0.0;
    g.connect(this.master);
    this.musicGain = g;

    // slow minor drone: D2, A2, F3
    const freqs = [73.42, 110, 174.61, 220];
    freqs.forEach((fr, i) => {
      const o = this.ctx.createOscillator();
      o.type = i > 1 ? 'triangle' : 'sawtooth';
      o.frequency.value = fr;
      const det = this.ctx.createOscillator();
      det.frequency.value = 0.07 + i * 0.03;
      const detG = this.ctx.createGain();
      detG.gain.value = 0.6 + i;
      det.connect(detG);
      detG.connect(o.frequency);
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 420 + i * 160;
      const vg = this.ctx.createGain();
      vg.gain.value = 0.18 / (i + 1);
      o.connect(f); f.connect(vg); vg.connect(g);
      o.start();
      det.start();
    });
    this.setMusicIntensity(0.25);
  }

  setMusicIntensity(v) {
    if (!this.musicGain) return;
    this.musicGain.gain.setTargetAtTime(0.12 + v * 0.3, this.t, 1.6);
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, Number(v) || 0));
    if (this.master) this.master.gain.value = this.volume;
  }
}
