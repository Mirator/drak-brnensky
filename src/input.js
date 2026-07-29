/**
 * Keyboard + pointer-lock mouse input.
 */
export function isFormControl(target) {
  return !!target
    && typeof target.matches === 'function'
    && (target.matches('input, button, select, textarea') || target.isContentEditable);
}

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouse = { dx: 0, dy: 0, left: false, right: false, wheel: 0 };
    this.locked = false;
    this.sensitivity = 0.0022;
    this.invertY = false;
    this._pressedOnce = new Set();

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (isFormControl(e.target)) return;
      const c = e.code;
      this.keys.add(c);
      this._pressedOnce.add(c);
      if (['Space', 'ShiftLeft', 'ControlLeft', 'KeyR', 'KeyE', 'KeyF', 'Tab'].includes(c)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.reset());

    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.mouse.left = true;
      if (e.button === 2) this.mouse.right = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
    });
    addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) {
        this.reset();
        this.onUnlock && this.onUnlock();
      }
    });
  }

  requestLock() {
    if (this.locked) return Promise.resolve(true);
    return new Promise((resolve) => {
      let settled = false;
      let timer;
      const done = (ok) => {
        if (settled) return;
        settled = true;
        document.removeEventListener('pointerlockchange', onChange);
        document.removeEventListener('pointerlockerror', onError);
        clearTimeout(timer);
        resolve(ok);
      };
      const onChange = () => done(document.pointerLockElement === this.canvas);
      const onError = () => done(false);

      document.addEventListener('pointerlockchange', onChange);
      document.addEventListener('pointerlockerror', onError);
      timer = setTimeout(() => done(false), 1000);

      try {
        const pending = this.canvas.requestPointerLock();
        if (pending && typeof pending.catch === 'function') pending.catch(() => done(false));
      } catch {
        done(false);
      }
    });
  }
  releaseLock() {
    if (this.locked) document.exitPointerLock();
  }

  reset() {
    this.keys.clear();
    this._pressedOnce.clear();
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this.mouse.left = false;
    this.mouse.right = false;
    this.mouse.wheel = 0;
  }

  down(code) { return this.keys.has(code); }
  /** True only on the frame the key went down. */
  pressed(code) { return this._pressedOnce.has(code); }

  /** Movement/action snapshot for the player controller. */
  sample() {
    const forward = (this.down('KeyW') || this.down('ArrowUp') ? 1 : 0) - (this.down('KeyS') || this.down('ArrowDown') ? 1 : 0);
    const right = (this.down('KeyD') || this.down('ArrowRight') ? 1 : 0) - (this.down('KeyA') || this.down('ArrowLeft') ? 1 : 0);
    return {
      forward,
      right,
      jump: this.pressed('Space'),
      sprint: this.down('ShiftLeft') || this.down('ShiftRight'),
      dash: this.pressed('ControlLeft') || this.pressed('ControlRight'),
      fire: this.mouse.left,
      aim: this.mouse.right,
      melee: this.pressed('KeyF'),
      reload: this.pressed('KeyR'),
      use: this.pressed('KeyE'),
    };
  }

  /** Call once per frame AFTER sampling. */
  endFrame() {
    this._pressedOnce.clear();
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this.mouse.wheel = 0;
  }
}
