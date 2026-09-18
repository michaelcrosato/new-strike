// MERCENARY STRIKE — open world prototype.
//
// This is the shell that proves the backend: it boots the generated region, streams it
// around the aircraft, and puts the numbers that matter on screen. Flight, contracts and
// progression hang off this loop; the point of this file is that the world underneath it
// holds up while you fly across ten kilometres of it.

import * as THREE from 'three/webgpu';
import { createRenderer, createPost, createSeaMaterial, backendName, frameDrawCalls, forcedWebGL, TONES } from './stage.js';
import { LOOK, REGION_GRADE, GRADE_STRENGTH } from './look.js';
import { FLIGHT, CRUISE, TOP, unitsToKmh } from './flight.js';
import { LANDING, FOOT, WALK, landingCheck, slowEnoughToLand, stepWalk, stepOutSpot, canBoard } from './crew.js';
import { buildYard } from './yard.js';
import { createTutorial, stepTutorial, skipTutorial, tutorialStep } from './tutorial.js';
import { createWorld, WORLD, BIOMES, FACTIONS } from './worldgen.js';
import { ChunkStreamer, desiredChunks } from './streaming.js';
import { buildChunk, createMaterials } from './terrain.js';
import { buildOverview, OVERVIEW_RESOLUTION } from './overview.js';
import { createProfile, generateContracts, accept, resolve, endDay, standingBand, situation,
  purchase, hire, UPGRADES, HIREABLE, applyStanding, openingContract } from './agency.js';
import { createCombat, rearm, syncHostiles, stepCombat, availableWeapons, combatStandingDeltas,
  WEAPONS, hitCraft } from './combat.js';
import { startMission, stepMission, missionStatus, clearMission } from './missions.js';
import { EntityView, TracerView } from './entities.js';
import { AudioEngine } from './audio.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

// Every button in the game acts on pointerup as well as on click.
//
// Chrome withholds the click of a tap that lands within about half a second of a drag: it
// is still deciding whether the tap begins another gesture, and by the time it decides, the
// click is gone. Measured here, a tap up to 400 ms after panning the map produced
// pointerdown, touchstart, pointerup and touchend — and no click at all. On a phone that is
// a button that does nothing, which is most of what made this unplayable.
//
// Acting on pointerup also removes the tap latency. The click path stays for keyboards and
// for the few places that drive a button with .click(), and the two are de-duplicated so a
// mouse does not fire both.
function onTap(element, action) {
  let armed = null, acted = -Infinity;
  element.addEventListener('pointerdown', event => { if (event.button === 0) armed = event.pointerId; });
  element.addEventListener('pointercancel', () => { armed = null; });
  element.addEventListener('pointerup', event => {
    const ours = armed === event.pointerId;
    armed = null;
    if (!ours || element.disabled) return;
    acted = performance.now();
    action(event);
  });
  element.addEventListener('click', event => {
    // The click the browser sends straight after a pointerup we have already acted on.
    if (element.disabled || performance.now() - acted < 600) return;
    action(event);
  });
}

// Slow enough over your own pad to count as parked, rather than passing through.
const HOVER_SERVICE = 3.2;

const seed = Number(new URLSearchParams(location.search).get('seed') ?? 20492) || 20492;
const world = createWorld(seed);
const home = world.home;

// ---------------------------------------------------------------- renderer
// One renderer, two backends: WebGPU where the browser has it, WebGL 2 where it does not.
// `?webgl` forces the fallback so both can be exercised in the same browser. The await is
// why this bundle is an ES module — WebGPU needs an adapter and a device before anything
// can be drawn.
const renderer = await createRenderer($('scene'));
const backend = backendName(renderer);

const scene = new THREE.Scene();
scene.background = new THREE.Color(LOOK.sky);
// Thin enough that ten kilometres of ground stays legible, and bright enough that the
// distance reads as air rather than as murk.
scene.fog = new THREE.FogExp2(LOOK.fog.colour, LOOK.fog.density);

const camera = new THREE.OrthographicCamera(-75, 75, 45, -45, 0.5, 900);
const cameraOffset = new THREE.Vector3(112, 142, 138);
const cameraFocus = new THREE.Vector3(home.x, home.height, home.z);

// The campaign's own lighting, which is the look this is returning to. It had been dimmed
// by about a third here, and that — not the tone curve — is what made the region grim.
scene.add(new THREE.HemisphereLight(LOOK.hemi.sky, LOOK.hemi.ground, LOOK.hemi.intensity));
const sun = new THREE.DirectionalLight(LOOK.sun.colour, LOOK.sun.intensity);
sun.position.set(-90, 150, 80);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -110, right: 110, top: 110, bottom: -110, near: 5, far: 420 });
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.5;
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight(LOOK.fill.colour, LOOK.fill.intensity);
fill.position.set(80, 60, -70);
scene.add(fill);

// ---------------------------------------------------------------- sea
// A node material now, because `onBeforeCompile` string surgery on GLSL cannot follow us to
// WebGPU. Same two crossing ripples and the same slow swell, expressed as a graph.
const seaMaterial = createSeaMaterial();
const sea = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.size * 2, WORLD.size * 2), seaMaterial);
sea.rotation.x = -Math.PI / 2;
sea.position.y = WORLD.seaLevel;
sea.receiveShadow = true;
scene.add(sea);

// ---------------------------------------------------------------- aircraft
// A deliberately shabby airframe: this is the bottom-of-the-barrel machine you start with.
function buildAirframe() {
  const group = new THREE.Group();
  const body = new THREE.Group(); group.add(body);
  const paint = (geo, hex) => new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: hex, roughness: .8, metalness: .08, flatShading: true }));
  const box = (x, y, z, w, h, d, hex) => { const m = paint(new THREE.BoxGeometry(w, h, d), hex); m.position.set(x, y, z); m.castShadow = true; body.add(m); return m; };
  box(0, 0, 0, 2.6, 2.1, 7.4, 0x6c6a4f);
  box(0, 0.7, -3.1, 2.2, 1.3, 2.2, 0x2d4450);
  box(0, 0.1, 4.6, 0.7, 0.7, 5.2, 0x6c6a4f);
  box(0, 0.9, 7.0, 2.6, 0.22, 0.9, 0x8a8767);
  box(0, 1.5, 7.3, 0.22, 1.9, 0.8, 0xb5763f);
  for (const side of [-1, 1]) {
    box(side * 1.5, -1.2, 0.4, 0.25, 1.6, 1.2, 0x44443a);
    box(side * 1.7, -2.0, 0.4, 0.5, 0.35, 3.2, 0x2a2a24);
    box(side * 1.9, 0.2, 0.6, 1.1, 0.5, 2.4, 0x5d5b45);
  }
  const rotor = new THREE.Group(); rotor.position.set(0, 1.9, 0); body.add(rotor);
  for (let i = 0; i < 3; i++) {
    const blade = paint(new THREE.BoxGeometry(8.4, 0.11, 0.42), 0x24241f);
    blade.position.x = 4.2; blade.castShadow = true;
    const pivot = new THREE.Group(); pivot.rotation.y = i * Math.PI * 2 / 3;
    pivot.add(blade); rotor.add(pivot);
  }
  const tail = new THREE.Group(); tail.position.set(0.4, 1.1, 7.2); body.add(tail);
  for (let i = 0; i < 2; i++) {
    const blade = paint(new THREE.BoxGeometry(0.09, 0.16, 2.6), 0x24241f);
    blade.rotation.x = i * Math.PI / 2; tail.add(blade);
  }
  const disc = new THREE.Mesh(new THREE.RingGeometry(2.4, 8.5, 32),
    new THREE.MeshBasicMaterial({ color: 0x3d4b46, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false }));
  disc.rotation.x = -Math.PI / 2; disc.position.y = 1.95; body.add(disc);

  // Zoomed out to eight times, the aircraft is two pixels of dark green on a hillside. This
  // ring sits on the ground beneath it and grows with the view, so you can always find
  // yourself. It is a marker rather than a bigger helicopter, which is the honest way to
  // solve it: the machine stays the size it is.
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 40),
    new THREE.MeshBasicMaterial({ color: 0xf3b25e, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, depthTest: false }));
  marker.rotation.x = -Math.PI / 2;
  marker.renderOrder = 6;
  marker.visible = false;
  group.add(marker);

  // The winch. Five of the twelve contract kinds are things you lower a hook for, and
  // without this the aircraft just hovered while numbers changed. The cable geometry hangs
  // from its own origin so paying it out is a scale on one axis.
  const cableGeometry = new THREE.CylinderGeometry(0.07, 0.07, 1, 5);
  cableGeometry.translate(0, -0.5, 0);
  const cable = paint(cableGeometry, 0x24241f);
  const hook = paint(new THREE.BoxGeometry(1.5, 0.45, 1.5), 0xb5763f);
  hook.castShadow = true;
  const arm = paint(new THREE.BoxGeometry(1.8, 0.3, 0.3), 0x5d5b45);
  arm.position.set(0.7, 0.2, 0);
  const winch = new THREE.Group();
  winch.add(cable, hook, arm);
  winch.position.set(1.9, -0.5, 0.4);
  winch.visible = false;
  body.add(winch);

  group.scale.setScalar(0.92);
  return { group, body, rotor, tail, winch, cable, hook, marker };
}
const heli = buildAirframe();
scene.add(heli.group);

// The pilot, for when you climb out. Built to the same construction-toy rule as everything
// else: a few boxes, flat-shaded, and legs that swing so the walk reads at this distance.
function buildPilot() {
  const group = new THREE.Group();
  const paint = (geo, hex) => new THREE.Mesh(geo,
    new THREE.MeshStandardMaterial({ color: hex, roughness: .85, metalness: .04, flatShading: true }));
  const box = (parent, x, y, z, w, h, d, hex) => {
    const mesh = paint(new THREE.BoxGeometry(w, h, d), hex);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  // The torso and head hang off one pivot so the whole upper body can bob with the stride.
  const body = new THREE.Group();
  body.position.y = 0.92;
  group.add(body);
  box(body, 0, 0, 0, 0.52, 0.62, 0.3, 0x5c6b46);          // flight suit
  box(body, 0, 0.16, -0.17, 0.42, 0.34, 0.1, 0x3f4a32);   // vest
  box(body, 0, 0.5, 0, 0.36, 0.36, 0.36, 0xdfd9bb);       // helmet
  box(body, 0, 0.46, -0.19, 0.28, 0.16, 0.06, 0x173b4a);  // visor
  box(body, -0.35, -0.02, 0, 0.16, 0.5, 0.16, 0x5c6b46);  // arms
  box(body, 0.35, -0.02, 0, 0.16, 0.5, 0.16, 0x5c6b46);

  // Legs pivot at the hip, which is what makes a stride rather than a slide.
  const legLeft = new THREE.Group();
  legLeft.position.set(-0.13, 0.62, 0);
  group.add(legLeft);
  box(legLeft, 0, -0.31, 0, 0.18, 0.62, 0.18, 0x3f4a32);
  const legRight = new THREE.Group();
  legRight.position.set(0.13, 0.62, 0);
  group.add(legRight);
  box(legRight, 0, -0.31, 0, 0.18, 0.62, 0.18, 0x3f4a32);

  // The same zoom marker the aircraft carries: a person is one unit of a hundred-unit view.
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 32),
    new THREE.MeshBasicMaterial({ color: 0x9fe0ff, transparent: true, opacity: 0.85,
      side: THREE.DoubleSide, depthWrite: false, depthTest: false }));
  marker.rotation.x = -Math.PI / 2;
  marker.renderOrder = 6;
  marker.visible = false;
  group.add(marker);

  group.visible = false;
  return { group, body, legLeft, legRight, marker };
}
const figure = buildPilot();
scene.add(figure.group);

// The yard itself, which was an empty field until now. Built from the profile, so the
// fittings you buy in the yard screen appear in the yard you are standing in.
let yard = null;
function rebuildYard() {
  yard?.dispose();
  yard = buildYard(world, profile, materials.built);
  scene.add(yard.mesh);
}

// ---------------------------------------------------------------- streaming
const materials = createMaterials();
let residentTriangles = 0, residentMeshes = 0;
const streamer = new ChunkStreamer({
  build(cx, cz, lod) {
    const chunk = buildChunk(world, materials, cx, cz, lod);
    scene.add(chunk.group);
    residentTriangles += chunk.triangles;
    residentMeshes += chunk.group.children.length;
    return chunk;
  },
  dispose(chunk) {
    residentTriangles -= chunk.triangles;
    residentMeshes -= chunk.group.children.length;
    chunk.dispose();
  },
  budget: 2,
});

// ---------------------------------------------------------------- the far field
// One coarse mesh of the whole region, so zooming out has something to show beyond the
// streamed rings. Built off the critical path a moment after the first frame: it costs
// about ninety milliseconds, and nobody reaches for the zoom that fast.
let overview = null;
function buildFarField() {
  if (overview) return overview;
  const started = performance.now();
  overview = buildOverview(world, materials.distant, OVERVIEW_RESOLUTION);
  overview.ms = +(performance.now() - started).toFixed(1);
  overview.mesh.visible = zoom > OVERVIEW_FROM;
  scene.add(overview.mesh);
  return overview;
}

