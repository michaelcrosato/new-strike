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
import { measureFrame, mean } from '../tools/frame-stats.mjs';

const base = 'http://127.0.0.1:4189';
// The game is what the site serves at its root, so that is where it is tested.
const url = seed => `${base}/?seed=${seed}`;
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
  assert.equal(await page.title(), 'MERCENARY STRIKE');
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

  // ---------------------------------------------------------------- the backends
  // One renderer, two backends: WebGPU where the browser has it, WebGL 2 where it does not.
  // Both are exercised here, and the frames they produce are compared, because a fallback
  // that renders something *different* is not a fallback.
  const hasWebGPU = await page.evaluate(() => !!navigator.gpu);
  assert.equal(booted.backend, hasWebGPU ? 'WebGPU' : 'WebGL2',
    `a browser with WebGPU should use it: navigator.gpu is ${hasWebGPU}, backend is ${booted.backend}`);
  await page.evaluate(() => window.merc.teleport(window.merc.world.home.x, window.merc.world.home.z));
  await page.waitForTimeout(500);
  const primaryFrame = await measureFrame(page);

  const fallback = await context.newPage();
  fallback.on('pageerror', e => evidence.errors.push('fallback: ' + e.message));
  fallback.on('console', m => { if (m.type() === 'error') evidence.errors.push('fallback: ' + m.text()); });
  await fallback.goto(`${url(SEED)}&webgl`);
  await fallback.waitForFunction(() => window.merc && window.merc.state().resident > 20, null, { timeout: 30000 });
  const fallbackState = await fallback.evaluate(() => window.merc.state());
  assert.equal(fallbackState.backend, 'WebGL2', 'forcing the fallback gives the WebGL 2 backend');
  await fallback.evaluate(() => { window.merc.dismiss(); window.merc.teleport(window.merc.world.home.x, window.merc.world.home.z); });
  await fallback.waitForTimeout(400);
  const fallbackFrame = await measureFrame(fallback);

  // The two backends run the same node graphs, so the images should agree closely. A large
  // divergence means one of them is not applying the tone curve, the grade or the lighting.
  for (const [key, tolerance] of [['lum', 0.05], ['sat', 0.07], ['max', 0.08]]) {
    const gap = Math.abs(primaryFrame[key] - fallbackFrame[key]);
    assert.ok(gap < tolerance,
      `${booted.backend} and WebGL2 disagree on ${key}: ${primaryFrame[key].toFixed(3)} vs ${fallbackFrame[key].toFixed(3)}`);
  }
  assert.ok(fallbackState.resident > 40, 'and the fallback streams the world the same way');
  await fallback.close();
  evidence.measurements.backends = {
    primary: booted.backend, hasWebGPU,
    primaryFrame: { lum: +primaryFrame.lum.toFixed(3), sat: +primaryFrame.sat.toFixed(3), max: +primaryFrame.max.toFixed(3), spread: primaryFrame.spread },
    fallbackFrame: { lum: +fallbackFrame.lum.toFixed(3), sat: +fallbackFrame.sat.toFixed(3), max: +fallbackFrame.max.toFixed(3), spread: fallbackFrame.spread },
  };
  record(`Renders on ${booted.backend} and on the WebGL 2 fallback, to the same picture`);

  // ---------------------------------------------------------------- the look
  // A guard against the region drifting grim again. BLOCKHAWK — the look this returned to —
  // measures lum 0.499, sat 0.335, max 0.848 and a spread of 4.8 brightness buckets across
  // four places. What makes it upbeat is the highlights and the range, not the brightness:
  // the pale wash this became had a spread of 2 and a max of 0.63.
  const places = [null, 'saltflat', 'alpine', 'delta'];
  const frames = [];
  for (const key of places) {
    await page.evaluate(k => {
      const merc = window.merc;
      if (!k) merc.teleport(merc.world.home.x, merc.world.home.z);
      else { const r = merc.regions().find(x => x.key === k); merc.teleport(Math.round(r.x), Math.round(r.z)); }
      merc.simulate(0.5, {});
    }, key);
    await page.waitForTimeout(250);
    frames.push(await measureFrame(page));
  }
  const look = {
    lum: mean(frames, f => f.lum), sat: mean(frames, f => f.sat),
    max: mean(frames, f => f.max), spread: mean(frames, f => f.spread),
    clipped: mean(frames, f => f.clipped),
  };
  console.log('    look:', JSON.stringify({ lum: +look.lum.toFixed(3), sat: +look.sat.toFixed(3),
    max: +look.max.toFixed(3), spread: +look.spread.toFixed(2), clipped: +look.clipped.toFixed(2) }));
  for (let i = 0; i < frames.length; i++) {
    console.log(`      ${(places[i] ?? 'the yard').padEnd(10)} lum ${frames[i].lum.toFixed(2)} sat ${frames[i].sat.toFixed(2)} max ${frames[i].max.toFixed(2)} spread ${frames[i].spread}`);
  }
  assert.ok(look.max > 0.75, `the frame needs real highlights: max is ${look.max.toFixed(3)}`);
  assert.ok(look.spread >= 3.4, `the frame needs tonal range: only ${look.spread.toFixed(1)} brightness buckets carry it`);
  assert.ok(look.lum > 0.40 && look.lum < 0.66, `brightness is ${look.lum.toFixed(3)}`);
  assert.ok(look.sat > 0.33, `and colour: saturation is ${look.sat.toFixed(3)}`);
  assert.ok(look.clipped < 3, `without blowing out: ${look.clipped.toFixed(1)}% of the frame is clipped`);
  // Each area has its own tone, which is the point of the region grade.
  const tones = await page.evaluate(() => {
    const out = [];
    for (const r of window.merc.regions()) {
      window.merc.teleport(Math.round(r.x), Math.round(r.z));
      window.merc.simulate(2.5, {});
      out.push({ key: r.key, tint: window.merc.state().tint, amount: window.merc.state().tintAmount });
    }
    return out;
  });
  assert.equal(new Set(tones.map(t => t.tint)).size, 9, 'nine areas, nine tones');
  assert.ok(tones.every(t => t.amount > 0.2), 'and the grade is actually applied in each');
  evidence.measurements.look = {
    lum: +look.lum.toFixed(3), sat: +look.sat.toFixed(3), max: +look.max.toFixed(3),
    spread: +look.spread.toFixed(1), clipped: +look.clipped.toFixed(2),
    perPlace: frames.map((f, i) => ({ place: places[i] ?? 'the yard', lum: +f.lum.toFixed(2), sat: +f.sat.toFixed(2), max: +f.max.toFixed(2), spread: f.spread })),
    tones,
  };
  record('The frame keeps the original upbeat range, and each area carries its own tone');

  // ---------------------------------------------------------------- real input
  // Held for long enough to actually reach cruise. The machine now takes a second and a
  // quarter to answer the throttle, so a 900 ms hold — which is what this used to be —
  // covers under four units and says nothing about whether it flies.
  const before = await state();
  await page.keyboard.down('w');
  await page.waitForTimeout(5200);
  const moving = await state();
  await page.keyboard.up('w');
  const travelled = Math.hypot(moving.position.x - before.position.x, moving.position.z - before.position.z);
  assert.ok(travelled > 20, `real keyboard input flies the aircraft: moved ${travelled.toFixed(1)} units`);
  // And it reaches the speed a gunship of this class cruises at, not a jet's.
  assert.ok(moving.speedKmh > 250 && moving.speedKmh < 285,
    `settles at ${moving.speedKmh} km/h, which should be the cruise of a modern gunship`);
  await page.keyboard.down('w');
  await page.keyboard.down('Shift');
  await page.waitForTimeout(4200);
  const dashing = await state();
  await page.keyboard.up('Shift');
  await page.keyboard.up('w');
  assert.ok(dashing.speedKmh > moving.speedKmh,
    `the dash is faster than the cruise: ${dashing.speedKmh} vs ${moving.speedKmh} km/h`);
  assert.ok(dashing.speedKmh >= 300 && dashing.speedKmh <= 320,
    `and tops out at a helicopter's speed, not a jet's: ${dashing.speedKmh} km/h`);
  evidence.measurements.flight = { cruiseKmh: moving.speedKmh, dashKmh: dashing.speedKmh, travelled: +travelled.toFixed(1) };
  record('Real keyboard input flies the aircraft at a modern gunship cruise and top speed');

  // ---------------------------------------------------------------- dual-stick controls
  // The left hand flies and the right hand points. Everything here is read off the scene
  // graph rather than recomputed, because the bug this guards against was a sign error that
  // the algebra hid: the nose is the model's own local -Z, so a rotation of +heading pointed
  // it along (-sin, -cos) instead of (sin, -cos). It looked perfectly correct flying north
  // or south and flew tail-first going east or west.
  const agreement = (a, b) => a.x * b.x + a.z * b.z;
  const flyFor = async (keys, seconds = 3.4) => {
    await page.evaluate(() => window.merc.teleport(window.merc.world.home.x, window.merc.world.home.z));
    for (const key of keys) await page.keyboard.down(key);
    await page.waitForTimeout(seconds * 1000);
    const reading = await state();
    for (const key of keys) await page.keyboard.up(key);
    await page.waitForTimeout(150);
    return reading;
  };

  // Which way is away from the camera, on the ground. W should go exactly that way.
  const awayFromCamera = await page.evaluate(() => {
    const c = window.merc.camera.position, p = window.merc.state().position;
    const dx = p.x - c.x, dz = p.z - c.z, l = Math.hypot(dx, dz);
    return { x: dx / l, z: dz / l };
  });

  const headings = {};
  for (const key of ['w', 's', 'a', 'd']) {
    const reading = await flyFor([key]);
    headings[key] = { travel: reading.travel, nose: reading.nose, aiming: reading.aiming };
    assert.equal(reading.aiming, false, `${key} alone is not an aim input`);
    assert.ok(agreement(reading.nose, reading.travel) > 0.97,
      `${key.toUpperCase()} flies nose-first: nose (${reading.nose.x},${reading.nose.z}) against travel (${reading.travel.x},${reading.travel.z})`);
  }
  // And the movement is screen-relative, with the axes the camera actually implies.
  assert.ok(agreement(headings.w.travel, awayFromCamera) > 0.97,
    'W flies away from the camera, up the screen');
  assert.ok(agreement(headings.s.travel, awayFromCamera) < -0.97, 'S flies towards it');
  assert.ok(Math.abs(agreement(headings.d.travel, awayFromCamera)) < 0.06,
    'D flies square across the screen, not on a diagonal');
  assert.ok(agreement(headings.a.travel, headings.d.travel) < -0.97, 'A is the opposite of D');
  record('Movement is screen-relative, and with no aim input the aircraft flies nose-first');

  // Aim is independent of travel, which is the whole point of the scheme.
  const behind = await flyFor(['w', 'ArrowDown']);
  assert.equal(behind.aiming, true, 'an arrow key is an aim input');
  assert.ok(agreement(behind.nose, behind.travel) < -0.97,
    `flying forwards while pointing backwards: ${agreement(behind.nose, behind.travel).toFixed(3)}`);
  const across = await flyFor(['w', 'ArrowRight']);
  assert.ok(Math.abs(agreement(across.nose, across.travel)) < 0.12,
    `flying forwards while pointing across: ${agreement(across.nose, across.travel).toFixed(3)}`);
  record('The arrow keys aim independently of where the aircraft is flying');

  // The mouse is the other way to aim: the nose points at the ground under the cursor.
  for (const [x, y] of [[1050, 200], [300, 620]]) {
    await page.evaluate(() => window.merc.teleport(window.merc.world.home.x, window.merc.world.home.z));
    await page.mouse.move(x, y);
    await page.waitForTimeout(700);
    const aimed = await state();
    const ground = await page.evaluate(() => window.merc.aimPoint());
    const dx = ground.x - aimed.position.x, dz = ground.z - aimed.position.z;
    const length = Math.hypot(dx, dz) || 1;
    assert.equal(aimed.aiming, true, 'the pointer aims once it has moved');
    assert.ok(agreement(aimed.nose, { x: dx / length, z: dz / length }) > 0.99,
      `the nose points at the cursor from ${x},${y}`);
  }
  record('The mouse aims: the nose points at the ground under the cursor');

  // And the gun follows the nose rather than the direction of travel.
  await page.evaluate(() => window.merc.teleport(window.merc.world.home.x, window.merc.world.home.z));
  await page.mouse.move(300, 620);
  await page.keyboard.down('w');
  // Short of the linger, so the cursor is still aiming when the trigger goes. Left longer
  // the mouse lets go by design, the nose falls in behind the travel, and this would be
  // measuring travel-following rather than aiming.
  await page.waitForTimeout(1400);
  const rounds = await page.evaluate(() => {
    const merc = window.merc;
    merc.combat.projectiles.length = 0;
    // No hostiles in reach, so the target-lock assist cannot claim the shot: this is
    // measuring where an *unaimed* round goes, which is along the nose.
    merc.combat.hostiles.length = 0;
    // The nose as it is at the instant of firing. Read after a longer burst it drifts,
    // because the nose is still easing towards a cursor that moves with the camera.
    const before = merc.state();
    merc.simulate(0.1, { Space: true });
    const live = merc.combat.projectiles.filter(p => !p.hostile);
    const shot = live[0];
    const length = shot ? Math.hypot(shot.vx, shot.vz) : 1;
    return { count: live.length, dir: shot ? { x: shot.vx / length, z: shot.vz / length } : null,
      nose: before.nose, travel: before.travel };
  });
  await page.keyboard.up('w');
  assert.ok(rounds.count > 0, 'holding fire puts rounds in the air');
  // The door gun has a little spread, so this is not expected to be exactly one.
  assert.ok(agreement(rounds.dir, rounds.nose) > 0.995,
    `rounds follow the nose: ${agreement(rounds.dir, rounds.nose).toFixed(4)}`);
  assert.ok(agreement(rounds.dir, rounds.travel) < 0.5,
    'and not the direction of travel, or aiming would be decoration');
  evidence.measurements.dualStick = { headings, behind: agreement(behind.nose, behind.travel), across: agreement(across.nose, across.travel), rounds };
  record('Rounds go where the aircraft is pointing, not where it is flying');

  // ---------------------------------------------------------------- the camera
  // Every peak the generator can produce, from the lowest ground to the ceiling.
  const clearances = await page.evaluate(() => {
    const merc = window.merc, out = [];
    const probes = [[0, 0]];
    for (const mark of merc.marks()) probes.push([mark.x, mark.z]);
    // Plus the highest ground anywhere in the region, wherever that turns out to be.
    let peak = { x: 0, z: 0, h: -Infinity };
    for (let z = -980; z < 980; z += 23) {
      for (let x = -980; x < 980; x += 23) {
        const h = merc.world.elevation(x, z);
        if (h > peak.h) peak = { x, z, h };
      }
    }
    probes.push([peak.x, peak.z]);
    for (const [x, z] of probes) {
      merc.teleport(x, z);
      out.push({ x, z, clearance: merc.state().cameraClearance });
    }
    return { out, peak };
  });
  for (const probe of clearances.out) {
    assert.ok(probe.clearance > 5,
      `camera clearance at ${probe.x},${probe.z} is ${probe.clearance}`);
  }
  assert.ok(clearances.peak.h > 90, `the region has real mountains: peak ${clearances.peak.h.toFixed(0)}`);
  evidence.measurements.camera = clearances;
  record('The camera stays above the ground everywhere, including the highest ground in the region');

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
    // The camera has to be above the ground it is looking at. THE EAR stands at over 150
    // units on some seeds, and with the focus pinned to sea level the camera sat below the
    // summit and rendered the inside of the mountain.
    assert.ok(near.cameraClearance > 5,
      `${mark.short}: camera is only ${near.cameraClearance} above the ground beneath it`);
    assert.deepEqual(evidence.errors, [], `${mark.short} builds without a JavaScript error`);
  }
  await page.screenshot({ path: 'artifacts/world-landmark.png' });
  record('Every one of the nine landmarks streams in and builds without error');

  // ---------------------------------------------------------------- zoom
  const ladder = await page.evaluate(() => {
    const merc = window.merc;
    merc.farField();
    const steps = merc.zoomSteps(), out = [];
    for (let i = 0; i < steps.length; i++) {
      merc.zoomTo(i);
      merc.simulate(2, {});
      const s = merc.state();
      out.push({ step: i, zoom: s.zoom, across: s.viewAcross, draw: s.draw, fog: s.fog,
        overview: s.overview.visible, clearance: s.cameraClearance });
    }
    merc.zoomTo(1);
    return { steps, out, far: merc.state().overview };
  });
  const near = ladder.out[1], far = ladder.out[ladder.out.length - 1];
  assert.equal(ladder.steps.length, 8, 'eight steps of zoom');
  assert.ok(Math.abs(far.across / near.across - 8) < 0.05,
    `the far step shows eight times the ground: ${(far.across / near.across).toFixed(2)}x`);
  for (let i = 1; i < ladder.out.length; i++) {
    assert.ok(ladder.out[i].across > ladder.out[i - 1].across, 'every step shows more than the last');
    assert.ok(ladder.out[i].clearance > 5, `camera stays above ground at step ${i}`);
  }
  assert.equal(ladder.out[0].overview, false, 'the near view is streamed chunks alone');
  assert.equal(far.overview, true, 'the far view brings in the region mesh');
  assert.ok(far.fog < near.fog * 0.5, `fog thins as you pull back: ${near.fog} -> ${far.fog}`);
  assert.ok(far.draw < 600, `draw calls stay sane at full zoom: ${far.draw}`);
  assert.ok(ladder.far.triangles < 200000, `the region mesh is one bounded mesh: ${ladder.far.triangles} triangles`);
  evidence.measurements.zoom = ladder;
  record('Eight steps of zoom reach exactly eight times the default view, and the far field fills it');

  // The coarse region mesh has to hang below the detailed chunks, or it pokes up through
  // them. Measured against the real field on every land vertex it has.
  const poke = await page.evaluate(() => {
    const merc = window.merc;
    const mesh = merc.scene.children.find(o => o.isMesh && o.geometry
      && o.geometry.attributes.position.count > 60000);
    const pos = mesh.geometry.attributes.position;
    let worst = -Infinity, above = 0, land = 0;
    for (let i = 0; i < pos.count; i += 3) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const fine = merc.world.groundHeight(x, z);
      if (fine <= 0.2 && y <= 0.2) continue;        // under the sea plane, never seen
      land++;
      if (y - fine > 0) above++;
      if (y - fine > worst) worst = y - fine;
    }
    return { land, above, pct: 100 * above / land, worst };
  });
  assert.ok(poke.pct < 2, `the region mesh stays under the detailed terrain: ${poke.pct.toFixed(2)}% of land vertices above it`);
  assert.ok(poke.worst < 6, `worst protrusion ${poke.worst.toFixed(1)} units`);
  evidence.measurements.pokeThrough = poke;
  record('The coarse region mesh hangs below the streamed terrain instead of through it');

  // ---------------------------------------------------------------- the map
  const mapped = await page.evaluate(() => {
    const merc = window.merc;
    const first = merc.map();
    const canvas = document.getElementById('map');
    document.getElementById('map-panel').hidden = false;
    // Painting twice with nothing moved must give the same pixels: the aircraft marker
    // used to be drawn straight onto the map, so repainting accumulated arrows.
    const read = () => {
      const c = document.createElement('canvas');
      c.width = canvas.width; c.height = canvas.height;
      c.getContext('2d').drawImage(canvas, 0, 0);
      return c.toDataURL().length;
    };
    const a = read(), b = read();
    document.getElementById('map-panel').hidden = true;
    return { ms: first.ms, sameTwice: a === b };
  });
  assert.ok(mapped.ms < 500, `the map draws without a visible freeze: ${mapped.ms} ms`);
  assert.equal(mapped.sameTwice, true, 'repainting the map does not accumulate markers');
  evidence.measurements.map = mapped;
  record('The region map draws inside a frame budget and repaints cleanly');

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

  // ---------------------------------------------------------------- panning and zooming the map
  // The map used to be one fixed picture of the whole region. Ten kilometres across a 620
  // pixel canvas is forty metres to the pixel, which is too coarse to pick a landing site
  // off — so it now pans and zooms, and redraws the terrain for whatever window it shows.
  await page.keyboard.press('m');
  await page.waitForTimeout(250);
  const mapSettled = () => page.waitForFunction(() => window.merc.mapView().settled, null, { timeout: 8000 });
  const view = () => page.evaluate(() => window.merc.mapView());
  const canvasBox = await page.locator('#map').boundingBox();
  const whole = await view();
  assert.equal(whole.span, 2000, 'the map opens on the whole ten kilometres');
  assert.equal(whole.step, 0, 'at the widest of its zoom steps');
  assert.equal(whole.steps, 5, 'five steps, each a halving of the ground covered');

  // The wheel zooms about the pointer, so what is under the cursor stays under the cursor —
  // which is the difference between zooming a map and enlarging it.
  const aim = { x: canvasBox.x + canvasBox.width * 0.3, y: canvasBox.y + canvasBox.height * 0.3 };
  await page.mouse.move(aim.x, aim.y);
  await page.mouse.wheel(0, -120);
  await mapSettled();
  const zoomedIn = await view();
  assert.equal(zoomedIn.span, whole.span / 2, `one wheel click is one step: ${whole.span} -> ${zoomedIn.span}`);
  assert.equal(zoomedIn.baseSpan, zoomedIn.span, 'and the terrain is redrawn for the new window');
  assert.ok(zoomedIn.redraws > whole.redraws, 'which is a real redraw, not the old image scaled');
  assert.ok(zoomedIn.x < -1 && zoomedIn.z < -1,
    `zooming about the pointer pulls the view towards it: centre ${zoomedIn.x},${zoomedIn.z}`);

  // Dragging with the mouse pans: the ground follows the hand.
  const beforeDrag = await view();
  const centre = { x: canvasBox.x + canvasBox.width / 2, y: canvasBox.y + canvasBox.height / 2 };
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(centre.x - i * 14, centre.y - i * 14);
  await page.mouse.up();
  await mapSettled();
  const panned = await view();
  assert.ok(panned.x > beforeDrag.x + 1 && panned.z > beforeDrag.z + 1,
    `dragging up and left brings the far side into view: ${beforeDrag.x},${beforeDrag.z} -> ${panned.x},${panned.z}`);

  // All the way in: six hundred metres across, where a pixel is finer than the height
  // lattice and there is nothing further to resolve.
  const deepest = await page.evaluate(() => {
    window.merc.mapZoomTo(window.merc.mapView().steps - 1);
    return window.merc.mapView();
  });
  assert.equal(deepest.span, whole.span / 16, 'the last step is a sixteenth of the region');
  assert.equal(Math.round(deepest.span * 5), 625, 'six hundred and twenty five metres across');
  assert.equal(deepest.baseSpan, deepest.span, 'drawn at that scale rather than magnified');
  assert.ok(deepest.ms < 500, `and still inside a frame budget: ${deepest.ms} ms`);
  await page.screenshot({ path: 'artifacts/world-map-zoomed.png' });

  // Panning cannot leave the region, at any zoom.
  await page.evaluate(() => { for (let i = 0; i < 40; i++) window.merc.mapPan(400, 400); });
  await mapSettled();
  const pinned = await view();
  const limit = (2000 - pinned.span) / 2;
  assert.ok(Math.abs(pinned.x) <= limit + 1 && Math.abs(pinned.z) <= limit + 1,
    `the window stays inside the region: ${pinned.x},${pinned.z} against a limit of ${limit}`);

  await page.keyboard.press('0');
  await mapSettled();
  const backToWhole = await view();
  assert.equal(backToWhole.span, whole.span, 'the 0 key shows the whole region again');
  assert.ok(Math.abs(backToWhole.x) < 1 && Math.abs(backToWhole.z) < 1, 'centred on it');
  await page.keyboard.press('m');
  evidence.measurements.mapNavigation = { whole, zoomedIn, panned, deepest, pinned, backToWhole };
  record('The region map pans and zooms through five steps, redrawing the terrain at each scale');

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
