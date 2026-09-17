import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

const root = process.cwd();
const port = Number(process.env.PORT || 4189);
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  // Resolved the way the deployment resolves it: dist is the site root, so /blockhawk.html
  // means dist/blockhawk.html here exactly as it does live. The repository root is a
  // fallback, which keeps /dist/world.html working for anything that links to it directly.
  const path = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const candidates = [resolve(root, 'dist' + path), resolve(root, '.' + path)];
  if (candidates.some(file => !file.startsWith(root + '\\') && !file.startsWith(root + '/'))) {
    res.writeHead(403); res.end(); return;
  }
  try {
    let body = null, file = candidates[0];
    for (const candidate of candidates) {
      try { body = await readFile(candidate); file = candidate; break; } catch {}
    }
    if (!body) throw new Error('not found');
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }[extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, '0.0.0.0', () => console.log(`MERCENARY STRIKE ready at http://localhost:${port}`));
