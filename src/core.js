// Deterministic simulation, shared by the renderer and the headless mission tests.
import { LEVELS } from './levels.js';
export { LEVELS };
// The first operation's map, kept as named exports for the deterministic tests.
export const WORLD_LIMIT = LEVELS[0].limit;
export const BASE = LEVELS[0].base;
export const DEPOT = LEVELS[0].depots[0];
export const CAMP = LEVELS[0].zones.camp;
export const WEAPONS = [
  { name: '30MM CANNON', short: 'CANNON', max: 600, cooldown: 0.095, damage: 8, speed: 125, range: 56, spread: 0.012 },
  { name: 'HYDRA ROCKETS', short: 'ROCKETS', max: 36, cooldown: 0.42, damage: 62, speed: 80, range: 64, splash: 7 },
  { name: 'SEEKER MISSILES', short: 'SEEKERS', max: 10, cooldown: 0.8, damage: 150, speed: 65, range: 79, splash: 5, homing: true },
];
export const DIFFICULTIES = {
  recon: { damage: 0.55, fuel: 0.07, enemyRate: 1.35, label: 'RECON' },
  pilot: { damage: 0.85, fuel: 0.10, enemyRate: 1, label: 'PILOT' },
  ace: { damage: 1.2, fuel: 0.15, enemyRate: 0.78, label: 'ACE' },
};
export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export function angleDelta(a, b) { return Math.atan2(Math.sin(b - a), Math.cos(b - a)); }
export function randomGenerator(seed = 2049) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

const makeEnemy = (id, type, x, z, extra = {}) => {
  const stats = {
    radar: [210, 0, 6, 900], turret: [90, 44, 2.9, 150], sam: [120, 69, 5.1, 250],
    tank: [150, 46, 3.8, 250], boat: [110, 50, 3.3, 200], generator: [140, 0, 0, 450],
    command: [620, 76, 3.1, 1800], crate: [18, 0, 0, 40],
    bridge: [400, 0, 0, 1100], silo: [700, 84, 3.4, 2400], fueltank: [55, 0, 0, 220],
    officer: [26, 0, 0, 150], truck: [95, 0, 0, 260],
  }[type];
  return { id, type, x, z, y: type === 'boat' ? 1.4 : type === 'officer' ? 2.8 : 3.5, hp: stats[0], maxHp: stats[0],
    range: stats[1], rate: stats[2], score: stats[3], radius: { command: 7, silo: 7, bridge: 9, radar: 5, crate: 2, fueltank: 2.6, officer: 1.6 }[type] ?? 3,
    yaw: 0, waypoint: 0, cooldown: 1.5 + (id.length % 4) * 0.55, dead: false, ...extra };
};

const makeFriendly = (id, type, x, z, extra = {}) => ({
  id, type, x, z, y: type === 'boat' ? 1.4 : 3.2, hp: 200, maxHp: 200, yaw: 0, waypoint: 0,
  speed: type === 'boat' ? 6.5 : 7.5, dead: false, arrived: false, halted: 0, ...extra });

const buildRoster = (list, make) => (list ?? []).map(([id, type, x, z, extra]) =>
  make(id, type, x, z, { ...extra }));

export function createGame(difficulty = 'pilot', levelIndex = 0) {
  const level = LEVELS[clamp(Math.round(levelIndex) || 0, 0, LEVELS.length - 1)];
  return {
    phase: 'briefing', difficulty, level, levelIndex: LEVELS.indexOf(level),
    limit: level.limit, base: level.base, depots: level.depots, zones: level.zones ?? {},
    time: 0, stage: 0, score: 0, kills: 0, rescued: 0, delivered: 0, captured: 0, aboard: [],
    service: 0, rescue: 0, extraction: 0, recon: 0, supplyVisits: 0, message: '', messageTime: 0,
    objectiveTimer: 0, timerFor: null, nextId: 0, shots: 0, hits: 0, damageTaken: 0, reason: '', flares: 0,
    p: { x: level.base.x, z: level.base.z, y: 8, vx: 0, vz: 0, yaw: -0.26, armor: 100, fuel: 100,
      ammo: WEAPONS.map(w => w.max), weapon: 0, cooldown: 0, flareCooldown: 0, invulnerable: 2, cargo: 0 },
    enemies: buildRoster(level.enemies, makeEnemy),
    friendlies: buildRoster(level.friendlies, makeFriendly),
    projectiles: [], events: [], target: null,
  };
}

