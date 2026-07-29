import { MAP_SIZE, HALF } from './city.js';

/* The compass strip is 15deg per 60px tick; the visible window is 420px wide. */
const COMPASS_HALF = 210;
const COMPASS_TICK_HALF = 30;

/**
 * All the DOM-side chrome: bars, ammo, compass, minimap, toasts, boss bar.
 */
export class Hud {
  constructor(planCanvas) {
    this.plan = planCanvas;
    this.el = {
      hud: document.getElementById('hud'),
      hp: document.getElementById('hp-fill'),
      st: document.getElementById('st-fill'),
      score: document.getElementById('score'),
      wave: document.getElementById('wave'),
      enemies: document.getElementById('enemies'),
      objective: document.getElementById('objective-text'),
      objectiveDist: document.getElementById('objective-dist'),
      ammo: document.getElementById('ammo'),
      ammoCur: document.getElementById('ammo-cur'),
      ammoMax: document.getElementById('ammo-max'),
      reloadHint: document.getElementById('reload-hint'),
      crosshair: document.getElementById('crosshair'),
      hitmarker: document.getElementById('hitmarker'),
      vignette: document.getElementById('damage-vignette'),
      toasts: document.getElementById('toast-stack'),
      compass: document.getElementById('compass-strip'),
      minimap: document.getElementById('minimap-canvas'),
    };
    this.mctx = this.el.minimap.getContext('2d');
    this._buildCompass();
    this._buildBossBar();
    this._lastVals = {};
    this._hitTimer = null;
  }

  show() { this.el.hud.classList.remove('hidden'); }
  hide() { this.el.hud.classList.add('hidden'); }

  _buildCompass() {
    const labels = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    let html = '';
    for (let deg = -180; deg <= 540; deg += 15) {
      const d = ((deg % 360) + 360) % 360;
      const label = labels[d] ?? '·';
      html += `<span class="tick${labels[d] ? ' card' : ''}">${label}</span>`;
    }
    this.el.compass.innerHTML = html;
    // each tick is 60px wide => 15deg per 60px => 4px per degree
    this.pxPerDeg = 4;
  }

  _buildBossBar() {
    const wrap = document.createElement('div');
    wrap.id = 'boss-bar';
    wrap.style.cssText = `
      position:absolute; left:50%; bottom:96px; transform:translateX(-50%);
      width:min(620px,70vw); text-align:center; display:none;`;
    wrap.innerHTML = `
      <div style="font-size:12px;letter-spacing:0.34em;color:#ff8a5a;font-weight:700" id="boss-name">DRAK BRNĚNSKÝ</div>
      <div style="height:12px;margin-top:5px;background:rgba(10,12,16,0.6);border:1px solid rgba(255,120,80,0.45);
                  clip-path:polygon(0 0,100% 0,calc(100% - 8px) 100%,0 100%);position:relative;overflow:hidden">
        <div id="boss-fill" style="position:absolute;inset:0;transform-origin:left center;
             background:linear-gradient(90deg,#ff2a1a,#ffb347)"></div>
      </div>
      <div id="boss-phase" style="font-size:10.5px;letter-spacing:0.2em;color:rgba(242,237,228,0.55);margin-top:4px"></div>`;
    this.el.hud.appendChild(wrap);
    this.el.bossWrap = wrap;
    this.el.bossFill = wrap.querySelector('#boss-fill');
    this.el.bossName = wrap.querySelector('#boss-name');
    this.el.bossPhase = wrap.querySelector('#boss-phase');
  }

  setBoss(name, fraction, phaseText) {
    this.el.bossWrap.style.display = 'block';
    this.el.bossName.textContent = name;
    this.el.bossFill.style.transform = `scaleX(${Math.max(0, fraction)})`;
    if (phaseText !== undefined) this.el.bossPhase.textContent = phaseText;
  }

  hideBoss() { this.el.bossWrap.style.display = 'none'; }

