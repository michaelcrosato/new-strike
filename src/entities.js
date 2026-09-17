// Meshes for everything that moves or dies: garrisons, mission props, rounds in the air.
//
// Templates are built once and instanced per live entity; the view reconciles a Map of
// meshes against whatever the simulation currently holds, so entities appear and vanish
// with the streamed world without the loop knowing anything about geometry.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FACTIONS } from './worldgen.js';

const scratch = new THREE.Color();
const paint = (geo, hex) => {
  scratch.setHex(hex);
  const n = geo.getAttribute('position').count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = scratch.r; arr[i * 3 + 1] = scratch.g; arr[i * 3 + 2] = scratch.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo.index ? geo.toNonIndexed() : geo;
};
const box = (x, y, z, w, h, d, hex, turn = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  if (turn) g.rotateY(turn);
  g.translate(x, y, z);
  return paint(g, hex);
};
const tube = (x, y, z, r, h, hex, seg = 7, lie = false) => {
  const g = new THREE.CylinderGeometry(r, r, h, seg);
  if (lie) g.rotateZ(Math.PI / 2);
  g.translate(x, y, z);
  return paint(g, hex);
};

let cache = null;
export function entityTemplates() {
  if (cache) return cache;
  const t = {};
  t.checkpoint = mergeGeometries([
    box(0, 0.6, 0, 7, 1.2, 7, 0x6a6353),
    box(0, 2, 0, 4, 2.4, 4, 0x4a4a3c),
    box(0, 3.6, 0, 2.4, 0.8, 2.4, 0x2c2c24),
    tube(0, 3.8, -2.2, 0.16, 3.2, 0x1d1d18, 5, false),
  ]);
  t.technical = mergeGeometries([
    box(0, 1, 0, 3, 1.6, 6.6, 0x8a6a3e),
    box(0, 1.1, -3.4, 2.8, 1.5, 1.4, 0x5a4a30),
    box(0, 2.1, 1.2, 2.2, 0.6, 3, 0x40402f),
    tube(0, 2.6, 1.2, 0.14, 2.6, 0x1d1d18, 5),
    tube(-1.5, 0.3, -2.4, 0.55, 0.4, 0x1c1c18, 8, true),
    tube(1.5, 0.3, -2.4, 0.55, 0.4, 0x1c1c18, 8, true),
    tube(-1.5, 0.3, 2.2, 0.55, 0.4, 0x1c1c18, 8, true),
    tube(1.5, 0.3, 2.2, 0.55, 0.4, 0x1c1c18, 8, true),
  ]);
  t.aa = mergeGeometries([
    box(0, 0.5, 0, 6.4, 1, 6.4, 0x55554a),
    box(0, 1.8, 0, 3.6, 1.8, 3.6, 0x3f4436),
    box(-1, 3.4, 0, 1.1, 1.4, 4.4, 0xb9b2a0),
    box(1, 3.4, 0, 1.1, 1.4, 4.4, 0xb9b2a0),
  ]);
  t.patrolboat = mergeGeometries([
    box(0, 0.2, 0, 3.4, 1.2, 8.4, 0x8e8f84),
    box(0, 1.2, 1.6, 2.6, 1.4, 2.6, 0xdad4b8),
    box(0, 2, 1.2, 2.4, 0.5, 2, 0x1c3b49),
    tube(0, 1.4, -2.6, 0.13, 2.2, 0x1d1d18, 5),
  ]);
  t.radar = mergeGeometries([
    box(0, 0.7, 0, 7.4, 1.4, 7.4, 0x4c4c42),
    tube(0, 4, 0, 0.5, 6, 0x7a7a6a, 6),
    box(0, 7.4, 0, 8.4, 0.5, 1.2, 0xd8d2b6),
    box(0, 8, 0, 3.4, 0.4, 0.8, 0xb9b2a0),
  ]);
  t.depot = mergeGeometries([
    box(0, 0.4, 0, 13, 0.8, 11, 0x555046),
    box(-2.6, 2.4, 0, 6, 4, 8, 0x8d7b4e),
    box(-2.6, 4.7, 0, 6.6, 0.7, 8.6, 0x5c4f32),
    tube(3.6, 2.6, -2, 2.2, 5, 0xbd6039, 10),
    tube(3.6, 2.6, 2.6, 2.2, 5, 0xa9552f, 10),
    box(0, 1, 5.4, 3, 1.8, 0.4, 0xd8a24c),
  ]);
  t.survivor = mergeGeometries([
    box(0, 0.8, 0, 0.66, 1.1, 0.56, 0xe08a3f),
    box(0, 1.65, 0, 0.55, 0.55, 0.55, 0xdad4b8),
    box(-0.2, 0.24, 0, 0.2, 0.55, 0.25, 0x2c2c24),
    box(0.2, 0.24, 0, 0.2, 0.55, 0.25, 0x2c2c24),
  ]);
  t.wreck = mergeGeometries([
    box(0, 0.5, 0, 4.4, 1, 7, 0x6b6552, 0.4),
    box(1.6, 1.2, 1.4, 1.2, 1.4, 3.2, 0x50503f, 0.4),
    tube(-2.2, 0.9, -1.6, 0.2, 5.2, 0x3a3a30, 5, true),
    box(0, 1.6, -2.6, 2.6, 0.3, 0.3, 0x2c2c24, 0.4),
  ]);
  t.convoy = mergeGeometries([
    box(0, 1, 0, 3.2, 1.8, 7.4, 0xdfe3cb),
    box(0, 2.1, 0, 3, 0.4, 7, 0xc6cbb0),
    box(0, 1.15, -4.1, 2.9, 1.7, 1.6, 0xc6cbb0),
    box(0, 1.5, -4.95, 2.4, 0.9, 0.12, 0x1c3b49),
    tube(-1.55, 0.3, -3.2, 0.6, 0.42, 0x1c1c18, 8, true),
    tube(1.55, 0.3, -3.2, 0.6, 0.42, 0x1c1c18, 8, true),
    tube(-1.55, 0.3, 2.4, 0.6, 0.42, 0x1c1c18, 8, true),
    tube(1.55, 0.3, 2.4, 0.6, 0.42, 0x1c1c18, 8, true),
    box(0, 0.4, -5.05, 1.6, 0.3, 0.2, 0x81edd0),
  ]);
  cache = t;
  return t;
}

