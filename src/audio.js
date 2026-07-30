/**
 * All sound is synthesised at runtime — no asset downloads, no decoded media.
 *
 * Signal flow
 * -----------
 *   one-shot voice --dry--> localBus \
 *                  --wet--> reverbSend -> convolver -> reverbReturn -> master -> comp -> limiter -> destination
 *   worldBus (occlusion-aware) -------> localBus
 *   music (ambient+tension+combat+boss stems) -> musicBus -> master
 *
 * `_voice()` is the one shared plumbing helper every one-shot routes through: it
 * optionally drops the sound behind a PannerNode (only if the caller passes
 * `opts.pos`), optionally darkens it for occlusion (`opts.occluded` 0..1), and
 * always bleeds a bit of signal to the convolver reverb send so everything sits
 * in the same synthesised "room" as the current zone (see `setZone`).
 *
 * Every method that main.js already calls keeps its exact call signature working
 * — new parameters are appended with safe defaults. See the bottom of this file
 * for a summary of the optional hooks a lead can wire up for the full effect
 * (surface names, positions, listener orientation, zone/occlusion) — none of it
 * is required for the game to run and sound correct today.
 */

const SURFACES = {
  stone:   { impF: 1500, impQ: 1.2, impType: 'lowpass',  impDecay: 0.09, stepF: 260, stepDecay: 0.055, rate: 1.00, bright: 1.00 },
  asphalt: { impF: 900,  impQ: 0.9, impType: 'lowpass',  impDecay: 0.11, stepF: 180, stepDecay: 0.065, rate: 0.85, bright: 0.70 },
  cobble:  { impF: 1800, impQ: 1.6, impType: 'bandpass', impDecay: 0.08, stepF: 320, stepDecay: 0.050, rate: 1.10, bright: 1.10, double: true },
  wood:    { impF: 700,  impQ: 3.0, impType: 'bandpass', impDecay: 0.14, stepF: 240, stepDecay: 0.085, rate: 0.95, bright: 0.90, ring: true, ringFreq: 1.7 },
  metal:   { impF: 2600, impQ: 6.0, impType: 'bandpass', impDecay: 0.30, stepF: 500, stepDecay: 0.140, rate: 1.00, bright: 1.30, ring: true, ringFreq: 2.3 },
  glass:   { impF: 4200, impQ: 8.0, impType: 'bandpass', impDecay: 0.34, stepF: 900, stepDecay: 0.180, rate: 1.30, bright: 1.50, ring: true, ringFreq: 3.1, shimmer: true },
  grass:   { impF: 500,  impQ: 0.5, impType: 'lowpass',  impDecay: 0.05, stepF: 140, stepDecay: 0.050, rate: 0.80, bright: 0.50, soft: true },
};
SURFACES.default = SURFACES.stone;

const ZONES = {
  // name: [duration, decay, earlyReflections[{t,g}], wetLevel, damp(lowpass Hz)]
  street:    { dur: 0.9,  decay: 3.4, taps: [[0.006, 0.35], [0.017, 0.22]], wet: 0.10, damp: 4200 },
  square:    { dur: 1.8,  decay: 2.2, taps: [[0.02, 0.20], [0.05, 0.14]], wet: 0.16, damp: 5200 },
  gatehouse: { dur: 1.4,  decay: 4.5, taps: [[0.008, 0.5], [0.02, 0.4], [0.045, 0.3]], wet: 0.24, damp: 2600 },
  cathedral: { dur: 3.2,  decay: 3.0, taps: [[0.015, 0.3], [0.04, 0.28], [0.09, 0.22]], wet: 0.32, damp: 3400 },
};

// D (natural-minor-with-raised-4th, i.e. Dorian-leaning "Moravian" flavour) — kept sparse.
const MODE = [146.83, 164.81, 185.00, 207.65, 220.00, 246.94, 277.18, 293.66]; // D E F# G A B C D (Dorian-ish)
const MODE_LOW = MODE.map((f) => f / 2);

