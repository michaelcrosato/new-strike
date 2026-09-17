// Regenerates the brand art in assets/ from the fonts the game already embeds.
// Not part of `npm run build`: it needs uv + fontTools + ImageMagick. Run it only when the
// mark changes, and commit the results, so the game build stays dependency-free.
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Outline of "B" in Barlow Condensed 900, taken straight from the embedded face
// (fontTools SVGPathPen, unitsPerEm 1000, glyph bbox x 26..468, y 0..700).
const B = 'M252 0H41Q34 0 30.0 4.0Q26 8 26 15V685Q26 692 30.0 696.0Q34 700 41 700H222Q331 700 392.5 651.0Q454 602 454 503Q454 411 397 366Q392 362 395 359Q468 303 468 197Q468 102 407.0 51.0Q346 0 252 0ZM214 533V433Q214 427 220 427H225Q270 427 270 483Q270 539 225 539H220Q214 539 214 533ZM280 225Q280 256 268.5 274.5Q257 293 238 293H220Q214 293 214 287V167Q214 161 220 161H237Q256 161 268.0 177.5Q280 194 280 225Z';
const ink = '#172b29', paper = '#edeedf', amber = '#f3b25e';

// scale 0.066 puts the 700-unit cap height at ~46px inside a 64px tile
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">`
  + `<rect width="64" height="64" fill="${ink}"/>`
  + `<rect x="5" y="5" width="54" height="54" fill="none" stroke="${paper}" stroke-opacity=".4" stroke-width="2"/>`
  + `<g transform="translate(28 35) scale(.0635 -.0635) translate(-247 -350)" fill="${paper}"><path d="${B}"/></g>`
  + `<path d="M46 14.5h8M50 10.5v8" stroke="${amber}" stroke-width="3.2" stroke-linecap="butt"/>`
  + `</svg>`;
writeFileSync('assets/favicon.svg', svg + '\n');

const magick = (...args) => execFileSync('magick', args, { stdio: 'inherit' });
magick('-background', 'none', 'assets/favicon.svg', '-resize', '512x512', 'assets/icon-512.png');
magick('-background', 'none', 'assets/favicon.svg', '-resize', '180x180', 'assets/icon-180.png');
magick('assets/icon-512.png', '-define', 'icon:auto-resize=48,32,16', 'assets/favicon.ico');
console.log(`assets/favicon.svg (${svg.length} bytes inline), icon-512.png, icon-180.png, favicon.ico`);