export function emit(g, type, data = {}) { g.events.push({ type, ...data }); }
export function radio(g, text, speaker = 'CONTROL', duration = 6) {
  g.message = text; g.messageTime = duration; emit(g, 'radio', { text, speaker });
}
export function startGame(g) {
  g.phase = 'playing'; radio(g, g.level.start, 'KESTREL');
}
// ---- objective engine -------------------------------------------------------------
// Each kind answers four questions: is it blocked, where does the marker point, what does
// the readout say, and is it done. Levels only supply data.
const zoneOf = (g, name) => (name && g.zones[name]) || g.base;
const listTargets = (g, o) => (o.targets ?? []).map(id => g.enemies.find(e => e.id === id)).filter(Boolean);
const taggedEnemies = (g, tag) => g.enemies.filter(e => e[tag]);
const nearestOf = (g, list) => list.slice().sort((a, b) => distance(g.p, a) - distance(g.p, b))[0];
const friendlyOf = (g, id) => g.friendlies.find(f => f.id === id);
export const isShielded = (g, e) => !!e.shieldedBy && g.enemies.some(n => n[e.shieldedBy] && !n.dead);

const KINDS = {
  destroy: {
    blocked: (g, o) => listTargets(g, o).some(e => !e.dead && isShielded(g, e)),
    at: (g, o) => {
      const target = listTargets(g, o).find(e => !e.dead);
      if (target && isShielded(g, target)) return nearestOf(g, taggedEnemies(g, target.shieldedBy).filter(e => !e.dead)) ?? target;
      return target ?? o.at ?? g.base;
    },
    short: (g, o, blocked) => {
      if (!blocked) return o.short;
      const tag = listTargets(g, o).find(e => !e.dead).shieldedBy;
      const all = taggedEnemies(g, tag);
      return `${o.blockedShort ?? 'SHIELD NODES'} · ${all.filter(e => e.dead).length}/${all.length}`;
    },
    done: (g, o) => listTargets(g, o).length > 0 && listTargets(g, o).every(e => e.dead),
  },
  destroyTag: {
    at: (g, o) => nearestOf(g, taggedEnemies(g, o.tag).filter(e => !e.dead)) ?? o.at ?? g.base,
    short: (g, o) => {
      const all = taggedEnemies(g, o.tag);
      return `${o.short} · ${all.filter(e => e.dead).length}/${all.length}`;
    },
    done: (g, o) => taggedEnemies(g, o.tag).every(e => e.dead),
  },
  rescue: {
    blocked: (g, o) => !!o.guardTag && taggedEnemies(g, o.guardTag).some(e => !e.dead),
    at: (g, o) => zoneOf(g, o.zone),
    short: (g, o, blocked) => blocked
      ? `GUARDS · ${taggedEnemies(g, o.guardTag).filter(e => !e.dead).length} REMAINING`
      : `${o.short} · ${g.rescued}/${o.count}`,
    done: (g, o) => g.rescued >= o.count,
  },
  capture: {
    at: (g, o) => g.enemies.find(e => e.id === o.target) ?? o.at ?? g.base,
    short: (g, o) => {
      const unit = g.enemies.find(e => e.id === o.target);
      return unit?.captured ? `${o.short} · ABOARD` : unit?.dead ? `${o.short} · LOST` : o.short;
    },
    done: (g, o) => !!g.enemies.find(e => e.id === o.target)?.captured,
    fail: (g, o) => {
      const unit = g.enemies.find(e => e.id === o.target);
      return unit && unit.dead && !unit.captured
        ? { title: 'PRISONER LOST', reason: o.failReason ?? 'You needed that one alive. Hover over the target and hold the winch instead of firing.' } : null;
    },
  },
  deliver: {
    at: (g, o) => (o.to === 'base' ? g.base : g.depots.find(d => d.letter === o.to) ?? g.base),
    short: (g, o) => `${o.short} · ${g.p.cargo} ABOARD`,
    done: (g, o) => g.delivered >= (o.count ?? 1),
  },
  recon: {
    at: (g, o) => zoneOf(g, o.zone),
    short: (g, o) => `${o.short} · ${Math.round(Math.min(1, g.recon / o.seconds) * 100)}%`,
    done: (g, o) => g.recon >= o.seconds,
  },
  escort: {
    at: (g, o) => friendlyOf(g, o.unit) ?? g.base,
    short: (g, o) => {
      const unit = friendlyOf(g, o.unit);
      if (!unit) return o.short;
      const left = unit.path ? unit.path.length - unit.waypoint : 0;
      return unit.arrived ? `${o.short} · CLEAR` : `${o.short} · ${Math.round(unit.hp / unit.maxHp * 100)}% · ${left} LEG${left === 1 ? '' : 'S'}`;
    },
    done: (g, o) => !!friendlyOf(g, o.unit)?.arrived,
    fail: (g, o) => friendlyOf(g, o.unit)?.dead
      ? { title: 'ESCORT LOST', reason: o.failReason ?? 'They were counting on cover. Clear the road ahead of the convoy before it reaches the guns.' } : null,
  },
  intercept: {
    at: (g, o) => g.enemies.find(e => e.id === o.target) ?? o.at ?? g.base,
    short: (g, o) => {
      const unit = g.enemies.find(e => e.id === o.target);
      if (!unit || unit.dead) return `${o.short} · DOWN`;
      const left = unit.escape ? unit.escape.length - unit.waypoint : 0;
      return `${o.short} · ${left} LEG${left === 1 ? '' : 'S'} TO OPEN WATER`;
    },
    done: (g, o) => !!g.enemies.find(e => e.id === o.target)?.dead,
    fail: (g, o) => g.enemies.find(e => e.id === o.target)?.escaped
      ? { title: 'TARGET ESCAPED', reason: o.failReason ?? 'It slipped the net. Cut it off early with seekers instead of chasing from behind.' } : null,
  },
  extract: {
    at: g => g.base,
    short: (g, o) => o.short,
    done: () => false,   // the landing itself finishes the operation
  },
};

