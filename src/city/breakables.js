/**
 * Breakable-prop registration, written to degrade gracefully.
 *
 * The rigid-body engineer owns `src/rigidbody.js` and its
 * `registerBreakable()` API, and `main.js` decides if and when a physics
 * world exists. So the city never reaches for that module: it collects
 * descriptors while it builds and hands them over when — and only when —
 * something with a compatible API is offered. If no rigid-body world ever
 * appears, the props are simply static colliders, and every collider still
 * carries an explicit surface name for the audio and VFX engineers.
 */
export function createBreakables() {
  const pending = [];
  let registered = null;

  const looksUsable = (w) => !!w && typeof w.registerBreakable === 'function';

  return {
    /** Descriptor shape matches PhysicsWorld.registerBreakable(opts). */
    add(desc) {
      pending.push(desc);
      return desc;
    },

    get list() {
      return pending;
    },

    get count() {
      return pending.length;
    },

    /** Group the pending descriptors by label, for the build report. */
    summary() {
      const out = {};
      for (const d of pending) {
        const key = `${d.label || 'prop'}:${typeof d.surface === 'string' ? d.surface : 'inherit'}`;
        out[key] = (out[key] || 0) + 1;
      }
      return out;
    },

    /**
     * Hand every collected prop to a rigid-body world. Safe to call with
     * `undefined`, with an object that has no such API, or twice.
     * Returns the number actually registered.
     */
    register(world) {
      if (!looksUsable(world)) return 0;
      if (registered === world) return 0;
      registered = world;
      let n = 0;
      for (const desc of pending) {
        try {
          const { label, ...opts } = desc;
          void label;
          if (!opts.colliders || opts.colliders.length) {
            world.registerBreakable(opts);
            n++;
          }
        } catch {
          /* an incompatible API revision must never break world building */
        }
      }
      return n;
    },
  };
}
