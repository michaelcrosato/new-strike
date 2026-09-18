# Delivery audit

The source objective is the pasted brief: a finished browser-game vertical slice inspired by Nuclear Strike's PS1 perspective and systems, set in the future, with original playful branding, low-poly construction-toy visuals, modern lighting, desktop and mobile input, delivered as a single HTML.

| Requirement | Evidence in the delivered build |
| --- | --- |
| Full campaign | Five operations, twenty-six objectives, unlocked in order with per-operation best scores. Nine objective kinds: destroy, destroy-by-tag, winch rescue, capture alive, hand over cargo, hold a scan, escort a column, intercept before escape, extract. The campaign suite flies all five operations to a win and asserts each kind also fails correctly. |
| Campaign scale | 1,849k units² of map across the five operations, 18.8x the 99k of the original single map. Each operation stays within the original per-frame budget: 39,000–50,000 triangles and 164–246 meshes, built in 140–220 ms. |
| Level integrity | Every pad, unit, patrol leg, escape route and convoy route in all five operations is machine-checked to sit on the correct surface, and no landing pad overlaps a gun. Six authoring errors were found and fixed this way. |
| Finished, playable vertical slice | Browser pilot completes radar destruction, compound combat, four winch rescues, power-node destruction, missile-battery destruction and carrier extraction. Resources and enemy fire remain active throughout. Success and failure debriefs, rank, score, replay, briefing and manual work. |
| Source perspective and systems | Fixed elevated orthographic camera; inertia, banking, heading and strafing; three finite-ammo weapons; target lock; enemy patrols and AA; fuel and armor; winch pickup; resupply; tactical map and objective compass. Verified by 11 deterministic tests plus direct browser interactions. |
| Original future setting and title | BLOCKHAWK: Signal Storm, AH-9 Kestrel, Tern Delta, 2049. Original island geometry, gunship, radar, people, harbor, power nodes and shielded missile battery. No extracted game assets. |
| Low-poly construction-toy appearance | Faceted stepped islands, block buildings, roof studs, palm leaves, gunship, modeled weapons/rotors/landing gear, modular enemy vehicles. Screenshots inspected for coast, rescue compound, battery and harbor. |
| Rendering, lighting and effects | PBR materials, dynamic PCF shadows, GTAO, HDR bloom, AgX tone mapping, subtle DOF, MSAA, film treatment, camera shake, animated water, rotor wash, winch lift, smoke, sparks, debris, flares and explosions. Browser reports no shader or JavaScript errors. |
| Desktop controls | Real keyboard movement, held firing, weapon switching, real mouse aiming and enemy hits; manual, tactical map, pause, resume and settings checks. |
| Mobile controls | Two simultaneous real CDP touch contacts fly and fire; quick flare tap, weapon tiles and held resupply work. Layout inspected at 915×412, 412×915 and 780×360. |
| RTX 4070 SUPER target | Browser renderer identifies NVIDIA GeForce RTX 4070 SUPER / ANGLE D3D11. Brief 1440×900 Cinematic scene samples report approximately 141–144 FPS. These are smoke measurements, not a sustained hardware benchmark. |
| Samsung S26 target | Responsive Android touch layouts, capped render density, mobile graphics preset and adaptive quality are implemented and tested via device emulation. Physical S26 performance remains unmeasured. |
| Single-file delivery | `dist/blockhawk.html`, served at `/blockhawk.html`, approximately 815 KiB. The site root now belongs to MERCENARY STRIKE, the open world this campaign grew into; the campaign build is the audited one, less a duplicate object key that never changed what it returned (see the hash note below). Rendering library, models, textures, subset interface fonts, UI, synthesized audio and third-party notices are embedded. Offline `file://` launch and deployment pass, with zero external asset requests. |

The browser suite also checks full reset, fuel failure, audio start/mute, paused simulation invariants, best-score/settings storage, offline delivery and the absence of test controls in normal play. `artifacts/verification.json` contains the latest results. `artifacts/hardware.json` records the GPU identification; screenshots are in `artifacts/`.

The full browser mission test uses accelerated simulation controls and normal combat rules. It does not teleport, modify health/ammo, skip stages or disable enemies during that run. Separate focused input and visual checks intentionally use fixtures. A human player can take time to read the map and manage supplies; the test pilot is a speed run, not a play-duration estimate.

Final HTML SHA-256: `3599D7AAC41450736242128C54672C6739C3699B56872945489B160C2E9A02C8`.

That hash moved once, on 2026-09-17, for a one-line source fix rather than a change of
behaviour: `window.blockhawk.getState()` listed `delivered` twice in the same object
literal, which the build had been warning about. Both copies held the same value, so the
object it returns is identical; the duplicate is simply gone. The nineteen browser checks
above were re-run against the rebuilt file and all pass. The previous audited hash was
`094648EAD79167A3C246745C0B812A40C9C6050AB8AD61043334283B843CFF7F`.
