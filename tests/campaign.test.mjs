// Campaign integrity: every level's geometry has to be placeable and every objective kind
// has to be completable and failable. Authoring five maps by hand needs a machine check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startGame, update, objective, contextAction, LEVELS } from '../src/core.js';
import { inPolygon } from '../src/world.js';

const tick = (g, input = {}, seconds = 1) => { for (let i = 0; i < seconds * 60; i++) update(g, input, 1 / 60); };
const onLand = (level, p) => level.islands.some(poly => inPolygon(p.x, p.z, poly));
// The raised ground is inset from the island outline, so the outer ring is beach and
// shallows. A hull may sit there; a gun may not.
const inset = (poly, k) => {
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length, cz = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  return poly.map(([x, z]) => [cx + (x - cx) * k, cz + (z - cz) * k]);
};
const aground = (level, p) => level.islands.some(poly => inPolygon(p.x, p.z, inset(poly, .88)));
const LAND_UNITS = ['turret', 'tank', 'sam', 'radar', 'command', 'generator', 'silo', 'fueltank', 'officer', 'crate', 'truck'];

const kill = (g, filter) => { for (const e of g.enemies) if (filter(e)) { e.dead = true; e.hp = 0; } };
const hover = (g, at) => { Object.assign(g.p, { x: at.x, z: at.z, vx: 0, vz: 0 }); };

test('every level places its pads, zones and units on the right surface', () => {
  for (const level of LEVELS) {
    const where = label => `${level.id}: ${label}`;
    // Carrier decks float; airstrips do not.
    assert.equal(onLand(level, level.base), !level.base.carrier, where('base surface'));
    for (const depot of level.depots) assert.ok(onLand(level, depot), where(`depot ${depot.letter} on land`));
    for (const [name, zone] of Object.entries(level.zones ?? {})) assert.ok(onLand(level, zone), where(`zone ${name} on land`));
    for (const [id, type, x, z] of level.enemies) {
      assert.ok(Math.abs(x) <= level.limit && Math.abs(z) <= level.limit, where(`${id} inside the map`));
      if (type === 'boat') assert.ok(!aground(level, { x, z }), where(`${id} afloat`));
      else if (LAND_UNITS.includes(type)) assert.ok(onLand(level, { x, z }), where(`${id} on land`));
    }
    for (const [id, type, , , extra] of level.enemies) {
      for (const point of extra?.patrol ?? []) {
        if (type === 'boat') assert.ok(!aground(level, point), where(`${id} patrol leg afloat`));
        else assert.ok(onLand(level, point), where(`${id} patrol leg on land`));
      }
      for (const point of extra?.escape ?? []) assert.ok(onLand(level, point) || type === 'boat', where(`${id} escape leg on land`));
    }
    for (const [id, type, x, z, extra] of level.friendlies ?? []) {
      assert.ok(onLand(level, { x, z }) || type === 'boat', where(`friendly ${id} start`));
      for (const point of extra?.path ?? []) assert.ok(onLand(level, point) || type === 'boat', where(`friendly ${id} leg`));
    }
  }
});

test('landing pads are never parked on top of a gun', () => {
  for (const level of LEVELS) {
    for (const pad of [level.base, ...level.depots]) {
      for (const [id, type, x, z] of level.enemies) {
        if (!LAND_UNITS.includes(type) || type === 'officer') continue;
        assert.ok(Math.hypot(pad.x - x, pad.z - z) > pad.radius + 2,
          `${level.id}: ${id} sits on the pad at ${pad.letter}`);
      }
    }
  }
});