function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.musicGain = null;
    this._noise = null;
    this.volume = 0.55;
    this._zone = 'street';
    this._occlusionGlobal = 0;
    this._flameOn = false;
    this._bossMode = false;
    this._musicIntensity = 0;
    this._timers = [];
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    const ctx = this.ctx;

    // ---- master bus: gentle glue compressor feeding a hard brickwall limiter ----
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 18; comp.ratio.value = 4;
    comp.attack.value = 0.004; comp.release.value = 0.25;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20;
    limiter.attack.value = 0.001; limiter.release.value = 0.08;
    this.master.connect(comp); comp.connect(limiter); limiter.connect(ctx.destination);

    // ---- local (player-attached, never occluded) vs world (occludable) bus ----
    this.localBus = ctx.createGain(); this.localBus.gain.value = 1;
    this.worldBus = ctx.createGain(); this.worldBus.gain.value = 1;
    this._worldOcclusionFilter = ctx.createBiquadFilter();
    this._worldOcclusionFilter.type = 'lowpass';
    this._worldOcclusionFilter.frequency.value = 18000;
    this.worldBus.connect(this._worldOcclusionFilter);
    this._worldOcclusionFilter.connect(this.master);
    this.localBus.connect(this.master);

    // ---- procedural convolution reverb, buffer swapped per zone ----
    this.convolver = ctx.createConvolver();
    this.reverbSend = ctx.createGain(); this.reverbSend.gain.value = 0.2;
    this.reverbReturn = ctx.createGain(); this.reverbReturn.gain.value = 1;
    this.reverbSend.connect(this.convolver);
    this.convolver.connect(this.reverbReturn);
    this.reverbReturn.connect(this.master);
    this._zoneBuffers = {};
    for (const name of Object.keys(ZONES)) this._zoneBuffers[name] = this._buildImpulse(ZONES[name]);
    this.setZone('street');

    // shared noise buffer (2s, looped with a random start offset per voice)
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noise = buf;

    this.startMusic();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  get t() { return this.ctx.currentTime; }

  /* ---------------- procedural reverb ---------------- */
  _buildImpulse({ dur, decay, taps }) {
    const ctx = this.ctx;
    const rate = ctx.sampleRate;
    const len = Math.max(1, Math.floor(dur * rate));
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const n = Math.random() * 2 - 1;
        d[i] = n * Math.pow(1 - i / len, decay);
      }
      // stamp in a couple of discrete early reflections so small spaces read
      // as spaces rather than as generic fuzz
      for (const [tt, g] of taps) {
        const idx = Math.floor(tt * rate);
        if (idx < len) d[idx] += (ch === 0 ? 1 : -1) * g * 0.6;
      }
    }
    return buf;
  }

  /** Switch reverb character: 'street' | 'square' | 'gatehouse' | 'cathedral'. */
  setZone(name) {
    const z = ZONES[name] || ZONES.street;
    this._zone = ZONES[name] ? name : 'street';
    if (!this.ctx) return;
    this.convolver.buffer = this._zoneBuffers[this._zone];
    this.reverbSend.gain.setTargetAtTime(z.wet, this.t, 0.6);
    this._reverbDamp = z.damp;
  }

  /** 0 (clear line of sight) .. 1 (fully occluded) low-pass + attenuate world sfx. */
  setOcclusion(amount) {
    this._occlusionGlobal = clamp01(amount);
    if (!this.ctx) return;
    const f = lerp(18000, 700, this._occlusionGlobal);
    this._worldOcclusionFilter.frequency.setTargetAtTime(f, this.t, 0.08);
    this.worldBus.gain.setTargetAtTime(lerp(1, 0.5, this._occlusionGlobal), this.t, 0.08);
  }

  /** Optional per-frame hook: position/orient the AudioListener for PannerNode voices. */
  updateListener(pos, forward = { x: 0, z: -1 }, up = { x: 0, y: 1, z: 0 }) {
    if (!this.ctx || !pos) return;
    const l = this.ctx.listener;
    const t = this.t;
    if (l.positionX) {
      l.positionX.setTargetAtTime(pos.x, t, 0.05);
      l.positionY.setTargetAtTime(pos.y ?? 1.6, t, 0.05);
      l.positionZ.setTargetAtTime(pos.z, t, 0.05);
      l.forwardX.setTargetAtTime(forward.x, t, 0.05);
      l.forwardY.setTargetAtTime(forward.y || 0, t, 0.05);
      l.forwardZ.setTargetAtTime(forward.z, t, 0.05);
      l.upX.setValueAtTime(up.x, t); l.upY.setValueAtTime(up.y, t); l.upZ.setValueAtTime(up.z, t);
    } else if (l.setPosition) {
      l.setPosition(pos.x, pos.y ?? 1.6, pos.z);
      l.setOrientation(forward.x, forward.y || 0, forward.z, up.x, up.y, up.z);
    }
  }

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

  /**
   * Shared exit plumbing for a one-shot voice: optional 3D position (PannerNode),
   * optional per-call occlusion, always a reverb send. Returns the node to
   * connect the voice's final gain stage into.
   *   opts: { pos:{x,y,z}, occluded:0..1, world:false, send:0..1 }
   */
  _voice(opts = {}) {
    const ctx = this.ctx;
    let node = opts.world ? this.worldBus : this.localBus;
    let head = null;
    if (opts.occluded) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lerp(18000, 900, clamp01(opts.occluded));
      f.connect(node);
      node = f;
      head = head || f;
    }
    if (opts.pos) {
      const p = ctx.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = 6;
      p.maxDistance = 180;
      p.rolloffFactor = 1;
      if (p.positionX) { p.positionX.value = opts.pos.x; p.positionY.value = opts.pos.y ?? 1; p.positionZ.value = opts.pos.z; }
      else if (p.setPosition) p.setPosition(opts.pos.x, opts.pos.y ?? 1, opts.pos.z);
      p.connect(node);
      node = p;
      head = head || p;
    }
    const send = ctx.createGain();
    send.gain.value = opts.send ?? 0.16;
    // fan the same signal to both the dry chain (node) and the reverb send
    const fanIn = ctx.createGain();
    fanIn.connect(node);
    fanIn.connect(send);
    send.connect(this.reverbSend);
    return fanIn;
  }

  /* ---------------- weapon: plasma thrower, layered ---------------- */
  shoot(vol = 0.5, opts = {}) {
    if (!this.ctx) return;
    const t = this.t;
    const jitter = 0.94 + Math.random() * 0.12; // per-shot pitch/timbre variance
    const out = this._voice(opts);

    // transient click (2-3ms of bright noise) — reads as the trigger snapping
    const click = this._noiseSource(0.02, 3.2 * jitter);
    const cf = this.ctx.createBiquadFilter();
    cf.type = 'highpass'; cf.frequency.value = 5200;
    const cg = this.ctx.createGain();
    click.connect(cf); cf.connect(cg); cg.connect(out);
    this._env(cg, 0.18 * vol, 0.001, 0.02);
    click.stop(t + 0.05);

    // body: bandpass noise sweep, the "plasma" character
    const n = this._noiseSource(0.2, 1.5 * jitter);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(1800 * jitter, t);
    f.frequency.exponentialRampToValueAtTime(400, t + 0.14);
    f.Q.value = 1.4;
    const g = this.ctx.createGain();
    n.connect(f); f.connect(g); g.connect(out);
    this._env(g, 0.30 * vol, 0.003, 0.13);
    n.stop(t + 0.22);

    // tonal body layer
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(760 * jitter, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.12);
    const og = this.ctx.createGain();
    o.connect(og); og.connect(out);
    this._env(og, 0.20 * vol, 0.002, 0.11);
    o.start(t); o.stop(t + 0.2);

    // sub thump — the weight
    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(70 * jitter, t);
    sub.frequency.exponentialRampToValueAtTime(38, t + 0.08);
    const sg = this.ctx.createGain();
    sub.connect(sg); sg.connect(out);
    this._env(sg, 0.22 * vol, 0.001, 0.09);
    sub.start(t); sub.stop(t + 0.12);
  }

  dryFire() {
    if (!this.ctx) return;
    const out = this._voice();
    for (const [when, freq] of [[0, 220], [0.045, 170]]) {
      const o = this.ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = freq;
      const g = this.ctx.createGain();
      o.connect(g); g.connect(out);
      this._env(g, 0.11, 0.001, 0.035, when);
      o.start(this.t + when); o.stop(this.t + when + 0.06);
    }
  }

  /** Mechanical multi-stage reload: eject, insert cell, charge, ready. */
  reload() {
    if (!this.ctx) return;
    const out = this._voice();
    const t = this.t;

    // stage 1: eject — sharp noise clack
    this._clack(out, t + 0.0, 2600, 0.16, 0.05);
    // stage 2: insert new cell — duller thunk
    this._clack(out, t + 0.30, 900, 0.20, 0.08);
    // stage 3: charge — rising energy-cell whine
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(180, t + 0.5);
    o.frequency.exponentialRampToValueAtTime(640, t + 0.86);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 1400;
    const g = this.ctx.createGain();
    o.connect(f); f.connect(g); g.connect(out);
    g.gain.setValueAtTime(0.0001, t + 0.5);
    g.gain.linearRampToValueAtTime(0.12, t + 0.72);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.start(t + 0.5); o.stop(t + 0.92);
    // stage 4: ready chime
    const chime = this.ctx.createOscillator();
    chime.type = 'triangle'; chime.frequency.value = 880;
    const cg = this.ctx.createGain();
    chime.connect(cg); cg.connect(out);
    this._env(cg, 0.13, 0.004, 0.14, 0.9);
    chime.start(t + 0.9); chime.stop(t + 1.06);
  }

  _clack(out, t0, freq, vol, decay) {
    const n = this._noiseSource(decay + 0.03, 1);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.1;
    const g = this.ctx.createGain();
    n.connect(f); f.connect(g); g.connect(out);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
    n.stop(t0 + decay + 0.05);
  }

  /* ---------------- surface-aware impacts ---------------- */
  hit(vol = 0.4, surface = 'default', opts = {}) {
    if (!this.ctx) return;
    const s = SURFACES[surface] || SURFACES.default;
    const t = this.t;
    const out = this._voice({ ...opts, world: opts.world ?? true });

    const n = this._noiseSource(s.impDecay + 0.05, 0.75 + Math.random() * 0.15);
    const f = this.ctx.createBiquadFilter();
    f.type = s.impType; f.frequency.value = s.impF; f.Q.value = s.impQ;
    const g = this.ctx.createGain();
    n.connect(f); f.connect(g); g.connect(out);
    this._env(g, 0.30 * vol * s.bright, 0.002, s.impDecay);
    n.stop(t + s.impDecay + 0.08);

    if (s.double) this._clack(out, t + 0.03, s.impF * 0.8, 0.16 * vol, s.impDecay * 0.6);

    if (s.ring) {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = s.impF * s.ringFreq * 0.18;
      const rg = this.ctx.createGain();
      o.connect(rg); rg.connect(out);
      this._env(rg, 0.16 * vol, 0.002, s.impDecay * (s.shimmer ? 2.4 : 1.6));
      o.start(t); o.stop(t + s.impDecay * 2.6);
    }
  }

  kill() {
    if (!this.ctx) return;
    const out = this._voice();
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(420, this.t);
    o.frequency.exponentialRampToValueAtTime(70, this.t + 0.3);
    const g = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1200;
    o.connect(f); f.connect(g); g.connect(out);
    this._env(g, 0.2, 0.005, 0.3);
    o.start(this.t); o.stop(this.t + 0.4);
    // faint high confirm tick, restrained (not a jingle)
    const c = this.ctx.createOscillator();
    c.type = 'sine'; c.frequency.value = 1760;
    const cg = this.ctx.createGain();
    c.connect(cg); cg.connect(out);
    this._env(cg, 0.05, 0.001, 0.05, 0.02);
    c.start(this.t + 0.02); c.stop(this.t + 0.09);
  }

  explosion(vol = 1, opts = {}) {
    if (!this.ctx) return;
    const out = this._voice({ ...opts, world: opts.world ?? true, send: 0.28 });
    const n = this._noiseSource(0.9, 0.55);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1400, this.t);
    f.frequency.exponentialRampToValueAtTime(120, this.t + 0.7);
    const g = this.ctx.createGain();
    n.connect(f); f.connect(g); g.connect(out);
    this._env(g, 0.5 * vol, 0.006, 0.75);

    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, this.t);
    o.frequency.exponentialRampToValueAtTime(28, this.t + 0.6);
    const og = this.ctx.createGain();
    o.connect(og); og.connect(out);
    this._env(og, 0.45 * vol, 0.01, 0.6);
    o.start(this.t); o.stop(this.t + 0.8);
    n.stop(this.t + 1.0);
  }

  hurt() {
    if (!this.ctx) return;
    const out = this._voice();
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(150, this.t);
    o.frequency.exponentialRampToValueAtTime(60, this.t + 0.25);
    const g = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 700;
    o.connect(f); f.connect(g); g.connect(out);
    this._env(g, 0.34, 0.004, 0.26);
    o.start(this.t); o.stop(this.t + 0.35);
  }

  /* ---------------- footsteps: surface, speed, L/R alternation ---------------- */
  step(i = 0, opts = {}) {
    if (!this.ctx) return;
    const surface = opts.surface || 'default';
    const speed = opts.speed ?? 1;
    const s = SURFACES[surface] || SURFACES.default;
    const t = this.t;

    const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    let out = this._voice({ world: true, send: 0.08 });
    if (pan) { pan.pan.value = (i % 2 === 0 ? -1 : 1) * 0.18; pan.connect(out); out = pan; }

    const n = this._noiseSource(s.stepDecay + 0.04, s.rate * (0.85 + speed * 0.2) * (0.94 + Math.random() * 0.12));
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = s.stepF * (0.95 + Math.random() * 0.1); f.Q.value = s.soft ? 0.6 : 0.95;
    const g = this.ctx.createGain();
    n.connect(f); f.connect(g); g.connect(out);
    this._env(g, (0.06 + speed * 0.05) * s.bright, 0.002, s.stepDecay);
    n.stop(t + s.stepDecay + 0.08);

    if (opts.scuff) {
      const sn = this._noiseSource(0.09, 2.4);
      const sf = this.ctx.createBiquadFilter();
      sf.type = 'highpass'; sf.frequency.value = 2800;
      const sg = this.ctx.createGain();
      sn.connect(sf); sf.connect(sg); sg.connect(out);
      this._env(sg, 0.08, 0.002, 0.08);
      sn.stop(t + 0.12);
    }
  }

  jump() {
    if (!this.ctx) return;
    const out = this._voice();
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(260, this.t);
    o.frequency.exponentialRampToValueAtTime(480, this.t + 0.12);
    const g = this.ctx.createGain();
    o.connect(g); g.connect(out);
    this._env(g, 0.1, 0.004, 0.1);
    o.start(this.t); o.stop(this.t + 0.2);

    const n = this._noiseSource(0.06, 1.8);
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 1200;
    const ng = this.ctx.createGain();
    n.connect(f); f.connect(ng); ng.connect(out);
    this._env(ng, 0.05, 0.001, 0.05);
    n.stop(this.t + 0.08);
  }

  dash() {
    if (!this.ctx) return;
    const out = this._voice();
    const n = this._noiseSource(0.3, 2.2);
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.setValueAtTime(400, this.t);
    f.frequency.exponentialRampToValueAtTime(2600, this.t + 0.22);
    const g = this.ctx.createGain();
    n.connect(f); f.connect(g); g.connect(out);
    this._env(g, 0.16, 0.004, 0.22);
    n.stop(this.t + 0.32);
  }

  pickup() {
    if (!this.ctx) return;
    const out = this._voice({ send: 0.06 });
    [660, 880, 1320].forEach((fr, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = fr;
      const g = this.ctx.createGain();
      o.connect(g); g.connect(out);
      const t0 = this.t + i * 0.055;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.12, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
      o.start(t0); o.stop(t0 + 0.18);
    });
  }

  /* ---------------- creature voices ---------------- */
  roar(big = true, kind, opts = {}) {
    if (!this.ctx) return;
    const k = kind || (big ? 'boss' : 'whelp');
    const out = this._voice({ ...opts, world: opts.world ?? true, send: 0.24 });
    const t = this.t;

    if (k === 'whelp') {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(950, t);
      o.frequency.exponentialRampToValueAtTime(420, t + 0.18);
      const g = this.ctx.createGain();
      const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 2;
      o.connect(f); f.connect(g); g.connect(out);
      this._env(g, 0.22, 0.005, 0.2);
      o.start(t); o.stop(t + 0.3);
      return;
    }
    if (k === 'spitter') {
      const n = this._noiseSource(0.4, 1.6);
      const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2200; f.Q.value = 3.5;
      const dist = this._distortion(1.8);
      const g = this.ctx.createGain();
      n.connect(f); f.connect(dist); dist.connect(g); g.connect(out);
      this._env(g, 0.22, 0.02, 0.35);
      n.stop(t + 0.5);
      return;
    }
    if (k === 'golem') {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(56, t);
      o.frequency.exponentialRampToValueAtTime(38, t + 0.9);
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
      const dist = this._distortion(3.5);
      const g = this.ctx.createGain();
      o.connect(f); f.connect(dist); dist.connect(g); g.connect(out);
      this._env(g, 0.32, 0.05, 0.9);
      o.start(t); o.stop(t + 1.0);
      const n = this._noiseSource(0.8, 0.4);
      const nf = this.ctx.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 300;
      const ng = this.ctx.createGain();
      n.connect(nf); nf.connect(ng); ng.connect(out);
      this._env(ng, 0.14, 0.05, 0.8);
      n.stop(t + 0.9);
      return;
    }

    // boss: the dragon — layered, long, a sub component you feel
    const dur = 1.9;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(62 * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(62, t + dur * 0.6);
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 7;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 22;
    lfo.connect(lfoGain); lfoGain.connect(o.frequency);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1800, t);
    f.frequency.exponentialRampToValueAtTime(300, t + dur);
    const dist = this._distortion(3.2);
    const g = this.ctx.createGain();
    o.connect(f); f.connect(dist); dist.connect(g); g.connect(out);
    this._env(g, 0.5, 0.06, dur);
    o.start(t); lfo.start(t);
    o.stop(t + dur + 0.3); lfo.stop(t + dur + 0.3);

    // sub component — the part you feel more than hear
    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(46, t);
    sub.frequency.exponentialRampToValueAtTime(30, t + dur);
    const subG = this.ctx.createGain();
    sub.connect(subG); subG.connect(out);
    this._env(subG, 0.4, 0.08, dur * 0.9);
    sub.start(t); sub.stop(t + dur);

    // breath noise layer
    const n = this._noiseSource(dur, 0.7);
    const nf = this.ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 420;
    nf.Q.value = 0.6;
    const ng = this.ctx.createGain();
    n.connect(nf); nf.connect(ng); ng.connect(out);
    this._env(ng, 0.22, 0.1, dur);
    n.stop(t + dur + 0.2);
  }

  _distortion(amount = 2) {
    const dist = this.ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 128) - 1;
      curve[i] = Math.tanh(x * amount);
    }
    dist.curve = curve;
    return dist;
  }

  flame() {
    if (!this.ctx || this._flameOn) return;
    this._flameOn = true;
    const out = this._voice({ world: true, send: 0.2 });
    const n = this._noiseSource(2.4, 0.9);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 700;
    f.Q.value = 0.5;
    const g = this.ctx.createGain();
    n.connect(f); f.connect(g); g.connect(out);
    g.gain.setValueAtTime(0.0001, this.t);
    g.gain.linearRampToValueAtTime(0.3, this.t + 0.15);
    g.gain.setValueAtTime(0.3, this.t + 1.6);
    g.gain.exponentialRampToValueAtTime(0.0001, this.t + 2.1);
    n.stop(this.t + 2.2);
    const timer = setTimeout(() => { this._flameOn = false; }, 2000);
    this._timers.push(timer);
  }

  waveHorn() {
    if (!this.ctx) return;
    const out = this._voice({ send: 0.22 });
    [0, 0.28, 0.56].forEach((when, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = [130, 174.61, 220][i];
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 900;
      const g = this.ctx.createGain();
      o.connect(f); f.connect(g); g.connect(out);
      const t0 = this.t + when;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(i === 2 ? 0.08 : 0.18, t0 + 0.08);
      g.gain.setValueAtTime(i === 2 ? 0.08 : 0.18, t0 + 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
      o.start(t0); o.stop(t0 + 1.0);
    });
  }

  /* ---------------- adaptive music: ambient / tension / combat / boss ---------------- */
  startMusic() {
    if (!this.ctx || this.musicGain) return;
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 0.0;
    g.connect(this.master);
    this.musicGain = g;

    this.ambientGain = ctx.createGain(); this.ambientGain.gain.value = 0.9;
    this.tensionGain = ctx.createGain(); this.tensionGain.gain.value = 0.0;
    this.combatGain = ctx.createGain(); this.combatGain.gain.value = 0.0;
    this.ambientGain.connect(g); this.tensionGain.connect(g); this.combatGain.connect(g);

    // ambient bed: slow modal drone (D2, A2, F#3, D4) — always on
    const freqs = [MODE_LOW[0], MODE_LOW[4], MODE[2], MODE[7] / 2];
    freqs.forEach((fr, i) => {
      const o = ctx.createOscillator();
      o.type = i > 1 ? 'triangle' : 'sawtooth';
      o.frequency.value = fr;
      const det = ctx.createOscillator();
      det.frequency.value = 0.07 + i * 0.03;
      const detG = ctx.createGain();
      detG.gain.value = 0.6 + i;
      det.connect(detG); detG.connect(o.frequency);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 420 + i * 160;
      const vg = ctx.createGain();
      vg.gain.value = 0.18 / (i + 1);
      o.connect(f); f.connect(vg); vg.connect(this.ambientGain);
      o.start(); det.start();
    });

    // sparse Moravian-modal melodic fragments, gated by tension
    this._scheduleModalNotes();
    // driving combat ostinato, gated by combat/boss
    this._scheduleOstinato();

    this.setMusicIntensity(0.25);
  }

  _scheduleModalNotes() {
    const fire = () => {
      if (!this.ctx) return;
      const t = this.t;
      const fr = pick(MODE);
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = fr;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 1600;
      const g = this.ctx.createGain();
      o.connect(f); f.connect(g); g.connect(this.tensionGain);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.16, t + 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
      o.start(t); o.stop(t + 2.7);
      const timer = setTimeout(fire, 2200 + Math.random() * 2600);
      this._timers.push(timer);
    };
    const first = setTimeout(fire, 1500);
    this._timers.push(first);
  }

  _scheduleOstinato() {
    let step = 0;
    const fire = () => {
      if (!this.ctx) return;
      const t = this.t;
      const scale = this._bossMode ? [MODE_LOW[0], MODE_LOW[2], MODE_LOW[3], MODE_LOW[0]] : [MODE_LOW[0], MODE_LOW[0], MODE_LOW[4] / 2, MODE_LOW[0]];
      const fr = scale[step % scale.length];
      step++;
      const o = this.ctx.createOscillator();
      o.type = this._bossMode ? 'sawtooth' : 'square';
      o.frequency.value = fr;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = this._bossMode ? 900 : 500;
      const g = this.ctx.createGain();
      o.connect(f); f.connect(g); g.connect(this.combatGain);
      const dur = this._bossMode ? 0.22 : 0.28;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.2, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur + 0.02);
      const interval = this._bossMode ? 210 : 320;
      const timer = setTimeout(fire, interval);
      this._timers.push(timer);
    };
    const first = setTimeout(fire, 400);
    this._timers.push(first);
  }

  /** Crossfades the four stems musically rather than just riding a single gain. */
  setMusicIntensity(v) {
    this._musicIntensity = clamp01(v);
    if (!this.musicGain) return;
    const t = this.t;
    const tension = 0.30 * (v < 0.55 ? v / 0.55 : Math.max(0, 1 - (v - 0.55) / 0.45));
    const combat = v < 0.3 ? 0 : Math.min(1, (v - 0.3) / 0.55);
    const ambientDuck = lerp(0.9, 0.5, Math.min(1, v / 0.8));
    this.ambientGain.gain.setTargetAtTime(ambientDuck, t, 1.4);
    this.tensionGain.gain.setTargetAtTime(tension, t, 1.2);
    this.combatGain.gain.setTargetAtTime(combat * 0.7, t, 0.9);
    this.musicGain.gain.setTargetAtTime(0.14 + v * 0.22, t, 1.6);

    const wasBoss = this._bossMode;
    this._bossMode = v >= 0.85;
    if (this._bossMode && !wasBoss) this._bossSting();
  }

  _bossSting() {
    const out = this._voice({ send: 0.3 });
    const t = this.t;
    [220, 277.18, 349.23].forEach((fr, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = fr;
      const g = this.ctx.createGain();
      o.connect(g); g.connect(out);
      this._env(g, 0.14, 0.01, 0.9, i * 0.03);
      o.start(t + i * 0.03); o.stop(t + 1.0);
    });
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, Number(v) || 0));
    if (this.master) this.master.gain.value = this.volume;
  }
}

