# MERCENARY STRIKE — infrastructure

An open-world successor to the BLOCKHAWK campaign. You start in a makeshift yard with a
bottom-of-the-barrel helicopter and one colleague, and you fly whatever pays. The region is
a hotspot; the work you take decides who talks to you and who shoots at you.

This document covers what exists now: the region and the nine distinct areas inside it, the
streamer, the outfit that turns the world into work, the combat that makes it dangerous, and
the twelve kinds of job you fly.

```powershell
npm run world          # builds the game and serves it
npm test               # 148 checks across ten suites
npm run verify:world   # 33 browser checks against the built bundle (server must be running)
```

Open **http://localhost:4189**. `W A S D` fly, `SHIFT` throttle, `SPACE` climb, `C` descend,
`SPACE` fire, `E` winch, scan or mark, `F` flares, `1 2 3` weapons,
**wheel or `-` `=` zoom**, `0` reset the view, `Q` get out or climb back in,
`B` the yard, `M` region map, `H` back to the pad, `G` hide the panels, `/` the brief.
`?seed=12345` generates a different region.

MERCENARY STRIKE is what the site serves at its root. The BLOCKHAWK campaign it grew out of
keeps its own page at `/blockhawk.html`.

A first visit does not get a briefing. It starts you on foot in the yard and teaches itself
one sentence at a time, in about a minute, with a delivery already in your hands — see
**The first minute** below. Quill's briefing still exists and still describes the region that
was actually generated, but it is a reference panel now: `/`, or THE BRIEF in the yard.

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

Out of the aircraft both of you get a ring at any zoom: amber where you left the machine, and
blue on the pilot. The pilot's used to wait for 1.35x like everything else, which meant that
at the default view the first thing the opening asks you to do — walk — began by finding a
figure a dozen pixels tall in a yard.

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

## The renderer — `src/stage.js`

**WebGPU where the browser has it, WebGL 2 where it does not**, from one code path. three's
`WebGPURenderer` picks its own backend and falls back on its own; `?webgl` forces the
fallback, which is how both are exercised in the same browser and how the browser suite
checks them against each other.

What that costs is that nothing in the pipeline can be GLSL any more. `EffectComposer`,
`UnrealBloomPass`, `OutputPass` and a hand-written `ShaderPass` became one node graph, and
the sea's `onBeforeCompile` string surgery became a node material — both now compile to WGSL
or to GLSL depending on where they land. Two smaller consequences: the bundle is an ES module
rather than an IIFE, because the renderer has to await a WebGPU adapter before anything can
be drawn and top-level await is not expressible in an IIFE; and the manual
`shadowMap.autoUpdate` / `needsUpdate` dance is gone, because `WebGPURenderer` decides for
itself when its shadow maps need redrawing.

The two backends are measured against each other rather than assumed equivalent. On the same
seed, at the same place, they agree to within the noise:

| | brightness | saturation | brightest pixel |
| --- | --- | --- | --- |
| WebGPU | 0.640 | 0.604 | 0.738 |
| WebGL 2 | 0.638 | 0.609 | 0.736 |

A fallback that renders something *different* is not a fallback, so the suite fails if they
diverge by more than a few percent on any of those.

The cost of carrying the WebGPU build of three is **702 KB → 1063 KB** for the single file.
The bundle still holds exactly one copy of three: everything that imports the bare specifier,
including the addons, is redirected to the WebGPU build by a resolver plugin, because two
copies would mean two sets of class identities that do not recognise each other's geometry.

## Colour and light — `src/look.js`

Biome boundaries are **truly blended**, not dithered. Each vertex classifies itself and four
probes either side of it in the classifier's own units; deep inside a biome all five agree
and the colour is exact, and within about fifteen metres of a threshold the colour is the
mixture. Every biome's three ground colours are converted to linear once at load, which makes
a real blend cheaper than the single hard lookup it replaced.

The look itself is measured against the original rather than chosen by eye. MERCENARY STRIKE
had drifted grim — the light was down a third from the campaign it grew out of, and the frame
was spending itself in two brightness buckets. So the campaign was measured first, as a
target. Across four places, reading only the middle of the screen so neither game's interface
counts:

| | brightness | saturation | brightest pixel | brightness buckets in use |
| --- | --- | --- | --- | --- |
| BLOCKHAWK, the original | 0.499 | 0.335 | 0.848 | 4.8 |
| this, before | 0.536 | 0.423 | 0.625 | 2.0 |
| this, now | 0.561 | 0.560 | 0.780 | 3.5 |

