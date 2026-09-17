// The player's outfit: money, crew, airframe, base, standing with the factions, and the
// contracts that flow from all of it.
//
// Pure data and pure functions. The world is generated, so contracts are generated too —
// from the settlements that actually exist, the factions that actually hold them, and the
// standing you have actually earned. Nothing here touches the renderer or the DOM.

import { FACTIONS, WORLD } from './worldgen.js';

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

// ---------------------------------------------------------------- standing
export const STANDING_BANDS = [
  { at: -100, key: 'hostile', label: 'HOSTILE', blurb: 'Shoot on sight.' },
  { at: -45, key: 'wary', label: 'WARY', blurb: 'Watched, not welcome.' },
  { at: -12, key: 'neutral', label: 'NEUTRAL', blurb: 'Just another rotor for hire.' },
  { at: 18, key: 'working', label: 'WORKING', blurb: 'They call when it is dirty.' },
  { at: 48, key: 'trusted', label: 'TRUSTED', blurb: 'They call first.' },
  { at: 78, key: 'allied', label: 'ALLIED', blurb: 'Their problems are your problems.' },
];
export function standingBand(value) {
  let band = STANDING_BANDS[0];
  for (const candidate of STANDING_BANDS) if (value >= candidate.at) band = candidate;
  return band;
}

// Who hates whom. Acting against a faction earns credit with its rivals, which is the
// engine that stops the player staying neutral.
export const RIVALRY = {
  freehold: { cordon: -0.2, ashwind: 0.1, meridian: -0.45, saltroad: 0.15 },
  cordon: { freehold: -0.15, ashwind: -0.6, meridian: 0.3, saltroad: -0.5 },
  ashwind: { cordon: -0.6, freehold: 0.2, meridian: -0.4, saltroad: 0.35 },
  meridian: { freehold: -0.4, cordon: 0.3, ashwind: -0.35, saltroad: 0.1 },
  saltroad: { cordon: -0.5, ashwind: 0.3, freehold: 0.1, meridian: 0.15 },
};

// ---------------------------------------------------------------- crew
// You start with one other person. She runs the radio, the books and the yard, and she
// has no interest in your feelings about any of it.
export const STARTING_CREW = [{
  id: 'quill', name: 'MARGIT QUILL', short: 'QUILL', role: 'RADIO & BASE MANAGER',
  wage: 0, hired: true,
  voice: 'flat',
  blurb: 'Twenty years of other people\'s wars. Keeps the books, the frequencies and your feet on the ground.',
}];

export const HIREABLE = [
  { id: 'okonkwo', name: 'DANIEL OKONKWO', short: 'OKONKWO', role: 'AIRFRAME MECHANIC', cost: 4200, wage: 260,
    requires: { workshop: 1 }, effect: { repairRate: 1.6 }, blurb: 'Keeps the rotor on. Charges for it.' },
  { id: 'vey', name: 'SASKIA VEY', short: 'VEY', role: 'FIXER', cost: 6800, wage: 420,
    requires: { radio: 1 }, effect: { contractSlots: 2, payMultiplier: 1.12 }, blurb: 'Knows who is lying and by how much.' },
  { id: 'brandt', name: 'ILYA BRANDT', short: 'BRANDT', role: 'DOOR GUNNER', cost: 5400, wage: 340,
    requires: { hangar: 1 }, effect: { suppression: 1 }, blurb: 'Talks to nobody. Hits everything.' },
  { id: 'sunday', name: 'GRACE SUNDAY', short: 'SUNDAY', role: 'FIELD MEDIC', cost: 5100, wage: 300,
    requires: { pad: 2 }, effect: { rescueValue: 1.35 }, blurb: 'Rescues arrive alive, which pays better.' },
];

