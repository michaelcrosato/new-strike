// Deterministic simulation, shared by the renderer and the headless mission tests.
export const WORLD_LIMIT = 157;
export const BASE = { x: -99, z: 111, radius: 13 };
export const DEPOT = { x: -8, z: -26, radius: 8 };
export const CAMP = { x: 10, z: -51, radius: 9 };
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
  }[type];
  return { id, type, x, z, y: type === 'boat' ? 1.4 : 3.5, hp: stats[0], maxHp: stats[0],
    range: stats[1], rate: stats[2], score: stats[3], radius: type === 'command' ? 7 : type === 'radar' ? 5 : type === 'crate' ? 2 : 3,
    yaw: 0, cooldown: 1.5 + (id.length % 4) * 0.55, dead: false, ...extra };
};

export function createGame(difficulty = 'pilot') {
  return {
    phase: 'briefing', difficulty, time: 0, stage: 0, score: 0, kills: 0, rescued: 0, delivered: 0,
    service: 0, rescue: 0, extraction: 0, supplyVisits: 0, message: '', messageTime: 0,
    launchTimer: 300, nextId: 0, shots: 0, hits: 0, damageTaken: 0, reason: '', flares: 0,
    p: { x: BASE.x, z: BASE.z, y: 8, vx: 0, vz: 0, yaw: -0.26, armor: 100, fuel: 100,
      ammo: WEAPONS.map(w => w.max), weapon: 0, cooldown: 0, flareCooldown: 0, invulnerable: 2, cargo: 0 },
    enemies: [
      makeEnemy('coastal-radar', 'radar', -66, 20),
      makeEnemy('coast-aa', 'turret', -83, 39),
      makeEnemy('road-tank', 'tank', -45, 5, { patrol: [{ x: -47, z: 5 }, { x: -73, z: 47 }], waypoint: 0 }),
      makeEnemy('coast-sam', 'sam', -46, 39),
      makeEnemy('camp-west', 'turret', -9, -49, { guard: true }),
      makeEnemy('camp-east', 'turret', 31, -50, { guard: true }),
      makeEnemy('camp-tank', 'tank', 10, -71, { guard: true, patrol: [{ x: 8, z: -73 }, { x: 27, z: -69 }], waypoint: 0 }),
      makeEnemy('river-patrol', 'boat', -26, -7, { patrol: [{ x: -29, z: -7 }, { x: -49, z: -50 }], waypoint: 0 }),
      makeEnemy('harbor-patrol', 'boat', 46, 88, { patrol: [{ x: 46, z: 88 }, { x: 115, z: 93 }], waypoint: 0 }),
      makeEnemy('harbor-aa', 'turret', 77, 38),
      makeEnemy('bridge-tank', 'tank', 54, -66),
      makeEnemy('citadel-sam', 'sam', 75, -91),
      makeEnemy('citadel-aa', 'turret', 115, -61),
      makeEnemy('generator-west', 'generator', 77, -55, { generator: true }),
      makeEnemy('generator-east', 'generator', 113, -96, { generator: true }),
      makeEnemy('storm-command', 'command', 99, -79),
      makeEnemy('fuel-coast', 'crate', -91, 17, { explosive: true }),
      makeEnemy('fuel-camp', 'crate', 29, -65, { explosive: true }),
      makeEnemy('fuel-command', 'crate', 120, -64, { explosive: true }),
    ],
    projectiles: [], events: [], target: null,
  };
}

export function emit(g, type, data = {}) { g.events.push({ type, ...data }); }
export function radio(g, text, speaker = 'CONTROL', duration = 6) {
  g.message = text; g.messageTime = duration; emit(g, 'radio', { text, speaker });
}
export function startGame(g) {
  g.phase = 'playing'; radio(g, 'Hawk, you are cleared hot. Knock out the coastal radar. Keep moving under fire.', 'KESTREL');
}
export function objective(g) {
  if (g.stage === 0) return { x: -66, z: 20, label: 'DESTROY COASTAL RADAR', short: 'RADAR ARRAY', detail: 'Cut the island’s early warning network.', index: '01' };
  if (g.stage === 1) {
    const guards = g.enemies.filter(e => e.guard && !e.dead).length;
    return { ...CAMP, label: guards ? 'CLEAR THE RESCUE COMPOUND' : 'WINCH THE ENGINEERS', short: guards ? `GUARDS · ${guards} REMAINING` : `ENGINEERS · ${g.rescued}/4`, detail: guards ? 'Eliminate the three compound defenders.' : 'Hover over the amber rescue beacon. Hold E / WINCH.', index: '02' };
  }
  if (g.stage === 2) {
    const generators = g.enemies.filter(e => e.generator && !e.dead);
    const closest = generators.sort((a, b) => distance(g.p, a) - distance(g.p, b))[0];
    return { x: closest?.x ?? 99, z: closest?.z ?? -79, label: generators.length ? 'BREAK THE STORM SHIELD' : 'DESTROY THE STORM BATTERY', short: generators.length ? `POWER NODES · ${2 - generators.length}/2` : 'STORM BATTERY', detail: generators.length ? 'Destroy both power nodes to expose the battery.' : 'Battery exposed. Stop the missile launch.', index: '03' };
  }
  return { ...BASE, label: 'RETURN TO THE CARRIER', short: 'EXTRACTION · HOMEPLATE', detail: 'Bring the crew home. Hover above the carrier and hold E / LAND.', index: '04' };
}

