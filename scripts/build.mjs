import { build } from 'esbuild';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
const result = await build({
  entryPoints: ['src/main.js'], bundle: true, minify: true, write: false,
  format: 'iife', target: ['es2022'], legalComments: 'inline',
});
let shell = await readFile('src/shell.html', 'utf8');
const favicon = 'data:image/svg+xml,' + encodeURIComponent((await readFile('assets/favicon.svg', 'utf8')).trim());
shell = shell.replace('__FAVICON__', favicon);
let css = await readFile('src/style.css', 'utf8');
// Subset faces from assets/fonts, produced by scripts/make-fonts.mjs.
const fonts = [
  ['Barlow',400,'assets/fonts/barlow-400.woff2'],
  ['Barlow',600,'assets/fonts/barlow-600.woff2'],
  ['Barlow Condensed',900,'assets/fonts/barlow-condensed-900.woff2'],
];
for (const [family,weight,path] of fonts) {
  const data = await readFile(path);
  css = `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;font-display:swap;src:url(data:font/woff2;base64,${data.toString('base64')}) format('woff2')}\n` + css;
}
const notices = await Promise.all(['node_modules/three/LICENSE','node_modules/@fontsource/barlow/LICENSE','node_modules/@fontsource/barlow-condensed/LICENSE'].map(path=>readFile(path,'utf8')));
await writeFile('THIRD_PARTY_NOTICES.txt',notices.join('\n\n'));
const html = shell.replace('/* INLINE_STYLE */', css).replace('/* INLINE_GAME */', result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')).replace('</body>',`<script type="text/plain" id="third-party-notices">${notices.join('\n\n')}</script>\n</body>`);
await writeFile('dist/blockhawk.html', html);
// Served by convention next to the game: browsers request /favicon.ico and iOS looks for
// /apple-touch-icon.png without any markup, and crawlers follow og:image.
for (const [from, to] of [['assets/favicon.ico','dist/favicon.ico'],['assets/icon-180.png','dist/apple-touch-icon.png'],['assets/icon-512.png','dist/icon-512.png'],['assets/og.jpg','dist/og.jpg']]) await copyFile(from, to);
await writeFile('dist/index.html', html);
await writeFile('index.html', html);
console.log(`Built dist/blockhawk.html, dist/index.html and index.html (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB). All assets embedded; no network requests.`);
