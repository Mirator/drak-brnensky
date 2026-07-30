# DRAK BRNĚNSKÝ

**▶ Play it: https://mirator.github.io/drak-brnensky/**

A third-person action game set in central Brno, built with [three.js](https://threejs.org/).
Rifts have torn open over the city and the Brno Dragon's brood is pouring out of them.
Seal the rifts, hold the squares, then hunt the dragon itself on náměstí Svobody.

Everything is generated at runtime — no model, texture or audio files. The city,
the facades, the character, the enemies and every sound effect are built from
primitives, canvas textures and WebAudio oscillators.

## Running it

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:5173 and click **HRÁT** (the game grabs the pointer,
so click the canvas again if you tab away). Production build:

```bash
npm run build
```

Pushes to `main` build and publish to GitHub Pages via
`.github/workflows/deploy.yml`. The Vite `base` is `'./'` so the bundle works
from the `/drak-brnensky/` sub-path.

## Controls

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` | move (camera-relative) |
| mouse | look |
| `LMB` | fire the plasma thrower |
| `RMB` | aim (pulls the camera in) |
| `SHIFT` | sprint (drains stamina) |
| `SPACE` | jump |
| `CTRL` | dash / dodge (brief invulnerability) |
| `F` | melee punch |
| `R` | reload |
| `E` | pull in a nearby pickup |
| wheel | camera distance |
| `ESC` | pause |

## The map

A compressed but recognisable interpretation of the historic centre, 840 × 840 m,
1 unit = 1 metre:

- **Petrov** — the cathedral of St Peter & Paul on its terraced hill, twin 84 m
  neo-gothic spires, rose window, buttresses you can hide behind
- **Špilberk** — the castle above the city: walkable terraces, crenellated
  bastion walls, corner drums and a gatehouse you can walk through
- **Stará radnice** — the old town hall, Pilgram's portal, and the Brno Dragon
  (the stuffed crocodile) hanging from its bracket, plus the Brno Wheel
- **náměstí Svobody** — the plague column and the black granite "astronomical
  clock"; also where the boss fight happens
- **Zelný trh** — the Parnas fountain and market stalls
- **Mahenovo** and **Janáčkovo divadlo**, **Moravské náměstí** with Jošt's
  statue, and **hlavní nádraží** with its platform canopies
- ~1400 procedurally placed period buildings hugging 28 named streets, with
  trams running the tram routes

## Enemies

| | |
| --- | --- |
| **Ještěrka** | fast quadruped whelp, swarms in packs |
| **Chrlič** | winged spitter, keeps its distance and lobs fire |
| **Kamenný golem** | slow, heavily armoured, hits hard |
| **Drak brněnský** | the boss: fireball fans, a sweeping fire breath, and a second phase at half health |

Rifts keep spawning brood until you destroy them — shoot the rift itself. Clear
every rift and the remaining brood to finish a wave. Five waves; the fifth wakes
the dragon. Survive past it and the waves keep coming, harder.

## Architecture

| File | Responsibility |
| --- | --- |
| `src/main.js` | game states, wave director, integration glue |
| `src/render/` | post-processing stack, cascaded shadows, IBL bake, sky and aerial perspective |
| `src/city.js` + `src/city/` | map layout, ground plan, plot subdivision, buildings, roofscape, shopfronts, props, vegetation, trams, chunked LOD |
| `src/landmarks.js` + `src/landmarks/` | hand-modelled landmarks, one module each, merged per material |
| `src/player.js` + `src/character/` | 22-bone rig, skinned mesh, locomotion, aim layer, cloth, weapon |
| `src/enemies.js` + `src/creatures/` | four archetypes, steering AI, pack/perch behaviour, boss choreography |
| `src/camera.js` | over-the-shoulder chase camera with wall-aware pull-in |
| `src/physics.js` | AABB collision world on a uniform grid, ray marching, surface types |
| `src/rigidbody.js` | rigid bodies, ragdolls, pre-fractured breakables, ballistics |
| `src/vfx.js` + `src/vfx/` | instanced particles, decals, beams, explosions, flame, rifts |
| `src/hud.js` | crosshair, ammo, damage indicators, minimap, toasts, boss bar |
| `src/audio.js` | synthesised SFX, procedural reverb zones, adaptive music |
| `src/textures.js` + `src/textures/` | procedural PBR: albedo, normal, ORM packing, signage |
| `src/materials.js` | cached material registry, resolution tiers, `TILE_METRES` |
| `src/geometry.js` | safe geometry merging and the gable-roof builder |

Some notes on how it works:

- **Ground plan.** The whole city plan (roads, tram rails, paving, parks) is
  painted once into a 4096² canvas that becomes the ground texture. The same
  drawing calls paint a 420² "flag map" that is read back as a grid and used for
  building placement, spawn validity and the minimap.
- **Collision.** Every solid is an axis-aligned box in a uniform grid. Vertical
  capsules are pushed out horizontally and can step onto anything within their
  step height — which is why the hills are built as many shallow terraces rather
  than a few tall slabs.
- **Draw calls.** The city is split into spatial chunks and merged per material
  per chunk, so frustum culling actually removes work — before chunking it was
  one map-wide mesh per material and nothing was ever culled. Landmarks merge
  per material; repeated props are instanced. Fine detail (chimneys, railings,
  downpipes, signage, wires) does not cast shadows, which matters because the
  three shadow cascades each re-render the casters. Camera pass plus cascades is
  ~0.9M triangles.
- **Post-processing.** Everything goes through an `EffectComposer` stack in
  `src/render/postfx.js` — GTAO, bloom, aim-only depth of field, god rays, SMAA,
  a still-frame accumulation pass, a filmic grade and a sharpen. `renderer.info`
  is reset once per frame rather than per `render()` call, because the composer
  issues one per pass and `autoReset` would leave `stats()` describing only the
  final fullscreen quad.
- **Texel density.** `src/materials.js` exports `TILE_METRES` — how much world
  space one texture tile covers, derived from the grid each generator bakes —
  plus `groundRepeat(name, widthM, depthM)`. Callers size from world extent
  rather than hand-tuned `repeat` values, so paving stays at a real 0.10 m
  granite sett module instead of drifting to metre-wide slabs.
- **Lights.** Dynamic lights live in fixed-size pools that stay in the scene at
  zero intensity, because changing the visible light count forces three.js to
  recompile materials mid-fight.
- **Aiming.** The camera sits over the shoulder, so a shot from the muzzle along
  the raw camera ray would sail under small enemies. The crosshair resolves to a
  soft target first (capsule test against the camera ray) and falls back to the
  geometry hit point.

## Development helpers

`window.__brno` exposes the live game for the console: `stats()`, `advance(dt)`
to step the simulation frame by frame, `shot(w, h)` for a PNG data URL,
`startWave(n)`, `spawnEnemy(type, x, z)`, plus `player`, `enemies`, `rifts` and
`input`. The dev server also accepts `POST /__shot` with `{name, data}` and
writes the PNG into `shots/` — that combination is what the game was play-tested
with, driving a scripted bot through whole waves headlessly.
