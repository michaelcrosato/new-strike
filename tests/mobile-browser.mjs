// Mobile verification for MERCENARY STRIKE.
//
// The desktop suite proves the game; this proves you can actually play it on a phone. It
// runs the built single file at the two aspect ratios a phone has — 9:16 held upright and
// 16:9 turned sideways — with touch emulation and a phone user agent, and it drives real
// browser-level touch input through the debugger protocol rather than synthesised events,
// so pointer capture, gesture recognition and `touch-action` all behave the way they do
// under a thumb.
//
// What it is here to catch: chrome that does not fit, controls that do not exist, and a
// region map you cannot reach the edges of.
//
// Run the server first (npm run world), then: node tests/mobile-browser.mjs
import { chromium, devices } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = 'http://127.0.0.1:4189';
const url = seed => `${base}/?seed=${seed}`;
const SEED = 20492;
// The region is ten kilometres square: 2000 units at five metres each.
const WORLD_SIZE = 2000;

// 9:16 and 16:9 at a size real phones actually report. The portrait figure is a Pixel-class
// phone; the landscape figure is the same device turned over, which is where the vertical
// room runs out.
const ORIENTATIONS = [
  { label: 'portrait', viewport: { width: 390, height: 844 }, coverageLimit: 40 },
  { label: 'landscape', viewport: { width: 844, height: 390 }, coverageLimit: 36 },
];

await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const evidence = { checks: [], errors: [], network: [], measurements: {} };
const record = name => { evidence.checks.push(name); console.log('PASS ' + name); };

// Real touch input, dispatched by the browser itself. Playwright's touchscreen only taps,
// and a hand-built TouchEvent cannot claim pointer capture, so neither can drive a
// joystick or a two-finger pinch.
function toucher(cdp) {
  const send = (type, points) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: points.map(p => ({ x: Math.round(p.x), y: Math.round(p.y), id: p.id ?? 0 })),
  });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  return {
    async tap(x, y) {
      await send('touchStart', [{ x, y }]);
      await wait(60);
      await send('touchEnd', []);
      await wait(90);
    },
    // A thumb pressed down, moved, held, and lifted.
    async drag(from, to, { steps = 12, hold = 0 } = {}) {
      await send('touchStart', [from]);
      for (let i = 1; i <= steps; i++) {
        await send('touchMove', [{ x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps }]);
        await wait(16);
      }
      if (hold) await wait(hold);
      await send('touchEnd', []);
      await wait(60);
    },
    // Press and hold in one place, for a button that acts while it is held down.
    async hold(x, y, ms) {
      await send('touchStart', [{ x, y }]);
      await wait(ms);
      await send('touchEnd', []);
      await wait(60);
    },
    // Two fingers either side of a point, moving to a new separation.
    async pinch(cx, cy, fromGap, toGap, { steps = 14 } = {}) {
      const at = gap => [{ x: cx - gap / 2, y: cy, id: 1 }, { x: cx + gap / 2, y: cy, id: 2 }];
      await send('touchStart', at(fromGap));
      for (let i = 1; i <= steps; i++) {
        await send('touchMove', at(fromGap + (toGap - fromGap) * i / steps));
        await wait(16);
      }
      await send('touchEnd', []);
      await wait(120);
    },
  };
}

// The middle of an element, in viewport coordinates, which is where a thumb lands.
const centreOf = async (page, selector) => page.evaluate(sel => {
  const el = document.querySelector(sel);
  if (!el) throw new Error('no such element: ' + sel);
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) throw new Error('element has no box: ' + sel);
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}, selector);

