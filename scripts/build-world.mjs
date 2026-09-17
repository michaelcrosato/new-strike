// Builds MERCENARY STRIKE into a single file. This is the game, so it is also what the
// site serves at its root; the BLOCKHAWK campaign it grew out of keeps its own page.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

await mkdir('dist', { recursive: true });
// Everything that imports bare `three` is pointed at the WebGPU build, including the
// addons. Without this the bundle would carry two copies of three — the WebGL one for
// terrain and the addons, the WebGPU one for the renderer — with two sets of class
// identities that do not recognise each other's geometry. Only the exact specifier is
// redirected, so `three/tsl` and `three/addons/*` still resolve normally.
const oneThree = {
  name: 'single-three',
  setup(build) {
    build.onResolve({ filter: /^three$/ }, () => ({
      path: fileURLToPath(import.meta.resolve('three/webgpu')),
    }));
  },
};

const result = await build({
  entryPoints: ['src/mercenary.js'], bundle: true, minify: true, write: false,
  // An ES module, not an IIFE: the renderer has to await its WebGPU adapter before anything
  // can be drawn, and top-level await is not expressible in an IIFE.
  format: 'esm', target: ['es2022'], legalComments: 'inline',
  plugins: [oneThree],
});
let shell = await readFile('src/world-shell.html', 'utf8');
const favicon = 'data:image/svg+xml,' + encodeURIComponent((await readFile('assets/favicon.svg', 'utf8')).trim());
shell = shell.replace('__FAVICON__', () => favicon);
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
for (const [from, to] of [['assets/favicon.ico', 'dist/favicon.ico'], ['assets/icon-180.png', 'dist/apple-touch-icon.png'],
  ['assets/icon-512.png', 'dist/icon-512.png'], ['assets/og.jpg', 'dist/og.jpg']]) await copyFile(from, to);
// The same file under three names: the game's own page, the site root, and the root of the
// repository so the checkout opens on the game too.
for (const path of ['dist/world.html', 'dist/index.html', 'index.html']) await writeFile(path, html);
console.log(`Built dist/world.html, dist/index.html and index.html (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB). All assets embedded; no network requests.`);
