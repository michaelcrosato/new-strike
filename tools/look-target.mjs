// What does the original actually measure? The campaign is the look MERCENARY STRIKE is
// returning to, so rather than guess at "upbeat", this reads the same statistics off
// BLOCKHAWK and prints them as a target to tune against.
import { chromium } from '@playwright/test';
import { measureFrame, line, mean } from './frame-stats.mjs';

const base = process.env.BASE ?? 'http://127.0.0.1:4189';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.error('PAGE ERROR', e.message));

await page.goto(`${base}/blockhawk.html?test`);
await page.waitForFunction(() => window.blockhawk?.getPerformance().ready, null, { timeout: 40000 });
await page.locator('#deploy-button').click();
await page.waitForTimeout(1200);
const shots = [];
for (const [x, z] of [[-72, 60], [0, 0], [-99, 111], [40, -40]]) {
  await page.evaluate(([px, pz]) => window.blockhawk.test.position(px, pz), [x, z]);
  await page.waitForTimeout(450);
  shots.push(await measureFrame(page));
}
console.log('\nBLOCKHAWK — the original look, the target to tune against:');
console.log(line('  averaged over four places', {
  lum: mean(shots, s => s.lum), sat: mean(shots, s => s.sat), max: mean(shots, s => s.max),
  spread: mean(shots, s => s.spread), peak: mean(shots, s => s.peak), clipped: mean(shots, s => s.clipped),
}));
console.log('  histogram at the first:', shots[0].hist.join(' / '));
await browser.close();
