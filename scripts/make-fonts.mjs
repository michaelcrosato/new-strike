// Subsets the three embedded faces to the characters the interface can actually show.
// Not part of `npm run build`: it needs uv + fontTools. Run it when the interface gains new
// characters, then commit assets/fonts/, so the game build stays node-only.
import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Every printable ASCII character, the two separators toLocaleString can emit in other
// locales, and the typographic marks the interface uses. Deliberately generous: a character
// missing from the subset would render as a blank box with no network fallback available.
let chars = '';
for (let c = 32; c < 127; c++) chars += String.fromCharCode(c);
chars += '  ' + '·×°©′’‘“”–—…↗↑→↓◇◆△▲▼✧✣♙⌖┆';

const charFile = join(tmpdir(), 'blockhawk-subset-chars.txt');
writeFileSync(charFile, chars, 'utf8');
mkdirSync('assets/fonts', { recursive: true });

const faces = [
  ['node_modules/@fontsource/barlow/files/barlow-latin-400-normal.woff2', 'assets/fonts/barlow-400.woff2'],
  ['node_modules/@fontsource/barlow/files/barlow-latin-600-normal.woff2', 'assets/fonts/barlow-600.woff2'],
  ['node_modules/@fontsource/barlow-condensed/files/barlow-condensed-latin-900-normal.woff2', 'assets/fonts/barlow-condensed-900.woff2'],
];
let before = 0, after = 0;
for (const [from, to] of faces) {
  execFileSync('uv', ['run', '--with', 'fonttools', '--with', 'brotli', 'pyftsubset', from,
    `--text-file=${charFile}`, '--flavor=woff2', '--layout-features=', '--no-hinting',
    '--desubroutinize', `--output-file=${to}`], { stdio: 'inherit' });
  before += statSync(from).size; after += statSync(to).size;
  console.log(`${to}  ${statSync(from).size} -> ${statSync(to).size} bytes`);
}
console.log(`total ${before} -> ${after} bytes (-${Math.round(100 - 100 * after / before)}%), ${chars.length} characters kept`);