/*
 * Optional wiring for the lead (all additive, nothing above requires these):
 *
 * 1. Surfaces — pass the surface name under the hit/foot point as the new
 *    trailing arg: `audio.hit(vol, surfaceName)`, `audio.step(i, { surface, speed })`.
 *    Valid names: stone, asphalt, cobble, wood, metal, glass, grass.
 *
 * 2. Positioning — pass `{ pos: {x,y,z} }` in opts on shoot/hit/explosion/roar/flame
 *    for enemy-originated or distant sounds so they pan/attenuate via PannerNode,
 *    and call `audio.updateListener(camera.position, forwardVector)` once per
 *    frame from the render loop so the listener tracks the player/camera.
 *
 * 3. Occlusion — either call `audio.setOcclusion(0..1)` globally from a cheap
 *    raycast between listener and the loudest active source, or pass
 *    `{ occluded: 0..1 }` per call for per-source occlusion.
 *
 * 4. Zones — call `audio.setZone('square' | 'street' | 'gatehouse' | 'cathedral')`
 *    when the player crosses into those areas (landmark bounding boxes already
 *    exist in city.js/landmarks.js).
 *
 * 5. Creature voices — `audio.roar(false, 'whelp' | 'spitter' | 'golem')` on
 *    enemy aggro/attack per archetype; today only the boss ever calls roar().
 */