// ---------------------------------------------------------------- the yard
function renderYard() {
  $('yard-cash').textContent = profile.cash.toLocaleString() + ' ON HAND';
  $('yard-quill').textContent = situation(profile);
  const list = (node, kind) => {
    node.innerHTML = UPGRADES.filter(u => u.kind === kind).map(spec => {
      const store = kind === 'base' ? profile.base : profile.heli;
      const level = store[spec.id] ?? 0;
      const maxed = level >= spec.max;
      const cost = maxed ? null : spec.cost[level];
      const can = !maxed && profile.cash >= cost;
      return `<li class="${can ? 'can' : ''}" data-upgrade="${spec.id}">
        <b>${spec.name} · ${level}/${spec.max}</b>${spec.describe(level)}
        <span>${maxed ? 'FITTED' : 'UPGRADE'}<em>${maxed ? '—' : cost.toLocaleString()}</em></span></li>`;
    }).join('');
    for (const item of node.children) {
      if (!item.classList.contains('can')) continue;
      onTap(item, () => {
        const result = purchase(profile, item.dataset.upgrade);
        flash(result.ok ? 'FITTED' : result.reason);
        if (result.ok) { rearm(combat, profile); renderWeapons(); saveProfile(); rebuildYard(); }
        renderYard(); renderOutfit();
      });
    }
  };
  list($('yard-base'), 'base');
  list($('yard-heli'), 'heli');
  const crewNode = $('yard-crew');
  crewNode.innerHTML = [
    ...profile.crew.map(c => `<li><b>${c.short} · ${c.role}</b>${c.blurb}<span>ON THE BOOKS<em>${c.wage ? c.wage + '/DAY' : 'NO WAGE'}</em></span></li>`),
    ...HIREABLE.filter(c => !profile.crew.some(x => x.id === c.id)).map(c => {
      const ready = Object.entries(c.requires ?? {}).every(([k, n]) => (profile.base[k] ?? 0) >= n);
      const can = ready && profile.cash >= c.cost;
      return `<li class="${can ? 'can' : ''}" data-hire="${c.id}"><b>${c.short} · ${c.role}</b>${c.blurb}
        <span>${ready ? 'HIRE' : 'NEEDS ' + Object.keys(c.requires).join(' ').toUpperCase()}<em>${c.cost.toLocaleString()}</em></span></li>`;
    }),
  ].join('');
  for (const item of crewNode.children) {
    if (!item.classList.contains('can')) continue;
    onTap(item, () => {
      const result = hire(profile, item.dataset.hire);
      flash(result.ok ? 'HIRED' : result.reason);
      if (result.ok) saveProfile();
      renderYard(); renderOutfit(); refreshBoard();
    });
  }
}
function toggleYard() {
  const panel = $('yard');
  panel.hidden = !panel.hidden;
  if (!panel.hidden) { yardOpened = true; renderYard(); }
}
onTap($('yard-close'), toggleYard);

// ---------------------------------------------------------------- the first morning
// Arriving with no idea what anybody wants was the largest hole in the thing. This is the
// only briefing, it happens once per seed, and it describes the region that was actually
// generated rather than a region in general.
function renderIntro() {
  const homeRegion = world.regionAt(home.x, home.z);
  const marks = world.landmarks();
  const nearest = marks
    .slice().sort((a, b) => Math.hypot(a.x - home.x, a.z - home.z) - Math.hypot(b.x - home.x, b.z - home.z))[0];
  const km = v => (v * WORLD.metresPerUnit / 1000).toFixed(1);
  $('intro-where').innerHTML = `${homeRegion.name}<br>SEED ${seed} · 10 × 10 KM`;
  $('intro-quill').textContent =
    `You are parked in ${homeRegion.name.replace(/^THE /, 'the ')}, which is as much as anybody will give you for free. `
    + `${nearest.name} is ${km(Math.hypot(nearest.x - home.x, nearest.z - home.z))} kilometres out — `
    + `learn the look of it, because it is how you find your way home when the panels are off. `
    + `I have the radio, the books and the fuel. You have a machine held together by other people's spare parts. `
    + `Nobody in this region owes us anything yet, and that is the only good news in the brief.`;
  $('intro-region').textContent = homeRegion.character;
  $('intro-areas').innerHTML = marks.map(mark => {
    const region = world.regions.regions[mark.regionIndex];
    return `<li><i style="background:${region.colour}"></i>${region.short} · ${mark.short}</li>`;
  }).join('');
}
function showIntro() {
  renderIntro();
  $('intro').hidden = false;
}
// Still reachable with .click(), which is how the keyboard and the harness dismiss it.
onTap($('yard-brief'), () => { toggleYard(); showIntro(); });
onTap($('teach-skip'), () => abandonTeaching());
onTap($('intro-go'), () => {
  if ($('intro').hidden) return;
  $('intro').hidden = true;
  wakeAudio();
  audio.event({ type: 'radio' });
});

function renderWeapons() {
  const list = availableWeapons(profile.heli);
  $('weapons').innerHTML = list.map((w, i) =>
    `<div class="${i === combat.weapon ? 'on' : ''}">${w.short}<u>${Math.floor(combat.ammo[w.id] ?? 0)}</u></div>`).join('');
}

// ---------------------------------------------------------------- the outfit
// The whole loop in miniature: work comes off the board, you fly it, and the region's
// opinion of you moves. Everything here reads from the same generated world.
const SAVE_KEY = 'merc.profile.' + seed;
let returning = false;          // whether this seed has been flown before
function loadProfile() {
  const fresh = createProfile({ seed });
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return fresh;
    returning = true;
    const saved = JSON.parse(raw);
    // Merge rather than replace, so a save from an older build still boots.
    return { ...fresh, ...saved,
      standing: { ...fresh.standing, ...saved.standing },
      base: { ...fresh.base, ...saved.base },
      heli: { ...fresh.heli, ...saved.heli },
      crew: saved.crew?.length ? saved.crew : fresh.crew,
      active: null };
  } catch { return fresh; }
}
function saveProfile() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(profile)); } catch {}
}
const profile = loadProfile();
const combat = createCombat(profile);
rearm(combat, profile);
let mission = null;
let board = [];
const ARRIVE = 46;           // how close counts as being over the site

function refreshBoard() {
  board = generateContracts(world, profile);
  renderBoard();
}

function renderStandings() {
  $('standings').innerHTML = FACTIONS.map(f => {
    const value = profile.standing[f.key];
    const band = standingBand(value);
    const width = Math.abs(value) / 2;             // 0..50% of the bar
    const left = value >= 0 ? 50 : 50 - width;
    return `<div class="bar"><span style="width:62px;color:${f.colour}">${f.short}</span>
      <i><b style="left:${left}%;width:${Math.max(width, 0.8)}%;background:${f.colour}"></b></i>
      <u>${band.label}</u></div>`;
  }).join('');
}

function renderBoard() {
  $('board-count').textContent = profile.active ? 'ONE IN HAND' : `${board.length} OFFERED`;
  $('board').innerHTML = board.map((c, i) => {
    const faction = FACTIONS.find(f => f.key === c.issuer);
    return `<li data-index="${i}" class="${profile.active?.id === c.id ? 'taken' : ''}">
      <b>${c.site.landmark ? '◆ ' : ''}${c.title}</b>
      <small><span style="color:${faction.colour}">${faction.short}</span>
      <span>${c.kindName} · RISK ${c.risk}</span>
      <span>${c.distanceKm} KM · ${c.pay.toLocaleString()}</span></small>
      <small><span class="where">${c.site.regionName ?? ''}</span>${c.complication
        ? `<span class="twist">${c.complication.name}</span>` : ''}</small></li>`;
  }).join('');
  for (const item of $('board').children) {
    onTap(item, () => takeContract(board[Number(item.dataset.index)]));
  }
}

function renderOutfit() {
  $('cash').textContent = profile.cash.toLocaleString();
  $('outfit-day').textContent = `DAY ${profile.day}`;
  $('quill').textContent = situation(profile);
  renderStandings();
}

function takeContract(contract) {
  if (!contract) return;
  const result = accept(profile, contract);
  if (!result.ok) { flash(result.reason); return; }
  mission = startMission(world, profile, profile.active, combat);
  $('active').hidden = false;
  $('active-title').textContent = contract.title;
  $('mission').hidden = false;
  flash(`${contract.kindName} ACCEPTED · ${contract.site.name}`);
  renderBoard();
}

function settleContract(success, reason) {
  const contract = profile.active;
  const outcome = resolve(profile, { success });
  clearMission(mission, combat);
  mission = null;
  $('active').hidden = true;
  $('mission').hidden = true;
  if (success) {
    flash(`PAID ${outcome.paid.toLocaleString()} · ` +
      Object.entries(outcome.standing).map(([k, v]) => k.toUpperCase() + (v > 0 ? ' +' : ' ') + v).join('  '));
  } else {
    flash(`${reason ?? 'CONTRACT FAILED'} · ${outcome.paid.toLocaleString()}`);
  }
  endDay(profile);
  rearm(combat, profile);
  refreshBoard();
  renderOutfit();
  renderWeapons();
  saveProfile();
}

function updateActive(dt) {
  if (!mission) { $('mission').hidden = true; return; }
  // Mission work is done from the aircraft, so the winch and the scan do nothing on foot.
  stepMission(mission, { world, craft, combat,
    input: { interact: flying() && (keys.has('KeyE') || touchInput.winch) } }, dt);
  for (const event of mission.events) {
    if (event.type === 'aboard') flash(event.remaining ? `ABOARD · ${event.remaining} TO GO` : 'ALL ABOARD');
    if (event.type === 'scanned') flash('SCAN COMPLETE');
    if (event.type === 'dropped') { flash('CARGO DOWN'); cargoLatched = true; }
    if (event.type === 'waypoint') flash(event.left ? `WAYPOINT · ${event.left} LEFT` : 'SWEEP COMPLETE');
    if (event.type === 'convoyArrived') flash('COLUMN IS IN');
    if (event.type === 'convoyLost') flash('COLUMN LOST');
    if (event.type === 'planted') flash(event.left ? `CHARGE SET · ${event.left} TO GO` : 'LAST CHARGE SET');
    if (event.type === 'fuse') flash(`FUSE RUNNING · ${event.seconds} SECONDS · GET CLEAR`);
    if (event.type === 'detonated') flash('CHARGES BLOWN');
    if (event.type === 'caught') flash('CAUGHT IN THE BLAST');
    if (event.type === 'called') flash(event.left ? `ROUNDS ON TARGET · ${event.left} LEFT` : 'ALL GUNS ACCOUNTED FOR');
    if (event.type === 'lazeLost') flash('MARK LOST · HOLD IT STEADY');
    if (event.type === 'scanLost') flash('SCAN LOST');
    if (event.type === 'failed') flash(event.title);
    const cue = audioForMission(event);
    if (cue) audio.event(cue);
  }
  const status = missionStatus(mission, craft);
  $('mission-label').textContent = status.label;
  $('mission-bar').style.width = Math.round(status.progress * 100) + '%';
  // The two kinds that read out something other than a range: a search has only signal
  // strength, and a quiet run has only how close the nearest sensor is to seeing you.
  let detail = status.marker ? `${Math.round(status.range * WORLD.metresPerUnit)} m` : '';
  if (status.signal !== null) detail = `SIGNAL ${'▮'.repeat(Math.round(status.signal * 8)).padEnd(8, '▯')}`;
  if (mission.kind === 'smuggling') {
    detail = status.painted ? 'PAINTED · BREAK CONTACT'
      : status.exposure < 2 ? `SENSOR ${Math.round(status.exposure * 100)}%` : detail;
  }
  if (status.fuse !== null) detail = `FUSE ${status.fuse.toFixed(1)} S`;
  if (status.deadline !== null) detail += ` · ${Math.ceil(status.deadline)} S LEFT`;
  if (status.holding) detail += ' · HOLDING';
  $('mission-range').textContent = detail;
  $('mission-twist').textContent = status.complication ?? '';
  $('mission-twist').hidden = !status.complication;
  if (mission.done) settleContract(true);
  else if (mission.failed) settleContract(false, mission.title);
}

// Missions speak in their own vocabulary; the audio engine speaks in the campaign's. This
// is the whole translation, in one place, so neither side has to know about the other.
const MISSION_CUES = {
  detonated: { type: 'explosion', size: 2.4 },
  called: { type: 'explosion', size: 1.6 },
  caught: { type: 'playerHit' },
  aboard: { type: 'objective' },
  scanned: { type: 'objective' },
  dropped: { type: 'objective' },
  planted: { type: 'objective' },
  waypoint: { type: 'objective' },
  convoyArrived: { type: 'objective' },
  convoyLost: { type: 'incoming' },
  failed: { type: 'incoming' },
  fuse: { type: 'radio' },
  lazeLost: { type: 'radio' },
  scanLost: { type: 'radio' },
};
const audioForMission = event => MISSION_CUES[event.type] ?? null;

// Losing the airframe costs the job and a chunk of cash, and puts you back in the yard.
function loseAircraft() {
  const hadJob = !!profile.active;
  if (hadJob) settleContract(false, 'AIRCRAFT LOST');
  else { profile.cash = Math.max(0, profile.cash - 1200); endDay(profile); renderOutfit(); saveProfile(); }
  flash('AIRCRAFT LOST · REBUILT OVERNIGHT');
  rearm(combat, profile);
  combat.provoked = false;
  teleportHome();
}

// ---------------------------------------------------------------- sound
// The rotor is a filtered noise loop with a beat under it, and everything else is a short
// synthesised cue — the same engine the campaign uses, so the open world costs no assets.
// A browser will not start an audio context without a gesture, so the first key or click
// does it and nothing before that tries.
const audio = new AudioEngine();
let audioStarted = false;
function wakeAudio() {
  if (audioStarted) return;
  audioStarted = true;
  audio.start().catch(() => {});
}
addEventListener('keydown', wakeAudio, { once: true });
addEventListener('pointerdown', wakeAudio, { once: true });

// ---------------------------------------------------------------- input
// A coarse pointer gets a different game. There is no keyboard to fly with, so the thumb
// controls and the button rail come on and the key legend goes away. Everything the thumbs
// do feeds the same flight and combat code the keyboard feeds, so there is one flight model
// rather than two that drift apart.
const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
document.body.classList.toggle('touch', isTouch);

// What the thumbs are asking for. Read alongside `keys` by flight, combat and the winch.
const touchInput = { x: 0, y: 0, aimX: 0, aimY: 0, boost: false, fire: false, winch: false, flare: false, climb: false, descend: false };

