# MERCENARY STRIKE — infrastructure

An open-world successor to the BLOCKHAWK campaign. You start in a makeshift yard with a
bottom-of-the-barrel helicopter and one colleague, and you fly whatever pays. The region is
a hotspot; the work you take decides who talks to you and who shoots at you.

This document covers what exists now: the region and the nine distinct areas inside it, the
streamer, the outfit that turns the world into work, the combat that makes it dangerous, and
the twelve kinds of job you fly.

```powershell
npm run world          # builds the game and serves it
npm test               # 125 checks across seven suites
npm run verify:world   # 17 browser checks against the built bundle (server must be running)
```

Open **http://localhost:4189**. `W A S D` fly, `SHIFT` throttle, `SPACE` climb, `C` descend,
`SPACE` fire, `E` winch, scan or mark, `F` flares, `1 2 3` weapons,
**wheel or `-` `=` zoom**, `0` reset the view,
`B` the yard, `M` region map, `H` back to the pad, `G` hide the panels.
`?seed=12345` generates a different region.

MERCENARY STRIKE is what the site serves at its root. The BLOCKHAWK campaign it grew out of
keeps its own page at `/blockhawk.html`.

A first visit gets a briefing from Quill that describes the region that was actually
generated — where you are parked, what the nearest landmark is, and what all nine areas are
called. It happens once per seed.

## Scale

One world unit is five metres. The region is 2000 × 2000 units — **10 × 10 km, 100 km²**.
For comparison, the five-operation BLOCKHAWK campaign totalled 1.85 km² of map; this is
54 times that in one continuous streamed space.

Nothing is stored. Every field is a pure function of `(seed, x, z)`, so the map screen, the
contract generator, the simulation and the mesh builder all ask the same questions and get
the same answers, and only the part you can see is ever realised.

## Nine distinct areas — `src/regions.js`

The biome classifier works on purely local fields, so on its own the region came out as an
even wash of the same terrain from corner to corner: you could fly ten kilometres and never
feel you had gone anywhere. The region layer sits above the fields.

Nine seats on a jittered three-by-three grid, each taking one of **nine archetypes**, shuffled
by the seed so the names stay evocative and the layout changes completely from seed to seed:

| area | character | area | character |
| --- | --- | --- | --- |
| THE GREEN DELTA | braided water, standing reed | THE BROKEN COAST | headlands and half-sunk islands |
| THE LONG SAVANNA | grass and nowhere to hide | THE FEVER BASIN | canopy too thick for rivers |
| THE ASH REACH | burnt rock cut into steps | THE SALT PANS | a dead white table |
| THE PINE HIGHLANDS | cold ridges under black timber | THE KETTLE | worked ground, the most people |
| THE WHITE SPINE | the roof of the region | | |

Each archetype bends the fields underneath it through ten channels — how much land there is,
how much relief, how tall it stands, how ridged, how wet, how warm, how many rivers, how
much scatter, how settled, and how dangerous. Measured on the default seed, the areas hold
9–13% of the map each and top out at very different heights:

| area | share | peak | area | share | peak |
| --- | --- | --- | --- | --- | --- |
| THE WHITE SPINE | 12.5% | 147 m | THE FEVER BASIN | 13.1% | 61 m |
| THE PINE HIGHLANDS | 11.0% | 104 m | THE BROKEN COAST | 9.3% | 44 m |
| THE ASH REACH | 9.7% | 96 m | THE LONG SAVANNA | 10.5% | 35 m |
| THE SALT PANS | 11.5% | 73 m | THE KETTLE | 10.2% | 33 m |
| | | | THE GREEN DELTA | 12.3% | 25 m |

Two properties are enforced rather than hoped for, and both are asserted:

- **No seam.** Modifiers are a softmax over the seats by warped distance, sampled on a
  25-unit lattice and interpolated, so they cross a border as a mixture over about 750 m.
  The test walks a two-kilometre transect and fails if any channel jumps more than 0.05
  between adjacent world units.
- **No sliver, and no missing area.** Every archetype appears exactly once on every seed,
  holds between 3.5% and 26% of the map, and only the four archetypes fit to hold a yard
  are allowed the middle seat.

The lattice is one flat `Float32Array` rather than a Map of small arrays: the terrain builder
asks for modifiers on every vertex of every chunk, and four Map lookups plus an allocation
per vertex measured three times the cost of the entire rest of the height field. A blend now
costs **0.060 µs** and is clamped to a bounded lattice, so a query from a million units out
reuses an edge node instead of growing anything.

Because archetypes multiply height, `WORLD.ceiling` is a hard roof approached through a soft
knee. Nothing the generator can produce exceeds it, whatever the seed, so an alpine spine
tops out in a ridge rather than growing up through the camera.

