// Combat and missions in the open world. Both are pure modules, so the whole flying loop
// can be exercised headlessly: garrisons stream in, weapons hurt them, standing decides who
// shoots, and every contract kind can be completed and failed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, WORLD, FACTIONS, chunkKey } from '../src/worldgen.js';
import { desiredChunks } from '../src/streaming.js';
import { createProfile, generateContracts, accept } from '../src/agency.js';
import {
  createCombat, rearm, syncHostiles, garrisonInChunk, stepCombat, availableWeapons,
  hostilityToward, combatStandingDeltas, damageHostile, HOSTILE_TYPES, WEAPONS, distance,
} from '../src/combat.js';
import { startMission, stepMission, missionStatus, clearMission } from '../src/missions.js';

const world = createWorld(20492);
const residentAround = (x, z) => desiredChunks(x, z).map(c => c.key);
const craftAt = (x, z, y = null) => ({ x, z, y: y ?? world.groundHeight(x, z) + 14, yaw: 0, vx: 0, vz: 0 });

function ready(profile = createProfile()) {
  const combat = createCombat(profile);
  rearm(combat, profile);
  return combat;
}

// ---------------------------------------------------------------- weapons
test('the opening airframe has only the door gun', () => {
  const p = createProfile();
  assert.equal(availableWeapons(p.heli).length, 1);
  assert.equal(availableWeapons(p.heli)[0].id, 'gun');
  p.heli.hardpoint = 3;
  assert.equal(availableWeapons(p.heli).length, 3, 'pylons bring rockets and seekers');
  assert.deepEqual(availableWeapons(p.heli).map(w => w.id), ['gun', 'rockets', 'seekers']);
});

test('armour and fuel scale with what is fitted', () => {
  const bare = createProfile(), kitted = createProfile();
  kitted.heli.armour = 3; kitted.heli.tank = 3;
  const a = ready(bare), b = ready(kitted);
  assert.ok(b.maxArmour > a.maxArmour, 'plate helps');
  assert.ok(b.maxFuel > a.maxFuel, 'tanks help');
  assert.equal(a.ammo.gun, WEAPONS[0].max);
  assert.equal(a.ammo.rockets, undefined, 'nothing to load them into');
});

// ---------------------------------------------------------------- garrisons
test('garrisons are deterministic, on the right surface, and never in your own yard', () => {
  let land = 0, afloat = 0, total = 0;
  for (let cx = -8; cx < 8; cx++) {
    for (let cz = -8; cz < 8; cz++) {
      const a = garrisonInChunk(world, cx, cz);
      assert.deepEqual(garrisonInChunk(world, cx, cz), a, 'same chunk, same garrison');
      for (const h of a) {
        total++;
        assert.ok(HOSTILE_TYPES[h.type], `${h.id} is a real type`);
        assert.ok(Math.abs(h.x) <= WORLD.half + WORLD.chunk, 'inside the region');
        const wet = world.elevation(h.x, h.z) <= WORLD.seaLevel;
        if (h.type === 'patrolboat') { assert.ok(wet, `${h.id} afloat`); afloat++; }
        else { assert.ok(!wet, `${h.id} on land`); land++; }
        assert.ok(Math.hypot(h.x - world.home.x, h.z - world.home.z) > 100, 'not on top of the yard');
        assert.ok(h.faction >= 0 && h.faction < FACTIONS.length, 'somebody owns it');
      }
    }
  }
  assert.ok(total > 40, `${total} hostiles across 256 chunks`);
  assert.ok(land > 0 && afloat > 0, 'both land and water garrisons exist');
});

