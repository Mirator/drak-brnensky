# Known issues on `aaa-overhaul`

State as of the end of the first integration pass. `npm test` (51 tests) and
`npm run build` are green, and the game boots and plays — but the branch is
**not finished** and must not be merged as-is. What follows is what is actually
wrong, with the evidence, so nobody has to rediscover it.

## 1. The post-processing stack resolves to black on most cameras — BLOCKING

**Symptom.** `render.render(dt)` composites to an all-black frame at most camera
positions. A direct `renderer.render(scene, camera)` of the *identical* view is
correct.

**Evidence.** At the `petrov-front` QA camera (`eye [-104, 30, 262]`, 64×64
centre sample, threshold > 6):

| path | lit pixels | max channel |
| --- | --- | --- |
| `renderer.render(scene, camera)` | 3405 / 4096 | 145 |
| `render.render(1/60)` (composer) | 0 / 4096 | 3 |

Of the 20 QA views, **19 come out black through the composer** and only
`street-masarykova` composites correctly. So it is not intermittent noise — it
is the normal case, and the one working view is the exception.

**What has been ruled out, with tests:**

- *Not the fog patch.* Suspected first, because a `MeshBasicMaterial` override
  rendered black with `scene.fog` set and 221 with `scene.fog = null`
  (`MeshNormalMaterial` has no fog support, which is why it always rendered).
  But a later clean run rendered correctly *with* fog enabled, so the fog patch
  in `render/sky.js` is not the cause of the black frames.
- *Not the scene, camera or geometry.* `MeshNormalMaterial` override renders
  (254). The scene renders correctly into a plain `UnsignedByteType` target
  (max 255, 9837/57600 lit) and into a `HalfFloatType` target (57600/57600
  non-zero) — i.e. scene-into-render-target works fine.
- *Not any single pass.* Disabling each of the 11 passes in turn leaves the
  frame black. Disabling the `RenderPass` itself changes the output, so the
  chain runs — its input is empty.
- *Not `requireDepth`.* Black with the flag both set and cleared.
- *Not target sizing.* All composer buffers, the raw depth texture and the
  linear depth texture are correctly 1280×720.
- *Not `renderStill()` alone.* The still path is also black, but so is the live
  path on the same cameras.
- *Not quality preset.* `low`, `medium`, `high` and `ultra` are all black
  (`low` yields 1,1,1, i.e. the clear colour).

**Not yet isolated.** Why one camera composites and nineteen do not. The
composer chain structure looks correct — exactly one pass has
`renderToScreen = true` (the final `ShaderPass`), `readBuffer !== writeBuffer`,
and `needsSwap` flags look right, including `UnrealBloomPass` with
`needsSwap: false`, which is correct for its additive-onto-readBuffer design.
Next place to look is buffer swap parity across the depth-less target that
`postfx.js` substitutes for one of the composer's internal buffers, and the
GTAO normal/depth prepass.

**Current mitigation, deliberately loud, not silent:**

- `verifyPostStack()` in `main.js` runs at boot, renders the same view directly
  and through the stack, compares lit-pixel counts, and sets
  `window.__brno.postStackOk`. It warns to the console on failure and refuses
  to reach a verdict when the direct render is itself empty (an inconclusive
  probe must not claim the stack is healthy — an earlier version of this check
  passed on a black frame, which is worse than no check at all).
- `shot()` checks each captured frame and re-renders without the stack if it
  came out blank, recording `window.__brno.lastShot.fellBack`. `qa-shots.js`
  returns the list of views that fell back. **Any screenshot in `shots/final-*`
  other than `street-masarykova` was produced WITHOUT post-processing** — no
  AO, bloom, god rays, grade, SMAA or sharpening. Do not judge the pipeline's
  look from them.

## 2. `toDataURL` on the WebGL canvas returns black — FIXED

The context is created without `preserveDrawingBuffer`, so by the time the
canvas compositing path behind `renderer.domElement.toDataURL()` runs, the
drawing buffer is gone: it returned a fully black PNG while `gl.readPixels` on
the very same framebuffer returned the real frame. Every screenshot was black
for this reason *in addition to* issue 1. `shot()` now reads pixels directly and
flips the rows (GL's origin is bottom-left). Fixed in `main.js`
(`readCanvasPng()`).

## 3. Lighting is far too dark on geometry

See `shots/final-petrov-front.png`: the rebuilt cathedral reads as a near-total
silhouette. Scene light intensities at boot are hemisphere 0.26, sky fill 0.38,
bounce 0.17 against a sun of 2.9, so anything not directly sun-lit collapses to
black. The IBL environment is present (`scene.environment` set,
`environmentIntensity` 0.9) but is not carrying the shadow side. Note this is
measured through the *fallback* path, so the grade is not applied — retune only
after issue 1 is fixed, or the numbers will be wrong twice.

## 4. Triangle budget is blown by roughly 10×

`stats()` reports **13.3M–16.0M triangles and 2761–3367 draw calls** in the QA
sweep, against a stated budget of 1.2M triangles / ~600 draw calls and a
baseline of 371k / ~500. The city and landmark workstreams were terminated
mid-task by a session limit, both while explicitly working on exactly this
(their last messages were about trimming generation cost and triangle count), so
this number is from unfinished work. The performance workstream never started.

## 5. Three workstreams are unfinished

Terminated by an API session limit, mid-edit, with valid but incomplete code:

- **Landmarks** (`src/landmarks.js`, `src/landmarks/`) — had reported both hills
  climbable and was moving on to tests/build. `LANDMARK_FOOTPRINTS` needs
  verifying as the reservation source of truth.
- **City** (`src/city.js`, `src/city/`) — was trimming generation cost and
  triangle count. Its determinism claim is unverified.
- **Enemies** (`src/enemies.js`, `src/creatures/`) — was writing the ragdoll
  handoff. `enemies.onAggro` is wired in `main.js` for creature voices but
  nothing calls it yet, so whelps, spitters and golems are still silent.

## 6. Unverified integration wiring

Wired into `main.js` but never seen working, because the black frames made
visual confirmation impossible:

- Player ragdoll on death. `applyPlayerRagdoll()` copies `bone.out` world
  transforms straight into `rig.byName[...]` local `position`/`quaternion` per
  the physics module's documented API. If the rig is a parented hierarchy this
  double-transforms; the physics workstream reported verifying it against the
  real rig, but it has not been seen on screen.
- Debris rendering (`updateDebrisVisuals()`), including the exclusion of ragdoll
  bones so corpses do not get boxes drawn over them.
- Surface-aware footsteps and impacts, reverb zones, the positional audio
  listener, damage-direction arcs, the objective marker and reload progress.
- The free-camera QA framings were authored against the old city and may now sit
  inside new geometry; they need re-aiming.

## 7. A recurring authoring hazard worth a lint rule

A backtick inside a comment inside a `` /* glsl */ `…` `` template literal
silently terminates the template and turns GLSL into JavaScript. It broke the
build twice in one session, in two different files, and the error points at the
wrong line.
