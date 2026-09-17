// The outfit: standing, contracts, money and progression. All of it has to hold together
// deterministically, because contracts are generated from the world rather than authored.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, FACTIONS } from '../src/worldgen.js';
import {
  createProfile, generateContracts, accept, resolve, purchase, hire, endDay,
  standingBand, standingDeltas, applyStanding, contractSlots, offersWork, situation,
  UPGRADES, HIREABLE, CONTRACT_KINDS, RIVALRY, STARTING_CREW, crewMultiplier, crewEffect,
} from '../src/agency.js';

const world = createWorld(20492);

test('you start with one helicopter, one colleague and not much else', () => {
  const p = createProfile();
  assert.equal(p.crew.length, 1);
  assert.equal(p.crew[0].id, 'quill');
  assert.match(p.crew[0].role, /RADIO/);
  assert.ok(p.cash > 0 && p.cash < 10000, 'bottom of the barrel');
  assert.equal(p.heli.hardpoint, 1, 'one pylon and a door gun');
  assert.equal(p.base.hangar, 0, 'no hangar yet');
  for (const f of FACTIONS) assert.equal(p.standing[f.key], 0, `${f.short} has no opinion yet`);
  assert.equal(p.active, null);
});

test('standing bands read from hostile to allied', () => {
  assert.equal(standingBand(-100).key, 'hostile');
  assert.equal(standingBand(-30).key, 'wary');
  assert.equal(standingBand(0).key, 'neutral');
  assert.equal(standingBand(25).key, 'working');
  assert.equal(standingBand(60).key, 'trusted');
  assert.equal(standingBand(95).key, 'allied');
  let previous = -1;
  for (const band of [-100, -45, -12, 18, 48, 78]) {
    const index = ['hostile', 'wary', 'neutral', 'working', 'trusted', 'allied'].indexOf(standingBand(band).key);
    assert.ok(index > previous, 'bands are ordered');
    previous = index;
  }
});

test('every faction has a rivalry entry for every other faction', () => {
  for (const a of FACTIONS) {
    assert.ok(RIVALRY[a.key], `${a.key} has feelings`);
    for (const b of FACTIONS) {
      if (a.key === b.key) continue;
      assert.equal(typeof RIVALRY[a.key][b.key], 'number', `${a.key} -> ${b.key}`);
    }
  }
});

test('the board is generated from the world and is stable for the day', () => {
  const p = createProfile();
  const board = generateContracts(world, p);
  assert.ok(board.length > 0, 'there is work');
  assert.equal(board.length, contractSlots(p), 'one per slot');
  const again = generateContracts(world, p);
  assert.deepEqual(again.map(c => c.id + c.kind + c.site.id), board.map(c => c.id + c.kind + c.site.id),
    'the same day offers the same work');
  const tomorrow = generateContracts(world, p, { day: p.day + 1 });
  assert.notDeepEqual(tomorrow.map(c => c.id), board.map(c => c.id), 'a new day brings new work');
  for (const c of board) {
    assert.ok(c.pay > 0 && Number.isFinite(c.pay), 'it pays');
    assert.ok(c.distance > 60, 'it is not in the yard');
    assert.ok(CONTRACT_KINDS.some(k => k.key === c.kind), 'a real kind of job');
    assert.ok(FACTIONS.some(f => f.key === c.issuer), 'a real client');
    assert.ok(c.site.name && c.site.id, 'a real place');
    assert.ok(c.title.includes(c.site.name), 'the title names the place');
    assert.ok(Object.keys(c.deltas).length >= 1, 'it moves standing');
  }
});

test('more radio and a fixer means more work on the board', () => {
  const bare = createProfile();
  const wired = createProfile();
  wired.base.radio = 3;
  assert.ok(contractSlots(wired) > contractSlots(bare), 'the mast brings in work');
  wired.cash = 99999;
  const before = contractSlots(wired);
  assert.equal(hire(wired, 'vey').ok, true, 'the fixer can be hired with a mast up');
  assert.ok(contractSlots(wired) > before, 'she brings her own leads');
  assert.ok(generateContracts(world, wired).length > generateContracts(world, bare).length);
});

test('nobody hires you to bomb their own people', () => {
  const p = createProfile();
  for (let day = 1; day < 40; day++) {
    for (const c of generateContracts(world, p, { day, count: 8 })) {
      if (!c.hostile) continue;
      assert.notEqual(c.targetFaction, c.issuer, `${c.id}: ${c.issuerName} would not strike itself`);
      const feeling = RIVALRY[c.issuer][c.targetFaction];
      assert.ok(feeling < 0, `${c.id}: the client dislikes the target`);
    }
  }
});

