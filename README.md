# MERCENARY STRIKE

A helicopter mercenary open world: one continuous streamed **100 km² region**, divided into nine
named areas that each look and fly differently, with five factions who will hire you, twelve
kinds of contract, and an outfit you build out of a makeshift yard. Nothing is stored — the
whole region is a pure function of its seed, so `?seed=12345` is a different hundred square
kilometres.

It grew out of **BLOCKHAWK: Signal Storm**, the five-operation campaign that is still here and
still playable, and which the open world borrows its flight model, winch and synthesised
audio from.

## Play

Play at **[new-strike.vercel.app](https://new-strike.vercel.app)** — or the campaign at
**[/blockhawk.html](https://new-strike.vercel.app/blockhawk.html)**. Both are single HTML
files with the rendering library, models, fonts, interface, audio and licence notices
embedded: they make no external requests and work offline. Open
**[dist/world.html](dist/world.html)** or **[dist/blockhawk.html](dist/blockhawk.html)**
directly in Chrome, Edge, Firefox or Samsung Internet with WebGL 2 enabled.

For a local server:

```powershell
npm install
npm run build && npm run build:world
npm start
```

Visit **http://localhost:4189** for MERCENARY STRIKE, or **/blockhawk.html** for the campaign.
The dev server resolves paths the way the deployment does, so a link that works locally works
live. To play on a phone on the same Wi-Fi, open `http://<your-PC-LAN-address>:4189`.

## MERCENARY STRIKE

**Dual-stick: the left hand flies and the right hand points.** `W A S D` fly · **the mouse or
the arrow keys aim** · `SHIFT` throttle · `SPACE` climb · `C` descend · `SPACE` fire · `E`
winch, scan or mark · `F` flares · `1 2 3` weapons · **wheel or `-` `=` zoom** · `0` reset the
view · `Q` get out or climb back in · `B` the yard · `M` the region map · `H` back to the pad ·
`G` hide the panels · `/` the brief.

**The first minute teaches itself.** A first run starts you on foot in the yard — two tents, a
scraped circle of dirt, some drums and a tarpaulin — and gives you one sentence at a time: you
fly for money, that machine is everything you own, `SPACE` is the collective, `M` is the map.
A delivery is already in your hands by the time the map is explained, because the first job is
assigned rather than left on the board: fly to the ring, hold `E`, come home. Ten steps, about
a minute, and `ESC` or SKIP abandons it. Quill's briefing on the region is still there as a
reference panel, on `/` or THE BRIEF in the yard.

Movement is screen-relative and independent of where the nose is, so the aircraft crabs and
flies backwards the way a gunship fights — you can run from a checkpoint with the gun still on
it. On a phone the right thumb is the second stick: hold to fire, slide to aim.

**Hold `C` to set the machine down** — 81% of the dry ground in the region will take it, and
the sea and a cliff tell you why they will not. Once it is down, **`Q` puts you out on foot**:
the pilot walks at 7 km/h and runs at 20, the camera comes in close, and the same key climbs
back in from within eight units of the door. On a phone the rail button does all three in
turn: LAND, GET OUT, BOARD.

On a phone the left thumb flies — pushed to the rim it runs the throttle up — and the right
thumb fires, winches and throws flares, with `▲ ▼` for height, tappable weapon tiles, and a
rail down the right edge for the work, the map, the yard and the way home. Both orientations
are laid out: 9:16 upright and 16:9 turned over.

The view zooms across **eight steps to eight times the default**, from 650 metres of ground
across the screen to 7.4 kilometres, by wheel, by key, or by pinching the world. Everything
past the streamed chunks is one coarse mesh of the whole region, built once, so pulling back
never stalls.

It renders on **WebGPU** where the browser has it and **WebGL 2** where it does not, from one
code path — `?webgl` forces the fallback, and the two are measured against each other rather
than assumed equivalent. The aircraft flies at a modern gunship's speeds, **265 km/h cruise
and 315 flat out**, which is what the ten-kilometre region was always sized for: crossing all
of it takes a little over two minutes.

The **region map pans and zooms** through five steps of its own, from the whole ten kilometres
down to 625 metres across — drag to pan, pinch or wheel to zoom about the point you are
looking at, `0` for the whole region. It redraws the terrain for the window it is showing
rather than magnifying the image it had, so zooming in resolves more ground: the hillshade is
resampled, the grid steps down to 500, 200 or 100 metres, and the smaller settlements get
their names once there is room for them.

The full design and its measurements are in **[MERCENARY.md](MERCENARY.md)**: the region layer,
the nine landmarks, the streamer, combat, the twelve contract kinds and the verification.

## Deploy

The build output is a plain static directory, so any static host works. This repository ships a `vercel.json` that sets the build command to `npm run build && npm run build:world` and the output directory to `dist/`, which holds `index.html` and `world.html` (MERCENARY STRIKE, served at `/` and `/world.html`) alongside `blockhawk.html` (the campaign). No serverless functions, rewrites or environment variables are needed.

```powershell
vercel --prod
```

Importing the repository in the Vercel dashboard needs no extra configuration; `vercel.json` supplies it. The GitHub repository is connected to the Vercel project, so pushes to `main` deploy to **https://new-strike.vercel.app** automatically.

## Campaign controls

| Action | Desktop | Touch |
| --- | --- | --- |
| Fly | WASD or arrow keys, in screen directions | Left joystick |
| Fire | Hold Space or left mouse | Hold FIRE |
| Aim | Mouse pointer, or automatic lock in front of the nose | Automatic lock; keep firing to strafe around a target |
| Select weapon | 1 / 2 / 3 or mouse wheel | Tap weapon tile |
| Hold heading / strafe | Shift | Keep FIRE held with a target locked |
| Rotate | Q / R | Flight direction turns the aircraft |
| Winch / repair / rearm / land | Hold E in the marked zone | Hold WINCH / SUPPLY / LAND |
| Flares | C, seven-second cooldown | Tap FLARES |
| Tactical map | M | Tap minimap |
| Pause | Esc or P | Pause button |
| Field manual / mute | H / V | Top buttons |

## BLOCKHAWK: Signal Storm — the campaign

An original helicopter combat campaign inspired by the overhead flight, linked objectives,
rescue winch and resource management of the **Strike** series. Five operations across a
near-future archipelago, one attack helicopter, twenty-six linked objectives and a complete
success/failure loop. Served at **/blockhawk.html**, unchanged: it still builds to the byte
and its 19 browser checks pass.

## The campaign

Five operations, unlocked in order. The briefing screen selects any operation you have reached, and each keeps its own best score per difficulty.

| # | Operation | Map | Objectives |
| --- | --- | --- | --- |
| 01 | **TERN DELTA** | 314 × 314 | Destroy the coastal radar · winch four engineers · break the shield and destroy the Storm battery against a five-minute clock · extract |
| 02 | **KETTLE SOUND** | 600 × 600 | Sink four gunboats · clear the crash site and winch three aircrew · take the harbour master alive · hand everyone over at Port Kettle · drop the causeway · extract |
| 03 | **ASHFALL BASIN** | 640 × 640 | Burn a five-tank fuel farm · clear four anti-air batteries inside a four-minute corridor · scan the launch site · clear the camp and winch four prisoners · hand them over · extract |
| 04 | **GLASS HIGHWAY** | 680 × 680 | Escort the relief column to the depot · intercept the staff car before the ferry ramp · drop the highway bridge · winch three civilians · hand them over · extract |
| 05 | **IRON FORTRESS** | 720 × 720 | Break three shield nodes · destroy the silo against a five-and-a-half-minute clock · take the commander alive · bring him home |

Objectives come in nine kinds: destroy named targets, destroy every unit with a tag, winch survivors, take a prisoner alive, hand cargo over at a named pad, hold a scan on a zone, escort a friendly column, intercept a unit before it escapes, and extract. Handing people over patches the airframe, in the manner of the games this borrows from. A prisoner killed instead of captured, a column left uncovered, a unit that reaches its escape point and a clock that runs out each end the operation.

Green pads repair armor, refill fuel and restock all weapons. Supplies are unlimited. The cannon is useful against light targets, rockets have area damage, and seekers track their locked target. Volatile fuel drums can cause chain explosions. Enemy missiles can be distracted by flares. Armor loss, fuel exhaustion and failing to stop the launch end the mission.

Recon, Pilot and Ace adjust incoming damage, enemy fire rate and fuel use. Debrief includes a rank, score, time, rescues and destroyed targets. Best scores and campaign progress are saved locally per operation and difficulty when browser storage is available. Progress inside a single operation is not saved after closing the page.

## Rendering and performance

Three.js r186 / WebGL 2 with physically based materials, dynamic soft shadows, HDR bloom, AgX tone mapping, animated water normals, rotor wash, smoke, sparks, debris, terrain-following flight and responsive camera banking/shake. The Cinematic preset adds GTAO, subtle focus-based depth of field, 4× multisampling and 4096px shadow maps. Static scenery and each animated model are merged by shading class with colour carried per vertex, merged geometry is welded and indexed, projectiles and particles use instancing, and mobile rendering caps pixel density and uses smaller shadow maps. Each operation builds in 140–220 ms into 164–246 meshes and 39,000–50,000 triangles, so the larger maps cost no more per frame than the first one; switching operations disposes the previous map's buffers.

Auto selects a graphics preset and can reduce rendering cost if sustained frame rate is low. Graphics and audio controls are in the pause menu. Sound is synthesized locally with Web Audio after a user gesture. Reduced-motion preferences disable grain animation and camera shake.

Desktop graphics were checked on an **NVIDIA GeForce RTX 4070 SUPER**, with short scene samples around 141–144 FPS at 1440×900 using Cinematic settings in Chrome. Android portrait/landscape inputs are tested with browser device emulation. **A physical Samsung S26 has not been tested.** No specific phone frame rate is claimed.

## Source and verification

```powershell
npm test             # deterministic flight, combat, resource and mission invariants
npm run verify       # campaign browser checks; npm start must be running; Chrome required
npm run verify:world # MERCENARY STRIKE on a desktop viewport
npm run verify:mobile# MERCENARY STRIKE at 9:16 and 16:9 with real touch input
npm run build        # rebuild both single-file deliverables
```

- `src/levels.js` — the campaign: each operation's map, pads, roster, objective chain and set dressing.
- `src/core.js` — deterministic objective engine, flight, combat and resource simulation.
- `src/world.js` — procedural island, aircraft, enemy models and effects.
- `src/main.js` — rendering pipeline, camera, keyboard/mouse/touch input and UI.
- `src/audio.js` — synthesized rotor, weapons, explosions and feedback tones.
- `src/shell.html`, `src/style.css` — interface and responsive layouts.
- `tests/core.test.mjs`, `tests/campaign.test.mjs`, `tests/browser.mjs` — automated validation. The campaign suite checks that every pad, unit, patrol leg and convoy route in all five operations sits on the right surface, that every objective resolves against its own level, that each objective kind both completes and fails correctly, and that every operation can be flown to a win.
- `assets/` — brand mark, icons, social card and the subset interface fonts that the build embeds.
- `scripts/make-brand.mjs`, `scripts/make-fonts.mjs` — regenerate those assets from the source faces. They need ImageMagick and uv with fontTools, and are deliberately not part of `npm run build`, which stays node-only.
- `artifacts/verification.json` — latest browser results and measured session statistics.

The browser test flies the entire mission with simulated control inputs, including enemy fire, ammunition use, resupply, rescues and extraction. It does not teleport the aircraft or edit health/ammo/stages in the full mission run. Separate focused input/failure checks use explicit fixtures. Test controls are available only with `?test`; normal play exposes read-only diagnostics at `window.blockhawk`.

The game uses original code, procedural artwork and synthesized audio. Three.js is MIT licensed. The embedded Barlow fonts are SIL Open Font License 1.1. Full notices are included in the HTML and `THIRD_PARTY_NOTICES.txt`. Reference for the inspiration's mission structure: [Nuclear Strike guide, Operation 1: Delta](https://gamefaqs.gamespot.com/ps/198218-nuclear-strike/faqs/26326).
