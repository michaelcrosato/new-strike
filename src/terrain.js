// Turns a chunk of the generated region into geometry, and gives it all back on request.
//
// One chunk produces at most four meshes: ground, scatter, settlement and water trim. Colour
// travels in the vertices so the whole chunk shares one material per class, which keeps a
// streamed world at a few hundred draw calls instead of a few thousand.

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { WORLD, BIOMES, FACTIONS } from './worldgen.js';

export const CHUNK_RESOLUTION = [32, 16, 8];   // quads per side, by detail level
export const PROP_BUDGET = [26, 9, 0];
const SKIRT = 10;                               // hides the seam between detail levels

const tmpA = new THREE.Color(), tmpB = new THREE.Color();

// Every biome's three ground colours, converted to linear once at load. Blending happens
// per vertex and a THREE.Color conversion is three pow() calls, so doing it here instead
// of in the loop is what makes a real blend cheaper than the single hard lookup it
// replaces. Layout per biome: ground, groundAlt, cliff.
const PALETTE = new Float32Array(BIOMES.length * 9);
BIOMES.forEach(info => {
  [info.ground, info.groundAlt, info.cliff].forEach((hex, slot) => {
    tmpA.setHex(hex);
    const at = info.id * 9 + slot * 3;
    PALETTE[at] = tmpA.r; PALETTE[at + 1] = tmpA.g; PALETTE[at + 2] = tmpA.b;
  });
});

// How far to look either side of a vertex's own classification, in the classifier's own
// units. Inside a biome all five probes agree and the colour is exact; within this much of
// a threshold they disagree and the colour is the mixture, which is what turns the hard
// bands into a gradient over roughly fifteen metres of ground.
const BLEND_H = 2.8, BLEND_M = 0.055, BLEND_T = 0.045;
const PROBES = [
  [0, 0, 0, 2],                                 // the vertex itself, weighted double
  [BLEND_H, 0, BLEND_T, 1],
  [-BLEND_H, 0, -BLEND_T, 1],
  [0, BLEND_M, -BLEND_T, 1],
  [0, -BLEND_M, BLEND_T, 1],
];
const PROBE_WEIGHT = PROBES.reduce((total, p) => total + p[3], 0);

/**
 * The colour of one patch of ground, written into `out` at `at`.
 *
 * Blends the palettes of every biome the classifier can reach from this point, then mixes
 * towards rock by how steep the surface is. Exported because both the streamed chunks and
 * the coarse region overview colour their ground with it: sharing the code is what stops
 * the two surfaces drifting apart into visibly different palettes at the seam between them.
 */
export function groundColour(world, h, m, t, steep, alt, out, at = 0) {
  const slot = alt > 0.15 ? 1 : 0;
  let br = 0, bg = 0, bb = 0, cr = 0, cg = 0, cb = 0;
  for (let p = 0; p < PROBES.length; p++) {
    const probe = PROBES[p];
    const id = world.classify(h + probe[0], m + probe[1], t + probe[2]);
    const w = probe[3], base = id * 9, tint = base + slot * 3;
    br += PALETTE[tint] * w; bg += PALETTE[tint + 1] * w; bb += PALETTE[tint + 2] * w;
    cr += PALETTE[base + 6] * w; cg += PALETTE[base + 7] * w; cb += PALETTE[base + 8] * w;
  }
  br /= PROBE_WEIGHT; bg /= PROBE_WEIGHT; bb /= PROBE_WEIGHT;
  cr /= PROBE_WEIGHT; cg /= PROBE_WEIGHT; cb /= PROBE_WEIGHT;
  out[at] = br + (cr - br) * steep;
  out[at + 1] = bg + (cg - bg) * steep;
  out[at + 2] = bb + (cb - bb) * steep;
}

// A little large-scale variation, so a plain does not read as one flat sheet. Shared for
// the same reason as the colour itself.
export const groundAlt = (x, z) => (Math.sin(x * 0.031) + Math.cos(z * 0.027)) * 0.5;

// Primitives disagree about indexing (octahedra come out non-indexed, boxes indexed) and
// mergeGeometries refuses a mixture, so every piece is flattened before merging.
const flatten = geo => { if (!geo.index) return geo; const out = geo.toNonIndexed(); geo.dispose(); return out; };
const mergeAll = list => { const parts = list.filter(Boolean).map(flatten); return parts.length ? mergeGeometries(parts) : null; };
// Two scratch colours: callers routinely need a base and a blend target at once, and a
// single shared instance silently aliased them together.
const linear = hex => { tmpA.setHex(hex); return tmpA; };
const linearB = hex => { tmpB.setHex(hex); return tmpB; };

export function createMaterials() {
  const ground = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .92, metalness: .02, flatShading: true });
  // The far field gets smooth shading. Its quads are forty metres across, and faceting that
  // reads as construction-toy charm at four metres reads as a fault at forty.
  const distant = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .94, metalness: .02, flatShading: false });
  const foliage = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .86, metalness: .02, flatShading: true });
  const built = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .78, metalness: .06, flatShading: true });
  const glass = new THREE.MeshStandardMaterial({ color: 0x173b4a, roughness: .2, metalness: .55, flatShading: true });
  return { ground, distant, foliage, built, glass,
    dispose() { for (const m of [ground, distant, foliage, built, glass]) m.dispose(); } };
}

