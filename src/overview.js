// The whole region as one coarse mesh, so the player can zoom out and see it.
//
// The streamer keeps three detail rings around the aircraft, reaching about 575 metres past
// the edge of the screen. That is generous at the default view and useless the moment you
// zoom out: at eight times the view the frame covers roughly four kilometres, and expanding
// the rings to match would want thousands of chunks.
//
// So the far field is not streamed at all. It is one mesh of the entire hundred square
// kilometres, built once, drawn in a single call, and left in place — the detailed chunks
// sit on top of it near the aircraft, and it carries the view everywhere else. That is
// also why zooming out cannot stall: there is nothing to build when you do it.
//
// The one thing that has to be right is that it never pokes up through the detailed
// terrain. Each vertex therefore takes the *lowest* of itself and its four neighbours and
// drops a little further, so the coarse surface hangs below the fine one rather than
// intersecting it. Land is not allowed below sea level by that process, or the coastline
// would visibly retreat wherever the chunks had not been built.

import * as THREE from 'three';
import { WORLD } from './worldgen.js';
import { groundColour, groundAlt } from './terrain.js';

// 256 quads a side is 7.8 units — 39 metres — per quad, which at the furthest zoom is
// about eight pixels. 131,000 triangles in one draw call, and 92 ms to build.
export const OVERVIEW_RESOLUTION = 256;
const SINK = 2.2;              // how far the coarse surface hangs below the fine one

export function buildOverview(world, material, resolution = OVERVIEW_RESOLUTION) {
  const side = resolution + 1;
  const step = WORLD.size / resolution;
  const count = side * side;
  const raw = new Float32Array(count);
  const wet = new Float32Array(count);
  const warm = new Float32Array(count);
  const positions = new Float32Array(count * 3);
  const colours = new Float32Array(count * 3);

  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const x = -WORLD.half + i * step, z = -WORLD.half + j * step;
      const h = world.elevation(x, z);
      const k = j * side + i;
      raw[k] = h;
      wet[k] = world.moisture(x, z, h);
      warm[k] = world.temperature(x, z, h);
    }
  }

  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const k = j * side + i;
      const x = -WORLD.half + i * step, z = -WORLD.half + j * step;
      const east = raw[j * side + Math.min(i + 1, side - 1)];
      const west = raw[j * side + Math.max(i - 1, 0)];
      const south = raw[Math.min(j + 1, side - 1) * side + i];
      const north = raw[Math.max(j - 1, 0) * side + i];
      // Hang below the fine surface: the lowest thing in the neighbourhood, minus a bias.
      let y = Math.min(raw[k], east, west, south, north) - SINK;
      // ...but dry ground stays dry, so the coast does not creep inland out there.
      if (raw[k] > WORLD.seaLevel) y = Math.max(y, 0.12);
      positions[k * 3] = x;
      positions[k * 3 + 1] = Math.max(y, -9);
      positions[k * 3 + 2] = z;
      const steep = Math.min(1, Math.hypot((east - west) / (2 * step), (south - north) / (2 * step)) * 2.1);
      groundColour(world, raw[k], wet[k], warm[k], steep, groundAlt(x, z), colours, k * 3);
    }
  }

  const index = new Uint32Array(resolution * resolution * 6);
  let o = 0;
  for (let j = 0; j < resolution; j++) {
    for (let i = 0; i < resolution; i++) {
      const a = j * side + i, b = a + 1, c = a + side, d = c + 1;
      index[o++] = a; index[o++] = c; index[o++] = b;
      index[o++] = b; index[o++] = c; index[o++] = d;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(geometry, material);
  // It is the backdrop: it neither casts nor receives, which keeps the shadow pass to the
  // chunks the player is actually flying over.
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.matrixAutoUpdate = false;
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  mesh.updateMatrix();
  return {
    mesh, geometry,
    triangles: index.length / 3,
    vertices: count,
    dispose() { geometry.dispose(); mesh.removeFromParent(); },
  };
}
