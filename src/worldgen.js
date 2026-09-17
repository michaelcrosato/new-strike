// Procedural world for MERCENARY STRIKE.
//
// Everything here is a pure function of (seed, x, z). Nothing is stored, nothing is built:
// the streamer, the map screen, the contract generator and the simulation all ask the same
// questions of the same fields and get the same answers. That is what makes a 100 km² world
// affordable — we only ever realise the part you can see.
//
// One world unit is five metres, so the region is 2000 x 2000 units = 10 x 10 km = 100 km².

export const WORLD = {
  size: 2000,            // units across, centred on the origin
  half: 1000,
  metresPerUnit: 5,
  chunk: 125,            // 625 m of world per chunk
  chunksPerAxis: 16,     // 16 x 16 = 256 chunks
  cell: 170,             // settlement cell, 850 m
  seaLevel: 0,
  maxElevation: 130,
};

// ---------------------------------------------------------------- noise
// Integer hash, 32-bit throughout so every platform agrees on the world.
function hashInt(ix, iz, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
function hash2(ix, iz, seed) { return hashInt(ix, iz, seed) / 4294967296; }
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);

// Sixteen fixed gradients, picked by hash. A table instead of a sine per lattice corner:
// the fields are sampled millions of times while streaming, so the trigonometry mattered.
const GRAD = new Float32Array(32);
for (let i = 0; i < 16; i++) {
  const a = i / 16 * Math.PI * 2;
  GRAD[i * 2] = Math.cos(a); GRAD[i * 2 + 1] = Math.sin(a);
}

// Gradient noise in [-1, 1].
function gradientNoise(x, z, seed) {
  const x0 = Math.floor(x), z0 = Math.floor(z);
  const fx = x - x0, fz = z - z0;
  const u = fade(fx), v = fade(fz);
  const g00 = (hashInt(x0, z0, seed) & 15) * 2;
  const g10 = (hashInt(x0 + 1, z0, seed) & 15) * 2;
  const g01 = (hashInt(x0, z0 + 1, seed) & 15) * 2;
  const g11 = (hashInt(x0 + 1, z0 + 1, seed) & 15) * 2;
  const n00 = GRAD[g00] * fx + GRAD[g00 + 1] * fz;
  const n10 = GRAD[g10] * (fx - 1) + GRAD[g10 + 1] * fz;
  const n01 = GRAD[g01] * fx + GRAD[g01 + 1] * (fz - 1);
  const n11 = GRAD[g11] * (fx - 1) + GRAD[g11 + 1] * (fz - 1);
  const a = n00 + u * (n10 - n00), b = n01 + u * (n11 - n01);
  return (a + v * (b - a)) * 2;
}

function fbm(x, z, seed, octaves = 4, frequency = 1, lacunarity = 2.02, gain = 0.5) {
  let sum = 0, amplitude = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += gradientNoise(x * frequency, z * frequency, seed + o * 1013) * amplitude;
    norm += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return sum / norm;
}