// ---------------------------------------------------------------- ground
function groundGeometry(world, cx, cz, lod, sites) {
  const res = CHUNK_RESOLUTION[Math.min(lod, CHUNK_RESOLUTION.length - 1)];
  const step = WORLD.chunk / res;
  const originX = cx * WORLD.chunk, originZ = cz * WORLD.chunk;
  const side = res + 1;
  const positions = new Float32Array(side * side * 3);
  const colours = new Float32Array(side * side * 3);
  const heights = new Float32Array(side * side);
  const raws = new Float32Array(side * side);
  const wet = new Float32Array(side * side);
  const warm = new Float32Array(side * side);

  // First pass: the surface. One elevation sample per vertex, and the two derived fields
  // are handed the height they would otherwise recompute for themselves.
  for (let iz = 0; iz < side; iz++) {
    for (let ix = 0; ix < side; ix++) {
      const x = originX + ix * step, z = originZ + iz * step;
      const raw = world.elevation(x, z);
      const h = world.groundHeight(x, z, sites, raw);
      const i = iz * side + ix;
      raws[i] = raw;
      heights[i] = h;
      wet[i] = world.moisture(x, z, raw);
      warm[i] = world.temperature(x, z, raw);
      positions[i * 3] = x;
      positions[i * 3 + 1] = Math.max(h, -9);
      positions[i * 3 + 2] = z;
    }
  }

  // Second pass: colour. Slope comes from the surface just built rather than from four
  // more field samples, which is both four sevenths cheaper and more truthful — the
  // shading now follows the mesh, so the rim of a flattened settlement platform reads as
  // the cliff it actually is.
  for (let iz = 0; iz < side; iz++) {
    for (let ix = 0; ix < side; ix++) {
      const i = iz * side + ix;
      const x = positions[i * 3], z = positions[i * 3 + 2];
      const east = heights[iz * side + Math.min(ix + 1, side - 1)];
      const west = heights[iz * side + Math.max(ix - 1, 0)];
      const south = heights[Math.min(iz + 1, side - 1) * side + ix];
      const north = heights[Math.max(iz - 1, 0) * side + ix];
      const spanX = (Math.min(ix + 1, side - 1) - Math.max(ix - 1, 0)) * step;
      const spanZ = (Math.min(iz + 1, side - 1) - Math.max(iz - 1, 0)) * step;
      const steep = Math.min(1, Math.hypot((east - west) / spanX, (south - north) / spanZ) * 2.1);
      groundColour(world, heights[i], wet[i], warm[i], steep, groundAlt(x, z), colours, i * 3);
    }
  }

  const quads = res * res;
  const skirtQuads = res * 4;
  const index = new Uint32Array((quads + skirtQuads) * 6);
  let o = 0;
  for (let iz = 0; iz < res; iz++) {
    for (let ix = 0; ix < res; ix++) {
      const a = iz * side + ix, b = a + 1, c = a + side, d = c + 1;
      index[o++] = a; index[o++] = c; index[o++] = b;
      index[o++] = b; index[o++] = c; index[o++] = d;
    }
  }

  // Skirt: a rim hanging below the edge so a coarser neighbour cannot show daylight.
  const rimStart = side * side;
  const rimPositions = [], rimColours = [];
  const addRim = (i) => {
    const px = positions[i * 3], py = positions[i * 3 + 1], pz = positions[i * 3 + 2];
    rimPositions.push(px, py - SKIRT, pz);
    rimColours.push(colours[i * 3], colours[i * 3 + 1], colours[i * 3 + 2]);
    return rimStart + rimPositions.length / 3 - 1;
  };
  const edges = [
    Array.from({ length: side }, (_, ix) => ix),                       // north
    Array.from({ length: side }, (_, ix) => (side - 1) * side + ix),   // south
    Array.from({ length: side }, (_, iz) => iz * side),                // west
    Array.from({ length: side }, (_, iz) => iz * side + side - 1),     // east
  ];
  edges.forEach((edge, side4) => {
    const flip = side4 === 0 || side4 === 3;
    for (let k = 0; k < edge.length - 1; k++) {
      const a = edge[k], b = edge[k + 1];
      const a2 = addRim(a), b2 = addRim(b);
      if (flip) { index[o++] = a; index[o++] = a2; index[o++] = b; index[o++] = b; index[o++] = a2; index[o++] = b2; }
      else { index[o++] = a; index[o++] = b; index[o++] = a2; index[o++] = b; index[o++] = b2; index[o++] = a2; }
    }
  });

  const allPositions = new Float32Array(positions.length + rimPositions.length);
  allPositions.set(positions); allPositions.set(rimPositions, positions.length);
  const allColours = new Float32Array(colours.length + rimColours.length);
  allColours.set(colours); allColours.set(rimColours, colours.length);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(allPositions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(allColours, 3));
  geometry.setIndex(new THREE.BufferAttribute(index.subarray(0, o), 1));
  geometry.computeVertexNormals();
  return { geometry, heights, side, step, originX, originZ };
}

