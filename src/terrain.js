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
// Primitives disagree about indexing (octahedra come out non-indexed, boxes indexed) and
// mergeGeometries refuses a mixture, so every piece is flattened before merging.
// A cheap per-vertex jitter. Biomes are classified on hard thresholds, so without this the
// boundary between, say, badlands and savanna is a drawn line across the ground. Nudging
// the inputs per vertex interleaves the two for a few metres instead.
const dither = (x, z) => {
  const n = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return (n - Math.floor(n)) - 0.5;
};
const flatten = geo => { if (!geo.index) return geo; const out = geo.toNonIndexed(); geo.dispose(); return out; };
const mergeAll = list => { const parts = list.filter(Boolean).map(flatten); return parts.length ? mergeGeometries(parts) : null; };
// Two scratch colours: callers routinely need a base and a blend target at once, and a
// single shared instance silently aliased them together.
const linear = hex => { tmpA.setHex(hex); return tmpA; };
const linearB = hex => { tmpB.setHex(hex); return tmpB; };

export function createMaterials() {
  const ground = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .92, metalness: .02, flatShading: true });
  const foliage = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .86, metalness: .02, flatShading: true });
  const built = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .78, metalness: .06, flatShading: true });
  const glass = new THREE.MeshStandardMaterial({ color: 0x173b4a, roughness: .2, metalness: .55, flatShading: true });
  return { ground, foliage, built, glass,
    dispose() { for (const m of [ground, foliage, built, glass]) m.dispose(); } };
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

  for (let iz = 0; iz < side; iz++) {
    for (let ix = 0; ix < side; ix++) {
      const x = originX + ix * step, z = originZ + iz * step;
      const h = world.groundHeight(x, z, sites);
      const i = iz * side + ix;
      heights[i] = h;
      positions[i * 3] = x;
      positions[i * 3 + 1] = Math.max(h, -9);
      positions[i * 3 + 2] = z;
      const blur = dither(x, z);
      const info = BIOMES[world.classify(h + blur * 2.2, world.moisture(x, z) + blur * 0.055,
        world.temperature(x, z) + dither(z, x) * 0.05)];
      // Steep ground shows rock; the flat tops keep their biome colour, with a little
      // large-scale variation so a plain does not read as one flat sheet.
      const steep = Math.min(1, world.slope(x, z, step) * 2.1);
      const alt = (Math.sin(x * 0.031) + Math.cos(z * 0.027)) * 0.5;
      const base = linear(alt > 0.15 ? info.groundAlt : info.ground);
      const rock = linearB(info.cliff);
      colours[i * 3] = base.r + (rock.r - base.r) * steep;
      colours[i * 3 + 1] = base.g + (rock.g - base.g) * steep;
      colours[i * 3 + 2] = base.b + (rock.b - base.b) * steep;
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

// ---------------------------------------------------------------- the chunk
export function buildChunk(world, materials, cx, cz, lod) {
  const group = new THREE.Group();
  group.matrixAutoUpdate = false;
  const centreX = (cx + 0.5) * WORLD.chunk, centreZ = (cz + 0.5) * WORLD.chunk;
  // Settlements are gathered once and shared by the ground, the props and the buildings so
  // all three agree on where the flattened platforms are.
  const sites = world.settlementsNear(centreX, centreZ, WORLD.chunk * 1.4);

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
      if (Math.floor(site.x / WORLD.chunk) !== cx || Math.floor(site.z / WORLD.chunk) !== cz) continue;
      const geo = settlementGeometry(world, site, sites);
      built.push(geo.solid);
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
    settlements: sites.filter(s => Math.floor(s.x / WORLD.chunk) === cx && Math.floor(s.z / WORLD.chunk) === cz),
    dispose() {
      group.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
      group.removeFromParent();
    },
  };
}