let mouseFire = false;
// Bound to the canvas, and only for a real mouse. On the window it also fired when you
// tapped the joystick, a rail button or a weapon tile, because those are pointerdowns too.
$('scene').addEventListener('pointerdown', e => {
  if (e.pointerType === 'touch' || e.button !== 0 || overlayOpen()) return;
  mouseFire = true;
});
addEventListener('pointerup', () => { mouseFire = false; });
addEventListener('pointercancel', () => { mouseFire = false; });

let flashUntil = 0;
function flash(text) {
  const node = $('flash');
  node.textContent = text;
  node.hidden = false;
  flashUntil = performance.now() + 4200;
}

const entityView = new EntityView(scene, materials.built);
const tracers = new TracerView(scene);

// ---------------------------------------------------------------- flight
const craft = {
  x: home.x, z: home.z, y: home.height + 14, vx: 0, vz: 0,
  // `yaw` is where the nose is, `aim` is where it is being asked to go, and both are
  // headings in the convention headingOf describes. They are separate from the direction of
  // travel, which is the whole point of a dual-stick scheme.
  yaw: 0, aim: 0, aiming: false,
  fuel: 100, throttle: 0,
};
const keys = new Set();
// The ground directions that "right" and "up the screen" mean, derived from the camera
// offset rather than written out. They had been written out with their components
// transposed — 0.63/-0.78 where the camera calls for 0.78/-0.63 — which skewed every input
// by twelve degrees. Deriving them means they cannot drift from the camera again.
const screenRight = new THREE.Vector3(cameraOffset.z, 0, -cameraOffset.x).normalize();
const screenUp = new THREE.Vector3(-cameraOffset.x, 0, -cameraOffset.z).normalize();

// ---------------------------------------------------------------- headings
// One convention for which way a thing is pointing, shared with combat.js: a heading `h`
// sends a round along (sin h, -cos h).
//
// The airframe's nose is its own local -Z, and a rotation of `h` about Y points local -Z
// along (-sin h, -cos h) — mirrored in x. So the model takes the *negative* of the heading.
// Getting that wrong is what made the aircraft fly tail-first when it went east or west
// while looking perfectly correct going north or south.
const headingOf = (dx, dz) => Math.atan2(dx, -dz);
const turnToward = (from, to, rate, dt) =>
  from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * (1 - Math.exp(-rate * dt));

// A screen-relative stick reading, turned into a ground direction.
const groundVector = (x, y, out) => out.set(
  x * screenRight.x - y * screenUp.x, 0, x * screenRight.z - y * screenUp.z);
const aimVector = new THREE.Vector3();

// ---------------------------------------------------------------- aiming
// Dual-stick: the left hand flies and the right hand points the aircraft. Movement is
// screen-relative and independent of where the nose is, so the machine crabs and flies
// backwards the way a gunship actually fights.
//
// Three things can aim, in this order of precedence: the right thumb stick, the arrow keys,
// and the mouse. With none of them active the nose falls in behind the direction of travel,
// so simply flying somewhere still looks like flying somewhere.
const AIM_KEYS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
const pointer = new THREE.Vector2();
const aimRay = new THREE.Raycaster();
const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const aimPoint = new THREE.Vector3();
const AIM_DEAD_ZONE = 18;          // world units around the aircraft where the cursor does not aim
// The mouse aims while it is being used — while it has moved in the last couple of seconds,
// or while the trigger is down — and then lets go. A cursor that aimed for ever would leave
// the nose locked to wherever it was last parked, so a player who moved the mouse once and
// then flew on the keyboard would never get the nose back.
const AIM_LINGER = 2200;
let pointerAimUntil = 0;

addEventListener('pointermove', event => {
  if (event.pointerType === 'touch') return;
  pointer.set(event.clientX / innerWidth * 2 - 1, -(event.clientY / innerHeight * 2 - 1));
  pointerAimUntil = performance.now() + AIM_LINGER;
});

// Where the pointer is on the ground, at the aircraft's own altitude.
function aimFromPointer(who) {
  if (performance.now() > pointerAimUntil && !mouseFire) return null;
  aimPlane.constant = -who.y;
  aimRay.setFromCamera(pointer, camera);
  if (!aimRay.ray.intersectPlane(aimPlane, aimPoint)) return null;
  const dx = aimPoint.x - who.x, dz = aimPoint.z - who.z;
  // A dead zone around the aircraft itself. Without it, a cursor resting near the machine
  // — which is where it sits if nobody has moved it — swings the nose about on sub-unit
  // differences, and the nose ends up following the camera instead of the player.
  if (Math.hypot(dx, dz) < AIM_DEAD_ZONE) return null;
  return headingOf(dx, dz);
}

// The heading the player is asking for, or null if they are not asking.
function requestedAim(held, stick, who = craft) {
  if (Math.hypot(stick.aimX, stick.aimY) > 0.22) {
    groundVector(stick.aimX, stick.aimY, aimVector);
    return headingOf(aimVector.x, aimVector.z);
  }
  let kx = 0, ky = 0;
  for (const [code, [x, y]] of Object.entries(AIM_KEYS)) {
    if (held.has(code)) { kx += x; ky += y; }
  }
  if (kx || ky) {
    groundVector(kx, ky, aimVector);
    return headingOf(aimVector.x, aimVector.z);
  }
  return aimFromPointer(who);
}

addEventListener('keydown', e => {
  if (e.code === 'Tab' || e.code === 'F5') return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  // The briefing swallows everything until it is dismissed, so the first key you press
  // does not send you off the pad mid-sentence.
  if (!$('intro').hidden) {
    if (e.code === 'Enter' || e.code === 'Escape' || e.code === 'Space') $('intro-go').click();
    return;
  }
  keys.add(e.code);
  if (e.code === 'Escape') {
    if (!$('intro').hidden) $('intro').hidden = true;
    else if (!abandonTeaching()) for (const id of ['yard', 'map-panel']) if (!$(id).hidden) $(id).hidden = true;
  }
  if (e.code === 'Slash') showIntro();
  // With the map open the same three keys work the map's zoom instead of the camera's,
  // which is the thing you are actually looking at.
  const mapping = !$('map-panel').hidden;
  if (e.code === 'Minus' || e.code === 'NumpadSubtract' || e.code === 'BracketLeft') mapping ? setMapZoom(mapStep - 1) : zoomBy(1);
  if (e.code === 'Equal' || e.code === 'NumpadAdd' || e.code === 'BracketRight') mapping ? setMapZoom(mapStep + 1) : zoomBy(-1);
  if (e.code === 'Digit0' || e.code === 'Numpad0') mapping ? resetMapView() : setZoom(ZOOM_DEFAULT);
  if (e.code === 'KeyQ') toggleStance();
  if (e.code === 'KeyM') toggleMap();
  if (e.code === 'KeyH') teleportHome();
  if (e.code === 'KeyG') { $('debug').classList.toggle('hidden'); $('outfit').classList.toggle('hidden'); $('hud').classList.toggle('hidden'); }
  if (e.code === 'KeyB') toggleYard();
  if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') {
    const index = Number(e.code.slice(-1)) - 1;
    if (index < availableWeapons(profile.heli).length) { combat.weapon = index; renderWeapons(); }
  }
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); mouseFire = false; releaseThumbs(); });

function teleportHome() {
  // Whatever you were doing, you are in the aircraft and airborne again.
  stance = 'flying';
  figure.group.visible = false;
  craft.x = home.x; craft.z = home.z; craft.vx = 0; craft.vz = 0;
  craft.y = world.groundHeight(home.x, home.z) + 16;
  cameraFocus.set(craft.x, craft.y - 16, craft.z);
  streamer.settle(craft.x, craft.z, 200);
}

// With a panel open the aircraft holds station instead of drifting off across the region
// while you read. Fuel, repair and the rest of the loop keep running.
// On a phone the contract board is a sheet rather than a permanent panel, so reading it
// holds the aircraft on station the way the map and the yard do.
const overlayOpen = () => !$('intro').hidden || !$('yard').hidden || !$('map-panel').hidden
  || $('outfit').classList.contains('open');

// Nothing held, for when a panel is up.
const IDLE_STICK = { x: 0, y: 0, aimX: 0, aimY: 0, boost: false, climb: false, descend: false };

// ---------------------------------------------------------------- stance
// Three states, and getting out of the aircraft is the transitions between them. `flying` is
// everything this game was; `landed` is the skids on the ground with the rotor spun down;
// `afoot` is the pilot out of it, walking.
let stance = 'flying';
let rotorSpeed = 1, rotorAngle = 0;   // eased, so the rotor winds down rather than stopping
let landingRefusal = 0;               // so a refusal does not flash every frame you hold C
// A thumb has no C key to hold, so the rail's LAND button asks for a descent and the flight
// model holds it for a few seconds — long enough to reach the ground from a normal hover.
let landingAssist = 0;

const pilot = { x: home.x, z: home.z, y: home.height, vx: 0, vz: 0, yaw: 0, aim: 0, stride: 0, pace: 0 };

// What the camera follows, what the streamer loads around, and what the stick drives.
const subject = () => (stance === 'afoot' ? pilot : craft);
const flying = () => stance === 'flying';

function refuse(message) {
  if (performance.now() < landingRefusal) return false;
  landingRefusal = performance.now() + 2600;
  flash(message);
  return false;
}

function touchDown() {
  const check = landingCheck(world, craft.x, craft.z);
  if (!check.ok) return refuse(check.reason);
  if (!slowEnoughToLand(craft.vx, craft.vz)) {
    return refuse(`TOO FAST TO SET DOWN · SLOW BELOW ${LANDING.maxTouchdownKmh} KM/H`);
  }
  stance = 'landed';
  landingAssist = 0;
  craft.vx = 0; craft.vz = 0;
  craft.y = check.ground + LANDING.skidHeight;
  audio.event({ type: 'radio' });
  flash(`DOWN · ${world.regionAt(craft.x, craft.z).name} · Q TO GET OUT`);
  renderStance();
  return true;
}

function liftOff() {
  stance = 'flying';
  landingAssist = 0;
  audio.event({ type: 'radio' });
  flash('LIFTING OFF');
  renderStance();
}

function climbOut() {
  if (stance !== 'landed') { flash('SET DOWN FIRST · HOLD C TO LAND'); return false; }
  const spot = stepOutSpot(world, craft);
  pilot.x = spot.x; pilot.z = spot.z;
  pilot.y = world.groundHeight(pilot.x, pilot.z);
  pilot.vx = 0; pilot.vz = 0;
  pilot.yaw = craft.yaw; pilot.aim = craft.yaw;
  stance = 'afoot';
  // Placed and shown here rather than waiting for the first walk step, so the very first
  // rendered frame already has the pilot standing in the yard.
  figure.group.visible = true;
  figure.group.position.set(pilot.x, pilot.y, pilot.z);
  figure.group.rotation.y = -pilot.yaw;
  updateCamera(0, true);
  audio.event({ type: 'objective' });
  flash('ON FOOT · Q AT THE AIRCRAFT TO GET BACK IN');
  renderStance();
  return true;
}

function climbIn() {
  if (!canBoard(pilot, craft)) {
    const away = Math.round(Math.hypot(pilot.x - craft.x, pilot.z - craft.z) * WORLD.metresPerUnit);
    flash(`${away} M FROM THE AIRCRAFT`);
    return false;
  }
  stance = 'landed';
  pilot.vx = 0; pilot.vz = 0;
  figure.group.visible = false;
  updateCamera(0, true);
  audio.event({ type: 'radio' });
  flash('ABOARD');
  renderStance();
  return true;
}

const toggleStance = () => (stance === 'afoot' ? climbIn() : climbOut());

// ---------------------------------------------------------------- the first minute
// One sentence at a time, each attached to something the player has to do. The script
// itself lives in src/tutorial.js; this is the part that knows about the world.
let teaching = null, mapOpened = false, yardOpened = false, cargoLatched = false;

function tutorialSnapshot() {
  return {
    stance,
    walked: pilot.stride,
    airborne: craft.y - world.groundHeight(craft.x, craft.z),
    flown: Math.hypot(craft.x - home.x, craft.z - home.z),
    mapOpened,
    yardOpened,
    cargoDown: cargoLatched,
    jobDone: profile.completed.length > 0,
  };
}

function renderTeaching() {
  const step = teaching && tutorialStep(teaching);
  const panel = $('teach');
  if (!panel) return;
  panel.hidden = !step;
  if (!step) return;
  const subjectName = step.id === 'job'
    ? (profile.active?.site.name ?? 'the drop')
    : world.regionAt(craft.x, craft.z).name;
  $('teach-say').textContent = step.say(subjectName);
  $('teach-hint').textContent = step.hint;
}

// What each step needs set up when it begins.
function onTeachStep(id) {
  if (id === 'job' && !profile.active) {
    const first = openingContract(world, profile);
    if (first) {
      board = [first, ...board.filter(c => c.id !== first.id)];
      takeContract(first);
    }
  }
  renderTeaching();
}

function updateTeaching(dt) {
  if (!teaching) return;
  for (const event of stepTutorial(teaching, tutorialSnapshot(), dt)) {
    if (event.type === 'enter') onTeachStep(event.id);
    if (event.type === 'finish') { renderTeaching(); flash('THAT IS THE JOB'); }
  }
}

function abandonTeaching() {
  if (!teaching || !skipTutorial(teaching)) return false;
  renderTeaching();
  flash('ON YOUR OWN');
  return true;
}

