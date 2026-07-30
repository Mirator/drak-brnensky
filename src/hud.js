import { MAP_SIZE, HALF } from './city.js';

/* The compass strip is 15deg per 60px tick; the visible window is 420px wide. */
const COMPASS_HALF = 210;
const COMPASS_TICK_HALF = 30;

const TAU = Math.PI * 2;
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function wrapAngle(a) { return ((a + Math.PI) % TAU + TAU) % TAU - Math.PI; }

/**
 * All the HUD chrome. Static-ish widgets (score, ammo digits, objective text,
 * toasts, boss bar) are DOM/CSS — cheap to update, cheap to transition. Every
 * frame-reactive effect (vignette/heartbeat, crosshair, hit & kill markers,
 * directional damage, the objective world marker, the ammo/health progress
 * rings) is drawn on one full-screen canvas (`#hud-fx`) so nothing there
 * causes layout/reflow. The one genuinely expensive-per-pixel op (the
 * vignette gradient) is pre-rendered to an offscreen sprite and only
 * regenerated on resize; every frame just blits it.
 */
export class Hud {
  constructor(planCanvas) {
    this.plan = planCanvas;
    this.el = {
      hud: document.getElementById('hud'),
      game: document.getElementById('game'),
      fx: document.getElementById('hud-fx'),
      hpNum: document.getElementById('hp-num'),
      vitalHealth: document.getElementById('vital-health'),
      score: document.getElementById('score'),
      wave: document.getElementById('wave'),
      enemies: document.getElementById('enemies'),
      objective: document.getElementById('objective-text'),
      objectiveDist: document.getElementById('objective-dist'),
      ammoWidget: document.getElementById('ammo-widget'),
      ammoCur: document.getElementById('ammo-cur'),
      ammoMax: document.getElementById('ammo-max'),
      ammoCell: document.getElementById('ammo-cell'),
      reloadHint: document.getElementById('reload-hint'),
      toasts: document.getElementById('toast-stack'),
      compass: document.getElementById('compass-strip'),
      minimap: document.getElementById('minimap-canvas'),
    };
    this.fx = this.el.fx.getContext('2d');
    this.mctx = this.el.minimap.getContext('2d');
    this._buildCompass();
    this._buildBossBar();
    this._lastVals = {};

    // smoothed/derived visual state
    this._hpFrac = 1;
    this._hpDisplay = 1;
    this._vignetteAlpha = 0;
    this._lastHpFrac = 1;
    this._desatUntil = 0;
    this._hitMarkers = [];   // {t0, kind:'hit'|'kill'}
    this._dmgIndicators = []; // {t0, angle}
    this._reloadStart = 0;
    this._reloadActive = false;
    this._lastT = performance.now();
    this._dpr = Math.min(2, window.devicePixelRatio || 1);

    this._resize = this._resize.bind(this);
    window.addEventListener('resize', this._resize);
    this._resize();
  }

  show() { this.el.hud.classList.remove('hidden'); this._resize(); }
  hide() { this.el.hud.classList.add('hidden'); }

