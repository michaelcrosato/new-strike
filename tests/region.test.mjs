// The region layer and its landmarks. These are the two things that make a hundred square
// kilometres feel like somewhere rather than everywhere, so the properties that matter are
// asserted rather than eyeballed: every area exists on every seed, the areas are genuinely
// different from each other, and the borders between them cannot be seen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, WORLD, BIOMES } from '../src/worldgen.js';
import { REGION_ARCHETYPES, createRegions, MOD, BORDER, LATTICE } from '../src/regions.js';
import { LANDMARK_KINDS } from '../src/landmarks.js';

const SEEDS = [20492, 11, 777, 4242, 31337, 8, 99991];
const worlds = new Map();
const at = seed => { if (!worlds.has(seed)) worlds.set(seed, createWorld(seed)); return worlds.get(seed); };

// ---------------------------------------------------------------- layout
test('every seed lays out all nine regions, each archetype exactly once', () => {
  for (const seed of SEEDS) {
    const { regions } = at(seed).regions;
    assert.equal(regions.length, 9, `seed ${seed}`);
    const keys = regions.map(r => r.key).sort();
    assert.deepEqual(keys, REGION_ARCHETYPES.map(a => a.key).sort(),
      `seed ${seed} uses every archetype once and no archetype twice`);
  }
});

test('the middle of the region is always ground somebody would live on', () => {
  // The yard is found by spiralling out from the centre, so an archetype that cannot hold
  // a yard must never hold the middle seat.
  for (const seed of SEEDS) {
    const middle = at(seed).regions.regions.find(r => r.middle);
    assert.ok(middle, `seed ${seed} has a middle seat`);
    assert.ok(middle.archetype.centre,
      `seed ${seed}: middle seat is ${middle.key}, which is not fit to hold the yard`);
  }
});

test('region layout is deterministic in the seed and different between seeds', () => {
  const a = createWorld(4242).regions, b = createWorld(4242).regions, c = createWorld(4243).regions;
  assert.deepEqual(a.regions.map(r => r.key), b.regions.map(r => r.key));
  assert.deepEqual(a.regions.map(r => [r.x, r.z]), b.regions.map(r => [r.x, r.z]));
  const same = a.regions.filter((r, i) => r.key === c.regions[i].key).length;
  assert.ok(same < 9, 'a different seed puts the archetypes somewhere else');
  for (let i = 0; i < 200; i++) {
    const x = (i * 271) % 1900 - 950, z = (i * 131) % 1900 - 950;
    assert.equal(a.regionAt(x, z).key, b.regionAt(x, z).key, 'identity is stable');
  }
});

test('regions hold a fair share of the map, and none of them is a sliver', () => {
  for (const seed of SEEDS) {
    const world = at(seed);
    const counts = new Map();
    let total = 0;
    for (let z = -WORLD.half; z < WORLD.half; z += 29) {
      for (let x = -WORLD.half; x < WORLD.half; x += 29) {
        const key = world.regionAt(x, z).key;
        counts.set(key, (counts.get(key) ?? 0) + 1);
        total++;
      }
    }
    for (const archetype of REGION_ARCHETYPES) {
      const share = 100 * (counts.get(archetype.key) ?? 0) / total;
      assert.ok(share > 3.5, `seed ${seed}: ${archetype.key} holds only ${share.toFixed(1)}%`);
      assert.ok(share < 26, `seed ${seed}: ${archetype.key} holds ${share.toFixed(1)}%, too much of the map`);
    }
  }
});

// ---------------------------------------------------------------- the blend
test('modifiers cross every border smoothly, so no seam is ever visible', () => {
  const world = at(20492);
  // A long diagonal transect crosses several borders. Sampled every world unit, no
  // channel may jump: a discontinuity here is a visible line across the ground.
  let worst = 0, worstChannel = -1;
  let previous = world.regionMod(-980, -980);
  let last = Float32Array.from(previous);
  for (let i = 1; i < 1960; i++) {
    const current = world.regionMod(-980 + i, -980 + i);
    for (let k = 0; k < MOD.COUNT; k++) {
      const jump = Math.abs(current[k] - last[k]);
      if (jump > worst) { worst = jump; worstChannel = k; }
    }
    last = Float32Array.from(current);
  }
  assert.ok(worst < 0.05,
    `largest per-unit modifier jump was ${worst.toFixed(4)} on channel ${worstChannel}; a seam would show`);
});

test('a border is a mixture and the middle of a region is not', () => {
  const world = at(20492);
  const regions = world.regions.regions;
  // Deep inside a region the weight is high; on the line between two seats it collapses.
  const deep = world.regions.regionWeight(regions[0].x, regions[0].z);
  const between = world.regions.regionWeight((regions[0].x + regions[1].x) / 2, (regions[0].z + regions[1].z) / 2);
  assert.ok(deep > 0.8, `a seat should be firmly in its own region, got ${deep.toFixed(2)}`);
  assert.ok(between < deep, 'the ground between two seats is more contested than a seat');
  assert.ok(BORDER > LATTICE, 'the border must be wider than the lattice, or the blend cannot resolve it');
});