// Ridged noise: sharp crests, good for mountain spines and river courses.
function ridged(x, z, seed, octaves = 4, frequency = 1) {
  let sum = 0, amplitude = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(gradientNoise(x * frequency, z * frequency, seed + o * 7717));
    sum += n * n * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum / norm;
}

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const smoothstep = (a, b, t) => { const k = clamp((t - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- biomes
export const BIOMES = [
  { id: 0, key: 'ocean', name: 'OPEN WATER', water: true,
    ground: 0x12595f, groundAlt: 0x157078, cliff: 0x4a5c58, sand: 0xb6ad84,
    scatter: 0, props: [], colour: '#13565c' },
  { id: 1, key: 'shore', name: 'SHORELINE',
    ground: 0xc0b487, groundAlt: 0xb0a67f, cliff: 0x8a8365, sand: 0xc7bb8d,
    scatter: 0.10, props: ['palm', 'rock'], colour: '#bdb184' },
  { id: 2, key: 'wetland', name: 'DELTA WETLAND',
    ground: 0x4c6b4a, groundAlt: 0x5d7b49, cliff: 0x5f6b52, sand: 0x9aa177,
    scatter: 0.34, props: ['mangrove', 'reed', 'palm'], colour: '#4f6d4b' },
  { id: 3, key: 'jungle', name: 'HIGHLAND JUNGLE',
    ground: 0x3f6438, groundAlt: 0x4c7541, cliff: 0x6a6b4c, sand: 0x93966c,
    scatter: 0.52, props: ['jungle', 'palm', 'bush'], colour: '#416639' },
  { id: 4, key: 'savanna', name: 'SAVANNA',
    ground: 0x7d8a4e, groundAlt: 0x8d9857, cliff: 0x8a8158, sand: 0xbcae7e,
    scatter: 0.20, props: ['acacia', 'bush', 'rock'], colour: '#7f8c50' },
  { id: 5, key: 'badlands', name: 'BADLANDS',
    ground: 0xa8834f, groundAlt: 0xb89457, cliff: 0x8f6f45, sand: 0xc7a86f,
    scatter: 0.07, props: ['rock', 'bush'], colour: '#a8834f' },
  { id: 6, key: 'highland', name: 'PINE HIGHLAND',
    ground: 0x51694f, groundAlt: 0x5c7457, cliff: 0x6e6f63, sand: 0x8e8b6f,
    scatter: 0.40, props: ['pine', 'rock'], colour: '#52684e' },
  { id: 7, key: 'alpine', name: 'ALPINE RIDGE',
    ground: 0x9ea79f, groundAlt: 0xb0b8ae, cliff: 0x6d6f66, sand: 0x8d9189,
    scatter: 0.08, props: ['pine', 'rock'], colour: '#a3aca4' },
];
export const biome = id => BIOMES[id];

// Tuned against the measured distribution of the fields below, to keep all eight biomes
// present in useful quantity. Changing one of these reshapes the whole region, so the
// campaign-scale test asserts the resulting coverage stays inside sane bounds.
export const SHAPE = {
  landBias: 0.42,        // higher pushes the coastline inland
  landGain: 2.3,
  reliefBase: 0.22,
  reliefGain: 0.86,
  elevationCurve: 0.7,   // lower lifts the middle of the continent
};

export const BANDS = {
  shoreHeight: 3.4,
  wetMoisture: 0.72,
  lowlandHeight: 12,
  highlandHeight: 40,
  alpineHeight: 68,
  coldTemperature: 0.34,
  aridMoisture: 0.46,
  humidMoisture: 0.6,
};

// ---------------------------------------------------------------- factions
export const FACTIONS = [
  { id: 0, key: 'freehold', name: 'THE FREEHOLD', short: 'FREEHOLD', tint: 0xbddfa8, colour: '#bddfa8',
    blurb: 'Village councils and fishing co-ops. They pay badly and remember everything.' },
  { id: 1, key: 'cordon', name: 'CORDON AUTHORITY', short: 'CORDON', tint: 0x9fc4e0, colour: '#9fc4e0',
    blurb: 'What is left of the state. Checkpoints, permits, and a long memory for unpaid fines.' },
  { id: 2, key: 'ashwind', name: 'ASHWIND COLUMN', short: 'ASHWIND', tint: 0xe08a63, colour: '#e08a63',
    blurb: 'Militia with a cause and no logistics. Pays in cash and favours.' },
  { id: 3, key: 'meridian', name: 'MERIDIAN COMBINE', short: 'MERIDIAN', tint: 0xe3cf7a, colour: '#e3cf7a',
    blurb: 'Extraction contracts, private security, excellent aircraft parts.' },
  { id: 4, key: 'saltroad', name: 'THE SALT ROAD', short: 'SALT ROAD', tint: 0xc79ad8, colour: '#c79ad8',
    blurb: 'Smugglers. They never ask what is in the crate and expect the same courtesy.' },
];
export const faction = id => FACTIONS[id];

export const SETTLEMENT_KINDS = [
  { key: 'village', name: 'VILLAGE', weight: 30, pads: 1, threat: 0, size: [14, 22] },
  { key: 'town', name: 'TOWN', weight: 14, pads: 1, threat: 1, size: [22, 34] },
  { key: 'airfield', name: 'AIRFIELD', weight: 9, pads: 2, threat: 2, size: [26, 38] },
  { key: 'refinery', name: 'REFINERY', weight: 10, pads: 1, threat: 2, size: [20, 30] },
  { key: 'port', name: 'PORT', weight: 8, pads: 1, threat: 1, size: [22, 32], coastal: true },
  { key: 'camp', name: 'CAMP', weight: 16, pads: 0, threat: 2, size: [10, 16] },
  { key: 'outpost', name: 'OUTPOST', weight: 13, pads: 0, threat: 3, size: [10, 15] },
];

const NAME_HEAD = ['TERN', 'ASH', 'SALT', 'IRON', 'KETTLE', 'GLASS', 'CINDER', 'MARROW', 'HOLLOW', 'BASALT',
  'REED', 'COBALT', 'MERIDIAN', 'LANTERN', 'THORN', 'VESPER', 'HALLOW', 'PALE', 'BRINE', 'EMBER'];
const NAME_TAIL = ['DELTA', 'CROSS', 'REACH', 'LANDING', 'STATION', 'BASIN', 'FLATS', 'GATE', 'HARBOUR',
  'RIDGE', 'FIELD', 'SOUND', 'POINT', 'WELL', 'CUT', 'HOLD', 'MOUTH', 'SPUR', 'ROW', 'YARD'];

// ---------------------------------------------------------------- the world
export function createWorld(seed = 20492) {
  const s = seed | 0;
  // Faction seats, spread deterministically around the region. Territory is the nearest
  // seat, warped by noise so borders are ragged rather than geometric.
  const seats = FACTIONS.map((f, i) => {
    const a = (hash2(i * 77, 13, s) + i / FACTIONS.length) * Math.PI * 2;
    const r = (0.30 + hash2(i, 91, s) * 0.52) * WORLD.half;
    return { id: f.id, x: Math.cos(a) * r, z: Math.sin(a) * r };
  });

  // --- scalar fields -------------------------------------------------------
  // Continental shape: noise minus a soft radial falloff, so the region is one landmass
  // ringed by water and the player can never fly off an edge into nothing.
  function continent(x, z) {
    const nx = x / WORLD.size, nz = z / WORLD.size;
    const base = fbm(nx * 2.1, nz * 2.1, s + 11, 5, 1, 2.03, 0.52) * 0.5 + 0.5;
    const lobes = fbm(nx * 4.7, nz * 4.7, s + 29, 3, 1, 2.1, 0.5) * 0.22;
    // A frame of ocean rather than a radial island: distance to the nearest edge, so the
    // land fills the region and the water is a coast you can follow, not a void you fall into.
    const edge = Math.min(WORLD.half - Math.abs(x), WORLD.half - Math.abs(z)) / WORLD.half;
    const frame = smoothstep(0.015, 0.20, edge);
    const bays = fbm(nx * 7.9 - 33, nz * 7.9 + 48, s + 37, 3, 1, 2.05, 0.5) * 0.14;
    return clamp((base + lobes + bays - SHAPE.landBias) * SHAPE.landGain * frame, -1, 1);
  }

  function mountainMask(x, z) {
    const nx = x / WORLD.size, nz = z / WORLD.size;
    return smoothstep(0.34, 0.78, fbm(nx * 3.3 + 40, nz * 3.3 - 25, s + 53, 3, 1, 2.0, 0.55) * 0.5 + 0.5);
  }

  // River courses: the thin valleys of a ridged field, only where there is land to drain.
  function riverStrength(x, z) {
    const nx = x / WORLD.size, nz = z / WORLD.size;
    const r = ridged(nx * 5.4, nz * 5.4, s + 71, 3, 1);
    return smoothstep(0.86, 0.995, r);
  }

  function elevation(x, z) {
    const c = continent(x, z);
    if (c <= 0) return c * 26;                       // sea floor, shelves down off the coast
    const nx = x / WORLD.size, nz = z / WORLD.size;
    const hills = (fbm(nx * 9.5, nz * 9.5, s + 97, 4, 1, 2.05, 0.5) * 0.5 + 0.5);
    const ridges = ridged(nx * 7.2, nz * 7.2, s + 131, 4, 1);
    const relief = lerp(hills * 0.55, ridges, mountainMask(x, z));
    let h = Math.pow(c, SHAPE.elevationCurve) * WORLD.maxElevation * (SHAPE.reliefBase + relief * SHAPE.reliefGain);
    const river = riverStrength(x, z);
    if (river > 0) h = lerp(h, Math.min(h, 1.4), river * 0.92);   // carve the valley
    return h;
  }

  function moisture(x, z) {
    const nx = x / WORLD.size, nz = z / WORLD.size;
    const base = fbm(nx * 6.3 - 12, nz * 6.3 + 31, s + 149, 4, 1, 2.04, 0.5) * 0.5 + 0.5;
    const coastal = smoothstep(46, 2, elevation(x, z)) * 0.24;    // wetter near the water
    return clamp(base * 0.86 + coastal + riverStrength(x, z) * 0.22, 0, 1);
  }

  function temperature(x, z) {
    const latitude = 1 - smoothstep(-WORLD.half, WORLD.half, z);  // north is cooler
    const noise = fbm(x / WORLD.size * 4.1 + 60, z / WORLD.size * 4.1, s + 181, 3, 1, 2.02, 0.5) * 0.14;
    const lapse = clamp(elevation(x, z), 0, WORLD.maxElevation) / WORLD.maxElevation * 0.40;
    return clamp(latitude * 0.60 + 0.34 + noise - lapse, 0, 1);
  }

  function classify(h, m, t) {
    const B = BANDS;
    if (h <= WORLD.seaLevel) return 0;                                  // open water
    if (h < B.shoreHeight) return m > B.wetMoisture ? 2 : 1;            // wetland or beach
    if (h > B.alpineHeight) return 7;                                   // bare rock and snow
    if (h > B.highlandHeight) return t < B.coldTemperature + 0.16 ? 7 : 6;
    if (t < B.coldTemperature) return 6;                                // cool pine
    if (m < B.aridMoisture) return 5;                                   // badlands
    if (m > B.humidMoisture) return h < B.lowlandHeight ? 2 : 3;        // wetland low, jungle above
    return 4;                                                           // savanna
  }

  function biomeAt(x, z) { return classify(elevation(x, z), moisture(x, z), temperature(x, z)); }

  function factionAt(x, z) {
    if (elevation(x, z) <= WORLD.seaLevel) return -1;
    const warpX = x + fbm(x / WORLD.size * 3.7, z / WORLD.size * 3.7, s + 211, 3) * 240;
    const warpZ = z + fbm(x / WORLD.size * 3.7 + 17, z / WORLD.size * 3.7 - 9, s + 227, 3) * 240;
    let best = 0, bestD = Infinity;
    for (const seat of seats) {
      const d = Math.hypot(warpX - seat.x, warpZ - seat.z);
      if (d < bestD) { bestD = d; best = seat.id; }
    }
    return best;
  }

  // Slope from finite differences; used for pad sites and for cliff shading.
  function slope(x, z, step = 3) {
    const dx = elevation(x + step, z) - elevation(x - step, z);
    const dz = elevation(x, z + step) - elevation(x, z - step);
    return Math.hypot(dx, dz) / (2 * step);
  }

  function sample(x, z) {
    const h = elevation(x, z), m = moisture(x, z), t = temperature(x, z);
    const id = classify(h, m, t);
    return { x, z, height: h, moisture: m, temperature: t, biome: id, biomeKey: BIOMES[id].key,
      faction: factionAt(x, z), river: riverStrength(x, z), slope: slope(x, z) };
  }

  // --- settlements ---------------------------------------------------------
  // One candidate per cell, jittered inside it, kept only if the ground suits the kind.
  // Deterministic, so any system can ask "what is in this cell" without coordination.
  const settlementCache = new Map();
  function settlementInCell(cellX, cellZ) {
    const key = cellX + ':' + cellZ;
    if (settlementCache.has(key)) return settlementCache.get(key);
    let result = null;
    const roll = hash2(cellX, cellZ, s + 401);
    if (roll < 0.74) {
      const x = (cellX + 0.18 + hash2(cellX, cellZ, s + 409) * 0.64) * WORLD.cell;
      const z = (cellZ + 0.18 + hash2(cellX, cellZ, s + 419) * 0.64) * WORLD.cell;
      if (Math.abs(x) < WORLD.half - 40 && Math.abs(z) < WORLD.half - 40) {
        const h = elevation(x, z), sl = slope(x, z);
        if (h > 1.6 && h < 96 && sl < 0.52) {
          const b = biomeAt(x, z);
          const coastal = h < 9;
          const pick = hash2(cellX, cellZ, s + 431);
          const pool = SETTLEMENT_KINDS.filter(k => (!k.coastal || coastal) && !(k.key === 'port' && !coastal));
          const total = pool.reduce((a, k) => a + k.weight, 0);
          let acc = 0, kind = pool[0];
          for (const k of pool) { acc += k.weight / total; if (pick <= acc) { kind = k; break; } }
          const nameRoll = hash2(cellX, cellZ, s + 443);
          const head = NAME_HEAD[Math.floor(nameRoll * NAME_HEAD.length) % NAME_HEAD.length];
          const tail = NAME_TAIL[Math.floor(hash2(cellX, cellZ, s + 457) * NAME_TAIL.length) % NAME_TAIL.length];
          const sizeRoll = hash2(cellX, cellZ, s + 463);
          result = {
            id: `s${cellX}_${cellZ}`, cellX, cellZ, x, z,
            kind: kind.key, kindName: kind.name, pads: kind.pads, threat: kind.threat,
            radius: Math.round(lerp(kind.size[0], kind.size[1], sizeRoll)),
            name: `${head} ${tail}`, biome: b, faction: factionAt(x, z),
            height: h, coastal,
          };
        }
      }
    }
    settlementCache.set(key, result);
    return result;
  }

  function settlementsNear(x, z, radius) {
    const found = [];
    const c0 = Math.floor((x - radius) / WORLD.cell), c1 = Math.floor((x + radius) / WORLD.cell);
    const r0 = Math.floor((z - radius) / WORLD.cell), r1 = Math.floor((z + radius) / WORLD.cell);
    for (let cz = r0; cz <= r1; cz++) for (let cx = c0; cx <= c1; cx++) {
      const site = settlementInCell(cx, cz);
      if (site && Math.hypot(site.x - x, site.z - z) <= radius) found.push(site);
    }
    return found;
  }

  function allSettlements() {
    const cells = Math.ceil(WORLD.size / WORLD.cell);
    const half = Math.ceil(cells / 2), out = [];
    for (let cz = -half; cz <= half; cz++) for (let cx = -half; cx <= half; cx++) {
      const site = settlementInCell(cx, cz);
      if (site) out.push(site);
    }
    return out;
  }

  // Ground as the helicopter and the mesh see it: raw terrain, flattened into a platform
  // under each settlement so pads and buildings sit level. Kept separate from elevation()
  // because site selection itself asks for the raw terrain.
  function groundHeight(x, z, sites) {
    const base = elevation(x, z);
    const near = sites ?? settlementsNear(x, z, 70);
    if (!near.length) return base;
    let h = base;
    for (const site of near) {
      const d = Math.hypot(x - site.x, z - site.z);
      const outer = site.radius * 1.7;
      if (d > outer) continue;
      h = lerp(h, site.height, 1 - smoothstep(site.radius * 0.7, outer, d));
    }
    return h;
  }

  // --- the player's yard ---------------------------------------------------
  // A flat, quiet, unaligned patch near the middle of the region, found once and reused.
  function findHomeSite() {
    for (let ring = 0; ring < 40; ring++) {
      const steps = Math.max(1, ring * 6);
      for (let i = 0; i < steps; i++) {
        const a = i / steps * Math.PI * 2 + ring;
        const r = ring * 26;
        const x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
        const h = elevation(x, z);
        if (h < 4 || h > 40) continue;
        if (slope(x, z, 4) > 0.16) continue;
        const b = biomeAt(x, z);
        if (b === 0 || b === 7) continue;
        if (settlementsNear(x, z, 120).length) continue;
        return { x, z, height: h, biome: b, faction: factionAt(x, z) };
      }
    }
    return { x: 0, z: 0, height: elevation(0, 0), biome: biomeAt(0, 0), faction: factionAt(0, 0) };
  }
  let home = null;

  // --- scatter -------------------------------------------------------------
  // Props for one chunk, thinned by level of detail. Deterministic per chunk so a chunk
  // looks the same every time it streams in.
  function propsInChunk(cx, cz, lod = 0) {
    const out = [];
    const step = 1 << lod;
    const budget = Math.floor(64 / step);
    for (let i = 0; i < budget; i++) {
      const hx = hash2(cx * 131 + i, cz * 977, s + 503);
      const hz = hash2(cx * 379, cz * 613 + i, s + 509);
      const x = (cx + hx) * WORLD.chunk, z = (cz + hz) * WORLD.chunk;
      const h = elevation(x, z);
      if (h <= 0.8) continue;
      const b = classify(h, moisture(x, z), temperature(x, z));
      const info = BIOMES[b];
      if (!info.props.length) continue;
      if (hash2(cx * 17 + i, cz * 23, s + 521) > info.scatter) continue;
      if (slope(x, z) > 0.55) continue;
      const kindRoll = hash2(cx + i, cz * 7 + i, s + 541);
      out.push({
        x, z, height: h, biome: b,
        prop: info.props[Math.floor(kindRoll * info.props.length) % info.props.length],
        scale: 0.7 + hash2(cx * 3 + i, cz * 5, s + 547) * 0.7,
        turn: hash2(cx * 11 + i, cz * 13, s + 557) * Math.PI * 2,
      });
    }
    return out;
  }

  return {
    seed: s, seats,
    elevation, height: elevation, groundHeight, moisture, temperature, biomeAt, factionAt, slope, sample,
    continent, riverStrength, classify,
    settlementInCell, settlementsNear, allSettlements, propsInChunk,
    get home() { return home ?? (home = findHomeSite()); },
  };
}

// Chunk helpers, shared by the streamer and the tests.
export const chunkOf = (x, z) => ({ cx: Math.floor(x / WORLD.chunk), cz: Math.floor(z / WORLD.chunk) });
export const chunkKey = (cx, cz) => cx + ':' + cz;
export const chunkCentre = (cx, cz) => ({ x: (cx + 0.5) * WORLD.chunk, z: (cz + 0.5) * WORLD.chunk });
export const chunkInWorld = (cx, cz) => {
  const c = chunkCentre(cx, cz);
  return Math.abs(c.x) <= WORLD.half + WORLD.chunk && Math.abs(c.z) <= WORLD.half + WORLD.chunk;
};
