import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
const result = await build({
  entryPoints: ['src/main.js'], bundle: true, minify: true, write: false,
  format: 'iife', target: ['es2022'], legalComments: 'inline',
});
const shell = await readFile('src/shell.html', 'utf8');
let css = await readFile('src/style.css', 'utf8');
const fonts = [
  ['Barlow',400,'barlow/files/barlow-latin-400-normal.woff2'],
  ['Barlow',600,'barlow/files/barlow-latin-600-normal.woff2'],
  ['Barlow Condensed',900,'barlow-condensed/files/barlow-condensed-latin-900-normal.woff2'],
];
for (const [family,weight,path] of fonts) {
  const data = await readFile('node_modules/@fontsource/'+path);
  css = `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;font-display:swap;src:url(data:font/woff2;base64,${data.toString('base64')}) format('woff2')}\n` + css;
}
const notices = await Promise.all(['node_modules/three/LICENSE','node_modules/@fontsource/barlow/LICENSE','node_modules/@fontsource/barlow-condensed/LICENSE'].map(path=>readFile(path,'utf8')));
await writeFile('THIRD_PARTY_NOTICES.txt',notices.join('\n\n'));
const html = shell.replace('/* INLINE_STYLE */', css).replace('/* INLINE_GAME */', result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')).replace('</body>',`<script type="text/plain" id="third-party-notices">${notices.join('\n\n')}</script>\n</body>`);
await writeFile('dist/blockhawk.html', html);
await writeFile('dist/index.html', html);
await writeFile('index.html', html);
console.log(`Built dist/blockhawk.html, dist/index.html and index.html (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB). All assets embedded; no network requests.`);