test('every objective resolves against its own level', () => {
  for (const level of LEVELS) {
    const ids = new Set(level.enemies.map(e => e[0]));
    const tags = new Set(level.enemies.flatMap(e => Object.keys(e[4] ?? {})));
    const friendlies = new Set((level.friendlies ?? []).map(f => f[0]));
    const pads = new Set([level.base.letter, ...level.depots.map(d => d.letter)]);
    assert.ok(level.objectives.length >= 4, `${level.id}: enough objectives`);
    assert.equal(level.objectives.at(-1).kind, 'extract', `${level.id}: ends by coming home`);
    for (const o of level.objectives) {
      assert.ok(o.label && o.detail && (o.short || o.kind === 'extract'), `${level.id}: ${o.kind} is described`);
      for (const target of o.targets ?? []) assert.ok(ids.has(target), `${level.id}: target ${target}`);
      if (o.tag) assert.ok(tags.has(o.tag), `${level.id}: tag ${o.tag}`);
      if (o.zone) assert.ok(level.zones[o.zone], `${level.id}: zone ${o.zone}`);
      if (o.guardTag) assert.ok(tags.has(o.guardTag), `${level.id}: guard tag ${o.guardTag}`);
      if (o.unit) assert.ok(friendlies.has(o.unit), `${level.id}: friendly ${o.unit}`);
      if (o.kind === 'capture') assert.ok(ids.has(o.target), `${level.id}: capture ${o.target}`);
      if (o.kind === 'intercept') {
        const unit = level.enemies.find(e => e[0] === o.target);
        assert.ok(unit, `${level.id}: intercept ${o.target}`);
        assert.ok(unit[4]?.escape?.length, `${level.id}: ${o.target} needs an escape route`);
      }
      if (o.kind === 'deliver') assert.ok(pads.has(o.to), `${level.id}: deliver pad ${o.to}`);
      if (o.kind === 'rescue') assert.ok(o.count >= 1 && o.noun, `${level.id}: rescue is countable`);
      if (o.kind === 'recon') assert.ok(o.seconds > 0, `${level.id}: recon needs a duration`);
    }
  }
});

test('the shielded objective in every level names a live shield', () => {
  for (const level of LEVELS) {
    for (const [id, , , , extra] of level.enemies) {
      if (!extra?.shieldedBy) continue;
      const guards = level.enemies.filter(e => e[4]?.[extra.shieldedBy]);
      assert.ok(guards.length >= 2, `${level.id}: ${id} shield tag ${extra.shieldedBy} has guards`);
    }
  }
});

test('a tag objective completes when the last tagged unit dies', () => {
  const g = createGame('recon', 1); startGame(g);          // Kettle Sound opens on the gunboats
  assert.equal(objective(g).kind, 'destroyTag');
  kill(g, e => e.patrolTag && e.id !== 'sound-patrol-d');
  tick(g, {}, .2); assert.equal(g.stage, 0, 'one boat left keeps the objective open');
  assert.match(objective(g).short, /3\/4/);
  kill(g, e => e.patrolTag);
  tick(g, {}, .2); assert.equal(g.stage, 1); assert.equal(objective(g).kind, 'rescue');
});

test('capture winches a prisoner aboard instead of killing him', () => {
  const g = createGame('recon', 1); startGame(g);
  kill(g, e => e.patrolTag); tick(g, {}, .2);
  kill(g, e => e.crashguard);
  const crash = g.level.zones.crash;
  hover(g, crash); tick(g, { interact: true }, 5.2);
  assert.equal(g.rescued, 3); assert.equal(g.stage, 2);
  const master = g.enemies.find(e => e.id === 'harbour-master');
  hover(g, master); tick(g, { interact: true }, 2.4);
  assert.ok(master.captured, 'aboard'); assert.equal(g.p.cargo, 4); assert.equal(g.stage, 3);
  assert.equal(objective(g).kind, 'deliver');
});

test('losing a prisoner fails the operation rather than passing it', () => {
  const g = createGame('recon', 1); startGame(g);
  kill(g, e => e.patrolTag); kill(g, e => e.crashguard); tick(g, {}, .2);
  hover(g, g.level.zones.crash); tick(g, { interact: true }, 5.2);
  const master = g.enemies.find(e => e.id === 'harbour-master');
  master.dead = true; master.hp = 0;
  tick(g, {}, .2);
  assert.equal(g.phase, 'failed'); assert.equal(g.endTitle, 'PRISONER LOST');
});

test('delivering cargo at the named pad hands it over and patches armour', () => {
  const g = createGame('recon', 1); startGame(g);
  kill(g, e => e.patrolTag); kill(g, e => e.crashguard); tick(g, {}, .2);
  hover(g, g.level.zones.crash); tick(g, { interact: true }, 5.2);
  const master = g.enemies.find(e => e.id === 'harbour-master');
  hover(g, master); tick(g, { interact: true }, 2.4);
  const pad = g.depots.find(d => d.letter === 'F');
  g.p.armor = 40;
  hover(g, pad); tick(g, { interact: true }, 3.2);
  assert.equal(g.delivered, 4); assert.equal(g.p.cargo, 0);
  assert.ok(g.p.armor > 40, 'handing people over patches the airframe');
  assert.equal(g.stage, 4);
});