## One landmark per area — `src/landmarks.js`

Terrain alone gives you nothing to point at. Each area holds exactly one structure, built for
silhouette so you can tell which of the nine you are looking at from a kilometre out: the
**drowned chapel** standing in the delta, the **grey dam** across a highland valley, **the ear**
on the highest ground in the region, the **beached freighter** broken in two on the coast,
**the steps** above the canopy, the **boneyard** of stripped fuselages, the **long strip** and its
abandoned airliners, the **evaporators** and their white pans, and the **interchange** that
stopped being built.

Placement scores the ground each kind wants and takes the best candidate in the region rather
than the first acceptable one, so a seed short of ideal ground still gets its landmark on the
closest thing to it instead of quietly going without. Asserted on seven seeds: nine
landmarks, one per area, inside the world, clear of settlements and the yard, each on ground
its kind asks for — the chapel in water, the ear on the regional summit and overlooked from
nowhere, the rest on dry buildable land.

Landmarks are navigation anchors (they outrank a village in the HUD), map markers, and
high-paying contract sites. The ones that were built cut a platform for themselves; the ones
that ran aground do not.

## The world — `src/worldgen.js`

Deterministic in the seed and nothing else. Gradient noise over a sixteen-entry gradient
table, composed into fields: a **continental shape** framed by ocean so the water is a coast
you can follow rather than a void you fall off; **elevation** from blended hills and ridged
spines with rivers carved down the valleys; independent **moisture** and **temperature**;
and **eight biomes** classified from those three.

The classifier's thresholds live in one `BANDS` table, re-fitted by coordinate descent against
a measured sweep of four seeds after the region layer moved the fields underneath it. Current
coverage on the default seed, with 69% land, and every biome stays between 3.3% and 17.6%
across six seeds:

| biome | share | biome | share |
| --- | --- | --- | --- |
| open water | 31.0% | badlands | 7.7% |
| shoreline | 3.4% | pine highland | 9.3% |
| delta wetland | 12.9% | alpine ridge | 9.7% |
| highland jungle | 13.0% | savanna | 13.1% |

On top of the fields: **five factions** holding noise-warped territory, **57 settlements** placed
per cell where the ground allows and named, owned, sized and typed from the hash — with
density and threat set by the region they stand in — and a **home yard** found by spiralling
out from the centre for flat, dry, unclaimed ground clear of anyone else *and out of the
watercourses*, which on the default seed had previously put the pad in a ditch.

A height sample costs **0.606 µs**, which puts a full-detail chunk's height field at 0.66 ms.

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
Chunk edges hang a skirt so a coarser neighbour cannot show daylight. Landmarks build one
detail level further out than settlements, because they are what you navigate by.

**Chunk building is 2.3× faster than before this work**, despite the region layer, true biome
blending and the landmark meshes, because slope is now taken from the surface just built
instead of four more field samples per vertex, and the derived fields are handed the height
they would otherwise recompute:

| | before | now |
| --- | --- | --- |
| bare terrain chunk | 3.75 ms | **1.60 ms** |
| chunk with settlements | 5.45 ms | **2.71 ms** |
| chunk with a landmark | — | **2.66 ms** |

Measured around the yard: 66 chunks, 108 meshes, 47,000 triangles held, 51 draw calls a
frame, 60 fps. After a ten-kilometre corner-to-corner transit: residency bounded, leak zero.

## Zoom and the far field — `src/overview.js`

The view zooms across eight steps, half a stop each, to **exactly eight times the default**:
650 metres of ground across the screen at the near end, 7.4 kilometres at the far end. Wheel
or `-` and `=`; `0` returns to the default.

The streamer reaches about 575 metres past the edge of the screen, which is generous at the
default view and useless the moment you pull back — expanding the rings to cover eight times
the frame would want thousands of chunks. So the far field is not streamed at all. It is one
mesh of the entire hundred square kilometres, 131,000 triangles in a single draw call, built
once in 126 ms a moment after the first frame. The streamed chunks sit on top of it near the
aircraft and it carries the view everywhere else, which is also why zooming out cannot stall:
there is nothing to build when you do it.

The one thing that has to be right is that the coarse surface never pokes up through the
detailed one. Every vertex takes the lowest of itself and its four neighbours and drops a
little further, and land is never allowed below sea level by that process or the coastline
would visibly retreat. Measured against the real field on every land vertex it has:
**0.27% sit above the detailed terrain, and only one of them by more than four units** —
under two pixels at the zoom where the mesh is visible at all. The browser suite asserts it.

