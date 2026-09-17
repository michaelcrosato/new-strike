// The four newer contract kinds and the complications that ride on any of them.
//
// Each of the newer kinds deliberately inverts a habit the first eight teach — stand off
// instead of closing, navigate on an instrument instead of a marker, route around instead
// of through, get clear instead of holding station — so each one needs its own proof that
// the inversion actually bites, not just that the job can be finished.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/worldgen.js';
import {
  createProfile, generateContracts, COMPLICATIONS, contractKind, CONTRACT_KINDS, canFly,
} from '../src/agency.js';
import { createCombat, rearm, damageHostile } from '../src/combat.js';
import { startMission, stepMission, missionStatus, clearMission } from '../src/missions.js';

const world = createWorld(20492);
const craftAt = (x, z, y = null) => ({ x, z, y: y ?? world.groundHeight(x, z) + 14, yaw: 0, vx: 0, vz: 0 });

function ready(profile = createProfile()) {
  const combat = createCombat(profile);
  rearm(combat, profile);
  return combat;
}

function pickContract(profile, kind) {
  for (let day = 1; day < 160; day++) {
    const found = generateContracts(world, profile, { day, count: 8 }).find(c => c.kind === kind);
    if (found) return found;
  }
  assert.fail(`${kind} never appeared on the board`);
}

// Sets a job up and returns everything needed to fly it a step at a time.
function begin(kind, complication = null) {
  const profile = createProfile();
  profile.heli.hardpoint = 3;
  // The board attaches complications of its own, so a job asked for without one is
  // explicitly stripped. Otherwise a control case quietly arrives with a twist on it.
  const contract = { ...pickContract(profile, kind), complication };
  const combat = ready(profile);
  const state = startMission(world, profile, contract, combat);
  return { profile, contract, combat, state };
}
const run = (state, ctx, seconds, stop = () => false) => {
  for (let i = 0; i < seconds * 60 && !state.done && !state.failed && !stop(); i++) stepMission(state, ctx, 1 / 60);
};

// ---------------------------------------------------------------- sabotage
test('a sabotage job lights a fuse, and being there when it goes hurts', () => {
  const { combat, state } = begin('sabotage');
  const craft = craftAt(state.charges[0].x, state.charges[0].z);
  const ctx = { world, craft, combat, input: { interact: true } };
  for (const charge of state.charges) {
    craft.x = charge.x; craft.z = charge.z;
    run(state, ctx, 8, () => charge.planted);
    assert.ok(charge.planted, 'the charge goes on with a steady hover alongside it');
  }
  assert.ok(state.fuse > 0, 'the last charge lights the fuse');
  const before = combat.armour;
  craft.x = state.charges[0].x + 8; craft.z = state.charges[0].z;    // sitting on it
  run(state, ctx, 30, () => state.fuse === null);
  assert.ok(combat.armour < before, `watching it go should hurt: ${before} -> ${combat.armour}`);
  assert.ok(state.targets.every(t => t.dead), 'and the structures are gone');
  assert.equal(state.failed, false, 'it is still a finished job, just an expensive one');
});

test('getting clear of the fuse costs you nothing', () => {
  const { combat, state } = begin('sabotage');
  const craft = craftAt(state.charges[0].x, state.charges[0].z);
  const ctx = { world, craft, combat, input: { interact: true } };
  for (const charge of state.charges) {
    craft.x = charge.x; craft.z = charge.z;
    run(state, ctx, 8, () => charge.planted);
  }
  const before = combat.armour;
  craft.x = state.charges[0].x + 400; craft.z = state.charges[0].z;
  run(state, ctx, 30, () => state.fuse === null);
  assert.equal(combat.armour, before, 'four hundred units out is out');
  assert.equal(state.stage, 1, 'and the job moves to the run home');
  assert.equal(missionStatus(state, craft).marker, state.home, 'the marker sends you home, not back in');
});

test('flattening what you were paid to mine fails the sabotage', () => {
  const { combat, state } = begin('sabotage');
  const craft = craftAt(state.site.x, state.site.z);
  damageHostile(combat, state.targets[0], 9999);
  stepMission(state, { world, craft, combat, input: {} }, 1 / 60);
  assert.equal(state.failed, true);
  assert.match(state.title, /CHARGES WASTED/);
  assert.ok(state.reason.length > 20, 'and Quill explains why');
});

// ---------------------------------------------------------------- spotter
const standOff = (state, target, distance) => {
  // Out past the target on the far side from the site, where no other gun in the group is
  // inside the compromise radius.
  const dx = target.x - state.site.x, dz = target.z - state.site.z;
  const len = Math.hypot(dx, dz) || 1;
  return craftAt(target.x + dx / len * distance, target.z + dz / len * distance);
};

