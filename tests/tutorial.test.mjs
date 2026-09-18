// The first minute, driven the way a player would drive it.
//
// The script is a pure state machine, so the whole opening can be played here: walk, board,
// lift, fly, read the map, drop the crate, come home. The assertions are the things that
// would actually spoil it — a sentence that is two sentences, a step that cannot be
// completed, an order that teaches flying before boarding, or a minute that turns into five.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TUTORIAL, TUTORIAL_BUDGET, createTutorial, stepTutorial, skipTutorial, tutorialStep,
} from '../src/tutorial.js';

const START = {
  stance: 'afoot', walked: 0, airborne: 0, flown: 0,
  mapOpened: false, cargoDown: false, jobDone: false,
};

// Plays the script the way a competent player would: whatever the current step is waiting
// for, do that and nothing else.
function play({ dt = 1 / 30, limit = 600 } = {}) {
  const state = createTutorial();
  const snapshot = { ...START };
  const seen = [];
  let clock = 0;
  for (let i = 0; i < limit / dt; i++) {
    for (const event of stepTutorial(state, snapshot, dt)) {
      if (event.type === 'enter') seen.push({ id: event.id, at: +clock.toFixed(2) });
      if (event.type === 'finish') return { state, seen, clock, snapshot };
    }
    clock += dt;
    // Satisfy the current step, and only the current step.
    const step = tutorialStep(state);
    if (!step) continue;
    if (step.id === 'yard' || step.id === 'trade') snapshot.walked += 4 * dt;
    if (step.id === 'board') snapshot.stance = 'landed';
    if (step.id === 'lift') { snapshot.stance = 'flying'; snapshot.airborne = 12; }
    if (step.id === 'fly') snapshot.flown += 30 * dt;
    if (step.id === 'map') snapshot.mapOpened = true;
    if (step.id === 'drop') snapshot.cargoDown = true;
    if (step.id === 'home') snapshot.jobDone = true;
  }
  assert.fail('the tutorial never finished');
}

test('every step is one sentence, with something to do and a name', () => {
  for (const step of TUTORIAL) {
    assert.ok(step.id && typeof step.id === 'string', 'a step has an id');
    const sentence = step.say('THE LONG SAVANNA');
    assert.equal(typeof sentence, 'string');
    assert.ok(sentence.length > 20 && sentence.length < 130, `${step.id}: "${sentence}" is the wrong length for a prompt`);
    // One sentence: one terminal stop, at the end.
    const stops = sentence.match(/[.!?]/g) ?? [];
    assert.equal(stops.length, 1, `${step.id} is ${stops.length} sentences: "${sentence}"`);
    assert.ok(sentence.trim().endsWith('.'), `${step.id} ends in a full stop`);
    assert.ok(step.hint && step.hint.length < 30, `${step.id} has a short hint`);
    assert.equal(typeof step.done, 'function', `${step.id} can be completed`);
    assert.ok(step.minSeconds > 0 && step.minSeconds <= 6, `${step.id} holds for ${step.minSeconds}s`);
  }
});

test('it teaches in an order that makes sense', () => {
  const order = TUTORIAL.map(s => s.id);
  assert.deepEqual(order, ['yard', 'trade', 'board', 'lift', 'fly', 'job', 'map', 'drop', 'home', 'done']);
  const before = (a, b) => order.indexOf(a) < order.indexOf(b);
  // You cannot be taught to lift off before you have been told to get in.
  assert.ok(before('board', 'lift'), 'board before lift');
  assert.ok(before('lift', 'fly'), 'lift before fly');
  assert.ok(before('fly', 'drop'), 'fly before the drop');
  assert.ok(before('job', 'map'), 'the job is in hand before the map is explained');
  assert.ok(before('drop', 'home'), 'drop before coming home');
  // And the very first thing is the only thing you can do on foot with nothing explained.
  assert.equal(order[0], 'yard');
});

test('a player who does as they are told finishes in about a minute', () => {
  const { seen, clock } = play();
  assert.equal(seen.length, TUTORIAL.length, 'every step was reached');
  assert.deepEqual(seen.map(s => s.id), TUTORIAL.map(s => s.id), 'and in order');
  // The script's own dwell times are the floor; a real run adds flying time on top, which is
  // why the budget is the thing pinned here rather than the wall clock.
  assert.ok(TUTORIAL_BUDGET >= 15 && TUTORIAL_BUDGET <= 40,
    `the script holds its sentences for ${TUTORIAL_BUDGET}s in total`);
  assert.ok(clock < 90, `driven perfectly it finishes in ${clock.toFixed(1)}s`);
  assert.ok(clock > 18, 'and it is not over before the player has read anything');
});

test('a sentence cannot be skipped past by doing the thing instantly', () => {
  const state = createTutorial();
  // Everything already satisfied, from the first frame.
  const done = { stance: 'flying', walked: 999, airborne: 99, flown: 999,
    mapOpened: true, cargoDown: true, jobDone: true };
  stepTutorial(state, done, 1 / 30);          // enters the first step
  assert.equal(tutorialStep(state).id, 'yard');
  stepTutorial(state, done, 1 / 30);
  assert.equal(tutorialStep(state).id, 'yard', 'one frame does not clear a sentence');
  // Only once the first step has had its time does it move on.
  let guard = 0;
  while (tutorialStep(state)?.id === 'yard' && guard++ < 1000) stepTutorial(state, done, 1 / 30);
  assert.equal(tutorialStep(state).id, 'trade', 'and then it moves on');
});

test('each step waits for its own condition and nothing else', () => {
  // A player who walks but never gets in stays on the boarding step for ever.
  const state = createTutorial();
  const snapshot = { ...START, walked: 50 };
  for (let i = 0; i < 60 * 30; i++) stepTutorial(state, snapshot, 1 / 30);
  assert.equal(tutorialStep(state).id, 'board',
    'thirty seconds of walking does not teach you to fly');
  // And the moment they board, it advances.
  snapshot.stance = 'landed';
  for (let i = 0; i < 90; i++) stepTutorial(state, snapshot, 1 / 30);
  assert.equal(tutorialStep(state).id, 'lift');
});

test('it can be abandoned, and stays abandoned', () => {
  const state = createTutorial();
  stepTutorial(state, START, 1 / 30);
  assert.equal(skipTutorial(state), true);
  assert.equal(tutorialStep(state), null, 'nothing is being taught any more');
  assert.deepEqual(stepTutorial(state, START, 1 / 30), [], 'and it stays quiet');
  assert.equal(skipTutorial(state), false, 'skipping twice does nothing');
});

test('the sentences name the region and the drop rather than a placeholder', () => {
  const yard = TUTORIAL.find(s => s.id === 'yard');
  assert.match(yard.say('THE GREEN DELTA'), /THE GREEN DELTA/, 'the opening names where you are');
  const job = TUTORIAL.find(s => s.id === 'job');
  assert.match(job.say('BRINE STATION'), /BRINE STATION/, 'and the job names where it is going');
});