  /* ---------------- per-frame ---------------- */
  update(state) {
    const e = this.el;
    const hpF = state.health / state.maxHealth;
    e.hp.style.transform = `scaleX(${Math.max(0, hpF)})`;
    e.hp.classList.toggle('low', hpF < 0.34);
    e.st.style.transform = `scaleX(${Math.max(0, state.stamina / state.maxStamina)})`;
    e.st.classList.toggle('empty', state.stamina < 26);

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
      e.ammo.classList.toggle('low', state.ammo <= 3);
      this._lastVals.ammo = state.ammo;
    }
    if (this._lastVals.ammoMax !== state.ammoMax) {
      e.ammoMax.textContent = state.ammoMax;
      this._lastVals.ammoMax = state.ammoMax;
    }
    const showReload = state.ammo === 0 || state.reloading;
    if (this._lastVals.reload !== showReload) {
      e.reloadHint.classList.toggle('hidden', !showReload);
      e.reloadHint.textContent = state.reloading ? 'PŘEBÍJENÍ…' : 'R — PŘEBÍT';
      this._lastVals.reload = showReload;
    }
    if (this._lastVals.obj !== state.objective) {
      e.objective.textContent = state.objective;
      this._lastVals.obj = state.objective;
    }
    if (this._lastVals.objDist !== state.objectiveDist) {
      e.objectiveDist.textContent = state.objectiveDist;
      this._lastVals.objDist = state.objectiveDist;
    }
    e.crosshair.classList.toggle('hostile', !!state.aimingAtEnemy);
    e.crosshair.classList.toggle('wide', !!state.sprinting);
    e.vignette.style.opacity = Math.min(0.9, (1 - hpF) * 0.55 + state.hurt * 0.7);

    // compass: put the tick for the current bearing under the needle
    const bearing = (((state.camYaw * 180) / Math.PI + 180) % 360 + 360) % 360;
    const x = COMPASS_HALF - COMPASS_TICK_HALF - (bearing + 180) * this.pxPerDeg;
    e.compass.style.transform = `translateX(${x.toFixed(1)}px)`;
  }

  hit() {
    const h = this.el.hitmarker;
    h.classList.remove('show');
    void h.offsetWidth;
    h.classList.add('show');
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
    ctx.save();
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, S, S);

    const theta = Math.PI - camYaw;
    ctx.translate(S / 2, S / 2);
    ctx.rotate(theta);
    ctx.scale(zoom, zoom);
    ctx.translate(-player.pos.x, -player.pos.z);

    ctx.globalAlpha = 0.95;
    ctx.drawImage(this.plan, -HALF, -HALF, MAP_SIZE, MAP_SIZE);
    ctx.globalAlpha = 1;

    // rifts
    for (const r of rifts) {
      ctx.fillStyle = '#ff5a2a';
      ctx.beginPath();
      ctx.arc(r.pos.x, r.pos.z, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,120,60,0.5)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(r.pos.x, r.pos.z, 16, 0, Math.PI * 2);
      ctx.stroke();
    }

    // enemies
    for (const en of enemies) {
      if (en.hp <= 0) continue;
      const boss = en.typeId === 'boss';
      ctx.fillStyle = boss ? '#ff2a1a' : en.typeId === 'golem' ? '#ffa040' : '#ff6b6b';
      ctx.beginPath();
      ctx.arc(en.pos.x, en.pos.z, boss ? 14 : 6, 0, Math.PI * 2);
      ctx.fill();
    }

    // objective markers
    for (const mk of markers) {
      ctx.strokeStyle = '#ffb347';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(mk.x, mk.z, 12, 0, Math.PI * 2);
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

    // frame + north pip
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
    ctx.stroke();
    const nAngle = theta - Math.PI / 2;
    ctx.fillStyle = '#7de3ff';
    ctx.beginPath();
    ctx.arc(S / 2 + Math.cos(nAngle) * (S / 2 - 12), S / 2 + Math.sin(nAngle) * (S / 2 - 12), 4, 0, Math.PI * 2);
    ctx.fill();
  }
}