// ---------------------------------------------------------------- upgrades
export const UPGRADES = [
  { id: 'pad', name: 'LANDING PAD', kind: 'base', max: 3, cost: [1200, 3200, 9800],
    describe: n => ['Bare dirt.', 'A flattened patch of dirt.', 'Poured concrete and a windsock.', 'Lit pad with a fuel line.'][n] },
  { id: 'fuel', name: 'FUEL BOWSER', kind: 'base', max: 3, cost: [900, 2600, 7400],
    describe: n => ['Siphoning from drums.', 'Jerry cans.', 'A leased bowser.', 'Buried tank and a pump.'][n] },
  { id: 'workshop', name: 'WORKSHOP', kind: 'base', max: 3, cost: [1500, 4800, 12500],
    describe: n => ['Repairs in the open.', 'A tarpaulin and a toolbox.', 'Hard stand with a gantry.', 'Enclosed shop with a parts bin.'][n] },
  { id: 'radio', name: 'RADIO MAST', kind: 'base', max: 3, cost: [1100, 3600, 11000],
    describe: n => ['A handheld set.', 'A whip aerial on the roof.', 'A proper mast. Quill stops swearing.', 'Repeater network across the region.'][n] },
  { id: 'hangar', name: 'HANGAR', kind: 'base', max: 2, cost: [15000, 34000],
    describe: n => ['Open air and hope.', 'Steel frame and a roof.', 'Two bays and a crane.'][n] },
  { id: 'armour', name: 'ARMOUR PLATE', kind: 'heli', max: 3, cost: [1400, 2900, 8200],
    describe: n => ['Bare airframe.', 'Original 1990s panels.', 'Spaced plate on the belly.', 'Full kit, heavier and slower.'][n] },
  { id: 'tank', name: 'LONG RANGE TANK', kind: 'heli', max: 3, cost: [1100, 2400, 6600],
    describe: n => ['Reserve only.', 'Standard tank.', 'Auxiliary cell.', 'Ferry tanks. Smells of kerosene.'][n] },
  { id: 'winch', name: 'RESCUE WINCH', kind: 'heli', max: 2, cost: [1800, 3400],
    describe: n => ['No winch at all.', 'A rope and a prayer.', 'Powered winch with a basket.'][n] },
  { id: 'hardpoint', name: 'HARDPOINTS', kind: 'heli', max: 3, cost: [2100, 5200, 13800],
    describe: n => ['Nothing but the door gun mount.', 'One light pylon.', 'Two light pylons.', 'Four pylons and a sight.'][n] },
];
export const upgrade = id => UPGRADES.find(u => u.id === id);

// ---------------------------------------------------------------- contracts
export const CONTRACT_KINDS = [
  { key: 'survey', name: 'SURVEY', verb: 'Photograph', basePay: 900, risk: 1,
    hostileTarget: false, blurb: 'Hold a scan over the site and come home.' },
  { key: 'delivery', name: 'DELIVERY', verb: 'Run cargo to', basePay: 1200, risk: 1,
    hostileTarget: false, blurb: 'Lift a crate from the yard and set it down intact.' },
  { key: 'extraction', name: 'EXTRACTION', verb: 'Lift people out of', basePay: 2100, risk: 2,
    hostileTarget: false, blurb: 'Winch them aboard and bring them back.' },
  { key: 'salvage', name: 'SALVAGE', verb: 'Recover the wreck near', basePay: 1700, risk: 2,
    hostileTarget: false, blurb: 'Something expensive came down. Bring back what is left.' },
  { key: 'patrol', name: 'PATROL', verb: 'Sweep the approaches to', basePay: 1500, risk: 2,
    hostileTarget: false, blurb: 'Fly the waypoints, report what you see, discourage what you find.' },
  { key: 'escort', name: 'ESCORT', verb: 'Escort the column to', basePay: 2600, risk: 3,
    hostileTarget: false, blurb: 'Keep a slow convoy alive across open ground.' },
  { key: 'strike', name: 'STRIKE', verb: 'Flatten', basePay: 3400, risk: 4,
    hostileTarget: true, blurb: 'Someone wants this stopped and does not care how.' },
  { key: 'interdiction', name: 'INTERDICTION', verb: 'Stop the movement out of', basePay: 3000, risk: 4,
    hostileTarget: true, blurb: 'Something is leaving. It should not arrive.' },
];
export const contractKind = key => CONTRACT_KINDS.find(k => k.key === key);