test('a spotter job fails if you close on the guns instead of marking them', () => {
  const { combat, state } = begin('spotter');
  const target = state.targets[0];
  const craft = craftAt(target.x, target.z);                         // straight overhead
  const ctx = { world, craft, combat, input: { interact: true } };
  run(state, ctx, 8);
  assert.equal(state.failed, true, 'sitting on top of an anti-air gun is being seen');
  assert.match(state.title, /COMPROMISED/);
});

test('a designator only counts from the stand-off band', () => {
  const { combat, state } = begin('spotter');
  const target = state.targets.find(t => !t.dead);
  const far = standOff(state, target, 240);
  const ctx = { world, craft: far, combat, input: { interact: true } };
  run(state, ctx, 8);
  assert.equal(target.dead, false, 'too far out to designate');
  const band = standOff(state, target, 60);
  ctx.craft = band;
  run(state, ctx, 8, () => target.dead);
  assert.equal(target.dead, true, 'in the band, the call goes through');
  assert.equal(state.failed, false);
});

test('letting go of the designator loses the mark', () => {
  const { combat, state } = begin('spotter');
  const target = state.targets.find(t => !t.dead);
  const craft = standOff(state, target, 60);
  const ctx = { world, craft, combat, input: { interact: true } };
  for (let i = 0; i < 90; i++) stepMission(state, ctx, 1 / 60);
  assert.ok(target.laze > 1, 'marking');
  ctx.input = { interact: false };
  const events = stepMission(state, ctx, 1 / 60);
  assert.equal(target.laze, 0, 'released, and it resets');
  assert.ok(events.some(e => e.type === 'lazeLost'), 'and the HUD is told');
});

// ---------------------------------------------------------------- search
test('a search gives you signal strength instead of a marker', () => {
  const { combat, state } = begin('search');
  const far = craftAt(state.site.x + 300, state.site.z + 300);
  const near = craftAt(state.beacon.x, state.beacon.z);
  assert.ok(missionStatus(state, near).signal > missionStatus(state, far).signal,
    'the signal rises as you close');
  const marker = missionStatus(state, far).marker;
  assert.ok(Math.hypot(marker.x - state.beacon.x, marker.z - state.beacon.z) > 1,
    'the marker is where you were told to look, not where the thing is');
  assert.equal(state.entities[0].hidden, true, 'and it is not drawn until you are on it');
  stepMission(state, { world, craft: near, combat, input: {} }, 1 / 60);
  assert.equal(state.entities[0].hidden, false, 'close enough to have spotted it');
});

test('a search beacon dies if you take too long', () => {
  const { combat, state } = begin('search');
  const craft = craftAt(state.site.x + 300, state.site.z + 300);
  const ctx = { world, craft, combat, input: {} };
  run(state, ctx, 300);
  assert.equal(state.failed, true, 'the battery runs out');
  assert.match(state.title, /BEACON DEAD/);
});

// ---------------------------------------------------------------- quiet run
const radarAt = (x, z) => ({ id: 'eye', type: 'radar', x, z, y: 4, faction: 1,
  hp: 190, maxHp: 190, dead: false, cooldown: 9, yaw: 0, home: { x, z } });

test('a quiet run is blown by flying over a radar', () => {
  const { combat, state } = begin('smuggling');
  const craft = craftAt(state.site.x, state.site.z);
  combat.hostiles.push(radarAt(craft.x + 20, craft.z));
  const ctx = { world, craft, combat, input: {} };
  run(state, ctx, 8);
  assert.equal(state.failed, true, 'a radar overhead ends the job');
  assert.match(state.title, /PAINTED/);
  assert.ok(missionStatus(state, craft).painted, 'and the HUD said so while it was happening');
});

test('staying off the screens keeps a quiet run alive', () => {
  const { combat, state } = begin('smuggling');
  const craft = craftAt(state.site.x, state.site.z);
  combat.hostiles.push(radarAt(craft.x + 400, craft.z));
  const ctx = { world, craft, combat, input: { interact: true } };
  run(state, ctx, 8, () => state.stage === 1);
  assert.equal(state.failed, false);
  assert.equal(state.seen, 0, 'never painted');
  assert.equal(state.stage, 1, 'and the cargo goes down');
});

test('exposure warns before it fails', () => {
  const { combat, state } = begin('smuggling');
  const craft = craftAt(state.site.x, state.site.z);
  combat.hostiles.push(radarAt(craft.x + 200, craft.z));
  stepMission(state, { world, craft, combat, input: {} }, 1 / 60);
  const outside = missionStatus(state, craft).exposure;
  assert.ok(outside > 1, 'outside the ring, exposure is over one');
  craft.x = state.site.x + 140;
  stepMission(state, { world, craft, combat, input: {} }, 1 / 60);
  assert.ok(missionStatus(state, craft).exposure < outside, 'and it closes as you close');
});