// ---------------------------------------------------------------- props
// Templates are built once and cloned per instance, so scatter costs a matrix multiply
// rather than a mesh construction.
let templates = null;
function propTemplates() {
  if (templates) return templates;
  const t = {};
  const paint = (geo, hex) => {
    const c = linear(hex), n = geo.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return geo;
  };
  const at = (geo, x, y, z, sx = 1, sy = 1, sz = 1) => {
    const g = geo.clone();
    g.scale(sx, sy, sz); g.translate(x, y, z);
    return g;
  };
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 5);
  const cone = new THREE.ConeGeometry(1, 1, 5);
  const octa = new THREE.OctahedronGeometry(1, 0);

  t.palm = mergeAll([
    paint(at(cyl, 0, 3, 0, .22, 6, .22), 0x655b3a),
    paint(at(cone, 0, 6.4, 0, 3.1, 1.5, 3.1), 0x3c694b),
    paint(at(cone, 0, 7.2, 0, 2.1, 1.2, 2.1), 0x598257),
  ]);
  t.pine = mergeAll([
    paint(at(cyl, 0, 2, 0, .26, 4, .26), 0x5b4d34),
    paint(at(cone, 0, 5.2, 0, 2.3, 4.4, 2.3), 0x3f5c42),
    paint(at(cone, 0, 8, 0, 1.5, 3, 1.5), 0x4a6b4a),
  ]);
  t.jungle = mergeAll([
    paint(at(cyl, 0, 3.4, 0, .34, 7, .34), 0x5c5033),
    paint(at(octa, 0, 7.4, 0, 3.4, 2.1, 3.4), 0x34592f),
    paint(at(octa, 1.2, 8.6, -.8, 2.1, 1.4, 2.1), 0x43703a),
  ]);
  t.acacia = mergeAll([
    paint(at(cyl, 0, 2.4, 0, .24, 5, .24), 0x6b5b3c),
    paint(at(box, 0, 5.4, 0, 5.2, .5, 5.2), 0x6e7f44),
    paint(at(box, 0, 5.9, 0, 3.4, .4, 3.4), 0x7d8c4c),
  ]);
  t.mangrove = mergeAll([
    paint(at(cyl, 0, 2, 0, .3, 4, .3), 0x4e4630),
    paint(at(cyl, 1.1, 1, .6, .16, 2.4, .16), 0x4e4630),
    paint(at(cyl, -1, 1, -.7, .16, 2.4, .16), 0x4e4630),
    paint(at(octa, 0, 4.6, 0, 2.8, 1.5, 2.8), 0x3f5f3c),
  ]);
  t.reed = mergeAll([
    paint(at(box, 0, 1.2, 0, .12, 2.6, .12), 0x7c8a4a),
    paint(at(box, .5, 1, .3, .12, 2.2, .12), 0x8b9752),
    paint(at(box, -.4, 1.1, -.3, .12, 2.4, .12), 0x6f7d42),
  ]);
  t.rock = paint(at(octa, 0, .9, 0, 1.9, 1.5, 1.7), 0x7a7a68);
  t.bush = mergeAll([
    paint(at(octa, 0, .9, 0, 1.5, 1.1, 1.5), 0x4f6540),
    paint(at(octa, .8, 1.2, .4, .9, .8, .9), 0x5c7249),
  ]);
  for (const geo of [box, cyl, cone, octa]) geo.dispose();
  templates = t;
  return t;
}

function propGeometry(world, cx, cz, lod, sites) {
  const budget = PROP_BUDGET[Math.min(lod, PROP_BUDGET.length - 1)];
  if (!budget) return null;
  const props = world.propsInChunk(cx, cz, lod).slice(0, budget);
  if (!props.length) return null;
  const shapes = propTemplates();
  const parts = [];
  const matrix = new THREE.Matrix4(), quat = new THREE.Quaternion(), euler = new THREE.Euler();
  for (const prop of props) {
    const template = shapes[prop.prop];
    if (!template) continue;
    // Settlements flatten the ground, so props must follow the flattened surface.
    const y = world.groundHeight(prop.x, prop.z, sites);
    euler.set(0, prop.turn, 0);
    quat.setFromEuler(euler);
    matrix.compose(new THREE.Vector3(prop.x, y, prop.z), quat, new THREE.Vector3(prop.scale, prop.scale, prop.scale));
    const g = template.clone();
    g.applyMatrix4(matrix);
    parts.push(g);
  }
  if (!parts.length) return null;
  const merged = parts.length === 1 ? flatten(parts[0]) : mergeAll(parts);
  for (const g of parts) if (g !== merged) g.dispose();
  if (!merged) return null;
  const welded = mergeVertices(merged, 1e-4);
  if (welded && welded !== merged) { merged.dispose(); return welded; }
  return merged;
}