// What state you are in, and what the control in front of you will do about it. The rail
// button makes the same decision the Q key does, so a thumb and a keyboard read the same
// game.
function renderStance() {
  const reach = canBoard(pilot, craft);
  const away = Math.round(Math.hypot(pilot.x - craft.x, pilot.z - craft.z) * WORLD.metresPerUnit);
  const [state, prompt] = {
    flying: ['FLYING', 'HOLD C TO SET DOWN'],
    landed: ['ON THE GROUND', 'Q TO GET OUT · SPACE TO LIFT'],
    afoot: ['ON FOOT', reach ? 'Q TO CLIMB BACK IN' : `${away} M TO THE AIRCRAFT`],
  }[stance];
  const line = $('stance');
  if (line) line.innerHTML = `<b>${state}</b><em>${prompt}</em>`;
  const rail = $('rail-stance');
  if (rail) {
    rail.textContent = stance === 'flying' ? 'LAND' : stance === 'landed' ? 'GET OUT' : reach ? 'BOARD' : 'WALK';
    rail.classList.toggle('on', stance !== 'flying' && (stance === 'landed' || reach));
  }
}

// The rotor winds down when the machine is sitting there, which is most of what sells a
// landing as a landing.
function updateRotor(dt) {
  rotorSpeed += ((flying() ? 1 : LANDING.idleRotor) - rotorSpeed) * (1 - Math.exp(-1.2 * dt));
  rotorAngle += rotorSpeed * 34 * dt;
  heli.rotor.rotation.y = rotorAngle;
  heli.tail.rotation.x = rotorAngle * 1.3;
}

// The aircraft, parked. It holds its position, sits on its skids and stops banking.
function holdAircraft(dt) {
  const ground = world.groundHeight(craft.x, craft.z);
  craft.vx = 0; craft.vz = 0;
  craft.y = ground + LANDING.skidHeight;
  heli.group.position.set(craft.x, craft.y, craft.z);
  heli.group.rotation.y = -craft.yaw;
  heli.body.rotation.x = THREE.MathUtils.damp(heli.body.rotation.x, 0, 6, dt);
  heli.body.rotation.z = THREE.MathUtils.damp(heli.body.rotation.z, 0, 6, dt);
  heli.winch.visible = false;
}

// Fuel: burnt while the rotor is turning, topped up over your own pad, and neither while the
// machine is sitting there with the engine off.
function serviceOrBurn(dt, burning, boost = false) {
  const base = world.home;
  const overYard = Math.hypot(craft.x - base.x, craft.z - base.z) < 40;
  if (overYard && Math.hypot(craft.vx, craft.vz) < HOVER_SERVICE) {
    combat.fuel = Math.min(combat.maxFuel, combat.fuel + 26 * dt * (1 + profile.base.fuel));
    combat.armour = Math.min(combat.maxArmour, combat.armour + 14 * dt * (1 + profile.base.workshop));
    for (const w of availableWeapons(profile.heli)) {
      combat.ammo[w.id] = Math.min(w.max, (combat.ammo[w.id] ?? 0) + w.max / 6 * dt);
    }
  } else if (burning) {
    combat.fuel = Math.max(0, combat.fuel - dt * (boost ? FLIGHT.burn.dash : FLIGHT.burn.cruise));
    if (combat.fuel <= 0) loseAircraft();
  }
  combat.invulnerable = Math.max(0, (combat.invulnerable ?? 0) - dt);
}

// One step of walking, and the figure that does it.
function walk(dt) {
  const held = overlayOpen() ? new Set() : keys;
  const stick = overlayOpen() ? IDLE_STICK : touchInput;
  const dx = (held.has('KeyD') ? 1 : 0) - (held.has('KeyA') ? 1 : 0) + stick.x;
  const dy = (held.has('KeyS') ? 1 : 0) - (held.has('KeyW') ? 1 : 0) + stick.y;
  groundVector(dx, dy, aimVector);
  const len = Math.hypot(aimVector.x, aimVector.z);
  const move = len > 1 ? { x: aimVector.x / len, z: aimVector.z / len } : { x: aimVector.x, z: aimVector.z };
  const running = held.has('ShiftLeft') || held.has('ShiftRight') || stick.boost;
  stepWalk(pilot, world, move, running, dt);

  // The same dual-stick rule as the aircraft: an aim input points the pilot, and without one
  // they face the way they are walking.
  const asked = requestedAim(held, stick, pilot);
  if (asked !== null) pilot.aim = asked;
  else if (len > 0.08) pilot.aim = headingOf(move.x, move.z);
  pilot.yaw = turnToward(pilot.yaw, pilot.aim, FOOT.turnRate, dt);

  figure.group.visible = true;
  figure.group.position.set(pilot.x, pilot.y, pilot.z);
  figure.group.rotation.y = -pilot.yaw;
  // A stride driven by distance covered rather than by time, so the legs do not pedal on the
  // spot when the pilot stops.
  const effort = Math.min(1, pilot.pace / WALK);
  const swing = Math.sin(pilot.stride * 2.6) * effort * 0.6;
  figure.legLeft.rotation.x = swing;
  figure.legRight.rotation.x = -swing;
  figure.body.position.y = 0.92 + Math.abs(Math.cos(pilot.stride * 2.6)) * 0.05 * effort;
}

function flight(dt) {
  const held = overlayOpen() ? new Set() : keys;
  const stick = overlayOpen() ? IDLE_STICK : touchInput;

  // Out of the aircraft: the pilot walks and the machine sits where it was left.
  if (stance === 'afoot') { walk(dt); holdAircraft(dt); serviceOrBurn(dt, false); return; }
  // On the ground: nothing moves until the collective comes up.
  if (stance === 'landed') {
    if (!(held.has('Space') || stick.climb)) { holdAircraft(dt); serviceOrBurn(dt, false); return; }
    liftOff();
  }
  // The arrows aim now rather than duplicating WASD, which is what makes this dual-stick.
  const dx = (held.has('KeyD') ? 1 : 0) - (held.has('KeyA') ? 1 : 0) + stick.x;
  const dy = (held.has('KeyS') ? 1 : 0) - (held.has('KeyW') ? 1 : 0) + stick.y;
  groundVector(dx, dy, aimVector);
  let mx = aimVector.x, mz = aimVector.z;
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  const boost = held.has('ShiftLeft') || held.has('ShiftRight') || stick.boost;
  // Cruise where you left the throttle, top speed with SHIFT. Both are real numbers for a
  // modern gunship rather than the jet speeds this used to fly at; see src/flight.js.
  const speed = boost ? TOP : CRUISE;
  // A time constant in seconds, not a third of one. The delay in answering the throttle is
  // most of what makes the dash feel like a dash when it is only a fifth faster, and it is
  // what stops three tonnes of helicopter changing direction like a car.
  const drag = 1 - Math.exp(-dt / FLIGHT.spoolSeconds);
  craft.vx += (mx * speed - craft.vx) * drag;
  craft.vz += (mz * speed - craft.vz) * drag;
  craft.x = clamp(craft.x + craft.vx * dt, -WORLD.half, WORLD.half);
  craft.z = clamp(craft.z + craft.vz * dt, -WORLD.half, WORLD.half);
  // Where the nose goes. An aim input wins outright and turns quickly, because it is a
  // weapon; with no aim input the nose settles in behind the direction of travel at the
  // rate the airframe can manage, which is slower the faster you are going — a rotor that
  // pivots on the spot in the hover has to fly a radius at three hundred kilometres an hour.
  const asked = requestedAim(held, stick);
  craft.aiming = asked !== null;
  if (asked !== null) {
    craft.aim = asked;
    craft.yaw = turnToward(craft.yaw, asked, FLIGHT.aimRate, dt);
  } else if (len > 0.08) {
    const pace = clamp(Math.hypot(craft.vx, craft.vz) / TOP, 0, 1);
    const rate = FLIGHT.yawRate.hover + (FLIGHT.yawRate.top - FLIGHT.yawRate.hover) * pace;
    craft.aim = headingOf(mx, mz);
    craft.yaw = turnToward(craft.yaw, craft.aim, rate, dt);
  }

  // Height. Holding the descend control now goes all the way to the ground instead of
  // stopping at a twenty-metre hover, which is what makes a landing possible at all. Over
  // ground it cannot use — water, a cliff — it holds a low hover and says why.
  const ground = world.groundHeight(craft.x, craft.z);
  const climbing = held.has('Space') || stick.climb;
  const descending = (held.has('KeyC') || stick.descend || performance.now() < landingAssist) && !climbing;
  if (descending) {
    const check = landingCheck(world, craft.x, craft.z);
    const floor = ground + (check.ok ? LANDING.skidHeight : LANDING.refusedClearance);
    craft.y = Math.max(floor, craft.y - LANDING.descentRate * dt);
    if (craft.y <= floor + 0.06 && touchDown()) return;
  } else {
    const wanted = Math.max(ground + LANDING.liftClearance, craft.y + (climbing ? 26 : 0) * dt * 6);
    craft.y += (wanted - craft.y) * (1 - Math.exp(-(wanted > craft.y ? 4.5 : 1.8) * dt));
  }
  craft.y = clamp(craft.y, ground + LANDING.skidHeight, 260);

  heli.group.position.set(craft.x, craft.y, craft.z);
  // The negative, because the nose is the model's own local -Z. See headingOf.
  heli.group.rotation.y = -craft.yaw;
  const forward = craft.vx * Math.sin(craft.yaw) - craft.vz * Math.cos(craft.yaw);
  const side = craft.vx * Math.cos(craft.yaw) + craft.vz * Math.sin(craft.yaw);
  heli.body.rotation.x = THREE.MathUtils.damp(heli.body.rotation.x, -forward * 0.006, 6, dt);
  heli.body.rotation.z = THREE.MathUtils.damp(heli.body.rotation.z, -side * 0.009, 6, dt);

  serviceOrBurn(dt, true, boost);
}

// ---------------------------------------------------------------- winch and weather
// The kinds that are a hook on a cable rather than a trigger.
const WINCH_KINDS = new Set(['extraction', 'salvage', 'search', 'delivery', 'sabotage']);
let cableOut = 0;
// The ground ring under the aircraft, sized so it stays the same size on screen however
// far out the view is pulled.
function updateMarker() {
  const showing = zoom > 1.35 || stance === 'afoot';
  const radius = viewHeight() / 26;
  // The aircraft keeps its ring whenever the pilot is out of it, so you can always see where
  // you left it.
  heli.marker.visible = showing;
  if (heli.marker.visible) {
    heli.marker.scale.setScalar(radius);
    heli.marker.position.y = world.groundHeight(craft.x, craft.z) - craft.y + 0.6;
  }
  // And the pilot keeps theirs whenever they are out, at any zoom: the first thing the
  // opening asks a player to do is walk, which means finding themselves first. This used to
  // wait for 1.35x, so at the default view the figure was a dozen pixels with nothing on it.
  figure.marker.visible = stance === 'afoot';
  if (figure.marker.visible) {
    figure.marker.scale.setScalar(radius);
    figure.marker.position.y = 0.4;
  }
}

function updateWinch(dt) {
  const usable = flying() && profile.heli.winch > 0 && mission && WINCH_KINDS.has(mission.kind);
  const running = usable && (keys.has('KeyE') || touchInput.winch);
  // Paid out to just above whatever is underneath, so the hook reaches the ground you are
  // hovering over rather than a fixed length into it.
  const clearance = running ? clamp(craft.y - world.groundHeight(craft.x, craft.z) - 1.5, 1, 22) : 0;
  cableOut += (clearance - cableOut) * (1 - Math.exp(-(running ? 3.2 : 5.5) * dt));
  heli.winch.visible = usable && cableOut > 0.08;
  if (!heli.winch.visible) return;
  heli.cable.scale.y = cableOut;
  heli.hook.position.y = -cableOut;
  // A little sway, so it reads as hanging rather than welded on.
  heli.winch.rotation.z = Math.sin(clock * 2.1) * 0.05 * Math.min(1, cableOut / 6);
}

// Weather is a complication, not a simulation: one job in a few arrives with the
// visibility going, and it closes in and lifts again with the contract.
const CLEAR = { fog: LOOK.fog.density, sun: LOOK.sun.intensity, hemi: LOOK.hemi.intensity,
  sky: LOOK.sky, tint: LOOK.fog.colour };
const CLOSED = { fog: LOOK.closing.density, sun: LOOK.closing.sun, hemi: LOOK.closing.hemi,
  sky: LOOK.closing.sky, tint: LOOK.closing.fog };
const skyColour = new THREE.Color(), fogColour = new THREE.Color();
const hemisphere = scene.children.find(o => o.isHemisphereLight);
function updateWeather(dt) {
  const closing = !!mission?.weather;
  const want = closing ? CLOSED : CLEAR;
  const rate = 1 - Math.exp(-0.5 * dt);
  // Fog is tuned for the default view, where it fades the far chunks into a horizon. At
  // eight times the view the same density would put the whole region behind a wall of it,
  // so it thins as you pull back and the region stays legible.
  const reach = want.fog / (1 + (zoom - 1) * 0.62);
  scene.fog.density += (reach - scene.fog.density) * rate;
  sun.intensity += (want.sun - sun.intensity) * rate;
  hemisphere.intensity += (want.hemi - hemisphere.intensity) * rate;
  skyColour.setHex(want.sky); fogColour.setHex(want.tint);
  scene.background.lerp(skyColour, rate);
  scene.fog.color.lerp(fogColour, rate);
}

// Each area gets its own tone without the game getting a new mood: a near-white tint at a
// third strength, eased as you cross the border so the light changes with the country
// rather than at a line. Weather takes the tint off — its own mood wins.
const regionTint = new THREE.Color(0xffffff), wantTint = new THREE.Color(0xffffff);
let tintAt = 0;
function updateTone(dt) {
  const here = world.regionAt(craft.x, craft.z);
  wantTint.setHex(REGION_GRADE[here.key] ?? 0xffffff);
  const rate = 1 - Math.exp(-1.1 * dt);
  regionTint.lerp(wantTint, rate);
  const want = mission?.weather ? 0 : GRADE_STRENGTH;
  tintAt += (want - tintAt) * rate;
  stage.uniforms.tint.value.copy(regionTint);
  stage.uniforms.tintAmount.value = tintAt;
}