The surprise in that target is that the original is **neither brighter nor more saturated**
than what this already had. What makes it feel upbeat is the last two columns: real
highlights, and a frame that uses its range instead of pooling in the middle. Chasing
saturation, which is what the previous pass did, was aimed at the wrong quantity.

Three changes got there. The light went back to the campaign's own numbers — hemisphere 1.25
to 1.78, sun 2.6 to 3.75, fill 0.5 to 0.66. The tone curve is Khronos PBR Neutral at exposure
1.5; **AgX cannot get there from here at any setting**, and was measured across three light
levels and four exposures to confirm it — every combination came back with two or three
buckets in use and up to 81% of the frame in a single one. And bloom is set to the campaign's
exact parameters (0.22 / 0.55 / 1.15), whose threshold sits above 1 so that it catches only
what is genuinely over-bright in linear terms — snow, salt, glazing, a muzzle flash — and
leaves the ground alone. Dropping that threshold far enough to catch terrain takes the frame
to a mean of 0.9, which is measured, and is not what the original does.

The remaining gap is the range: 3.5 buckets against the original's 4.8. An open landscape has
fewer bright built accents than a campaign compound full of white buildings and orange
markers, and that is most of it. Ambient occlusion — which the campaign runs in its Cinematic
preset — is the obvious next lever and is not in yet.

**Each area also carries its own tone**, which is what stops nine regions sharing one mood.
Nine near-white tints, applied at a third strength and eased as you cross a border so the
light changes with the country rather than at a line. Measured per place, the areas genuinely
diverge:

| area | brightness | saturation | reads as |
| --- | --- | --- | --- |
| THE SALT PANS | 0.68 | 0.60 | glare |
| THE LONG SAVANNA | 0.63 | 0.64 | open, warm |
| THE WHITE SPINE | 0.50 | 0.29 | cold, thin air |
| THE GREEN DELTA | 0.44 | 0.71 | wet and lush |

Weather takes the tint off for the job that carries it: its own mood wins. The grit and the
dirt belong later, when the region has turned on you — the opening should look like a good
day to be flying.

## The controls — dual-stick

**The left hand flies and the right hand points.** Movement is screen-relative and entirely
independent of where the nose is, so the aircraft crabs, slides and flies backwards the way a
gunship actually fights: you can run from a checkpoint with the gun still on it.

| | fly | aim | land | get out |
| --- | --- | --- | --- | --- |
| desktop | `W A S D` | the mouse, or the arrow keys | hold `C` | `Q` |
| phone | left thumb stick | right thumb stick (hold to fire, slide to aim) | the rail's LAND | the same button again |

On foot the left stick walks instead of flying, and the right one still points the pilot.

The mouse aims at the ground under the cursor, and **lets go again** — it aims while it has
moved in the last couple of seconds or while the trigger is down, and then the nose falls in
behind the direction of travel. Without that, moving the mouse once and then flying on the
keyboard would leave the nose locked to wherever the cursor was last parked. There is a
dead zone of eighteen units around the aircraft, or a cursor resting on the machine swings
the nose about on sub-unit differences.

With no aim input at all the nose follows travel, at the rate the airframe can manage —
slower the faster you are going. An aim input overrides that and turns much more quickly,
because pointing the aircraft is aiming a gun rather than flying a turn.

Two bugs were in the way of this, and both are now asserted against:

- **The aircraft flew tail-first.** The nose is the model's own local −Z, so rotating it by a
  heading `h` pointed it along `(−sin h, −cos h)` while the round went along `(sin h, −cos h)`
  — mirrored in x. It looked perfectly correct flying north or south and flew backwards going
  east or west, which is exactly how it was reported. There is now one heading convention,
  written down, shared with `combat.js`, and the model takes the negative of it.
- **Every input was skewed twelve degrees.** The ground directions for "screen right" and "up
  the screen" had been written out with their components transposed — 0.63/−0.78 where the
  camera calls for 0.78/−0.63. They are now derived from the camera offset, so they cannot
  drift from it again.

The browser suite reads the nose straight off the scene graph rather than recomputing it,
because the algebra is what hid the bug in the first place: it flies all four directions and
fails if the nose and the travel disagree, checks that the arrows and the mouse each point the
aircraft independently of where it is going, and checks that rounds leave along the nose and
not along the travel.

## Landing, and getting out — `src/crew.js`

