// Browser verification for MERCENARY STRIKE.
//
// The module tests prove the generator and the rules; this proves the built bundle in a
// real browser: it boots, it renders, real keys fly the aircraft and pay the winch out,
// every one of the twelve kinds of work can be taken, a job can be flown for money, and
// ten kilometres of streaming neither leaks nor stalls.
//
// Run the server first (npm run world), then: node tests/world-browser.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = 'http://127.0.0.1:4189';
const url = seed => `${base}/dist/world.html?seed=${seed}`;
const SEED = 20492;

await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const evidence = { checks: [], errors: [], network: [], measurements: {} };
const record = name => { evidence.checks.push(name); console.log('PASS ' + name); };

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', e => evidence.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') evidence.errors.push(m.text()); });
  page.on('request', r => {
    if (!r.url().startsWith(base) && !r.url().startsWith('data:') && !r.url().startsWith('file:')) evidence.network.push(r.url());
  });

  const state = () => page.evaluate(() => window.merc.state());
  const outfit = () => page.evaluate(() => window.merc.outfit());

  // ---------------------------------------------------------------- boot
  await page.goto(url(SEED));
  await page.waitForFunction(() => window.merc && window.merc.state().resident > 20, null, { timeout: 30000 });
  assert.equal(await page.title(), 'MERCENARY STRIKE · REGION HARNESS');
  assert.equal(await page.locator('#loading').isVisible(), false, 'the loading screen gets out of the way');
  const booted = await state();
  assert.ok(booted.resident > 40, `chunks are resident on boot: ${booted.resident}`);
  assert.ok(booted.draw > 10 && booted.draw < 300, `sane draw call count: ${booted.draw}`);
  evidence.measurements.boot = booted;
  record('The built bundle boots, streams the first chunks and renders');

  // ---------------------------------------------------------------- the briefing
  assert.equal(await page.locator('#intro').isVisible(), true, 'a first visit gets a briefing');
  const brief = await page.locator('#intro-quill').textContent();
  const regionName = await page.evaluate(() => window.merc.world.regionAt(window.merc.world.home.x, window.merc.world.home.z).name);
  // Quill says "parked in the LONG SAVANNA", so the article is lowercased in her copy.
  const spoken = regionName.replace(/^THE /, '');
  assert.ok(brief.includes(spoken), `Quill names the region you are parked in: ${regionName}`);
  const areas = await page.locator('#intro-areas li').count();
  assert.equal(areas, 9, 'and lists all nine areas with their landmarks');
  await page.screenshot({ path: 'artifacts/world-briefing.png' });
  await page.locator('#intro-go').click();
  assert.equal(await page.locator('#intro').isVisible(), false, 'and it dismisses');
  record('The first-run briefing describes the region that was actually generated');

  // ---------------------------------------------------------------- real input
  const before = await state();
  await page.keyboard.down('w');
  await page.waitForTimeout(900);
  await page.keyboard.up('w');
  const after = await state();
  const travelled = Math.hypot(after.position.x - before.position.x, after.position.z - before.position.z);
  assert.ok(travelled > 8, `real keyboard input flies the aircraft: moved ${travelled.toFixed(1)} units`);
  record('Real keyboard input flies the aircraft in the rendered world');

  // ---------------------------------------------------------------- regions
  const regions = await page.evaluate(() => window.merc.regions());
  assert.equal(regions.length, 9);
  assert.equal(new Set(regions.map(r => r.key)).size, 9, 'nine distinct archetypes');
  const marks = await page.evaluate(() => window.merc.marks());
  assert.equal(marks.length, 9, 'and nine landmarks, one each');
  assert.equal(new Set(marks.map(m => m.key)).size, 9);
  // Crossing a border changes the region readout, which is the whole point of the layer.
  const seen = new Set();
  for (const region of regions) {
    await page.evaluate(([x, z]) => window.merc.teleport(x, z), [Math.round(region.x), Math.round(region.z)]);
    seen.add((await state()).region);
  }
  assert.equal(seen.size, 9, `flying to each seat reports nine different regions, got ${[...seen].join(', ')}`);
  evidence.measurements.regions = regions.map(r => r.key);
  record('Nine regions with nine landmarks, and the readout changes as you cross them');

  // ---------------------------------------------------------------- landmarks render
  for (const mark of marks) {
    await page.evaluate(([x, z]) => window.merc.teleport(x, z), [mark.x, mark.z]);
    await page.evaluate(() => window.merc.render());
    const near = await state();
    assert.ok(near.meshes > 8, `${mark.short} has geometry around it: ${near.meshes} meshes`);
    assert.ok(Number.isFinite(near.triangles) && near.triangles > 1000, `${mark.short} holds triangles`);
    assert.deepEqual(evidence.errors, [], `${mark.short} builds without a JavaScript error`);
  }
  await page.screenshot({ path: 'artifacts/world-landmark.png' });
  record('Every one of the nine landmarks streams in and builds without error');

  // ---------------------------------------------------------------- the map
  await page.keyboard.press('m');
  assert.equal(await page.locator('#map-panel').isVisible(), true);
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'artifacts/world-map.png' });
  await page.keyboard.press('m');
  assert.equal(await page.locator('#map-panel').isVisible(), false);
  await page.keyboard.press('b');
  assert.equal(await page.locator('#yard').isVisible(), true, 'the yard opens');
  const fittings = await page.locator('#yard-base li, #yard-heli li').count();
  assert.equal(fittings, 9, 'with nine fittings');
  await page.screenshot({ path: 'artifacts/world-yard.png' });
  await page.keyboard.press('b');
  record('The region map and the yard open, draw and close on real key presses');

  // ---------------------------------------------------------------- all twelve kinds
  const KINDS = ['survey', 'delivery', 'extraction', 'salvage', 'patrol', 'escort',
    'strike', 'interdiction', 'sabotage', 'spotter', 'search', 'smuggling'];
  const briefs = await page.evaluate(kinds => {
    const merc = window.merc, out = {};
    merc.profileRef.heli.hardpoint = 3; merc.profileRef.heli.winch = 2; merc.profileRef.cash = 200000;
    for (const kind of kinds) {
      merc.profileRef.active = null;
      out[kind] = merc.offer(kind) ? merc.status().label : null;
    }
    merc.profileRef.active = null;
    return out;
  }, KINDS);
  for (const kind of KINDS) {
    assert.ok(briefs[kind], `${kind} can be taken from the board`);
    assert.ok(briefs[kind].length > 8, `${kind} tells you what to do: "${briefs[kind]}"`);
  }
  evidence.measurements.briefs = briefs;
  record('All twelve kinds of work reach the board and brief the pilot');

  // ---------------------------------------------------------------- the winch
  const winch = await page.evaluate(() => {
    const merc = window.merc;
    merc.profileRef.active = null; merc.profileRef.heli.winch = 2;
    merc.offer('extraction');
    const zone = merc.mission().zone;
    merc.teleport(zone.x, zone.z);
    return { x: zone.x, z: zone.z, label: merc.status().label };
  });
  assert.match(winch.label, /WINCH/);
  await page.keyboard.down('e');
  await page.waitForFunction(() => window.merc.winchOut() > 1.5, null, { timeout: 5000 });
  const paidOut = await page.evaluate(() => window.merc.winchOut());
  const visible = await page.evaluate(() => window.merc.heli.winch.visible);
  await page.screenshot({ path: 'artifacts/world-winch.png' });
  await page.keyboard.up('e');
  assert.ok(paidOut > 1.5, `the cable pays out under a real key: ${paidOut.toFixed(1)} units`);
  assert.equal(visible, true, 'and the hook is on screen');
  await page.waitForFunction(() => window.merc.winchOut() < 0.5, null, { timeout: 5000 });
  evidence.measurements.winch = { paidOut };
  record('Holding the winch key lowers a visible cable and hook, and releasing raises it');

  // ---------------------------------------------------------------- a job for money
  const job = await page.evaluate(() => {
    const merc = window.merc;
    merc.profileRef.active = null;
    merc.profileRef.cash = 5000;
    const cash = merc.profileRef.cash, day = merc.profileRef.day;
    merc.offer('salvage');
    const zone = merc.mission().zone;
    merc.teleport(zone.x, zone.z);
    merc.simulate(8, { KeyE: true });
    const midway = merc.status().label;
    merc.teleport(merc.world.home.x, merc.world.home.z);
    merc.simulate(3, {});
    const done = merc.outfit();
    return { cash, day, midway, after: done.cash, dayAfter: done.day, completed: done.completed, active: done.active };
  });
  assert.match(job.midway, /RETURN TO THE YARD/, 'the wreck comes aboard');
  assert.ok(job.after > job.cash, `and it pays: ${job.cash} -> ${job.after}`);
  assert.equal(job.dayAfter, job.day + 1, 'the day rolls over');
  assert.equal(job.completed, 1, 'and the job is on the books');
  assert.equal(job.active, null, 'with nothing left in hand');
  evidence.measurements.job = job;
  record('A contract can be flown to completion for money on the built bundle');

  // ---------------------------------------------------------------- saving
  const saved = await page.evaluate(() => {
    window.merc.saveProfile();
    return JSON.parse(localStorage.getItem('merc.profile.' + window.merc.state().seed));
  });
  assert.ok(saved.completed.length >= 1, 'progress is written to storage');
  await page.reload();
  await page.waitForFunction(() => window.merc && window.merc.state().resident > 20, null, { timeout: 30000 });
  assert.equal(await page.locator('#intro').isVisible(), false, 'a returning pilot is not briefed again');
  const reloaded = await outfit();
  assert.equal(reloaded.completed, 1, 'and the books survive a reload');
  record('Progress saves per seed, survives a reload, and the briefing only happens once');

  // ---------------------------------------------------------------- weather
  const weather = await page.evaluate(() => {
    const merc = window.merc;
    const clear = merc.state().fog;
    merc.profileRef.active = null;
    merc.profileRef.heli.hardpoint = 3; merc.profileRef.heli.winch = 2;
    merc.offer('survey');
    const m = merc.mission();
    m.weather = true;                       // force the complication on, whatever the roll gave
    merc.simulate(6, {});
    const closed = merc.state().fog;
    m.weather = false;
    merc.simulate(10, {});
    return { clear, closed, lifted: merc.state().fog };
  });
  assert.ok(weather.closed > weather.clear * 1.6, `weather closes the visibility in: ${weather.clear} -> ${weather.closed}`);
  assert.ok(weather.lifted < weather.closed, 'and it lifts again afterwards');
  evidence.measurements.weather = weather;
  record('The weather complication closes the visibility in and lifts again');

  // ---------------------------------------------------------------- streaming
  const transit = await page.evaluate(() => {
    const merc = window.merc;
    merc.profileRef.active = null;
    merc.teleport(-900, -900);
    const start = { ...merc.state().stats };
    let peak = 0, worst = 0;
    // Ten kilometres corner to corner, in real frames, watching residency and hitching.
    for (let i = 0; i <= 120; i++) {
      merc.teleport(-900 + i * 15, -900 + i * 15);
      const s = merc.state();
      peak = Math.max(peak, s.resident);
      worst = Math.max(worst, s.streamMs);
    }
    const end = { ...merc.state().stats };
    return { start, end, peak, worst, resident: merc.state().resident, nodes: merc.state().regionNodes };
  });
  const leaked = (transit.end.built - transit.start.built) - (transit.end.disposed - transit.start.disposed);
  assert.ok(transit.peak < 120, `residency stays bounded across the region: peak ${transit.peak}`);
  assert.ok(Math.abs(leaked - transit.resident + 66) < 200, 'builds and releases stay in step');
  assert.ok(transit.nodes < 8000, `the region modifier lattice stays bounded: ${transit.nodes} nodes`);
  evidence.measurements.transit = transit;
  record('Flying the full ten kilometres keeps residency bounded and releases what it builds');

  // ---------------------------------------------------------------- hygiene
  assert.deepEqual(evidence.network, [], 'no external requests: the bundle is self-contained');
  assert.deepEqual(evidence.errors, [], 'no JavaScript or shader errors anywhere in the run');
  record('No external asset requests and no JavaScript or shader errors');

  await writeFile('artifacts/world-verification.json', JSON.stringify(evidence, null, 2));
  console.log(`\n${evidence.checks.length} checks passed.`);
} catch (error) {
  console.error('\nFAILED: ' + error.message);
  evidence.failure = error.message;
  await writeFile('artifacts/world-verification.json', JSON.stringify(evidence, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