export function contextAction(g) {
  const speed = Math.hypot(g.p.vx, g.p.vz);
  if (distance(g.p, BASE) < BASE.radius) return { kind: g.stage === 3 ? 'extract' : 'service', label: g.stage === 3 ? 'LAND & EXTRACT' : 'REPAIR & REARM', enabled: speed < 7, progress: g.stage === 3 ? g.extraction / 3 : g.service / 4 };
  if (distance(g.p, DEPOT) < DEPOT.radius) return { kind: 'service', label: 'FIELD RESUPPLY', enabled: speed < 7, progress: g.service / 4 };
  if (g.stage === 1 && distance(g.p, CAMP) < CAMP.radius) {
    const guards = g.enemies.some(e => e.guard && !e.dead);
    return { kind: 'rescue', label: guards ? 'CLEAR COMPOUND FIRST' : `WINCH ENGINEER ${g.rescued + 1}/4`, enabled: !guards && speed < 5, progress: g.rescue / 1.6 };
  }
  return null;
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
    if (e.type === 'crate') value += 12;
    if (e.type === 'command' && g.enemies.some(n => n.generator && !n.dead)) value += 50;
    if (value < nearest) { nearest = value; target = e; }
  }
  g.target = target?.id ?? null;
  return target;
}

function damageEnemy(g, e, amount, chain = false) {
  if (e.dead) return;
  if (e.type === 'command' && g.enemies.some(n => n.generator && !n.dead)) {
    emit(g, 'shield', { x: e.x, z: e.z, y: 9 }); return;
  }
  e.hp -= amount;
  emit(g, 'hit', { x: e.x, y: e.y + 1, z: e.z, heavy: amount > 20 });
  if (e.hp > 0) return;
  e.hp = 0; e.dead = true; g.kills++; g.score += e.score;
  emit(g, 'explosion', { x: e.x, y: e.y, z: e.z, size: e.type === 'command' ? 3.3 : e.type === 'radar' ? 2 : 1, id: e.id });
  if (e.explosive && !chain) {
    for (const neighbor of g.enemies) if (!neighbor.dead && distance(neighbor, e) < 14) damageEnemy(g, neighbor, 150, true);
  }
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
  p.x = clamp(nextX, -WORLD_LIMIT, WORLD_LIMIT); p.z = clamp(nextZ, -WORLD_LIMIT, WORLD_LIMIT);
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

  if (servicing) {
    if (context.kind === 'rescue') {
      g.rescue += dt;
      if (g.rescue >= 1.6) {
        g.rescue = 0; g.rescued++; p.cargo++; g.score += 350;
        emit(g, 'rescue', { count: g.rescued });
        if (g.rescued < 4) radio(g, `Engineer ${g.rescued} aboard. Steady on the hover.`, 'WINCH', 2);
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
  } else { g.rescue = 0; g.service = 0; g.extraction = 0; g.serviceAnnounced = false; }

  for (const e of g.enemies) {
    if (e.dead) continue;
    if (e.patrol) {
      const dest = e.patrol[e.waypoint]; const d = distance(e, dest);
      if (d < 1) e.waypoint = (e.waypoint + 1) % e.patrol.length;
      else { const velocity = e.type === 'boat' ? 5 : 2.8; e.x += (dest.x - e.x) / d * velocity * dt; e.z += (dest.z - e.z) / d * velocity * dt; e.yaw = Math.atan2(dest.x - e.x, -(dest.z - e.z)); }
    }
    if (e.range === 0) continue;
    e.cooldown -= dt;
    const d = distance(e, p);
    // The friendly carrier has a defensive perimeter so refuelling is always possible.
    if (d < e.range && distance(p, BASE) > 24 && e.cooldown <= 0 && (e.type !== 'command' || g.stage >= 2)) {
      shootEnemy(g, e); e.cooldown = e.rate * difficulty.enemyRate;
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
      if (distance(b, p) < 3 && Math.abs(b.y - p.y) < 4) { hitPlayer(g, b.damage); b.life = 0; }
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

  if (g.stage === 0 && g.enemies.find(e => e.id === 'coastal-radar').dead) {
    g.stage = 1; g.score += 600;
    radio(g, 'Radar down. Four engineers are trapped upriver. Clear their compound, then winch them out.', 'KESTREL', 9);
    emit(g, 'objective', { stage: 1 });
  }
  if (g.stage === 1 && g.rescued === 4) {
    g.stage = 2; g.launchTimer = 300;
    radio(g, 'All four aboard! They gave us the launch codes. Break both power nodes, then destroy the Storm battery. Five minutes.', 'KESTREL', 10);
    emit(g, 'objective', { stage: 2 });
  }
  if (g.stage === 2) {
    const command = g.enemies.find(e => e.id === 'storm-command');
    if (command.dead) {
      g.stage = 3; g.score += 1000;
      radio(g, 'Beautiful hit, Hawk. The launch is dead. Bring our people back to the carrier.', 'KESTREL', 9);
      emit(g, 'objective', { stage: 3 });
    } else {
      g.launchTimer = Math.max(0, g.launchTimer - dt);
      if (g.launchTimer <= 0) fail(g, 'LAUNCH NOT PREVENTED', 'The Storm battery fired. Destroy the two power nodes first, then hit the central launcher with seekers.');
    }
  }
}
