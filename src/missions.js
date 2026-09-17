// Turns a contract into something you actually fly.
//
// Each kind sets up whatever the world needs (a scan zone, cargo, survivors, a wreck,
// waypoints, a convoy, a garrison to flatten, a vehicle running for the border), then
// advances on the same tick as combat. Strike and interdiction push their targets straight
// into the combat hostile list, so there is one damage model rather than two.

import { WORLD } from './worldgen.js';
import { HOSTILE_TYPES, distance, damageHostile, hitCraft } from './combat.js';

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const ARRIVE = 44;            // close enough to count as over a place
const LAND_SPEED = 9;         // hovering, not passing through
const PLANT_RANGE = 15;       // how close a charge has to be set
const FUSE = 20;              // seconds between the last charge and the bang
const BLAST = 62;             // how far clear of it you need to be
const LAZE = [42, 96];        // the stand-off band a designator works from
const LAZE_HOLD = 4;          // seconds on each target
const COMPROMISE = 21;        // inside this, a spotter job is being watched
const DETECT = { radar: 124, aa: 74 };   // what sees you on a quiet run
const SEEN_LIMIT = 2.6;       // seconds painted before the client disowns you
const BATTERY = 260;          // how long a search beacon keeps transmitting

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

// Drops a live hostile into the combat list and tracks it as one of the job's targets, so
// mission targets and streamed garrisons share one damage model.
function addTarget(world, combat, state, contract, type, x, z, index, extra = {}) {
  const spec = HOSTILE_TYPES[type];
  const target = {
    id: `m_${contract.id}_${index}`, type, x, z,
    y: world.groundHeight(x, z) + spec.height * 0.4,
    faction: contract.site.faction, hp: spec.hp, maxHp: spec.hp, cooldown: 1.4, dead: false,
    yaw: 0, home: { x, z }, mission: true, ...extra,
  };
  combat?.hostiles.push(target);
  state.targets.push(target);
  return target;
}