test('the modifier lattice stays bounded however far outside the world you ask', () => {
  const world = createWorld(5);
  const before = world.regions.stats();
  for (const [x, z] of [[1e6, -1e6], [-1e7, 1e7], [1e9, 1e9], [5e5, 0]]) {
    const mod = world.regionMod(x, z);
    for (let k = 0; k < MOD.COUNT; k++) assert.ok(Number.isFinite(mod[k]), `channel ${k} finite at ${x},${z}`);
  }
  const after = world.regions.stats();
  assert.ok(after.nodes <= after.lattice, 'the cache cannot exceed the lattice it is clamped to');
  assert.ok(after.nodes - before.nodes < 12, 'a query from a million units out reuses an edge node');
});

// ---------------------------------------------------------------- distinctness
test('the archetypes actually produce different country', () => {
  // The whole point of the layer: if the terrain statistics of the regions were the same,
  // the names would be decoration. Measured per seed and averaged, because any single
  // region can be unlucky in where its seat landed.
  const stats = new Map(REGION_ARCHETYPES.map(a => [a.key, { height: 0, wet: 0, n: 0 }]));
  for (const seed of SEEDS) {
    const world = at(seed);
    for (let z = -WORLD.half; z < WORLD.half; z += 37) {
      for (let x = -WORLD.half; x < WORLD.half; x += 37) {
        const entry = stats.get(world.regionAt(x, z).key);
        const h = world.elevation(x, z);
        entry.height += Math.max(h, 0);
        entry.wet += world.moisture(x, z, h);
        entry.n++;
      }
    }
  }
  const mean = key => ({ height: stats.get(key).height / stats.get(key).n, wet: stats.get(key).wet / stats.get(key).n });
  const alpine = mean('alpine'), pans = mean('saltflat'), delta = mean('delta'), ash = mean('badlands');
  assert.ok(alpine.height > pans.height * 2.5,
    `the spine should tower over the pans: ${alpine.height.toFixed(1)} vs ${pans.height.toFixed(1)}`);
  assert.ok(delta.wet > ash.wet + 0.12,
    `the delta should be far wetter than the ash: ${delta.wet.toFixed(2)} vs ${ash.wet.toFixed(2)}`);
  assert.ok(mean('coast').height < mean('highland').height,
    'the coast should sit lower than the highlands');
});

test('nothing the generator can do pushes terrain through the camera', () => {
  // Archetypes multiply height, so the roof is enforced rather than assumed.
  for (const seed of [...SEEDS, 123, 6060, 4]) {
    const world = createWorld(seed);
    let peak = -Infinity;
    for (let z = -WORLD.half; z < WORLD.half; z += 17) {
      for (let x = -WORLD.half; x < WORLD.half; x += 17) peak = Math.max(peak, world.elevation(x, z));
    }
    assert.ok(peak <= WORLD.ceiling, `seed ${seed} peaked at ${peak.toFixed(1)}, above the ${WORLD.ceiling} roof`);
    assert.ok(peak > 90, `seed ${seed} peaked at only ${peak.toFixed(1)}; the region should have mountains`);
  }
});

test('region identity, settlements and samples all agree about where you are', () => {
  const world = at(777);
  for (const site of world.allSettlements()) {
    assert.equal(site.region, world.regionAt(site.x, site.z).key, `${site.name} agrees with the field`);
    assert.equal(world.sample(site.x, site.z).region, site.region, 'and so does a sample');
  }
});

test('a region with no seed-specific noise still needs its injected fields', () => {
  // The module takes its noise by injection, which is what keeps it free of a cycle with
  // worldgen. A constant field must still produce a usable, finite layer.
  const flat = createRegions({ seed: 1, size: 2000, half: 1000, fbm: () => 0, hash: () => 0.5 });
  assert.equal(flat.regions.length, 9);
  const mod = flat.modifiersAt(0, 0);
  for (let k = 0; k < MOD.COUNT; k++) assert.ok(Number.isFinite(mod[k]), `channel ${k} finite`);
});

// ---------------------------------------------------------------- landmarks
test('every region gets exactly one landmark, on every seed', () => {
  for (const seed of SEEDS) {
    const world = at(seed);
    const marks = world.landmarks();
    assert.equal(marks.length, 9, `seed ${seed} places nine landmarks`);
    assert.deepEqual(marks.map(m => m.key).sort(), Object.values(LANDMARK_KINDS).map(k => k.key).sort(),
      `seed ${seed} places each landmark once`);
    const regions = new Set(marks.map(m => m.regionIndex));
    assert.equal(regions.size, 9, `seed ${seed} spreads them one per region`);
  }
});

test('landmarks are deterministic, inside the world and clear of other places', () => {
  for (const seed of SEEDS) {
    const world = at(seed);
    const again = createWorld(seed);
    assert.deepEqual(world.landmarks().map(m => [m.x, m.z]), again.landmarks().map(m => [m.x, m.z]),
      `seed ${seed} places them in the same spot every time`);
    for (const mark of world.landmarks()) {
      assert.ok(Math.abs(mark.x) < WORLD.half && Math.abs(mark.z) < WORLD.half, `${mark.short} is inside the region`);
      assert.ok(Number.isFinite(mark.height), `${mark.short} has a floor`);
      assert.equal(world.regionAt(mark.x, mark.z).index, mark.regionIndex,
        `${mark.short} stands in the region that owns it`);
      assert.equal(world.settlementsNear(mark.x, mark.z, mark.radius + 40).length, 0,
        `${mark.short} is not built on top of a settlement`);
      const home = world.home;
      assert.ok(Math.hypot(mark.x - home.x, mark.z - home.z) > 150, `${mark.short} is not in the yard`);
    }
  }
});

