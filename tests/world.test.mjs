// The streamed region is generated, not authored, so the guarantees have to be asserted
// rather than eyeballed: determinism, coverage, no holes, no leaks, bounded work per frame.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, WORLD, BIOMES, FACTIONS, chunkKey, chunkCentre, chunkInWorld } from '../src/worldgen.js';
import { ChunkStreamer, desiredChunks, lodFor, LOD_RINGS } from '../src/streaming.js';

const finite = v => Number.isFinite(v);
const grid = (step, fn) => { for (let z = -WORLD.half; z < WORLD.half; z += step) for (let x = -WORLD.half; x < WORLD.half; x += step) fn(x, z); };

test('the region is the advertised size', () => {
  const km = WORLD.size * WORLD.metresPerUnit / 1000;
  assert.equal(km, 10);
  assert.equal(km * km, 100, '100 square kilometres');
  assert.equal(WORLD.chunksPerAxis * WORLD.chunk, WORLD.size, 'chunks tile the region exactly');
});

test('the world is deterministic in the seed and nothing else', () => {
  const a = createWorld(4242), b = createWorld(4242), c = createWorld(4243);
  let differs = 0;
  for (let i = 0; i < 400; i++) {
    const x = (i * 131) % 1900 - 950, z = (i * 271) % 1900 - 950;
    assert.equal(a.elevation(x, z), b.elevation(x, z), 'elevation is stable');
    assert.equal(a.biomeAt(x, z), b.biomeAt(x, z), 'biome is stable');
    assert.equal(a.factionAt(x, z), b.factionAt(x, z), 'territory is stable');
    if (a.elevation(x, z) !== c.elevation(x, z)) differs++;
  }
  assert.ok(differs > 340, 'a different seed is a different region');
  assert.deepEqual(a.home, b.home, 'the home site is stable');
});

test('every field is finite everywhere, including outside the region', () => {
  grid(97, (x, z) => {
    const s = createWorld(11).sample(x, z);
    for (const key of ['height', 'moisture', 'temperature', 'river', 'slope']) {
      assert.ok(finite(s[key]), `${key} finite at ${x},${z}`);
    }
    assert.ok(s.moisture >= 0 && s.moisture <= 1, 'moisture normalised');
    assert.ok(s.temperature >= 0 && s.temperature <= 1, 'temperature normalised');
    assert.ok(s.height <= WORLD.maxElevation * 1.35, 'elevation bounded');
  });
  const w = createWorld(11);
  for (const [x, z] of [[0, 0], [WORLD.half * 3, 0], [-WORLD.half * 3, WORLD.half * 3], [1e6, -1e6]]) {
    assert.ok(finite(w.elevation(x, z)), `elevation finite far outside at ${x},${z}`);
  }
});

test('all eight biomes are present in useful quantity', () => {
  const w = createWorld(20492);
  const counts = new Map(); let total = 0;
  grid(13, (x, z) => { const b = w.biomeAt(x, z); counts.set(b, (counts.get(b) ?? 0) + 1); total++; });
  for (const info of BIOMES) {
    const share = 100 * (counts.get(info.id) ?? 0) / total;
    assert.ok(share > 1.5, `${info.key} covers ${share.toFixed(1)}%, expected more than 1.5%`);
    assert.ok(share < 45, `${info.key} covers ${share.toFixed(1)}%, expected less than 45%`);
  }
  const land = 100 * (total - (counts.get(0) ?? 0)) / total;
  assert.ok(land > 55 && land < 80, `land is ${land.toFixed(1)}% of the region`);
});

test('the region is framed by water so there is no edge to fly off', () => {
  const w = createWorld(20492);
  for (let i = 0; i < 64; i++) {
    const t = -WORLD.half + i / 64 * WORLD.size;
    for (const [x, z] of [[t, WORLD.half - 4], [t, -WORLD.half + 4], [WORLD.half - 4, t], [-WORLD.half + 4, t]]) {
      assert.ok(w.elevation(x, z) <= WORLD.seaLevel, `water at the boundary ${x.toFixed(0)},${z.toFixed(0)}`);
    }
  }
});

test('territory is claimed on land, unclaimed at sea, and every faction holds ground', () => {
  const w = createWorld(20492);
  const held = new Map();
  grid(17, (x, z) => {
    const f = w.factionAt(x, z), wet = w.elevation(x, z) <= WORLD.seaLevel;
    if (wet) assert.equal(f, -1, 'open water belongs to nobody');
    else { assert.ok(f >= 0 && f < FACTIONS.length, 'valid faction'); held.set(f, (held.get(f) ?? 0) + 1); }
  });
  for (const f of FACTIONS) assert.ok((held.get(f.id) ?? 0) > 20, `${f.short} holds territory`);
});

