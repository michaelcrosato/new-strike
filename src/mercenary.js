// MERCENARY STRIKE — open world prototype.
//
// This is the shell that proves the backend: it boots the generated region, streams it
// around the aircraft, and puts the numbers that matter on screen. Flight, contracts and
// progression hang off this loop; the point of this file is that the world underneath it
// holds up while you fly across ten kilometres of it.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { createWorld, WORLD, BIOMES, FACTIONS } from './worldgen.js';
import { ChunkStreamer, desiredChunks } from './streaming.js';
import { buildChunk, createMaterials } from './terrain.js';
import { buildOverview, OVERVIEW_RESOLUTION } from './overview.js';
import { createProfile, generateContracts, accept, resolve, endDay, standingBand, situation,
  purchase, hire, UPGRADES, HIREABLE, applyStanding } from './agency.js';
import { createCombat, rearm, syncHostiles, stepCombat, availableWeapons, combatStandingDeltas,
  WEAPONS, hitCraft } from './combat.js';
import { startMission, stepMission, missionStatus, clearMission } from './missions.js';
import { EntityView, TracerView } from './entities.js';
import { AudioEngine } from './audio.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

const seed = Number(new URLSearchParams(location.search).get('seed') ?? 20492) || 20492;
const world = createWorld(seed);
const home = world.home;

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ canvas: $('scene'), antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
// Measured, not chosen by eye. Over four places in the region — the yard, the alpine
// ridge, the delta and the salt pans — AgX put 94% of the frame into two brightness
// buckets and averaged 0.41 saturation, which is why every area looked like the same pale
// wash. Neutral at this exposure holds the same mean brightness and peak, spreads the
// frame over four buckets, and carries 0.61 saturation: half again as much colour, which
// is what lets nine regions read as nine places.
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.6;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;   // PCFSoft was removed in three r186
renderer.shadowMap.autoUpdate = false;          // driven once per frame, not once per pass
renderer.info.autoReset = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8aa6a0);
// Tuned for this camera distance: crisp underneath, fading only as chunks approach the
// edge of the streamed set, which doubles as the horizon.
scene.fog = new THREE.FogExp2(0x9fb3ad, 0.00085);

const camera = new THREE.OrthographicCamera(-75, 75, 45, -45, 0.5, 900);
const cameraOffset = new THREE.Vector3(112, 142, 138);
const cameraFocus = new THREE.Vector3(home.x, home.height, home.z);

scene.add(new THREE.HemisphereLight(0xb9d2cc, 0x54604a, 1.25));
const sun = new THREE.DirectionalLight(0xffe2ae, 2.6);
sun.position.set(-90, 150, 80);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -110, right: 110, top: 110, bottom: -110, near: 5, far: 420 });
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.5;
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight(0x9fc9cf, 0.5);
fill.position.set(80, 60, -70);
scene.add(fill);

