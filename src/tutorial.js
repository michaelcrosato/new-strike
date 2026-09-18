// The first minute.
//
// One sentence at a time, each one attached to something the player has to actually do, so
// the game teaches itself by being played rather than by being read. It replaces the wall of
// text this used to open with: a briefing card is not an introduction, it is homework.
//
// Every step is a sentence, a condition, and a minimum time on screen. The harness hands in
// a snapshot each tick and reacts to `onEnter` by id; nothing here touches the renderer, the
// DOM or the world, which is what makes the whole script testable in order.

/**
 * A snapshot is what the harness knows about the player right now:
 *
 *   stance        'afoot' | 'landed' | 'flying'
 *   walked        units covered on foot since the tutorial began
 *   airborne      units of clearance above the ground
 *   flown         units from the yard
 *   mapOpened     whether the region map has been opened at least once
 *   cargoDown     whether the crate has been set down
 *   jobDone       whether the contract has been settled
 */
export const TUTORIAL = [
  {
    id: 'yard',
    // The region's own name goes in here, so even the first line is about the place that
    // was actually generated.
    say: region => `This is the yard: two tents and a scrape of dirt in ${region}, because nobody else wanted it.`,
    hint: 'W A S D to walk',
    minSeconds: 3.5,
    done: s => s.walked > 3,
  },
  {
    id: 'trade',
    say: () => 'You fly for money: no army, no flag, and no questions that are not about the fee.',
    hint: 'keep walking',
    minSeconds: 3.5,
    done: s => s.walked > 7,
  },
  {
    id: 'board',
    say: () => 'That machine is everything you own, so walk up to it and press Q to get in.',
    hint: 'Q at the door',
    minSeconds: 1,
    done: s => s.stance === 'landed' || s.stance === 'flying',
  },
  {
    id: 'lift',
    say: () => 'SPACE is the collective — hold it and take her up.',
    hint: 'hold SPACE',
    minSeconds: 1,
    done: s => s.stance === 'flying' && s.airborne > 8,
  },
  {
    id: 'fly',
    say: () => 'W A S D flies her and the mouse points her nose, which are two different things.',
    hint: 'fly away from the pad',
    minSeconds: 2.5,
    done: s => s.flown > 60,
  },
  {
    id: 'job',
    // The contract is put in hand on entry rather than left on the board: the first job is
    // assigned, so nothing about the board has to be explained yet.
    say: site => `There is already a crate aboard for ${site}, and it was yours before you asked.`,
    hint: 'a job is in hand',
    minSeconds: 3,
    done: (s, elapsed) => elapsed > 3,
  },
  {
    id: 'map',
    say: () => 'Press M for the region: the ring is your drop and the rectangle is what you can see.',
    hint: 'press M',
    minSeconds: 1,
    done: s => s.mapOpened,
  },
  {
    id: 'drop',
    say: () => 'Fly to the ring and hold E over it to set the crate down.',
    hint: 'hold E on site',
    minSeconds: 1,
    done: s => s.cargoDown,
  },
  {
    id: 'home',
    say: () => 'Now bring her back — your own pad is the only place that refuels and repairs you.',
    hint: 'return to the yard',
    minSeconds: 1,
    done: s => s.jobDone,
  },
  {
    id: 'done',
    say: () => 'That is the whole job: take another, spend the fee on the machine, and keep going.',
    hint: 'you are on your own',
    minSeconds: 4,
    done: (s, elapsed) => elapsed > 4,
  },
];

/** How long the script should take if the player does as they are told, in seconds. */
export const TUTORIAL_BUDGET = TUTORIAL.reduce((total, step) => total + step.minSeconds, 0);

export function createTutorial() {
  return { at: 0, elapsed: 0, total: 0, running: true, finished: false, entered: false };
}

/**
 * Advances the script. Returns the events the harness should act on: `enter` when a step
 * begins (which is when its sentence should be shown and any setup done) and `finish` when
 * the last one is cleared.
 */
export function stepTutorial(state, snapshot, dt) {
  const events = [];
  if (!state.running || state.finished) return events;
  state.total += dt;

  if (!state.entered) {
    state.entered = true;
    state.elapsed = 0;
    events.push({ type: 'enter', id: TUTORIAL[state.at].id, step: TUTORIAL[state.at], index: state.at });
    return events;
  }

  state.elapsed += dt;
  const step = TUTORIAL[state.at];
  // A sentence stays up for its own minimum however fast the player is, so the script cannot
  // flicker past in the first two seconds.
  if (state.elapsed < step.minSeconds) return events;
  if (!step.done(snapshot, state.elapsed)) return events;

  state.at += 1;
  if (state.at >= TUTORIAL.length) {
    state.finished = true;
    state.running = false;
    events.push({ type: 'finish' });
    return events;
  }
  state.elapsed = 0;
  events.push({ type: 'enter', id: TUTORIAL[state.at].id, step: TUTORIAL[state.at], index: state.at });
  return events;
}

/** Abandons the script, for a player who would rather work it out themselves. */
export function skipTutorial(state) {
  if (!state.running) return false;
  state.running = false;
  state.finished = true;
  return true;
}

export const tutorialStep = state =>
  (state.running && !state.finished ? TUTORIAL[state.at] : null);