Three other things follow the zoom. The camera pulls back, because an orthographic projection
does not care how far away it is but the clip planes do. The fog thins, or the same density
that fades the far chunks into a horizon at the default view would put the whole region behind
a wall of it. And a ring appears on the ground under the aircraft, sized to stay the same size
on screen, because at eight times out the machine itself is two pixels of dark green on a
hillside — a marker rather than a bigger helicopter, so the aircraft stays the size it is.

## The region map

The only place you see all hundred square kilometres at once, so it has to read as terrain
rather than as a colour key:

- a **hillshade** computed from the height lattice, which is what turns a patchwork of biome
  colours into country you can read — ridges, valleys and river courses all show
- **faction territory** as a light tint plus a drawn border, instead of the heavy wash that
  used to bury the ground underneath it
- a traced **coastline**, a kilometre **grid** and a **scale bar**, so ten by ten kilometres is
  something you can measure rather than something the header tells you
- **label placement that refuses to overlap** — regions first, then landmarks, then the larger
  settlements, each trying a few offsets and giving up rather than colliding. It used to print
  SALT WORKS across HOLLOW BASIN.
- the **job in hand**, your yard, the aircraft, and a rectangle showing what the camera can
  currently see, so the zoom reads on the map too

Static content is drawn once into an offscreen canvas and the moving parts composited over it;
before that the aircraft marker was painted straight onto the map every frame, which only
looked right because nothing is allowed to move while it is open. Sampling the fields every
other pixel and resolving the palettes once took the draw from **840 ms to 266 ms**.

Place names are unique now, too. They come from a per-cell hash over a few hundred
combinations, so with fifty-odd settlements the same name landed twice on most seeds — two
IRON SOUNDs on one map reads as a bug rather than as geography. One deterministic pass in cell
order qualifies the later ones, so the map shows IRON SOUND and LOWER IRON SOUND.

## Colour and light

Biome boundaries are now **truly blended**, not dithered. Each vertex classifies itself and
four probes either side of it in the classifier's own units; deep inside a biome all five
agree and the colour is exact, and within about fifteen metres of a threshold the colour is
the mixture. Every biome's three ground colours are converted to linear once at load, which
makes a real blend cheaper than the single hard lookup it replaced.

The tone curve was chosen by measurement, not by eye. Sampling four places — the yard, the
alpine ridge, the delta and the salt pans — AgX put 94% of the frame into two brightness
buckets and averaged 0.41 saturation, which is exactly why every area looked like the same
pale wash. Khronos PBR Neutral at exposure 1.6 holds the same mean brightness and peak,
spreads the frame across four buckets, and carries **0.61 saturation — half again as much
colour**. The salt pans now read as glare and the alpine ridge reads as darker than the
savanna, instead of everything reading as haze.

## The outfit — `src/agency.js`

Pure data and pure functions; no renderer, no DOM. Money, crew, airframe, base, standing, and
the contracts that come out of all of it.

- **standing** runs hostile → wary → neutral → working → trusted → allied, per faction. A
  faction below −45 stops offering work entirely.
- **a rivalry matrix** is the engine that stops you staying neutral: hitting someone earns
  credit with everyone who dislikes them and costs you with everyone who does not.
- **contracts are generated from the world** — real settlements, real landmarks, their real
  owners, your real standing. Pay scales with distance, risk, how much the client likes you,
  and whether the site is somewhere worth naming. Nobody hires you to bomb their own town, a
  faction you are close to stops being offered as a target, and work that needs a fitting you
  have not bought never reaches the board at all.
- **the board grows** with your radio mast and a fixer on the payroll.
- **progression**: nine upgrades across the yard and the airframe, four hireable crew gated
  behind facilities, wages out of the tin at the end of each day, and a ledger.

You begin with **Margit Quill**, radio and base manager, who has no interest in your feelings
about any of it and always has a line about the state of the outfit.

## Combat — `src/combat.js`

Garrisons are generated per chunk from the same seed as the terrain: checkpoints, technicals,
anti-air, patrol boats, radar masts and fuel depots, placed on the surface they belong on and
weighted by the threat of whatever settlement is nearby. They stream in with the chunks, are
simulated only while you are near them, and are remembered once destroyed, so a garrison you
flattened stays flat across a whole campaign.

**Standing decides who shoots.** A faction that tolerates you leaves a rotor overhead alone;
below −12 they engage if you linger; below −45 they fire on sight. Pulling the trigger on
anyone provokes the neighbourhood for the rest of the sortie.

The airframe carries what is fitted: the opening machine has a door gun and nothing else, and
rockets and seekers arrive with pylons. Fuel burns while you fly and tops up over your own
pad, along with armour and ammunition. Run dry or lose the armour and the aircraft is lost.

