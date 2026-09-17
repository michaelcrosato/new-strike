# MERCENARY STRIKE — infrastructure

An open-world successor to the BLOCKHAWK campaign. You start in a makeshift yard with a
bottom-of-the-barrel helicopter and one colleague, and you fly whatever pays. The region is
a hotspot; the work you take decides who talks to you and who shoots at you.

This document covers what exists now, which is the backend: the world, the streamer, and the
outfit that turns the world into work.

```powershell
npm run world      # builds dist/world.html and serves it
npm test           # 63 checks, including the world and outfit suites
```

Open **http://localhost:4189/dist/world.html**. `W A S D` fly, `SHIFT` throttle, `SPACE` /
`C` climb and descend, `M` region map, `H` back to the yard, `G` hide the telemetry.
`?seed=12345` generates a different region.

## Scale

One world unit is five metres. The region is 2000 × 2000 units — **10 × 10 km, 100 km²**.
For comparison, the five-operation BLOCKHAWK campaign totalled 1.85 km² of map; this is
54 times that in one continuous streamed space.

Nothing is stored. Every field is a pure function of `(seed, x, z)`, so the map screen, the
contract generator, the simulation and the mesh builder all ask the same questions and get
the same answers, and only the part you can see is ever realised.

## The world — `src/worldgen.js`

Deterministic in the seed and nothing else. Gradient noise over a sixteen-entry gradient
table (a sine per lattice corner cost four times as much), composed into fields:

- **continent** — noise against an edge-distance frame, so land fills the region and the
  water is a coast you can follow rather than a void you fall off
- **elevation** — continental shape × blended hills and ridged mountain spines, with river
  courses carved down the valleys of a ridged field
- **moisture**, **temperature** — independent fields, temperature led by latitude with a
  lapse rate for altitude
- **eight biomes** classified from those three: open water, shoreline, delta wetland,
  highland jungle, savanna, badlands, pine highland, alpine ridge

The classifier's thresholds live in one `BANDS` table, tuned by coordinate descent against a
measured sweep of the region rather than guessed. Current coverage, with 66% land:

| biome | share | biome | share |
| --- | --- | --- | --- |
| open water | 34.3% | badlands | 8.2% |
| shoreline | 3.6% | pine highland | 15.0% |
| delta wetland | 8.8% | alpine ridge | 5.2% |
| highland jungle | 10.2% | savanna | 14.6% |

On top of the fields: **five factions** holding noise-warped territory around deterministic
seats, **51 settlements** (about one per 2 km²) placed per cell where the ground allows and
named, owned, sized and typed from the hash, and a **home yard** found by spiralling out from
the centre for flat, dry, unclaimed ground clear of anyone else.

`groundHeight()` is the terrain as the helicopter and the mesh see it: raw elevation,
flattened into a platform under each settlement so pads and buildings sit level. It is kept
separate from `elevation()` because site selection asks for the raw terrain.

A height sample costs 0.44 µs, which puts a full-detail chunk's heightfield at 0.48 ms.

## The streamer — `src/streaming.js`

Knows nothing about geometry. It answers which chunks should exist and at what detail, then
drives two callbacks to make the world match within a per-frame budget. That separation is
what makes the invariants testable without a GPU:

- chunks are 125 units (625 m); three detail rings reach 575 m past the screen edge
- the wanted set is nearest-first and clips at the region boundary
- a chunk is released before its replacement is built, so peak memory is one chunk rather
  than a ring
- nothing is built twice; everything is released exactly once
- residency stays bounded flying the length of the region

`buildChunk` in `src/terrain.js` turns a chunk into at most four meshes — ground, scatter,
settlement, glazing — with colour in the vertices so a chunk shares one material per class.
Chunk edges hang a skirt so a coarser neighbour cannot show daylight.

Measured around the yard: **66 chunks, 105 meshes, 46,500 triangles held, 80 draw calls a
frame**, 1.6 ms to build a chunk. After a 3 km transit: 141 built, 96 released, residency 66,
leak zero.

## The outfit — `src/agency.js`

Pure data and pure functions; no renderer, no DOM. Money, crew, airframe, base, standing, and
the contracts that come out of all of it.

- **standing** runs hostile → wary → neutral → working → trusted → allied, per faction. A
  faction below −45 stops offering work entirely.
- **a rivalry matrix** is the engine that stops you staying neutral: hitting someone earns
  credit with everyone who dislikes them and costs you with everyone who does not.
- **contracts are generated from the world** — real settlements, their real owners, your real
  standing. Eight kinds from survey and delivery up to strike and interdiction. Pay scales
  with distance, risk and how much the client likes you. Nobody hires you to bomb their own
  town, and a faction you are close to stops being offered as a target.
- **the board grows** with your radio mast and a fixer on the payroll.
- **progression**: nine upgrades across the yard and the airframe, four hireable crew gated
  behind facilities, wages out of the tin at the end of each day, and a ledger.

You begin with **Margit Quill**, radio and base manager, who has no interest in your feelings
about any of it and always has a line about the state of the outfit.

## What is wired and what is not

Wired: the region, the streamer, chunk meshing, flight over streamed terrain, the region map,
the contract board, accepting a job, flying to the site and home again, payment, standing
movement, the day rolling over, and the telemetry that shows all of it.

Not yet: combat in the open world (weapons, threats and the enemies that make a strike
contract mean something), the per-kind objective logic from the campaign engine ported onto
contracts, the base and crew screens, saving, and biome-boundary blending — adjacent biomes
currently meet on a hard classifier edge.

The BLOCKHAWK campaign is untouched and still builds, tests and deploys; see `README.md`.
