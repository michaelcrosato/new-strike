# BLOCKHAWK: Signal Storm

An original, playable helicopter combat vertical slice inspired by the overhead flight, linked missions, rescue winch and resource management of **Nuclear Strike**. A miniature near-future river delta, one attack helicopter, four connected objectives and a complete success/failure loop.

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

## Operation

1. **Blind the coast.** Destroy the radar and survive the defenses.
2. **Rescue the engineers.** Eliminate all three compound guards. Hover over the amber beacon and hold the winch until four engineers are aboard.
3. **Break the storm.** Destroy both power nodes, then the shielded missile battery. The five-minute launch countdown begins after the rescue.
4. **Bring them home.** Return to the carrier and hold land above the H to extract.

Green pads repair armor, refill fuel and restock all weapons. Supplies are unlimited. The cannon is useful against light targets, rockets have area damage, and seekers track their locked target. Volatile fuel drums can cause chain explosions. Enemy missiles can be distracted by flares. Armor loss, fuel exhaustion and failing to stop the launch end the mission.

Recon, Pilot and Ace adjust incoming damage, enemy fire rate and fuel use. Debrief includes a rank, score, time, rescues and destroyed targets. Best scores are saved locally per difficulty when browser storage is available. Mission progress is not saved after closing the page.

## Rendering and performance

Three.js r186 / WebGL 2 with physically based materials, dynamic soft shadows, HDR bloom, AgX tone mapping, animated water normals, rotor wash, smoke, sparks, debris, terrain-following flight and responsive camera banking/shake. The Cinematic preset adds GTAO, subtle focus-based depth of field, 4× multisampling and 4096px shadow maps. Static scenery and each animated model are merged by shading class with colour carried per vertex, merged geometry is welded and indexed, projectiles and particles use instancing, and mobile rendering caps pixel density and uses smaller shadow maps. The whole scene is 164 meshes rather than 548, for the same 48,500 triangles.

Auto selects a graphics preset and can reduce rendering cost if sustained frame rate is low. Graphics and audio controls are in the pause menu. Sound is synthesized locally with Web Audio after a user gesture. Reduced-motion preferences disable grain animation and camera shake.

Desktop graphics were checked on an **NVIDIA GeForce RTX 4070 SUPER**, with short scene samples around 141–144 FPS at 1440×900 using Cinematic settings in Chrome. Android portrait/landscape inputs are tested with browser device emulation. **A physical Samsung S26 has not been tested.** No specific phone frame rate is claimed.

## Source and verification

```powershell
npm test          # deterministic flight, combat, resource and mission invariants
npm run verify   # browser checks; npm start must be running; installed Chrome required
npm run build    # rebuild both single-file deliverables
```

- `src/core.js` — deterministic mission, flight, combat and resource simulation.
- `src/world.js` — procedural island, aircraft, enemy models and effects.
- `src/main.js` — rendering pipeline, camera, keyboard/mouse/touch input and UI.
- `src/audio.js` — synthesized rotor, weapons, explosions and feedback tones.
- `src/shell.html`, `src/style.css` — interface and responsive layouts.
- `tests/core.test.mjs`, `tests/browser.mjs` — automated validation.
- `assets/` — brand mark, icons, social card and the subset interface fonts that the build embeds.
- `scripts/make-brand.mjs`, `scripts/make-fonts.mjs` — regenerate those assets from the source faces. They need ImageMagick and uv with fontTools, and are deliberately not part of `npm run build`, which stays node-only.
- `artifacts/verification.json` — latest browser results and measured session statistics.

The browser test flies the entire mission with simulated control inputs, including enemy fire, ammunition use, resupply, rescues and extraction. It does not teleport the aircraft or edit health/ammo/stages in the full mission run. Separate focused input/failure checks use explicit fixtures. Test controls are available only with `?test`; normal play exposes read-only diagnostics at `window.blockhawk`.

The game uses original code, procedural artwork and synthesized audio. Three.js is MIT licensed. The embedded Barlow fonts are SIL Open Font License 1.1. Full notices are included in the HTML and `THIRD_PARTY_NOTICES.txt`. Reference for the inspiration's mission structure: [Nuclear Strike guide, Operation 1: Delta](https://gamefaqs.gamespot.com/ps/198218-nuclear-strike/faqs/26326).
