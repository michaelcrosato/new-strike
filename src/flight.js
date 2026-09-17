// How the aircraft moves, in numbers a pilot would recognise.
//
// This used to cruise at 468 km/h and dash at 828 — jet speeds, which made a ten-kilometre
// region feel like a courtyard: the far corner was forty seconds away and the whole map was
// a minute wide. A modern attack helicopter is much slower than that, and the region was
// always sized for the real thing.
//
//   AH-64E Apache Guardian   cruise 150 kt (278 km/h)   max 158 kt (293)   Vne 197 kt (365)
//   Mi-28N Havoc             cruise 270 km/h            max 320
//   Ka-52 Alligator          cruise 260                 max 300
//   Airbus Tiger             cruise 230                 max 290
//   AH-1Z Viper              cruise 265                 max 300
//
// 265 and 315 km/h sit in the middle of that class. Over 100 km² that puts the far side of
// the region a little under two minutes away at cruise, and makes a contract's distance
// something you feel rather than something you read off the board.

import { WORLD } from './worldgen.js';

/** Kilometres per hour to world units per second, and back. One unit is five metres. */
export const kmhToUnits = kmh => kmh / 3.6 / WORLD.metresPerUnit;
export const unitsToKmh = units => units * WORLD.metresPerUnit * 3.6;

export const FLIGHT = {
  cruiseKmh: 265,          // what it does with the throttle where you left it
  topKmh: 315,             // what it does with SHIFT held, near enough to Vne
  hoverKmh: 40,            // slow enough to work a winch or hold a scan

  // How long the machine takes to answer the throttle, as the time constant of its
  // response. It was a third of a second, which is a car. Three tonnes of helicopter
  // building to cruise takes a few seconds, and that delay is most of what makes the dash
  // feel like a dash when it is only twenty per cent faster.
  spoolSeconds: 1.25,

  // Turning is slower the faster you are going, the way it is in the air: a rotor that can
  // pivot on the spot in the hover has to fly a radius at 300 km/h. This is the rate the
  // nose settles in behind the direction of travel when nobody is aiming.
  yawRate: { hover: 6.2, top: 2.4 },

  // How fast the nose answers an aim input. Much quicker than the above, because pointing
  // the aircraft is aiming a gun rather than flying a turn — but not instant, or the
  // machine snaps around like a turret.
  aimRate: 13,

  // Fuel, per second. A full basic tank is a hundred, which at cruise is a little over two
  // and a half times the region's diagonal — enough that a job anywhere on the map is
  // reachable and back, and not so much that the gauge stops mattering. The dash costs
  // range, which is the trade it should be.
  burn: { cruise: 0.21, dash: 0.36 },
};

export const CRUISE = kmhToUnits(FLIGHT.cruiseKmh);
export const TOP = kmhToUnits(FLIGHT.topKmh);
export const HOVER = kmhToUnits(FLIGHT.hoverKmh);

/** Seconds to cross a distance in world units at a given speed in km/h. */
export const crossingSeconds = (units, kmh) => units * WORLD.metresPerUnit / (kmh / 3.6);

/** How far a tank goes, in kilometres, at a given speed and burn rate. */
export const rangeKm = (fuel, burnPerSecond, kmh) => fuel / burnPerSecond * kmh / 3600;

/** The region's corner-to-corner distance, in kilometres. */
export const diagonalKm = () => WORLD.size * Math.SQRT2 * WORLD.metresPerUnit / 1000;