// ---------------------------------------------------------------- sea
const seaMaterial = new THREE.MeshStandardMaterial({ color: 0x11585f, roughness: 0.26, metalness: 0.34 });
const seaTime = { value: 0 };
seaMaterial.onBeforeCompile = shader => {
  shader.uniforms.uTime = seaTime;
  shader.vertexShader = 'varying vec3 vSea;\n' + shader.vertexShader.replace('#include <worldpos_vertex>',
    '#include <worldpos_vertex>\nvSea = (modelMatrix * vec4(transformed,1.)).xyz;');
  shader.fragmentShader = 'uniform float uTime; varying vec3 vSea;\n' + shader.fragmentShader
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      vec2 q = vSea.xz;
      float ripple = sin(q.x * .7 + q.y * .35 + uTime * 1.2) * .03 + sin(q.y * 1.7 - q.x * .2 + uTime * 1.5) * .014;
      normal = normalize(normal + vec3(ripple, ripple * .3, ripple * .8));`)
    .replace('#include <color_fragment>', `#include <color_fragment>
      float swell = sin(vSea.x * .02 + vSea.z * .03 + uTime * .2) * .07;
      diffuseColor.rgb *= 1.0 + swell;`);
};
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
      item.addEventListener('click', () => {
        const result = purchase(profile, item.dataset.upgrade);
        flash(result.ok ? 'FITTED' : result.reason);
        if (result.ok) { rearm(combat, profile); renderWeapons(); saveProfile(); }
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
    item.addEventListener('click', () => {
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
  if (!panel.hidden) renderYard();
}
$('yard-close').addEventListener('click', toggleYard);

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
$('intro-go').addEventListener('click', () => {
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
    item.addEventListener('click', () => takeContract(board[Number(item.dataset.index)]));
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
  stepMission(mission, { world, craft, combat, input: { interact: keys.has('KeyE') } }, dt);
  for (const event of mission.events) {
    if (event.type === 'aboard') flash(event.remaining ? `ABOARD · ${event.remaining} TO GO` : 'ALL ABOARD');
    if (event.type === 'scanned') flash('SCAN COMPLETE');
    if (event.type === 'dropped') flash('CARGO DOWN');
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

let mouseFire = false;
addEventListener('pointerdown', e => { if (e.button === 0 && $('yard').hidden && $('map-panel').hidden) mouseFire = true; });
addEventListener('pointerup', () => { mouseFire = false; });

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
  x: home.x, z: home.z, y: home.height + 14, vx: 0, vz: 0, yaw: 0,
  fuel: 100, throttle: 0,
};
const keys = new Set();
const screenRight = new THREE.Vector3(0.63, 0, -0.78).normalize();
const screenUp = new THREE.Vector3(-0.78, 0, -0.63).normalize();

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
  if (e.code === 'Escape') { for (const id of ['yard', 'map-panel']) if (!$(id).hidden) $(id).hidden = true; }
  if (e.code === 'Minus' || e.code === 'NumpadSubtract' || e.code === 'BracketLeft') zoomBy(1);
  if (e.code === 'Equal' || e.code === 'NumpadAdd' || e.code === 'BracketRight') zoomBy(-1);
  if (e.code === 'Digit0' || e.code === 'Numpad0') setZoom(ZOOM_DEFAULT);
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
addEventListener('blur', () => keys.clear());

function teleportHome() {
  craft.x = home.x; craft.z = home.z; craft.vx = 0; craft.vz = 0;
  craft.y = world.groundHeight(home.x, home.z) + 16;
  cameraFocus.set(craft.x, craft.y - 16, craft.z);
  streamer.settle(craft.x, craft.z, 200);
}

// With a panel open the aircraft holds station instead of drifting off across the region
// while you read. Fuel, repair and the rest of the loop keep running.
const overlayOpen = () => !$('intro').hidden || !$('yard').hidden || !$('map-panel').hidden;

function flight(dt) {
  const held = overlayOpen() ? new Set() : keys;
  const dx = (held.has('KeyD') || held.has('ArrowRight') ? 1 : 0) - (held.has('KeyA') || held.has('ArrowLeft') ? 1 : 0);
  const dy = (held.has('KeyS') || held.has('ArrowDown') ? 1 : 0) - (held.has('KeyW') || held.has('ArrowUp') ? 1 : 0);
  let mx = dx * screenRight.x - dy * screenUp.x;
  let mz = dx * screenRight.z - dy * screenUp.z;
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  const boost = held.has('ShiftLeft') || held.has('ShiftRight');
  const speed = boost ? 46 : 26;
  const drag = 1 - Math.exp(-3.4 * dt);
  craft.vx += (mx * speed - craft.vx) * drag;
  craft.vz += (mz * speed - craft.vz) * drag;
  craft.x = clamp(craft.x + craft.vx * dt, -WORLD.half, WORLD.half);
  craft.z = clamp(craft.z + craft.vz * dt, -WORLD.half, WORLD.half);
  if (len > 0.08) craft.yaw += Math.atan2(Math.sin(Math.atan2(mx, -mz) - craft.yaw), Math.cos(Math.atan2(mx, -mz) - craft.yaw)) * (1 - Math.exp(-6 * dt));

  // Terrain following: hold a clearance over whatever is below, climb fast, sink slowly.
  const ground = world.groundHeight(craft.x, craft.z);
  const lift = held.has('Space') ? 26 : held.has('KeyC') ? -14 : 0;
  const wanted = Math.max(ground + 11, craft.y + lift * dt * 6);
  craft.y += (wanted - craft.y) * (1 - Math.exp(-(wanted > craft.y ? 4.5 : 1.8) * dt));
  craft.y = clamp(craft.y, ground + 4, 260);

  heli.group.position.set(craft.x, craft.y, craft.z);
  heli.group.rotation.y = craft.yaw;
  const forward = craft.vx * Math.sin(craft.yaw) - craft.vz * Math.cos(craft.yaw);
  const side = craft.vx * Math.cos(craft.yaw) + craft.vz * Math.sin(craft.yaw);
  heli.body.rotation.x = THREE.MathUtils.damp(heli.body.rotation.x, -forward * 0.006, 6, dt);
  heli.body.rotation.z = THREE.MathUtils.damp(heli.body.rotation.z, -side * 0.009, 6, dt);

  // Fuel burns while flying and tops up over your own pad.
  const home = world.home;
  const overYard = Math.hypot(craft.x - home.x, craft.z - home.z) < 40;
  if (overYard && Math.hypot(craft.vx, craft.vz) < 10) {
    combat.fuel = Math.min(combat.maxFuel, combat.fuel + 26 * dt * (1 + profile.base.fuel));
    combat.armour = Math.min(combat.maxArmour, combat.armour + 14 * dt * (1 + profile.base.workshop));
    for (const w of availableWeapons(profile.heli)) combat.ammo[w.id] = Math.min(w.max, (combat.ammo[w.id] ?? 0) + w.max / 6 * dt);
  } else {
    combat.fuel = Math.max(0, combat.fuel - dt * (boost ? 0.55 : 0.34));
    if (combat.fuel <= 0) loseAircraft();
  }
  combat.invulnerable = Math.max(0, (combat.invulnerable ?? 0) - dt);
}

// ---------------------------------------------------------------- winch and weather
// The kinds that are a hook on a cable rather than a trigger.
const WINCH_KINDS = new Set(['extraction', 'salvage', 'search', 'delivery', 'sabotage']);
let cableOut = 0;
// The ground ring under the aircraft, sized so it stays the same size on screen however
// far out the view is pulled.
function updateMarker() {
  const showing = zoom > 1.35;
  heli.marker.visible = showing;
  if (!showing) return;
  const radius = viewHeight() / 26;
  heli.marker.scale.setScalar(radius);
  heli.marker.position.y = world.groundHeight(craft.x, craft.z) - craft.y + 0.6;
}

function updateWinch(dt) {
  const usable = profile.heli.winch > 0 && mission && WINCH_KINDS.has(mission.kind);
  const running = usable && keys.has('KeyE');
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
const CLEAR = { fog: 0.00085, sun: 2.6, sky: 0x8aa6a0, tint: 0x9fb3ad };
const CLOSED = { fog: 0.0027, sun: 1.55, sky: 0x74837f, tint: 0x8b9a96 };
const skyColour = new THREE.Color(), fogColour = new THREE.Color();
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
  skyColour.setHex(want.sky); fogColour.setHex(want.tint);
  scene.background.lerp(skyColour, rate);
  scene.fog.color.lerp(fogColour, rate);
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

const baseView = () => 104 + Math.hypot(craft.vx, craft.vz) * 0.55;
// How much ground the frame covers vertically, in world units. The map reads this to draw
// the view rectangle, so the two can never disagree about what you can see.
function viewHeight() { return baseView() * zoom; }

function setZoom(step, snap = false) {
  zoomStep = clamp(step, 0, ZOOM_STEPS.length - 1);
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
  const floor = world.groundHeight(craft.x, craft.z);
  const target = new THREE.Vector3(craft.x + craft.vx * 0.5, floor, craft.z + craft.vz * 0.5);
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
// Let the composer allocate its own buffers. A hand-made WebGLRenderTarget here had a
// depth attachment the scene render could not pass, so every frame came out as bare
// background with the geometry silently depth-rejected.
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.18, 0.6, 1.1);
composer.addPass(bloom);
composer.addPass(new OutputPass());
composer.addPass(new ShaderPass({
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader: `uniform sampler2D tDiffuse;varying vec2 vUv;
    void main(){vec3 c=texture2D(tDiffuse,vUv).rgb;vec2 p=vUv*2.-1.;
    c*=1.-dot(p,p)*.10;c=mix(vec3(dot(c,vec3(.2126,.7152,.0722))),c,1.12);
    gl_FragColor=vec4((c-.5)*1.04+.5,1.);}`,
}));

function resize() {
  const ratio = Math.min(devicePixelRatio || 1, 1.6);
  renderer.setPixelRatio(ratio);
  composer.setPixelRatio(ratio);
  renderer.setSize(innerWidth, innerHeight, false);
  composer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);

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
let mapDrawn = false, mapMs = 0;

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
  mapBase.width = size; mapBase.height = size;
  const ctx = mapBase.getContext('2d');
  const lattice = Math.ceil(size / MAP_STEP) + 1;
  const unitsPerNode = WORLD.size / size * MAP_STEP;
  const height = new Float32Array(lattice * lattice);
  const biome = new Uint8Array(lattice * lattice);
  const owner = new Int8Array(lattice * lattice);

  // One pass of the fields. Height is computed once and handed to the derived fields rather
  // than being recomputed inside each of them.
  for (let j = 0; j < lattice; j++) {
    for (let i = 0; i < lattice; i++) {
      const x = (i * MAP_STEP / size - 0.5) * WORLD.size;
      const z = (j * MAP_STEP / size - 0.5) * WORLD.size;
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

  const toMap = (x, z) => [(x / WORLD.size + 0.5) * size, (z / WORLD.size + 0.5) * size];

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

  // A kilometre grid and a scale bar, because ten by ten kilometres should be something you
  // can measure off the map rather than something you are told in the header.
  ctx.strokeStyle = 'rgba(232,240,214,.10)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let km = 1; km < 10; km++) {
    const at = km / 10 * size;
    ctx.moveTo(at, 0); ctx.lineTo(at, size);
    ctx.moveTo(0, at); ctx.lineTo(size, at);
  }
  ctx.stroke();
  const barKm = 2, barPx = barKm / 10 * size;
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
  ctx.fillText(barKm + ' KM', 26, size - 22);

  const place = labeller(ctx);

  // Regions first: they are the biggest thing on the map and the labels that matter most.
  for (const region of world.regions.regions) {
    const [rx, ry] = toMap(region.x, region.z);
    place(region.name, rx, ry, {
      font: '700 11px "Barlow Condensed", Barlow, sans-serif', colour: region.colour, centre: true, halo: 3.2,
    });
  }

  // Landmarks: a diamond and a name, and they never lose their label to a village.
  for (const mark of world.landmarks()) {
    const [mx, my] = toMap(mark.x, mark.z);
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
    ctx.fillStyle = FACTIONS[site.faction].colour;
    ctx.strokeStyle = 'rgba(9,20,18,.7)'; ctx.lineWidth = 1;
    const r = site.kind === 'town' ? 3.6 : site.kind === 'village' ? 2.8 : 2.2;
    ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  for (const site of sites) {
    if (!['town', 'airfield', 'port', 'refinery'].includes(site.kind)) continue;
    const [mx, my] = toMap(site.x, site.z);
    place(site.name, mx, my, { font: '600 8px Barlow, sans-serif', colour: '#dfe6d2' });
  }

  mapDrawn = true;
  mapMs = performance.now() - started;
}

// The static map plus everything that moves: your yard, the aircraft, what the camera can
// see, and the job in hand.
function paintMap() {
  if ($('map-panel').hidden || !mapDrawn) return;
  const size = mapCanvas.width;
  const ctx = mapCanvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(mapBase, 0, 0);
  const toMap = (x, z) => [(x / WORLD.size + 0.5) * size, (z / WORLD.size + 0.5) * size];
  const [px, py] = toMap(craft.x, craft.z);

  // The job in hand, so the map answers where am I going as well as where am I.
  if (profile.active) {
    const [cx, cy] = toMap(profile.active.site.x, profile.active.site.z);
    ctx.strokeStyle = 'rgba(243,178,94,.45)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(cx, cy); ctx.stroke();
    ctx.strokeStyle = '#f3b25e'; ctx.lineWidth = 1.6;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.arc(cx, cy, 11, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }

  const [hx, hy] = toMap(home.x, home.z);
  ctx.strokeStyle = '#f3b25e'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(hx, hy, 7, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(hx - 11, hy); ctx.lineTo(hx + 11, hy);
  ctx.moveTo(hx, hy - 11); ctx.lineTo(hx, hy + 11);
  ctx.stroke();

  // What the camera can actually see right now, which is how the zoom reads on the map.
  const halfZ = viewHeight() / 2 / WORLD.size * size;
  const halfX = halfZ * (innerWidth / innerHeight);
  ctx.strokeStyle = 'rgba(244,237,201,.34)'; ctx.lineWidth = 1;
  ctx.strokeRect(px - halfX, py - halfZ, halfX * 2, halfZ * 2);

  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(craft.yaw);
  ctx.fillStyle = '#f4edc9';
  ctx.strokeStyle = '#1c2a26'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -7); ctx.lineTo(4.5, 5.5); ctx.lineTo(0, 2.5); ctx.lineTo(-4.5, 5.5);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}

function toggleMap() {
  const panel = $('map-panel');
  panel.hidden = !panel.hidden;
  if (panel.hidden) return;
  if (!mapDrawn) drawMap();
  paintMap();
}
$('map-close').addEventListener('click', toggleMap);

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
    { fire: keys.has('Space') || mouseFire, flare: keys.has('KeyF') }, dt);
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
  const streamed = streamer.update(craft.x, craft.z);
  buildHitch = buildHitch * 0.8 + (performance.now() - t0) * 0.2;
  updateCamera(dt);
  heli.rotor.rotation.y = clock * 34;
  heli.tail.rotation.x = clock * 44;
  seaTime.value = clock;
  updateWinch(dt);
  updateMarker();
  updateWeather(dt);
  audio.update(Math.hypot(craft.vx, craft.vz), 'playing');

  renderer.shadowMap.needsUpdate = true;
  renderer.info.reset();
  composer.render();

  updateActive(dt);
  if ($('flash') && !$('flash').hidden && performance.now() > flashUntil) $('flash').hidden = true;
  if (Math.floor(clock * 4) % 2 === 0) updateReadout(streamed);
  paintMap();
}

function updateReadout(streamed) {
  const s = world.sample(craft.x, craft.z);
  const km = v => (v * WORLD.metresPerUnit / 1000).toFixed(2);
  $('pos').textContent = `${km(craft.x)} , ${km(craft.z)} km`;
  $('alt').textContent = `${Math.round((craft.y - s.height) * WORLD.metresPerUnit)} m AGL`;
  $('speed').textContent = `${Math.round(Math.hypot(craft.vx, craft.vz) * WORLD.metresPerUnit * 3.6)} km/h`;
  $('biome').textContent = BIOMES[s.biome].name;
  const region = world.regionAt(craft.x, craft.z);
  $('region').textContent = region.name;
  $('region').style.color = region.colour;
  $('territory').textContent = s.faction < 0 ? 'UNCLAIMED WATER' : FACTIONS[s.faction].name;
  $('territory').style.color = s.faction < 0 ? '#9fb49d' : FACTIONS[s.faction].colour;
  // Landmarks count as places, and outrank a village at the same distance — they are what
  // you actually navigate by.
  const near = [...world.settlementsNear(craft.x, craft.z, 320), ...world.landmarksNear(craft.x, craft.z, 460)]
    .sort((a, b) => (Math.hypot(a.x - craft.x, a.z - craft.z) - (a.landmark ? 140 : 0))
      - (Math.hypot(b.x - craft.x, b.z - craft.z) - (b.landmark ? 140 : 0)))[0];
  $('nearest').textContent = near
    ? `${near.name} · ${near.kindName} · ${FACTIONS[near.faction].short} · ${Math.round(Math.hypot(near.x - craft.x, near.z - craft.z) * WORLD.metresPerUnit)} m`
    : 'NOTHING WITHIN 1.6 KM';
  $('chunks').textContent = `${streamer.resident.size} resident · ${streamed.pending} queued · ${streamer.stats.built} built · ${streamer.stats.disposed} released`;
  $('geometry').textContent = `${residentMeshes} meshes · ${Math.round(residentTriangles / 1000)}k triangles held`;
  $('draw').textContent = `${renderer.info.render.calls} calls · ${Math.round(renderer.info.render.triangles / 1000)}k drawn`;
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
  composer.render();
  refreshBoard();
  renderOutfit();
  renderWeapons();
  $('loading').hidden = true;
  if (!returning) showIntro();
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
  renderer, scene, camera, composer, sun, materials, heli, sea,
  raw: () => { renderer.setRenderTarget(null); renderer.clear(); renderer.render(scene, camera); },
  state: () => ({
    seed, position: { x: craft.x, z: craft.z, y: craft.y },
    sample: world.sample(craft.x, craft.z),
    resident: streamer.resident.size, pending: streamer.queue.length,
    meshes: residentMeshes, triangles: Math.round(residentTriangles),
    draw: renderer.info.render.calls, drawn: renderer.info.render.triangles,
    fps: Math.round(fps), streamMs: +buildHitch.toFixed(2),
    stats: { ...streamer.stats },
    region: world.regionAt(craft.x, craft.z).key,
    regionNodes: world.regions.stats().nodes,
    fog: +scene.fog.density.toFixed(5),
    cable: +cableOut.toFixed(2),
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
  zoomTo: step => { setZoom(step, true); updateCamera(0, true); return ZOOM_STEPS[zoomStep]; },
  zoomSteps: () => [...ZOOM_STEPS],
  farField: () => buildFarField() && { triangles: overview.triangles, vertices: overview.vertices, ms: overview.ms },
  map: () => { if (!mapDrawn) drawMap(); return { ms: +mapMs.toFixed(0), drawn: mapDrawn }; },
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
      updateWinch(step);
      updateMarker();
      updateWeather(step);
      streamer.update(craft.x, craft.z);
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
  render: () => { renderer.info.reset(); renderer.shadowMap.needsUpdate = true; composer.render(); },
  desired: () => desiredChunks(craft.x, craft.z).length,
  drawMap,
};
