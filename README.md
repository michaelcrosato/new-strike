# BLOCKHAWK: Signal Storm

An original helicopter combat campaign inspired by the overhead flight, linked objectives, rescue winch and resource management of the **Strike** series. Five operations across a near-future archipelago, one attack helicopter, twenty-six linked objectives and a complete success/failure loop.

## Play

Play it now at **[new-strike.vercel.app](https://new-strike.vercel.app)**, or open **[dist/blockhawk.html](dist/blockhawk.html)** in Chrome, Edge, Firefox or Samsung Internet with WebGL 2 enabled. This is the complete game: rendering library, models, water, particles, fonts, interface, audio and license notices are embedded. It makes no external requests and works offline. `index.html` and `dist/index.html` are identical copies for convenient serving.

For a local server:

```powershell
npm install
npm run build
npm start
```

Visit **http://localhost:4189**. To play on a phone on the same Wi-Fi, open `http://<your-PC-LAN-address>:4189` in its browser. Landscape offers the clearest view; portrait is supported too. The single HTML can also be hosted by any static file server.

## Deploy

The build output is a plain static directory, so any static host works. This repository ships a `vercel.json` that sets the build command to `npm run build` and the output directory to `dist/`, which holds `index.html` (served at `/`) and the identical `blockhawk.html`. No serverless functions, rewrites or environment variables are needed.

```powershell
vercel --prod
```

Importing the repository in the Vercel dashboard needs no extra configuration; `vercel.json` supplies it. The GitHub repository is connected to the Vercel project, so pushes to `main` deploy to **https://new-strike.vercel.app** automatically.

## Controls

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

## What is next: MERCENARY STRIKE

An open-world successor is being built alongside this campaign: a single streamed 100 km²
region divided into **nine distinct named areas**, each with its own terrain character and one
unmistakable landmark, holding eight biomes, five factions, twelve kinds of contract and a
mercenary outfit you build from a makeshift yard. The generator, chunk streamer, region
layer, combat and contract backend are in and tested — 122 module checks and 13 browser
checks. See [MERCENARY.md](MERCENARY.md) and run `npm run world`.

The campaign below is untouched: it still builds to the byte and its 19 browser checks pass.

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
npm test          # deterministic flight, combat, resource and mission invariants
npm run verify   # browser checks; npm start must be running; installed Chrome required
npm run build    # rebuild both single-file deliverables
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