// ---------------------------------------------------------------- zoom
// Eight steps of half a stop each, so the far end is exactly eight times the default view:
// a hundred metres of ground across the screen at the near end, eight hundred at the far.
// The near step is a little closer than the default, for looking at what you are hovering
// over.
const ZOOM_STEPS = [0.7, 1, 1.41, 2, 2.83, 4, 5.66, 8];
const ZOOM_DEFAULT = 1;
// Past this the streamed rings no longer reach the edge of the frame, so the coarse region
// mesh carries the far field. It is built once and always present, so crossing this costs
// nothing.
const OVERVIEW_FROM = 1.3;
let zoomStep = ZOOM_DEFAULT;
let zoom = ZOOM_STEPS[zoomStep];

// The view opens up a little with speed. The coefficient is higher than it was because
// the speeds are lower: at the old one, cruise and top looked the same.
// On foot the camera comes in close: a person is under two units tall and the flight
// view is a hundred across.
const baseView = () => (104 + Math.hypot(subject().vx, subject().vz) * 1.5)
  * (stance === 'afoot' ? FOOT.viewScale : 1);
// How much ground the frame covers vertically, in world units. The map reads this to draw
// the view rectangle, so the two can never disagree about what you can see.
function viewHeight() { return baseView() * zoom; }

function setZoom(step, snap = false) {
  const next = clamp(step, 0, ZOOM_STEPS.length - 1);
  // A pinch asks for the same step many times as the fingers move; only a real change is
  // worth a flash and a repaint.
  if (next === zoomStep && !snap) return;
  zoomStep = next;
  if (snap) zoom = ZOOM_STEPS[zoomStep];
  const across = Math.round(viewHeight() * (innerWidth / innerHeight) * WORLD.metresPerUnit);
  flash(`VIEW ${ZOOM_STEPS[zoomStep].toFixed(2).replace(/0$/, '')}× · ${(across / 1000).toFixed(1)} KM ACROSS`);
  paintMap();
}
const zoomBy = delta => setZoom(zoomStep + delta);

addEventListener('wheel', event => {
  if (overlayOpen()) return;
  event.preventDefault();
  zoomBy(event.deltaY > 0 ? 1 : -1);
}, { passive: false });

// Two fingers on the world drive the same ladder the wheel does. A step is half a stop, so
// each doubling of the gap between the fingers is two steps — which makes a comfortable
// spread roughly the whole range, and a pinch the way back.
const fingerGap = touches => Math.hypot(
  touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);

let pinch = null;
$('scene').addEventListener('touchstart', event => {
  if (event.touches.length !== 2 || overlayOpen()) { pinch = null; return; }
  event.preventDefault();
  pinch = { gap: fingerGap(event.touches), step: zoomStep };
}, { passive: false });
$('scene').addEventListener('touchmove', event => {
  if (!pinch || event.touches.length !== 2) return;
  event.preventDefault();
  const gap = fingerGap(event.touches);
  if (gap < 12 || pinch.gap < 12) return;
  setZoom(pinch.step - Math.round(Math.log2(gap / pinch.gap) * 2));
}, { passive: false });
for (const type of ['touchend', 'touchcancel']) {
  $('scene').addEventListener(type, event => { if (event.touches.length < 2) pinch = null; });
}

function updateCamera(dt, snap = false) {
  // Zoom eases towards the chosen step, so a wheel click is a movement rather than a jump.
  zoom += (ZOOM_STEPS[zoomStep] - zoom) * (snap ? 1 : 1 - Math.exp(-7 * dt));
  const view = viewHeight();
  const aspect = innerWidth / innerHeight;
  camera.left = -view * aspect / 2; camera.right = view * aspect / 2;
  camera.top = view / 2; camera.bottom = -view / 2;
  camera.updateProjectionMatrix();
  // The focus tracks the ground under the aircraft, not the sea. It used to sit at y = 0,
  // which put the camera at a fixed 142 units of absolute altitude — so on an alpine
  // summit, where the region legitimately reaches 158, the camera ended up *underneath the
  // terrain* and the frame was rendered from inside the mountain. Following the ground
  // keeps the framing identical at every elevation.
  const who = subject();
  const floor = world.groundHeight(who.x, who.z);
  const target = new THREE.Vector3(who.x + who.vx * 0.5, floor, who.z + who.vz * 0.5);
  if (snap) cameraFocus.copy(target); else cameraFocus.lerp(target, 1 - Math.exp(-4 * dt));
  // The camera pulls back as it zooms out. An orthographic projection does not care how
  // far away it is, but the clip planes do: without this a mountain at the edge of a wide
  // frame falls in front of the near plane and is sliced off.
  const pull = 1 + (zoom - 1) * 0.85;
  camera.position.copy(cameraFocus).addScaledVector(cameraOffset, pull);
  camera.near = 0.5;
  camera.far = 900 * Math.max(1, pull * 1.2);
  camera.lookAt(cameraFocus);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  // The shadow camera tracks the aircraft in quantised steps to keep shadows from crawling,
  // and rises with the focus so the frustum still covers the ground it is lighting. It
  // widens with the zoom up to a point; past that the shadow map would be spread so thin
  // that a rotor shadow is a single texel, so it stops growing and simply covers less of
  // what you can see, which is invisible at that scale.
  const spread = 110 * Math.min(zoom, 3.2);
  if (sun.shadow.camera.right !== spread) {
    Object.assign(sun.shadow.camera, { left: -spread, right: spread, top: spread, bottom: -spread });
    sun.shadow.camera.updateProjectionMatrix();
  }
  const quantum = Math.max(4, Math.round(zoom) * 4);
  const sx = Math.round(cameraFocus.x / quantum) * quantum, sz = Math.round(cameraFocus.z / quantum) * quantum;
  const sy = Math.round(cameraFocus.y / quantum) * quantum;
  sun.position.set(sx - 90, sy + 150, sz + 80);
  sun.target.position.set(sx, sy, sz);
  sun.target.updateMatrixWorld();
  // The coarse region mesh is the far field once the streamed rings stop reaching the edge
  // of the frame.
  if (overview) overview.mesh.visible = zoom > OVERVIEW_FROM;
}

// ---------------------------------------------------------------- post
// Bloom, then tone mapping, then the grade — one node graph instead of four passes of
// GLSL, so the same chain compiles to WGSL or GLSL depending on the backend underneath.
let stage = createPost(renderer, scene, camera);

function resize() {
  const ratio = Math.min(devicePixelRatio || 1, 1.6);
  renderer.setPixelRatio(ratio);
  renderer.setSize(innerWidth, innerHeight, false);
  // Turning a phone over changes the box the map gets, and the map is drawn to fit it.
  if (!$('map-panel').hidden && sizeMapCanvas()) refreshMap();
}
addEventListener('resize', resize);
addEventListener('orientationchange', resize);

// ---------------------------------------------------------------- region map
// The map is the only place you see the whole hundred square kilometres at once, so it has
// to read as terrain rather than as a colour key. Three things make that work: a hillshade
// computed from the height lattice so ridges and valleys are visible, faction territory as
// a light tint plus a drawn border rather than the heavy wash that used to bury the ground,
// and label placement that refuses to overlap.
const mapCanvas = $('map');
// The static map is drawn once into an offscreen canvas; the visible canvas is that image
// plus the things that move. Before this the aircraft marker was painted straight onto the
// map every frame, which only looked right because nothing is allowed to move while it is
// open.
const mapBase = document.createElement('canvas');
// mapRedraws counts how often the expensive base has been rebuilt, which is how the tests
// check that a flurry of gestures collapses into one redraw rather than one each.
let mapDrawn = false, mapMs = 0, mapRedraws = 0;

// ---------------------------------------------------------------- the map view
// Which window of the region the map is showing. Five steps, each a halving of the ground
// covered: the whole ten kilometres down to six hundred metres across, where one pixel is
// finer than the height lattice and there is nothing left to resolve.
//
// The base image is redrawn for the window rather than magnified. That is the whole point:
// zooming a map should show you more ground, not bigger pixels of the same ground.
const MAP_SPANS = [1, 2, 4, 8, 16].map(divisor => WORLD.size / divisor);
let mapStep = 0;
const mapView = { x: 0, z: 0, span: MAP_SPANS[0] };
// What the base image was last drawn for. While a finger is down the base is blitted to
// the new window instead, so the map moves under the hand and sharpens when it lifts.
const mapBaseView = { x: 0, z: 0, span: MAP_SPANS[0] };
const mapBaseMatches = () => mapBaseView.span === mapView.span
  && mapBaseView.x === mapView.x && mapBaseView.z === mapView.z;

// Panned to the edge and no further: the region is all there is, and a map that slides off
// into blank space is worse than one that stops.
function clampMapView() {
  const half = (WORLD.size - mapView.span) / 2;
  mapView.x = half <= 0 ? 0 : clamp(mapView.x, -half, half);
  mapView.z = half <= 0 ? 0 : clamp(mapView.z, -half, half);
}

// The canvas is sized to the box the layout gives it rather than a fixed 620 pixels, which
// is what put 115 pixels of map off each side of a phone. The backing store goes to twice
// the CSS size at most: enough for crisp labels on a phone without making the redraw four
// times the work on a three-times display.
function sizeMapCanvas() {
  const rect = mapCanvas.getBoundingClientRect();
  if (!rect.width) return false;
  const size = clamp(Math.round(rect.width * Math.min(devicePixelRatio || 1, 2)), 320, 900);
  if (mapCanvas.width === size) return false;
  mapCanvas.width = size; mapCanvas.height = size;
  return true;
}

// The cheap one: the base blitted to wherever the window is now, plus everything that
// moves. Used while a gesture is in flight, and it puts off any pending redraw — the
// picture should sharpen when the hand stops, not in the gap before the next pan.
function nudgeMap() {
  clearTimeout(mapRedrawTimer);
  paintMap();
}

// Drawing the base is a hundred-odd milliseconds of one thread — it samples the height
// field for every other pixel — so it waits for the hand to come off rather than running
// on every release of a drag. Six quick pans used to queue six redraws and block the main
// thread for most of a second, which swallowed the next tap. The cheap repaint keeps the
// map moving under the finger meanwhile and the picture sharpens a moment later.
let mapRedrawTimer = 0;
function refreshMap({ now = false } = {}) {
  if ($('map-panel').hidden) return;
  paintMap();
  clearTimeout(mapRedrawTimer);
  if (now) { drawMap(); paintMap(); return; }
  mapRedrawTimer = setTimeout(() => {
    if ($('map-panel').hidden || mapBaseMatches()) return;
    drawMap();
    paintMap();
  }, 110);
}

// Zoom about a point, so whatever is under the fingers stays under the fingers.
function setMapZoom(step, about = null, settle = true) {
  const next = clamp(step, 0, MAP_SPANS.length - 1);
  const span = MAP_SPANS[next];
  if (next === mapStep) return;
  // Hold the world point under `about` at the same place in the frame: it sits at the same
  // fraction of the window before and after.
  if (about) {
    mapView.x = about.x - (about.x - mapView.x) * (span / mapView.span);
    mapView.z = about.z - (about.z - mapView.z) * (span / mapView.span);
  }
  mapStep = next;
  mapView.span = span;
  clampMapView();
  if (settle) refreshMap(); else nudgeMap();
}

function resetMapView() {
  mapStep = 0;
  mapView.x = 0; mapView.z = 0; mapView.span = MAP_SPANS[0];
  refreshMap();
}

// Fields are sampled every other pixel and the shade interpolated between, which is
// invisible at this scale and four times less work: the old version sampled all 384,000
// pixels and parsed a CSS colour string for two of them each time.
const MAP_STEP = 2;
const MAP_LIGHT = (() => {
  const v = { x: -0.55, y: 0.62, z: -0.56 };
  const len = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / len, y: v.y / len, z: v.z / len };
})();
const MAP_BIOME_RGB = BIOMES.map(info => { const c = new THREE.Color(info.colour); return [c.r, c.g, c.b]; });
const MAP_FACTION_RGB = FACTIONS.map(f => { const c = new THREE.Color(f.colour); return [c.r, c.g, c.b]; });

// Places a label near a point, trying a few offsets and giving up rather than overlapping
// something already drawn. Callers go in priority order: regions, then landmarks, then the
// larger settlements, so a town beats an outpost for the space.
function labeller(ctx) {
  const taken = [];
  const clear = box => !taken.some(t => box[0] < t[2] && box[2] > t[0] && box[1] < t[3] && box[3] > t[1]);
  return (text, x, y, { font, colour, centre = false, halo = 0 } = {}) => {
    ctx.font = font;
    const w = ctx.measureText(text).width;
    const offsets = centre
      ? [[-w / 2, 3], [-w / 2, -9], [-w / 2, 14], [-w / 2, -21], [-w / 2, 26]]
      : [[7, 3], [-w - 7, 3], [-w / 2, -8], [-w / 2, 14]];
    for (const [dx, dy] of offsets) {
      const box = [x + dx - 2, y + dy - 9, x + dx + w + 2, y + dy + 3];
      if (!clear(box)) continue;
      taken.push(box);
      // A halo rather than a drop shadow for the region names: they are drawn in their own
      // tint, which on the ground that tint describes is nearly the same colour.
      if (halo) {
        ctx.strokeStyle = 'rgba(9,20,18,.85)';
        ctx.lineWidth = halo;
        ctx.lineJoin = 'round';
        ctx.strokeText(text, x + dx, y + dy);
      } else {
        ctx.fillStyle = 'rgba(9,20,18,.8)';
        ctx.fillText(text, x + dx + 1, y + dy + 1);
      }
      ctx.fillStyle = colour;
      ctx.fillText(text, x + dx, y + dy);
      return true;
    }
    return false;
  };
}

