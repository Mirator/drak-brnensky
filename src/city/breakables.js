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
 *
 * Two things this has to survive:
 *
 *  - **Restarts.** `PhysicsWorld.clear()` empties its own `breakables` list,
 *    so every registration made at boot is thrown away the first time
 *    `startGame()` runs. `register()` keeps a memo so an accidental double
 *    call is free, but the memo has to be defeatable — hence
 *    `register(world, { force: true })` and its alias `reregister(world)`.
 *    Call it straight after `clear()` and the whole city is breakable again.
 *  - **Props that are already debris.** Re-registering a bench that has
 *    already been smashed would let it shed a second set of chunks out of
 *    thin air, so a descriptor whose prop has broken is skipped from then on.
 */

/**
 * Build the visual half of a descriptor: which instanced meshes to collapse
 * when the prop breaks.
 *
 * `handles` is a list of `[instanceSet, index]` pairs — a prop assembled from
 * several materials (a kiosk is body, roof, glazing and sign) gets one pair
 * per material. Collapsing writes a zero-scale matrix, so no buffer is
 * rebuilt and nothing is left standing where the debris came from.
 */
export function instanceVisual(handles) {
  return {
    userData: { instances: handles },
    onBreak() {
      for (const [set, index] of handles) {
        if (set && typeof set.hide === 'function') set.hide(index);
      }
    },
  };
}

/**
 * Add a prop's static collider(s) and remember how to recreate them.
 *
 * `breakProp()` removes the boxes from the collision grid and there is no
 * un-remove — the objects the descriptor is holding are, from that moment,
 * detached from the world. So the *arguments* are kept rather than the boxes:
 * `restore()` re-adds them and swaps the fresh boxes into the descriptor's
 * `colliders` array in place. Without that swap the next registration would
 * hand `registerBreakable` a stale box and derive the prop's centre and
 * radius from something no longer in the world.
 *
 * `specs` is a list of `collision.add()` argument tuples:
 * `[x, z, w, d, y0, h, tag, surface]`. Tag and surface travel with them, so a
 * restored prop keeps its footstep and impact classification.
 */
export function rebuildableColliders(collision, specs) {
  return {
    colliders: specs.map((args) => collision.add(...args)),
    rebuild: { collision, specs },
  };
}

export function createBreakables() {
  const pending = [];
  let registered = null;

  const looksUsable = (w) => !!w && typeof w.registerBreakable === 'function';

  const api = {
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

    /** How many are still intact, i.e. how many a re-registration passes on. */
    get intact() {
      let n = 0;
      for (const d of pending) if (!d.broken) n++;
      return n;
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
     * Hand every intact prop to a rigid-body world. Safe to call with
     * `undefined`, with an object that has no such API, or twice.
     *
     * @param {object} world  a PhysicsWorld-like object
     * @param {{force?: boolean}} opts  `force` defeats the already-registered
     *   memo, which is what a restart needs once `world.clear()` has emptied
     *   the world's own registry.
     * @returns {number} how many were registered
     */
    register(world, { force = false } = {}) {
      if (!looksUsable(world)) return 0;
      if (registered === world && !force) return 0;
      registered = world;
      let n = 0;
      for (const desc of pending) {
        if (desc.broken) continue;
        try {
          const { label, onBreak, rebuild, broken, ...opts } = desc;
          void label;
          void rebuild;
          void broken;
          /* Mark the descriptor broken whatever else the prop's own onBreak
           * does, so a later re-registration cannot resurrect it. */
          opts.onBreak = (prop, bodies) => {
            desc.broken = true;
            if (onBreak) onBreak(prop, bodies);
          };
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

    /**
     * Re-register after a world has been cleared — exactly
     * `register(world, { force: true })`. Call it straight after
     * `PhysicsWorld.clear()`.
     *
     * Deliberately does **not** un-break anything: skipping props that are
     * already debris is what stops wreckage shedding a second set of chunks.
     * Use `restore()` for that, as a separate, explicit step.
     */
    reregister(world) {
      return api.register(world, { force: true });
    },

    /**
     * Put every broken prop back: static collider re-added to the collision
     * grid, instanced visual shown again at its original matrix, `broken`
     * cleared. Returns how many were restored.
     *
     * This is what makes a new run start from a pristine city rather than
     * inheriting the last run's wreckage. It is separate from `reregister()`
     * on purpose — restoring is a decision about starting over, whereas
     * re-registering is about a world that has forgotten what it was told.
     *
     * Idempotent: with nothing broken it does no work and returns 0.
     */
    restore() {
      let n = 0;
      for (const desc of pending) {
        if (!desc.broken) continue;
        const rb = desc.rebuild;
        if (rb && rb.collision && Array.isArray(rb.specs) && Array.isArray(desc.colliders)) {
          // fresh boxes, swapped into the same array the descriptor exposes
          const fresh = rb.specs.map((args) => rb.collision.add(...args));
          desc.colliders.length = 0;
          for (const box of fresh) desc.colliders.push(box);
        }
        const instances = desc.userData && desc.userData.instances;
        if (Array.isArray(instances)) {
          for (const [set, index] of instances) {
            if (set && typeof set.show === 'function') set.show(index);
          }
        }
        desc.broken = false;
        n++;
      }
      // anything restored has to be handed to the world again
      if (n) registered = null;
      return n;
    },
  };

  return api;
}