// ---------------------------------------------------------------- settlements
function settlementGeometry(world, site, sites) {
  const parts = [], glassParts = [];
  const paint = (geo, hex, into = parts) => {
    const c = linear(hex), n = geo.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    into.push(geo);
    return geo;
  };
  const slab = (x, y, z, w, h, d, hex, turn = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (turn) g.rotateY(turn);
    g.translate(x, y, z);
    return paint(g, hex);
  };
  const ground = site.height;
  const tint = FACTIONS[site.faction]?.tint ?? 0xbddfa8;

  // A graded apron, so the settlement reads as cut into the hillside.
  slab(site.x, ground - 0.4, site.z, site.radius * 2.1, 0.8, site.radius * 2.1, 0x6f6a55);
  slab(site.x, ground + 0.06, site.z, site.radius * 1.8, 0.3, site.radius * 1.8, 0x565f4f);

  const rand = (n) => {
    let h = Math.imul(site.cellX * 7919 + site.cellZ * 104729 + n * 31, 2246822519);
    h = (h ^ (h >>> 15)) >>> 0;
    return h / 4294967296;
  };

  const count = site.kind === 'camp' || site.kind === 'outpost' ? 3
    : site.kind === 'village' ? 6 : site.kind === 'town' ? 9 : 7;
  for (let i = 0; i < count; i++) {
    const a = i / count * Math.PI * 2 + rand(i) * 0.8;
    const r = site.radius * (0.34 + rand(i + 40) * 0.5);
    const x = site.x + Math.cos(a) * r, z = site.z + Math.sin(a) * r;
    const w = 4 + rand(i + 80) * 5, d = 4 + rand(i + 120) * 5;
    const h = site.kind === 'town' ? 4 + rand(i + 160) * 5 : 3 + rand(i + 160) * 3;
    slab(x, ground + h / 2 + 0.2, z, w, h, d, i % 3 === 0 ? 0x8b9c8c : i % 3 === 1 ? 0xdfd9bb : 0x647f76, a);
    slab(x, ground + h + 0.35, z, w + 0.7, 0.5, d + 0.7, i % 2 ? 0xa84e3b : 0x647f76, a);
    const face = new THREE.BoxGeometry(w * 0.6, h * 0.35, 0.16);
    face.rotateY(a); face.translate(x + Math.cos(a) * (d / 2), ground + h * 0.55, z + Math.sin(a) * (d / 2));
    paint(face, 0x173b4a, glassParts);
  }

  // Industrial and military sites get their silhouette pieces.
  if (site.kind === 'refinery') {
    for (let i = 0; i < 3; i++) {
      const x = site.x + (i - 1) * 7, z = site.z - site.radius * 0.45;
      const tank = new THREE.CylinderGeometry(3, 3.2, 6, 10);
      tank.translate(x, ground + 3, z); paint(tank, 0xbd6039);
      const cap = new THREE.CylinderGeometry(3.1, 3.1, 0.4, 10);
      cap.translate(x, ground + 6.2, z); paint(cap, 0x71847e);
    }
  }
  if (site.kind === 'port') {
    slab(site.x, ground + 0.5, site.z + site.radius * 0.9, site.radius * 1.3, 1, 8, 0x8b9c8c);
    const mast = new THREE.CylinderGeometry(0.4, 0.5, 14, 6);
    mast.translate(site.x - site.radius * 0.5, ground + 7, site.z); paint(mast, 0xf59338);
  }
  if (site.kind === 'airfield') {
    slab(site.x, ground + 0.12, site.z, site.radius * 2.4, 0.24, 9, 0x485954, 0.3);
    for (let i = -3; i <= 3; i++) slab(site.x + i * site.radius * 0.32, ground + 0.26, site.z, 3, 0.1, 0.4, 0xdfd9bb, 0.3);
  }
  if (site.threat >= 2) {
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * Math.PI * 2 + 0.6;
      const x = site.x + Math.cos(a) * site.radius * 0.95, z = site.z + Math.sin(a) * site.radius * 0.95;
      slab(x, ground + 1.2, z, 2.4, 2.4, 2.4, 0x20322f);
      slab(x, ground + 2.6, z, 1.2, 0.6, 1.2, tint);
    }
  }
  // A faction mast, so you can read ownership from the air.
  const pole = new THREE.CylinderGeometry(0.22, 0.22, 11, 5);
  pole.translate(site.x, ground + 5.5, site.z); paint(pole, 0x71847e);
  slab(site.x + 1.6, ground + 10, site.z, 3.2, 1.6, 0.2, tint);

  if (site.pads) {
    const ring = new THREE.RingGeometry(site.radius * 0.26, site.radius * 0.3, 24);
    ring.rotateX(-Math.PI / 2);
    ring.translate(site.x, ground + 0.32, site.z);
    paint(ring, 0xdfd9bb);
  }

  const solid = mergeAll(parts);
  for (const g of parts) if (g !== solid) g.dispose();
  const glass = mergeAll(glassParts);
  for (const g of glassParts) g.dispose();
  return { solid, glass };
}

