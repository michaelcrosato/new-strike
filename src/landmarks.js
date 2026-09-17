// One unmistakable thing per region.
//
// Nine archetypes bend the terrain, which is what makes the areas *feel* different from
// the air — but terrain alone gives you nothing to point at. A landmark is the thing you
// navigate by and the thing you remember: a drowned chapel standing in the delta, a dam
// across a highland valley, a beached freighter on the coast. Each region gets exactly
// one, so a landmark sighting tells you where in a hundred square kilometres you are.
//
// Placement is deterministic and cannot fail. Each kind scores the ground it wants and the
// best-scoring candidate in the region wins, rather than the first acceptable one — a
// region that happens to be short of ideal ground still gets its landmark, on the closest
// thing to it, instead of quietly going without and leaving the region generic.
//
// THREE-free, like the rest of the generator. The geometry for these lives in terrain.js.

import { WORLD } from './worldgen.js';

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

// `terrain` names the ground a kind wants and is scored, not required. `flatten` says
// whether the landmark cuts a platform for itself the way a settlement does — the chapel
// and the freighter sit in water and must not.
export const LANDMARK_KINDS = {
  delta: {
    key: 'chapel', name: 'THE DROWNED CHAPEL', short: 'CHAPEL',
    blurb: 'A bell tower in two metres of water, and the village that would not leave it.',
    terrain: 'shallow', radius: 24, pads: 1, guards: 2, flatten: false, pay: 1.15,
  },
  savanna: {
    key: 'strip', name: 'THE LONG STRIP', short: 'THE STRIP',
    blurb: 'Two kilometres of cracked runway and the airliners nobody came back for.',
    terrain: 'flat', radius: 46, pads: 2, guards: 3, flatten: true, pay: 1.2,
  },
  badlands: {
    key: 'boneyard', name: 'THE BONEYARD', short: 'BONEYARD',
    blurb: 'Rows of stripped fuselages in the dust. Everything flying here came from here.',
    terrain: 'flat', radius: 38, pads: 1, guards: 4, flatten: true, pay: 1.3,
  },
  highland: {
    key: 'dam', name: 'THE GREY DAM', short: 'THE DAM',
    blurb: 'A concrete wall across the valley. Whoever holds it holds the water.',
    terrain: 'valley', radius: 34, pads: 1, guards: 4, flatten: false, pay: 1.35,
  },
  alpine: {
    key: 'observatory', name: 'THE EAR', short: 'THE EAR',
    blurb: 'A dish on the highest ground in the region, still listening to something.',
    terrain: 'summit', radius: 26, pads: 1, guards: 3, flatten: true, pay: 1.4,
  },
  coast: {
    key: 'freighter', name: 'THE BEACHED FREIGHTER', short: 'FREIGHTER',
    blurb: 'Sixteen thousand tonnes aground and broken in two. Half the coast is built from it.',
    terrain: 'shallow', radius: 30, pads: 1, guards: 2, flatten: false, pay: 1.2,
  },
  jungle: {
    key: 'steps', name: 'THE STEPS', short: 'THE STEPS',
    blurb: 'A stone pyramid above the canopy. Older than every border it has outlived.',
    terrain: 'rise', radius: 28, pads: 1, guards: 3, flatten: true, pay: 1.25,
  },
  saltflat: {
    key: 'evaporators', name: 'THE EVAPORATORS', short: 'SALT WORKS',
    blurb: 'A grid of white pans and a conveyor to nowhere. Visible from anywhere in the pans.',
    terrain: 'flat', radius: 42, pads: 1, guards: 2, flatten: true, pay: 1.1,
  },
  basin: {
    key: 'interchange', name: 'THE INTERCHANGE', short: 'INTERCHANGE',
    blurb: 'Four levels of motorway that stopped being built, and a market underneath it.',
    terrain: 'flat', radius: 36, pads: 1, guards: 3, flatten: true, pay: 1.2,
  },
};