function drawMap() {
  const started = performance.now();
  const size = mapCanvas.width;
  // Everything below is drawn for the current window rather than for the whole region, so
  // a zoomed map is a finer sample of less ground instead of a magnified image.
  const { x: centreX, z: centreZ, span } = mapView;
  mapBase.width = size; mapBase.height = size;
  const ctx = mapBase.getContext('2d');
  const lattice = Math.ceil(size / MAP_STEP) + 1;
  const unitsPerNode = span / size * MAP_STEP;
  const height = new Float32Array(lattice * lattice);
  const biome = new Uint8Array(lattice * lattice);
  const owner = new Int8Array(lattice * lattice);

  // One pass of the fields. Height is computed once and handed to the derived fields rather
  // than being recomputed inside each of them.
  for (let j = 0; j < lattice; j++) {
    for (let i = 0; i < lattice; i++) {
      const x = centreX + (i * MAP_STEP / size - 0.5) * span;
      const z = centreZ + (j * MAP_STEP / size - 0.5) * span;
      const h = world.elevation(x, z);
      const k = j * lattice + i;
      height[k] = h;
      biome[k] = world.classify(h, world.moisture(x, z, h), world.temperature(x, z, h));
      owner[k] = h > WORLD.seaLevel ? world.factionAt(x, z) : -1;
    }
  }

  // Hillshade straight off the lattice: no extra field samples, and it is what turns a
  // patchwork of biome colours into something you can read as country.
  const shade = new Float32Array(lattice * lattice);
  const exaggeration = 2.4;
  for (let j = 0; j < lattice; j++) {
    for (let i = 0; i < lattice; i++) {
      const k = j * lattice + i;
      const east = height[j * lattice + Math.min(i + 1, lattice - 1)];
      const west = height[j * lattice + Math.max(i - 1, 0)];
      const south = height[Math.min(j + 1, lattice - 1) * lattice + i];
      const north = height[Math.max(j - 1, 0) * lattice + i];
      const nx = -(east - west) / (2 * unitsPerNode) * exaggeration;
      const nz = -(south - north) / (2 * unitsPerNode) * exaggeration;
      const len = Math.hypot(nx, 1, nz);
      const lambert = (nx * MAP_LIGHT.x + MAP_LIGHT.y + nz * MAP_LIGHT.z) / len;
      // Water is left flat; only land is lit.
      shade[k] = height[k] <= WORLD.seaLevel ? 1 : 0.62 + clamp(lambert, -1, 1) * 0.46;
    }
  }

  const image = ctx.createImageData(size, size);
  const data = image.data;
  for (let py = 0; py < size; py++) {
    const fj = py / MAP_STEP, j0 = Math.min(Math.floor(fj), lattice - 2), tj = fj - j0;
    for (let px = 0; px < size; px++) {
      const fi = px / MAP_STEP, i0 = Math.min(Math.floor(fi), lattice - 2), ti = fi - i0;
      const k = j0 * lattice + i0;
      const rgb = MAP_BIOME_RGB[biome[k]];
      let r = rgb[0], g = rgb[1], b = rgb[2];
      const faction = owner[k];
      if (faction >= 0) {
        // A light tint: enough to tell you whose ground it is, not enough to hide it.
        const ft = MAP_FACTION_RGB[faction];
        r = r * 0.84 + ft[0] * 0.16; g = g * 0.84 + ft[1] * 0.16; b = b * 0.84 + ft[2] * 0.16;
      }
      // Bilinear on the shade only, so biome edges stay crisp while the relief is smooth.
      const s00 = shade[k], s10 = shade[k + 1];
      const s01 = shade[k + lattice], s11 = shade[k + lattice + 1];
      const a = s00 + (s10 - s00) * ti, c = s01 + (s11 - s01) * ti;
      const lit = a + (c - a) * tj;
      const at = (py * size + px) * 4;
      data[at] = clamp(r * lit, 0, 1) * 255;
      data[at + 1] = clamp(g * lit, 0, 1) * 255;
      data[at + 2] = clamp(b * lit, 0, 1) * 255;
      data[at + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  const toMap = (x, z) => [((x - centreX) / span + 0.5) * size, ((z - centreZ) / span + 0.5) * size];
  // Off the window is not drawn, and — more to the point — does not take label space away
  // from something that is on it.
  const onFrame = (px, py, margin = 26) => px > -margin && px < size + margin && py > -margin && py < size + margin;

  // Coastline and faction borders, both traced off the lattice. A drawn border says
  // somebody holds this ground far better than tinting all of it does.
  for (let j = 1; j < lattice - 1; j++) {
    for (let i = 1; i < lattice - 1; i++) {
      const k = j * lattice + i;
      const px = i * MAP_STEP, py = j * MAP_STEP;
      const wet = height[k] <= WORLD.seaLevel;
      if (wet !== (height[k + 1] <= WORLD.seaLevel) || wet !== (height[k + lattice] <= WORLD.seaLevel)) {
        ctx.fillStyle = 'rgba(232,240,214,.5)';
        ctx.fillRect(px, py, MAP_STEP, MAP_STEP);
      } else if (!wet && owner[k] >= 0 && (owner[k] !== owner[k + 1] || owner[k] !== owner[k + lattice])) {
        ctx.fillStyle = FACTIONS[owner[k]].colour + 'b0';
        ctx.fillRect(px, py, MAP_STEP, MAP_STEP);
      }
    }
  }

  // A grid and a scale bar, because a distance should be something you can measure off the
  // map rather than something you are told in the header. The spacing steps down with the
  // zoom so there are always five to a dozen lines across the frame: a kilometre grid holds
  // to the halfway step, then five hundred metres, then two hundred, then a hundred.
  const acrossMetres = span * WORLD.metresPerUnit;
  const gridMetres = [1000, 500, 200, 100, 50, 25].find(metres => metres <= acrossMetres / 5) ?? 25;
  const gridUnits = gridMetres / WORLD.metresPerUnit;
  ctx.strokeStyle = 'rgba(232,240,214,.10)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = Math.ceil((centreX - span / 2) / gridUnits) * gridUnits; x <= centreX + span / 2; x += gridUnits) {
    const at = toMap(x, 0)[0];
    ctx.moveTo(at, 0); ctx.lineTo(at, size);
  }
  for (let z = Math.ceil((centreZ - span / 2) / gridUnits) * gridUnits; z <= centreZ + span / 2; z += gridUnits) {
    const at = toMap(0, z)[1];
    ctx.moveTo(0, at); ctx.lineTo(size, at);
  }
  ctx.stroke();
  const barPx = gridUnits / span * size;
  const barLabel = gridMetres >= 1000 ? `${gridMetres / 1000} KM` : `${gridMetres} M`;
  ctx.fillStyle = 'rgba(9,20,18,.62)';
  ctx.fillRect(14, size - 32, barPx + 18, 22);
  ctx.strokeStyle = '#edeedf'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(22, size - 15); ctx.lineTo(22 + barPx, size - 15);
  ctx.moveTo(22, size - 19); ctx.lineTo(22, size - 11);
  ctx.moveTo(22 + barPx, size - 19); ctx.lineTo(22 + barPx, size - 11);
  ctx.stroke();
  ctx.font = '600 8px Barlow, sans-serif';
  ctx.fillStyle = '#edeedf';
  ctx.fillText(barLabel, 26, size - 22);

  const place = labeller(ctx);

  // Regions first: they are the biggest thing on the map and the labels that matter most.
  for (const region of world.regions.regions) {
    const [rx, ry] = toMap(region.x, region.z);
    if (!onFrame(rx, ry)) continue;
    place(region.name, rx, ry, {
      font: '700 11px "Barlow Condensed", Barlow, sans-serif', colour: region.colour, centre: true, halo: 3.2,
    });
  }

  // Landmarks: a diamond and a name, and they never lose their label to a village.
  for (const mark of world.landmarks()) {
    const [mx, my] = toMap(mark.x, mark.z);
    if (!onFrame(mx, my)) continue;
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#f4edc9';
    ctx.strokeStyle = '#1c2a26'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.rect(-3.4, -3.4, 6.8, 6.8); ctx.fill(); ctx.stroke();
    ctx.restore();
    place(mark.short, mx, my, { font: '700 9px Barlow, sans-serif', colour: '#f4edc9', halo: 2.6 });
  }

  // Settlements: every one gets a dot, and a name if there is room for it.
  const order = { town: 0, airfield: 1, port: 2, refinery: 3, village: 4, camp: 5, outpost: 6 };
  const sites = world.allSettlements().slice().sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9));
  for (const site of sites) {
    const [mx, my] = toMap(site.x, site.z);
    if (!onFrame(mx, my, 8)) continue;
    ctx.fillStyle = FACTIONS[site.faction].colour;
    ctx.strokeStyle = 'rgba(9,20,18,.7)'; ctx.lineWidth = 1;
    const r = site.kind === 'town' ? 3.6 : site.kind === 'village' ? 2.8 : 2.2;
    ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  // Zoomed in there is room for every name, not just the four biggest kinds of place.
  const named = span <= MAP_SPANS[2]
    ? ['town', 'airfield', 'port', 'refinery', 'village', 'camp', 'outpost']
    : ['town', 'airfield', 'port', 'refinery'];
  for (const site of sites) {
    if (!named.includes(site.kind)) continue;
    const [mx, my] = toMap(site.x, site.z);
    if (!onFrame(mx, my)) continue;
    place(site.name, mx, my, { font: '600 8px Barlow, sans-serif', colour: '#dfe6d2' });
  }

  mapDrawn = true;
  mapRedraws++;
  mapBaseView.x = centreX; mapBaseView.z = centreZ; mapBaseView.span = span;
  mapMs = performance.now() - started;
}

// The static map plus everything that moves: your yard, the aircraft, what the camera can
// see, and the job in hand.
function paintMap() {
  if ($('map-panel').hidden || !mapDrawn) return;
  const size = mapCanvas.width;
  const ctx = mapCanvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  // The base image, placed where the current window puts it. Settled that is one to one;
  // mid-gesture it is scaled and offset, which is what keeps the map moving under the hand
  // until the redraw catches up.
  const scale = mapBaseView.span / mapView.span;
  const offsetX = (mapBaseView.x - mapView.x) / mapView.span * size;
  const offsetZ = (mapBaseView.z - mapView.z) / mapView.span * size;
  ctx.drawImage(mapBase,
    size / 2 + offsetX - size * scale / 2, size / 2 + offsetZ - size * scale / 2,
    size * scale, size * scale);

  const toMap = (x, z) => [((x - mapView.x) / mapView.span + 0.5) * size, ((z - mapView.z) / mapView.span + 0.5) * size];
  // Markers were sized for a fixed 620-pixel canvas; now the canvas is whatever the screen
  // can give it, so they are drawn in proportion to it.
  const unit = size / 620;
  const [px, py] = toMap(craft.x, craft.z);

  // The job in hand, so the map answers where am I going as well as where am I.
  if (profile.active) {
    const [cx, cy] = toMap(profile.active.site.x, profile.active.site.z);
    ctx.strokeStyle = 'rgba(243,178,94,.45)'; ctx.lineWidth = unit;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(cx, cy); ctx.stroke();
    ctx.strokeStyle = '#f3b25e'; ctx.lineWidth = 1.6 * unit;
    ctx.setLineDash([3 * unit, 3 * unit]);
    ctx.beginPath(); ctx.arc(cx, cy, 11 * unit, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }

  const [hx, hy] = toMap(home.x, home.z);
  ctx.strokeStyle = '#f3b25e'; ctx.lineWidth = 2 * unit;
  ctx.beginPath(); ctx.arc(hx, hy, 7 * unit, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(hx - 11 * unit, hy); ctx.lineTo(hx + 11 * unit, hy);
  ctx.moveTo(hx, hy - 11 * unit); ctx.lineTo(hx, hy + 11 * unit);
  ctx.stroke();

  // What the camera can actually see right now, which is how the zoom reads on the map.
  const halfZ = viewHeight() / 2 / mapView.span * size;
  const halfX = halfZ * (innerWidth / innerHeight);
  const [vx, vy] = toMap(subject().x, subject().z);
  ctx.strokeStyle = 'rgba(244,237,201,.34)'; ctx.lineWidth = unit;
  ctx.strokeRect(vx - halfX, vy - halfZ, halfX * 2, halfZ * 2);

  // Zoomed in, the aircraft is often outside the window. An arrow pinned to the edge says
  // which way it is, so a zoomed map never loses you.
  if (px < 0 || py < 0 || px > size || py > size) {
    const edgeX = clamp(px, 14 * unit, size - 14 * unit), edgeY = clamp(py, 14 * unit, size - 14 * unit);
    ctx.save();
    ctx.translate(edgeX, edgeY);
    ctx.rotate(Math.atan2(px - edgeX, -(py - edgeY)));
    ctx.fillStyle = 'rgba(244,237,201,.72)';
    ctx.beginPath();
    ctx.moveTo(0, -9 * unit); ctx.lineTo(5.5 * unit, 4 * unit); ctx.lineTo(-5.5 * unit, 4 * unit);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // On foot the pilot gets their own mark and a line back to the aircraft, because a person
  // is invisible at this scale and walking away from your ride is the one mistake being able
  // to get out makes possible.
  if (stance === 'afoot') {
    const [fx, fy] = toMap(pilot.x, pilot.z);
    ctx.strokeStyle = 'rgba(159,224,255,.55)'; ctx.lineWidth = unit;
    ctx.setLineDash([2 * unit, 3 * unit]);
    ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(px, py); ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(craft.yaw);
  // Dimmed when it is parked and you are not in it.
  ctx.fillStyle = stance === 'afoot' ? '#a9b49c' : '#f4edc9';
  ctx.strokeStyle = '#1c2a26'; ctx.lineWidth = unit;
  ctx.beginPath();
  ctx.moveTo(0, -7 * unit); ctx.lineTo(4.5 * unit, 5.5 * unit); ctx.lineTo(0, 2.5 * unit); ctx.lineTo(-4.5 * unit, 5.5 * unit);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();

  if (stance === 'afoot') {
    const [fx, fy] = toMap(pilot.x, pilot.z);
    ctx.fillStyle = '#9fe0ff';
    ctx.strokeStyle = '#12201c'; ctx.lineWidth = unit;
    ctx.beginPath(); ctx.arc(fx, fy, 3.6 * unit, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }

  const across = mapView.span * WORLD.metresPerUnit;
  $('map-scale').textContent = `${across >= 1000 ? +(across / 1000).toFixed(2) + ' KM' : Math.round(across) + ' M'} ACROSS`
    + ` · ${world.regionAt(mapView.x, mapView.z).name}`;
  $('map-out').disabled = mapStep === 0;
  $('map-in').disabled = mapStep === MAP_SPANS.length - 1;
}

function toggleMap() {
  const panel = $('map-panel');
  panel.hidden = !panel.hidden;
  if (!panel.hidden) mapOpened = true;
  if (panel.hidden) return;
  const resized = sizeMapCanvas();
  if (!mapDrawn || resized || !mapBaseMatches()) drawMap();
  paintMap();
}
onTap($('map-close'), toggleMap);

// ---------------------------------------------------------------- map gestures
// Drag to pan, pinch or wheel to zoom, double tap or double click to zoom in on a spot.
// At ten kilometres across on a phone screen the whole region is about forty metres to the
// pixel, so a map you cannot get closer to is a map you cannot read.
const mapPointAt = (clientX, clientY) => {
  const rect = mapCanvas.getBoundingClientRect();
  return {
    x: mapView.x + ((clientX - rect.left) / rect.width - 0.5) * mapView.span,
    z: mapView.z + ((clientY - rect.top) / rect.height - 0.5) * mapView.span,
  };
};

let mapPinch = null;
let mapDrag = null;

mapCanvas.addEventListener('pointerdown', event => {
  if (mapPinch) return;
  event.preventDefault();
  try { mapCanvas.setPointerCapture(event.pointerId); } catch { /* a synthetic pointer cannot be captured */ }
  mapDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: 0 };
});
mapCanvas.addEventListener('pointermove', event => {
  if (!mapDrag || event.pointerId !== mapDrag.id || mapPinch) return;
  const rect = mapCanvas.getBoundingClientRect();
  const dx = (event.clientX - mapDrag.x) / rect.width * mapView.span;
  const dz = (event.clientY - mapDrag.y) / rect.height * mapView.span;
  mapDrag.x = event.clientX; mapDrag.y = event.clientY;
  mapDrag.moved += Math.abs(dx) + Math.abs(dz);
  // The ground follows the finger, so dragging left brings what is on the right into view.
  mapView.x -= dx; mapView.z -= dz;
  clampMapView();
  nudgeMap();
});
function endMapDrag(event) {
  if (!mapDrag || (event && event.pointerId !== mapDrag.id)) return;
  const moved = mapDrag.moved;
  mapDrag = null;
  if (moved > 0.5) refreshMap();
}
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) mapCanvas.addEventListener(type, endMapDrag);

mapCanvas.addEventListener('touchstart', event => {
  if (event.touches.length !== 2) return;
  event.preventDefault();
  mapDrag = null;
  mapPinch = { gap: fingerGap(event.touches), step: mapStep, about: mapPointAt(
    (event.touches[0].clientX + event.touches[1].clientX) / 2,
    (event.touches[0].clientY + event.touches[1].clientY) / 2) };
}, { passive: false });
mapCanvas.addEventListener('touchmove', event => {
  if (!mapPinch || event.touches.length !== 2) return;
  event.preventDefault();
  const gap = fingerGap(event.touches);
  if (gap < 12 || mapPinch.gap < 12) return;
  // The map's steps are whole doublings, so one doubling of the finger gap is one step.
  setMapZoom(mapPinch.step + Math.round(Math.log2(gap / mapPinch.gap)), mapPinch.about, false);
}, { passive: false });
for (const type of ['touchend', 'touchcancel']) {
  mapCanvas.addEventListener(type, event => {
    if (event.touches.length >= 2 || !mapPinch) return;
    mapPinch = null;
    refreshMap();
  });
}

mapCanvas.addEventListener('wheel', event => {
  event.preventDefault();
  event.stopPropagation();
  setMapZoom(mapStep + (event.deltaY > 0 ? -1 : 1), mapPointAt(event.clientX, event.clientY));
}, { passive: false });
mapCanvas.addEventListener('dblclick', event => {
  event.preventDefault();
  setMapZoom(mapStep + 1, mapPointAt(event.clientX, event.clientY));
});

onTap($('map-in'), () => setMapZoom(mapStep + 1, { x: craft.x, z: craft.z }));
onTap($('map-out'), () => setMapZoom(mapStep - 1));
onTap($('map-reset'), resetMapView);

// ---------------------------------------------------------------- thumb controls
// Left thumb flies, right thumb fights, and the rail down the right edge reaches the doors
// that M, B, H and G reach on a keyboard. The stick is analogue: how far over it is sets
// the speed, and pushed to the rim it runs the throttle up the way SHIFT does, so there is
// no separate boost button to hold.
const joystick = $('joystick');

function moveStick(event) {
  const rect = joystick.getBoundingClientRect();
  const dx = event.clientX - (rect.left + rect.width / 2);
  const dy = event.clientY - (rect.top + rect.height / 2);
  const reach = rect.width * 0.34;
  const length = Math.hypot(dx, dy);
  const scale = length > reach ? reach / length : 1;
  touchInput.x = Math.abs(dx) < 4 ? 0 : dx * scale / reach;
  touchInput.y = Math.abs(dy) < 4 ? 0 : dy * scale / reach;
  touchInput.boost = Math.hypot(touchInput.x, touchInput.y) > 0.82;
  $('stick').style.transform = `translate(${dx * scale}px,${dy * scale}px)`;
}

let stickPointer = null;
joystick.addEventListener('pointerdown', event => {
  event.preventDefault();
  stickPointer = event.pointerId;
  try { joystick.setPointerCapture(event.pointerId); } catch { /* synthetic pointers cannot be captured */ }
  moveStick(event);
});
joystick.addEventListener('pointermove', event => { if (event.pointerId === stickPointer) moveStick(event); });
function centreStick(event) {
  if (event && event.pointerId !== stickPointer) return;
  stickPointer = null;
  touchInput.x = 0; touchInput.y = 0; touchInput.boost = false;
  $('stick').style.transform = '';
}
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) joystick.addEventListener(type, centreStick);

// A button that acts for as long as it is held, which is what firing, winching, flaring
// and changing height all are.
function holdButton(id, set) {
  const button = $(id);
  let pointer = null;
  const release = event => {
    if (event && event.pointerId !== pointer) return;
    pointer = null;
    set(false);
    button.classList.remove('pressed');
  };
  button.addEventListener('pointerdown', event => {
    event.preventDefault();
    pointer = event.pointerId;
    try { button.setPointerCapture(event.pointerId); } catch { /* as above */ }
    set(true);
    button.classList.add('pressed');
    wakeAudio();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, release);
  return () => release(null);
}

// The right thumb is the second stick. Holding it fires; sliding it points the aircraft.
// Held still — which is all a tap is — it fires straight ahead and lets the target lock do
// the pointing, so it still behaves exactly as the plain button did.
const aimPad = $('touch-fire');
const aimNub = aimPad.firstElementChild;
let aimPointer = null;

function moveAimPad(event) {
  const rect = aimPad.getBoundingClientRect();
  const dx = event.clientX - (rect.left + rect.width / 2);
  const dy = event.clientY - (rect.top + rect.height / 2);
  const reach = rect.width * 0.42;
  const length = Math.hypot(dx, dy);
  const scale = length > reach ? reach / length : 1;
  const dead = length < 7;
  touchInput.aimX = dead ? 0 : dx * scale / reach;
  touchInput.aimY = dead ? 0 : dy * scale / reach;
  aimNub.style.transform = dead ? '' : `translate(${dx * scale * 0.55}px,${dy * scale * 0.55}px)`;
}

function releaseAimPad(event) {
  if (event && event.pointerId !== aimPointer) return;
  aimPointer = null;
  touchInput.fire = false;
  touchInput.aimX = 0; touchInput.aimY = 0;
  aimPad.classList.remove('pressed');
  aimNub.style.transform = '';
}

aimPad.addEventListener('pointerdown', event => {
  event.preventDefault();
  aimPointer = event.pointerId;
  try { aimPad.setPointerCapture(event.pointerId); } catch { /* synthetic pointers cannot be captured */ }
  touchInput.fire = true;
  aimPad.classList.add('pressed');
  wakeAudio();
  moveAimPad(event);
});
aimPad.addEventListener('pointermove', event => { if (event.pointerId === aimPointer) moveAimPad(event); });
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  aimPad.addEventListener(type, releaseAimPad);
}

const thumbReleases = [
  () => releaseAimPad(null),
  holdButton('touch-winch', held => { touchInput.winch = held; }),
  holdButton('touch-flare', held => { touchInput.flare = held; }),
  holdButton('touch-climb', held => { touchInput.climb = held; }),
  holdButton('touch-descend', held => { touchInput.descend = held; }),
];
// Tabbing away or taking a call must not leave the trigger down.
function releaseThumbs() {
  centreStick();
  for (const release of thumbReleases) release();
}
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseThumbs(); });

// The contract board is a permanent panel with room to spare on a desktop and a sheet you
// pull up on a phone. Either way, reading it holds the aircraft on station.
function toggleWork() {
  const open = $('outfit').classList.toggle('open');
  $('rail-work').classList.toggle('on', open);
}

for (const [id, action] of Object.entries({
  'rail-map': toggleMap,
  'rail-work': toggleWork,
  'rail-yard': toggleYard,
  'rail-stance': () => {
    // In the air this asks for a descent; on the ground it is the way out and back in.
    if (stance === 'flying') { landingAssist = performance.now() + 5000; flash('SETTING DOWN'); }
    else toggleStance();
  },
  'rail-home': () => { teleportHome(); flash('BACK ON THE PAD'); },
  'rail-panels': () => document.body.classList.toggle('telemetry'),
})) onTap($(id), event => { event.preventDefault(); action(); });

// The weapon tiles are the 1/2/3 keys for a thumb. Delegated, because renderWeapons
// rebuilds them every time the ammunition count changes.
onTap($('weapons'), event => {
  const tile = event.target.closest('#weapons div');
  if (!tile) return;
  const index = [...$('weapons').children].indexOf(tile);
  if (index < 0 || index >= availableWeapons(profile.heli).length) return;
  combat.weapon = index;
  renderWeapons();
  renderStance();
});

// Tapping the darkness around a card closes it, which is what a phone expects of a sheet
// and saves hunting for a small × in a corner.
for (const [id, close] of [['map-panel', toggleMap], ['yard', toggleYard]]) {
  $(id).addEventListener('pointerdown', event => { if (event.target === $(id)) close(); });
}

// ---------------------------------------------------------------- loop
let last = 0, frames = 0, fpsAccum = 0, fps = 60, clock = 0, buildHitch = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(last ? (now - last) / 1000 : 1 / 60, 0.05);
  last = now; clock += dt;
  fpsAccum += dt; frames++;
  if (fpsAccum > 0.4) { fps = frames / fpsAccum; frames = 0; fpsAccum = 0; }

  flight(dt);
  syncHostiles(combat, world, profile, [...streamer.resident.keys()]);
  const events = stepCombat(combat, world, profile, craft,
    { fire: flying() && (keys.has('Space') || mouseFire || touchInput.fire),
      flare: flying() && (keys.has('KeyF') || touchInput.flare) }, dt);
  for (const event of events) {
    if (event.type === 'destroyed') {
      // Salvage rights: the fee is lower, but what you break on the way is yours.
      const bounty = Math.round(event.score / 4 * (mission?.salvageRights ? 2 : 1));
      profile.cash += bounty;
      flash(`${event.unit.toUpperCase()} DESTROYED · +${bounty}`);
      audio.event({ type: 'explosion', size: event.size ?? 1.4 });
    }
    if (event.type === 'shot') audio.event({ type: 'shot', weapon: event.weapon });
    if (event.type === 'craftHit') audio.event({ type: 'playerHit' });
    if (event.type === 'incoming') audio.event({ type: 'incoming' });
    if (event.type === 'flare') audio.event({ type: 'flares' });
    if (event.type === 'blast') audio.event({ type: 'explosion', size: 1 });
    if (event.type === 'downed') loseAircraft();
  }
  const deltas = combatStandingDeltas(events);
  if (Object.keys(deltas).length) { applyStanding(profile, deltas); renderOutfit(); }
  entityView.sync([...combat.hostiles, ...(mission?.entities ?? []),
    ...(mission?.convoy ? [mission.convoy] : [])]);
  tracers.sync(combat.projectiles);
  const t0 = performance.now();
  const streamed = streamer.update(subject().x, subject().z);
  buildHitch = buildHitch * 0.8 + (performance.now() - t0) * 0.2;
  updateCamera(dt);
  updateRotor(dt);
  updateWinch(dt);
  updateMarker();
  updateWeather(dt);
  updateTone(dt);
  updateTeaching(dt);
  audio.update(Math.hypot(craft.vx, craft.vz), 'playing');

  renderer.info.reset();
  stage.render();

  updateActive(dt);
  if ($('flash') && !$('flash').hidden && performance.now() > flashUntil) $('flash').hidden = true;
  if (Math.floor(clock * 4) % 2 === 0) updateReadout(streamed);
  paintMap();
}

