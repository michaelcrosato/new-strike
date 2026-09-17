// Builds the open-world harness into a single file, the same way the game builds.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
const result = await build({
  entryPoints: ['src/mercenary.js'], bundle: true, minify: true, write: false,
  format: 'iife', target: ['es2022'], legalComments: 'inline',
});
let shell = await readFile('src/world-shell.html', 'utf8');
const fonts = [
  ['Barlow', 400, 'assets/fonts/barlow-400.woff2'],
  ['Barlow', 600, 'assets/fonts/barlow-600.woff2'],
  ['Barlow Condensed', 900, 'assets/fonts/barlow-condensed-900.woff2'],
];
let css = '';
for (const [family, weight, path] of fonts) {
  const data = await readFile(path);
  css += `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;font-display:swap;src:url(data:font/woff2;base64,${data.toString('base64')}) format('woff2')}\n`;
}
const html = shell
  .replace('/* INLINE_STYLE */', () => css)
  // A function replacement, because the bundle contains '$&' and a string replacement
  // would treat it as the matched-substring pattern.
  .replace('/* INLINE_GAME */', () => result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script'));
await writeFile('dist/world.html', html);
console.log(`Built dist/world.html (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB).`);