test('a scan needs a steady hover and resets if you leave', () => {
  const g = createGame('recon', 2); startGame(g);          // Ashfall Basin
  kill(g, e => e.fueltank); kill(g, e => e.aa); tick(g, {}, .2);
  assert.equal(objective(g).kind, 'recon');
  const launch = g.level.zones.launch;
  hover(g, launch); tick(g, { interact: true }, 4);
  assert.ok(g.recon > 3 && g.stage === 2, 'scan in progress');
  g.p.x += 60; tick(g, { interact: true }, .2);
  assert.equal(g.recon, 0, 'leaving the zone loses the scan');
  hover(g, launch); tick(g, { interact: true }, 8.4);
  assert.equal(g.stage, 3); assert.equal(objective(g).kind, 'rescue');
});

test('a timed objective fails when the clock runs out', () => {
  const g = createGame('recon', 2); startGame(g);
  kill(g, e => e.fueltank); tick(g, {}, .2);
  assert.equal(objective(g).kind, 'destroyTag');
  assert.ok(objective(g).timed);
  tick(g, {}, .5); assert.ok(g.objectiveTimer > 0 && g.objectiveTimer < 280);
  g.objectiveTimer = .01; tick(g, {}, .2);
  assert.equal(g.phase, 'failed'); assert.equal(g.endTitle, 'CORRIDOR STAYED SHUT');
});

test('an escort completes when the column arrives and fails when it burns', () => {
  const arrive = createGame('recon', 3); startGame(arrive);  // Glass Highway
  assert.equal(objective(arrive).kind, 'escort');
  const convoy = arrive.friendlies.find(f => f.id === 'relief');
  assert.ok(convoy, 'the column exists');
  tick(arrive, {}, 1); assert.ok(convoy.moving, 'it rolls once the objective is live');
  kill(arrive, e => e.road);   // a pilot clears the road ahead of the column
  const start = { x: convoy.x, z: convoy.z };
  tick(arrive, {}, 4); assert.notDeepEqual({ x: convoy.x, z: convoy.z }, start, 'it makes progress');
  for (let i = 0; i < 60 && !convoy.arrived; i++) tick(arrive, {}, 1);
  assert.ok(convoy.arrived, 'it reaches the depot');
  tick(arrive, {}, .2); assert.equal(arrive.stage, 1); assert.equal(objective(arrive).kind, 'intercept');

  const ignored = createGame('pilot', 3); startGame(ignored);
  const alone = ignored.friendlies.find(f => f.id === 'relief');
  for (let i = 0; i < 200 && ignored.phase === 'playing' && !alone.arrived; i++) tick(ignored, {}, 1);
  assert.ok(alone.dead, 'a column nobody covers does not make it');

  const lost = createGame('recon', 3); startGame(lost);
  const doomed = lost.friendlies.find(f => f.id === 'relief');
  doomed.dead = true; tick(lost, {}, .2);
  assert.equal(lost.phase, 'failed'); assert.equal(lost.endTitle, 'ESCORT LOST');
});

test('an interception fails if the target reaches open ground', () => {
  const g = createGame('recon', 3); startGame(g);
  const convoy = g.friendlies.find(f => f.id === 'relief');
  convoy.arrived = true; tick(g, {}, .2);
  assert.equal(objective(g).kind, 'intercept');
  const car = g.enemies.find(e => e.id === 'staff-car');
  tick(g, {}, 1); assert.ok(car.fleeing, 'it runs once spotted');
  for (let i = 0; i < 120 && !car.escaped && g.phase === 'playing'; i++) tick(g, {}, 1);
  assert.ok(car.escaped, 'it can reach the border');
  assert.equal(g.phase, 'failed'); assert.equal(g.endTitle, 'TARGET ESCAPED');
});

test('killing the fleeing target advances instead', () => {
  const g = createGame('recon', 3); startGame(g);
  g.friendlies.find(f => f.id === 'relief').arrived = true; tick(g, {}, .2);
  const car = g.enemies.find(e => e.id === 'staff-car');
  car.dead = true; car.hp = 0; tick(g, {}, .2);
  assert.equal(g.stage, 2); assert.equal(objective(g).kind, 'destroy');
});