try {
  for (const { label, viewport, coverageLimit } of ORIENTATIONS) {
    const measurements = {};
    const context = await browser.newContext({
      ...devices['Pixel 7'],
      viewport, screen: viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    page.on('pageerror', e => evidence.errors.push(`${label}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') evidence.errors.push(`${label}: ${m.text()}`); });
    page.on('request', r => {
      if (!r.url().startsWith(base) && !r.url().startsWith('data:') && !r.url().startsWith('file:')) evidence.network.push(r.url());
    });
    const cdp = await context.newCDPSession(page);
    const touch = toucher(cdp);
    const state = () => page.evaluate(() => window.merc.state());
    const mapView = () => page.evaluate(() => window.merc.mapView());

    // ---------------------------------------------------------------- boot
    await page.goto(url(SEED));
    await page.waitForFunction(() => window.merc && window.merc.state().resident > 20, null, { timeout: 60000 });
    await page.waitForTimeout(800);
    const booted = await state();
    assert.ok(booted.resident > 40, `${label}: chunks are resident on a phone: ${booted.resident}`);
    assert.equal(await page.locator('#loading').isVisible(), false, `${label}: the loading screen gets out of the way`);
    // A coarse pointer has to be recognised, or none of the touch chrome is shown at all.
    assert.equal(await page.evaluate(() => document.body.classList.contains('touch')), true,
      `${label}: the game knows it is being played with a thumb`);
    measurements.boot = booted;
    record(`The built bundle boots and renders at ${viewport.width}x${viewport.height} (${label})`);

    // ---------------------------------------------------------------- the briefing
    // The briefing is the first thing a player sees, and its single button is the only way
    // past it. Off the bottom of a phone screen, the game looks like a wall of text.
    const introFits = await page.evaluate(() => {
      const r = document.getElementById('intro-go').getBoundingClientRect();
      return { inView: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth, top: Math.round(r.top), bottom: Math.round(r.bottom) };
    });
    assert.equal(introFits.inView, true, `${label}: the briefing's only button is on screen without scrolling: ${JSON.stringify(introFits)}`);
    await page.screenshot({ path: `artifacts/mobile-${label}-briefing.png` });
    const go = await centreOf(page, '#intro-go');
    await touch.tap(go.x, go.y);
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#intro').isVisible(), false, `${label}: and a tap dismisses it`);
    record(`The briefing fits the screen and a tap gets past it (${label})`);

    // ---------------------------------------------------------------- the chrome fits
    const fit = await page.evaluate(() => {
      const vw = innerWidth, vh = innerHeight;
      const problems = [];
      const boxes = {};
      // Everything fixed to the screen that is on show while flying.
      for (const sel of ['.topbar', '#hud', '#debug', '#outfit', '#touch-controls', '.rail', '#flash']) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const cs = getComputedStyle(el);
        if (el.hidden || cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        boxes[sel] = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
        // A sheet parked off the bottom of the screen is deliberate; anything else hanging
        // over an edge is not.
        if (cs.transform !== 'none' && cs.transform.includes('matrix')) continue;
        if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) {
          problems.push(`${sel} ${JSON.stringify(boxes[sel])} outside ${vw}x${vh}`);
        }
      }
      return { problems, boxes, scrollWidth: document.documentElement.scrollWidth, vw, vh };
    });
    assert.deepEqual(fit.problems, [], `${label}: no chrome hangs off the edge of the screen`);
    assert.ok(fit.scrollWidth <= fit.vw + 1, `${label}: the page does not scroll sideways: ${fit.scrollWidth} > ${fit.vw}`);
    measurements.fit = fit;
    record(`No panel hangs off the edge of the screen and the page does not scroll (${label})`);

    // ---------------------------------------------------------------- you can see the game
    // Three desktop panels at fixed widths covered nearly two thirds of a phone screen.
    const covered = await page.evaluate(() => {
      const vw = innerWidth, vh = innerHeight;
      const boxes = [];
      for (const sel of ['.topbar', '#hud', '#debug', '#outfit', '.rail']) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const cs = getComputedStyle(el);
        if (el.hidden || cs.display === 'none' || cs.visibility === 'hidden') continue;
        const r = el.getBoundingClientRect();
        if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) continue;
        boxes.push(r);
      }
      let hit = 0, total = 0;
      for (let y = 0; y < vh; y += 6) for (let x = 0; x < vw; x += 6) {
        total++;
        if (boxes.some(r => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)) hit++;
      }
      return Math.round(100 * hit / total);
    });
    assert.ok(covered <= coverageLimit, `${label}: the panels leave the world visible: ${covered}% covered, limit ${coverageLimit}%`);
    measurements.coveredPercent = covered;
    record(`The heads-up chrome leaves most of the world visible: ${covered}% covered (${label})`);

    // ---------------------------------------------------------------- flying with a thumb
    const beforeFlight = await state();
    const joy = await centreOf(page, '#joystick');
    // A thumb pushed up and held there, which is how you fly rather than how you swipe.
    await touch.drag({ x: joy.x, y: joy.y }, { x: joy.x, y: joy.y - 46 }, { steps: 8, hold: 1100 });
    const afterFlight = await state();
    const travelled = Math.hypot(afterFlight.position.x - beforeFlight.position.x, afterFlight.position.z - beforeFlight.position.z);
    assert.ok(travelled > 8, `${label}: a thumb on the stick flies the aircraft: moved ${travelled.toFixed(1)} units`);
    // And releasing it stops the input, rather than leaving the stick jammed over.
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => window.merc.touchInput().x === 0 && window.merc.touchInput().y === 0), true,
      `${label}: lifting the thumb centres the stick`);
    measurements.travelled = +travelled.toFixed(1);
    record(`A thumb on the flight stick flies the aircraft, and releasing it centres (${label})`);

    // ---------------------------------------------------------------- firing and the winch
    const fire = await centreOf(page, '#touch-fire');
    const shots = await page.evaluate(async ([x, y]) => {
      // Watch the projectile count while the button is held: tracers are short-lived, so a
      // single reading after the fact proves nothing.
      let peak = 0;
      const timer = setInterval(() => { peak = Math.max(peak, window.merc.state().projectiles); }, 40);
      await new Promise(r => setTimeout(r, 40));
      window.__peak = () => { clearInterval(timer); return peak; };
      return true;
    }, [fire.x, fire.y]);
    await touch.hold(fire.x, fire.y, 900);
    const peakShots = await page.evaluate(() => window.__peak());
    assert.ok(peakShots > 0, `${label}: the fire button puts rounds in the air: peak ${peakShots} projectiles`);

    // The cable only pays out on a job that needs one, so put one in hand first — the same
    // setup the desktop suite uses for the winch key.
    await page.evaluate(() => {
      window.merc.profileRef.active = null;
      window.merc.profileRef.heli.winch = 2;
      window.merc.offer('extraction');
      const zone = window.merc.mission().zone;
      window.merc.teleport(zone.x, zone.z);
    });
    await page.waitForTimeout(300);
    const winch = await centreOf(page, '#touch-winch');
    await touch.hold(winch.x, winch.y, 1400);
    const cablePaid = await page.evaluate(() => window.merc.state().cable);
    assert.ok(cablePaid > 1.5, `${label}: the winch button pays the cable out: ${cablePaid}`);
    await page.waitForTimeout(600);
    assert.ok(await page.evaluate(() => window.merc.winchOut() < 0.5),
      `${label}: and lifting the thumb winds it back in`);
    measurements.fire = { peakShots, cablePaid };
    record(`The fire button shoots and the winch button pays out the cable (${label})`);

    // ---------------------------------------------------------------- pinch the world
    // The eight steps of zoom existed, but only a mouse wheel or a keyboard could reach
    // them. Spreading two fingers is a zoom in, the way it is everywhere else.
    const mid = { x: Math.round(viewport.width / 2), y: Math.round(viewport.height / 2) };
    const steps = await page.evaluate(() => window.merc.zoomSteps().length);
    assert.equal(steps, 8, 'still eight steps of zoom');
    await page.evaluate(() => window.merc.zoomTo(4));
    const zoomStart = (await state()).zoomStep;
    await touch.pinch(mid.x, mid.y, 70, 260, { steps: 16 });
    const spread = (await state()).zoomStep;
    assert.ok(spread < zoomStart, `${label}: spreading two fingers zooms in: step ${zoomStart} -> ${spread}`);
    await touch.pinch(mid.x, mid.y, 260, 70, { steps: 16 });
    const squeezed = (await state()).zoomStep;
    assert.ok(squeezed > spread, `${label}: squeezing them zooms out: step ${spread} -> ${squeezed}`);
    // And both ends of the ladder have to be reachable by pinching. One gesture is worth
    // about five of the eight steps — a step is half a stop, so the full range would need
    // eleven times the finger travel, which no phone screen has. Lifting and going again
    // re-bases the gesture, which is how zooming a phone works anyway.
    await touch.pinch(mid.x, mid.y, 60, 330, { steps: 20 });
    await touch.pinch(mid.x, mid.y, 60, 330, { steps: 20 });
    const nearest = (await state()).zoomStep;
    await touch.pinch(mid.x, mid.y, 330, 60, { steps: 20 });
    await touch.pinch(mid.x, mid.y, 330, 60, { steps: 20 });
    const farthest = (await state()).zoomStep;
    assert.equal(nearest, 0, `${label}: spreading twice reaches the nearest step`);
    assert.equal(farthest, 7, `${label}: squeezing twice reaches the farthest step`);
    measurements.pinchZoom = { zoomStart, spread, squeezed, nearest, farthest };
    await page.evaluate(() => window.merc.zoomTo(1));
    record(`Pinching the world reaches both ends of the eight-step zoom (${label})`);

    // The browser's own pinch-zoom must not fight the game's.
    const pageScale = await page.evaluate(() => visualViewport.scale);
    assert.ok(Math.abs(pageScale - 1) < 0.01, `${label}: the browser does not zoom the page instead: scale ${pageScale}`);
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('scene')).touchAction), 'none',
      `${label}: the canvas claims its own gestures`);
    record(`Game gestures do not become browser page-zoom (${label})`);

    // ---------------------------------------------------------------- the map fits
    const mapOpen = await centreOf(page, '#rail-map');
    await touch.tap(mapOpen.x, mapOpen.y);
    await page.waitForTimeout(500);
    assert.equal(await page.locator('#map-panel').isVisible(), true, `${label}: the rail opens the region map`);
    const mapFit = await page.evaluate(() => {
      const el = id => document.getElementById(id).getBoundingClientRect();
      const inside = r => r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
      const canvas = el('map'), card = document.querySelector('.map-card').getBoundingClientRect();
      const head = document.querySelector('.map-card h2').getBoundingClientRect();
      return {
        canvas: { x: Math.round(canvas.x), y: Math.round(canvas.y), w: Math.round(canvas.width), h: Math.round(canvas.height) },
        canvasInside: inside(canvas), cardInside: inside(card), headInside: inside(head),
        closeInside: inside(el('map-close')),
        controlsInside: inside(el('map-out')) && inside(el('map-in')) && inside(el('map-reset')),
        backing: { w: document.getElementById('map').width, h: document.getElementById('map').height },
      };
    });
    assert.equal(mapFit.canvasInside, true, `${label}: the whole map canvas is on screen: ${JSON.stringify(mapFit.canvas)}`);
    assert.equal(mapFit.headInside, true, `${label}: the map heading is not sliced off`);
    assert.equal(mapFit.closeInside, true, `${label}: the close button can be reached`);
    assert.equal(mapFit.controlsInside, true, `${label}: so can the zoom controls`);
    assert.ok(mapFit.canvas.w > 200, `${label}: and the map is big enough to read: ${mapFit.canvas.w}px`);
    measurements.mapFit = mapFit;
    await page.screenshot({ path: `artifacts/mobile-${label}-map.png` });
    record(`The region map fits the screen and every control on it can be reached (${label})`);

    // ---------------------------------------------------------------- the map zooms
    const whole = await mapView();
    assert.equal(whole.span, WORLD_SIZE, `${label}: the map opens on the whole region`);
    assert.ok(whole.steps >= 4, `${label}: the map has a zoom ladder: ${whole.steps} steps`);
    const settled = () => page.waitForFunction(() => window.merc.mapView().settled, null, { timeout: 8000 });
    const mapCentre = await centreOf(page, '#map');
    await touch.pinch(mapCentre.x, mapCentre.y, 70, 300, { steps: 18 });
    const duringPinch = await mapView();
    assert.ok(duringPinch.span < whole.span, `${label}: pinching the map zooms it in: ${whole.span} -> ${duringPinch.span} units across`);
    // Zooming a map should resolve more ground, not magnify the same pixels: once the hand
    // is off, the base image is redrawn for the window it is actually showing.
    await settled();
    const zoomedMap = await mapView();
    assert.equal(zoomedMap.baseSpan, zoomedMap.span,
      `${label}: the map redraws at the new scale rather than enlarging the old image`);
    assert.ok(zoomedMap.ms > 0 && zoomedMap.ms < 500, `${label}: and redraws inside a frame budget: ${zoomedMap.ms} ms`);
    measurements.mapZoom = { whole, duringPinch, zoomedMap };
    record(`Pinching the region map zooms it and redraws the terrain at the new scale (${label})`);

    // ---------------------------------------------------------------- the map pans
    const beforePan = await mapView();
    await touch.drag({ x: mapCentre.x + 60, y: mapCentre.y + 60 }, { x: mapCentre.x - 60, y: mapCentre.y - 60 }, { steps: 14 });
    const afterPan = await mapView();
    const moved = Math.hypot(afterPan.x - beforePan.x, afterPan.z - beforePan.z);
    assert.ok(moved > 5, `${label}: dragging the map pans it: moved ${moved.toFixed(1)} units`);
    // Dragging a long way must not sail off the edge of the region.
    await settled();
    const redrawsBefore = (await mapView()).redraws;
    for (let i = 0; i < 6; i++) await touch.drag({ x: mapCentre.x - 80, y: mapCentre.y - 80 }, { x: mapCentre.x + 80, y: mapCentre.y + 80 }, { steps: 6 });
    const pinned = await mapView();
    const limit = (WORLD_SIZE - pinned.span) / 2;
    assert.ok(Math.abs(pinned.x) <= limit + 1 && Math.abs(pinned.z) <= limit + 1,
      `${label}: panning stays inside the region: centre ${pinned.x},${pinned.z} limit ${limit}`);
    // Six quick pans must not mean six full terrain redraws. Each one is a hundred-odd
    // milliseconds of blocked main thread, and six of them in a row froze the map long
    // enough to swallow the next tap.
    await settled();
    const spent = (await mapView()).redraws - redrawsBefore;
    assert.ok(spent <= 2, `${label}: a flurry of pans collapses into one redraw, not one each: ${spent} redraws for 6 pans`);
    measurements.mapPan = { beforePan, afterPan, pinned, limit, redrawsForSixPans: spent };
    record(`Dragging the region map pans it, stays inside the region, and does not redraw per gesture (${label})`);

    // ---------------------------------------------------------------- reset and close
    const reset = await centreOf(page, '#map-reset');
    await touch.tap(reset.x, reset.y);
    await page.waitForTimeout(350);
    const backOut = await mapView();
    assert.equal(backOut.span, WORLD_SIZE, `${label}: reset shows the whole region again`);
    assert.ok(Math.abs(backOut.x) < 1 && Math.abs(backOut.z) < 1, `${label}: centred on the region`);
    const close = await centreOf(page, '#map-close');
    await touch.tap(close.x, close.y);
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#map-panel').isVisible(), false, `${label}: and a tap closes the map`);
    record(`The map resets to the whole region and closes on a tap (${label})`);

    // ---------------------------------------------------------------- the rest of the rail
    const work = await centreOf(page, '#rail-work');
    await touch.tap(work.x, work.y);
    await page.waitForTimeout(400);
    const boardReachable = await page.evaluate(() => {
      const el = document.getElementById('outfit');
      const r = el.getBoundingClientRect();
      const items = document.querySelectorAll('#board li').length;
      return { onScreen: r.top < innerHeight - 40 && r.bottom > 40 && r.left >= -1 && r.right <= innerWidth + 1, items };
    });
    assert.equal(boardReachable.onScreen, true, `${label}: the contract board comes on screen when asked for`);
    assert.ok(boardReachable.items > 0, `${label}: with work on it: ${boardReachable.items} contracts`);
    await page.screenshot({ path: `artifacts/mobile-${label}-board.png` });
    await touch.tap(work.x, work.y);
    await page.waitForTimeout(350);

    const yardTap = await centreOf(page, '#rail-yard');
    await touch.tap(yardTap.x, yardTap.y);
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#yard').isVisible(), true, `${label}: the rail opens the yard`);
    const yardFit = await page.evaluate(() => {
      const card = document.querySelector('.yard-card'), r = card.getBoundingClientRect();
      return {
        columns: getComputedStyle(document.querySelector('.yard-grid')).gridTemplateColumns.split(' ').length,
        inside: r.left >= -1 && r.right <= innerWidth + 1,
        scrollable: card.scrollHeight > card.clientHeight ? true : 'fits',
        fittings: document.querySelectorAll('#yard-base li, #yard-heli li').length,
      };
    });
    assert.ok(yardFit.inside, `${label}: the yard fits the width of the screen`);
    assert.equal(yardFit.fittings, 9, `${label}: with all nine fittings`);
    if (label === 'portrait') {
      assert.equal(yardFit.columns, 1, 'the yard is a single readable column on a phone held upright');
    }
    measurements.yard = yardFit;
    await page.screenshot({ path: `artifacts/mobile-${label}-yard.png` });
    const yardClose = await centreOf(page, '#yard-close');
    await touch.tap(yardClose.x, yardClose.y);
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#yard').isVisible(), false, `${label}: and closes again`);
    record(`The rail opens the contract board and the yard, both readable and closable (${label})`);

    // ---------------------------------------------------------------- weapons on a tap
    // The starting airframe has one hardpoint and so one weapon. Fit the other two, the way
    // the yard would, then pick the second with a key so the tiles are rebuilt for real.
    await page.evaluate(() => { window.merc.profileRef.heli.hardpoint = 3; });
    await page.keyboard.press('2');
    await page.waitForTimeout(150);
    const weapons = await page.evaluate(() => document.querySelectorAll('#weapons div').length);
    assert.ok(weapons >= 2, `${label}: more than one weapon to choose from: ${weapons}`);
    const first = await page.evaluate(() => window.merc.combat.weapon);
    assert.equal(first, 1, `${label}: the key selected the second weapon`);
    const tile = await page.evaluate(() => {
      const r = document.querySelectorAll('#weapons div')[0].getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await touch.tap(tile.x, tile.y);
    await page.waitForTimeout(200);
    const second = await page.evaluate(() => window.merc.combat.weapon);
    assert.equal(second, 0, `${label}: tapping a weapon tile selects it: ${first} -> ${second}`);
    assert.equal(await page.evaluate(() => document.querySelectorAll('#weapons div')[0].classList.contains('on')), true,
      `${label}: and the tile shows as the selected one`);
    record(`Weapon tiles switch weapons on a tap (${label})`);

    // ---------------------------------------------------------------- flying home
    await page.evaluate(() => window.merc.teleport(400, 400));
    await page.waitForTimeout(300);
    const home = await centreOf(page, '#rail-home');
    await touch.tap(home.x, home.y);
    await page.waitForTimeout(400);
    const back = await state();
    const homeAt = await page.evaluate(() => ({ x: window.merc.world.home.x, z: window.merc.world.home.z }));
    assert.ok(Math.hypot(back.position.x - homeAt.x, back.position.z - homeAt.z) < 40,
      `${label}: the rail flies you back to the pad`);
    record(`The rail button returns the aircraft to its own pad (${label})`);

    await page.screenshot({ path: `artifacts/mobile-${label}-flight.png` });
    evidence.measurements[label] = measurements;
    await context.close();
  }

  // ---------------------------------------------------------------- hygiene
  assert.deepEqual(evidence.network, [], 'no external requests on a phone either');
  assert.deepEqual(evidence.errors, [], 'no JavaScript or shader errors in either orientation');
  record('No external requests and no errors in either orientation');

  await writeFile('artifacts/mobile-verification.json', JSON.stringify(evidence, null, 2));
  console.log(`\n${evidence.checks.length} checks passed.`);
} catch (error) {
  console.error('\nFAILED: ' + error.message);
  evidence.failure = error.message;
  await writeFile('artifacts/mobile-verification.json', JSON.stringify(evidence, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
