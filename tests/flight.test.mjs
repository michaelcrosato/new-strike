// The flight model, against the machine it is meant to be.
//
// This used to cruise at 468 km/h and dash at 828, which is a jet: the far corner of a
// ten-kilometre region was forty seconds away and the map felt like a courtyard. These
// assertions pin the speeds to the class of aircraft the game says you are flying, and pin
// the region to those speeds — the point of 100 km² is that it takes a gunship a couple of
// minutes to cross it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORLD } from '../src/worldgen.js';
import {
  FLIGHT, CRUISE, TOP, HOVER, kmhToUnits, unitsToKmh, crossingSeconds, rangeKm, diagonalKm,
} from '../src/flight.js';

test('cruise and top speed are those of a modern attack helicopter', () => {
  // An AH-64E cruises at 278 km/h and tops out near 293; an Mi-28 at 270 and 320; a Tiger at
  // 230 and 290; an AH-1Z at 265 and 300. Anything inside these bounds is in the class.
  assert.ok(FLIGHT.cruiseKmh >= 230 && FLIGHT.cruiseKmh <= 290,
    `cruise is ${FLIGHT.cruiseKmh} km/h, outside the 230–290 the class flies`);
  assert.ok(FLIGHT.topKmh >= 290 && FLIGHT.topKmh <= 330,
    `top speed is ${FLIGHT.topKmh} km/h, outside the 290–330 the class reaches`);
  assert.ok(FLIGHT.topKmh > FLIGHT.cruiseKmh, 'the dash is faster than the cruise');
  // And nothing like a jet.
  assert.ok(FLIGHT.topKmh < 400, 'a helicopter, not an aeroplane');
});

test('the conversion between kilometres per hour and world units holds', () => {
  assert.equal(WORLD.metresPerUnit, 5);
  assert.ok(Math.abs(unitsToKmh(CRUISE) - FLIGHT.cruiseKmh) < 0.01, 'round trip');
  assert.ok(Math.abs(kmhToUnits(FLIGHT.topKmh) - TOP) < 1e-9);
  // 265 km/h is 73.6 m/s, which at five metres a unit is 14.7 units a second.
  assert.ok(Math.abs(CRUISE - 14.72) < 0.02, `cruise is ${CRUISE.toFixed(2)} units/s`);
  assert.ok(Math.abs(TOP - 17.5) < 0.02, `top is ${TOP.toFixed(2)} units/s`);
});

test('the region takes a gunship a couple of minutes to cross', () => {
  const acrossMinutes = crossingSeconds(WORLD.size, FLIGHT.cruiseKmh) / 60;
  assert.ok(acrossMinutes > 1.6 && acrossMinutes < 3.2,
    `crossing the region at cruise takes ${acrossMinutes.toFixed(2)} minutes`);
  const dashMinutes = crossingSeconds(WORLD.size, FLIGHT.topKmh) / 60;
  assert.ok(dashMinutes < acrossMinutes, 'the dash gets there sooner');
  // A job at the far edge is about seven kilometres out from a central yard: a real transit,
  // not a hop, and not a commute either.
  const legMinutes = crossingSeconds(WORLD.half, FLIGHT.cruiseKmh) / 60;
  assert.ok(legMinutes > 0.8 && legMinutes < 1.6, `a far leg is ${legMinutes.toFixed(2)} minutes`);
});

test('a basic tank reaches anywhere on the map and back', () => {
  const diagonal = diagonalKm();
  assert.ok(Math.abs(diagonal - 14.14) < 0.1, `the region's diagonal is ${diagonal.toFixed(2)} km`);
  const cruising = rangeKm(100, FLIGHT.burn.cruise, FLIGHT.cruiseKmh);
  assert.ok(cruising > diagonal * 2,
    `a full basic tank goes ${cruising.toFixed(1)} km, which must clear a return trip across ${diagonal.toFixed(1)} km`);
  assert.ok(cruising < diagonal * 4, `${cruising.toFixed(1)} km of range would make the gauge pointless`);
  // Dashing costs range, which is the trade it should be.
  const dashing = rangeKm(100, FLIGHT.burn.dash, FLIGHT.topKmh);
  assert.ok(dashing < cruising, `dashing goes ${dashing.toFixed(1)} km against ${cruising.toFixed(1)} at cruise`);
});

test('hovering means hovering', () => {
  // The winch and the scan require a hover. The threshold was nine units a second, which is
  // 162 km/h — most of cruise, so you could winch a survivor aboard on a fast pass.
  assert.ok(FLIGHT.hoverKmh <= 60, `${FLIGHT.hoverKmh} km/h is not a hover`);
  assert.ok(HOVER < CRUISE * 0.25, 'and it is well below cruise');
  assert.ok(unitsToKmh(HOVER) === FLIGHT.hoverKmh);
});

test('the machine takes time to answer the throttle', () => {
  // Reaching cruise should take a few seconds, not a fraction of one: that delay is what
  // makes it feel like a helicopter and what makes the dash worth holding.
  const toCruise = seconds => CRUISE * (1 - Math.exp(-seconds / FLIGHT.spoolSeconds));
  assert.ok(toCruise(0.25) < CRUISE * 0.25, 'a quarter second gets you nowhere near cruise');
  assert.ok(toCruise(4) > CRUISE * 0.9, 'four seconds gets you most of the way');
  assert.ok(FLIGHT.spoolSeconds > 0.6 && FLIGHT.spoolSeconds < 3,
    `a ${FLIGHT.spoolSeconds}s time constant is outside what reads as a helicopter`);
  // Turning slows with speed.
  assert.ok(FLIGHT.yawRate.top < FLIGHT.yawRate.hover, 'you turn tighter slowly than quickly');
});