// ---------------------------------------------------------------- landmarks
// The one unmistakable structure in each region. These are built for silhouette: you
// should know which of the nine you are looking at from a kilometre out and from this
// camera angle, which is why each one commits to a single strong shape — a tower, a wall,
// a dish, a hull, a pyramid — rather than a cluster of boxes.
function shapeShop() {
  const parts = [], glassParts = [];
  const paint = (geo, hex, into = parts) => {
    tmpA.setHex(hex);
    const n = geo.getAttribute('position').count, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = tmpA.r; arr[i * 3 + 1] = tmpA.g; arr[i * 3 + 2] = tmpA.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    into.push(geo);
    return geo;
  };
  const box = (x, y, z, w, h, d, hex, turn = 0, tilt = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (tilt) g.rotateX(tilt);
    if (turn) g.rotateY(turn);
    g.translate(x, y, z);
    return paint(g, hex);
  };
  const cyl = (x, y, z, r, h, hex, seg = 8, lie = 0, turn = 0) => {
    const g = new THREE.CylinderGeometry(r, r, h, seg);
    if (lie) g.rotateZ(Math.PI / 2);
    if (turn) g.rotateY(turn);
    g.translate(x, y, z);
    return paint(g, hex);
  };
  const cone = (x, y, z, r, h, hex, seg = 8) => {
    const g = new THREE.ConeGeometry(r, h, seg);
    g.translate(x, y, z);
    return paint(g, hex);
  };
  // Glazing is the same box, routed to the other material so the whole chunk still shares
  // one mesh per material class.
  const glass = (x, y, z, w, h, d, turn = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (turn) g.rotateY(turn);
    g.translate(x, y, z);
    return paint(g, 0x173b4a, glassParts);
  };
  return { parts, glassParts, paint, box, cyl, cone, glass };
}

const CONCRETE = 0x8e9186, STONE = 0x8a8270, METAL = 0x6f7a72, RUST = 0xa9552f,
  SALT = 0xe8e4d2, DARK = 0x33342c, PALE = 0xcfc9ab, DECK = 0x4b5550;