// ---------------------------------------------------------------- complications
test('a deadline ends any job, whatever kind it is', () => {
  for (const kind of ['survey', 'patrol', 'strike']) {
    const { combat, state } = begin(kind, { key: 'deadline', name: 'ON THE CLOCK', seconds: 30, pay: 1.22 });
    const craft = craftAt(world.home.x, world.home.z);
    assert.equal(state.deadline, 30);
    run(state, { world, craft, combat, input: {} }, 40);
    assert.equal(state.failed, true, `${kind} runs out of time`);
    assert.match(state.title, /OUT OF TIME/);
  }
});

test('a hot site has more guns on it than the brief admits', () => {
  const plain = begin('survey').state;
  const hot = begin('survey', { key: 'hot', name: 'SITE IS HOT', pay: 1.3 });
  assert.equal(plain.targets.length, 0, 'a survey normally has no targets at all');
  assert.equal(hot.state.targets.length, 2, 'a hot one comes with two');
  assert.ok(hot.state.targets.every(t => t.mission), 'and they belong to the job');
  clearMission(hot.state, hot.combat);
  assert.ok(!hot.combat.hostiles.some(h => h.mission), 'so they leave with it');
});

test('the other two complications are flags the harness acts on', () => {
  const wet = begin('delivery', { key: 'weather', name: 'WEATHER CLOSING', pay: 1.18 }).state;
  const rights = begin('delivery', { key: 'salvage', name: 'SALVAGE RIGHTS', pay: 0.88 }).state;
  assert.equal(wet.weather, true);
  assert.equal(wet.salvageRights, false);
  assert.equal(rights.salvageRights, true);
  assert.equal(missionStatus(rights, craftAt(0, 0)).complication, 'SALVAGE RIGHTS');
});

test('complications reach the board, count against the risk and move the fee', () => {
  const profile = createProfile();
  let withTwist = 0, total = 0;
  for (let day = 1; day < 40; day++) {
    for (const contract of generateContracts(world, profile, { day, count: 8 })) {
      total++;
      if (!contract.complication) continue;
      withTwist++;
      assert.ok(COMPLICATIONS.some(c => c.key === contract.complication.key), 'a known complication');
      assert.ok(contract.risk > contractKind(contract.kind).risk, 'it counts against the risk');
    }
  }
  assert.ok(withTwist > 0, 'some of the board carries one');
  assert.ok(withTwist < total * 0.6, `but not most of it: ${withTwist} of ${total}`);
});

// ---------------------------------------------------------------- gating
test('work that needs a fitting you do not have never reaches the board', () => {
  const bare = createProfile();
  bare.heli.winch = 0;
  assert.equal(canFly(bare, contractKind('sabotage')), false);
  const offered = new Set();
  for (let day = 1; day < 60; day++) {
    for (const contract of generateContracts(world, bare, { day, count: 8 })) offered.add(contract.kind);
  }
  assert.ok(!offered.has('sabotage'), 'no charges without a winch to lower them on');
  assert.ok(!offered.has('search'), 'and nothing to lift a beacon with either');
  assert.ok(offered.size > 4, `but there is still plenty of work: ${[...offered].join(', ')}`);
});

test('every kind is reachable by a fully fitted outfit', () => {
  const kitted = createProfile();
  kitted.heli.hardpoint = 3; kitted.heli.winch = 2;
  const offered = new Set();
  for (let day = 1; day < 400; day++) {
    for (const contract of generateContracts(world, kitted, { day, count: 8 })) offered.add(contract.kind);
  }
  for (const kind of CONTRACT_KINDS) {
    assert.ok(offered.has(kind.key), `${kind.key} is offered to somebody`);
  }
});

// ---------------------------------------------------------------- landmarks as work
test('landmarks are offered as work, and every job knows its region', () => {
  const profile = createProfile();
  const named = new Set(world.landmarks().map(m => m.name));
  let found = 0;
  for (let day = 1; day < 60; day++) {
    for (const contract of generateContracts(world, profile, { day, count: 8 })) {
      assert.ok(contract.site.regionName, `${contract.title} knows what region it is in`);
      if (!contract.site.landmark) continue;
      found++;
      assert.ok(named.has(contract.site.name), 'the site is a real landmark');
      assert.ok(contract.site.radius > 0, 'with a real footprint to fly to');
    }
  }
  assert.ok(found > 0, 'the board sends you to the places worth naming');
});