export const objectiveList = g => g.level.objectives;
export const activeIndex = g => Math.min(g.stage, g.level.objectives.length - 1);
export function objective(g) {
  const list = g.level.objectives, index = activeIndex(g), o = list[index], kind = KINDS[o.kind];
  const blocked = kind.blocked ? kind.blocked(g, o) : false;
  const at = kind.at ? kind.at(g, o) : (o.at ?? g.base);
  return {
    x: at.x, z: at.z, kind: o.kind, id: o.id ?? o.kind + index,
    label: blocked ? (o.blockedLabel ?? o.label) : o.label,
    detail: blocked ? (o.blockedDetail ?? o.detail) : o.detail,
    short: kind.short ? kind.short(g, o, blocked) : o.short,
    index: String(index + 1).padStart(2, '0'), total: list.length,
    blocked, timed: !!o.timer,
  };
}

export function contextAction(g) {
  const speed = Math.hypot(g.p.vx, g.p.vz), list = g.level.objectives, o = list[activeIndex(g)];
  if (distance(g.p, g.base) < g.base.radius) {
    const finishing = o.kind === 'extract';
    const dropping = o.kind === 'deliver' && o.to === 'base' && g.p.cargo > 0;
    if (finishing || dropping) return { kind: finishing ? 'extract' : 'deliver', label: finishing ? 'LAND & EXTRACT' : 'LAND & HAND OVER', enabled: speed < 7, progress: (finishing ? g.extraction : g.extraction) / 3 };
    return { kind: 'service', label: 'REPAIR & REARM', enabled: speed < 7, progress: g.service / 4 };
  }
  for (const depot of g.depots) if (distance(g.p, depot) < depot.radius) {
    if (o.kind === 'deliver' && o.to === depot.letter && g.p.cargo > 0) return { kind: 'deliver', label: 'LAND & HAND OVER', enabled: speed < 7, progress: g.extraction / 3 };
    return { kind: 'service', label: 'FIELD RESUPPLY', enabled: speed < 7, progress: g.service / 4 };
  }
  if (o.kind === 'rescue') {
    const zone = zoneOf(g, o.zone);
    if (distance(g.p, zone) < zone.radius) {
      const guards = o.guardTag ? taggedEnemies(g, o.guardTag).some(e => !e.dead) : false;
      return { kind: 'rescue', label: guards ? 'CLEAR COMPOUND FIRST' : `WINCH ${o.noun ?? 'SURVIVOR'} ${g.rescued + 1}/${o.count}`, enabled: !guards && speed < 5, progress: g.rescue / 1.6 };
    }
  }
  if (o.kind === 'capture') {
    const unit = g.enemies.find(e => e.id === o.target);
    if (unit && !unit.dead && distance(g.p, unit) < (o.radius ?? 9)) {
      return { kind: 'capture', label: `WINCH ${o.noun ?? 'PRISONER'}`, enabled: speed < 5, progress: g.rescue / 2.2 };
    }
  }
  if (o.kind === 'recon') {
    const zone = zoneOf(g, o.zone);
    if (distance(g.p, zone) < zone.radius) return { kind: 'recon', label: o.actionLabel ?? 'HOLD SCAN', enabled: speed < 5, progress: g.recon / o.seconds };
  }
  return null;
}