test('hostiles stream in with chunks and stay dead once destroyed', () => {
  const profile = createProfile();
  const combat = ready(profile);
  const away = { x: 400, z: -300 };
  syncHostiles(combat, world, profile, residentAround(away.x, away.z));
  const first = combat.hostiles.length;
  assert.ok(first > 0, 'somebody is out there');
  const victim = combat.hostiles[0];
  damageHostile(combat, victim, 9999);
  assert.ok(victim.dead);
  assert.ok(profile.destroyed.includes(victim.id), 'remembered on the profile');
  syncHostiles(combat, world, profile, residentAround(away.x, away.z));
  assert.ok(!combat.hostiles.some(h => h.id === victim.id), 'it does not come back');
  // Fly away and back: residency changes, nothing is duplicated.
  syncHostiles(combat, world, profile, residentAround(-600, 600));
  syncHostiles(combat, world, profile, residentAround(away.x, away.z));
  const ids = combat.hostiles.map(h => h.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicates after a round trip');
});

// ---------------------------------------------------------------- shooting
test('standing decides who shoots at you', () => {
  const friendly = createProfile(), enemy = createProfile();
  for (const f of FACTIONS) enemy.standing[f.key] = -70;
  assert.equal(hostilityToward(friendly, 'cordon'), 0, 'neutral is left alone');
  assert.ok(hostilityToward(enemy, 'cordon') > 0, 'hated is engaged');

  const run = profile => {
    const combat = ready(profile);
    const spot = { x: 400, z: -300 };
    syncHostiles(combat, world, profile, residentAround(spot.x, spot.z));
    const shooter = combat.hostiles.find(h => HOSTILE_TYPES[h.type].range > 0);
    assert.ok(shooter, 'found something armed');
    const craft = craftAt(shooter.x + 12, shooter.z);
    let incoming = 0;
    for (let i = 0; i < 600; i++) {
      stepCombat(combat, world, profile, craft, {}, 1 / 60);
      incoming += combat.projectiles.filter(p => p.hostile).length;
    }
    return incoming;
  };
  assert.equal(run(friendly), 0, 'nobody fires on a neutral rotor');
  assert.ok(run(enemy) > 0, 'an enemy region fires');
});

test('firing at anyone provokes the whole neighbourhood', () => {
  const profile = createProfile();
  const combat = ready(profile);
  syncHostiles(combat, world, profile, residentAround(400, -300));
  const target = combat.hostiles.find(h => HOSTILE_TYPES[h.type].range > 0);
  const craft = craftAt(target.x + 10, target.z);
  assert.ok(!combat.provoked, 'we arrived quietly');
  for (let i = 0; i < 400 && !target.dead; i++) stepCombat(combat, world, profile, craft, { fire: true }, 1 / 60);
  assert.ok(combat.provoked, 'shooting starts a fight');
  assert.ok(combat.shotsFired > 0 && combat.hits > 0, 'rounds went out and connected');
});

test('the door gun can kill a checkpoint and the kill is scored', () => {
  const profile = createProfile();
  const combat = ready(profile);
  const spec = HOSTILE_TYPES.checkpoint;
  combat.hostiles.push({ id: 'test1', type: 'checkpoint', x: 60, z: 0, y: 3, faction: 1,
    hp: spec.hp, maxHp: spec.hp, cooldown: 99, dead: false, yaw: 0, home: { x: 60, z: 0 } });
  const craft = craftAt(40, 0, 14);
  let events = [];
  for (let i = 0; i < 1200 && !combat.hostiles[0].dead; i++) {
    events = events.concat(stepCombat(combat, world, profile, craft, { fire: true }, 1 / 60));
  }
  assert.ok(combat.hostiles[0].dead, 'it went down');
  assert.equal(combat.kills, 1);
  const destroyed = events.find(e => e.type === 'destroyed');
  assert.ok(destroyed && destroyed.score > 0, 'the kill reports a score');
  const deltas = combatStandingDeltas(events);
  assert.ok(deltas.cordon < 0, 'its owner noticed');
});

test('taking hits wears the armour down and reports being downed', () => {
  const profile = createProfile();
  const combat = ready(profile);
  const craft = craftAt(0, 0, 14);
  let downed = false;
  for (let i = 0; i < 400 && !downed; i++) {
    combat.invulnerable = 0;
    combat.projectiles.push({ id: i, x: craft.x, y: craft.y, z: craft.z, vx: 0, vy: 0, vz: 0, life: 1, damage: 14, hostile: true });
    for (const e of stepCombat(combat, world, profile, craft, {}, 1 / 60)) if (e.type === 'downed') downed = true;
  }
  assert.ok(downed, 'enough hits bring you down');
  assert.equal(combat.armour, 0);
});

test('flares pull homing missiles off you', () => {
  const profile = createProfile();
  const combat = ready(profile);
  const craft = craftAt(0, 0, 14);
  combat.projectiles.push({ id: 1, x: 20, y: 14, z: 0, vx: -20, vy: 0, vz: 0, life: 4, damage: 19, hostile: true, homing: 'craft' });
  combat.projectiles.push({ id: 2, x: 20, y: 14, z: 6, vx: -20, vy: 0, vz: 0, life: 4, damage: 9, hostile: true });
  stepCombat(combat, world, profile, craft, { flare: true }, 1 / 60);
  assert.ok(!combat.projectiles.some(p => p.id === 1), 'the missile is decoyed');
  assert.ok(combat.projectiles.some(p => p.id === 2), 'the bullet is not');
  assert.ok(combat.flareCooldown > 0, 'and it has a cooldown');
});

// ---------------------------------------------------------------- missions
function pickContract(profile, kind) {
  for (let day = 1; day < 120; day++) {
    const found = generateContracts(world, profile, { day, count: 8 }).find(c => c.kind === kind);
    if (found) return found;
  }
  return null;
}

// Flies a mission to completion the cheapest legal way, and asserts it actually completes.
function flyMission(kind) {
  const profile = createProfile();
  profile.heli.hardpoint = 3;
  const contract = pickContract(profile, kind);
  assert.ok(contract, `${kind} appears on the board`);
  accept(profile, contract);
  const combat = ready(profile);
  const state = startMission(world, profile, contract, combat);
  const craft = craftAt(world.home.x, world.home.z);
  const ctx = { world, craft, combat, input: {} };
  const go = (x, z) => { craft.x = x; craft.z = z; craft.vx = 0; craft.vz = 0; craft.y = world.groundHeight(x, z) + 12; };
  const tick = (seconds, input = {}) => {
    ctx.input = input;
    for (let i = 0; i < seconds * 60 && !state.done && !state.failed; i++) stepMission(state, ctx, 1 / 60);
  };

  for (let guard = 0; guard < 40 && !state.done && !state.failed; guard++) {
    const status = missionStatus(state, craft);
    if (state.stage === 1) { go(world.home.x, world.home.z); tick(0.4); continue; }
    if (kind === 'strike') { for (const t of state.targets) { t.dead = true; } tick(0.2); continue; }
    if (kind === 'interdiction') { state.runner.dead = true; tick(0.2); continue; }
    if (kind === 'escort') { combat.hostiles = []; go(state.convoy.x, state.convoy.z); tick(30); continue; }
    if (kind === 'patrol') { const next = state.waypoints.find(p => !p.seen); if (next) { go(next.x, next.z); tick(0.2); } continue; }
    go(status.marker.x, status.marker.z);
    tick(12, { interact: true });
  }
  return { state, profile, contract, combat };
}

for (const kind of ['survey', 'delivery', 'extraction', 'salvage', 'patrol', 'escort', 'strike', 'interdiction']) {
  test(`a ${kind} contract can be flown to completion`, () => {
    const { state, contract } = flyMission(kind);
    assert.equal(state.failed, false, `${kind} did not fail: ${state.reason}`);
    assert.equal(state.done, true, `${kind} completed`);
    assert.equal(state.progress, 1);
    const status = missionStatus(state, craftAt(world.home.x, world.home.z));
    assert.ok(status.label.length > 5, 'the HUD has something to say');
    assert.equal(contract.kind, kind);
  });
}

test('a scan interrupted resets, and finishing it needs a steady hover', () => {
  const profile = createProfile();
  const contract = pickContract(profile, 'survey');
  const combat = ready(profile);
  const state = startMission(world, profile, contract, combat);
  const craft = craftAt(state.zone.x, state.zone.z);
  const ctx = { world, craft, combat, input: { interact: true } };
  for (let i = 0; i < 180; i++) stepMission(state, ctx, 1 / 60);
  assert.ok(state.hold > 2 && state.stage === 0, 'scanning');
  craft.x += 200;
  stepMission(state, ctx, 1 / 60);
  assert.equal(state.hold, 0, 'leaving loses the scan');
  craft.x -= 200;
  craft.vx = 40;                                   // moving too fast to scan
  for (let i = 0; i < 120; i++) stepMission(state, ctx, 1 / 60);
  assert.equal(state.hold, 0, 'a fast pass does not count');
});

test('an escort left uncovered is lost, and the job fails with it', () => {
  const profile = createProfile();
  const contract = pickContract(profile, 'escort');
  const combat = ready(profile);
  const state = startMission(world, profile, contract, combat);
  const convoy = state.convoy;
  // Park an armed hostile on the column and fly away.
  const spec = HOSTILE_TYPES.checkpoint;
  // Guns along the whole route, which is what an uncovered column actually flies into.
  const route = [{ x: convoy.x, z: convoy.z }, ...convoy.path];
  route.forEach((point, i) => combat.hostiles.push({ id: 'ambush' + i, type: 'checkpoint',
    x: point.x, z: point.z, y: 3, faction: 2, hp: spec.hp, maxHp: spec.hp, cooldown: 0,
    dead: false, yaw: 0, home: { x: point.x, z: point.z } }));
  const craft = craftAt(world.home.x, world.home.z);
  const ctx = { world, craft, combat, input: {} };
  for (let i = 0; i < 60 * 120 && !state.failed; i++) stepMission(state, ctx, 1 / 60);
  assert.ok(state.failed, 'the column was lost');
  assert.equal(state.title, 'ESCORT LOST');
  assert.ok(state.reason.length > 20, 'and it says why');
});

test('a runner that reaches the border fails the job', () => {
  const profile = createProfile();
  const contract = pickContract(profile, 'interdiction');
  const combat = ready(profile);
  const state = startMission(world, profile, contract, combat);
  const craft = craftAt(world.home.x, world.home.z);
  const ctx = { world, craft, combat, input: {} };
  for (let i = 0; i < 60 * 600 && !state.failed && !state.done; i++) stepMission(state, ctx, 1 / 60);
  assert.ok(state.failed, 'it got away');
  assert.equal(state.title, 'TARGET ESCAPED');
});

test('mission targets are cleaned out of the combat list afterwards', () => {
  const profile = createProfile();
  const contract = pickContract(profile, 'strike');
  const combat = ready(profile);
  const state = startMission(world, profile, contract, combat);
  assert.ok(state.targets.length > 0);
  assert.ok(combat.hostiles.some(h => h.mission), 'the targets joined the fight');
  clearMission(state, combat);
  assert.ok(!combat.hostiles.some(h => h.mission), 'and left with the job');
});
