// Macro-regions: the layer that makes 100 km² feel like nine places instead of one.
//
// The biome classifier works on purely local fields, so on its own the region comes out as
// an even wash of the same terrain from corner to corner — you can fly ten kilometres and
// never feel you have gone anywhere. Regions sit above the fields: nine named areas, each
// with an archetype that bends the terrain underneath it (wetter, higher, more ridged,
// emptier, busier) so crossing a border is a change of character rather than a change of
// shrub.
//
// Two properties matter and both are enforced here rather than hoped for:
//
//   - identity is deterministic in the seed alone, so the map screen, the contract
//     generator and the mesh builder all agree on where you are;
//   - the modifiers blend across borders, so no seam is ever visible on the ground.
//
// No THREE, no DOM, and deliberately no import of the field code that consumes this: the
// noise primitives are injected. That keeps the module a pure function of its inputs, keeps
// it testable on its own, and avoids a cycle with worldgen.

// Modifier channels, as indices into a flat array. A plain object per sample would be
// correct and unusably slow: these are read on the terrain hot path, millions of times
// while streaming, so the blended result is a Float32Array written into a scratch buffer.
export const MOD = {
  land: 0,          // added to the continental sum: less land means more coast
  relief: 1,        // multiplies the relief term: flat pans versus broken ground
  lift: 2,          // multiplies final height: how tall the region stands
  ridge: 3,         // biases the mountain mask: spines versus rolling hills
  moisture: 4,      // additive
  temperature: 5,   // additive
  river: 6,         // multiplies river strength
  scatter: 7,       // multiplies prop density
  settle: 8,        // multiplies the chance a cell holds a settlement
  threat: 9,        // additive threat bias for garrisons and contract risk
  COUNT: 10,
};

const mods = (o = {}) => {
  const a = new Float32Array(MOD.COUNT);
  a[MOD.land] = o.land ?? 0;
  a[MOD.relief] = o.relief ?? 1;
  a[MOD.lift] = o.lift ?? 1;
  a[MOD.ridge] = o.ridge ?? 0;
  a[MOD.moisture] = o.moisture ?? 0;
  a[MOD.temperature] = o.temperature ?? 0;
  a[MOD.river] = o.river ?? 1;
  a[MOD.scatter] = o.scatter ?? 1;
  a[MOD.settle] = o.settle ?? 1;
  a[MOD.threat] = o.threat ?? 0;
  return a;
};

// Nine archetypes for nine seats, so every area in the region is a different place. The
// seed decides which archetype lands where, not which archetypes exist — the names stay
// evocative and the layout still changes completely from seed to seed.
//
// `centre` marks the four that are allowed to hold the middle cell, which is where the
// player's yard ends up. A glacier or a salt pan in the middle would leave the yard on
// ground nobody would choose to live on.
export const REGION_ARCHETYPES = [
  { key: 'delta', name: 'THE GREEN DELTA', short: 'DELTA', centre: true,
    character: 'Braided water and standing reed. Everything here is one metre above the flood.',
    tint: 0x6f9f74, colour: '#6f9f74',
    mod: mods({ land: -0.04, relief: 0.34, lift: 0.5, ridge: -0.30, moisture: 0.26, temperature: 0.05, river: 1.5, scatter: 1.25, settle: 1.15, threat: 0 }) },
  { key: 'savanna', name: 'THE LONG SAVANNA', short: 'SAVANNA', centre: true,
    character: 'Grass to the horizon and nothing to hide behind. You will be seen coming.',
    tint: 0xbfc077, colour: '#bfc077',
    mod: mods({ land: 0.05, relief: 0.52, lift: 0.78, ridge: -0.22, moisture: -0.04, temperature: 0.08, river: 0.7, scatter: 0.9, settle: 1.1, threat: 0 }) },
  { key: 'badlands', name: 'THE ASH REACH', short: 'ASH REACH', centre: false,
    character: 'Burnt rock cut into steps. Nobody farms it, so everyone fights over the road.',
    tint: 0xc08a54, colour: '#c08a54',
    mod: mods({ land: 0.06, relief: 1.16, lift: 1.0, ridge: 0.14, moisture: -0.22, temperature: 0.06, river: 0.4, scatter: 0.55, settle: 0.8, threat: 1 }) },
  { key: 'highland', name: 'THE PINE HIGHLANDS', short: 'HIGHLANDS', centre: true,
    character: 'Cold ridges under black timber. Good cover, bad weather, worse roads.',
    tint: 0x6b8a6e, colour: '#6b8a6e',
    mod: mods({ land: 0.07, relief: 1.12, lift: 1.22, ridge: 0.22, moisture: 0.08, temperature: -0.14, river: 1.1, scatter: 1.2, settle: 0.85, threat: 0 }) },
  { key: 'alpine', name: 'THE WHITE SPINE', short: 'WHITE SPINE', centre: false,
    character: 'The roof of the region. Thin air, no landing ground, and a view of everything.',
    tint: 0xb9c2ba, colour: '#b9c2ba',
    mod: mods({ land: 0.09, relief: 1.34, lift: 1.62, ridge: 0.44, moisture: -0.02, temperature: -0.30, river: 1.0, scatter: 0.5, settle: 0.45, threat: 0 }) },
  { key: 'coast', name: 'THE BROKEN COAST', short: 'COAST', centre: false,
    character: 'Headlands, sand bars and half-sunk islands. Everything moves by boat.',
    tint: 0x79aab0, colour: '#79aab0',
    mod: mods({ land: -0.13, relief: 0.62, lift: 0.56, ridge: -0.26, moisture: 0.18, temperature: 0.05, river: 0.9, scatter: 0.85, settle: 1.0, threat: 0 }) },
  { key: 'jungle', name: 'THE FEVER BASIN', short: 'FEVER BASIN', centre: false,
    character: 'Canopy so thick the rivers are rumours. Hot, loud, and full of people who like it that way.',
    tint: 0x4f7a3f, colour: '#4f7a3f',
    mod: mods({ land: 0.03, relief: 0.86, lift: 0.94, ridge: -0.08, moisture: 0.30, temperature: 0.16, river: 1.3, scatter: 1.45, settle: 0.95, threat: 1 }) },
  { key: 'saltflat', name: 'THE SALT PANS', short: 'SALT PANS', centre: false,
    character: 'A dead white table. Flat enough to land anywhere, bright enough to blind you.',
    tint: 0xd8d2b0, colour: '#d8d2b0',
    mod: mods({ land: -0.02, relief: 0.16, lift: 0.34, ridge: -0.42, moisture: -0.26, temperature: 0.12, river: 0.25, scatter: 0.3, settle: 0.7, threat: 1 }) },
  { key: 'basin', name: 'THE KETTLE', short: 'THE KETTLE', centre: true,
    character: 'A wide bowl of worked ground. The most people, the most work, the most trouble.',
    tint: 0x9fae82, colour: '#9fae82',
    mod: mods({ land: 0.04, relief: 0.58, lift: 0.68, ridge: -0.18, moisture: 0.10, temperature: 0.02, river: 1.2, scatter: 1.0, settle: 1.35, threat: 0 }) },
];
export const regionArchetype = key => REGION_ARCHETYPES.find(a => a.key === key);