// Advances the chain, runs the active objective's clock and applies its failure rule.
function advanceObjectives(g, dt) {
  const list = g.level.objectives;
  if (g.stage >= list.length) return;
  const o = list[g.stage], kind = KINDS[o.kind];
  const failure = kind.fail?.(g, o);
  if (failure) { fail(g, failure.title, failure.reason); return; }
  if (o.timer) {
    if (g.timerFor !== g.stage && g.objectiveTimer <= 0) { g.objectiveTimer = o.timer.seconds; g.timerFor = g.stage; }
    g.objectiveTimer -= dt;
    if (g.objectiveTimer <= 0) { g.objectiveTimer = 0; fail(g, o.timer.title, o.timer.reason); return; }
  }
  if (!kind.done(g, o)) return;
  g.score += o.reward ?? 0;
  g.stage++; g.objectiveTimer = 0; g.timerFor = null; g.recon = 0;
  if (g.stage < list.length) {
    if (o.next) radio(g, o.next, o.speaker ?? 'KESTREL', 9);
    emit(g, 'objective', { stage: g.stage });
  }
}

export function selectTarget(g, aim = null) {
  const weapon = WEAPONS[g.p.weapon];
  let nearest = Infinity, target = null;
  for (const e of g.enemies) {
    if (e.dead) continue;
    const dist = distance(g.p, e);
    if (dist > weapon.range) continue;
    const bearing = Math.atan2(e.x - g.p.x, -(e.z - g.p.z));
    let value;
    if (aim) {
      const cursorDistance = distance(aim, e);
      if (cursorDistance > 20) continue;
      value = cursorDistance + dist * 0.08;
    } else {
      const angle = Math.abs(angleDelta(g.p.yaw, bearing));
      if (angle > 1.6 && dist > 15) continue;
      value = dist * (0.5 + angle * 0.5);
    }
    if (e.capturable && !e.captured) continue;   // never auto-lock someone we need alive
    if (e.type === 'crate') value += 12;
    if (isShielded(g, e)) value += 50;
    if (value < nearest) { nearest = value; target = e; }
  }
  g.target = target?.id ?? null;
  return target;
}

function damageEnemy(g, e, amount, chain = false) {
  if (e.dead) return;
  if (isShielded(g, e)) { emit(g, 'shield', { x: e.x, z: e.z, y: 9 }); return; }
  e.hp -= amount;
  emit(g, 'hit', { x: e.x, y: e.y + 1, z: e.z, heavy: amount > 20 });
  if (e.hp > 0) return;
  e.hp = 0; e.dead = true; g.kills++; g.score += e.score;
  emit(g, 'explosion', { x: e.x, y: e.y, z: e.z, size: e.type === 'command' ? 3.3 : e.type === 'radar' ? 2 : 1, id: e.id });
  if (e.explosive && !chain) {
    for (const neighbor of g.enemies) if (!neighbor.dead && distance(neighbor, e) < 14) damageEnemy(g, neighbor, 150, true);
  }
}