export function startMission(world, profile, contract, combat) {
  const site = contract.site;
  const siteRadius = site.radius ?? 18;
  const home = world.home;
  const twist = contract.complication ?? null;
  const state = {
    contract, kind: contract.kind, site, home,
    stage: 0, progress: 0, hold: 0, done: false, failed: false, reason: '',
    cargo: 0, delivered: 0, waypoints: [], entities: [], targets: [], convoy: null, runner: null,
    // Complications are read here and nowhere else in the mission body, so a new one is
    // data rather than another branch in every kind.
    complication: twist, deadline: twist?.key === 'deadline' ? twist.seconds : null,
    weather: twist?.key === 'weather', salvageRights: twist?.key === 'salvage',
    charges: [], fuse: null, beacon: null, seen: 0, battery: null, compromised: 0,
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
      addTarget(world, combat, state, contract, type, spot.x, spot.z, i);
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
  if (contract.kind === 'sabotage') {
    // Two structures, and a fuse that starts when the second charge is on. The pressure is
    // not getting in — it is getting out.
    ['depot', 'radar'].forEach((type, i) => {
      const spot = landNear(world, site.x, site.z, siteRadius + 12 + i * 14, 61 + i);
      const target = addTarget(world, combat, state, contract, type, spot.x, spot.z, i);
      state.charges.push({ id: target.id, x: spot.x, z: spot.z, planted: false });
    });
  }
  if (contract.kind === 'spotter') {
    ['aa', 'aa', 'technical'].forEach((type, i) => {
      const spot = landNear(world, site.x, site.z, siteRadius + 14 + i * 11, 83 + i);
      addTarget(world, combat, state, contract, type, spot.x, spot.z, i, { laze: 0, marked: false });
    });
  }
  if (contract.kind === 'search') {
    // Somewhere in a 1.3 km box, and the only instrument is signal strength.
    const spot = landNear(world, site.x, site.z, 250, 97);
    state.beacon = { x: spot.x, z: spot.z };
    state.battery = BATTERY;
    state.zone = { x: site.x, z: site.z, radius: 260 };
    state.entities.push({ id: 'beacon', kind: 'wreck', x: spot.x, z: spot.z, aboard: false, hidden: true });
    state.need = 1;
  }
  if (contract.kind === 'smuggling') {
    state.cargo = 1;
    state.zone = { x: site.x, z: site.z, radius: ARRIVE };
  }
  // A hot site is two more guns than the brief mentioned, and applies to any kind.
  if (twist?.key === 'hot') {
    ['technical', 'aa'].forEach((type, i) => {
      const spot = landNear(world, site.x, site.z, siteRadius + 20 + i * 12, 131 + i);
      addTarget(world, combat, state, contract, type, spot.x, spot.z, 90 + i);
    });
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

  // Complications tick for every kind, before the kind's own logic, so a deadline can end
  // any job and a fuse keeps burning whatever else is happening.
  if (state.deadline !== null) {
    state.deadline -= dt;
    if (state.deadline <= 0) {
      fail(state, emit, 'OUT OF TIME', 'The client stopped waiting. That was the whole deal.');
      return state.events;
    }
  }
  if (state.fuse !== null) {
    state.fuse -= dt;
    if (state.fuse <= 0) {
      state.fuse = null;
      const centre = state.charges[0];
      for (const target of state.targets) if (!target.dead) damageHostile(combat, target, 9999);
      emit('detonated', { x: centre.x, z: centre.z });
      // Close enough to watch it go is close enough to be hurt by it.
      const range = Math.hypot(craft.x - centre.x, craft.z - centre.z);
      if (range < BLAST) {
        hitCraft(combat, 55 * (1 - range / BLAST));
        emit('caught', { range });
      }
      state.stage = 1;
    }
  }

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
    case 'sabotage': {
      const pending = state.charges.filter(c => !c.planted);
      // A charge needs its structure standing. Shooting the thing you came to mine is the
      // way this job goes wrong.
      for (const charge of pending) {
        const target = state.targets.find(t => t.id === charge.id);
        if (target?.dead) {
          fail(state, emit, 'CHARGES WASTED', 'You flattened what you were paid to mine. Nobody is paying for rubble.');
          return state.events;
        }
      }
      if (state.fuse === null && pending.length) {
        const near = pending.find(c => Math.hypot(craft.x - c.x, craft.z - c.z) < PLANT_RANGE);
        if (near && input.interact && hovering) {
          state.hold += dt;
          state.progress = clamp((state.charges.filter(c => c.planted).length + state.hold / 3) / state.charges.length, 0, 1);
          if (state.hold >= 3) {
            state.hold = 0;
            near.planted = true;
            const left = state.charges.filter(c => !c.planted).length;
            emit('planted', { left });
            if (!left) { state.fuse = FUSE; emit('fuse', { seconds: FUSE }); }
          }
        } else if (state.hold > 0) { state.hold = 0; }
      }
      if (state.stage === 1 && toHome < ARRIVE) finish(state, emit);
      break;
    }
    case 'spotter': {
      const live = state.targets.filter(t => !t.dead && !t.marked);
      // Too close and you are the one being watched, which is the opposite of every other
      // job on the board.
      const tooClose = state.targets.some(t => !t.dead && distance(craft, t) < COMPROMISE);
      if (tooClose) {
        state.compromised += dt;
        if (state.compromised > 3) {
          fail(state, emit, 'COMPROMISED', 'They saw the aircraft, not the target. Stay out at range next time.');
          return state.events;
        }
      } else state.compromised = Math.max(0, state.compromised - dt * 0.5);
      const mark = live.sort((a, b) => distance(craft, a) - distance(craft, b))[0];
      if (mark) {
        const d = distance(craft, mark);
        if (input.interact && d >= LAZE[0] && d <= LAZE[1]) {
          mark.laze = (mark.laze ?? 0) + dt;
          state.hold = mark.laze;
          if (mark.laze >= LAZE_HOLD) {
            mark.marked = true;
            damageHostile(combat, mark, 9999);
            emit('called', { left: state.targets.filter(t => !t.dead).length, x: mark.x, z: mark.z });
          }
        } else if (mark.laze) { mark.laze = 0; state.hold = 0; emit('lazeLost'); }
      }
      state.progress = state.targets.filter(t => t.dead).length / state.targets.length;
      if (!state.targets.some(t => !t.dead)) { state.stage = 1; if (toHome < ARRIVE) finish(state, emit); }
      break;
    }
    case 'search': {
      const beacon = state.entities[0];
      if (!beacon.aboard) {
        state.battery -= dt;
        if (state.battery <= 0) {
          fail(state, emit, 'BEACON DEAD', 'The battery went before you did. It is still out there somewhere.');
          return state.events;
        }
        const d = Math.hypot(craft.x - state.beacon.x, craft.z - state.beacon.z);
        state.progress = clamp(1 - d / 320, 0, 0.95);
        // It only becomes a thing you can see once you are nearly on top of it; until then
        // the signal is all you have.
        beacon.hidden = d > 45;
        if (d < 18 && input.interact && hovering) {
          state.hold += dt;
          if (state.hold >= 2) { beacon.aboard = true; state.cargo = 1; state.stage = 1; emit('aboard', { id: 'beacon', remaining: 0 }); }
        } else if (!(d < 18 && input.interact)) state.hold = 0;
      }
      if (state.stage === 1 && toHome < ARRIVE && hovering) { state.delivered = 1; finish(state, emit); }
      break;
    }
    case 'smuggling': {
      // Anything with a sensor sweeps for you. The garrisons are the real ones streamed
      // from the world, so the route you pick is the whole job.
      let painted = false, closest = Infinity;
      for (const hostile of combat.hostiles) {
        if (hostile.dead) continue;
        const reach = DETECT[hostile.type];
        if (!reach) continue;
        const d = distance(hostile, craft);
        closest = Math.min(closest, d / reach);
        if (d < reach) painted = true;
      }
      state.painted = painted;
      state.exposure = Number.isFinite(closest) ? closest : 9;
      if (painted) {
        state.seen += dt;
        if (state.seen > SEEN_LIMIT) {
          fail(state, emit, 'PAINTED', 'You went over a radar with the cargo aboard. The client heard about it first.');
          return state.events;
        }
      } else state.seen = Math.max(0, state.seen - dt * 0.6);
      const atSite = distance(craft, state.zone) < state.zone.radius;
      if (state.cargo > 0 && atSite && input.interact && hovering) {
        state.hold += dt;
        state.progress = clamp(state.hold / 2.5, 0, 1);
        if (state.hold >= 2.5) { state.cargo = 0; state.delivered = 1; state.stage = 1; emit('dropped'); }
      } else if (state.stage === 0) { state.hold = 0; state.progress = 0; }
      if (state.stage === 1 && toHome < ARRIVE) finish(state, emit);
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
    sabotage: state.fuse !== null ? `GET CLEAR · ${state.fuse.toFixed(1)} S`
      : state.stage === 1 ? 'CHARGES BLOWN · RETURN TO THE YARD'
        : `SET THE CHARGES · ${state.charges.filter(c => c.planted).length}/${state.charges.length}`,
    spotter: state.stage === 1 ? 'GUNS ACCOUNTED FOR · RETURN TO THE YARD'
      : `HOLD THE DESIGNATOR FROM ${LAZE[0] * WORLD.metresPerUnit} M OUT · ${state.targets.filter(t => t.dead).length}/${state.targets.length}`,
    search: state.stage === 1 ? 'BEACON ABOARD · RETURN TO THE YARD'
      : `FLY THE SIGNAL · ${Math.max(0, Math.round(state.battery ?? 0))} S OF BATTERY`,
    smuggling: state.stage === 1 ? 'CARGO DELIVERED · RETURN TO THE YARD'
      : state.painted ? 'ON A SCREEN · BREAK CONTACT' : 'RUN IT IN UNSEEN',
  };
  return {
    label: labels[state.kind] ?? state.contract.title,
    marker, progress: state.progress,
    holding: state.hold > 0,
    done: state.done, failed: state.failed,
    range: marker ? distance(craft, marker) : 0,
    // Extras the HUD shows when the kind has them. Signal strength stands in for a marker
    // on a search, and exposure is the warning on a quiet run.
    signal: state.kind === 'search' && state.beacon
      ? clamp(1 - Math.hypot(craft.x - state.beacon.x, craft.z - state.beacon.z) / 320, 0, 1) : null,
    painted: state.painted ?? false,
    exposure: state.exposure ?? null,
    fuse: state.fuse,
    deadline: state.deadline,
    complication: state.complication?.name ?? null,
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
    case 'strike':
    case 'spotter': return state.targets.find(t => !t.dead) ?? state.home;
    case 'sabotage': {
      // Once the fuse is lit the only place worth flying to is away, so the marker becomes
      // the yard rather than the thing about to explode.
      if (state.fuse !== null || state.stage === 1) return state.home;
      return state.charges.find(c => !c.planted) ?? state.home;
    }
    // A search deliberately has no marker on the beacon: the site is where you were told
    // to look, and the signal strength is the only other thing you get.
    case 'search': return state.stage === 1 ? state.home : state.site;
    default: return state.zone ?? state.site;
  }
}

// Mission-spawned hostiles must not outlive the job.
export function clearMission(state, combat) {
  if (!state || !combat) return;
  const ids = new Set(state.targets.map(t => t.id));
  combat.hostiles = combat.hostiles.filter(h => !ids.has(h.id));
}
