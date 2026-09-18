// Putting the aircraft down, and walking around once it is down.
//
// The rules about where a helicopter can sit and how fast a person moves are pure functions
// of the generated world, so they are asserted here rather than discovered in the air.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, WORLD } from '../src/worldgen.js';
import { unitsToKmh, CRUISE } from '../src/flight.js';
import {
  LANDING, FOOT, WALK, RUN, TOUCHDOWN, landingCheck, slowEnoughToLand, stepWalk,
  stepOutSpot, canBoard,
} from '../src/crew.js';

const world = createWorld(20492);
const SEEDS = [20492, 11, 777, 4242];

// ---------------------------------------------------------------- landing
test('you can put it down almost anywhere on land', () => {
  // "Anywhere" has to mean it in practice, not in principle: most of the dry ground in the
  // region should accept a helicopter.
  let land = 0, allowed = 0;
  const refusals = new Map();
  for (let z = -WORLD.half + 40; z < WORLD.half - 40; z += 37) {
    for (let x = -WORLD.half + 40; x < WORLD.half - 40; x += 37) {
      if (world.groundHeight(x, z) <= FOOT.shoreHeight) continue;
      land++;
      const check = landingCheck(world, x, z);
      if (check.ok) allowed++;
      else refusals.set(check.reason, (refusals.get(check.reason) ?? 0) + 1);
    }
  }
  const share = 100 * allowed / land;
  // Four fifths. The rest is genuinely cliff or shoreline: this region's grade distribution
  // has a long tail, and a mountain face should refuse a helicopter.
  assert.ok(share > 78,
    `only ${share.toFixed(1)}% of dry ground accepts a landing; refusals: ${[...refusals].map(([r, n]) => `${r} x${n}`).join(', ')}`);
  assert.ok(share < 97, 'and some ground is genuinely too steep or too close to the water');
});

test('it refuses the sea, the shoreline shallows and a cliff', () => {
  // Open water, wherever the region put some.
  let water = null;
  for (let z = -WORLD.half; z < WORLD.half && !water; z += 23) {
    for (let x = -WORLD.half; x < WORLD.half; x += 23) {
      if (world.groundHeight(x, z) < -6) { water = { x, z }; break; }
    }
  }
  assert.ok(water, 'the region has open water');
  const wet = landingCheck(world, water.x, water.z);
  assert.equal(wet.ok, false);
  assert.match(wet.reason, /WATER/);

  // The steepest ground the region can produce.
  let steepest = { grade: 0 };
  for (let z = -WORLD.half + 40; z < WORLD.half - 40; z += 19) {
    for (let x = -WORLD.half + 40; x < WORLD.half - 40; x += 19) {
      if (world.groundHeight(x, z) <= FOOT.shoreHeight) continue;
      const slope = world.slope(x, z, 4);
      if (slope > steepest.grade) steepest = { x, z, grade: slope };
    }
  }
  assert.ok(steepest.grade > LANDING.maxSlope,
    `the region has ground steeper than the skids allow: steepest is ${steepest.grade.toFixed(2)}`);
  const cliff = landingCheck(world, steepest.x, steepest.z);
  assert.equal(cliff.ok, false, `a ${steepest.grade.toFixed(2)} grade should be refused`);
  assert.match(cliff.reason, /STEEP/);

  // And outside the region entirely.
  assert.equal(landingCheck(world, WORLD.half + 50, 0).ok, false);
});

test('every seed lets you land at the yard and at every landmark that was built', () => {
  for (const seed of SEEDS) {
    const w = createWorld(seed);
    const home = w.home;
    const atHome = landingCheck(w, home.x, home.z);
    assert.equal(atHome.ok, true, `seed ${seed}: the yard itself must accept a landing (${atHome.reason})`);
    for (const mark of w.landmarks()) {
      if (!mark.flatten) continue;     // the chapel and the freighter stand in water
      const check = landingCheck(w, mark.x, mark.z);
      assert.equal(check.ok, true, `seed ${seed}: ${mark.short} has a platform, so it must accept a landing (${check.reason})`);
    }
  }
});

test('arriving too fast is not landing', () => {
  assert.ok(TOUCHDOWN < CRUISE * 0.5, 'the touchdown limit is well under cruise');
  assert.ok(unitsToKmh(TOUCHDOWN) === LANDING.maxTouchdownKmh);
  assert.equal(slowEnoughToLand(0, 0), true);
  assert.equal(slowEnoughToLand(TOUCHDOWN * 0.8, 0), true);
  assert.equal(slowEnoughToLand(CRUISE, 0), false, 'you cannot land at cruise');
  assert.equal(slowEnoughToLand(TOUCHDOWN * 0.8, TOUCHDOWN * 0.8), false, 'diagonally, too');
});

