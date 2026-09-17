// Tunes the grade against the original's measured numbers.
//
// The target is BLOCKHAWK, read by tools/look-target.mjs: lum 0.445, sat 0.363, max 0.896,
// spread 4.8. The surprise in that measurement is that the original is neither brighter nor
// more saturated than what this game already had — it simply has real highlights and a broad
// tonal range, and that is what reads as upbeat. So this sweeps the two knobs that move
// those: the contrast in the grade, and how much of the frame blooms.
import { chromium } from '@playwright/test';
import { measureFrame, line, mean } from './frame-stats.mjs';

const base = process.env.BASE ?? 'http://127.0.0.1:4189';
const TARGET = { lum: 0.445, sat: 0.363, max: 0.896, spread: 4.8 };
const PLACES = [null, 'saltflat', 'alpine', 'delta'];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.error('PAGE ERROR', e.message));
await page.goto(`${base}/?seed=20492&webgl`);
await page.waitForFunction(() => window.merc && window.merc.state().resident > 20, null, { timeout: 40000 });
await page.evaluate(() => {
  window.merc.dismiss();
  window.goTo = key => {
    const merc = window.merc;
    if (!key) return merc.teleport(merc.world.home.x, merc.world.home.z);
    const r = merc.regions().find(x => x.key === key);
    merc.teleport(Math.round(r.x), Math.round(r.z));
  };
});

async function measure(setup) {
  const rows = [];
  for (const key of PLACES) {
    await page.evaluate(([k, s]) => {
      window.goTo(k);
      if (s.tone) window.merc.tone(s.tone, s.exposure);
      if (s.sun) window.merc.light(s.sun, s.hemi);
      window.merc.grade(s.grade ?? {});
      window.merc.simulate(0.5, {});
    }, [key, setup]);
    rows.push(await measureFrame(page));
  }
  return {
    lum: mean(rows, r => r.lum), sat: mean(rows, r => r.sat), max: mean(rows, r => r.max),
    spread: mean(rows, r => r.spread), peak: mean(rows, r => r.peak), clipped: mean(rows, r => r.clipped),
  };
}

// Distance from the original, with the two things that actually distinguish it weighted up.
const miss = m =>
  Math.abs(m.lum - TARGET.lum) / 0.20 * 1.0
  + Math.abs(m.sat - TARGET.sat) / 0.20 * 0.6
  + Math.abs(m.max - TARGET.max) / 0.20 * 1.5
  + Math.abs(m.spread - TARGET.spread) / 2.0 * 1.5
  + Math.max(0, m.clipped - 1.5) * 0.4;

const results = [];
for (const exposure of [1.2, 1.5, 1.8]) {
  for (const contrast of [1.06, 1.18, 1.3]) {
    for (const [strength, threshold] of [[0.2, 1.1], [0.35, 0.8], [0.5, 0.6]]) {
      const setup = { tone: 'neutral', exposure, sun: 3.75, hemi: 1.78,
        grade: { contrast, saturation: 1.14, strength, threshold } };
      const m = await measure(setup);
      results.push({ setup, m, miss: miss(m) });
      console.log(line(`exp ${exposure} con ${contrast} bloom ${strength}/${threshold}`, m) + `  miss ${miss(m).toFixed(2)}`);
    }
  }
}
results.sort((a, b) => a.miss - b.miss);
console.log('\nclosest to the original:');
for (const r of results.slice(0, 4)) {
  const g = r.setup.grade;
  console.log(`  miss ${r.miss.toFixed(2)}  exposure ${r.setup.exposure} contrast ${g.contrast} bloom ${g.strength}/${g.threshold}` +
    `  (lum ${r.m.lum.toFixed(3)} sat ${r.m.sat.toFixed(3)} max ${r.m.max.toFixed(3)} spread ${r.m.spread.toFixed(1)})`);
}
console.log(`  target        lum ${TARGET.lum} sat ${TARGET.sat} max ${TARGET.max} spread ${TARGET.spread}`);
await browser.close();