  /* ---------------- fx canvas sizing + cached sprites ---------------- */
  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this._w = w; this._h = h;
    this._dpr = Math.min(2, window.devicePixelRatio || 1);
    this.el.fx.width = Math.round(w * this._dpr);
    this.el.fx.height = Math.round(h * this._dpr);
    this.fx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);

    const s = Math.max(0.62, Math.min(1, w / 1280));
    this._scale = s;
    this._crosshairBase = 11 * s;

    // anchor the two progress rings on the actual DOM elements they wrap —
    // measured, not guessed, so they stay correct across every breakpoint
    const vr = this.el.vitalHealth.getBoundingClientRect();
    this._hpAnchor = vr.width
      ? { x: vr.left + vr.width / 2, y: vr.top + vr.height / 2, r: vr.width / 2 + 4 }
      : { x: 64 * s, y: h - 56 * s, r: 25 * s };
    const ar = this.el.ammoCell.getBoundingClientRect();
    this._ammoAnchor = ar.width
      ? { x: ar.left + ar.width / 2, y: ar.top + ar.height / 2, r: Math.max(ar.width, ar.height) / 2 + 5 }
      : { x: w - 64 * s, y: h - 56 * s, r: 30 * s };

    this._buildVignetteSprite();
  }

  _buildVignetteSprite() {
    const w = this._w, h = this._h;
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    const c = off.getContext('2d');
    const g = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.28, w / 2, h / 2, Math.max(w, h) * 0.72);
    g.addColorStop(0, 'rgba(120,0,0,0)');
    g.addColorStop(0.62, 'rgba(120,0,0,0)');
    g.addColorStop(1, 'rgba(140,4,4,0.95)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    this._vignetteSprite = off;
  }

  _buildCompass() {
    const labels = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    let html = '';
    for (let deg = -180; deg <= 540; deg += 15) {
      const d = ((deg % 360) + 360) % 360;
      const label = labels[d] ?? '·';
      html += `<span class="tick${labels[d] ? ' card' : ''}">${label}</span>`;
    }
    this.el.compass.innerHTML = html;
    this.pxPerDeg = 4;
  }

  _buildBossBar() {
    const wrap = document.createElement('div');
    wrap.id = 'boss-bar';
    wrap.innerHTML = `
      <div class="boss-name" id="boss-name">DRAK BRNĚNSKÝ</div>
      <div class="boss-track">
        <div class="boss-segments" id="boss-segments"></div>
        <div class="boss-fill" id="boss-fill"></div>
      </div>
      <div class="boss-phase" id="boss-phase"></div>`;
    this.el.hud.appendChild(wrap);
    this.el.bossWrap = wrap;
    this.el.bossFill = wrap.querySelector('#boss-fill');
    this.el.bossName = wrap.querySelector('#boss-name');
    this.el.bossPhase = wrap.querySelector('#boss-phase');
    this.el.bossSegments = wrap.querySelector('#boss-segments');
    // four phase-segment dividers, purely decorative structure
    this.el.bossSegments.innerHTML = [0.25, 0.5, 0.75].map((p) => `<i style="left:${p * 100}%"></i>`).join('');
    this._bossPhaseText = '';
  }

  setBoss(name, fraction, phaseText) {
    const w = this.el.bossWrap;
    if (w.style.display !== 'block') {
      w.style.display = 'block';
      w.classList.remove('enter'); void w.offsetWidth; w.classList.add('enter');
    }
    this.el.bossName.textContent = name;
    this.el.bossFill.style.transform = `scaleX(${Math.max(0, fraction)})`;
    this.el.bossFill.classList.toggle('critical', fraction < 0.25);
    if (phaseText !== undefined && phaseText !== this._bossPhaseText) {
      this._bossPhaseText = phaseText;
      this.el.bossPhase.textContent = phaseText;
      w.classList.remove('phase-shift'); void w.offsetWidth; w.classList.add('phase-shift');
    }
  }

  hideBoss() { this.el.bossWrap.style.display = 'none'; }

  /* ---------------- per-frame ---------------- */
  update(state) {
    const e = this.el;
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - this._lastT) / 1000));
    this._lastT = now;

    const hpFrac = clamp01(state.health / state.maxHealth);
    this._hpFrac = hpFrac;
    this._hpDisplay += (hpFrac - this._hpDisplay) * Math.min(1, dt * 6);

    // detect a meaningful hit from the raw health delta — no extra wiring needed
    const drop = this._lastHpFrac - hpFrac;
    this._lastHpFrac = hpFrac;
    if (drop > 0.03) {
      const angle = state.hurtDir ? Math.atan2(state.hurtDir.x, state.hurtDir.z) - state.camYaw : Math.random() * TAU;
      this._dmgIndicators.push({ t0: now, angle, mag: Math.min(1, drop * 4) });
      if (drop > 0.08) this._desatUntil = now + 260 + Math.min(400, drop * 900);
    }
    if (this._dmgIndicators.length > 8) this._dmgIndicators.splice(0, this._dmgIndicators.length - 8);

    if (e.game) e.game.classList.toggle('desat', now < this._desatUntil);

    if (this._lastVals.hpNum !== Math.ceil(state.health)) {
      e.hpNum.textContent = Math.ceil(state.health);
      this._lastVals.hpNum = Math.ceil(state.health);
    }
    // the readout fades away once you're safe and full, and reappears on danger
    const danger = hpFrac < 0.3;
    const showHealth = hpFrac < 0.999 || state.hurt > 0.05 || danger;
    e.vitalHealth.style.opacity = showHealth ? 1 : 0;
    e.vitalHealth.classList.toggle('danger', danger);
    this._hpUiAlpha = (this._hpUiAlpha ?? 1) + ((showHealth ? 1 : 0) - (this._hpUiAlpha ?? 1)) * Math.min(1, dt * 6);

    if (this._lastVals.score !== state.score) {
      e.score.textContent = state.score.toLocaleString('cs-CZ');
      this._lastVals.score = state.score;
    }
    if (this._lastVals.wave !== state.wave) {
      e.wave.textContent = state.wave;
      this._lastVals.wave = state.wave;
    }
    if (this._lastVals.enemies !== state.enemies) {
      e.enemies.textContent = state.enemies;
      this._lastVals.enemies = state.enemies;
    }
    if (this._lastVals.ammo !== state.ammo) {
      e.ammoCur.textContent = state.ammo;
      this._lastVals.ammo = state.ammo;
    }
    if (this._lastVals.ammoMax !== state.ammoMax) {
      e.ammoMax.textContent = state.ammoMax;
      this._lastVals.ammoMax = state.ammoMax;
    }
    const lowAmmo = state.ammo <= Math.max(3, state.ammoMax * 0.15);
    e.ammoWidget.classList.toggle('low', lowAmmo && !state.reloading);
    const cellLit = Math.ceil(clamp01(state.ammo / Math.max(1, state.ammoMax)) * 5);
    if (this._lastVals.cellLit !== cellLit) {
      [...e.ammoCell.children].forEach((i, idx) => i.classList.toggle('lit', idx < cellLit));
      this._lastVals.cellLit = cellLit;
    }

    const showReload = state.ammo === 0 || state.reloading;
    if (this._lastVals.reload !== showReload) {
      e.reloadHint.classList.toggle('hidden', !showReload);
      e.reloadHint.textContent = state.reloading ? 'PŘEBÍJENÍ' : 'R — PŘEBÍT';
      this._lastVals.reload = showReload;
    }
    if (!this._reloadActive && state.reloading) { this._reloadActive = true; this._reloadStart = now; }
    if (this._reloadActive && !state.reloading) { this._reloadActive = false; }
    // real progress if the lead wires `reloadFrac` into state; otherwise a
    // timed guess (~1.05s, matching audio.reload()'s total length) so the
    // arc still reads as progress rather than sitting idle.
    this._reloadFrac = state.reloadFrac !== undefined
      ? clamp01(state.reloadFrac)
      : (this._reloadActive ? clamp01((now - this._reloadStart) / 1050) : 0);

    if (this._lastVals.obj !== state.objective) {
      e.objective.textContent = state.objective;
      this._lastVals.obj = state.objective;
    }
    if (this._lastVals.objDist !== state.objectiveDist) {
      e.objectiveDist.textContent = state.objectiveDist;
      this._lastVals.objDist = state.objectiveDist;
    }

    this._state = state;
    this._drawFx(now, dt);

    // compass: put the tick for the current bearing under the needle
    const bearing = (((state.camYaw * 180) / Math.PI + 180) % 360 + 360) % 360;
    const x = COMPASS_HALF - COMPASS_TICK_HALF - (bearing + 180) * this.pxPerDeg;
    e.compass.style.transform = `translateX(${x.toFixed(1)}px)`;
  }

  /* ---------------- fx canvas: vignette, crosshair, markers, rings ---------------- */
  _drawFx(now, dt) {
    const ctx = this.fx;
    const w = this._w, h = this._h;
    const state = this._state;
    ctx.clearRect(0, 0, w, h);

    this._drawVignette(ctx, w, h, now);
    this._drawDamageIndicators(ctx, w, h, now);
    this._drawCrosshair(ctx, w, h, state, now);
    this._drawMarkers(ctx, now);
    this._drawObjectiveMarker(ctx, w, h, state);
    if (this._hpUiAlpha > 0.01) {
      ctx.globalAlpha = this._hpUiAlpha;
      this._drawRing(ctx, this._hpAnchor, this._hpDisplay, 'rgba(255,90,60,0.9)', true);
      ctx.globalAlpha = 1;
    }
    this._drawRing(ctx, this._ammoAnchor, this._reloadFrac, 'rgba(255,179,71,0.95)', this._reloadActive);
    void dt;
  }

  _drawVignette(ctx, w, h, now) {
    const danger = this._hpFrac < 0.3;
    let alpha = (1 - this._hpDisplay) * 0.62 + (this._state.hurt || 0) * 0.5;
    if (danger) {
      const bpm = lerp(70, 130, clamp01((0.3 - this._hpFrac) / 0.3));
      const pulse = 0.5 + 0.5 * Math.sin((now / 1000) * (bpm / 60) * TAU);
      alpha += pulse * 0.18;
    }
    alpha = Math.min(0.92, alpha);
    this._vignetteAlpha += (alpha - this._vignetteAlpha) * 0.18;
    if (this._vignetteAlpha < 0.004) return;
    ctx.globalAlpha = this._vignetteAlpha;
    ctx.drawImage(this._vignetteSprite, 0, 0);
    ctx.globalAlpha = 1;
  }

  _drawDamageIndicators(ctx, w, h, now) {
    const cx = w / 2, cy = h / 2;
    const radius = Math.min(w, h) * 0.38;
    for (let i = this._dmgIndicators.length - 1; i >= 0; i--) {
      const d = this._dmgIndicators[i];
      const age = (now - d.t0) / 900;
      if (age >= 1) { this._dmgIndicators.splice(i, 1); continue; }
      const alpha = (1 - age) * 0.85 * (0.5 + d.mag * 0.5);
      const a = d.angle;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.arc(0, 0, radius, -0.34, 0.34);
      ctx.strokeStyle = `rgba(255,70,50,${alpha})`;
      ctx.lineWidth = 10 * (0.7 + d.mag * 0.5);
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();
    }
  }

  _drawCrosshair(ctx, w, h, state, now) {
    const cx = w / 2, cy = h / 2;
    const target = state.sprinting ? 2.2 : (state.aimingAtEnemy ? 0.85 : 1);
    this._crosshairSpread = lerp(this._crosshairSpread ?? 1, target, 0.22);
    const base = this._crosshairBase;
    const gap = base * this._crosshairSpread;
    const len = base * 0.62;
    const color = state.aimingAtEnemy ? '255,90,70' : '235,232,224';
    ctx.strokeStyle = `rgba(${color},0.92)`;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    [[0, -1], [0, 1], [-1, 0], [1, 0]].forEach(([dx, dy]) => {
      const x0 = cx + dx * gap, y0 = cy + dy * gap;
      const x1 = cx + dx * (gap + len), y1 = cy + dy * (gap + len);
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
    });
    ctx.stroke();
    ctx.fillStyle = state.aimingAtEnemy ? 'rgba(255,120,90,0.95)' : 'rgba(255,179,71,0.9)';
    ctx.beginPath();
    ctx.arc(cx, cy, 1.6, 0, TAU);
    ctx.fill();
    void now;
  }

  _drawMarkers(ctx, now) {
    const w = this._w, h = this._h;
    const cx = w / 2, cy = h / 2;
    for (let i = this._hitMarkers.length - 1; i >= 0; i--) {
      const m = this._hitMarkers[i];
      const age = (now - m.t0) / (m.kind === 'kill' ? 340 : 220);
      if (age >= 1) { this._hitMarkers.splice(i, 1); continue; }
      const scale = m.kind === 'kill' ? lerp(0.55, 1.35, age) : lerp(0.5, 1.15, age);
      const alpha = 1 - Math.pow(age, 1.6);
      const size = (m.kind === 'kill' ? 15 : 10) * this._scale;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.PI / 4);
      ctx.scale(scale, scale);
      ctx.strokeStyle = m.kind === 'kill' ? `rgba(255,120,60,${alpha})` : `rgba(255,255,255,${alpha})`;
      ctx.lineWidth = m.kind === 'kill' ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(-size, 0); ctx.lineTo(-size * 0.35, 0);
      ctx.moveTo(size, 0); ctx.lineTo(size * 0.35, 0);
      ctx.moveTo(0, -size); ctx.lineTo(0, -size * 0.35);
      ctx.moveTo(0, size); ctx.lineTo(0, size * 0.35);
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * Bearing-based world marker: with only camYaw and a direction to the
   * objective (no camera projection matrix in this file), the honest way to
   * place a "diegetic" marker is to project by angle, not by screen-space xy.
   * Needs `state.objectiveDir` ({x,z} unit vector, player→objective) — see
   * report. Degrades to nothing (no marker) when absent.
   */
  _drawObjectiveMarker(ctx, w, h, state) {
    const dir = state.objectiveDir;
    if (!dir) return;
    const bearing = wrapAngle(Math.atan2(dir.x, dir.z) - state.camYaw);
    const cx = w / 2, cy = h * 0.4;
    const onScreen = Math.abs(bearing) < 0.58;
    const edge = Math.min(w, h) * 0.42;
    const x = cx + Math.sin(bearing) * edge;
    const y = onScreen ? cy - Math.cos(bearing) * edge * 0.12 : cy - Math.cos(bearing) * edge * 0.5;
    const pulse = 0.75 + 0.25 * Math.sin(performance.now() / 400);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(onScreen ? Math.PI / 4 : bearing);
    ctx.fillStyle = `rgba(255,179,71,${onScreen ? 0.85 : 0.7 * pulse})`;
    const s = 7 * this._scale;
    ctx.beginPath();
    if (onScreen) {
      ctx.moveTo(0, -s); ctx.lineTo(s, 0); ctx.lineTo(0, s); ctx.lineTo(-s, 0);
    } else {
      ctx.moveTo(0, -s * 1.3); ctx.lineTo(s * 0.8, s * 0.8); ctx.lineTo(-s * 0.8, s * 0.8);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _drawRing(ctx, anchor, frac, color, visible) {
    if (!visible && frac <= 0.001) return;
    const { x, y, r } = anchor;
    ctx.lineWidth = 2.4 * this._scale;
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.stroke();
    if (frac <= 0.001) return;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TAU * clamp01(frac));
    ctx.stroke();
  }

  hit(isKill = false) {
    this._hitMarkers.push({ t0: performance.now(), kind: isKill ? 'kill' : 'hit' });
  }

  toast(text, cls = '') {
    const d = document.createElement('div');
    d.className = `toast ${cls}`;
    d.textContent = text;
    this.el.toasts.appendChild(d);
    setTimeout(() => d.remove(), 3200);
  }

  /* ---------------- minimap ---------------- */
  drawMinimap(player, camYaw, enemies, markers, rifts) {
    const ctx = this.mctx;
    const S = this.el.minimap.width;
    const zoom = 0.42; // pixels per world metre
    const now = performance.now();
    ctx.save();
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#0a0c10';
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2, 0, TAU);
    ctx.fill();

    const theta = Math.PI - camYaw;
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.rotate(theta);
    ctx.scale(zoom, zoom);
    ctx.translate(-player.pos.x, -player.pos.z);

    ctx.globalAlpha = 0.85;
    ctx.drawImage(this.plan, -HALF, -HALF, MAP_SIZE, MAP_SIZE);
    ctx.globalAlpha = 1;

    // rifts: soft pulsing rings
    const pulse = 0.6 + 0.4 * Math.sin(now / 260);
    for (const r of rifts) {
      ctx.fillStyle = `rgba(255,90,42,${0.75 * pulse})`;
      ctx.beginPath();
      ctx.arc(r.pos.x, r.pos.z, 8, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = `rgba(255,120,60,${0.4 * pulse})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(r.pos.x, r.pos.z, 15 + pulse * 3, 0, TAU);
      ctx.stroke();
    }

    // enemies: directional chevrons rather than dots
    for (const en of enemies) {
      if (en.hp <= 0) continue;
      const boss = en.typeId === 'boss';
      const color = boss ? '#ff2a1a' : en.typeId === 'golem' ? '#ffa040' : '#ff6b6b';
      const size = boss ? 13 : 5.5;
      const heading = en.facing ?? 0;
      ctx.save();
      ctx.translate(en.pos.x, en.pos.z);
      ctx.rotate(-heading);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, -size); ctx.lineTo(size * 0.72, size * 0.6); ctx.lineTo(0, size * 0.25); ctx.lineTo(-size * 0.72, size * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    for (const mk of markers) {
      ctx.strokeStyle = '#ffb347';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(mk.x, mk.z, 11, 0, TAU);
      ctx.stroke();
    }

    ctx.restore();

    // player arrow (always up, centred)
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.fillStyle = '#f2ede4';
    ctx.strokeStyle = '#0b0d10';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6.5, 8);
    ctx.lineTo(0, 4.5);
    ctx.lineTo(-6.5, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // soft edge falloff instead of a hard ring
    const edge = ctx.createRadialGradient(S / 2, S / 2, S * 0.36, S / 2, S / 2, S / 2);
    edge.addColorStop(0, 'rgba(5,6,8,0)');
    edge.addColorStop(1, 'rgba(5,6,8,0.9)');
    ctx.fillStyle = edge;
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2, 0, TAU);
    ctx.fill();

    const nAngle = theta - Math.PI / 2;
    ctx.fillStyle = 'rgba(125,227,255,0.9)';
    ctx.beginPath();
    ctx.arc(S / 2 + Math.cos(nAngle) * (S / 2 - 12), S / 2 + Math.sin(nAngle) * (S / 2 - 12), 3.5, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}
