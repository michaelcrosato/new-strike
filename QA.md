# Delivery audit

The source objective is the pasted brief: a finished browser-game vertical slice inspired by Nuclear Strike's PS1 perspective and systems, set in the future, with original playful branding, low-poly construction-toy visuals, modern lighting, desktop and mobile input, delivered as a single HTML.

| Requirement | Evidence in the delivered build |
| --- | --- |
| Finished, playable vertical slice | Browser pilot completes radar destruction, compound combat, four winch rescues, power-node destruction, missile-battery destruction and carrier extraction. Resources and enemy fire remain active throughout. Success and failure debriefs, rank, score, replay, briefing and manual work. |
| Source perspective and systems | Fixed elevated orthographic camera; inertia, banking, heading and strafing; three finite-ammo weapons; target lock; enemy patrols and AA; fuel and armor; winch pickup; resupply; tactical map and objective compass. Verified by 11 deterministic tests plus direct browser interactions. |
| Original future setting and title | BLOCKHAWK: Signal Storm, AH-9 Kestrel, Tern Delta, 2049. Original island geometry, gunship, radar, people, harbor, power nodes and shielded missile battery. No extracted game assets. |
| Low-poly construction-toy appearance | Faceted stepped islands, block buildings, roof studs, palm leaves, gunship, modeled weapons/rotors/landing gear, modular enemy vehicles. Screenshots inspected for coast, rescue compound, battery and harbor. |
| Rendering, lighting and effects | PBR materials, dynamic PCF shadows, GTAO, HDR bloom, AgX tone mapping, subtle DOF, MSAA, film treatment, camera shake, animated water, rotor wash, winch lift, smoke, sparks, debris, flares and explosions. Browser reports no shader or JavaScript errors. |
| Desktop controls | Real keyboard movement, held firing, weapon switching, real mouse aiming and enemy hits; manual, tactical map, pause, resume and settings checks. |
| Mobile controls | Two simultaneous real CDP touch contacts fly and fire; quick flare tap, weapon tiles and held resupply work. Layout inspected at 915×412, 412×915 and 780×360. |
| RTX 4070 SUPER target | Browser renderer identifies NVIDIA GeForce RTX 4070 SUPER / ANGLE D3D11. Brief 1440×900 Cinematic scene samples report approximately 141–144 FPS. These are smoke measurements, not a sustained hardware benchmark. |
| Samsung S26 target | Responsive Android touch layouts, capped render density, mobile graphics preset and adaptive quality are implemented and tested via device emulation. Physical S26 performance remains unmeasured. |
| Single-file delivery | `dist/blockhawk.html` and identical `index.html`, approximately 836 KiB. Rendering library, models, textures, fonts, UI, synthesized audio and third-party notices are embedded. Offline `file://` launch and deployment pass, with zero external asset requests. |

The browser suite also checks full reset, fuel failure, audio start/mute, paused simulation invariants, best-score/settings storage, offline delivery and the absence of test controls in normal play. `artifacts/verification.json` contains the latest results. `artifacts/hardware.json` records the GPU identification; screenshots are in `artifacts/`.

The full browser mission test uses accelerated simulation controls and normal combat rules. It does not teleport, modify health/ammo, skip stages or disable enemies during that run. Separate focused input and visual checks intentionally use fixtures. A human player can take time to read the map and manage supplies; the test pilot is a speed run, not a play-duration estimate.

Final HTML SHA-256: `6BD07010223E6A71333B6A0D44362CE1FEC90450E13C976D171B53BE3CBB8F5D`.