test('the fortress silo cannot be touched until all three nodes fall', () => {
  const g = createGame('recon', 4); startGame(g);          // Iron Fortress
  assert.equal(objective(g).kind, 'destroyTag');
  kill(g, e => e.node && e.id !== 'node-three'); tick(g, {}, .2);
  assert.equal(g.stage, 0);
  kill(g, e => e.node); tick(g, {}, .2);
  assert.equal(g.stage, 1); assert.equal(objective(g).kind, 'destroy');
  assert.ok(objective(g).timed);
  const silo = g.enemies.find(e => e.id === 'iron-silo');
  assert.equal(objective(g).blocked, false, 'nodes are down, so the silo is exposed');
  silo.dead = true; tick(g, {}, .2);
  assert.equal(g.stage, 2); assert.equal(objective(g).kind, 'capture');
});

// Walks every operation's chain start to finish by the cheapest legal means for each kind.
// Fuel is topped up between steps: this proves the chain is completable, not the economy.
test('every operation can be flown to a win', () => {
  for (let index = 0; index < LEVELS.length; index++) {
    const g = createGame('recon', index); startGame(g);
    const level = LEVELS[index], name = level.id;
    for (let guard = 0; guard < level.objectives.length + 2 && g.phase === 'playing'; guard++) {
      const o = level.objectives[Math.min(g.stage, level.objectives.length - 1)];
      g.p.fuel = 100; g.p.armor = 100; g.p.invulnerable = 999;
      if (o.kind === 'destroy') {
        for (const target of o.targets) {
          const unit = g.enemies.find(e => e.id === target);
          if (unit.shieldedBy) kill(g, e => e[unit.shieldedBy]);
          unit.dead = true; unit.hp = 0;
        }
        tick(g, {}, .2);
      } else if (o.kind === 'destroyTag') {
        kill(g, e => e[o.tag]); tick(g, {}, .2);
      } else if (o.kind === 'rescue') {
        if (o.guardTag) kill(g, e => e[o.guardTag]);
        hover(g, level.zones[o.zone]);
        tick(g, { interact: true }, 1.7 * o.count + .4);
      } else if (o.kind === 'capture') {
        hover(g, g.enemies.find(e => e.id === o.target));
        tick(g, { interact: true }, 2.4);
      } else if (o.kind === 'deliver') {
        hover(g, o.to === level.base.letter ? g.base : g.depots.find(d => d.letter === o.to));
        tick(g, { interact: true }, 3.3);
      } else if (o.kind === 'recon') {
        hover(g, level.zones[o.zone]);
        tick(g, { interact: true }, o.seconds + .5);
      } else if (o.kind === 'escort') {
        const unit = g.friendlies.find(f => f.id === o.unit);
        // A pilot clears whatever covers the route before the column reaches it.
        kill(g, e => (unit.path ?? []).some(p => Math.hypot(e.x - p.x, e.z - p.z) < 45));
        for (let i = 0; i < 240 && !unit.arrived && g.phase === 'playing'; i++) { g.p.fuel = 100; tick(g, {}, 1); }
        assert.ok(unit.arrived, `${name}: the column reaches its destination`);
        tick(g, {}, .2);
      } else if (o.kind === 'intercept') {
        const unit = g.enemies.find(e => e.id === o.target);
        unit.dead = true; unit.hp = 0; tick(g, {}, .2);
      } else if (o.kind === 'extract') {
        hover(g, g.base); tick(g, { interact: true }, 3.3);
      }
    }
    assert.equal(g.phase, 'won', `${name}: operation completes`);
    assert.equal(g.p.cargo, 0, `${name}: nobody is left aboard`);
    assert.ok(g.score > 1000, `${name}: scores the operation`);
  }
});

test('each level can be flown from its own briefing', () => {
  for (let i = 0; i < LEVELS.length; i++) {
    const g = createGame('pilot', i);
    assert.equal(g.levelIndex, i);
    assert.equal(g.limit, LEVELS[i].limit);
    assert.deepEqual({ x: g.p.x, z: g.p.z }, { x: LEVELS[i].base.x, z: LEVELS[i].base.z });
    startGame(g);
    assert.equal(g.phase, 'playing');
    const first = objective(g);
    assert.equal(first.index, '01');
    assert.equal(first.total, LEVELS[i].objectives.length);
    assert.ok(Number.isFinite(first.x) && Number.isFinite(first.z), `${LEVELS[i].id}: marker resolves`);
    // The first objective must be reachable on one tank of fuel.
    assert.ok(Math.hypot(first.x - g.p.x, first.z - g.p.z) < g.limit * 2, `${LEVELS[i].id}: first leg is flyable`);
    hover(g, g.base); tick(g, { interact: true }, 4.2);
    assert.equal(contextAction(g).kind, 'service', `${LEVELS[i].id}: home pad services the aircraft`);
  }
});