// Keeps one mesh per live entity, and a faction pennant above anything owned.
export class EntityView {
  constructor(scene, material) {
    this.scene = scene;
    this.material = material;
    this.meshes = new Map();
    this.group = new THREE.Group();
    scene.add(this.group);
    this.templates = entityTemplates();
    this.flagGeometry = new THREE.BoxGeometry(2.6, 1.3, 0.18);
    this.flagMaterials = new Map();
  }

  flagMaterial(factionId) {
    if (!this.flagMaterials.has(factionId)) {
      const tint = FACTIONS[factionId]?.tint ?? 0xbddfa8;
      this.flagMaterials.set(factionId, new THREE.MeshStandardMaterial({ color: tint, roughness: .7, flatShading: true }));
    }
    return this.flagMaterials.get(factionId);
  }

  // `entities` is any array of { id, type|kind, x, y, z, yaw, dead }. `hidden` keeps a
  // search beacon off the screen until you are close enough to have spotted it.
  sync(entities) {
    const seen = new Set();
    for (const entity of entities) {
      if (entity.dead || entity.aboard || entity.hidden) continue;
      const kind = entity.type ?? entity.kind;
      const template = this.templates[kind];
      if (!template) continue;
      seen.add(entity.id);
      let mesh = this.meshes.get(entity.id);
      if (!mesh) {
        mesh = new THREE.Mesh(template, this.material);
        mesh.castShadow = true; mesh.receiveShadow = true;
        if (entity.faction !== undefined && entity.faction >= 0) {
          const flag = new THREE.Mesh(this.flagGeometry, this.flagMaterial(entity.faction));
          flag.position.set(1.5, 6.4, 0);
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 6.4, 5), this.material);
          pole.position.set(0, 3.2, 0);
          mesh.add(flag, pole);
        }
        this.group.add(mesh);
        this.meshes.set(entity.id, mesh);
      }
      mesh.position.set(entity.x, entity.y ?? 3, entity.z);
      mesh.rotation.y = entity.yaw ?? 0;
    }
    for (const [id, mesh] of this.meshes) {
      if (seen.has(id)) continue;
      mesh.geometry === undefined || mesh.removeFromParent();
      for (const child of mesh.children) child.geometry?.dispose?.();
      this.meshes.delete(id);
    }
  }

  dispose() {
    for (const [, mesh] of this.meshes) mesh.removeFromParent();
    this.meshes.clear();
    this.group.removeFromParent();
    this.flagGeometry.dispose();
    for (const [, m] of this.flagMaterials) m.dispose();
  }
}

// Rounds in the air, as one instanced mesh.
export class TracerView {
  constructor(scene, capacity = 220) {
    this.capacity = capacity;
    this.geometry = new THREE.BoxGeometry(0.16, 0.16, 1);
    this.material = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.dummy = new THREE.Object3D();
    this.colour = new THREE.Color();
  }
  sync(projectiles) {
    let n = 0;
    for (const p of projectiles) {
      if (n >= this.capacity) break;
      this.dummy.position.set(p.x, p.y, p.z);
      this.dummy.rotation.set(0, Math.atan2(p.vx, p.vz), 0);
      const long = p.weapon > 0 ? 3.4 : 2.2;
      this.dummy.scale.set(p.weapon > 0 ? 2.4 : 1, p.weapon > 0 ? 2.4 : 1, long);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(n, this.dummy.matrix);
      this.colour.setHex(p.hostile ? 0xff6b3c : p.weapon > 0 ? 0xffe0a0 : 0xf4f2c4);
      this.mesh.setColorAt(n, this.colour);
      n++;
    }
    const had = this.mesh.count;
    this.mesh.count = n;
    if (n || had) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }
  dispose() { this.mesh.removeFromParent(); this.geometry.dispose(); this.material.dispose(); }
}
