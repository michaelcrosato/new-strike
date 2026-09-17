// Campaign data. Every level owns its map, its landing pads, its roster and its objective
// chain; the simulation in core.js and the builders in world.js are level agnostic.
// Objective kinds declared here are evaluated by core.js: destroy, destroyTag, rescue,
// capture, deliver, recon, escort, defend, intercept and extract.

export const ISLANDS_DELTA = [
  [[-127, 65], [-124, 35], [-108, 7], [-94, -7], [-62, -26], [-32, -19], [-12, 4], [-14, 34], [-26, 65], [-55, 82], [-88, 89], [-115, 80]],
  [[-30, -27], [-37, -49], [-19, -79], [4, -91], [28, -99], [48, -86], [63, -72], [61, -37], [48, -15], [18, -7], [-5, -17]],
  [[62, -107], [86, -123], [116, -120], [139, -103], [145, -75], [131, -44], [109, -27], [84, -33], [70, -52], [64, -79]],
  [[25, 28], [42, 9], [69, 3], [102, 10], [119, 33], [128, 58], [113, 77], [88, 85], [60, 71], [38, 62]],
  [[-121, -81], [-112, -102], [-95, -108], [-79, -96], [-83, -73], [-106, -67]],
  [[-18, 106], [-7, 96], [11, 100], [21, 119], [8, 133], [-12, 127]],
];

