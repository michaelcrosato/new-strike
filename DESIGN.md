# BLOCKHAWK: Signal Storm

A complete four-objective vertical slice inspired by Nuclear Strike's first delta operation: an original near-future island, overhead attack helicopter, linked seek/destroy/rescue objectives, fuel and finite ammunition, friendly resupply, tactical map and radio direction.

## Completion requirements

- One distributable HTML with embedded rendering code, models, textures, UI and synthesized audio; runs offline, including file://.
- Original modular low-poly helicopter and dense tropical river-delta environment: ocean, stepped islands, palms, roads, bridge, industrial harbor, radar outpost, rescue compound and missile command site.
- Finished visual presentation: warm cinematic light, physically based materials, real-time soft shadows, ambient occlusion on desktop, animated water, bloom, fog, rotor wash, smoke, debris and camera effects.
- Responsive flight with inertia, banking, rotation, hover and target lock; desktop keyboard and mouse plus simultaneous multitouch controls.
- Cannon, rockets and homing missiles; active enemy turrets, patrols, missile launchers and a shielded command target; damage and destructible scenery.
- Mission sequence: destroy coastal radar, rescue four engineers from a guarded compound, stop the storm missile battery, extract to the carrier.
- Fuel/armor/ammo management, winch rescue, resupply/repair, countermeasure cooldown, compass/radar, full tactical map, objective markers and contextual prompts.
- Briefing, clear controls, difficulty and graphics/audio options, pause, failure and complete debrief, best score, restart and replay.
- Verify core invariants and full mission/failure/restart flows in browser, desktop visuals, touch input and portrait/landscape layouts, offline single HTML.

## Implementation

Three.js r186 WebGL2 for mobile and file:// compatibility. MeshStandard/Physical materials, procedural geometry, merged static meshes, stabilized shadow camera, optional GTAO, HDR bloom, AgX tone mapping and cinematic grade. No remote assets or services at runtime.

Original content only. Reference research: https://gamefaqs.gamespot.com/ps/198218-nuclear-strike/faqs/26326