function updateReadout(streamed) {
  // The panel reports whatever you are controlling. Reading the parked aircraft's zero
  // while the player is walking at seven kilometres an hour is simply wrong.
  const who = subject();
  const s = world.sample(who.x, who.z);
  const km = v => (v * WORLD.metresPerUnit / 1000).toFixed(2);
  $('pos').textContent = `${km(who.x)} , ${km(who.z)} km`;
  $('alt').textContent = `${Math.round((who.y - s.height) * WORLD.metresPerUnit)} m AGL`;
  $('speed').textContent = stance === 'afoot'
    ? `${Math.round(unitsToKmh(Math.hypot(who.vx, who.vz)))} / ${FOOT.runKmh} km/h ON FOOT`
    : `${Math.round(unitsToKmh(Math.hypot(craft.vx, craft.vz)))} / ${FLIGHT.topKmh} km/h`;
  $('biome').textContent = BIOMES[s.biome].name;
  const region = world.regionAt(who.x, who.z);
  $('region').textContent = region.name;
  $('region').style.color = region.colour;
  $('territory').textContent = s.faction < 0 ? 'UNCLAIMED WATER' : FACTIONS[s.faction].name;
  $('territory').style.color = s.faction < 0 ? '#9fb49d' : FACTIONS[s.faction].colour;
  // Landmarks count as places, and outrank a village at the same distance — they are what
  // you actually navigate by.
  const near = [...world.settlementsNear(who.x, who.z, 320), ...world.landmarksNear(who.x, who.z, 460)]
    .sort((a, b) => (Math.hypot(a.x - who.x, a.z - who.z) - (a.landmark ? 140 : 0))
      - (Math.hypot(b.x - who.x, b.z - who.z) - (b.landmark ? 140 : 0)))[0];
  $('nearest').textContent = near
    ? `${near.name} · ${near.kindName} · ${FACTIONS[near.faction].short} · ${Math.round(Math.hypot(near.x - who.x, near.z - who.z) * WORLD.metresPerUnit)} m`
    : 'NOTHING WITHIN 1.6 KM';
  $('chunks').textContent = `${streamer.resident.size} resident · ${streamed.pending} queued · ${streamer.stats.built} built · ${streamer.stats.disposed} released`;
  $('geometry').textContent = `${residentMeshes} meshes · ${Math.round(residentTriangles / 1000)}k triangles held`;
  $('draw').textContent = `${frameDrawCalls(renderer)} calls · ${Math.round(renderer.info.render.triangles / 1000)}k drawn`;
  $('fps').textContent = `${Math.round(fps)} fps · stream ${buildHitch.toFixed(1)} ms/frame`;
  const across = viewHeight() * (innerWidth / innerHeight) * WORLD.metresPerUnit / 1000;
  $('view').textContent = `${ZOOM_STEPS[zoomStep].toFixed(2).replace(/0$/, '')}× · ${across.toFixed(2)} km across`;
  $('armour').textContent = Math.round(combat.armour);
  $('armour-bar').style.width = Math.round(combat.armour / combat.maxArmour * 100) + '%';
  $('armour-bar').style.background = combat.armour < combat.maxArmour * 0.3 ? '#ff8060' : '#b9d7b3';
  $('fuel').textContent = Math.round(combat.fuel);
  $('fuel-bar').style.width = Math.round(combat.fuel / combat.maxFuel * 100) + '%';
  $('alert').hidden = combat.alert <= 0;
  renderWeapons();
}

