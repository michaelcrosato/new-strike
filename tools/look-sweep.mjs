// Measures the look, so it can be chosen rather than guessed.
//
// Renders the same four places in the region under a sweep of tone curve, exposure and light
// level, and reports what each combination does to the frame: mean brightness, mean
// saturation, the brightest pixel, and how many brightness buckets carry a real share of the
// image. That last number is the flatness measure — a frame with everything in two buckets
// is the pale wash this game had, however bright it is.
//
// It runs under Playwright rather than in a live tab because a WebGPU canvas presents
// asynchronously: reading it back in a backgrounded tab returns the last presented frame, so
// every row of the sweep comes out identical and the measurement is silently worthless. The
// tone curves are the same arithmetic on either backend, so measuring the WebGL 2 path here
// answers the question for both.
//
//   node tools/look-sweep.mjs            # the shipped look, at four places
//   node tools/look-sweep.mjs --sweep    # the full grid
import { chromium } from '@playwright/test';
import { measureFrame, line as fmt, mean as avg } from './frame-stats.mjs';

const base = process.env.BASE ?? 'http://127.0.0.1:4189';
const sweeping = process.argv.includes('--sweep');

const PLACES = [
  ['the yard', null],
  ['salt pans', 'saltflat'],
  ['white spine', 'alpine'],
  ['green delta', 'delta'],
];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.error('PAGE ERROR', e.message));
await page.goto(`${base}/?seed=20492&webgl`);
await page.waitForFunction(() => window.merc && window.merc.state().resident > 20, null, { timeout: 40000 });
await page.evaluate(() => window.merc.dismiss());
console.log('backend:', await page.evaluate(() => window.merc.state().backend));

await page.evaluate(() => {
  window.goTo = key => {
    const merc = window.merc;
    if (!key) { merc.teleport(merc.world.home.x, merc.world.home.z); return; }
    const region = merc.regions().find(r => r.key === key);
    merc.teleport(Math.round(region.x), Math.round(region.z));
  };
});

async function measure(tone, exposure, sun, hemi) {
  const rows = [];
  for (const [, key] of PLACES) {
    await page.evaluate(([k, t, e, s, h]) => {
      window.goTo(k);
      window.merc.light(s, h);
      window.merc.tone(t, e);
      window.merc.simulate(0.5, {});
    }, [key, tone, exposure, sun, hemi]);
    rows.push(await measureFrame(page));
  }
  return {
    lum: avg(rows, r => r.lum), sat: avg(rows, r => r.sat), max: avg(rows, r => r.max),
    spread: avg(rows, r => r.spread), peak: avg(rows, r => r.peak), clipped: avg(rows, r => r.clipped),
    perPlace: rows.map((r, i) => `${PLACES[i][0]}: lum ${r.lum.toFixed(2)} sat ${r.sat.toFixed(2)} max ${r.max.toFixed(2)} spread ${r.spread}`),
  };
}

const line = fmt;

if (!sweeping) {
  const shipped = await page.evaluate(() => ({
    tone: Object.entries({ agx: 6, neutral: 7, aces: 4 }).find(([, v]) => v === window.merc.renderer.toneMapping)?.[0] ?? String(window.merc.renderer.toneMapping),
    exposure: window.merc.renderer.toneMappingExposure,
    sun: window.merc.state().sun, hemi: window.merc.state().hemi,
  }));
  const m = await measure(shipped.tone, shipped.exposure, shipped.sun, shipped.hemi);
  console.log('\nshipped look:', JSON.stringify(shipped));
  console.log(line('shipped', m));
  for (const p of m.perPlace) console.log('  ' + p);
} else {
  const results = [];
  for (const tone of ['agx', 'neutral', 'aces']) {
    for (const sun of [2.6, 3.2, 3.75]) {
      for (const exposure of [0.9, 1.1, 1.3, 1.5]) {
        const hemi = sun * 0.47;
        const m = await measure(tone, exposure, sun, hemi);
        results.push({ tone, sun, exposure, hemi, m });
        console.log(line(`${tone} sun ${sun} exp ${exposure}`, m));
      }
    }
  }
  // Upbeat means bright, colourful and not flat, without crushing the highlights.
  const score = ({ m }) =>
    Math.min(m.sat / 0.66, 1) * 2.4
    + (1 - Math.abs(m.lum - 0.54) / 0.22) * 1.6
    + Math.min(m.spread / 4, 1) * 1.4
    - Math.max(0, m.clipped - 1) * 0.35;
  results.sort((a, b) => score(b) - score(a));
  console.log('\nbest five for an upbeat frame:');
  for (const r of results.slice(0, 5)) {
    console.log(`  ${score(r).toFixed(2)}  ${r.tone} sun ${r.sun} hemi ${r.hemi.toFixed(2)} exposure ${r.exposure}` +
      `  (lum ${r.m.lum.toFixed(3)} sat ${r.m.sat.toFixed(3)} spread ${r.m.spread.toFixed(1)})`);
  }
}

await browser.close();
