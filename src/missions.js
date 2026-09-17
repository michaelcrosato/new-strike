// Turns a contract into something you actually fly.
//
// Each kind sets up whatever the world needs (a scan zone, cargo, survivors, a wreck,
// waypoints, a convoy, a garrison to flatten, a vehicle running for the border), then
// advances on the same tick as combat. Strike and interdiction push their targets straight
// into the combat hostile list, so there is one damage model rather than two.

import { WORLD } from './worldgen.js';
import { HOSTILE_TYPES, distance } from './combat.js';

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const ARRIVE = 44;            // close enough to count as over a place
const LAND_SPEED = 9;         // hovering, not passing through

function hash(a, b, salt) {
  let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(salt, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// A point on land near a centre, so wrecks and convoys do not start in the sea.
function landNear(world, x, z, radius, salt) {
  for (let i = 0; i < 24; i++) {
    const a = hash(i, salt, 17) * Math.PI * 2;
    const r = radius * (0.35 + hash(i, salt, 31) * 0.65);
    const px = clamp(x + Math.cos(a) * r, -WORLD.half + 20, WORLD.half - 20);
    const pz = clamp(z + Math.sin(a) * r, -WORLD.half + 20, WORLD.half - 20);
    if (world.elevation(px, pz) > 1.5 && world.slope(px, pz) < 0.5) return { x: px, z: pz };
  }
  return { x, z };
}

export function startMission(world, profile, contract, combat) {
  const site = contract.site;
  const siteRadius = site.radius ?? 18;
  const home = world.home;
  const state = {
    contract, kind: contract.kind, site, home,
    stage: 0, progress: 0, hold: 0, done: false, failed: false, reason: '',
    cargo: 0, delivered: 0, waypoints: [], entities: [], targets: [], convoy: null, runner: null,
    events: [],
  };

  if (contract.kind === 'survey') {
    state.zone = { x: site.x, z: site.z, radius: 26 };
    state.need = 7;
  }
  if (contract.kind === 'delivery') {
    state.cargo = 1;
    state.zone = { x: site.x, z: site.z, radius: ARRIVE };
  }
  if (contract.kind === 'extraction') {
    state.need = 3;
    const spot = landNear(world, site.x, site.z, siteRadius + 14, 5);
    state.zone = { x: spot.x, z: spot.z, radius: 24 };
    for (let i = 0; i < state.need; i++) {
      state.entities.push({ id: `sv${i}`, kind: 'survivor', x: spot.x - 2 + i * 2, z: spot.z, aboard: false });
    }
  }
  if (contract.kind === 'salvage') {
    const spot = landNear(world, site.x, site.z, 80, 11);
    state.zone = { x: spot.x, z: spot.z, radius: 22 };
    state.entities.push({ id: 'wreck', kind: 'wreck', x: spot.x, z: spot.z, aboard: false });
    state.need = 1;
  }
  if (contract.kind === 'patrol') {
    const count = 4;
    for (let i = 0; i < count; i++) {
      const a = i / count * Math.PI * 2 + hash(i, 3, 5);
      const r = siteRadius + 60 + hash(i, 7, 9) * 50;
      state.waypoints.push({
        x: clamp(site.x + Math.cos(a) * r, -WORLD.half + 20, WORLD.half - 20),
        z: clamp(site.z + Math.sin(a) * r, -WORLD.half + 20, WORLD.half - 20),
        seen: false,
      });
    }
  }
  if (contract.kind === 'escort') {
    const start = landNear(world, (site.x + home.x) / 2, (site.z + home.z) / 2, 90, 21);
    state.convoy = {
      id: 'convoy', kind: 'convoy', x: start.x, z: start.z, hp: 150, maxHp: 150,
      path: [{ x: (start.x + site.x) / 2, z: (start.z + site.z) / 2 }, { x: site.x, z: site.z }],
      leg: 0, speed: 8, arrived: false, dead: false, yaw: 0,
    };
  }
  if (contract.kind === 'strike' || contract.kind === 'interdiction') {
    // The job's targets are real hostiles, dropped into the combat list so the ordinary
    // weapons, splash and wreckage all apply.
    const kinds = contract.kind === 'strike' ? ['depot', 'radar', 'checkpoint'] : ['technical'];
    kinds.forEach((type, i) => {
      const spot = landNear(world, site.x, site.z, siteRadius + 10 + i * 8, 40 + i);
      const spec = HOSTILE_TYPES[type];
      const target = {
        id: `m_${contract.id}_${i}`, type, x: spot.x, z: spot.z,
        y: world.groundHeight(spot.x, spot.z) + spec.height * 0.4,
        faction: site.faction, hp: spec.hp, maxHp: spec.hp, cooldown: 1.4, dead: false,
        yaw: 0, home: { x: spot.x, z: spot.z }, mission: true,
      };
      combat?.hostiles.push(target);
      state.targets.push(target);
    });
    if (contract.kind === 'interdiction') {
      const runner = state.targets[0];
      const exit = landNear(world, site.x + (site.x > 0 ? 260 : -260), site.z + (site.z > 0 ? 200 : -200), 120, 77);
      runner.escape = [
        { x: (runner.x + exit.x) / 2, z: (runner.z + exit.z) / 2 },
        { x: exit.x, z: exit.z },
      ];
      runner.leg = 0;
      state.runner = runner;
    }
  }
  return state;
}

// Everything a mission needs each tick. `input.interact` is the winch / scan control.
export function stepMission(state, { world, craft, combat, input }, dt) {
  state.events.length = 0;
  if (state.done || state.failed) return state.events;
  const emit = (type, data = {}) => state.events.push({ type, ...data });
  const toHome = distance(craft, state.home);
  const hovering = Math.hypot(craft.vx ?? 0, craft.vz ?? 0) < LAND_SPEED;

  switch (state.kind) {
    case 'survey': {
      const inZone = distance(craft, state.zone) < state.zone.radius;
      if (inZone && input.interact && hovering) {
        state.hold += dt;
        state.progress = clamp(state.hold / state.need, 0, 1);
        if (state.hold >= state.need && state.stage === 0) { state.stage = 1; emit('scanned'); }
      } else if (state.stage === 0 && state.hold > 0) {
        state.hold = 0; state.progress = 0;
        if (inZone) emit('scanLost');
      }
      if (state.stage === 1 && toHome < ARRIVE) finish(state, emit);
      break;
    }
    case 'delivery': {
      const atSite = distance(craft, state.zone) < state.zone.radius;
      if (state.cargo > 0 && atSite && input.interact && hovering) {
        state.hold += dt;
        state.progress = clamp(state.hold / 2.5, 0, 1);
        if (state.hold >= 2.5) { state.cargo = 0; state.delivered = 1; state.stage = 1; emit('dropped'); }
      } else if (state.stage === 0) { state.hold = 0; state.progress = 0; }
      if (state.stage === 1 && toHome < ARRIVE) finish(state, emit);
      break;
    }
    case 'extraction':
    case 'salvage': {
      const waiting = state.entities.filter(e => !e.aboard);
      const inZone = distance(craft, state.zone) < state.zone.radius;
      if (waiting.length && inZone && input.interact && hovering) {
        state.hold += dt;
        const need = state.kind === 'salvage' ? 3 : 1.7;
        state.progress = clamp(state.hold / need, 0, 1);
        if (state.hold >= need) {
          state.hold = 0; state.progress = 0;
          const picked = waiting[0];
          picked.aboard = true; state.cargo++;
          emit('aboard', { id: picked.id, remaining: state.entities.filter(e => !e.aboard).length });
        }
      } else { state.hold = 0; state.progress = 0; }
      if (!state.entities.some(e => !e.aboard)) {
        state.stage = 1;
        if (toHome < ARRIVE && hovering) { state.delivered = state.cargo; finish(state, emit); }
      }
      break;
    }
    case 'patrol': {
      for (const point of state.waypoints) {
        if (point.seen) continue;
        if (distance(craft, point) < ARRIVE) { point.seen = true; emit('waypoint', { left: state.waypoints.filter(p => !p.seen).length }); }
      }
      state.progress = state.waypoints.filter(p => p.seen).length / state.waypoints.length;
      if (state.progress >= 1) { state.stage = 1; if (toHome < ARRIVE) finish(state, emit); }
      break;
    }
    case 'escort': {
      const convoy = state.convoy;
      if (convoy.dead) { fail(state, emit, 'ESCORT LOST', 'The column burned on open ground. Clear the route ahead of it.'); break; }
      if (!convoy.arrived) {
        const dest = convoy.path[Math.min(convoy.leg, convoy.path.length - 1)];
        const d = distance(convoy, dest);
        if (d < 12) {
          convoy.leg++;
          if (convoy.leg >= convoy.path.length) { convoy.arrived = true; emit('convoyArrived'); }
        } else {
          convoy.x += (dest.x - convoy.x) / d * convoy.speed * dt;
          convoy.z += (dest.z - convoy.z) / d * convoy.speed * dt;
          convoy.yaw = Math.atan2(dest.x - convoy.x, -(dest.z - convoy.z));
        }
        convoy.y = world.groundHeight(convoy.x, convoy.z) + 1.4;
        // Anything live and in range works on the column instead of you.
        for (const h of combat.hostiles) {
          if (h.dead) continue;
          const spec = HOSTILE_TYPES[h.type];
          if (!spec.range || distance(h, convoy) > spec.range) continue;
          convoy.hp -= spec.damage * dt * 2.2;
          if (convoy.hp <= 0) { convoy.dead = true; emit('convoyLost', { x: convoy.x, z: convoy.z }); }
        }
        state.progress = clamp(convoy.leg / convoy.path.length, 0, 1);
      }
      if (convoy.arrived) { state.stage = 1; state.progress = 1; if (toHome < ARRIVE) finish(state, emit); }
      break;
    }
    case 'strike': {
      const left = state.targets.filter(t => !t.dead).length;
      state.progress = 1 - left / state.targets.length;
      if (!left) { state.stage = 1; if (toHome < ARRIVE) finish(state, emit); }
      break;
    }
    case 'interdiction': {
      const runner = state.runner;
      if (runner.dead) { state.stage = 1; state.progress = 1; if (toHome < ARRIVE) finish(state, emit); break; }
      const dest = runner.escape[Math.min(runner.leg, runner.escape.length - 1)];
      const d = distance(runner, dest);
      if (d < 14) {
        runner.leg++;
        if (runner.leg >= runner.escape.length) {
          fail(state, emit, 'TARGET ESCAPED', 'It made the border. Cut the angle next time instead of chasing the dust.');
          break;
        }
      } else {
        const speed = 11;
        runner.x += (dest.x - runner.x) / d * speed * dt;
        runner.z += (dest.z - runner.z) / d * speed * dt;
        runner.y = world.groundHeight(runner.x, runner.z) + 1.2;
        runner.yaw = Math.atan2(dest.x - runner.x, -(dest.z - runner.z));
      }
      const total = runner.escape.length;
      state.progress = clamp(1 - (total - runner.leg) / total, 0, 0.95);
      break;
    }
  }
  return state.events;
}

function finish(state, emit) { state.done = true; state.progress = 1; emit('complete'); }
function fail(state, emit, title, reason) { state.failed = true; state.title = title; state.reason = reason; emit('failed', { title, reason }); }

// What the HUD should say, and where the marker goes.
export function missionStatus(state, craft) {
  if (!state) return null;
  const returning = state.stage === 1 && !state.done;
  const marker = returning ? state.home : markerFor(state, craft);
  const labels = {
    survey: state.stage === 1 ? 'SCAN COMPLETE · RETURN TO THE YARD' : 'HOLD THE SCAN OVER THE SITE',
    delivery: state.stage === 1 ? 'CARGO DELIVERED · RETURN TO THE YARD' : 'SET THE CRATE DOWN ON SITE',
    extraction: state.stage === 1 ? `${state.cargo} ABOARD · RETURN TO THE YARD` : `WINCH THE SURVIVORS · ${state.cargo}/${state.need}`,
    salvage: state.stage === 1 ? 'WRECK ABOARD · RETURN TO THE YARD' : 'WINCH THE WRECK',
    patrol: state.stage === 1 ? 'SWEEP COMPLETE · RETURN TO THE YARD' : `FLY THE WAYPOINTS · ${state.waypoints.filter(p => p.seen).length}/${state.waypoints.length}`,
    escort: state.convoy?.arrived ? 'COLUMN IS IN · RETURN TO THE YARD'
      : `KEEP THE COLUMN ALIVE · ${Math.round((state.convoy?.hp ?? 0) / (state.convoy?.maxHp ?? 1) * 100)}%`,
    strike: state.stage === 1 ? 'TARGETS DOWN · RETURN TO THE YARD' : `FLATTEN THE SITE · ${state.targets.filter(t => t.dead).length}/${state.targets.length}`,
    interdiction: state.stage === 1 ? 'TARGET STOPPED · RETURN TO THE YARD'
      : `STOP THE RUNNER · ${state.runner ? state.runner.escape.length - state.runner.leg : 0} LEGS LEFT`,
  };
  return {
    label: labels[state.kind] ?? state.contract.title,
    marker, progress: state.progress,
    holding: state.hold > 0,
    done: state.done, failed: state.failed,
    range: marker ? distance(craft, marker) : 0,
  };
}

function markerFor(state, craft) {
  switch (state.kind) {
    case 'patrol': {
      const next = state.waypoints.filter(p => !p.seen)
        .sort((a, b) => distance(craft, a) - distance(craft, b))[0];
      return next ?? state.home;
    }
    case 'escort': return state.convoy ?? state.site;
    case 'interdiction': return state.runner ?? state.site;
    case 'strike': return state.targets.find(t => !t.dead) ?? state.home;
    default: return state.zone ?? state.site;
  }
}

// Mission-spawned hostiles must not outlive the job.
export function clearMission(state, combat) {
  if (!state || !combat) return;
  const ids = new Set(state.targets.map(t => t.id));
  combat.hostiles = combat.hostiles.filter(h => !ids.has(h.id));
}