function hash(n, seed) {
  let h = Math.imul(n ^ seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function createProfile({ seed = 20492, cash = 4800 } = {}) {
  const standing = {};
  for (const f of FACTIONS) standing[f.key] = 0;
  return {
    seed, cash, day: 1, flightHours: 0,
    crew: STARTING_CREW.map(member => ({ ...member })),
    standing,
    base: { pad: 1, fuel: 1, workshop: 1, radio: 1, hangar: 0 },
    heli: { name: 'KESTREL B', armour: 1, tank: 1, winch: 1, hardpoint: 1 },
    ledger: [],
    completed: [], failed: [], active: null, refused: [],
    reputation: 0,
  };
}

// Additive effects (extra contract slots, suppression) sum from zero.
export const crewEffect = (profile, key) =>
  profile.crew.filter(c => c.hired).reduce((total, c) => total + (c.effect?.[key] ?? 0), 0);
// Multiplicative effects (pay, rescue value) compound from one. Keeping these apart
// matters: folding them together once made every payout double.
export const crewMultiplier = (profile, key) =>
  profile.crew.filter(c => c.hired).reduce((factor, c) => factor * (c.effect?.[key] ?? 1), 1);

export function contractSlots(profile) {
  // The radio mast is what lets work find you at all; a fixer brings her own leads.
  return 1 + profile.base.radio + crewEffect(profile, 'contractSlots');
}

// How willing a faction is to put work your way.
export function offersWork(profile, factionKey) {
  return profile.standing[factionKey] > -45;
}

// Generates the board. Deterministic in (profile.seed, day, index) so a reload shows the
// same work, and shaped by standing so the board changes as you pick sides.
export function generateContracts(world, profile, { day = profile.day, count = null } = {}) {
  const slots = count ?? contractSlots(profile);
  const home = world.home;
  const sites = world.settlementsNear(home.x, home.z, WORLD.half * 1.5)
    .filter(site => Math.hypot(site.x - home.x, site.z - home.z) > 60);
  if (!sites.length) return [];
  const out = [];
  for (let i = 0; out.length < slots && i < slots * 12; i++) {
    const roll = n => hash(day * 7919 + i * 131 + n, profile.seed);
    const issuers = FACTIONS.filter(f => offersWork(profile, f.key));
    if (!issuers.length) break;
    const issuer = issuers[Math.floor(roll(1) * issuers.length) % issuers.length];
    const site = sites[Math.floor(roll(2) * sites.length) % sites.length];
    const targetFaction = FACTIONS[site.faction];
    if (!targetFaction) continue;
    // Nobody pays you to bomb their own town, and a faction you are close to will not be
    // offered up as a target either.
    const kinds = CONTRACT_KINDS.filter(kind => {
      if (!kind.hostileTarget) return true;
      if (targetFaction.key === issuer.key) return false;
      if (profile.standing[targetFaction.key] > 40) return false;
      return (RIVALRY[issuer.key]?.[targetFaction.key] ?? 0) < 0;
    });
    const kind = kinds[Math.floor(roll(3) * kinds.length) % kinds.length];
    if (!kind) continue;
    const id = `c${day}_${i}`;
    if (profile.completed.includes(id) || profile.failed.includes(id)) continue;
    if (out.some(c => c.site.id === site.id && c.kind === kind.key)) continue;

    const distance = Math.hypot(site.x - home.x, site.z - home.z);
    const distanceKm = distance * WORLD.metresPerUnit / 1000;
    const standing = profile.standing[issuer.key];
    const risk = kind.risk + site.threat + (profile.standing[targetFaction.key] < -30 ? 1 : 0);
    const payMultiplier = crewMultiplier(profile, 'payMultiplier');
    const pay = Math.round((kind.basePay + distanceKm * 210 + risk * 320)
      * (1 + standing / 260) * (0.9 + roll(4) * 0.35) * payMultiplier / 10) * 10;

    out.push({
      id, kind: kind.key, kindName: kind.name, issuer: issuer.key, issuerName: issuer.name,
      site: { id: site.id, name: site.name, x: site.x, z: site.z, kind: site.kind, kindName: site.kindName,
        faction: site.faction, radius: site.radius, threat: site.threat, height: site.height },
      targetFaction: targetFaction.key,
      hostile: kind.hostileTarget,
      distance, distanceKm: +distanceKm.toFixed(2), risk, pay,
      title: `${kind.verb} ${site.name}`,
      brief: kind.blurb,
      deltas: standingDeltas(issuer.key, targetFaction.key, kind),
      expiresDay: day + 2 + Math.floor(roll(5) * 3),
    });
  }
  return out;
}

// What finishing a job does to the region's opinion of you.
export function standingDeltas(issuerKey, targetKey, kind) {
  const deltas = {};
  const gain = kind.hostileTarget ? 9 : 5;
  deltas[issuerKey] = gain;
  if (kind.hostileTarget && targetKey && targetKey !== issuerKey) {
    deltas[targetKey] = -(gain + 5);
    // Everyone else adjusts according to how they feel about the party you just hit.
    for (const other of FACTIONS) {
      if (other.key === issuerKey || other.key === targetKey) continue;
      const feeling = RIVALRY[other.key]?.[targetKey] ?? 0;
      if (feeling) deltas[other.key] = Math.round(-feeling * gain * 0.6);
    }
  }
  return deltas;
}

export function applyStanding(profile, deltas, scale = 1) {
  const applied = {};
  for (const [key, delta] of Object.entries(deltas)) {
    if (!(key in profile.standing)) continue;
    const before = profile.standing[key];
    profile.standing[key] = clamp(Math.round(before + delta * scale), -100, 100);
    applied[key] = profile.standing[key] - before;
  }
  return applied;
}

export function accept(profile, contract) {
  if (profile.active) return { ok: false, reason: 'One job at a time. Finish this one.' };
  if (!offersWork(profile, contract.issuer)) return { ok: false, reason: 'They are not talking to you.' };
  if (contract.expiresDay < profile.day) return { ok: false, reason: 'That work has gone.' };
  profile.active = { ...contract, acceptedDay: profile.day, progress: 0 };
  return { ok: true, contract: profile.active };
}

export function resolve(profile, { success, bonus = 0, casualties = 0 } = {}) {
  const contract = profile.active;
  if (!contract) return { ok: false, reason: 'No job in hand.' };
  profile.active = null;
  const rescueValue = crewMultiplier(profile, 'rescueValue');
  if (success) {
    const paid = Math.round((contract.pay + bonus) * rescueValue);
    profile.cash += paid;
    profile.completed.push(contract.id);
    profile.reputation += 2 + contract.risk;
    const applied = applyStanding(profile, contract.deltas);
    profile.ledger.push({ day: profile.day, kind: contract.kindName, site: contract.site.name, amount: paid, standing: applied });
    return { ok: true, paid, standing: applied };
  }
  profile.failed.push(contract.id);
  profile.reputation = Math.max(0, profile.reputation - 3);
  // A failure costs you with the client, and the target notices nothing.
  const applied = applyStanding(profile, { [contract.issuer]: -6 - contract.risk });
  const penalty = Math.round(contract.pay * 0.15) + casualties * 400;
  profile.cash = Math.max(0, profile.cash - penalty);
  profile.ledger.push({ day: profile.day, kind: contract.kindName, site: contract.site.name, amount: -penalty, standing: applied });
  return { ok: true, paid: -penalty, standing: applied };
}

export function purchase(profile, id) {
  const spec = upgrade(id);
  if (!spec) return { ok: false, reason: 'No such fitting.' };
  const store = spec.kind === 'base' ? profile.base : profile.heli;
  const level = store[id] ?? 0;
  if (level >= spec.max) return { ok: false, reason: 'Already the best we can fit.' };
  const cost = spec.cost[level];
  if (cost === undefined) return { ok: false, reason: 'Nothing further available.' };
  if (profile.cash < cost) return { ok: false, reason: `Short by ${cost - profile.cash}.` };
  profile.cash -= cost;
  store[id] = level + 1;
  profile.ledger.push({ day: profile.day, kind: 'FITTED', site: spec.name, amount: -cost });
  return { ok: true, level: store[id], cost };
}

export function hire(profile, id) {
  const spec = HIREABLE.find(c => c.id === id);
  if (!spec) return { ok: false, reason: 'Never heard of them.' };
  if (profile.crew.some(c => c.id === id)) return { ok: false, reason: 'Already on the books.' };
  for (const [key, need] of Object.entries(spec.requires ?? {})) {
    if ((profile.base[key] ?? 0) < need) return { ok: false, reason: `Needs ${key} level ${need}.` };
  }
  if (profile.cash < spec.cost) return { ok: false, reason: `Short by ${spec.cost - profile.cash}.` };
  profile.cash -= spec.cost;
  profile.crew.push({ ...spec, hired: true });
  profile.ledger.push({ day: profile.day, kind: 'HIRED', site: spec.short, amount: -spec.cost });
  return { ok: true };
}

// Overnight: wages, one day on the calendar, and a fresh board in the morning.
export function endDay(profile) {
  const wages = profile.crew.reduce((total, c) => total + (c.hired ? c.wage : 0), 0);
  profile.cash = Math.max(0, profile.cash - wages);
  profile.day += 1;
  if (wages) profile.ledger.push({ day: profile.day - 1, kind: 'WAGES', site: 'THE YARD', amount: -wages });
  return { wages, cash: profile.cash, day: profile.day };
}

// What Quill would say about the state of the outfit, because someone has to.
export function situation(profile) {
  const worst = Object.entries(profile.standing).sort((a, b) => a[1] - b[1])[0];
  const best = Object.entries(profile.standing).sort((a, b) => b[1] - a[1])[0];
  const name = key => FACTIONS.find(f => f.key === key)?.short ?? key;
  if (profile.cash < 800) return `Cash is at ${profile.cash}. Take the next thing that pays, whoever is asking.`;
  if (worst[1] <= -45) return `${name(worst[0])} will shoot at you now. Stay out of their ground or make it worth it.`;
  if (best[1] >= 48) return `${name(best[0])} trusts you. That is worth more than the money, and it costs you ${name(worst[0])}.`;
  if (!profile.completed.length) return 'Nothing on the board is beneath us yet. Pick one and fly it.';
  return `${profile.completed.length} jobs done. Nobody loves us, nobody is shooting. Fix that in whichever direction pays.`;
}