test('each landmark stands on the ground its kind asks for', () => {
  for (const seed of SEEDS) {
    const world = at(seed);
    for (const mark of world.landmarks()) {
      const kind = Object.values(LANDMARK_KINDS).find(k => k.key === mark.key);
      const h = world.elevation(mark.x, mark.z);
      if (kind.terrain === 'shallow') {
        assert.ok(h <= 1.6, `seed ${seed}: ${mark.short} should be standing in water, found ${h.toFixed(1)}`);
      }
      if (kind.terrain === 'summit') {
        // It is meant to be on the roof of its own region, so nothing nearby towers over it.
        let higher = 0;
        for (let i = 0; i < 40; i++) {
          const a = i / 40 * Math.PI * 2;
          for (const r of [120, 260]) {
            if (world.elevation(mark.x + Math.cos(a) * r, mark.z + Math.sin(a) * r) > h + 14) higher++;
          }
        }
        assert.ok(higher < 12, `seed ${seed}: ${mark.short} is overlooked from ${higher} directions`);
        assert.ok(h > 60, `seed ${seed}: ${mark.short} sits at only ${h.toFixed(1)}`);
      }
      if (kind.terrain === 'flat' || kind.terrain === 'rise') {
        assert.ok(h > 2, `seed ${seed}: ${mark.short} should be on dry land, found ${h.toFixed(1)}`);
        assert.ok(world.slope(mark.x, mark.z, 4) < 0.5, `seed ${seed}: ${mark.short} is on a cliff`);
      }
    }
  }
});

test('a landmark that was built cuts itself a platform, and one that ran aground does not', () => {
  const world = at(20492);
  for (const mark of world.landmarks()) {
    const sites = world.platformsNear(mark.x, mark.z, 120);
    const listed = sites.some(s => s.id === mark.id);
    assert.equal(listed, mark.flatten, `${mark.short} platform listing matches its kind`);
    if (!mark.flatten) continue;
    // On its own platform the ground is level: the mesh, the props and the aircraft all
    // read the same flattened surface.
    const centre = world.groundHeight(mark.x, mark.z, sites);
    for (const [dx, dz] of [[6, 0], [-6, 0], [0, 6], [0, -6]]) {
      const edge = world.groundHeight(mark.x + dx, mark.z + dz, sites);
      assert.ok(Math.abs(edge - centre) < 1.2,
        `${mark.short} is not level: ${centre.toFixed(2)} vs ${edge.toFixed(2)}`);
    }
  }
});

test('landmarks reach the contract board as places worth flying to', () => {
  const world = at(20492);
  const marks = world.landmarks();
  assert.ok(marks.every(m => m.pay >= 1), 'a landmark job pays at least as well as a village one');
  assert.ok(marks.every(m => m.kindName === 'LANDMARK'), 'the board can tell them apart from settlements');
  assert.ok(marks.every(m => BIOMES[m.biome]), 'every landmark knows what it is standing in');
  assert.ok(marks.every(m => m.name && m.blurb && m.short), 'and has something to say about itself');
});

// ---------------------------------------------------------------- place names
test('no two places in the region share a name', () => {
  // Names come from a per-cell hash over a few hundred combinations, so with fifty-odd
  // settlements the same name used to land twice on most seeds. Two IRON SOUNDs on one map
  // reads as a bug rather than as geography.
  for (const seed of SEEDS) {
    const sites = at(seed).allSettlements();
    const names = sites.map(s => s.name);
    const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
    assert.deepEqual(duplicates, [], `seed ${seed} repeats ${duplicates.join(', ')}`);
    assert.equal(new Set(names).size, sites.length);
    // The qualifier is a word, not a number, so the map still reads like a place.
    for (const site of sites) {
      assert.ok(site.name.endsWith(site.baseName), `${site.name} is still ${site.baseName}`);
      assert.match(site.name, /^[A-Z ]+$/, `${site.name} reads as a name`);
    }
  }
});

test('a place keeps its name whichever way you ask for it', () => {
  const world = createWorld(20492);
  const all = new Map(world.allSettlements().map(s => [s.id, s.name]));
  // A fresh world asked only through settlementsNear must agree with the full sweep.
  const fresh = createWorld(20492);
  for (const site of fresh.settlementsNear(0, 0, WORLD.half * 2)) {
    assert.equal(site.name, all.get(site.id), `${site.id} agrees between the two paths`);
  }
  assert.equal(fresh.settlementInCell(...world.allSettlements()[0].id.slice(1).split('_').map(Number))?.name,
    all.get(world.allSettlements()[0].id), 'and with a single cell lookup');
});