The flight model never landed. It held a clearance of eleven units over whatever was below
and floored at four, so the lowest you could get was **twenty metres off the deck with the
rotor still turning**. Holding the descend control now takes the skids all the way down.

**You can put it down almost anywhere.** Measured across the region, **81% of the dry ground
accepts a landing**; the rest is genuinely cliff or shoreline. The limit is deliberately more
generous than the real thing — a slope landing in most types is held to ten or fifteen
degrees, and this region's grade distribution has a median of 0.18 with a long tail (p90 of
0.8), so a realistic limit would refuse nearly a third of the map. Thirty degrees reads as
"if it looks flat enough, you can put it down" while the sea and a mountain face still say
no, and say which:

| refused | because |
| --- | --- |
| WATER BELOW — NOWHERE TO PUT IT DOWN | the surface under you is sea |
| HALF OVER WATER | the footprint straddles the shoreline |
| TOO STEEP FOR THE SKIDS | one skid would take the whole machine |
| TOO FAST TO SET DOWN | over 50 km/h across the ground is an arrival, not a landing |

The grade is measured across the footprint rather than at a point, because a machine sits on
its whole undercarriage and one sample can miss the edge of a gully. Over ground it cannot
use, it holds a low hover instead of refusing silently. The rotor winds down once it is
down — to 0.11 of its speed within three seconds — which is most of what makes a landing
read as a landing rather than a hover at zero altitude.

**Then you can get out.** `Q` on a keyboard, or the rail button on a phone, puts the pilot
out of the door and onto the ground; the same control climbs back in, and only from within
eight units of the aircraft.

On foot:

- the pilot **walks at 7 km/h and runs at 20**, which is a generous sprint in flight gear but
  makes crossing a hundred-and-fifty-metre settlement a twenty-seven-second job rather than a
  two-minute one
- the camera comes in to **42% of the flight view**, because a person is under two units tall
  in a hundred-unit frame, and it frames the pilot rather than the machine
- the streamer loads around **whoever you are controlling**, so walking away keeps the world
  coming
- the telemetry panel reports the pilot's position, altitude and pace — reading the parked
  aircraft's zero while you are walking is simply wrong
- **you will not walk into the sea**, and each axis is tried separately so you slide along a
  shoreline rather than sticking to it
- the legs swing off distance covered rather than off the clock, so they do not pedal when
  you stop
- the map marks the pilot separately from the parked aircraft, with a line between them,
  because a person is invisible at map scale and walking away from your ride is the one
  mistake this makes possible

Firing, the winch and mission work all belong to the aircraft in the air, so they do nothing
while you are out of it, and the engine burns no fuel sitting there. `H` — back to the pad —
puts you in the aircraft and airborne again from wherever you were.

Not yet: the pilot cannot be shot at, and cannot shoot. Getting out in a hostile area is
currently free, which is the obvious next thing this wants.

## Flight — `src/flight.js`

The aircraft used to cruise at **468 km/h and dash at 828**, which is a jet. It made a
ten-kilometre region feel like a courtyard: the far corner was forty seconds away and the
whole map was a minute wide.

It now flies like the machine the game says it is:

| | this | AH-64E | Mi-28N | Ka-52 | Tiger | AH-1Z |
| --- | --- | --- | --- | --- | --- | --- |
| cruise | **265 km/h** | 278 | 270 | 260 | 230 | 265 |
| top | **315 km/h** | 293 | 320 | 300 | 290 | 300 |

Which is what the region was always sized for. Crossing all ten kilometres takes **2 min 16 s**
at cruise and 1 min 54 s flat out; a job on the far side is a real transit rather than a hop,
and a contract's distance is something you feel instead of something you read off the board.

Two details matter as much as the top figure. The machine takes **1.25 seconds** to answer the
throttle rather than a third of one, and that delay is most of what makes the dash feel like a
dash when it is only a fifth faster — it is also what stops three tonnes of helicopter changing
direction like a car. And turning slows as you speed up, because a rotor that pivots on the
spot in the hover has to fly a radius at three hundred kilometres an hour.

Fuel follows. A full basic tank is **35 km at cruise — two and a half times the region's
diagonal** — so anywhere on the map is reachable and back, and the gauge still matters.
Dashing costs range, which is the trade it should be. And "hovering", which the winch and the
scan both require, is now 40 km/h rather than the 162 it used to be: you could previously
winch a survivor aboard on a fast pass.

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

### The yard you stand in — `src/yard.js`