function damageFriendly(g, f, amount) {
  if (f.dead) return;
  f.hp -= amount;
  emit(g, 'hit', { x: f.x, y: f.y + 1, z: f.z });
  if (f.hp > 0) return;
  f.hp = 0; f.dead = true;
  emit(g, 'explosion', { x: f.x, y: f.y, z: f.z, size: 1.5, id: f.id, friendly: true });
}

function shootFriendly(g, e, f) {
  const dx = f.x - e.x, dz = f.z - e.z, len = Math.max(0.1, Math.hypot(dx, dz));
  g.projectiles.push({ id: ++g.nextId, x: e.x, y: e.y + 2.5, z: e.z,
    vx: dx / len * 36, vz: dz / len * 36, vy: (f.y - e.y - 2.5) / len * 36,
    life: 4, damage: 14, enemy: true, at: f.id, weapon: 0, travelled: 0 });
}

// Convoys roll and fleeing units run only while their objective is live.
function syncObjectiveActors(g) {
  const o = g.level.objectives[activeIndex(g)];
  if (o.kind === 'escort') { const unit = g.friendlies.find(f => f.id === o.unit); if (unit) unit.moving = true; }
  if (o.kind === 'intercept') { const unit = g.enemies.find(e => e.id === o.target); if (unit) unit.fleeing = true; }
}

function hitPlayer(g, damage) {
  if (g.p.invulnerable > 0 || g.phase !== 'playing') return;
  const amount = damage * DIFFICULTIES[g.difficulty].damage;
  g.p.armor = Math.max(0, g.p.armor - amount); g.damageTaken += amount;
  g.p.invulnerable = 0.16;
  emit(g, 'playerHit', { amount });
  if (g.p.armor <= 0) fail(g, 'AIRCRAFT LOST', 'Your armor gave out. Strafe while firing, and use the carrier or field pad to repair.');
}

export function fail(g, title, reason) {
  if (g.phase !== 'playing') return;
  g.phase = 'failed'; g.reason = reason; g.endTitle = title;
  emit(g, 'end', { success: false });
  emit(g, 'explosion', { x: g.p.x, y: g.p.y, z: g.p.z, size: 2 });
}

export function fire(g, target, aim = null) {
  const p = g.p, w = WEAPONS[p.weapon];
  if (p.cooldown > 0) return false;
  if (p.ammo[p.weapon] < 1) { p.cooldown = .7; emit(g, 'empty', { weapon: p.weapon }); return false; }
  p.ammo[p.weapon]--; p.cooldown = w.cooldown; g.shots++;
  const heading = target ? Math.atan2(target.x - p.x, -(target.z - p.z)) : aim ? Math.atan2(aim.x - p.x, -(aim.z - p.z)) : p.yaw;
  const dx = Math.sin(heading), dz = -Math.cos(heading);
  const dist = target ? distance(p, target) : aim ? distance(p, aim) : 50;
  const targetY = target ? target.y + 1 : 2;
  const slope = (targetY - p.y) / Math.max(dist, 6);
  g.projectiles.push({ id: ++g.nextId, x: p.x + dx * 3.9, z: p.z + dz * 3.9, y: p.y - 0.4,
    vx: dx * w.speed, vz: dz * w.speed, vy: slope * w.speed,
    life: w.range / w.speed + 0.2, damage: w.damage, splash: w.splash || 0,
    targetId: w.homing ? target?.id : null, weapon: p.weapon, enemy: false, travelled: 0 });
  emit(g, 'shot', { weapon: p.weapon, x: p.x + dx * 4, y: p.y, z: p.z + dz * 4 });
  return true;
}

