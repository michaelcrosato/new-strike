// Open-world combat: what you shoot with, what shoots back, and where it comes from.
//
// No THREE and no DOM. Hostiles are spawned deterministically per chunk from the same seed
// as the terrain, simulated only while you are near them, and remembered once destroyed —
// so the region has teeth without holding ten thousand entities in memory.

import { WORLD, chunkKey, FACTIONS } from './worldgen.js';

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

function hash(x, z, salt) {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(salt, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- weapons
// What is bolted on depends on the hardpoint fitting, so the opening airframe really does
// only have the door gun.
export const WEAPONS = [
  { id: 'gun', name: 'DOOR GUN', short: 'GUN', hardpoint: 1, max: 900, cooldown: 0.09,
    damage: 9, speed: 150, range: 62, spread: 0.02 },
  { id: 'rockets', name: 'ROCKET PODS', short: 'RCKT', hardpoint: 2, max: 38, cooldown: 0.42,
    damage: 64, speed: 92, range: 72, splash: 8 },
  { id: 'seekers', name: 'SEEKERS', short: 'SEEK', hardpoint: 3, max: 8, cooldown: 0.9,
    damage: 170, speed: 74, range: 92, splash: 6, homing: true },
];
export const availableWeapons = heli => WEAPONS.filter(w => w.hardpoint <= heli.hardpoint);

// ---------------------------------------------------------------- hostiles
export const HOSTILE_TYPES = {
  checkpoint: { hp: 110, range: 46, rate: 2.6, damage: 8, score: 140, radius: 3.4, height: 3, moves: false },
  technical: { hp: 95, range: 42, rate: 2.1, damage: 7, score: 180, radius: 3, height: 2.6, moves: true, speed: 7 },
  aa: { hp: 150, range: 78, rate: 4.6, damage: 19, score: 320, radius: 3.4, height: 3.4, moves: false, missile: true },
  patrolboat: { hp: 130, range: 52, rate: 3.2, damage: 9, score: 220, radius: 3.4, height: 1.4, moves: true, speed: 9, water: true },
  radar: { hp: 190, range: 0, rate: 0, damage: 0, score: 420, radius: 5, height: 8, moves: false },
  depot: { hp: 260, range: 0, rate: 0, damage: 0, score: 560, radius: 6, height: 5, moves: false, explosive: true },
};

// How dangerous a faction's ground is to you right now. Neutral parties tolerate a rotor
// overhead; the ones you have crossed do not.
export function hostilityToward(profile, factionKey) {
  const standing = profile?.standing?.[factionKey] ?? 0;
  if (standing <= -45) return 1;          // shoot on sight
  if (standing <= -12) return 0.45;       // will engage if you linger
  return 0;                               // leaves you alone
}

// Deterministic garrison for one chunk. Returns descriptors, not live entities.
export function garrisonInChunk(world, cx, cz, { seed = world.seed } = {}) {
  const out = [];
  const centreX = (cx + 0.5) * WORLD.chunk, centreZ = (cz + 0.5) * WORLD.chunk;
  if (Math.abs(centreX) > WORLD.half + WORLD.chunk || Math.abs(centreZ) > WORLD.half + WORLD.chunk) return out;
  const home = world.home;
  if (Math.hypot(centreX - home.x, centreZ - home.z) < 150) return out;   // your own ground stays quiet

  const sites = world.settlementsNear(centreX, centreZ, WORLD.chunk);
  const threat = sites.reduce((max, s) => Math.max(max, s.threat), 0);
  const count = Math.min(4, Math.floor(hash(cx, cz, seed + 9001) * (1.4 + threat * 1.1)));
  for (let i = 0; i < count; i++) {
    const rx = hash(cx * 71 + i, cz * 131, seed + 9011);
    const rz = hash(cx * 137, cz * 53 + i, seed + 9017);
    const x = (cx + 0.1 + rx * 0.8) * WORLD.chunk, z = (cz + 0.1 + rz * 0.8) * WORLD.chunk;
    const ground = world.elevation(x, z);
    const roll = hash(cx + i * 7, cz + i * 13, seed + 9023);
    const afloat = ground <= WORLD.seaLevel;
    let type;
    if (afloat) { if (roll > 0.55) continue; type = 'patrolboat'; }
    else if (world.slope(x, z) > 0.5) continue;
    else if (roll < 0.34) type = 'checkpoint';
    else if (roll < 0.58) type = 'technical';
    else if (roll < 0.74) type = 'aa';
    else if (roll < 0.86) type = 'radar';
    else type = 'depot';
    const spec = HOSTILE_TYPES[type];
    if (spec.water !== true && afloat) continue;
    const site = sites[0];
    out.push({
      id: `h${cx}_${cz}_${i}`, type, x, z,
      y: afloat ? 1.4 : world.groundHeight(x, z, sites) + spec.height * 0.4,
      faction: site ? site.faction : Math.max(0, world.factionAt(x, z)),
      site: site?.id ?? null,
    });
  }
  return out;
}

// Live combat state. The hostile list is rebuilt from resident chunks; the destroyed set
// lives on the profile so a garrison you flattened stays flat.
export function createCombat(profile) {
  return {
    hostiles: [], projectiles: [], destroyed: profile.destroyed ?? (profile.destroyed = []),
    nextId: 1, kills: 0, shotsFired: 0, hits: 0,
    armour: 100, maxArmour: 60 + profile.heli.armour * 40,
    fuel: 100, maxFuel: 70 + profile.heli.tank * 30,
    ammo: {}, weapon: 0, cooldown: 0, alert: 0, lastHit: 0, flareCooldown: 0, invulnerable: 0, provoked: false,
    events: [],
  };
}
export function rearm(combat, profile) {
  combat.armour = combat.maxArmour = 60 + profile.heli.armour * 40;
  combat.fuel = combat.maxFuel = 70 + profile.heli.tank * 30;
  for (const w of availableWeapons(profile.heli)) combat.ammo[w.id] = w.max;
  combat.weapon = 0;
}
const emit = (combat, type, data) => combat.events.push({ type, ...data });

// Reconciles the live hostile list with whatever chunks are resident.
export function syncHostiles(combat, world, profile, residentKeys) {
  const wanted = new Map();
  for (const key of residentKeys) {
    const [cx, cz] = key.split(':').map(Number);
    for (const spec of garrisonInChunk(world, cx, cz)) {
      if (combat.destroyed.includes(spec.id)) continue;
      wanted.set(spec.id, spec);
    }
  }
  // Keep the ones still in range so their damage and position survive; drop the rest.
  combat.hostiles = combat.hostiles.filter(h => wanted.has(h.id) && !h.dead);
  const live = new Set(combat.hostiles.map(h => h.id));
  for (const [id, spec] of wanted) {
    if (live.has(id)) continue;
    const stats = HOSTILE_TYPES[spec.type];
    combat.hostiles.push({ ...spec, hp: stats.hp, maxHp: stats.hp, cooldown: 1 + hash(id.length, id.length * 7, 3) * 2,
      dead: false, yaw: 0, home: { x: spec.x, z: spec.z } });
  }
  return combat.hostiles.length;
}

export function selectTarget(combat, craft, profile) {
  const weapon = WEAPONS[combat.weapon];
  let best = null, bestValue = Infinity;
  for (const h of combat.hostiles) {
    if (h.dead) continue;
    const d = distance(h, craft);
    if (d > weapon.range) continue;
    const bearing = Math.atan2(h.x - craft.x, -(h.z - craft.z));
    const off = Math.abs(angleDelta(craft.yaw, bearing));
    if (off > 1.5 && d > 22) continue;
    const value = d * (0.5 + off * 0.5);
    if (value < bestValue) { bestValue = value; best = h; }
  }
  combat.target = best?.id ?? null;
  return best;
}

export function fire(combat, craft, target) {
  const weapon = WEAPONS[combat.weapon];
  if (combat.cooldown > 0) return false;
  if ((combat.ammo[weapon.id] ?? 0) < 1) { combat.cooldown = 0.6; emit(combat, 'empty', { weapon: weapon.id }); return false; }
  combat.ammo[weapon.id]--; combat.cooldown = weapon.cooldown; combat.shotsFired++;
  const heading = target ? Math.atan2(target.x - craft.x, -(target.z - craft.z)) : craft.yaw;
  const spread = weapon.spread ? (Math.random() - 0.5) * weapon.spread * 2 : 0;
  const dx = Math.sin(heading + spread), dz = -Math.cos(heading + spread);
  const dist = target ? distance(craft, target) : 55;
  const slope = ((target ? target.y + 1 : 2) - craft.y) / Math.max(dist, 8);
  combat.projectiles.push({
    id: combat.nextId++, x: craft.x + dx * 4, y: craft.y - 0.5, z: craft.z + dz * 4,
    vx: dx * weapon.speed, vz: dz * weapon.speed, vy: slope * weapon.speed,
    life: weapon.range / weapon.speed + 0.2, damage: weapon.damage, splash: weapon.splash ?? 0,
    homing: weapon.homing ? target?.id : null, weapon: combat.weapon, hostile: false,
  });
  emit(combat, 'shot', { weapon: combat.weapon, x: craft.x + dx * 4, y: craft.y, z: craft.z + dz * 4 });
  return true;
}

function damageHostile(combat, hostile, amount, chain = false) {
  if (hostile.dead) return;
  hostile.hp -= amount;
  emit(combat, 'hit', { x: hostile.x, y: hostile.y + 1, z: hostile.z });
  if (hostile.hp > 0) return;
  hostile.dead = true; combat.kills++;
  combat.destroyed.push(hostile.id);
  const spec = HOSTILE_TYPES[hostile.type];
  emit(combat, 'destroyed', { id: hostile.id, unit: hostile.type, faction: hostile.faction,
    x: hostile.x, y: hostile.y, z: hostile.z, size: spec.explosive ? 2.6 : 1.4, score: spec.score });
  if (spec.explosive && !chain) {
    for (const other of combat.hostiles) if (!other.dead && distance(other, hostile) < 16) damageHostile(combat, other, 120, true);
  }
}
export { damageHostile };

function hostileFire(combat, hostile, craft) {
  const spec = HOSTILE_TYPES[hostile.type];
  const dx = craft.x - hostile.x, dz = craft.z - hostile.z;
  const len = Math.max(0.1, Math.hypot(dx, dz));
  const speed = spec.missile ? 30 : 42;
  combat.projectiles.push({
    id: combat.nextId++, x: hostile.x, y: hostile.y + 2, z: hostile.z,
    vx: dx / len * speed, vz: dz / len * speed, vy: (craft.y - hostile.y - 2) / len * speed,
    life: 4.5, damage: spec.damage, hostile: true, homing: spec.missile ? 'craft' : null,
  });
  if (spec.missile) emit(combat, 'incoming', { x: hostile.x, z: hostile.z });
}

// One step of combat. `craft` carries x/y/z/yaw; input carries fire/flare/weapon.
export function stepCombat(combat, world, profile, craft, input, dt) {
  combat.events.length = 0;
  dt = clamp(dt, 0, 0.05);
  combat.cooldown = Math.max(0, combat.cooldown - dt);
  combat.alert = Math.max(0, combat.alert - dt);
  combat.lastHit = Math.max(0, combat.lastHit - dt);

  const target = selectTarget(combat, craft, profile);
  if (input.fire) fire(combat, craft, target);

  for (const h of combat.hostiles) {
    if (h.dead) continue;
    const spec = HOSTILE_TYPES[h.type];
    const d = distance(h, craft);
    if (spec.moves && d < 220) {
      // Wanderers patrol around where they spawned rather than converging on you.
      const angle = Math.atan2(h.home.z - h.z, h.home.x - h.x);
      const wander = Math.sin((h.x + h.z) * 0.01 + combat.nextId * 0.0001) * 0.6;
      const away = distance(h, h.home);
      const move = spec.speed * dt;
      if (away > 34) { h.x += Math.cos(angle) * move; h.z += Math.sin(angle) * move; }
      else { h.x += Math.cos(wander * 6) * move * 0.5; h.z += Math.sin(wander * 6) * move * 0.5; }
      if (!spec.water) h.y = world.groundHeight(h.x, h.z) + spec.height * 0.4;
    }
    if (!spec.range) continue;
    // Clamped so a garrison you approach gets one prompt shot rather than being
    // infinitely ready after you have ignored it for a minute.
    h.cooldown = Math.max(-1, h.cooldown - dt);
    const faction = FACTIONS[h.faction];
    const willEngage = hostilityToward(profile, faction?.key) > 0 || combat.provoked;
    if (!willEngage || d > spec.range) continue;
    h.yaw = Math.atan2(craft.x - h.x, -(craft.z - h.z));
    if (h.cooldown <= 0) {
      hostileFire(combat, h, craft);
      h.cooldown = spec.rate * (0.85 + hostilityToward(profile, faction?.key) * 0.3);
      combat.alert = 4;
    }
  }

  if (input.flare && combat.flareCooldown <= 0) {
    combat.flareCooldown = 8;
    for (const p of combat.projectiles) if (p.hostile && p.homing && distance(p, craft) < 70) p.life = 0;
    emit(combat, 'flare', { x: craft.x, y: craft.y, z: craft.z });
  }
  combat.flareCooldown = Math.max(0, (combat.flareCooldown ?? 0) - dt);

  for (let i = combat.projectiles.length - 1; i >= 0; i--) {
    const p = combat.projectiles[i];
    p.life -= dt;
    if (p.life <= 0) { combat.projectiles.splice(i, 1); continue; }
    if (p.homing && p.homing !== 'craft') {
      const h = combat.hostiles.find(x => x.id === p.homing && !x.dead);
      if (h) {
        const dx = h.x - p.x, dz = h.z - p.z, d = Math.max(0.1, Math.hypot(dx, dz));
        const f = 1 - Math.exp(-6 * dt);
        p.vx += (dx / d * 74 - p.vx) * f; p.vz += (dz / d * 74 - p.vz) * f;
        p.vy += ((h.y + 1 - p.y) / d * 74 - p.vy) * f;
      }
    } else if (p.homing === 'craft') {
      const dx = craft.x - p.x, dz = craft.z - p.z, d = Math.max(0.1, Math.hypot(dx, dz));
      const f = 1 - Math.exp(-1.4 * dt);
      p.vx += (dx / d * 30 - p.vx) * f; p.vz += (dz / d * 30 - p.vz) * f; p.vy += ((craft.y - p.y) / d * 30 - p.vy) * f;
    }
    const oldX = p.x, oldZ = p.z;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    if (p.hostile) {
      if (distance(p, craft) < 3.2 && Math.abs(p.y - craft.y) < 4.5) {
        hitCraft(combat, p.damage, profile);
        p.life = 0;
      }
    } else {
      for (const h of combat.hostiles) {
        if (h.dead) continue;
        const spec = HOSTILE_TYPES[h.type];
        const sx = p.x - oldX, sz = p.z - oldZ;
        const t = clamp(((h.x - oldX) * sx + (h.z - oldZ) * sz) / Math.max(0.001, sx * sx + sz * sz), 0, 1);
        const miss = Math.hypot(h.x - oldX - t * sx, h.z - oldZ - t * sz);
        if (miss < spec.radius + 0.6 && p.y < h.y + spec.height + 4) {
          combat.hits++;
          damageHostile(combat, h, p.damage);
          // Shooting anyone makes their whole faction take an interest.
          combat.provoked = true;
          if (p.splash) {
            emit(combat, 'blast', { x: p.x, y: p.y, z: p.z, size: 0.8 });
            for (const other of combat.hostiles) if (other !== h && !other.dead && distance(other, p) < p.splash) damageHostile(combat, other, p.damage * 0.5);
          }
          p.life = 0;
          break;
        }
      }
    }
    if (p.y < 0.3) { if (p.weapon > 0) emit(combat, 'splash', { x: p.x, z: p.z }); p.life = 0; }
  }
  return combat.events;
}

export function hitCraft(combat, damage, profile) {
  if (combat.invulnerable > 0) return;
  combat.armour = Math.max(0, combat.armour - damage);
  combat.lastHit = 1;
  combat.invulnerable = 0.14;
  emit(combat, 'craftHit', { damage, armour: combat.armour });
  if (combat.armour <= 0) emit(combat, 'downed', {});
}

// Standing consequences of what you shot. Destroying a faction's hardware is the fastest
// way to make an enemy, which is the whole point of the region.
export function combatStandingDeltas(events) {
  const deltas = {};
  for (const event of events) {
    if (event.type !== 'destroyed') continue;
    const faction = FACTIONS[event.faction];
    if (!faction) continue;
    deltas[faction.key] = (deltas[faction.key] ?? 0) - 2;
  }
  return deltas;
}