test('the parked airframe sits on its skids, below the hover it lifts off to', () => {
  assert.ok(LANDING.skidHeight > 0, 'the fuselage does not sink into the ground');
  assert.ok(LANDING.skidHeight < LANDING.refusedClearance, 'parked is lower than a refused hover');
  assert.ok(LANDING.refusedClearance < LANDING.liftClearance, 'and a refused hover is lower than a normal one');
});

// ---------------------------------------------------------------- on foot
test('a pilot moves at human speeds, not helicopter ones', () => {
  assert.ok(FOOT.walkKmh >= 4 && FOOT.walkKmh <= 8, `a walk is ${FOOT.walkKmh} km/h`);
  assert.ok(FOOT.runKmh >= 12 && FOOT.runKmh <= 24, `a run is ${FOOT.runKmh} km/h`);
  assert.ok(RUN > WALK * 1.5, 'running is worth doing');
  assert.ok(RUN < CRUISE * 0.1, 'and is nothing like flying');
  // Crossing a settlement on foot should be a walk, not an expedition.
  const acrossVillage = 150 / (FOOT.runKmh / 3.6);
  assert.ok(acrossVillage < 40, `crossing 150 m at a run takes ${acrossVillage.toFixed(0)} s`);
});

test('walking moves the pilot and settles at the right pace', () => {
  const spot = { x: world.home.x, z: world.home.z };
  const pilot = { x: spot.x, z: spot.z, y: 0, vx: 0, vz: 0 };
  const move = { x: 1, z: 0 };
  for (let i = 0; i < 180; i++) stepWalk(pilot, world, move, false, 1 / 60);
  assert.ok(Math.abs(Math.hypot(pilot.vx, pilot.vz) - WALK) < WALK * 0.05,
    `settles at a walk: ${unitsToKmh(Math.hypot(pilot.vx, pilot.vz)).toFixed(1)} km/h`);
  assert.ok(pilot.x > spot.x + 0.5, 'and has actually gone somewhere');
  assert.ok(pilot.stride > 0, 'and the legs have turned over');
  for (let i = 0; i < 180; i++) stepWalk(pilot, world, move, true, 1 / 60);
  assert.ok(Math.hypot(pilot.vx, pilot.vz) > WALK * 1.5, 'and running is faster');
  // Feet on the ground, whatever the ground is doing.
  assert.ok(Math.abs(pilot.y - world.groundHeight(pilot.x, pilot.z)) < 0.01, 'feet on the surface');
});

test('a pilot will not walk into the sea', () => {
  // Start on the shore and walk at the water until it refuses.
  let shore = null;
  for (let z = -WORLD.half; z < WORLD.half && !shore; z += 17) {
    for (let x = -WORLD.half; x < WORLD.half; x += 17) {
      const here = world.groundHeight(x, z);
      if (here > 1 && here < 5 && world.groundHeight(x + 26, z) < -1) { shore = { x, z }; break; }
    }
  }
  assert.ok(shore, 'the region has a shoreline');
  const pilot = { x: shore.x, z: shore.z, y: 0, vx: 0, vz: 0 };
  for (let i = 0; i < 60 * 40; i++) stepWalk(pilot, world, { x: 1, z: 0 }, true, 1 / 60);
  assert.ok(world.groundHeight(pilot.x, pilot.z) > FOOT.shoreHeight,
    `the pilot stopped on dry land, at ${world.groundHeight(pilot.x, pilot.z).toFixed(2)}`);
  assert.ok(pilot.x < shore.x + 26, 'short of the water');
});

test('stepping out puts the pilot clear of the aircraft, on ground they can stand on', () => {
  for (const seed of SEEDS) {
    const w = createWorld(seed);
    const craft = { x: w.home.x, z: w.home.z };
    const spot = stepOutSpot(w, craft);
    const away = Math.hypot(spot.x - craft.x, spot.z - craft.z);
    assert.ok(away > 3, `seed ${seed}: clear of the rotor, ${away.toFixed(1)} units out`);
    assert.ok(away <= FOOT.boardRange + 4, `seed ${seed}: and still within reach of the door`);
    assert.ok(w.groundHeight(spot.x, spot.z) > FOOT.shoreHeight, `seed ${seed}: on dry ground`);
    assert.equal(canBoard({ x: spot.x, z: spot.z }, craft), true, `seed ${seed}: close enough to climb back in`);
  }
});

test('you have to walk back to the aircraft to board it', () => {
  const craft = { x: 0, z: 0 };
  assert.equal(canBoard({ x: 0, z: 0 }, craft), true);
  assert.equal(canBoard({ x: FOOT.boardRange - 1, z: 0 }, craft), true);
  assert.equal(canBoard({ x: FOOT.boardRange + 2, z: 0 }, craft), false);
  assert.equal(canBoard({ x: 200, z: 200 }, craft), false, 'not from across the valley');
});
