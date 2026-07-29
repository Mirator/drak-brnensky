import * as THREE from 'three';

/**
 * Over-the-shoulder chase camera with wall-aware pull-in and screen shake.
 */
export class ChaseCamera {
  constructor(camera, collision) {
    this.camera = camera;
    this.collision = collision;
    this.yaw = Math.PI;
    this.pitch = -0.12;
    this.dist = 5.4;
    this.wantDist = 5.4;
    this.shoulder = 0.85;
    this.height = 1.52;
    this.shake = 0;
    this.shakeDecay = 4.2;
    this.fovBase = 74;
    this.pos = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.aimPoint = new THREE.Vector3();
    this._smooth = new THREE.Vector3();
    this._first = true;
  }

  look(dx, dy, sensitivity) {
    // Forward is (-sin yaw, 0, cos yaw) and screen-right is (-cos yaw, 0, -sin yaw),
    // so a rightward mouse move (dx > 0) has to *increase* yaw to turn right.
    this.yaw += dx * sensitivity;
    this.pitch -= dy * sensitivity;
    const lim = Math.PI / 2 - 0.12;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
    this.yaw = ((this.yaw + Math.PI) % (Math.PI * 2)) - Math.PI;
  }

  zoom(steps) {
    this.wantDist = Math.max(2.6, Math.min(9, this.wantDist + steps * 0.6));
  }

  addShake(amount) {
    this.shake = Math.min(1.6, this.shake + amount);
  }

  /** Unit vector the camera is looking along. */
  forward(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).normalize();
  }

  update(dt, player, aiming) {
    const fwd = this.forward(_f);
    const right = _r.set(-Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    // pivot roughly at the player's chest
    this.target.set(player.pos.x, player.pos.y + this.height, player.pos.z);
    this.target.addScaledVector(right, this.shoulder * 0.55);

    const desired = aiming ? this.wantDist * 0.68 : this.wantDist;
    this.dist += (desired - this.dist) * Math.min(1, dt * 8);

    // where the camera wants to sit
    _p.copy(this.target).addScaledVector(fwd, -this.dist).addScaledVector(right, this.shoulder * 0.45);

    // pull in if a wall is in the way
    const back = _b.copy(_p).sub(this.target);
    const backLen = back.length();
    back.divideScalar(backLen || 1);
    const hit = this.collision.raycast(this.target, back, backLen + 0.35, 0.35);
    let d = backLen;
    if (hit !== Infinity) d = Math.max(1.1, hit - 0.35);
    _p.copy(this.target).addScaledVector(back, d);
    if (_p.y < 0.5) _p.y = 0.5;

    if (this._first) { this._smooth.copy(_p); this._first = false; }
    // faster catch-up when the camera is being pushed by geometry
    const lag = hit !== Infinity ? 22 : 13;
    this._smooth.lerp(_p, Math.min(1, dt * lag));

    this.camera.position.copy(this._smooth);

    // shake
    this.shake = Math.max(0, this.shake - dt * this.shakeDecay);
    if (this.shake > 0) {
      const s = this.shake * this.shake * 0.28;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.position.z += (Math.random() - 0.5) * s;
    }

    _look.copy(this.target).addScaledVector(fwd, 12);
    this.camera.lookAt(_look);
    if (this.shake > 0) this.camera.rotation.z += (Math.random() - 0.5) * this.shake * 0.045;

    // fov breathing: narrow while aiming, wide while sprinting
    const speed = Math.hypot(player.vel.x, player.vel.z);
    const targetFov = this.fovBase + (speed > 8 ? 6 : 0) - (aiming ? 12 : 0);
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 6);
    this.camera.updateProjectionMatrix();

    // the point the crosshair is over: first hit along the camera ray
    const eye = _e.copy(this.camera.position);
    const dist = this.collision.raycast(eye, fwd, 240, 0.75);
    this.aimPoint.copy(eye).addScaledVector(fwd, dist === Infinity ? 200 : dist);
    return this.aimPoint;
  }
}

const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _p = new THREE.Vector3();
const _b = new THREE.Vector3();
const _e = new THREE.Vector3();
const _look = new THREE.Vector3();