function shootEnemy(g, e) {
  const missile = e.type === 'sam' || e.type === 'command';
  const speed = missile ? 27 : 36;
  const dist = distance(e, g.p);
  const lead = missile ? 0 : Math.min(dist / speed, 1.2) * 0.6;
  const dx = g.p.x + g.p.vx * lead - e.x, dz = g.p.z + g.p.vz * lead - e.z;
  const len = Math.hypot(dx, dz);
  g.projectiles.push({ id: ++g.nextId, x: e.x, y: e.y + 2.5, z: e.z,
    vx: dx / len * speed, vz: dz / len * speed, vy: (g.p.y - e.y - 2.5) / len * speed,
    life: 4, damage: missile ? 17 : 8, enemy: true, homing: missile, weapon: missile ? 2 : 0, travelled: 0 });
  if (missile) emit(g, 'incoming', { x: e.x, z: e.z });
}

export function update(g, input, dt) {
  if (g.phase !== 'playing') return;
  dt = clamp(dt, 0, 0.05);
  const p = g.p, difficulty = DIFFICULTIES[g.difficulty];
  g.time += dt; g.messageTime = Math.max(0, g.messageTime - dt);
  p.cooldown = Math.max(0, p.cooldown - dt); p.flareCooldown = Math.max(0, p.flareCooldown - dt); p.invulnerable -= dt;
  let mx = input.x || 0, mz = input.z || 0;
  const len = Math.hypot(mx, mz); if (len > 1) { mx /= len; mz /= len; }
  const speed = input.boost ? 30 : 23;
  const drag = 1 - Math.exp(-(input.interact ? 7.5 : 4) * dt);
  p.vx += (mx * speed - p.vx) * drag;
  p.vz += (mz * speed - p.vz) * drag;
  const nextX = p.x + p.vx * dt, nextZ = p.z + p.vz * dt;
  p.x = clamp(nextX, -g.limit, g.limit); p.z = clamp(nextZ, -g.limit, g.limit);
  if (p.x !== nextX) p.vx = 0; if (p.z !== nextZ) p.vz = 0;
  const target = selectTarget(g, input.aim);
  let heading = p.yaw;
  if (input.turn) heading += input.turn * dt * 2.4;
  else if (input.fire && target) heading = Math.atan2(target.x - p.x, -(target.z - p.z));
  else if (input.aim && input.fire) heading = Math.atan2(input.aim.x - p.x, -(input.aim.z - p.z));
  else if (len > 0.09 && !input.strafe) heading = Math.atan2(mx, -mz);
  p.yaw += angleDelta(p.yaw, heading) * (input.turn ? 1 : 1 - Math.exp(-7 * dt));
  const context = contextAction(g);
  const servicing = input.interact && context?.enabled;
  const desiredAltitude = servicing && context.kind !== 'rescue' ? 4.2 : servicing ? 6 : Math.max(9, input.altitude || 9);
  p.y += (desiredAltitude - p.y) * (1 - Math.exp(-3 * dt));
  p.fuel = Math.max(0, p.fuel - dt * difficulty.fuel * (input.boost ? 1.65 : 1));
  if (p.fuel <= 0) { fail(g, 'FUEL EXHAUSTED', 'Keep an eye on the fuel gauge. The carrier and the green field pad offer unlimited resupply.'); return; }
  if (p.fuel < 25 && !g.warnedFuel) { g.warnedFuel = true; radio(g, 'Bingo fuel. Find the green supply pad or return to Homeplate.', 'KESTREL'); }
  if (input.fire && !servicing) fire(g, target, input.aim);
  if (input.flare && p.flareCooldown <= 0) {
    p.flareCooldown = 7; g.flares++;
    for (const projectile of g.projectiles) if (projectile.enemy && projectile.homing && distance(projectile, p) < 65) { projectile.life = 0; }
    p.invulnerable = 0.85;
    emit(g, 'flares', { x: p.x, y: p.y, z: p.z });
  }

  const activeObjective = g.level.objectives[activeIndex(g)];
  if (servicing) {
    if (context.kind === 'rescue') {
      g.rescue += dt;
      if (g.rescue >= 1.6) {
        g.rescue = 0; g.rescued++; p.cargo++; g.score += 350;
        emit(g, 'rescue', { count: g.rescued });
        const noun = (activeObjective.noun ?? 'SURVIVOR').toLowerCase();
        if (g.rescued < (activeObjective.count ?? 4)) radio(g, `${noun.charAt(0).toUpperCase() + noun.slice(1)} ${g.rescued} aboard. Steady on the hover.`, 'WINCH', 2);
      }
    } else if (context.kind === 'capture') {
      g.rescue += dt;
      if (g.rescue >= 2.2) {
        g.rescue = 0;
        const unit = g.enemies.find(e => e.id === activeObjective.target);
        if (unit && !unit.dead) {
          unit.captured = true; unit.dead = true; g.captured++; p.cargo++; g.score += 500;
          emit(g, 'capture', { id: unit.id, x: unit.x, y: unit.y, z: unit.z });
          radio(g, activeObjective.aboard ?? 'He is aboard and talking. Get him to the pad.', 'WINCH', 5);
        }
      }
    } else if (context.kind === 'recon') {
      g.recon += dt;
      if (g.recon >= (activeObjective.seconds ?? 6) && !g.reconAnnounced) {
        g.reconAnnounced = true; g.score += 250;
        emit(g, 'recon', { x: p.x, z: p.z });
      }
    } else if (context.kind === 'deliver') {
      g.extraction += dt;
      if (g.extraction >= 3 && p.cargo > 0) {
        g.extraction = 0; g.delivered += p.cargo;
        // Desert Strike convention: people handed over patch the airframe on the way out.
        p.armor = Math.min(100, p.armor + 12 * p.cargo); g.score += 300 * p.cargo;
        emit(g, 'delivered', { count: g.delivered, cargo: p.cargo });
        p.cargo = 0;
        radio(g, activeObjective.handover ?? 'They are off your hands. Good work.', 'HOMEPLATE', 5);
      }
    } else if (context.kind === 'extract') {
      g.extraction += dt;
      if (g.extraction >= 3) {
        g.delivered = g.rescued; p.cargo = 0; g.phase = 'won';
        g.score += Math.round(g.p.armor * 10) + Math.max(0, Math.round((900 - g.time) * 3)) + 1500;
        emit(g, 'end', { success: true });
      }
    } else {
      g.service += dt;
      p.armor = Math.min(100, p.armor + 24 * dt); p.fuel = Math.min(100, p.fuel + 30 * dt);
      for (let i = 0; i < 3; i++) p.ammo[i] = Math.min(WEAPONS[i].max, p.ammo[i] + WEAPONS[i].max / 3 * dt);
      if (g.service >= 4 && !g.serviceAnnounced) {
        g.supplyVisits++; g.serviceAnnounced = true; g.warnedFuel = false;
        radio(g, 'Armor patched. Tanks topped. Ready for another run.', 'HOMEPLATE');
      }
    }
  } else { g.rescue = 0; g.service = 0; g.extraction = 0; g.recon = 0; g.serviceAnnounced = false; }

  syncObjectiveActors(g);
  for (const f of g.friendlies) {
    if (f.dead || f.arrived || !f.path || !(f.moving || f.always)) continue;
    const dest = f.path[Math.min(f.waypoint, f.path.length - 1)], d = distance(f, dest);
    if (d < 2.5) {
      f.waypoint++;
      if (f.waypoint >= f.path.length) { f.arrived = true; emit(g, 'arrived', { id: f.id, x: f.x, z: f.z }); }
    } else {
      f.x += (dest.x - f.x) / d * f.speed * dt; f.z += (dest.z - f.z) / d * f.speed * dt;
      f.yaw = Math.atan2(dest.x - f.x, -(dest.z - f.z));
    }
  }

  for (const e of g.enemies) {
    if (e.dead) continue;
    if (e.escape && e.fleeing && !e.escaped) {
      const dest = e.escape[Math.min(e.waypoint, e.escape.length - 1)], d = distance(e, dest);
      if (d < 2.5) { e.waypoint++; if (e.waypoint >= e.escape.length) { e.escaped = true; emit(g, 'escaped', { id: e.id }); } }
      else { const velocity = e.type === 'boat' ? 6.5 : 4.5; e.x += (dest.x - e.x) / d * velocity * dt; e.z += (dest.z - e.z) / d * velocity * dt; e.yaw = Math.atan2(dest.x - e.x, -(dest.z - e.z)); }
    } else if (e.patrol) {
      const dest = e.patrol[e.waypoint]; const d = distance(e, dest);
      if (d < 1) e.waypoint = (e.waypoint + 1) % e.patrol.length;
      else { const velocity = e.type === 'boat' ? 5 : 2.8; e.x += (dest.x - e.x) / d * velocity * dt; e.z += (dest.z - e.z) / d * velocity * dt; e.yaw = Math.atan2(dest.x - e.x, -(dest.z - e.z)); }
    }
    if (e.range === 0) continue;
    e.cooldown -= dt;
    const d = distance(e, p);
    // The friendly carrier has a defensive perimeter so refuelling is always possible.
    if (d < e.range && distance(p, g.base) > 24 && e.cooldown <= 0 && (e.type !== 'command' || g.stage >= 2)) {
      shootEnemy(g, e); e.cooldown = e.rate * difficulty.enemyRate;
    } else if (e.cooldown <= 0) {
      // Nothing to shoot at overhead: lean on whatever friendly column is in range instead.
      const convoy = g.friendlies.find(f => !f.dead && !f.arrived && distance(e, f) < e.range);
      if (convoy) { shootFriendly(g, e, convoy); e.cooldown = e.rate * difficulty.enemyRate * 1.2; }
    }
  }

  for (let i = g.projectiles.length - 1; i >= 0; i--) {
    const b = g.projectiles[i]; b.life -= dt;
    if (b.life <= 0) { g.projectiles.splice(i, 1); continue; }
    if (b.targetId) {
      const e = g.enemies.find(e => e.id === b.targetId && !e.dead);
      if (e) {
        const dx = e.x - b.x, dz = e.z - b.z, d = Math.max(0.1, Math.hypot(dx, dz));
        const f = 1 - Math.exp(-6 * dt);
        b.vx += (dx / d * 65 - b.vx) * f; b.vz += (dz / d * 65 - b.vz) * f;
        b.vy += ((e.y + 1 - b.y) / d * 65 - b.vy) * f;
      }
    } else if (b.enemy && b.homing) {
      const dx = p.x - b.x, dz = p.z - b.z, d = Math.max(0.1, Math.hypot(dx, dz));
      const f = 1 - Math.exp(-1.25 * dt);
      b.vx += (dx / d * 27 - b.vx) * f; b.vz += (dz / d * 27 - b.vz) * f; b.vy += ((p.y - b.y) / d * 27 - b.vy) * f;
    }
    const oldX = b.x, oldZ = b.z;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    b.travelled += Math.hypot(b.vx, b.vz) * dt;
    if (b.enemy) {
      if (b.at) {
        const convoy = g.friendlies.find(f => f.id === b.at);
        if (convoy && !convoy.dead && distance(b, convoy) < 3.6) { damageFriendly(g, convoy, b.damage); b.life = 0; }
      } else if (distance(b, p) < 3 && Math.abs(b.y - p.y) < 4) { hitPlayer(g, b.damage); b.life = 0; }
    } else {
      for (const e of g.enemies) {
        if (e.dead) continue;
        // Segment collision prevents fast cannon rounds tunnelling through a target.
        const sx = b.x - oldX, sz = b.z - oldZ;
        const t = clamp(((e.x - oldX) * sx + (e.z - oldZ) * sz) / Math.max(0.001, sx * sx + sz * sz), 0, 1);
        const hit = Math.hypot(e.x - oldX - t * sx, e.z - oldZ - t * sz) < e.radius + 0.45;
        if (hit && b.y < e.y + (e.type === 'radar' ? 10 : 7)) {
          g.hits++; damageEnemy(g, e, b.damage);
          if (b.splash) {
            emit(g, 'explosion', { x: b.x, y: b.y, z: b.z, size: 0.65 });
            for (const n of g.enemies) if (n !== e && !n.dead && distance(n, b) < b.splash) damageEnemy(g, n, b.damage * 0.5);
          }
          b.life = 0; break;
        }
      }
    }
    if (b.y < 0.4) { if (b.weapon > 0) emit(g, 'splash', { x: b.x, y: 0.5, z: b.z }); b.life = 0; }
  }

  advanceObjectives(g, dt);
}
