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
import { createProfile, generateContracts, accept, resolve, endDay, standingBand, situation, contractKind } from './agency.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

const seed = Number(new URLSearchParams(location.search).get('seed') ?? 20492) || 20492;
const world = createWorld(seed);
const home = world.home;

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ canvas: $('scene'), antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.06;
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
const cameraFocus = new THREE.Vector3(home.x, 0, home.z);

scene.add(new THREE.HemisphereLight(0xc7dfd8, 0x54604a, 1.55));
const sun = new THREE.DirectionalLight(0xffe2ae, 3.1);
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
  group.scale.setScalar(0.92);
  return { group, body, rotor, tail };
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

// ---------------------------------------------------------------- the outfit
// The whole loop in miniature: work comes off the board, you fly it, and the region's
// opinion of you moves. Everything here reads from the same generated world.
const profile = createProfile({ seed });
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
      <b>${c.title}</b>
      <small><span style="color:${faction.colour}">${faction.short}</span>
      <span>${c.kindName} · RISK ${c.risk}</span>
      <span>${c.distanceKm} KM · ${c.pay.toLocaleString()}</span></small></li>`;
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
  profile.active.reached = false;
  $('active').hidden = false;
  $('active-title').textContent = contract.title;
  flash(`${contract.kindName} ACCEPTED · ${contract.site.name}`);
  renderBoard();
}

function updateActive() {
  const job = profile.active;
  if (!job) { $('active').hidden = true; return; }
  const toSite = Math.hypot(job.site.x - craft.x, job.site.z - craft.z);
  const toHome = Math.hypot(home.x - craft.x, home.z - craft.z);
  if (!job.reached && toSite < ARRIVE) {
    job.reached = true;
    flash(`ON SITE · ${job.site.name} · BRING IT HOME`);
  }
  if (job.reached && toHome < ARRIVE) {
    const outcome = resolve(profile, { success: true });
    flash(`PAID ${outcome.paid.toLocaleString()} · ${Object.entries(outcome.standing).map(([k, v]) => k.toUpperCase() + (v > 0 ? ' +' : ' ') + v).join('  ')}`);
    endDay(profile);
    refreshBoard();
    renderOutfit();
    $('active').hidden = true;
    return;
  }
  const target = job.reached ? toHome : toSite;
  $('active-range').textContent = `${Math.round(target * WORLD.metresPerUnit)} m`;
  $('active-state').textContent = job.reached ? 'RETURN TO THE YARD' : `INBOUND · ${job.site.kindName}`;
}

let flashUntil = 0;
function flash(text) {
  const node = $('flash');
  node.textContent = text;
  node.hidden = false;
  flashUntil = performance.now() + 4200;
}

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
  keys.add(e.code);
  if (e.code === 'KeyM') toggleMap();
  if (e.code === 'KeyH') teleportHome();
  if (e.code === 'KeyG') $('debug').classList.toggle('hidden');
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

function teleportHome() {
  craft.x = home.x; craft.z = home.z; craft.vx = 0; craft.vz = 0;
  craft.y = world.groundHeight(home.x, home.z) + 16;
  cameraFocus.set(craft.x, 0, craft.z);
  streamer.settle(craft.x, craft.z, 200);
}

function flight(dt) {
  const dx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const dy = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
  let mx = dx * screenRight.x - dy * screenUp.x;
  let mz = dx * screenRight.z - dy * screenUp.z;
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  const boost = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const speed = boost ? 46 : 26;
  const drag = 1 - Math.exp(-3.4 * dt);
  craft.vx += (mx * speed - craft.vx) * drag;
  craft.vz += (mz * speed - craft.vz) * drag;
  craft.x = clamp(craft.x + craft.vx * dt, -WORLD.half, WORLD.half);
  craft.z = clamp(craft.z + craft.vz * dt, -WORLD.half, WORLD.half);
  if (len > 0.08) craft.yaw += Math.atan2(Math.sin(Math.atan2(mx, -mz) - craft.yaw), Math.cos(Math.atan2(mx, -mz) - craft.yaw)) * (1 - Math.exp(-6 * dt));

  // Terrain following: hold a clearance over whatever is below, climb fast, sink slowly.
  const ground = world.groundHeight(craft.x, craft.z);
  const lift = keys.has('Space') ? 26 : keys.has('KeyC') ? -14 : 0;
  const wanted = Math.max(ground + 11, craft.y + lift * dt * 6);
  craft.y += (wanted - craft.y) * (1 - Math.exp(-(wanted > craft.y ? 4.5 : 1.8) * dt));
  craft.y = clamp(craft.y, ground + 4, 260);

  heli.group.position.set(craft.x, craft.y, craft.z);
  heli.group.rotation.y = craft.yaw;
  const forward = craft.vx * Math.sin(craft.yaw) - craft.vz * Math.cos(craft.yaw);
  const side = craft.vx * Math.cos(craft.yaw) + craft.vz * Math.sin(craft.yaw);
  heli.body.rotation.x = THREE.MathUtils.damp(heli.body.rotation.x, -forward * 0.006, 6, dt);
  heli.body.rotation.z = THREE.MathUtils.damp(heli.body.rotation.z, -side * 0.009, 6, dt);
}

function updateCamera(dt, snap = false) {
  const speed = Math.hypot(craft.vx, craft.vz);
  const view = 104 + speed * 0.55;
  const aspect = innerWidth / innerHeight;
  camera.left = -view * aspect / 2; camera.right = view * aspect / 2;
  camera.top = view / 2; camera.bottom = -view / 2;
  camera.updateProjectionMatrix();
  const target = new THREE.Vector3(craft.x + craft.vx * 0.5, 0, craft.z + craft.vz * 0.5);
  if (snap) cameraFocus.copy(target); else cameraFocus.lerp(target, 1 - Math.exp(-4 * dt));
  camera.position.copy(cameraFocus).add(cameraOffset);
  camera.lookAt(cameraFocus);
  camera.updateMatrixWorld();
  // The shadow camera tracks the aircraft in quantised steps to keep shadows from crawling.
  const sx = Math.round(cameraFocus.x / 4) * 4, sz = Math.round(cameraFocus.z / 4) * 4;
  sun.position.set(sx - 90, 150, sz + 80);
  sun.target.position.set(sx, 0, sz);
  sun.target.updateMatrixWorld();
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

// ---------------------------------------------------------------- world map
const mapCanvas = $('map');
let mapDrawn = false;
function drawMap() {
  const ctx = mapCanvas.getContext('2d');
  const size = mapCanvas.width;
  const image = ctx.createImageData(size, size);
  const tmp = new THREE.Color();
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (px / size - 0.5) * WORLD.size, z = (py / size - 0.5) * WORLD.size;
      const b = world.biomeAt(x, z);
      tmp.set(BIOMES[b].colour);
      let r = tmp.r, g = tmp.g, bl = tmp.b;
      if (b !== 0) {
        const f = world.factionAt(x, z);
        if (f >= 0) {
          const ft = new THREE.Color(FACTIONS[f].colour);
          r = r * 0.74 + ft.r * 0.26; g = g * 0.74 + ft.g * 0.26; bl = bl * 0.74 + ft.b * 0.26;
        }
        const shade = clamp(0.72 + world.elevation(x, z) / 150, 0.55, 1.25);
        r *= shade; g *= shade; bl *= shade;
      }
      const i = (py * size + px) * 4;
      image.data[i] = clamp(r, 0, 1) * 255; image.data[i + 1] = clamp(g, 0, 1) * 255;
      image.data[i + 2] = clamp(bl, 0, 1) * 255; image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const toMap = (x, z) => [(x / WORLD.size + 0.5) * size, (z / WORLD.size + 0.5) * size];
  for (const site of world.allSettlements()) {
    const [mx, my] = toMap(site.x, site.z);
    ctx.fillStyle = FACTIONS[site.faction].colour;
    const r = site.kind === 'town' ? 4 : site.kind === 'village' ? 3 : 2.4;
    ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.fill();
    if (site.kind === 'town' || site.kind === 'airfield') {
      ctx.fillStyle = '#edeedf'; ctx.font = '600 9px Barlow, sans-serif';
      ctx.fillText(site.name, mx + 6, my + 3);
    }
  }
  const [hx, hy] = toMap(home.x, home.z);
  ctx.strokeStyle = '#f3b25e'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(hx, hy, 7, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(hx - 11, hy); ctx.lineTo(hx + 11, hy); ctx.moveTo(hx, hy - 11); ctx.lineTo(hx, hy + 11); ctx.stroke();
  mapDrawn = true;
}
function toggleMap() {
  const panel = $('map-panel');
  panel.hidden = !panel.hidden;
  if (!panel.hidden && !mapDrawn) drawMap();
}
$('map-close').addEventListener('click', toggleMap);

// marks the aircraft on the map each time it is opened
function markCraft() {
  if ($('map-panel').hidden || !mapDrawn) return;
  const size = mapCanvas.width;
  const ctx = mapCanvas.getContext('2d');
  const mx = (craft.x / WORLD.size + 0.5) * size, my = (craft.z / WORLD.size + 0.5) * size;
  ctx.save(); ctx.translate(mx, my); ctx.rotate(craft.yaw);
  ctx.fillStyle = '#f4edc9'; ctx.beginPath();
  ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(0, 2); ctx.lineTo(-4, 5); ctx.closePath(); ctx.fill();
  ctx.restore();
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
  const t0 = performance.now();
  const streamed = streamer.update(craft.x, craft.z);
  buildHitch = buildHitch * 0.8 + (performance.now() - t0) * 0.2;
  updateCamera(dt);
  heli.rotor.rotation.y = clock * 34;
  heli.tail.rotation.x = clock * 44;
  seaTime.value = clock;

  renderer.shadowMap.needsUpdate = true;
  renderer.info.reset();
  composer.render();

  updateActive();
  if ($('flash') && !$('flash').hidden && performance.now() > flashUntil) $('flash').hidden = true;
  if (Math.floor(clock * 4) % 2 === 0) updateReadout(streamed);
  markCraft();
}

function updateReadout(streamed) {
  const s = world.sample(craft.x, craft.z);
  const km = v => (v * WORLD.metresPerUnit / 1000).toFixed(2);
  $('pos').textContent = `${km(craft.x)} , ${km(craft.z)} km`;
  $('alt').textContent = `${Math.round((craft.y - s.height) * WORLD.metresPerUnit)} m AGL`;
  $('speed').textContent = `${Math.round(Math.hypot(craft.vx, craft.vz) * WORLD.metresPerUnit * 3.6)} km/h`;
  $('biome').textContent = BIOMES[s.biome].name;
  $('territory').textContent = s.faction < 0 ? 'UNCLAIMED WATER' : FACTIONS[s.faction].name;
  $('territory').style.color = s.faction < 0 ? '#9fb49d' : FACTIONS[s.faction].colour;
  const near = world.settlementsNear(craft.x, craft.z, 320)
    .sort((a, b) => Math.hypot(a.x - craft.x, a.z - craft.z) - Math.hypot(b.x - craft.x, b.z - craft.z))[0];
  $('nearest').textContent = near
    ? `${near.name} · ${near.kindName} · ${FACTIONS[near.faction].short} · ${Math.round(Math.hypot(near.x - craft.x, near.z - craft.z) * WORLD.metresPerUnit)} m`
    : 'NOTHING WITHIN 1.6 KM';
  $('chunks').textContent = `${streamer.resident.size} resident · ${streamed.pending} queued · ${streamer.stats.built} built · ${streamer.stats.disposed} released`;
  $('geometry').textContent = `${residentMeshes} meshes · ${Math.round(residentTriangles / 1000)}k triangles held`;
  $('draw').textContent = `${renderer.info.render.calls} calls · ${Math.round(renderer.info.render.triangles / 1000)}k drawn`;
  $('fps').textContent = `${Math.round(fps)} fps · stream ${buildHitch.toFixed(1)} ms/frame`;
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
  $('loading').hidden = true;
  requestAnimationFrame(frame);
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
  }),
  teleport: (x, z) => { craft.x = x; craft.z = z; craft.y = world.groundHeight(x, z) + 16; cameraFocus.set(x, 0, z); streamer.settle(x, z, 300); updateCamera(0, true); },
  render: () => { renderer.info.reset(); renderer.shadowMap.needsUpdate = true; composer.render(); },
  desired: () => desiredChunks(craft.x, craft.z).length,
  drawMap,
};