test('settlements are deterministic, on buildable ground and inside the region', () => {
  const w = createWorld(20492);
  const sites = w.allSettlements();
  assert.ok(sites.length >= 30 && sites.length <= 90, `${sites.length} settlements`);
  const ids = new Set();
  for (const site of sites) {
    assert.ok(!ids.has(site.id), 'unique id'); ids.add(site.id);
    assert.ok(Math.abs(site.x) < WORLD.half && Math.abs(site.z) < WORLD.half, `${site.name} inside the region`);
    assert.ok(w.elevation(site.x, site.z) > WORLD.seaLevel, `${site.name} is not at sea`);
    assert.ok(w.slope(site.x, site.z) < 0.6, `${site.name} is on ground you can build on`);
    assert.ok(site.faction >= 0, `${site.name} has an owner`);
    assert.ok(site.name.length > 3 && site.radius > 5, `${site.name} is described`);
  }
  const again = createWorld(20492).allSettlements();
  assert.deepEqual(again.map(s => s.id + s.name + s.kind), sites.map(s => s.id + s.name + s.kind));
  // Every kind should appear somewhere in the region.
  const kinds = new Set(sites.map(s => s.kind));
  for (const kind of ['village', 'town', 'camp', 'outpost']) assert.ok(kinds.has(kind), `${kind} exists`);
});

test('settlementsNear agrees with the full sweep', () => {
  const w = createWorld(777);
  const all = w.allSettlements();
  const centre = all[3];
  const near = w.settlementsNear(centre.x, centre.z, 300);
  const expected = all.filter(s => Math.hypot(s.x - centre.x, s.z - centre.z) <= 300);
  assert.deepEqual(near.map(s => s.id).sort(), expected.map(s => s.id).sort());
});

test('the home yard is flat, dry, unaligned and clear of other settlements', () => {
  for (const seed of [1, 20492, 99999, 31337]) {
    const w = createWorld(seed), home = w.home;
    assert.ok(w.elevation(home.x, home.z) > WORLD.seaLevel, `seed ${seed}: home is on land`);
    assert.ok(w.slope(home.x, home.z, 4) < 0.2, `seed ${seed}: home is flat`);
    assert.notEqual(home.biome, 0, `seed ${seed}: home is not at sea`);
    assert.notEqual(home.biome, 7, `seed ${seed}: home is not on a glacier`);
    assert.equal(w.settlementsNear(home.x, home.z, 110).length, 0, `seed ${seed}: home has its own ground`);
  }
});

test('chunk scatter is deterministic, dry and thinned by detail level', () => {
  const w = createWorld(20492);
  const full = w.propsInChunk(2, -3, 0);
  assert.deepEqual(w.propsInChunk(2, -3, 0), full, 'same chunk, same props');
  for (const prop of full) {
    assert.ok(w.elevation(prop.x, prop.z) > 0, 'props stay out of the water');
    assert.ok(BIOMES[prop.biome].props.includes(prop.prop), 'props suit their biome');
    assert.ok(prop.scale > 0.5 && prop.scale < 1.6, 'sane scale');
  }
  const coarse = w.propsInChunk(2, -3, 2);
  assert.ok(coarse.length <= full.length, 'coarser detail never adds props');
});

// ---------------------------------------------------------------- streaming
test('detail falls off with distance and stops at the last ring', () => {
  assert.equal(lodFor(0), 0);
  assert.equal(lodFor(LOD_RINGS[0] - 0.01), 0);
  assert.equal(lodFor(LOD_RINGS[0] + 0.01), 1);
  assert.equal(lodFor(LOD_RINGS.at(-1) + 0.01), -1, 'beyond the last ring nothing is resident');
  let previous = 0;
  for (let d = 0; d < LOD_RINGS.at(-1); d += 0.1) {
    const lod = lodFor(d);
    assert.ok(lod >= previous, 'detail never improves with distance');
    previous = lod;
  }
});

test('the wanted set is nearest-first and never leaves the region', () => {
  const list = desiredChunks(0, 0);
  assert.ok(list.length > 20, `${list.length} chunks wanted`);
  for (let i = 1; i < list.length; i++) assert.ok(list[i].distance >= list[i - 1].distance, 'sorted by distance');
  for (const entry of list) assert.ok(chunkInWorld(entry.cx, entry.cz), 'inside the region');
  const keys = new Set(list.map(e => e.key));
  assert.equal(keys.size, list.length, 'no duplicates');
  // At a corner of the region the set is clipped, not wrapped.
  const corner = desiredChunks(WORLD.half - 10, WORLD.half - 10);
  assert.ok(corner.length < list.length, 'the set clips at the boundary');
});