function landmarkGeometry(world, mark, sites) {
  const shop = shapeShop();
  const { box, cyl, cone, glass } = shop;
  const g = mark.height;               // the floor this thing stands on
  const r = mark.radius;
  const jitter = n => {
    let h = Math.imul(mark.x * 7919 + mark.z * 104729 + n * 61, 2246822519);
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
  };

  switch (mark.key) {
    case 'chapel': {                   // a bell tower in standing water
      box(mark.x, g + 0.4, mark.z, r * 0.9, 0.8, r * 0.9, DECK);          // the flooded platform
      box(mark.x, g + 7, mark.z, 7, 14, 7, PALE);                          // the tower
      box(mark.x, g + 14.6, mark.z, 8.2, 1.4, 8.2, STONE);
      cone(mark.x, g + 17.4, mark.z, 5.4, 5, 0x6a4f3a, 4);                 // the spire
      glass(mark.x, g + 9.5, mark.z - 3.6, 2.2, 4, 0.3);
      box(mark.x + 7, g + 3, mark.z + 3, 10, 6, 8, PALE, 0.3);             // the nave, half sunk
      box(mark.x + 7, g + 6.4, mark.z + 3, 11, 1, 9, 0x8a4a3a, 0.3);
      for (let i = 0; i < 7; i++) {                                        // stilt houses
        const a = i / 7 * Math.PI * 2 + 0.4, d = r * (0.62 + jitter(i) * 0.3);
        const hx = mark.x + Math.cos(a) * d, hz = mark.z + Math.sin(a) * d;
        for (const [ox, oz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
          cyl(hx + ox, g + 1.4, hz + oz, 0.22, 3, 0x4e4630, 5);
        }
        box(hx, g + 3.9, hz, 4.4, 2.6, 4.4, i % 2 ? 0xb9ae86 : 0x9aa177, a);
        box(hx, g + 5.4, hz, 5, 0.5, 5, 0x7a6a4a, a);
      }
      break;
    }
    case 'strip': {                    // two kilometres of cracked runway
      box(mark.x, g + 0.18, mark.z, r * 2.2, 0.36, 13, 0x4a524e, 0.12);
      for (let i = -7; i <= 7; i++) box(mark.x + i * r * 0.14, g + 0.38, mark.z, 6, 0.08, 0.7, PALE, 0.12);
      box(mark.x, g + 0.3, mark.z - 16, r * 1.2, 0.3, 9, 0x555c52, 0.12);  // the apron
      box(mark.x - r * 0.6, g + 4, mark.z - 20, 7, 8, 7, PALE);            // the tower
      glass(mark.x - r * 0.6, g + 7.6, mark.z - 20, 7.6, 2.6, 7.6);
      box(mark.x - r * 0.6, g + 9.4, mark.z - 20, 8.6, 0.6, 8.6, RUST);
      for (let i = 0; i < 2; i++) {                                        // the airliners
        const ax = mark.x + (i ? r * 0.42 : -r * 0.1), az = mark.z - 17 + i * 3;
        const turn = 0.12 + (i ? 0.5 : -0.3);
        cyl(ax, g + 2.6, az, 2.1, 26, PALE, 10, 1, turn);
        cone(ax + Math.cos(turn) * 14.5, g + 2.6, az + Math.sin(turn) * 14.5, 2.1, 5, PALE, 10);
        box(ax, g + 2.2, az, 8, 0.4, 20, 0xb4b1a0, turn + Math.PI / 2);    // wings
        box(ax - Math.cos(turn) * 12, g + 5.4, az - Math.sin(turn) * 12, 0.5, 6, 4, 0x9fa596, turn);
      }
      break;
    }
    case 'boneyard': {                 // rows of stripped fuselages
      box(mark.x, g + 0.16, mark.z, r * 1.9, 0.32, r * 1.5, 0x9c8661);
      for (let row = 0; row < 3; row++) {
        for (let i = 0; i < 4; i++) {
          const bx = mark.x - r * 0.7 + i * r * 0.46 + jitter(row * 9 + i) * 4;
          const bz = mark.z - r * 0.5 + row * r * 0.5;
          const turn = 1.35 + (jitter(row * 13 + i) - 0.5) * 0.5;
          cyl(bx, g + 1.9, bz, 1.6, 15 + jitter(i) * 6, i % 2 ? 0xb6ae9a : 0x9c9a88, 8, 1, turn);
          if (i % 2) box(bx + 5, g + 4.2, bz, 0.4, 5, 3.4, 0x8d8b7a, turn);
          if (row === 1) box(bx, g + 1.4, bz + 3.4, 7, 0.35, 2.4, 0x7f7d6c, turn);
        }
      }
      cyl(mark.x + r * 0.8, g + 5, mark.z - r * 0.4, 0.4, 10, RUST, 6);    // the crane
      box(mark.x + r * 0.8 - 3, g + 9.6, mark.z - r * 0.4, 8, 0.7, 0.7, RUST);
      for (let i = 0; i < 5; i++) box(mark.x - r * 0.85, g + 0.9 + i * 0.5, mark.z + r * 0.55 + i * 0.3, 9, 0.45, 3.4, 0x8a8878, 0.2);
      break;
    }
    case 'dam': {                      // a wall across the valley
      const wall = r * 2.3;
      box(mark.x, g + 11, mark.z, wall, 24, 7, CONCRETE, 0.08);
      box(mark.x, g + 23.4, mark.z, wall + 1.6, 1.2, 9.4, 0xa7a99c, 0.08); // the roadway
      for (let i = -4; i <= 4; i++) box(mark.x + i * wall * 0.1, g + 24.6, mark.z - 4.4, 0.5, 1.4, 0.5, DARK);
      for (let i = -1; i <= 1; i++) {                                      // spillway gates
        box(mark.x + i * wall * 0.22, g + 6, mark.z + 3.4, wall * 0.13, 12, 1.4, RUST);
      }
      box(mark.x, g + 1.2, mark.z - 14, wall * 0.9, 2.4, 20, 0x3f5f66);    // impounded water
      box(mark.x + wall * 0.42, g + 3.4, mark.z + 9, 9, 7, 8, PALE);       // the power house
      glass(mark.x + wall * 0.42, g + 4.4, mark.z + 13.1, 5, 2.4, 0.3);
      cyl(mark.x - wall * 0.4, g + 14, mark.z + 4, 0.5, 6, METAL, 6);
      break;
    }
    case 'observatory': {              // a dish on the roof of the region
      box(mark.x, g + 0.5, mark.z, r * 1.3, 1, r * 1.3, 0x77786c);
      box(mark.x, g + 3, mark.z, 11, 5, 11, CONCRETE);                     // the bunker
      glass(mark.x, g + 3.4, mark.z + 5.6, 6, 1.8, 0.3);
      box(mark.x, g + 6, mark.z, 12, 1, 12, 0x6c6d62);
      cyl(mark.x, g + 9, mark.z, 1.5, 6, METAL, 10);                       // the pedestal
      const bowl = new THREE.SphereGeometry(9.5, 18, 7, 0, Math.PI * 2, 0, Math.PI / 2.6);
      bowl.rotateX(Math.PI * 0.72);
      bowl.translate(mark.x, g + 15.5, mark.z + 1);
      shop.paint(bowl, PALE);
      cyl(mark.x, g + 19.5, mark.z + 4.5, 0.3, 9, DARK, 5);                // the feed horn
      for (let i = 0; i < 3; i++) {
        const a = i / 3 * Math.PI * 2;
        cyl(mark.x + Math.cos(a) * 12, g + 4.5, mark.z + Math.sin(a) * 12, 0.22, 8, METAL, 5);
      }
      break;
    }
    case 'freighter': {                // aground and broken in two
      const bow = { x: mark.x - 13, z: mark.z - 5 }, stern = { x: mark.x + 14, z: mark.z + 4 };
      box(bow.x, g + 2.4, bow.z, 12, 6.4, 30, 0x6b5a4e, 0.22, -0.1);       // the fore hull
      box(bow.x, g + 5.8, bow.z, 12.6, 0.6, 30, DECK, 0.22);
      cone(bow.x - Math.sin(0.22) * 15.5, g + 2.4, bow.z - Math.cos(0.22) * 15.5, 5.6, 9, 0x6b5a4e, 6);
      box(stern.x, g + 2.1, stern.z, 12, 6, 26, 0x6b5a4e, 0.44, 0.13);     // the aft hull
      box(stern.x, g + 5.2, stern.z, 12.6, 0.6, 26, DECK, 0.44);
      box(stern.x + 3, g + 8.4, stern.z + 6, 10, 6.4, 8, PALE, 0.44);      // the bridge
      glass(stern.x + 3, g + 10.4, stern.z + 6, 10.4, 1.9, 8.4, 0.44);
      cyl(stern.x + 1, g + 13.5, stern.z - 2, 2.4, 8, RUST, 8);            // the funnel
      for (let i = 0; i < 9; i++) {                                        // spilled containers
        const a = jitter(i) * Math.PI * 2, d = r * (0.5 + jitter(i + 20) * 0.6);
        box(mark.x + Math.cos(a) * d, g + 1.4, mark.z + Math.sin(a) * d, 7, 2.8, 3,
          [0xa9552f, 0x3f6b74, 0x8a8f5f, 0x9a4a52][i % 4], a);
      }
      break;
    }
    case 'steps': {                    // a stone pyramid above the canopy
      const tiers = 6;
      for (let i = 0; i < tiers; i++) {
        const w = r * 1.7 * (1 - i / tiers * 0.78);
        box(mark.x, g + 1.4 + i * 3.4, mark.z, w, 3.4, w, i % 2 ? STONE : 0x94886f);
      }
      box(mark.x, g + tiers * 3.4 + 2.4, mark.z, 7, 4.4, 7, 0x7e7460);     // the shrine on top
      box(mark.x, g + tiers * 3.4 + 5, mark.z, 8.4, 0.8, 8.4, 0x6a6150);
      // the stair up one face
      for (let i = 0; i < tiers * 3; i++) {
        box(mark.x, g + 0.9 + i * 0.72, mark.z + r * 0.86 - i * 0.62, 6.4, 0.7, 0.9, 0x9d9079);
      }
      for (let i = 0; i < 6; i++) {                                        // stelae
        const a = i / 6 * Math.PI * 2 + 0.5;
        box(mark.x + Math.cos(a) * r * 1.15, g + 2.4, mark.z + Math.sin(a) * r * 1.15, 1.4, 5, 1, 0x8b8168, a);
      }
      break;
    }
    case 'evaporators': {              // a grid of white pans
      box(mark.x, g + 0.12, mark.z, r * 1.9, 0.24, r * 1.9, 0xb9b39a);
      for (let gz = -1; gz <= 1; gz++) {
        for (let gx = -1; gx <= 1; gx++) {
          const px = mark.x + gx * r * 0.62, pz = mark.z + gz * r * 0.62;
          const pan = r * 0.52;
          box(px, g + 0.34, pz, pan, 0.3, pan, jitter(gx * 3 + gz) > 0.5 ? 0xd9d8c2 : 0xc3cfc6);
          for (const [ox, oz, w, d] of [[pan / 2, 0, 0.6, pan], [-pan / 2, 0, 0.6, pan], [0, pan / 2, pan, 0.6], [0, -pan / 2, pan, 0.6]]) {
            box(px + ox, g + 0.7, pz + oz, w, 0.9, d, 0x9c9880);
          }
        }
      }
      for (let i = 0; i < 4; i++) cone(mark.x - r * 0.3 + i * r * 0.25, g + 3, mark.z - r * 1.02, 4.6, 6.4, SALT, 9);
      box(mark.x, g + 7, mark.z - r * 1.02, r * 1.5, 0.8, 1.6, METAL, 0.04); // the conveyor
      for (let i = -2; i <= 2; i++) cyl(mark.x + i * r * 0.34, g + 3.4, mark.z - r * 1.02, 0.3, 7, METAL, 5);
      box(mark.x + r * 0.9, g + 3, mark.z - r * 1.02, 8, 6.4, 7, 0xb1a98e);
      glass(mark.x + r * 0.9, g + 3.6, mark.z - r * 1.02 + 3.6, 4.4, 2, 0.3);
      break;
    }
    case 'interchange': {              // four levels of motorway that stopped being built
      const decks = [
        { y: 4.5, turn: 0.1, len: 2.2, w: 11 },
        { y: 10.5, turn: Math.PI / 2 + 0.16, len: 2.0, w: 11 },
        { y: 16, turn: 0.82, len: 1.7, w: 9 },
        { y: 21, turn: -0.62, len: 1.3, w: 8 },
      ];
      box(mark.x, g + 0.2, mark.z, r * 1.7, 0.4, r * 1.7, 0x6f6a55);
      decks.forEach((deck, i) => {
        box(mark.x, g + deck.y, mark.z, r * deck.len, 1.1, deck.w, 0x8d8f85, deck.turn);
        box(mark.x, g + deck.y + 1.1, mark.z, r * deck.len, 0.5, deck.w + 1.4, 0x74766d, deck.turn);
        const span = r * deck.len / 2;
        for (let k = -1; k <= 1; k += 2) {
          const px = mark.x + Math.cos(deck.turn) * span * k * 0.72;
          const pz = mark.z + Math.sin(deck.turn) * span * k * 0.72;
          cyl(px, g + deck.y / 2, pz, 1.5, deck.y, CONCRETE, 8);
        }
        cyl(mark.x, g + deck.y / 2, mark.z, 2.1, deck.y, CONCRETE, 8);
        if (i === 3) {                                                      // the unfinished end
          const px = mark.x + Math.cos(deck.turn) * span, pz = mark.z + Math.sin(deck.turn) * span;
          for (let k = 0; k < 4; k++) cyl(px, g + deck.y + 1.8 + k * 0.1, pz + k - 1.5, 0.16, 3.4, RUST, 4);
        }
      });
      for (let i = 0; i < 8; i++) {                                         // the market underneath
        const a = jitter(i) * Math.PI * 2, d = r * (0.42 + jitter(i + 11) * 0.5);
        box(mark.x + Math.cos(a) * d, g + 1.4, mark.z + Math.sin(a) * d, 4.4, 2.4, 4,
          [0xa9552f, 0xdfd9bb, 0x647f76, 0x8a8f5f][i % 4], a);
      }
      break;
    }
  }

  // Every landmark carries a light. From this camera a lit mast is how you pick a place
  // out of ten kilometres of ground, and it is the same signal for all nine.
  cyl(mark.x + r * 0.78, g + 7, mark.z - r * 0.78, 0.26, 14, METAL, 5);
  box(mark.x + r * 0.78, g + 14.4, mark.z - r * 0.78, 1.5, 1.5, 1.5, 0xf3b25e);

  const solid = mergeAll(shop.parts);
  for (const geo of shop.parts) if (geo !== solid) geo.dispose();
  const glassMesh = mergeAll(shop.glassParts);
  for (const geo of shop.glassParts) geo.dispose();
  return { solid, glass: glassMesh };
}

// ---------------------------------------------------------------- the chunk
export function buildChunk(world, materials, cx, cz, lod) {
  const group = new THREE.Group();
  group.matrixAutoUpdate = false;
  const centreX = (cx + 0.5) * WORLD.chunk, centreZ = (cz + 0.5) * WORLD.chunk;
  // Platforms are gathered once and shared by the ground, the props and the buildings so
  // all three agree on where the flattened ground is. Landmarks that were built rather
  // than run aground are in this list too, which is why a dish on a summit gets a level
  // apron instead of a tilted one.
  const sites = world.platformsNear(centreX, centreZ, WORLD.chunk * 1.4);
  const inThisChunk = p => Math.floor(p.x / WORLD.chunk) === cx && Math.floor(p.z / WORLD.chunk) === cz;
  const marks = world.landmarksNear(centreX, centreZ, WORLD.chunk * 1.4).filter(inThisChunk);

  const ground = groundGeometry(world, cx, cz, lod, sites);
  const groundMesh = new THREE.Mesh(ground.geometry, materials.ground);
  groundMesh.castShadow = lod === 0;
  groundMesh.receiveShadow = true;
  groundMesh.matrixAutoUpdate = false;
  group.add(groundMesh);

  const props = propGeometry(world, cx, cz, lod, sites);
  if (props) {
    const mesh = new THREE.Mesh(props, materials.foliage);
    mesh.castShadow = lod === 0; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }

  const built = [], glassPieces = [];
  if (lod <= 1) {
    for (const site of sites) {
      if (site.landmark || !inThisChunk(site)) continue;
      const geo = settlementGeometry(world, site, sites);
      built.push(geo.solid);
      if (geo.glass) glassPieces.push(geo.glass);
    }
  }
  // Landmarks are built one detail level further out than settlements: they are the thing
  // you navigate by, so they have to be there before you are on top of them.
  if (lod <= 2) {
    for (const mark of marks) {
      const geo = landmarkGeometry(world, mark, sites);
      if (geo.solid) built.push(geo.solid);
      if (geo.glass) glassPieces.push(geo.glass);
    }
  }
  if (built.filter(Boolean).length) {
    const merged = built.length === 1 ? built[0] : mergeAll(built);
    for (const g of built) if (g !== merged) g.dispose();
    const mesh = new THREE.Mesh(merged, materials.built);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  if (glassPieces.length) {
    const merged = glassPieces.length === 1 ? glassPieces[0] : mergeAll(glassPieces);
    for (const g of glassPieces) if (g !== merged) g.dispose();
    const mesh = new THREE.Mesh(merged, materials.glass);
    mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }

  let triangles = 0;
  group.traverse(o => { if (o.isMesh) triangles += (o.geometry.index ? o.geometry.index.count : o.geometry.getAttribute('position').count) / 3; });

  return {
    group, cx, cz, lod, triangles, heights: ground.heights, side: ground.side,
    step: ground.step, originX: ground.originX, originZ: ground.originZ,
    settlements: sites.filter(s => !s.landmark && inThisChunk(s)), landmarks: marks,
    dispose() {
      group.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
      group.removeFromParent();
    },
  };
}
