// The yard.
//
// This was nothing: `findHomeSite` picked a flat, dry, unclaimed patch and the game drew
// absolutely nothing on it, so the place the whole outfit is built from was an empty field.
// It is two tents and a scraped circle of dirt — which is the point, because everything here
// is gated on what you have actually paid for, and at the start you have paid for nothing.
//
// Built from the profile, so buying a fitting in the yard screen changes the yard you are
// standing in: the pad gets poured, the drums become a bowser, the tarpaulin becomes a shed,
// the whip aerial becomes a mast. That is the "build your outfit" fantasy made visible
// rather than described.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const scratch = new THREE.Color();

// Ground-level colours, chosen to sit with the campaign's construction-toy palette.
const DIRT = 0x8d7f5c, CANVAS_A = 0xcfc7a4, CANVAS_B = 0x9aa177, ROPE = 0x6b6247,
  METAL = 0x6f7a72, DRUM = 0xa9552f, CONCRETE = 0x9b9d92, PAINT = 0xe8e4cf,
  TARP = 0x5f7a6a, AMBER = 0xf3b25e, DARK = 0x33342c;

export function buildYard(world, profile, material) {
  const base = world.home;
  const parts = [];
  const paint = (geo, hex) => {
    scratch.setHex(hex);
    const count = geo.getAttribute('position').count;
    const colours = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colours[i * 3] = scratch.r; colours[i * 3 + 1] = scratch.g; colours[i * 3 + 2] = scratch.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    parts.push(geo.index ? geo.toNonIndexed() : geo);
  };
  // Everything is placed relative to the yard and sat on the ground under it, because the
  // home site is flat but not perfectly level and nothing here flattens the terrain.
  const groundAt = (dx, dz) => world.groundHeight(base.x + dx, base.z + dz);
  const box = (dx, dy, dz, w, h, d, hex, turn = 0) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    if (turn) geo.rotateY(turn);
    geo.translate(base.x + dx, groundAt(dx, dz) + dy, base.z + dz);
    paint(geo, hex);
  };
  const cyl = (dx, dy, dz, r, h, hex, seg = 8, lie = 0, turn = 0) => {
    const geo = new THREE.CylinderGeometry(r, r, h, seg);
    if (lie) geo.rotateZ(Math.PI / 2);
    if (turn) geo.rotateY(turn);
    geo.translate(base.x + dx, groundAt(dx, dz) + dy, base.z + dz);
    paint(geo, hex);
  };
  // A tent is a prism: a three-sided cylinder on its side is exactly that, and it reads as
  // canvas over a ridge pole from this camera.
  const tent = (dx, dz, length, turn, hex) => {
    const geo = new THREE.CylinderGeometry(2.2, 2.2, length, 3);
    geo.rotateZ(Math.PI / 2);
    geo.rotateX(Math.PI / 6);
    geo.rotateY(turn);
    geo.translate(base.x + dx, groundAt(dx, dz) + 0.95, base.z + dz);
    paint(geo, hex);
    // Guy lines, as two short stakes: enough to say somebody pitched it.
    for (const side of [-1, 1]) {
      box(dx + Math.cos(turn) * side * (length / 2 + 0.9), 0.22, dz - Math.sin(turn) * side * (length / 2 + 0.9),
        0.2, 0.44, 0.2, ROPE);
    }
  };

  const pad = profile?.base?.pad ?? 1;
  const fuel = profile?.base?.fuel ?? 1;
  const workshop = profile?.base?.workshop ?? 1;
  const radio = profile?.base?.radio ?? 1;
  const hangar = profile?.base?.hangar ?? 0;

  // ---- the pad -------------------------------------------------------------
  // Level one is a scrape in the dirt with a ring of stones round it. Two is poured
  // concrete and a windsock. Three adds lights.
  if (pad >= 2) {
    const slab = new THREE.CylinderGeometry(9.5, 9.5, 0.3, 26);
    slab.translate(base.x, groundAt(0, 0) + 0.15, base.z);
    paint(slab, CONCRETE);
    const ring = new THREE.RingGeometry(6.4, 7.2, 30);
    ring.rotateX(-Math.PI / 2);
    ring.translate(base.x, groundAt(0, 0) + 0.32, base.z);
    paint(ring, PAINT);
  } else {
    const scrape = new THREE.CylinderGeometry(9, 9, 0.16, 22);
    scrape.translate(base.x, groundAt(0, 0) + 0.08, base.z);
    paint(scrape, DIRT);
    // A ring of stones, which is what a makeshift helipad actually is.
    for (let i = 0; i < 14; i++) {
      const a = i / 14 * Math.PI * 2;
      const geo = new THREE.OctahedronGeometry(0.42, 0);
      geo.translate(base.x + Math.cos(a) * 7.2, groundAt(Math.cos(a) * 7.2, Math.sin(a) * 7.2) + 0.2,
        base.z + Math.sin(a) * 7.2);
      paint(geo, 0x8a8878);
    }
  }
  if (pad >= 2) {
    // A windsock on a pole, which is the first thing anybody puts up.
    cyl(8.5, 2.2, -6, 0.14, 4.4, METAL, 6);
    const sock = new THREE.CylinderGeometry(0.16, 0.62, 2.2, 7);
    sock.rotateZ(Math.PI / 2.4);
    sock.translate(base.x + 9.6, groundAt(8.5, -6) + 4.2, base.z - 6);
    paint(sock, DRUM);
  }
  if (pad >= 3) {
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2 + 0.4;
      box(Math.cos(a) * 8.6, 0.3, Math.sin(a) * 8.6, 0.42, 0.6, 0.42, AMBER);
    }
  }

  // ---- the tents -----------------------------------------------------------
  // Two of them, always. One is Quill's and has the radio in it; the other is yours. They
  // are pitched across each other, so from the default camera one shows a roof slope and the
  // other its gable end, and neither of them reads as a flat sheet lying on the ground.
  tent(-12, 5.5, 6.4, 0.24, CANVAS_A);
  tent(-13.5, -4.5, 5.2, 1.35, CANVAS_B);
  // A folding table and a crate outside the first, so it reads as lived in.
  box(-7.5, 0.55, 3.2, 2.2, 0.16, 1.3, ROPE, 0.3);
  for (const leg of [[-0.9, -0.5], [0.9, -0.5], [-0.9, 0.5], [0.9, 0.5]]) {
    box(-7.5 + leg[0], 0.28, 3.2 + leg[1], 0.12, 0.56, 0.12, DARK);
  }
  box(-6.2, 0.4, 5.4, 1.5, 0.8, 1.1, 0x8d7b4e, -0.2);

  // ---- fuel ----------------------------------------------------------------
  if (fuel >= 3) {
    box(13, 0.5, 6, 5.5, 1, 3.4, CONCRETE, 0.1);       // the buried tank's cap
    cyl(13, 1.6, 6, 0.4, 2.2, METAL, 8);               // the pump
    box(13, 2.9, 6, 1.2, 0.8, 0.9, DRUM);
  } else if (fuel >= 2) {
    // A leased bowser: a drum on a trailer.
    cyl(13, 1.5, 6, 1.5, 4.6, DRUM, 12, 1, 0.2);
    box(13, 0.42, 6, 5, 0.3, 2.2, DARK, 0.2);
    for (const side of [-1.6, 1.6]) cyl(13 + side, 0.32, 6.9, 0.5, 0.36, DARK, 8, 1);
  } else {
    // Jerry cans and drums, standing in the dirt.
    for (let i = 0; i < 5; i++) {
      const a = i * 1.1;
      cyl(12 + Math.cos(a) * 1.9, 0.8, 5.5 + Math.sin(a) * 1.9, 0.62, 1.6, i % 2 ? DRUM : 0x8a6a3e, 10);
    }
  }

  // ---- the workshop --------------------------------------------------------
  if (workshop >= 3) {
    box(9, 2.6, 12, 9, 5.2, 7, 0xb1a98e, 0.1);          // an enclosed shop
    box(9, 5.5, 12, 9.8, 0.6, 7.8, TARP, 0.1);
  } else if (workshop >= 2) {
    for (const side of [-3.6, 3.6]) {                    // a gantry
      cyl(9 + side, 2.2, 12, 0.24, 4.4, METAL, 6);
    }
    box(9, 4.5, 12, 8.4, 0.4, 0.5, METAL);
    box(9, 3.9, 12, 1.2, 1.4, 1.2, DARK);
  } else {
    // A tarpaulin on four poles, which is where the repairs happen at the start.
    for (const [dx, dz] of [[6, 10], [12, 10], [6, 14], [12, 14]]) cyl(dx, 1.3, dz, 0.16, 2.6, ROPE, 5);
    box(9, 2.7, 12, 7, 0.14, 5, TARP, 0.04);
    box(10.6, 0.34, 13, 1.6, 0.6, 1, 0x6b6552, 0.4);     // a toolbox under it
  }

  // ---- the radio -----------------------------------------------------------
  const mastHeight = radio >= 3 ? 16 : radio >= 2 ? 10 : 5;
  cyl(-12, mastHeight / 2, 5.5, 0.16, mastHeight, METAL, 5);
  box(-12, mastHeight + 0.4, 5.5, 1.8, 0.14, 0.14, METAL);
  if (radio >= 2) box(-12, mastHeight - 1.2, 5.5, 1.2, 0.1, 0.1, METAL);
  box(-12, mastHeight + 0.9, 5.5, 0.3, 0.3, 0.3, AMBER);

  // ---- the hangar ----------------------------------------------------------
  if (hangar >= 1) {
    for (const side of [-7, 7]) {
      for (const along of [-6, 6]) cyl(side, 3.4, 20 + along, 0.3, 6.8, METAL, 6);
    }
    box(0, 6.9, 20, 15.4, 0.4, 13, METAL);
    if (hangar >= 2) {
      box(0, 3.4, 26.4, 15.4, 6.8, 0.4, 0xb1a98e);
      box(-9.4, 5.2, 20, 0.5, 3, 12, METAL);
    }
  }

  const merged = mergeGeometries(parts);
  for (const geo of parts) if (geo !== merged) geo.dispose();
  const mesh = new THREE.Mesh(merged, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return {
    mesh,
    triangles: merged.index ? merged.index.count / 3 : merged.getAttribute('position').count / 3,
    dispose() { merged.dispose(); mesh.removeFromParent(); },
  };
}
