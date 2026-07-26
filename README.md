# DRAK BRNĚNSKÝ

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
| `src/main.js` | renderer, lighting, sky, game states, wave director, glue |
| `src/city.js` | map layout, ground plan painting, building placement, props, trams |
| `src/landmarks.js` | hand-modelled landmarks (merged per material) |
| `src/player.js` | character rig, procedural animation, movement & weapon state |
| `src/enemies.js` | four archetypes, steering AI, stuck recovery, health bars |
| `src/camera.js` | over-the-shoulder chase camera with wall-aware pull-in |
| `src/physics.js` | AABB collision world on a uniform grid, ray marching |
| `src/vfx.js` | pooled projectiles, particle cloud, explosions, rifts |
| `src/hud.js` | bars, ammo, compass, rotating minimap, toasts, boss bar |
| `src/audio.js` | synthesised SFX and an ambient drone |
| `src/textures.js` | canvas-generated facades, roofs, stone, cobbles |
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
- **Draw calls.** Buildings are merged into one mesh per facade style and
  lighting variant, landmarks into one mesh per material; trees and lamps are
  instanced. A full frame is ~150–400 draw calls and ~370k triangles.
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
