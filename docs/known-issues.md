# Known issues on `aaa-overhaul`

`npm test` (57 tests) and `npm run build` are green and the game boots and plays.
This file records what is still wrong, and — in the "resolved" section — the
diagnoses worth keeping, because several of them were misleading in instructive
ways and the reasoning is more reusable than the fix.

## Still open

### 1. `high` preset is unmeasured against 60 fps

Three shadow cascades plus GTAO's normal prepass is real GPU cost and nobody has
profiled the frame on representative hardware. `medium` is the fallback
(`__brno.setQuality('medium')` drops AO to half-res-only, DOF and TAA). The
triangle budget *is* met — 0.88–0.93M for the camera pass plus 3 cascades against
a 1.2M target, down from 13.3–16.0M — but triangles are not milliseconds.

### 2. Boot generation is 6.1–6.4 s

Down from a 7.7 s peak but still well above the ~2.0 s pre-overhaul baseline.
Facade bays are no longer the bulk (256→128 default cut them from ~2.07 s to
~0.43 s); what remains is spread across ground materials, the rest of the
registry, and geometry plus plan painting. A `size` option now exists on the
expensive generators, so the lever is there if it needs pulling further.

### 3. Window openings land at 1:1.9–2.0, not 1:1.7

The generator is correct (0.40 × 0.62 of the tile, `BAY_W` 3.1 / `FLOOR_H` 3.4,
giving 1.24 × 2.11 m at the nominal module). But facades snap to a whole number
of bays so windows sit symmetrically instead of being sliced at party walls,
which makes the effective tile 2.67–2.80 m across the 8–14 m plot range and the
real opening 1.07–1.12 m wide. Still portrait, still inside the dossier's
1.1–1.4 m range. Asymmetric half-windows at every party wall would be the more
visible error, so this is a deliberate trade.

### 4. Street-wall yield is low

2,134 of 2,466 plot attempts are rejected because the road table has corridors as
little as 6 m apart (Masarykova/Rašínova) whose `FLAG.ROAD` bands overlap, so
457 of ~1,230 buildings are true street-wall plots and the rest are block
interiors. Widening the spacing in `ROADS` would raise it substantially but moves
the tram routes.

### 5. Smaller things, each self-contained

- **Roof stripe banding** on the spire roofs follows the tile rows, which reads
  like UV tiling or normal-map scale rather than the (now-fixed) metalness
  collapse. Worth a look.
- **`hip()` roofs carry cylinder UVs**, so mansard and pavilion roofs are less
  correct than gable roofs, which generate metres/3 UVs themselves. Needs
  `roofSlate`/`roofCopper` entries in `TILE_METRES` first, so the roof tile size
  becomes a contract rather than the convention `geometry.js` currently hardcodes
  as `S = 3`.
- **TAA is live-view only** — it accumulates only when the camera is static, so
  SMAA carries AA during movement. Deliberate: without motion vectors it could
  never ghost.
- **`shadowStagger` and stills.** The far cascade refreshes on alternate frames,
  so any *new* still-capture path must call `lighting.forceShadowUpdate()` or the
  far band shows the previous frustum's shadows. `shot()` does; a future path
  will not get it for free.
- **Debris does not stack.** Body-vs-body uses bounding spheres, so chunks shove
  each other apart and settle in a scattered layer. Stable, never jittering, but
  a 0.4 m cube cannot rest on another.
- **QA capture size cap.** A capture larger than ~5 MiB of PNG is rejected by the
  dev `/__shot` endpoint's body cap. Brighter frames compress worse, so a
  full-resolution sweep can hit it; capture at the live canvas size.
- **`enemies.onAggro` re-issue interval** is 11–19 s, so a very long fight
  repeats creature voices on a timer rather than on events.

## Resolved, with the reasoning worth keeping

### The post stack composited black on 19 of 20 cameras

The fog chunk declared **seven uniforms that nothing ever uploaded**. three builds
`ShaderLib.<id>.uniforms` by deep-cloning `UniformsLib.fog` at *three's own*
module-evaluation time, so adding keys to it later — the only point at which we
could, since three is imported first — reaches exactly zero materials. All seven
defaulted to 0, making the chunk evaluate `pow(0, 0)`: undefined in GLSL, NaN
wherever it is computed as `exp2(y · log2(x))`.

Two things made this hard to find, and both are worth remembering:

- **Direct-to-canvas rendering laundered the NaN.** In-material tone mapping runs
  there and AgX ends in `clamp(0,1)`; render targets use `NoToneMapping`, so raw
  NaN survived only in the composer. Hence "a direct render looks fine, the
  composer is black" — and hence the one surviving view was the one whose centre
  is mostly sky, because the sky dome is `fog: false`.
- **A NaN buffer reads as 100% non-zero.** An early triage step reported
  "HalfFloat target: 57600/57600 non-zero" as evidence of health. It was the
  fingerprint. **Test for finite, not for non-zero** — `Number.isNaN` is the
  decisive probe.

Fixed by baking the values into the chunk as GLSL constants (the sun does not
move, so they are compile-time constants in fact as well as in principle), which
leaves no uniform to go missing. `configureAerialPerspective()` still retunes by
regenerating the chunks and bumping an `AERIAL_REV` define — required, because
three's program cache is keyed on defines and material params, **not chunk text**,
so `needsUpdate` alone hands back the stale program.

### The scene rendered near-black

Not the IBL wiring, which was correct throughout. The sky dome's Rayleigh term was
`pow(1 - h, 5.0)`, which is **0.031 at 30° elevation** — so the dome was 97%
zenith colour and the bright horizon occupied the bottom few degrees. That is a
ring: it gives rim light and no ambient fill, which is why `hemisphere` and
`skyFill` were the only dials that appeared to help.