## Twelve kinds of work — `src/missions.js`

All twelve are flyable and every one can fail:

| kind | what you do | how it goes wrong |
| --- | --- | --- |
| survey | hold a steady scan over the site | leaving or racing through resets it |
| delivery | set a crate down on site, then come home | — |
| extraction | winch three survivors, fly them back | — |
| salvage | winch a wreck out of open ground | — |
| patrol | fly four waypoints around the site | — |
| escort | keep a slow column alive to its destination | an uncovered column burns |
| strike | flatten the garrison at the site | — |
| interdiction | stop a vehicle before it reaches the border | it gets away |
| sabotage | set two charges, then be clear when they blow | shooting what you came to mine; being inside the blast |
| spotter | hold a designator from stand-off range | closing on the guns gets you seen |
| search | fly a signal to a beacon with no marker | the battery dies before you find it |
| quiet run | route cargo in without crossing a sensor | being painted with the cargo aboard |

The last four each invert a habit the first eight teach — stand off instead of closing,
navigate on an instrument instead of a marker, route around instead of through, and get clear
instead of holding station. Strike, interdiction, sabotage and spotter push their targets
straight into the combat hostile list, so there is one damage model rather than two, and
mission targets are cleaned out when the job ends.

**Complications** attach to any kind, on about a third of the board, and are pure data the
mission layer reads — so a new one is not another code path per kind:

| complication | what it does |
| --- | --- |
| WEATHER CLOSING | the visibility closes in and lifts again with the contract |
| SITE IS HOT | two more guns than the brief mentioned |
| ON THE CLOCK | a deadline that can end any job |
| SALVAGE RIGHTS | a lower fee, but anything you break on the way pays double |

## The yard

Press `B`. Nine fittings across the base and the airframe, each with its level, its
description and its price; four hireable crew gated behind the facilities they need. Buying a
fitting rearms the aircraft on the spot. Progress saves to local storage per seed, and a save
from an older build still boots because it is merged over a fresh profile rather than
replacing it. With any panel open the aircraft holds station instead of drifting away while
you read.

## Sound and the winch

Sound is the campaign's synthesised engine, so the open world costs no assets: a filtered
noise rotor with a beat under it that tracks your speed, and short cues for firing, hits,
explosions, incoming missiles, flares, radio and every mission event. It starts on the first
key or click, because no browser will open an audio context without a gesture.

The winch is fitted to the open-world airframe: five of the twelve kinds are things you lower
a hook for, and the cable pays out to just above whatever is underneath you, sways while it
hangs, and winds back in when you let go.

## What is wired and what is not

Wired: the region and its nine distinct areas, the nine landmarks, the streamer, chunk
meshing with blended biomes, flight, the region map with region names and landmark markers,
combat with streamed garrisons, standing-driven hostility, all twelve contract kinds with
their failure states, four complications, the contract board, payment, the day rolling over,
the yard with upgrades and hiring, saving, the first-run briefing, sound, the winch, and the
telemetry that shows all of it.

Also wired: eight steps of zoom to eight times the default view, the coarse region mesh that
fills the far field, and the hillshaded region map with its grid, scale bar and
collision-avoiding labels.

Not yet: no interiors or ground-level detail (the camera never gets close enough to need
them), no weather beyond the one complication, no day/night cycle, and no persistent
consequences for a faction beyond its standing number — a faction you have ruined does not
yet visibly lose ground on the map. The region map does not pan or zoom; it does not need to
at this scale, but a larger region would want it.

## Verification

- **125 module checks** across seven suites: the campaign parity harness, the campaign
  levels, the world and streamer, the outfit, combat and the first eight kinds, the region
  layer with its landmarks and place names, and the newer four kinds with their complications.
- **17 browser checks** (`npm run verify:world`) against the built single file served at the
  site root: it boots and renders, the briefing describes the generated region, real keyboard
  input flies the aircraft, the camera stays above the ground everywhere including the highest
  ground the sweep can find, nine regions and nine landmarks exist and the readout changes as
  you cross them, every landmark streams in without error, the zoom ladder reaches exactly
  eight times the default with the far field filling it, the coarse mesh stays under the
  streamed terrain, the map draws inside a frame budget and repaints without accumulating
  markers, the map and yard open on real keys, all twelve kinds reach the board, a real key
  press pays the winch cable out, a contract can be flown for money, progress saves and
  survives a reload, weather closes in and lifts, a ten-kilometre transit stays bounded, and
  there are no external requests or script errors.

The BLOCKHAWK campaign is untouched: it still builds to the byte (`dist/blockhawk.html`
hashes to the value pinned in `QA.md`) and its 19 browser checks still pass. See `README.md`.