`findHomeSite` picked a flat, dry, unclaimed patch and the game drew nothing on it, so the
place the whole outfit is built from was an empty field. It is now **692 triangles in one
merged mesh**: a scraped circle of dirt with a ring of stones round it, two tents pitched
across each other, a folding table, a crate, fuel drums standing in the dirt, a tarpaulin on
four poles where the repairs happen, and a five-metre whip aerial. Nothing more, because at
the start you have paid for nothing.

Every piece is gated on the profile, so the fittings you buy in the yard screen change the
yard you are standing in — the dirt becomes poured concrete with a painted ring and a
windsock and then amber lights, the drums become a bowser and then a buried tank with a pump,
the tarpaulin becomes a gantry and then a shed, the whip becomes a ten- and then a
sixteen-metre mast, and a hangar frame appears behind the pad. Buying anything rebuilds the
mesh on the spot. Every piece is also sat on `world.groundHeight` under itself, because the
home site is flat but not level and nothing here flattens the terrain.

## The first minute — `src/tutorial.js`

The opening used to be a briefing card with a button, which is homework rather than an
introduction. It is now **ten steps, one sentence each**, and each sentence is attached to
something the player has to actually do:

| Step | What it says, and what clears it |
| --- | --- |
| `yard` | names the region you are standing in — walk |
| `trade` | you fly for money, no army and no flag — keep walking |
| `board` | that machine is everything you own — `Q` at the door |
| `lift` | `SPACE` is the collective — take her up |
| `fly` | `W A S D` flies her, the mouse points her — get clear of the pad |
| `job` | there is already a crate aboard, for a named settlement |
| `map` | `M` for the region, the ring is the drop — open it |
| `drop` | hold `E` over the ring to set the crate down |
| `home` | your own pad is the only place that refuels you — go back |
| `done` | take another, spend the fee, keep going |

A step holds its sentence for its own minimum however fast the player is, so the script cannot
flicker past in the first two seconds; it then waits for its own condition and nothing else,
so thirty seconds of walking never teaches you to fly. The dwell times add up to **21.5
seconds** of reading, and a browser play-through of the whole thing took **37 seconds**. `ESC` or SKIP
abandons it for good.

The job in step `job` is not put on the board to be found: `openingContract` in `src/agency.js`
picks the nearest settlement more than 45 units from the yard, builds a full delivery contract
with the same fields `generateContracts` produces, and hands it over. It measures 0.60–0.68 km
across the seeds checked and pays around 1,330 — a pick-up and a drop-off with nobody shooting,
so nothing about the contract board has to be explained before the player has flown one.

`src/tutorial.js` touches no renderer, no DOM and no world: it is a step list and a state
machine that takes a snapshot each tick, which is what makes the whole opening playable in a
unit test in order and at speed.

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
the yard with upgrades and hiring, saving, the yard you stand in and the ten-step opening
that teaches it, the briefing as a reference panel, sound, the winch, and the telemetry that
shows all of it.

Also wired: eight steps of zoom to eight times the default view, reachable by wheel, by key
and by pinching the world; the coarse region mesh that fills the far field; and the
hillshaded region map with its grid, scale bar and collision-avoiding labels, which now pans
and zooms through five steps of its own.

Also wired: the whole game on a phone. A coarse pointer gets a thumb stick that flies and
runs the throttle up at the rim, buttons for firing, the winch, flares and height, tappable
weapon tiles, and a rail down the right edge for the work, the map, the yard and the way
home. Both aspect ratios a phone has are laid out and tested: 9:16 held upright and 16:9
turned over.

Also wired: putting the aircraft down almost anywhere on land, and a pilot who can climb out
of it and walk around on the ground.

Also wired: the renderer, on WebGPU where the browser has it and WebGL 2 where it does not,
both from one code path and both measured against each other; the upbeat look, tuned against
the original's own numbers; a tone per area; and a flight model at a modern gunship's cruise
and top speed.

Not yet: the pilot cannot be shot at and cannot shoot, so getting out in a hostile area is
free; no ambient occlusion, which is the missing lever on tonal range and which the campaign
has; no interiors or ground-level detail (the camera never gets close enough to need
them); no weather beyond the one complication; no day/night cycle; and no persistent
consequences for a faction beyond its standing number — a faction you have ruined does not
yet visibly lose ground on the map.

## The two zooms

They are different things and it is worth keeping them apart.

