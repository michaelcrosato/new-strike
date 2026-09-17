// Reads statistics off a rendered frame, reliably.
//
// Two earlier attempts at this were quietly wrong, and both failure modes are worth naming
// because they produce plausible numbers rather than errors:
//
//   - `drawImage(webglCanvas)` some milliseconds after the render returns black, because the
//     drawing buffer is cleared once it has been presented and the context was not created
//     with `preserveDrawingBuffer`.
//   - `drawImage(webgpuCanvas)` in a backgrounded tab returns the *last presented* frame, so
//     a whole sweep of settings comes back byte-identical and looks like "the lights do
//     nothing" rather than like a broken measurement.
//
// A Playwright screenshot is the composited page, so it sidesteps both. It comes back as
// PNG, which Node cannot decode without a dependency — so it goes back into the page, where
// the browser decodes it and the pixels are counted there.

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{lum:number,sat:number,max:number,spread:number,peak:number,clipped:number,hist:number[]}>}
 */
export async function measureFrame(page) {
  // A centred crop, not the whole page. Both games hold their interface at the edges and in
  // the corners, so measuring the full frame folds the HUD's own dark panels and bright text
  // into the numbers — and the two games have different amounts of it, which makes comparing
  // them meaningless. The middle of the screen is world in both.
  const box = await page.evaluate(() => ({
    x: Math.round(innerWidth * 0.26), y: Math.round(innerHeight * 0.22),
    width: Math.round(innerWidth * 0.48), height: Math.round(innerHeight * 0.52),
  }));
  const shot = await page.screenshot({ type: 'png', clip: box });
  return page.evaluate(async data => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + data;
    await image.decode();
    const w = 440, h = Math.max(1, Math.round(440 * image.height / image.width));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    let lum = 0, sat = 0, n = 0, max = -1;
    const hist = new Array(8).fill(0);
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      lum += l; sat += mx > 0 ? (mx - mn) / mx : 0; n++;
      if (l > max) max = l;
      hist[Math.min(7, Math.floor(l * 8))]++;
    }
    const share = hist.map(v => 100 * v / n);
    return {
      lum: lum / n, sat: sat / n, max,
      // How many brightness buckets carry a real share of the frame. This is the flatness
      // measure: everything in two buckets is a pale wash however bright it is.
      spread: share.filter(v => v > 4).length,
      peak: Math.max(...share),
      clipped: share[7],
      hist: share.map(v => +v.toFixed(1)),
    };
  }, shot.toString('base64'));
}

export const line = (label, m) =>
  `${label.padEnd(30)} lum ${m.lum.toFixed(3)}  sat ${m.sat.toFixed(3)}  max ${m.max.toFixed(3)}` +
  `  spread ${m.spread.toFixed(1)}  peakBucket ${m.peak.toFixed(0)}%  clipped ${m.clipped.toFixed(1)}%`;

export const mean = (rows, f) => rows.reduce((a, r) => a + f(r), 0) / rows.length;