function trackingStreamer(options = {}) {
  const builds = [], disposals = [], live = new Set();
  const streamer = new ChunkStreamer({
    build(cx, cz, lod) {
      const id = `${cx}:${cz}@${lod}`;
      assert.ok(!live.has(id), `built ${id} twice without releasing it`);
      live.add(id); builds.push(id);
      return { id, cx, cz, lod };
    },
    dispose(payload) {
      assert.ok(live.has(payload.id), `released ${payload.id} that was not live`);
      live.delete(payload.id); disposals.push(payload.id);
    },
    ...options,
  });
  return { streamer, builds, disposals, live };
}

test('a streamer respects its per-frame budget', () => {
  const { streamer } = trackingStreamer({ budget: 3 });
  const first = streamer.update(0, 0);
  assert.equal(first.built.length, 3, 'never more than the budget');
  assert.ok(first.pending > 0, 'the rest waits its turn');
  const wanted = desiredChunks(0, 0).length;
  let frames = 1;
  while (streamer.update(0, 0).pending > 0 && frames < 500) frames++;
  assert.equal(streamer.resident.size, wanted, 'it catches up');
  assert.ok(frames <= Math.ceil(wanted / 3) + 1, `caught up in ${frames} frames`);
});

test('nothing is built twice and everything is released exactly once', () => {
  const { streamer, builds, disposals, live } = trackingStreamer({ budget: 8 });
  streamer.settle(0, 0);
  const resident = streamer.resident.size;
  assert.equal(live.size, resident);
  // Fly two kilometres across the region, settling as we go.
  for (let x = 0; x <= 400; x += 25) streamer.settle(x, x * 0.4);
  assert.equal(live.size, streamer.resident.size, 'live payloads match the resident set');
  const counts = new Map();
  for (const id of builds) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const [id, n] of counts) {
    const released = disposals.filter(d => d === id).length;
    assert.ok(released === n || released === n - 1, `${id}: built ${n}, released ${released}`);
  }
  streamer.clear();
  assert.equal(live.size, 0, 'clear releases everything');
  assert.equal(streamer.resident.size, 0);
});

test('changing detail rebuilds a chunk at its new detail', () => {
  const { streamer, builds } = trackingStreamer({ budget: 64 });
  streamer.settle(0, 0);
  const far = WORLD.chunk * 3;
  const before = streamer.lodAt(0, 0);
  streamer.settle(far, 0);
  const after = streamer.lodAt(0, 0);
  assert.notEqual(before, after, 'the chunk behind us drops detail');
  assert.ok(builds.includes(`0:0@${after}`), 'it was rebuilt coarser');
  assert.ok(streamer.stats.rebuiltForLod > 0);
});

test('residency stays bounded while flying the length of the region', () => {
  const { streamer, live } = trackingStreamer({ budget: 6 });
  let peak = 0;
  for (let x = -WORLD.half; x <= WORLD.half; x += 60) {
    streamer.update(x, Math.sin(x / 300) * 400);
    peak = Math.max(peak, streamer.resident.size);
    assert.equal(live.size, streamer.resident.size, 'no leak mid-flight');
  }
  assert.ok(peak < 140, `peak residency ${peak} chunks`);
  assert.ok(streamer.stats.built > 100, 'the world really did stream');
});

test('a chunk covers the ground it claims', () => {
  for (const [cx, cz] of [[0, 0], [-4, 7], [15, -15]]) {
    const centre = chunkCentre(cx, cz);
    assert.equal(Math.floor(centre.x / WORLD.chunk), cx);
    assert.equal(Math.floor(centre.z / WORLD.chunk), cz);
    assert.equal(chunkKey(cx, cz), `${cx}:${cz}`);
  }
});

test('sampling the fields is fast enough to stream', () => {
  const w = createWorld(5);
  const samples = 20000, t0 = performance.now();
  for (let i = 0; i < samples; i++) w.elevation((i * 13) % 1900 - 950, (i * 29) % 1900 - 950);
  const perSample = (performance.now() - t0) / samples * 1000;
  // A full-detail chunk is a 33 x 33 grid; this keeps that under a couple of milliseconds.
  assert.ok(perSample < 4, `${perSample.toFixed(2)} us per height sample`);
});