**The camera** has eight steps, each half a stop, so the eighth shows exactly eight times the
ground of the first: 650 metres across the screen out to 7.4 kilometres. Past 1.3× the
streamed rings no longer reach the edge of the frame and the coarse region mesh carries the
far field, which is built once at boot and therefore cannot stall. Wheel, `-` `=` `0`, or two
fingers on the world — a doubling of the gap between them is two steps, because a step is
half a stop.

**The region map** has five steps, each a halving: the whole ten kilometres down to 625
metres across. It pans by dragging and clamps at the region's edge, and it zooms about
whatever is under the pointer or between the fingers, so the thing you are looking at stays
where you are looking.

The map redraws its terrain for the window it is showing rather than magnifying the picture
it already had. That is the only reason to zoom a map: the height field is resampled at the
new scale, the hillshade recomputed, the kilometre grid stepped down to five hundred, two
hundred or a hundred metres, the scale bar relabelled, and the smaller settlements given
their names once there is room. Zoomed in, ten kilometres across a 620-pixel canvas — forty
metres to the pixel — becomes about one metre to the pixel.

Drawing that base costs a hundred-odd milliseconds, because it samples the height field for
every other pixel, so it waits for the hand to come off. While a finger is down the existing
base is scaled and offset to the new window, which keeps the map moving under the hand; the
picture sharpens a moment after it stops. Six quick pans cost one redraw, not six — an
earlier version redrew on every release and blocked the main thread for most of a second,
which was long enough for the browser to throw away the next tap.

## Verification

- **148 module checks** across ten suites: the campaign parity harness, the campaign
  levels, the world and streamer, the outfit, combat and the first eight kinds, the region
  layer with its landmarks and place names, the newer four kinds with their complications,
  flight and the speed envelope, landing and walking, and the opening script — which is played
  through the way a player would play it and checked for one sentence per step, an order that
  teaches boarding before flying, a step that cannot be skipped past in a single frame, and a
  minute that does not turn into five.
- **33 browser checks** (`npm run verify:world`) against the built single file served at the
  site root: it boots and renders on both backends to the same picture, a first run starts on
  foot in a yard that exists and is taught one sentence at a time, the opening plays in order
  and hands the pilot a delivery without a trip to the board, the briefing opens on demand and
  still describes the generated region, the teaching can be abandoned, the frame keeps the original's upbeat range and each area carries its
  own tone, real keyboard input flies the aircraft at a gunship's cruise and top speed, the dual-stick
  controls fly and aim independently and the gun follows the nose, the aircraft lands on its
  skids and the pilot gets out and walks, the camera stays above the ground everywhere including the highest
  ground the sweep can find, nine regions and nine landmarks exist and the readout changes as
  you cross them, every landmark streams in without error, the zoom ladder reaches exactly
  eight times the default with the far field filling it, the coarse mesh stays under the
  streamed terrain, the map draws inside a frame budget and repaints without accumulating
  markers, the map and yard open on real keys, all twelve kinds reach the board, a real key
  press pays the winch cable out, a contract can be flown for money, progress saves and
  survives a reload, weather closes in and lifts, a ten-kilometre transit stays bounded, the
  map pans and zooms through its five steps under a real wheel and a real mouse drag and
  redraws the terrain at each scale, and there are no external requests or script errors.
- **39 mobile checks** (`npm run verify:mobile`), the same built file at 390×844 and 844×390
  with touch emulation and a phone user agent, driven by real browser-level touch input
  through the debugger protocol rather than synthesised events — so pointer capture, gesture
  recognition and `touch-action` behave as they do under a thumb. Both orientations: it boots
  and knows it has a coarse pointer, the opening sentence is on screen and clear of every
  control a thumb lands on, a tap on SKIP gets past the teaching, the briefing is reached from
  the yard and fits with its one button on screen, no panel
  hangs off an edge and the page does not scroll sideways, the chrome covers 14% of the screen
  upright and 20% turned over rather than the 63% it used to, a thumb on the stick flies the
  aircraft and releasing it centres, the fire button puts rounds in the air and the winch
  button pays the cable out, pinching the world reaches both ends of the eight-step ladder
  without the browser zooming the page instead, the map fits with every control reachable,
  pinching it zooms and redraws the terrain at the new scale, dragging pans it and stops at
  the region's edge, six quick pans collapse into one redraw, reset and close work on a tap,
  the rail opens the board and the yard, weapon tiles switch on a tap, and the home button
  flies you back to the pad.

The BLOCKHAWK campaign is untouched: it still builds to the byte (`dist/blockhawk.html`
hashes to the value pinned in `QA.md`) and its 19 browser checks still pass. See `README.md`.