test('a faction you are close to stops being offered as a target', () => {
  const p = createProfile();
  p.standing.ashwind = 70;
  for (let day = 1; day < 40; day++) {
    for (const c of generateContracts(world, p, { day, count: 8 })) {
      if (c.hostile) assert.notEqual(c.targetFaction, 'ashwind', 'we do not hit our friends');
    }
  }
});

test('a faction that hates you offers nothing', () => {
  const p = createProfile();
  p.standing.cordon = -60;
  assert.equal(offersWork(p, 'cordon'), false);
  for (let day = 1; day < 30; day++) {
    for (const c of generateContracts(world, p, { day, count: 8 })) {
      assert.notEqual(c.issuer, 'cordon', 'they are not calling');
    }
  }
});

test('finishing hostile work pays, pleases the client and costs you elsewhere', () => {
  const p = createProfile();
  let strike = null;
  for (let day = 1; day < 20 && !strike; day++) strike = generateContracts(world, p, { day, count: 8 }).find(c => c.hostile);
  assert.ok(strike, 'the region offers violent work somewhere in the first three weeks');
  const before = { ...p.standing }, cash = p.cash;
  assert.equal(accept(p, strike).ok, true);
  assert.equal(accept(p, strike).ok, false, 'one job at a time');
  const result = resolve(p, { success: true });
  assert.ok(result.paid > 0 && p.cash === cash + result.paid, 'we got paid');
  assert.ok(p.standing[strike.issuer] > before[strike.issuer], 'the client is pleased');
  assert.ok(p.standing[strike.targetFaction] < before[strike.targetFaction], 'the target is not');
  assert.ok(p.completed.includes(strike.id));
  assert.equal(p.active, null);
  assert.equal(p.ledger.at(-1).amount, result.paid);
});

test('you cannot stay neutral once you take sides', () => {
  const p = createProfile();
  let taken = 0;
  for (let day = 1; day < 30 && taken < 6; day++) {
    for (const c of generateContracts(world, p, { day, count: 8 })) {
      if (!c.hostile || p.active) continue;
      if (!accept(p, c).ok) continue;
      resolve(p, { success: true });
      taken++;
      break;
    }
  }
  assert.ok(taken >= 3, `took ${taken} hostile jobs`);
  const spread = Object.values(p.standing);
  assert.ok(Math.max(...spread) > 10, 'someone likes us');
  assert.ok(Math.min(...spread) < -10, 'someone does not');
});

test('failing a job costs money and the client, but not the target', () => {
  const p = createProfile();
  let contract = null;
  for (let day = 1; day < 20 && !contract; day++) contract = generateContracts(world, p, { day, count: 8 }).find(c => c.hostile);
  assert.ok(contract, 'found violent work');
  accept(p, contract);
  const before = { ...p.standing }, cash = p.cash;
  const result = resolve(p, { success: false, casualties: 1 });
  assert.ok(result.paid < 0, 'it cost us');
  assert.ok(p.cash < cash);
  assert.ok(p.standing[contract.issuer] < before[contract.issuer], 'the client is unimpressed');
  assert.equal(p.standing[contract.targetFaction], before[contract.targetFaction], 'the target never knew');
  assert.ok(p.failed.includes(contract.id));
});

test('a bare outfit is paid exactly the contract rate, and crew change it multiplicatively', () => {
  const bare = createProfile();
  assert.equal(crewMultiplier(bare, 'payMultiplier'), 1, 'no crew, no premium');
  assert.equal(crewMultiplier(bare, 'rescueValue'), 1, 'no medic, no premium');
  assert.equal(crewEffect(bare, 'contractSlots'), 0, 'no extra leads');
  const contract = generateContracts(world, bare)[0];
  const cash = bare.cash;
  accept(bare, contract);
  const result = resolve(bare, { success: true });
  assert.equal(result.paid, contract.pay, 'paid the advertised rate, not a multiple of it');
  assert.equal(bare.cash, cash + contract.pay);

  const staffed = createProfile();
  staffed.cash = 99999; staffed.base.radio = 1;
  hire(staffed, 'vey');
  assert.ok(crewMultiplier(staffed, 'payMultiplier') > 1, 'the fixer takes a better cut');
  assert.equal(crewEffect(staffed, 'contractSlots'), 2, 'and brings leads');
});