// How wide a border is, in world units. Modifiers cross it as a soft mixture, so a
// highland shoulder really does come down into the savanna instead of stopping at a line.
export const BORDER = 150;
// Modifiers are sampled on this lattice and interpolated between nodes. Region identity
// changes on a kilometre scale, so resolving it per vertex is waste; resolving it every
// 25 units and interpolating is indistinguishable and roughly forty times cheaper.
export const LATTICE = 25;

/**
 * Builds the region layer for one seed.
 *
 * `noise` is the injected field pair from the caller: fbm(x, z, seed, octaves) for the
 * border warp and hash(a, b, seed) in [0,1) for the layout. Both are only ever called
 * while building lattice nodes, never per vertex.
 */
export function createRegions({ seed = 0, size = 2000, half = 1000, fbm, hash } = {}) {
  const s = seed | 0;

  // Nine seats on a jittered three-by-three grid. A grid rather than free placement
  // because nine random seats in a square routinely leave two of them a few hundred
  // metres apart, and a region you can cross in ten seconds is not a place.
  const cell = size / 3;
  const seats = [];
  for (let gz = 0; gz < 3; gz++) {
    for (let gx = 0; gx < 3; gx++) {
      const jx = hash(gx * 131 + 7, gz * 17, s + 6101), jz = hash(gx * 29, gz * 211 + 3, s + 6107);
      seats.push({
        index: seats.length,
        gx, gz,
        middle: gx === 1 && gz === 1,
        x: -half + (gx + 0.22 + jx * 0.56) * cell,
        z: -half + (gz + 0.22 + jz * 0.56) * cell,
      });
    }
  }

  // Deterministic shuffle, then the middle seat takes the first archetype that is allowed
  // to hold it. Everything else falls where the shuffle put it.
  const order = REGION_ARCHETYPES.map((a, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(hash(i * 7919, 13, s + 6113) * (i + 1)) % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const middleSeat = seats.findIndex(seat => seat.middle);
  if (!REGION_ARCHETYPES[order[middleSeat]].centre) {
    const alt = order.findIndex(i => REGION_ARCHETYPES[i].centre);
    [order[middleSeat], order[alt]] = [order[alt], order[middleSeat]];
  }

  const regions = seats.map((seat, i) => {
    const archetype = REGION_ARCHETYPES[order[i]];
    return { ...seat, key: archetype.key, name: archetype.name, short: archetype.short,
      character: archetype.character, tint: archetype.tint, colour: archetype.colour,
      archetype, mod: archetype.mod };
  });

  // --- the border warp ----------------------------------------------------
  // Straight Voronoi borders read as geometry from the air. Warping the query point before
  // measuring makes them wander the way a watershed does.
  const warp = 210;
  function warped(x, z) {
    const nx = x / size, nz = z / size;
    return [
      x + fbm(nx * 2.6, nz * 2.6, s + 6131, 2) * warp,
      z + fbm(nx * 2.6 + 19, nz * 2.6 - 7, s + 6137, 2) * warp,
    ];
  }

  // --- identity -----------------------------------------------------------
  // Exact, unblended: which region is this, for the map, the HUD and contract flavour.
  function regionAt(x, z) {
    const [wx, wz] = warped(x, z);
    let best = regions[0], bestD = Infinity;
    for (const region of regions) {
      const d = (wx - region.x) ** 2 + (wz - region.z) ** 2;
      if (d < bestD) { bestD = d; best = region; }
    }
    return best;
  }
  const regionIndexAt = (x, z) => regionAt(x, z).index;

  // --- blended modifiers --------------------------------------------------
  // The lattice is bounded, so it is one flat array rather than a Map of small arrays: the
  // terrain builder asks for modifiers on every vertex of every chunk, and four Map lookups
  // plus a node allocation per vertex measured three times the cost of the whole rest of
  // the height field. Indices are clamped to the region plus a margin, so a query from a
  // million units out (the tests do exactly that) reuses an edge node instead of growing
  // anything.
  const limit = Math.ceil((half + LATTICE * 4) / LATTICE);
  const span = limit * 2 + 1;
  const grid = new Float32Array(span * span * MOD.COUNT);
  const built = new Uint8Array(span * span);
  let nodeCount = 0;
  const distances = new Float64Array(regions.length);

  function fillNode(cell, ix, iz) {
    const [wx, wz] = warped(ix * LATTICE, iz * LATTICE);
    let nearest = Infinity;
    for (let i = 0; i < regions.length; i++) {
      const d = Math.hypot(wx - regions[i].x, wz - regions[i].z);
      distances[i] = d;
      if (d < nearest) nearest = d;
    }
    // A softmax over the seats by warped distance: every region contributes, the nearest
    // dominates, and the fall-off length is BORDER. That is what removes the seam.
    const base = cell * MOD.COUNT;
    let total = 0;
    for (let i = 0; i < regions.length; i++) {
      const w = Math.exp(-(distances[i] - nearest) / BORDER);
      if (w < 1e-4) continue;
      total += w;
      const m = regions[i].mod;
      for (let k = 0; k < MOD.COUNT; k++) grid[base + k] += m[k] * w;
    }
    for (let k = 0; k < MOD.COUNT; k++) grid[base + k] /= total;
    built[cell] = 1;
    nodeCount++;
  }

  function nodeBase(ix, iz) {
    const cx = (ix < -limit ? -limit : ix > limit ? limit : ix) + limit;
    const cz = (iz < -limit ? -limit : iz > limit ? limit : iz) + limit;
    const cell = cz * span + cx;
    if (!built[cell]) fillNode(cell, cx - limit, cz - limit);
    return cell * MOD.COUNT;
  }

  // One scratch buffer, and a one-entry memo. Callers on the hot path ask for the same
  // point several times over (elevation asks, then so do the continental shape, the
  // mountain mask and the river field it consults, all at the same coordinates), so the
  // memo turns four blends into one.
  const scratch = new Float32Array(MOD.COUNT);
  let lastX = NaN, lastZ = NaN;

  /**
   * Blended modifiers at a point. Returns a shared buffer: read the channels you need into
   * locals before calling any other field, or take a copy with `copyModifiers`.
   */
  function modifiersAt(x, z) {
    if (x === lastX && z === lastZ) return scratch;
    const fx = x / LATTICE, fz = z / LATTICE;
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const b00 = nodeBase(ix, iz), b10 = nodeBase(ix + 1, iz);
    const b01 = nodeBase(ix, iz + 1), b11 = nodeBase(ix + 1, iz + 1);
    for (let k = 0; k < MOD.COUNT; k++) {
      const a = grid[b00 + k] + (grid[b10 + k] - grid[b00 + k]) * tx;
      const b = grid[b01 + k] + (grid[b11 + k] - grid[b01 + k]) * tx;
      scratch[k] = a + (b - a) * tz;
    }
    lastX = x; lastZ = z;
    return scratch;
  }
  const copyModifiers = (x, z) => Float32Array.from(modifiersAt(x, z));

  // How much of a point belongs to its own region: 1 deep inside, falling towards 0.5 at
  // a two-way border. Used to keep landmarks and region labels off the borders.
  function regionWeight(x, z) {
    const [wx, wz] = warped(x, z);
    const sorted = regions.map(r => Math.hypot(wx - r.x, wz - r.z)).sort((a, b) => a - b);
    return 1 - Math.exp(-(sorted[1] - sorted[0]) / BORDER);
  }

  return {
    seed: s, regions, seats: regions, count: regions.length,
    regionAt, regionIndexAt, modifiersAt, copyModifiers, regionWeight,
    byKey: key => regions.find(r => r.key === key),
    stats: () => ({ nodes: nodeCount, lattice: span * span, bytes: grid.byteLength }),
  };
}