// How well a point suits a kind of ground. Higher is better; anything above zero is
// usable, and the scores are deliberately smooth so the search degrades gracefully on a
// seed that has no perfect spot.
function scoreGround(world, kind, x, z) {
  const h = world.elevation(x, z);
  const slope = world.slope(x, z, 4);
  switch (kind.terrain) {
    case 'flat':
      if (h < 3 || h > 64) return -1;
      return 40 - slope * 120 - Math.abs(h - 22) * 0.25;
    case 'summit':
      if (slope > 0.62) return -1;
      return h - slope * 40;
    case 'rise':
      // Above the flood and below the treeline: a temple in the snow is the wrong picture.
      if (h < 14 || h > 44) return -1;
      return 30 + h * 0.3 - slope * 70;
    case 'valley': {
      if (h < 3 || h > 100) return -1;
      // A dam wants a narrow place, which means ground rising on *both* sides of a low
      // floor — not merely higher ground somewhere nearby. Taking the smaller of the two
      // opposing shoulders on each axis is what distinguishes a gorge from a hillside.
      let rise = 0;
      for (const r of [22, 44]) {
        const east = world.elevation(x + r, z) - h, west = world.elevation(x - r, z) - h;
        const north = world.elevation(x, z - r) - h, south = world.elevation(x, z + r) - h;
        rise += Math.min(Math.max(east, west), Math.max(north, south));
      }
      return clamp(rise, -20, 60) * 1.7 + world.riverStrength(x, z) * 30 - slope * 20;
    }
    case 'shallow': {
      // Standing in water, close enough to land to have been built from it.
      if (h > 1.6 || h < -9) return -1;
      let land = 0;
      for (const [dx, dz] of [[34, 0], [-34, 0], [0, 34], [0, -34], [24, 24], [-24, -24]]) {
        if (world.elevation(x + dx, z + dz) > 2) land++;
      }
      return land * 10 - Math.abs(h + 2) * 2;
    }
    default: return 0;
  }
}

/**
 * One landmark per region, chosen by sweeping a spiral of candidates out from each region
 * seat and keeping the best-scoring. Pure in (seed), so the map screen and the mesh
 * builder agree without coordinating.
 */
export function placeLandmarks(world) {
  const out = [];
  for (const region of world.regions.regions) {
    const kind = LANDMARK_KINDS[region.key];
    if (!kind) continue;
    let best = null, bestScore = -Infinity;
    // 12 rings out to 660 units. A region is about 3.3 km across, so this stays well
    // inside it and never wanders into the neighbour's ground.
    for (let ring = 1; ring <= 12; ring++) {
      const r = ring * 55;
      const steps = 6 + ring * 4;
      for (let i = 0; i < steps; i++) {
        const a = i / steps * Math.PI * 2 + ring * 0.7;
        const x = Math.round(clamp(region.x + Math.cos(a) * r, -WORLD.half + 80, WORLD.half - 80));
        const z = Math.round(clamp(region.z + Math.sin(a) * r, -WORLD.half + 80, WORLD.half - 80));
        // It has to be in its own region, well inside it, and not on top of anything else.
        if (world.regionAt(x, z).index !== region.index) continue;
        if (world.regions.regionWeight(x, z) < 0.35) continue;
        if (world.settlementsNear(x, z, kind.radius + 70).length) continue;
        const homeSite = world.home;
        if (Math.hypot(x - homeSite.x, z - homeSite.z) < 200) continue;
        let score = scoreGround(world, kind, x, z);
        if (score <= -1) continue;
        // Mild preference for the middle of the region, so the landmark is somewhere you
        // pass rather than tucked against a border.
        score += (1 - r / 700) * 6;
        if (score > bestScore) { bestScore = score; best = { x, z }; }
      }
    }
    if (!best) best = { x: Math.round(region.x), z: Math.round(region.z) };
    const height = world.elevation(best.x, best.z);
    out.push({
      id: `L${region.index}`, landmark: true,
      key: kind.key, name: kind.name, short: kind.short, kindName: 'LANDMARK',
      kind: kind.key, blurb: kind.blurb,
      x: best.x, z: best.z,
      // A flattening landmark sits on its own platform; one in the water keeps the sea
      // level as its floor so the hull and the tower stand in it properly.
      height: kind.flatten ? Math.max(height, 1.5) : Math.max(height, WORLD.seaLevel),
      radius: kind.radius, pads: kind.pads, guards: kind.guards, flatten: kind.flatten,
      pay: kind.pay, threat: 2,
      region: region.key, regionName: region.name, regionIndex: region.index,
      faction: Math.max(0, world.factionAt(best.x, best.z)),
      biome: world.biomeAt(best.x, best.z),
      score: +bestScore.toFixed(1),
    });
  }
  return out;
}