test('standing is clamped and deltas are reported honestly', () => {
  const p = createProfile();
  applyStanding(p, { cordon: 500 });
  assert.equal(p.standing.cordon, 100, 'clamped high');
  const applied = applyStanding(p, { cordon: 50 });
  assert.equal(applied.cordon, 0, 'already at the ceiling');
  applyStanding(p, { cordon: -1000 });
  assert.equal(p.standing.cordon, -100, 'clamped low');
  const deltas = standingDeltas('cordon', 'ashwind', CONTRACT_KINDS.find(k => k.key === 'strike'));
  assert.ok(deltas.cordon > 0 && deltas.ashwind < 0);
  assert.ok(Object.keys(deltas).length > 2, 'the rest of the region has an opinion too');
});

test('upgrades cost money, respect their ceiling and stick', () => {
  const p = createProfile();
  p.cash = 260000;   // the full fit-out is about 146k
  for (const spec of UPGRADES) {
    const store = spec.kind === 'base' ? p.base : p.heli;
    let guard = 0;
    while ((store[spec.id] ?? 0) < spec.max && guard++ < 10) {
      const before = p.cash;
      const result = purchase(p, spec.id);
      assert.equal(result.ok, true, `${spec.id}: ${result.reason ?? ''}`);
      assert.ok(p.cash < before, `${spec.id} costs money`);
    }
    assert.equal(store[spec.id], spec.max, `${spec.id} reaches its ceiling`);
    assert.equal(purchase(p, spec.id).ok, false, `${spec.id} cannot exceed it`);
    assert.equal(typeof spec.describe(spec.max - 1), 'string', `${spec.id} describes its levels`);
  }
  const broke = createProfile();
  broke.cash = 10;
  assert.equal(purchase(broke, 'hangar').ok, false, 'no money, no hangar');
});

test('crew need the facilities before they will take the job', () => {
  const p = createProfile();
  p.cash = 100000;
  const gunner = HIREABLE.find(c => c.id === 'brandt');
  assert.equal(hire(p, 'brandt').ok, false, 'no hangar, no gunner');
  p.base.hangar = gunner.requires.hangar;
  assert.equal(hire(p, 'brandt').ok, true);
  assert.equal(hire(p, 'brandt').ok, false, 'not twice');
  assert.ok(p.crew.some(c => c.id === 'brandt' && c.hired));
});

test('the day turns over and wages come out of the tin', () => {
  const p = createProfile();
  p.cash = 50000; p.base.workshop = 1;
  hire(p, 'okonkwo');
  const cash = p.cash, day = p.day;
  const result = endDay(p);
  assert.equal(p.day, day + 1);
  assert.ok(result.wages > 0, 'the mechanic gets paid');
  assert.equal(p.cash, cash - result.wages);
  assert.equal(p.ledger.at(-1).kind, 'WAGES');
});

test('Quill always has something to say and never something empty', () => {
  const broke = createProfile(); broke.cash = 100;
  const hated = createProfile(); hated.standing.cordon = -70;
  const loved = createProfile(); loved.standing.freehold = 80;
  const busy = createProfile(); busy.completed = ['a', 'b', 'c'];
  for (const p of [createProfile(), broke, hated, loved, busy]) {
    const line = situation(p);
    assert.equal(typeof line, 'string');
    assert.ok(line.length > 20, 'she uses whole sentences');
    assert.ok(!line.includes('undefined') && !line.includes('NaN'), line);
  }
});

test('the whole loop runs for thirty days without going wrong', () => {
  const p = createProfile();
  p.cash = 20000;
  for (let day = 0; day < 30; day++) {
    const board = generateContracts(world, p);
    assert.ok(board.length >= 1, `day ${p.day} has work`);
    const pick = board[Math.floor(board.length / 2)];
    if (accept(p, pick).ok) resolve(p, { success: day % 4 !== 0 });
    endDay(p);
    assert.ok(Number.isFinite(p.cash) && p.cash >= 0, 'cash stays real');
    for (const f of FACTIONS) {
      const value = p.standing[f.key];
      assert.ok(Number.isFinite(value) && value >= -100 && value <= 100, `${f.key} standing ${value}`);
    }
    assert.equal(p.active, null, 'no job left dangling');
  }
  assert.ok(p.completed.length > 15, `${p.completed.length} jobs completed`);
  assert.ok(p.ledger.length >= 25, 'the books are kept');
});