The larger lever was the ground. Integrating the cosine-weighted hemisphere about
a vertical normal, **49.8% of it lies below the horizon** — half a wall's ambient
light comes from `uGround`, not the sky. Fixing the dome alone bought only 1.28×
on a facade.

Two measurement traps found on the way: sampling the **PMREM mip atlas** is not a
spherical average (read ~6× low), and a **centre patch of a horizon cube face**
points straight at the brightest band (read ~5× high). The probe now averages all
six whole faces.

### Screenshots were black independently of the above

`renderer.domElement.toDataURL()` returns an empty image because the context has
no `preserveDrawingBuffer`, while `gl.readPixels` on the very same framebuffer
returns the real frame. `shot()` reads pixels directly and flips the rows.

### `stats()` reported 1 draw call and 12 triangles

`renderer.info` resets at the start of every `render()` call and the composer
issues one per pass, so with `autoReset` left on the numbers described only the
final fullscreen quad. Now reset once per frame in `advance()`.

### three r185 ships a stale CSM shader chunk

`CSMShader.js` replaces `lights_fragment_begin` **globally** with a pre-r185 copy,
degrading every material in the scene whether or not it uses cascades.
`src/render/lighting.js` re-patches surgically against the pristine chunk and
falls back to a single texel-snapped light if the anchor ever moves.
`CSM.setupMaterial()` also assigns `material.onBeforeCompile`, which would clobber
the material registry's own hook — it chains instead, and re-walks the scene at
1 Hz behind a WeakSet because materials keep appearing after boot from the lazy
registry and pooled VFX.

### Texel density was decoupled from world scale

Masonry courses read at 1.5–2 m against a real 0.3–0.5 m, and granite setts at
~1 m against 0.10 m. Two separate causes: ground materials had no stated
metres-per-tile so callers guessed, and `BoxGeometry` UVs span 0..1 per face
**regardless of world size**, so no `scale` parameter could fix masonry. Now
`TILE_METRES` + `groundRepeat()` give callers a contract, and masonry uses a
triplanar world-space UV projection applied at merge time — measured 0.400 m
courses on every masonry mesh. Deriving `scale` per surface at the call site
would have meant one material, and one draw call, per distinct wall height.

### A 120 m translucent pane crossed the frame

The station platform canopy's glazed strip was built at the canopy's full length
instead of per bay — six of them, `transparent`, 7 m up, each sorting as one unit.
Attribution took three rounds: VFX ruled itself out on four independent grounds
(the object is lit, has periodic modelled detail, crosses the sky, and no combat
was live), a "shopfront" guess from the opaque view was wrong, and the answer came
from **measuring the longest triangle edge per mesh keyed by material**. An audit
then found two more of the same class in the Janáček foyer glazing and basin.

### Breakable props: never armed, then never restored

Three bugs in one seam, all reported in review. `buildCity()` probed
`collision.rigid` / `.rigidBody` / `.physics`, which `main.js` never sets, so
nothing was ever registered. Registering at boot would not have been enough
either: `startGame()` calls `physics.clear()`, which empties
`physics.breakables`, and the registry's `registered === world` memo then refused
to re-register — so the first run permanently disarmed every prop in the city.
Separately, descriptors carried collider and fracture data only, so a prop that
did break left its intact mesh standing beside its own debris.

The fix that is easy to get wrong: **restoring a prop and re-registering it must
be different operations.** The memo, and the rule that a broken descriptor is
skipped, are what stop wreckage shedding a second set of chunks. Only a restart
is entitled to bring props back, so `restore()` is separate from `reregister()`
and `main.js` calls it from exactly one place. Restoring a collider also has to
create a *fresh* box and replace the entry in the descriptor's array — the
original is gone from the grid, and handing `registerBreakable` a stale box makes
it derive the prop's centre and radius from something the world no longer knows
about.

Verified in the browser across three run cycles: 210 breakables / 2,956
colliders, down to 206 / 2,952 after smashing three props, and back to
210 / 2,956 on the next run with no drift on the run after that.

### Materials that were physically wrong

`roofSlate` was at metalness **0.75** — higher than the copper variant it had been
swapped with — collapsing the diffuse response on every slate roof in the game.
`tramLivery` was 0.6 for flat painted panels. Both now 0.04. Nine materials were
also silently falling back to a **constant** roughness of 0.5, flattening the
worn-patch variation their own comments described. A suspected fully-metallic
ground was *disproven* by measuring the packed ORM channels directly with a
software Canvas2D — every ground material writes B = 0 exactly.

### Frame-rate dependence in the character rig

Three separate cases: the lean used a finite-difference acceleration (25% error
between 30 and 144 Hz), pelvis height was exponentially filtered (which aliases a
9 Hz bob differently per rate), and the foot's swing landing point was predicted
once at lift-off (leaving the foot up to 0.2 m behind at 30 Hz). Now 0.89 mm
difference at the pelvis between 30 and 144 Hz, and 0.000000 m foot slip during
stance. `onStep` also fired on a 2.1 m distance accumulator, which is
geometrically impossible for an 0.84 m leg — it now fires on actual contact.

### Physics bugs only running the sim would find

Ragdoll bones sleeping individually let the joint solver push bodies that had
stopped integrating; Baumgarte bias applied to real velocities made corpses walk
themselves across the square (fixed with split-impulse pseudo-velocities); and a
velocity-based sleep test can never fire, because a resting body always carries
correction velocity — sleep is decided on displacement.

### An authoring hazard that bit twice

A backtick inside a comment inside a `` /* glsl */ `…` `` template literal
silently terminates the template and turns GLSL into JavaScript. It broke the
build twice in one session, in two different files, and the error points at the
wrong line. There is now a check for it in the render module's invariant harness.
