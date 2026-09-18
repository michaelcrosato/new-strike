// Putting the aircraft down, and getting out of it.
//
// The flight model never actually landed: it held a clearance of eleven units over whatever
// was below and floored at four, so the lowest you could get was twenty metres off the deck
// with the rotor still turning. This is the other half — the skids reaching the ground, and
// a pilot who can climb out and walk around on it.
//
// THREE-free and pure, like the rest of the generator, so the rules about where you can put
// a helicopter down and how fast a person walks are testable without a renderer.

import { WORLD } from './worldgen.js';
import { kmhToUnits } from './flight.js';

export const LANDING = {
  // Steeper than this and the skids will not sit: one of them takes the whole machine and
  // it rolls.
  //
  // Deliberately more generous than the real thing. A slope landing in most types is
  // limited to ten or fifteen degrees, and measured against this region that would refuse
  // nearly a third of the dry ground — the grade distribution here has a median of 0.18 but
  // a long tail, p90 of 0.8. Thirty degrees accepts about four fifths of the land, which
  // reads as "if it looks flat enough, you can put it down" while a cliff face and the sea
  // still say no.
  maxSlope: 0.55,
  // Faster than this across the ground is an arrival, not a landing.
  maxTouchdownKmh: 50,
  // Where the airframe's origin sits when it is parked, so the skids rest on the surface
  // rather than the fuselage sinking into it.
  skidHeight: 1.7,
  // The hover it returns to when it lifts off, and the lowest it will hold over ground it
  // cannot land on.
  liftClearance: 11,
  refusedClearance: 4.5,
  // How fast it sinks under the descend control, in units per second.
  descentRate: 7.5,
  // How much of the rotor's speed remains once it has spun down on the ground.
  idleRotor: 0.07,
};

export const FOOT = {
  // A person in flight gear. The run is generous — twenty rather than the fifteen a real
  // sprint in that much kit manages — because a settlement is a hundred and fifty metres
  // across and nobody wants to spend two minutes crossing one.
  walkKmh: 7,
  runKmh: 20,
  // Legs answer much faster than a rotor does.
  spoolSeconds: 0.22,
  turnRate: 9,
  // How close to the aircraft you have to be to climb back in.
  boardRange: 8,
  // Where the figure's origin sits relative to the ground.
  standHeight: 0,
  // Wading is not swimming: anything at or below this is water you will not walk into.
  shoreHeight: 0.35,
  // Steeper than this and you are climbing, not walking.
  maxSlope: 0.95,
  // The camera comes in close, because a person is under two units tall and the flight
  // view is a hundred across.
  viewScale: 0.42,
};

export const WALK = kmhToUnits(FOOT.walkKmh);
export const RUN = kmhToUnits(FOOT.runKmh);
export const TOUCHDOWN = kmhToUnits(LANDING.maxTouchdownKmh);

/**
 * Whether the aircraft can be put down here, and why not if it cannot.
 *
 * "Anywhere" means anywhere a helicopter could actually sit: not in the sea, not on a cliff,
 * and not on top of something. Everything else — open ground, a hillside, a beach, a
 * settlement, the roof of the region — is fair game.
 */
export function landingCheck(world, x, z) {
  if (Math.abs(x) > WORLD.half || Math.abs(z) > WORLD.half) {
    return { ok: false, reason: 'OUTSIDE THE REGION' };
  }
  const ground = world.groundHeight(x, z);
  if (ground <= FOOT.shoreHeight) return { ok: false, reason: 'WATER BELOW — NOWHERE TO PUT IT DOWN' };
  // Measured across the footprint rather than at a point, because a machine sits on its
  // whole undercarriage and a single sample can miss the edge of a gully. Six metres is a
  // little wider than the skids, which is the honest thing to ask of the ground.
  const span = 1.2;
  let lowest = ground, highest = ground;
  for (const [dx, dz] of [[span, 0], [-span, 0], [0, span], [0, -span]]) {
    const h = world.groundHeight(x + dx, z + dz);
    lowest = Math.min(lowest, h);
    highest = Math.max(highest, h);
  }
  if (lowest <= FOOT.shoreHeight) return { ok: false, reason: 'HALF OVER WATER' };
  const grade = (highest - lowest) / (span * 2);
  if (grade > LANDING.maxSlope) return { ok: false, reason: 'TOO STEEP FOR THE SKIDS' };
  return { ok: true, ground, grade: +grade.toFixed(3) };
}

/** Whether the aircraft is slow enough across the ground to be landing rather than crashing. */
export const slowEnoughToLand = (vx, vz) => Math.hypot(vx, vz) <= TOUCHDOWN;

/**
 * One step of walking. Screen-relative movement comes in already resolved to a ground
 * direction; this handles the pace, the inertia, the terrain and what a person will not
 * walk into.
 */
export function stepWalk(pilot, world, move, running, dt) {
  const pace = running ? RUN : WALK;
  const drag = 1 - Math.exp(-dt / FOOT.spoolSeconds);
  pilot.vx += (move.x * pace - pilot.vx) * drag;
  pilot.vz += (move.z * pace - pilot.vz) * drag;

  const nextX = pilot.x + pilot.vx * dt;
  const nextZ = pilot.z + pilot.vz * dt;
  // Each axis is tried on its own, so walking into the sea along one of them still lets you
  // slide along the shore rather than sticking fast.
  if (walkable(world, nextX, pilot.z)) pilot.x = nextX; else pilot.vx = 0;
  if (walkable(world, pilot.x, nextZ)) pilot.z = nextZ; else pilot.vz = 0;

  pilot.y = world.groundHeight(pilot.x, pilot.z) + FOOT.standHeight;
  const speed = Math.hypot(pilot.vx, pilot.vz);
  pilot.pace = speed;
  // How far the legs have carried them, which is what drives the stride.
  pilot.stride = (pilot.stride ?? 0) + speed * dt;
  return pilot;
}

function walkable(world, x, z) {
  if (Math.abs(x) > WORLD.half - 2 || Math.abs(z) > WORLD.half - 2) return false;
  const ground = world.groundHeight(x, z);
  if (ground <= FOOT.shoreHeight) return false;
  return world.slope(x, z, 2) <= FOOT.maxSlope;
}

/** Where a pilot steps out to: clear of the rotor, on ground they can stand on. */
export function stepOutSpot(world, craft) {
  for (const distance of [5, 7, 9, 11]) {
    for (let i = 0; i < 8; i++) {
      const angle = i / 8 * Math.PI * 2;
      const x = craft.x + Math.cos(angle) * distance;
      const z = craft.z + Math.sin(angle) * distance;
      if (walkable(world, x, z)) return { x, z };
    }
  }
  return { x: craft.x, z: craft.z };
}

/** Whether the pilot is close enough to the aircraft to climb back in. */
export const canBoard = (pilot, craft) =>
  Math.hypot(pilot.x - craft.x, pilot.z - craft.z) <= FOOT.boardRange;