// Builds a rounded island polygon from a blueprint, so the larger levels can describe a whole
// archipelago in one line each instead of forty hand-typed coordinates.
// Local generator so this module stays free of imports and cannot form a cycle with core.
function seeded(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
// An archipelago from one line per island.
export function archipelago(specs, seed) {
  const rand = seeded(seed);
  return specs.map(spec => islandFrom(spec, rand));
}
export function islandFrom({ x, z, radius, points = 11, jitter = 0.3, squash = 1, turn = 0 }, rand) {
  const poly = [];
  for (let i = 0; i < points; i++) {
    const a = turn + i * Math.PI * 2 / points;
    const r = radius * (1 - jitter / 2 + rand() * jitter);
    poly.push([x + Math.sin(a) * r, z + Math.cos(a) * r * squash]);
  }
  return poly;
}

export const LEVELS = [
  {
    id: 'delta', name: 'TERN DELTA', region: 'RIVER DELTA', limit: 157, seed: 818,
    tagline: 'A LITTLE HEAVY LIFTING.',
    intro: ['Four people to bring home.', 'One missile launch to stop.', 'A whole lot of island in your way.'],
    islands: ISLANDS_DELTA,
    ridges: [[-103, 3, 15, 16], [-102, -2, 8, 10], [-90, -10, 13, 10], [2, -86, 13, 9], [35, -83, 14, 10], [128, -102, 11, 9], [122, -111, 12, 8], [-97, -91, 13, 13], [56, 26, 13, 9], [103, 64, 12, 9]],
    rocks: { count: 34, x: [-154, 154], z: [-146, 140] },
    scatter: { count: 560, x: [-145, 145], z: [-125, 130] },
    base: { x: -99, z: 111, radius: 13, pad: 11, letter: 'H', carrier: true },
    depots: [{ x: -8, z: -26, radius: 8, pad: 7.6, letter: 'F' }],
    zones: { camp: { x: 10, z: -51, radius: 9 } },
    labels: [[-99, 134, 'HOMEPLATE'], [-90, 6, 'RADAR'], [-7, -40, 'ENGINEERS'], [83, -115, 'STORM BATTERY'], [-23, -10, 'FIELD SUPPLY'], [71, 98, 'PORT TERN']],
    clearings: [{ x: -66, z: 20 }, { x: 99, z: -79 }, { x: 80, z: 53 }],
    spare: (x, z) => (Math.abs(x + z + 30) < 9 && x < 0 && z > 0) || (z > -74 && z < -57 && x > -10 && x < 115),
    route: [{ x: -99, z: 111 }, { x: -66, z: 20 }, { x: 10, z: -51 }, { x: 99, z: -79 }, { x: -99, z: 111 }],
    enemies: [
      ['coastal-radar', 'radar', -66, 20],
      ['coast-aa', 'turret', -83, 39],
      ['road-tank', 'tank', -45, 5, { patrol: [{ x: -47, z: 5 }, { x: -73, z: 47 }] }],
      ['coast-sam', 'sam', -46, 39],
      ['camp-west', 'turret', -9, -49, { guard: true }],
      ['camp-east', 'turret', 31, -50, { guard: true }],
      ['camp-tank', 'tank', 10, -71, { guard: true, patrol: [{ x: 8, z: -73 }, { x: 27, z: -69 }] }],
      ['river-patrol', 'boat', -26, -7, { patrol: [{ x: -29, z: -7 }, { x: -49, z: -50 }] }],
      ['harbor-patrol', 'boat', 46, 88, { patrol: [{ x: 46, z: 88 }, { x: 115, z: 93 }] }],
      ['harbor-aa', 'turret', 77, 38],
      ['bridge-tank', 'tank', 54, -66],
      ['citadel-sam', 'sam', 75, -91],
      ['citadel-aa', 'turret', 115, -61],
      ['generator-west', 'generator', 77, -55, { generator: true }],
      ['generator-east', 'generator', 113, -96, { generator: true }],
      ['storm-command', 'command', 99, -79, { shieldedBy: 'generator' }],
      ['fuel-coast', 'crate', -91, 17, { explosive: true }],
      ['fuel-camp', 'crate', 29, -65, { explosive: true }],
      ['fuel-command', 'crate', 120, -64, { explosive: true }],
    ],
    start: 'Hawk, you are cleared hot. Knock out the coastal radar. Keep moving under fire.',
    objectives: [
      {
        kind: 'destroy', targets: ['coastal-radar'], at: { x: -66, z: 20 },
        label: 'DESTROY COASTAL RADAR', short: 'RADAR ARRAY', detail: 'Cut the island early warning network.',
        reward: 600, next: 'Radar down. Four engineers are trapped upriver. Clear their compound, then winch them out.',
      },
      {
        kind: 'rescue', zone: 'camp', count: 4, guardTag: 'guard', noun: 'ENGINEER',
        label: 'WINCH THE ENGINEERS', short: 'ENGINEERS', detail: 'Hover over the amber rescue beacon. Hold E / WINCH.',
        blockedLabel: 'CLEAR THE RESCUE COMPOUND', blockedDetail: 'Eliminate the three compound defenders.',
        next: 'All four aboard! They gave us the launch codes. Break both power nodes, then destroy the Storm battery. Five minutes.',
      },
      {
        kind: 'destroy', targets: ['storm-command'], blockedShort: 'POWER NODES', at: { x: 99, z: -79 },
        label: 'DESTROY THE STORM BATTERY', short: 'STORM BATTERY', detail: 'Battery exposed. Stop the missile launch.',
        blockedLabel: 'BREAK THE STORM SHIELD', blockedDetail: 'Destroy both power nodes to expose the battery.',
        timer: { seconds: 300, title: 'LAUNCH NOT PREVENTED', reason: 'The Storm battery fired. Destroy the two power nodes first, then hit the central launcher with seekers.' },
        reward: 1000, next: 'Beautiful hit, Hawk. The launch is dead. Bring our people back to the carrier.',
      },
      {
        kind: 'extract', label: 'RETURN TO THE CARRIER', short: 'EXTRACTION · HOMEPLATE',
        detail: 'Bring the crew home. Hover above the carrier and hold E / LAND.',
      },
    ],
    build(w) {
      w.carrier(-99, 111);
      w.road([-99, 61], [-64, 35]); w.road([-64, 35], [-32, -5]);
      w.road([-12, -23], [19, -59]); w.road([19, -59], [55, -65]); w.road([69, -67], [112, -77]);
      w.road([49, 46], [102, 28]);
      w.box(-66, 2.79, 20, 26, .25, 24, 'asphalt');
      w.building(-82, 13, 10, 9, 4, 'concrete'); w.building(-57, 7, 8, 6, 3.8, 'dark');
      w.container(-95, 37, 'rust'); w.container(-96, 47, 'cream'); w.container(-37, 29, 'roof');
      w.fence(-67, 20, 31, 30);
      w.building(6, -59, 16, 7, 4.2, 'concrete', 'roofLight'); w.building(25, -40, 8, 12, 4.1, 'cream', 'rust');
      w.building(-5, -68, 11, 9, 3.4, 'dark'); w.container(29, -72, 'rust', Math.PI / 2);
      w.fence(9, -52, 44, 40);
      w.box(10, 2.75, -50, 13, .15, 10, 'sand');
      w.box(-8, 2.7, -26, 19, .16, 19, 'asphalt'); w.container(-21, -29, 'cream'); w.container(-20, -20, 'roof');
      w.building(103, -102, 12, 8, 5.3, 'concrete'); w.building(123, -83, 10, 14, 5, 'dark');
      w.box(99, 2.74, -79, 43, .16, 34, 'asphalt');
      for (let z = -95; z <= -62; z += 11) w.box(123, 2.86, z, 5, .08, .25, 'cream');
      w.container(81, -106, 'rust', Math.PI / 2); w.container(90, -106, 'roof', Math.PI / 2);
      w.bridge(64, -66);
      w.box(91, 1.7, 85, 42, 1, 19, 'concrete'); w.box(106, 1.5, 99, 9, 1, 25, 'concrete');
      w.building(78, 55, 18, 17, 7, 'cream', 'roof'); w.building(101, 36, 13, 14, 6, 'concrete', 'rust');
      for (const [x, z, c] of [[61, 54, 'rust'], [58, 41, 'roof'], [97, 62, 'rust'], [106, 69, 'cream'], [89, 68, 'roof']]) w.container(x, z, c, Math.PI / 2);
      w.crane(112, 70); w.crane(77, 76);
      for (const [x, z] of [[-50, 61], [-87, 59], [38, -23], [111, -39], [49, 22]]) {
        w.building(x, z, 6, 7, 3.2, 'cream', 'rust'); w.building(x + 8, z + 2, 5, 6, 2.7, 'concrete');
      }
      w.solarField(85, -43, 112, -34);
      for (const [x, z] of [[-54, 12], [21, -61], [112, -102]]) w.aerial(x, z);
    },
  },
  {
    id: 'sound', name: 'KETTLE SOUND', region: 'NAVAL SOUND', limit: 300, seed: 2202,
    tagline: 'EVERYTHING WORTH HAVING IS ACROSS WATER.',
    intro: ['Four gunboats own this water.', 'An aircrew is down on the rocks.', 'And the harbour master knows where the fleet went.'],
    islands: archipelago([
      { x: -186, z: 126, radius: 64, points: 13 },
      { x: -46, z: 158, radius: 72, points: 14 },
      { x: 104, z: 74, radius: 58, points: 12 },
      { x: -128, z: -54, radius: 56, points: 12 },
      { x: 64, z: -148, radius: 68, points: 13 },
      { x: 208, z: -46, radius: 44, points: 10 },
      { x: -24, z: 6, radius: 38, points: 11, squash: .55 },
      { x: 170, z: 170, radius: 40, points: 10 },
    ], 2202),
    ridges: [[-186, 140, 16, 12], [-40, 176, 15, 11], [70, -160, 14, 10], [110, 60, 12, 9]],
    rocks: { count: 46, x: [-292, 292], z: [-292, 292] },
    scatter: { count: 900, x: [-290, 290], z: [-290, 290] },
    base: { x: -244, z: 214, radius: 13, pad: 11, letter: 'H', carrier: true },
    depots: [
      { x: -58, z: 150, radius: 8, pad: 7.6, letter: 'F' },
      { x: 40, z: -125, radius: 8, pad: 7.6, letter: 'G' },
    ],
    zones: { crash: { x: -128, z: -54, radius: 9 } },
    clearings: [{ x: -24, z: 6 }, { x: 104, z: 74 }, { x: 80, z: -160 }],
    labels: [[-244, 244, 'HOMEPLATE'], [-46, 196, 'PORT KETTLE'], [-128, -22, 'AIRCREW DOWN'],
      [64, -184, 'NORTH POINT'], [-24, 36, 'THE CAUSEWAY'], [104, 108, 'EAST SPIT'], [40, -100, 'FIELD SUPPLY']],
    spans: [[-58, 6, 10, 6]],
    route: [{ x: -244, z: 214 }, { x: -128, z: -54 }, { x: 64, z: -148 }, { x: -58, z: 150 }, { x: -24, z: 6 }, { x: -244, z: 214 }],
    enemies: [
      ['sound-patrol-a', 'boat', -150, 60, { patrol: [{ x: -150, z: 60 }, { x: -60, z: 80 }], patrolTag: true }],
      ['sound-patrol-b', 'boat', 20, 120, { patrol: [{ x: 20, z: 120 }, { x: 120, z: 140 }], patrolTag: true }],
      ['sound-patrol-c', 'boat', 140, -100, { patrol: [{ x: 140, z: -100 }, { x: 200, z: -140 }], patrolTag: true }],
      ['sound-patrol-d', 'boat', -80, -120, { patrol: [{ x: -80, z: -120 }, { x: -30, z: -40 }], patrolTag: true }],
      ['crash-guard-west', 'turret', -146, -40, { crashguard: true }],
      ['crash-guard-east', 'turret', -110, -68, { crashguard: true }],
      ['harbour-master', 'officer', 80, -160, { capturable: true }],
      ['point-turret-a', 'turret', 64, -130],
      ['point-turret-b', 'turret', 96, -150],
      ['point-tank', 'tank', 50, -170, { patrol: [{ x: 50, z: -170 }, { x: 24, z: -140 }] }],
      ['causeway', 'bridge', -24, 6],
      ['causeway-turret', 'turret', -6, 2],
      ['kettle-sam', 'sam', -20, 180],
      ['kettle-turret', 'turret', -70, 190],
      ['spit-radar', 'radar', 104, 74],
      ['spit-turret', 'turret', 120, 90],
      ['spit-tank', 'tank', 88, 58],
      ['islet-sam', 'sam', 208, -46],
      ['south-turret', 'turret', 170, 170],
      ['west-turret', 'turret', -170, 140],
      ['kettle-fuel-a', 'fueltank', -30, 140, { explosive: true }],
      ['kettle-fuel-b', 'fueltank', -38, 130, { explosive: true }],
      ['point-fuel', 'fueltank', 84, -138, { explosive: true }],
    ],
    start: 'Hawk, the sound is crawling with gunboats. Sink all four before we move anything through here.',
    objectives: [
      {
        kind: 'destroyTag', tag: 'patrolTag', label: 'SINK THE SOUND PATROLS', short: 'GUNBOATS',
        detail: 'Four gunboats are working the channels. Seekers save ammunition on a moving hull.',
        reward: 500, next: 'Channel is ours. We have an aircrew down on Cold Rock, two guns over them. Clear it and winch all three.',
      },
      {
        kind: 'rescue', zone: 'crash', count: 3, guardTag: 'crashguard', noun: 'AIRCREW', short: 'AIRCREW',
        label: 'WINCH THE DOWNED AIRCREW', detail: 'Hover over the beacon on Cold Rock and hold the winch.',
        blockedLabel: 'CLEAR THE CRASH SITE', blockedDetail: 'Two emplacements cover the rocks. Take them out first.',
        reward: 400, next: 'All three aboard. Now the prize: the harbour master on North Point. We need him alive, so do not shoot the man.',
      },
      {
        kind: 'capture', target: 'harbour-master', noun: 'HARBOUR MASTER', short: 'HARBOUR MASTER',
        label: 'TAKE THE HARBOUR MASTER', detail: 'Hover over him and hold the winch. Do not fire on him.',
        aboard: 'He is aboard and very talkative. Get everyone to Port Kettle.',
        reward: 700, next: 'Four souls aboard. Set down at Port Kettle and hand them over.',
      },
      {
        kind: 'deliver', to: 'F', count: 4, label: 'HAND OVER AT PORT KETTLE', short: 'CARGO',
        detail: 'Land on the green pad at Port Kettle and hold to hand everyone over.',
        handover: 'Off your hands, and your airframe looks better for it. Last job: drop the causeway.',
        reward: 400, next: 'Last job. The causeway is how they reinforce this sound. Drop it.',
      },
      {
        kind: 'destroy', targets: ['causeway'], at: { x: -24, z: 6 }, label: 'DROP THE CAUSEWAY', short: 'CAUSEWAY',
        detail: 'Heavy concrete. Rockets into the same span, or seekers if you have them.',
        reward: 900, next: 'Span is in the water. Come home, Hawk.',
      },
      { kind: 'extract', label: 'RETURN TO THE CARRIER', short: 'EXTRACTION · HOMEPLATE', detail: 'Hover above the carrier deck and hold to land.' },
    ],
    build(w) {
      w.carrier(-244, 214);
      w.road([-96, 150], [-20, 176]); w.road([-20, 176], [40, 190]);
      w.building(-46, 158, 14, 10, 5, 'concrete'); w.building(-70, 172, 10, 8, 4, 'cream', 'rust');
      w.building(-22, 176, 9, 9, 4.4, 'dark'); w.container(-84, 150, 'rust'); w.container(-84, 160, 'cream');
      w.crane(-100, 168); w.crane(-72, 186);
      w.box(-58, 2.7, 150, 20, .16, 20, 'asphalt');
      w.fence(80, -160, 30, 26);
      w.building(96, -168, 10, 8, 4.2, 'dark'); w.building(56, -158, 9, 7, 3.6, 'concrete');
      w.box(40, 2.7, -125, 18, .16, 18, 'asphalt'); w.road([40, -125], [72, -152]);
      w.box(104, 2.79, 74, 24, .25, 22, 'asphalt'); w.fence(104, 74, 28, 26);
      w.building(122, 62, 9, 8, 4, 'cream'); w.aerial(96, 92);
      w.bridge(-24, 6, 34); w.road([-52, 6], [-30, 6]); w.road([-18, 6], [8, 6]);
      w.oilRig(150, 20);
      w.building(-186, 126, 11, 9, 4.6, 'concrete'); w.aerial(-170, 112);
      w.building(208, -46, 9, 8, 4, 'dark'); w.building(170, 170, 8, 8, 3.6, 'cream', 'rust');
      for (const [x, z] of [[-150, 150], [-60, 130], [120, 88], [40, -160], [190, -60]]) w.building(x, z, 6, 7, 3.2, 'cream', 'rust');
    },
  },
  {
    id: 'ashfall', name: 'ASHFALL BASIN', region: 'INLAND BASIN', limit: 320, seed: 3303,
    tagline: 'THE AIR CORRIDOR OPENS ONCE.',
    intro: ['A fuel farm feeding the whole basin.', 'An air corridor that opens for four minutes.', 'And four of ours behind wire.'],
    islands: archipelago([
      { x: 0, z: 40, radius: 132, points: 18, jitter: .22 },
      { x: -192, z: -140, radius: 62, points: 12 },
      { x: 182, z: -162, radius: 66, points: 13 },
      { x: -204, z: 162, radius: 54, points: 11 },
      { x: 212, z: 152, radius: 50, points: 11 },
      { x: 20, z: -190, radius: 44, points: 10 },
    ], 3303),
    ridges: [[-70, 96, 20, 15], [56, 110, 18, 13], [182, -162, 18, 16], [-192, -140, 16, 12], [-40, -30, 16, 11]],
    rocks: { count: 44, x: [-312, 312], z: [-312, 312] },
    scatter: { count: 1050, x: [-310, 310], z: [-310, 310] },
    base: { x: -204, z: 162, radius: 13, pad: 11, letter: 'H' },
    depots: [
      { x: -60, z: 60, radius: 8, pad: 7.6, letter: 'F' },
      { x: 150, z: -120, radius: 8, pad: 7.6, letter: 'G' },
    ],
    zones: { camp: { x: 60, z: 100, radius: 9 }, launch: { x: 182, z: -162, radius: 12 } },
    clearings: [{ x: 182, z: -162, clear: 26 }, { x: 60, z: 100 }, { x: -20, z: 20, clear: 30 }],
    labels: [[-204, 192, 'ASHFALL FIELD'], [-20, 4, 'FUEL FARM'], [60, 130, 'PRISON CAMP'],
      [182, -196, 'LAUNCH SITE'], [-60, 34, 'FIELD SUPPLY'], [150, -94, 'EAST SUPPLY'], [-192, -110, 'RIDGE BATTERY']],
    route: [{ x: -204, z: 162 }, { x: -20, z: 20 }, { x: -100, z: -60 }, { x: 182, z: -162 }, { x: 60, z: 100 }, { x: -60, z: 60 }, { x: -204, z: 162 }],
    enemies: [
      ['farm-tank-a', 'fueltank', -30, 14, { explosive: true, fueltank: true }],
      ['farm-tank-b', 'fueltank', -18, 26, { explosive: true, fueltank: true }],
      ['farm-tank-c', 'fueltank', -6, 12, { explosive: true, fueltank: true }],
      ['farm-tank-d', 'fueltank', -26, 38, { explosive: true, fueltank: true }],
      ['farm-tank-e', 'fueltank', -44, 24, { explosive: true, fueltank: true }],
      ['aa-ridge', 'sam', -192, -140, { aa: true }],
      ['aa-basin', 'sam', 34, -44, { aa: true }],
      ['aa-mesa', 'turret', 160, -140, { aa: true }],
      ['aa-south', 'turret', 212, 152, { aa: true }],
      ['camp-guard-a', 'turret', 40, 112, { campguard: true }],
      ['camp-guard-b', 'turret', 82, 88, { campguard: true }],
      ['camp-guard-c', 'tank', 60, 124, { campguard: true, patrol: [{ x: 60, z: 124 }, { x: 96, z: 110 }] }],
      ['basin-radar', 'radar', -96, 52],
      ['basin-tank-a', 'tank', -120, 20, { patrol: [{ x: -120, z: 20 }, { x: -60, z: -20 }] }],
      ['basin-tank-b', 'tank', 100, 40, { patrol: [{ x: 100, z: 40 }, { x: 40, z: 60 }] }],
      ['basin-turret-a', 'turret', -40, 84],
      ['basin-turret-b', 'turret', 96, 4],
      ['mesa-turret', 'turret', 196, -180],
      ['mesa-tank', 'tank', 166, -186],
      ['islet-turret', 'turret', 20, -190],
      ['basin-fuel', 'crate', 8, 70, { explosive: true }],
      ['mesa-fuel', 'crate', 190, -146, { explosive: true }],
    ],
    start: 'Hawk, the basin runs on that fuel farm. Burn all five tanks. Mind the chain when they go.',
    objectives: [
      {
        kind: 'destroyTag', tag: 'fueltank', label: 'BURN THE FUEL FARM', short: 'FUEL TANKS',
        detail: 'Five tanks, close together. One rocket into a tank takes its neighbours with it.',
        reward: 600, next: 'Farm is burning. Now the air corridor: four batteries, and the strike package is inbound. Four minutes.',
      },
      {
        kind: 'destroyTag', tag: 'aa', label: 'CLEAR THE AIR CORRIDOR', short: 'BATTERIES',
        detail: 'Four anti-air positions across the basin. The strike package cannot come in until all four are down.',
        timer: { seconds: 280, title: 'CORRIDOR STAYED SHUT', reason: 'The strike package turned back. Hit the two ridge batteries first; they are the long flights.' },
        reward: 900, next: 'Corridor is open and the package is through. Now find what they were protecting: scan the mesa.',
      },
      {
        kind: 'recon', zone: 'launch', seconds: 8, label: 'SCAN THE LAUNCH SITE', short: 'SCAN',
        detail: 'Hold a steady hover over the mesa pad and keep the scanner on it.',
        actionLabel: 'HOLD SCAN', reward: 500, next: 'Got it. Mobile launchers, and a camp of ours two ridges south. Get them out.',
      },
      {
        kind: 'rescue', zone: 'camp', count: 4, guardTag: 'campguard', noun: 'PRISONER', short: 'PRISONERS',
        label: 'WINCH THE PRISONERS', detail: 'Hover over the beacon inside the wire and hold the winch.',
        blockedLabel: 'CLEAR THE PRISON CAMP', blockedDetail: 'Three positions guard the wire. Clear them before you drop the winch.',
        reward: 500, next: 'Four aboard. Set them down at the field pad, then get out of the basin.',
      },
      {
        kind: 'deliver', to: 'F', count: 4, label: 'HAND OVER AT THE FIELD PAD', short: 'CARGO',
        detail: 'Land on the green pad in the basin and hold to hand them over.',
        handover: 'They are safe. Come home.', reward: 400, next: 'Nothing left here. Back to Ashfall Field.',
      },
      { kind: 'extract', label: 'RETURN TO ASHFALL FIELD', short: 'EXTRACTION · ASHFALL', detail: 'Hover above the H and hold to land.' },
    ],
    build(w) {
      w.hangar(-204, 162, 24, 17);
      w.box(-204, 2.7, 178, 30, .18, 14, 'asphalt');
      w.road([-180, 150], [-110, 90]); w.road([-110, 90], [-40, 40]); w.road([-40, 40], [60, 80]);
      w.road([60, 80], [140, 20]); w.road([140, 20], [172, -130]);
      w.box(-20, 2.74, 20, 56, .18, 48, 'asphalt');
      for (const [x, z] of [[-30, 14], [-18, 26], [-6, 12], [-26, 38], [-44, 24]]) w.box(x, 2.9, z, 8, .12, 8, 'dark');
      w.building(-62, 8, 12, 9, 5, 'concrete'); w.building(4, 44, 10, 8, 4.2, 'dark');
      w.container(-52, 44, 'rust'); w.container(-52, 54, 'cream'); w.container(14, 6, 'roof');
      w.box(-60, 2.7, 60, 20, .16, 20, 'asphalt');
      w.fence(60, 100, 34, 30); w.building(76, 108, 9, 7, 3.6, 'dark'); w.building(44, 92, 8, 7, 3.4, 'concrete');
      w.box(60, 2.75, 100, 14, .15, 12, 'sand');
      w.box(182, 2.76, -162, 40, .2, 36, 'asphalt'); w.silo(182, -162);
      w.building(202, -176, 11, 9, 5, 'concrete'); w.aerial(164, -146);
      w.box(150, 2.7, -120, 18, .16, 18, 'asphalt');
      w.solarField(-120, 100, -80, 124);
      w.building(-192, -140, 12, 10, 5.2, 'dark'); w.aerial(-176, -124);
      w.building(212, 152, 9, 8, 4, 'cream', 'rust'); w.building(20, -190, 8, 7, 3.6, 'concrete');
      for (const [x, z] of [[-140, 60], [-90, -20], [40, -60], [120, 90], [-10, 120]]) w.building(x, z, 6, 7, 3.2, 'cream', 'rust');
    },
  },
  {
    id: 'highway', name: 'GLASS HIGHWAY', region: 'COAST ROAD', limit: 340, seed: 4404,
    tagline: 'KEEP THE COLUMN ROLLING.',
    intro: ['A relief column with no cover.', 'A staff car running for the border.', 'And a bridge that should not be there tomorrow.'],
    islands: archipelago([
      { x: -40, z: 0, radius: 158, points: 20, jitter: .18, squash: .52 },
      { x: 206, z: -124, radius: 62, points: 12 },
      { x: -238, z: 146, radius: 56, points: 11 },
      { x: 126, z: 156, radius: 52, points: 11 },
      { x: -150, z: -180, radius: 48, points: 10 },
      { x: 250, z: 80, radius: 44, points: 10 },
    ], 4404),
    ridges: [[-150, 20, 18, 13], [60, -30, 16, 12], [206, -124, 17, 14], [-238, 146, 15, 11]],
    rocks: { count: 48, x: [-332, 332], z: [-332, 332] },
    scatter: { count: 1000, x: [-330, 330], z: [-330, 330] },
    base: { x: -238, z: 146, radius: 13, pad: 11, letter: 'H' },
    depots: [{ x: 40, z: -10, radius: 8, pad: 7.6, letter: 'F' }],
    zones: { town: { x: -120, z: 10, radius: 9 } },
    clearings: [{ x: 40, z: -10 }, { x: -120, z: 10 }, { x: 80, z: -20, clear: 26 }],
    spare: (x, z) => Math.abs(z - (x * 0.1 - 6)) < 10 && x > -210 && x < 150,
    labels: [[-238, 176, 'HOMEPLATE'], [-120, 40, 'GLASSTOWN'], [40, 16, 'RELIEF DEPOT'],
      [80, -48, 'HIGHWAY BRIDGE'], [206, -158, 'BORDER POST'], [124, 16, 'FERRY RAMP']],
    spans: [[-200, -26, 140, 8]],
    route: [{ x: -238, z: 146 }, { x: -180, z: 4 }, { x: 40, z: -10 }, { x: 80, z: -20 }, { x: 206, z: -124 }, { x: -120, z: 10 }, { x: -238, z: 146 }],
    friendlies: [
      ['relief', 'truck', -178, 6, { path: [{ x: -150, z: 12 }, { x: -80, z: 2 }, { x: -10, z: -6 }, { x: 36, z: -10 }], speed: 7 }],
      ['relief-bus', 'bus', -170, 18, { path: [{ x: -156, z: 22 }, { x: -86, z: 12 }, { x: -16, z: 4 }, { x: 32, z: -2 }], speed: 6.6 }],
    ],
    enemies: [
      ['road-turret-a', 'turret', -140, -12, { road: true }],
      ['road-turret-b', 'turret', -70, 16, { road: true }],
      ['road-tank-a', 'tank', -30, 8, { road: true, patrol: [{ x: -30, z: 8 }, { x: 10, z: -16 }] }],
      ['road-sam', 'sam', -100, -30, { road: true }],
      ['highway-bridge', 'bridge', 80, -20],
      ['bridge-turret', 'turret', 96, -8],
      ['staff-car', 'truck', 44, -26, { escape: [{ x: 76, z: -18 }, { x: 104, z: -8 }, { x: 124, z: -2 }] }],
      ['staff-escort', 'tank', 70, -20],
      ['town-turret-a', 'turret', -136, 24, { townguard: true }],
      ['town-turret-b', 'turret', -104, -4, { townguard: true }],
      ['border-sam', 'sam', 206, -124],
      ['border-turret', 'turret', 224, -140],
      ['border-radar', 'radar', 190, -140],
      ['islet-turret', 'turret', 126, 156],
      ['north-turret', 'turret', -150, -180],
      ['east-turret', 'turret', 250, 80],
      ['road-fuel-a', 'crate', -60, -6, { explosive: true }],
      ['road-fuel-b', 'crate', 96, -12, { explosive: true }],
      ['depot-tank', 'tank', 56, -22],
    ],
    start: 'Hawk, the relief column is rolling with no cover. Clear the road ahead of it and keep it alive to the depot.',
    objectives: [
      {
        kind: 'escort', unit: 'relief', label: 'ESCORT THE RELIEF COLUMN', short: 'COLUMN',
        detail: 'Work ahead of the trucks. Anything on the road shoots at them, not you.',
        failReason: 'The column burned on the coast road. Fly ahead of it and clear the guns before it reaches them.',
        reward: 900, next: 'Column is at the depot. Now a staff car is running for the border with the fleet codes. Stop it.',
      },
      {
        kind: 'intercept', target: 'staff-car', label: 'STOP THE STAFF CAR', short: 'STAFF CAR',
        detail: 'It is running east for the ferry ramp at the point. Cut the angle; do not chase it from behind.',
        failReason: 'It made the ferry ramp. Next time cut the angle with seekers instead of following the dust.',
        reward: 1000, next: 'Car is stopped and the codes are ours. Drop the highway bridge so nothing follows it.',
      },
      {
        kind: 'destroy', targets: ['highway-bridge'], at: { x: 80, z: -20 }, label: 'DROP THE HIGHWAY BRIDGE', short: 'BRIDGE',
        detail: 'Three spans on concrete piers. Put rockets into the middle.',
        reward: 800, next: 'Bridge is down. Last thing: three civilians still in Glasstown. Get them out.',
      },
      {
        kind: 'rescue', zone: 'town', count: 3, guardTag: 'townguard', noun: 'CIVILIAN', short: 'CIVILIANS',
        label: 'WINCH THE CIVILIANS', detail: 'Hover over the beacon in Glasstown and hold the winch.',
        blockedLabel: 'CLEAR GLASSTOWN', blockedDetail: 'Two positions still cover the square.',
        reward: 500, next: 'All three aboard. Set them down at the relief depot.',
      },
      {
        kind: 'deliver', to: 'F', count: 3, label: 'HAND OVER AT THE DEPOT', short: 'CARGO',
        detail: 'Land on the green pad and hold to hand them over.',
        handover: 'They are with the column now. Come home.', reward: 400, next: 'Good work. Bring it home.',
      },
      { kind: 'extract', label: 'RETURN TO HOMEPLATE', short: 'EXTRACTION · HOMEPLATE', detail: 'Hover above the H and hold to land.' },
    ],
    build(w) {
      w.hangar(-238, 146, 22, 16); w.box(-238, 2.7, 162, 28, .18, 13, 'asphalt');
      w.road([-210, 86], [-196, 30]);
      w.road([-200, 26], [-120, 12]); w.road([-120, 12], [-40, 2]); w.road([-40, 2], [40, -10]);
      w.road([40, -10], [66, -18]); w.road([94, -24], [150, -58]); w.road([150, -58], [200, -120]);
      w.box(40, 2.7, -10, 22, .16, 22, 'asphalt'); w.container(24, 2, 'rust'); w.container(24, 12, 'cream');
      w.building(58, -4, 12, 9, 4.6, 'concrete'); w.crane(20, -24);
      w.bridge(80, -20, 34);
      w.box(-120, 2.74, 10, 34, .18, 30, 'asphalt'); w.fence(-120, 10, 32, 28);
      w.building(-136, 2, 10, 8, 4.4, 'cream', 'rust'); w.building(-104, 20, 9, 8, 4, 'dark');
      w.building(-120, -8, 8, 7, 3.6, 'concrete'); w.box(-120, 2.75, 10, 12, .15, 10, 'sand');
      w.box(206, 2.76, -124, 32, .2, 28, 'asphalt'); w.fence(206, -124, 30, 26);
      w.building(222, -138, 11, 9, 5, 'dark'); w.aerial(190, -108);
      w.building(126, 156, 9, 8, 4, 'cream', 'rust'); w.building(-150, -180, 9, 8, 4, 'concrete');
      w.building(250, 80, 8, 7, 3.6, 'dark');
      w.solarField(-70, 30, -30, 54);
      for (const [x, z] of [[-170, -30], [-60, 40], [10, -40], [120, -60], [160, 20]]) w.building(x, z, 6, 7, 3.2, 'cream', 'rust');
    },
  },
  {
    id: 'fortress', name: 'IRON FORTRESS', region: 'FORTRESS ISLAND', limit: 360, seed: 5505,
    tagline: 'ONE WAY IN. BRING EVERYONE OUT.',
    intro: ['Three shield nodes.', 'One silo with the clock running.', 'And the man who started all of this.'],
    islands: archipelago([
      { x: 0, z: -60, radius: 126, points: 17, jitter: .2 },
      { x: -244, z: 186, radius: 60, points: 12 },
      { x: 236, z: 124, radius: 54, points: 11 },
      { x: -206, z: -206, radius: 48, points: 10 },
      { x: 186, z: -246, radius: 46, points: 10 },
      { x: -60, z: 200, radius: 52, points: 11 },
    ], 5505),
    ridges: [[-70, -110, 20, 16], [64, -120, 19, 15], [0, 10, 18, 13], [-244, 186, 16, 12], [236, 124, 15, 11]],
    rocks: { count: 50, x: [-352, 352], z: [-352, 352] },
    scatter: { count: 1000, x: [-350, 350], z: [-350, 350] },
    base: { x: -206, z: 286, radius: 13, pad: 11, letter: 'H', carrier: true },
    depots: [
      { x: 236, z: 124, radius: 8, pad: 7.6, letter: 'F' },
      { x: -60, z: 200, radius: 8, pad: 7.6, letter: 'G' },
    ],
    zones: {},
    clearings: [{ x: 0, z: -60, clear: 34 }, { x: 236, z: 124 }, { x: -60, z: 200 }],
    labels: [[-206, 316, 'HOMEPLATE'], [0, -20, 'THE FORTRESS'], [-84, -96, 'NODE ONE'],
      [70, -96, 'NODE TWO'], [0, -140, 'NODE THREE'], [236, 154, 'EAST SUPPLY'], [-60, 230, 'SOUTH SUPPLY']],
    route: [{ x: -206, z: 286 }, { x: -84, z: -96 }, { x: 70, z: -96 }, { x: 0, z: -140 }, { x: 0, z: -60 }, { x: -206, z: 286 }],
    enemies: [
      ['node-one', 'generator', -84, -96, { node: true }],
      ['node-two', 'generator', 70, -96, { node: true }],
      ['node-three', 'generator', 0, -140, { node: true }],
      ['iron-silo', 'silo', 0, -60, { shieldedBy: 'node' }],
      ['commander', 'officer', -26, -34, { capturable: true }],
      ['fortress-sam-a', 'sam', -40, -80],
      ['fortress-sam-b', 'sam', 40, -80],
      ['fortress-sam-c', 'sam', 0, -104],
      ['fortress-turret-a', 'turret', -20, -44],
      ['fortress-turret-b', 'turret', 20, -44],
      ['fortress-turret-c', 'turret', -56, -126],
      ['fortress-turret-d', 'turret', 56, -126],
      ['fortress-tank-a', 'tank', -64, -46, { patrol: [{ x: -64, z: -46 }, { x: -96, z: -70 }] }],
      ['fortress-tank-b', 'tank', 64, -46, { patrol: [{ x: 64, z: -46 }, { x: 96, z: -70 }] }],
      ['fortress-radar', 'radar', 0, -8],
      ['outer-sam-a', 'sam', -206, -206],
      ['outer-sam-b', 'sam', 186, -246],
      ['outer-turret-a', 'turret', 252, 142],
      ['outer-turret-b', 'turret', -44, 216],
      ['node-fuel-a', 'fueltank', -76, -108, { explosive: true }],
      ['node-fuel-b', 'fueltank', 78, -108, { explosive: true }],
      ['silo-fuel', 'fueltank', 16, -72, { explosive: true }],
      ['fortress-boat', 'boat', -140, 60, { patrol: [{ x: -140, z: 60 }, { x: -60, z: 120 }] }],
      ['fortress-boat-b', 'boat', 150, 40, { patrol: [{ x: 150, z: 40 }, { x: 90, z: 110 }] }],
    ],
    start: 'This is the one, Hawk. Three shield nodes around the silo. Break all three before anything can touch it.',
    objectives: [
      {
        kind: 'destroyTag', tag: 'node', label: 'BREAK THE FORTRESS SHIELD', short: 'SHIELD NODES',
        detail: 'Three nodes ring the silo. The silo is untouchable while any of them stands.',
        reward: 900, next: 'Shield is down and they know it. The silo is live: you have five and a half minutes.',
      },
      {
        kind: 'destroy', targets: ['iron-silo'], blockedShort: 'SHIELD NODES', at: { x: 0, z: -60 },
        label: 'DESTROY THE SILO', short: 'THE SILO', detail: 'Seekers into the cap. Keep moving; everything in there is pointed up.',
        blockedLabel: 'THE SILO IS SHIELDED', blockedDetail: 'Break all three nodes before the silo can be damaged.',
        timer: { seconds: 330, title: 'THE SILO FIRED', reason: 'You ran out of clock. Break the three nodes on the way in, then put seekers straight into the cap.' },
        reward: 1600, next: 'Silo is glass. One more thing: the man who ordered it is on the pad below you. Bring him in alive.',
      },
      {
        kind: 'capture', target: 'commander', noun: 'COMMANDER', short: 'COMMANDER',
        label: 'TAKE THE COMMANDER ALIVE', detail: 'Hover over him and hold the winch. Do not fire on him.',
        aboard: 'He is aboard. Get him out before the island wakes up.',
        reward: 1400, next: 'Go home, Hawk. All of it is over.',
      },
      { kind: 'extract', label: 'BRING HIM HOME', short: 'EXTRACTION · HOMEPLATE', detail: 'Hover above the carrier deck and hold to land.' },
    ],
    build(w) {
      w.carrier(-206, 286);
      w.box(0, 2.76, -60, 54, .22, 50, 'asphalt'); w.silo(0, -60);
      w.fence(0, -60, 58, 54);
      w.road([-70, -96], [-20, -70]); w.road([20, -70], [64, -96]); w.road([0, -110], [0, -86]);
      for (const [x, z] of [[-84, -96], [70, -96], [0, -140]]) { w.box(x, 2.74, z, 22, .18, 22, 'asphalt'); w.fence(x, z, 24, 24); }
      w.building(-30, -12, 14, 10, 5.4, 'dark'); w.building(30, -12, 12, 9, 5, 'concrete');
      w.building(-26, -34, 10, 8, 4, 'cream'); w.hangar(60, -20, 22, 16);
      w.container(-46, -20, 'rust'); w.container(-46, -10, 'roof'); w.container(46, -30, 'cream');
      w.aerial(-10, -20); w.aerial(14, -120); w.crane(-96, -60);
      w.box(236, 2.7, 124, 20, .16, 20, 'asphalt'); w.box(-60, 2.7, 200, 20, .16, 20, 'asphalt');
      w.hangar(-244, 186, 22, 16);
      w.building(-206, -206, 11, 9, 5, 'dark'); w.building(186, -246, 10, 9, 4.6, 'concrete');
      w.solarField(-60, -160, -20, -136);
      w.oilRig(180, -60);
      for (const [x, z] of [[-120, -140], [100, -150], [-40, 40], [90, 20], [-150, -40]]) w.building(x, z, 6, 7, 3.2, 'cream', 'rust');
    },
  },
];

export const levelIndexById = id => LEVELS.findIndex(l => l.id === id);