// ---------------------------------------------------------------- boot
try {
  resize();
  $('seed').textContent = String(seed);
  streamer.settle(craft.x, craft.z, 300);
  updateCamera(0, true);
  stage.render();
  refreshBoard();
  renderOutfit();
  renderWeapons();
  $('loading').hidden = true;
  rebuildYard();
  if (!returning) {
    // A first run starts on foot in the yard, with the machine parked, and is talked
    // through the first job a sentence at a time. The briefing card is still there — it is
    // a reference now, opened from the yard or with / — rather than homework before you
    // are allowed to play.
    stance = 'landed';
    craft.y = world.groundHeight(home.x, home.z) + LANDING.skidHeight;
    climbOut();
    teaching = createTutorial();
    renderTeaching();
  }
  requestAnimationFrame(frame);
  setTimeout(buildFarField, 0);
} catch (error) {
  console.error(error);
  $('loading').innerHTML = `<p>WORLD FAILED TO START</p><small>${error.message}</small>`;
}

// Read-only diagnostics for the inspection harness and the tests.
window.merc = {
  world, craft, streamer, WORLD, profile,
  board: () => board,
  tick: () => { updateActive(); return true; },
  take: index => takeContract(board[index]),
  outfit: () => ({ cash: profile.cash, day: profile.day, standing: { ...profile.standing },
    active: profile.active && { title: profile.active.title, reached: !!profile.active.reached },
    completed: profile.completed.length, board: board.length, quill: situation(profile) }),
  renderer, scene, camera, stage, sun, materials, heli, sea, backend,
  raw: () => { renderer.render(scene, camera); },
  state: () => ({
    seed, position: { x: craft.x, z: craft.z, y: craft.y },
    sample: world.sample(craft.x, craft.z),
    resident: streamer.resident.size, pending: streamer.queue.length,
    meshes: residentMeshes, triangles: Math.round(residentTriangles),
    draw: frameDrawCalls(renderer), drawn: renderer.info.render.triangles,
    backend, webgpu: backend === 'WebGPU',
    speedKmh: Math.round(unitsToKmh(Math.hypot(craft.vx, craft.vz))),
    // Read off the scene graph rather than recomputed, so a sign error cannot hide here.
    nose: (() => { const v = new THREE.Vector3(0, 0, -1).applyQuaternion(heli.group.quaternion); return { x: +v.x.toFixed(3), z: +v.z.toFixed(3) }; })(),
    travel: (() => { const l = Math.hypot(craft.vx, craft.vz) || 1; return { x: +(craft.vx / l).toFixed(3), z: +(craft.vz / l).toFixed(3) }; })(),
    yaw: +craft.yaw.toFixed(3), aim: +craft.aim.toFixed(3), aiming: craft.aiming,
    stance,
    pilot: { x: +pilot.x.toFixed(2), z: +pilot.z.toFixed(2), y: +pilot.y.toFixed(2),
      speedKmh: Math.round(unitsToKmh(Math.hypot(pilot.vx, pilot.vz))), visible: figure.group.visible },
    toAircraft: +Math.hypot(pilot.x - craft.x, pilot.z - craft.z).toFixed(2),
    rotor: +rotorSpeed.toFixed(3),
    teaching: teaching && tutorialStep(teaching) ? tutorialStep(teaching).id : null,
    teachingDone: !!teaching?.finished,
    mapOpened,
    tint: '#' + regionTint.getHexString(), tintAmount: +tintAt.toFixed(3),
    exposure: renderer.toneMappingExposure, sun: +sun.intensity.toFixed(2), hemi: +hemisphere.intensity.toFixed(2),
    fps: Math.round(fps), streamMs: +buildHitch.toFixed(2),
    stats: { ...streamer.stats },
    region: world.regionAt(craft.x, craft.z).key,
    regionNodes: world.regions.stats().nodes,
    fog: +scene.fog.density.toFixed(5),
    cable: +cableOut.toFixed(2),
    projectiles: combat.projectiles.length,
    intro: !$('intro').hidden,
    zoom: +zoom.toFixed(2), zoomStep, viewAcross: Math.round(viewHeight() * (innerWidth / innerHeight)),
    overview: overview ? { visible: overview.mesh.visible, triangles: overview.triangles, ms: overview.ms } : null,
    mapMs: +mapMs.toFixed(0),
    // Clearance of the camera above the ground beneath it. Negative means the frame is
    // being rendered from inside a hill, which is what happened on an alpine summit while
    // the focus was pinned to sea level.
    cameraClearance: +(camera.position.y - world.groundHeight(camera.position.x, camera.position.z)).toFixed(1),
  }),
  regions: () => world.regions.regions.map(r => ({ key: r.key, name: r.name, x: r.x, z: r.z })),
  marks: () => world.landmarks().map(m => ({ key: m.key, short: m.short, x: m.x, z: m.z,
    height: +m.height.toFixed(1), region: m.region })),
  intro: () => { showIntro(); return true; },
  // Landing, and getting in and out, for the browser suite.
  land: (seconds = 6) => { landingAssist = performance.now() + seconds * 1000; return true; },
  teachStep: () => (teaching && tutorialStep(teaching) ? tutorialStep(teaching).id : null),
  teachSay: () => $('teach-say').textContent,
  skipTeaching: () => abandonTeaching(),
  yardTriangles: () => yard?.triangles ?? 0,
  stanceNow: () => stance,
  getOut: () => climbOut(),
  getIn: () => climbIn(),
  landingHere: () => landingCheck(world, craft.x, craft.z),
  pilotAt: () => ({ ...pilot }),
  // Where the pointer is on the ground, for verifying that the nose follows it.
  aimPoint: () => ({ x: +aimPoint.x.toFixed(2), z: +aimPoint.z.toFixed(2) }),
  zoomTo: step => { setZoom(step, true); updateCamera(0, true); return ZOOM_STEPS[zoomStep]; },
  // The tone curve and the exposure, live. The node graph reads the curve when it is built,
  // so changing it rebuilds the chain.
  tone: (name, exposure = null) => {
    if (name && TONES[name] !== undefined) renderer.toneMapping = TONES[name];
    if (exposure !== null) renderer.toneMappingExposure = exposure;
    stage = createPost(renderer, scene, camera);
    updateTone(1);
    stage.render();
    return { tone: name, exposure: renderer.toneMappingExposure };
  },
  // The grade and the bloom are uniforms, so these take effect without rebuilding anything.
  grade: (values = {}) => {
    for (const [key, value] of Object.entries(values)) {
      if (stage.uniforms[key]) stage.uniforms[key].value = value;
      else if (stage.bloom?.[key]) stage.bloom[key].value = value;
    }
    stage.render();
    return { vignette: stage.uniforms.vignette.value, saturation: stage.uniforms.saturation.value,
      contrast: stage.uniforms.contrast.value, strength: stage.bloom?.strength?.value,
      radius: stage.bloom?.radius?.value, threshold: stage.bloom?.threshold?.value };
  },
  light: (sunAt, hemiAt) => {
    if (sunAt !== undefined) { sun.intensity = sunAt; CLEAR.sun = sunAt; }
    if (hemiAt !== undefined) { hemisphere.intensity = hemiAt; CLEAR.hemi = hemiAt; }
    return { sun: sun.intensity, hemi: hemisphere.intensity };
  },
  zoomSteps: () => [...ZOOM_STEPS],
  farField: () => buildFarField() && { triangles: overview.triangles, vertices: overview.vertices, ms: overview.ms },
  map: () => { if (!mapDrawn) drawMap(); return { ms: +mapMs.toFixed(0), drawn: mapDrawn }; },
  // What window of the region the map is showing, and what its base image was drawn for.
  // The two agreeing is how the tests know a zoom redrew the terrain rather than enlarging
  // the picture of it.
  mapView: () => ({
    x: +mapView.x.toFixed(1), z: +mapView.z.toFixed(1), span: mapView.span, step: mapStep,
    steps: MAP_SPANS.length, spans: [...MAP_SPANS], baseSpan: mapBaseView.span,
    ms: +mapMs.toFixed(0), size: mapCanvas.width, redraws: mapRedraws, settled: mapBaseMatches(),
  }),
  mapZoomTo: step => { setMapZoom(step); refreshMap({ now: true }); return mapView.span; },
  mapPan: (dx, dz) => { mapView.x += dx; mapView.z += dz; clampMapView(); refreshMap(); return { x: mapView.x, z: mapView.z }; },
  touchInput: () => ({ ...touchInput }),
  dismiss: () => { $('intro-go').click(); return true; },
  audio,
  combat, mission: () => mission, profileRef: profile, saveProfile,
  // Runs the real loop synchronously, for inspection without waiting on frames.
  simulate: (seconds, input = {}) => {
    const step = 1 / 60;
    for (let i = 0; i < seconds * 60; i++) {
      for (const key of Object.keys(input)) if (input[key]) keys.add(key); else keys.delete(key);
      flight(step);
      syncHostiles(combat, world, profile, [...streamer.resident.keys()]);
      const evs = stepCombat(combat, world, profile, craft, { fire: keys.has("Space"), flare: keys.has("KeyF") }, step);
      for (const e of evs) { if (e.type === "destroyed") profile.cash += Math.round(e.score / 4); if (e.type === "downed") loseAircraft(); }
      const d = combatStandingDeltas(evs); if (Object.keys(d).length) applyStanding(profile, d);
      updateActive(step);
      // The same per-frame updates the real loop runs, so what the harness exercises is
      // what the game does rather than a subset of it.
      updateRotor(step);
      updateWinch(step);
      updateMarker();
      updateWeather(step);
      updateTone(step);
      updateTeaching(step);
      streamer.update(subject().x, subject().z);
    }
    keys.clear();
    return { armour: Math.round(combat.armour), fuel: Math.round(combat.fuel), kills: combat.kills,
      hostiles: combat.hostiles.length, cash: profile.cash, mission: mission && { kind: mission.kind, stage: mission.stage, progress: +mission.progress.toFixed(2), done: mission.done, failed: mission.failed } };
  },
  yard: () => { toggleYard(); return true; },
  // Puts a named kind of work on the board and takes it, so every one of the twelve can be
  // exercised against the built bundle rather than only against the modules.
  offer: kind => {
    for (let day = profile.day; day < profile.day + 300; day++) {
      const found = generateContracts(world, profile, { day, count: 8 }).find(c => c.kind === kind);
      if (!found) continue;
      board = [found];
      renderBoard();
      takeContract(found);
      return true;
    }
    return false;
  },
  status: () => (mission ? missionStatus(mission, craft) : null),
  winchOut: () => cableOut,
  teleport: (x, z) => {
    craft.x = x; craft.z = z; craft.y = world.groundHeight(x, z) + 16;
    cameraFocus.set(x, craft.y - 16, z);
    streamer.settle(x, z, 300);
    updateCamera(0, true);
    // Refresh the panel immediately: it is otherwise only redrawn on alternate quarter
    // seconds, so a screenshot taken straight after a jump could show the old position.
    updateReadout({ pending: streamer.queue.length });
  },
  render: () => { renderer.info.reset(); stage.render(); },
  desired: () => desiredChunks(craft.x, craft.z).length,
  drawMap,
};
