#!/usr/bin/env node
// Local preview of dist/ that applies dist/_headers like Cloudflare Pages, so CSP is exercised.
// Usage: node scripts/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const PORT = Number(process.argv[2] || 8130);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.xml': 'application/xml', '.ics': 'text/calendar; charset=utf-8', '.txt': 'text/plain', '.yml': 'text/yaml', '.webmanifest': 'application/manifest+json' };

const rules = [];
for (const block of (await readFile(join(DIST, '_headers'), 'utf8')).split(/\n(?=\S)/)) {
  const [pat, ...lines] = block.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
  if (!pat) continue;
  const re = new RegExp(`^${pat.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  rules.push({ re, lines: lines.map((l) => l.trim()) });
}
function headersFor(path) {
  const h = {};
  for (const r of rules) if (r.re.test(path)) for (const l of r.lines) {
    if (l.startsWith('! ')) { delete h[l.slice(2).toLowerCase()]; continue; }
    const i = l.indexOf(':');
    h[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
  }
  return h;
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let path = decodeURIComponent(url.pathname);
  let file = normalize(join(DIST, path));
  if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
  try {
    if ((await stat(file)).isDirectory()) {
      if (!path.endsWith('/')) { res.writeHead(301, { location: `${path}/` }).end(); return; }
      file = join(file, 'index.html');
    }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', ...headersFor(path) });
    res.end(body);
  } catch {
    const body = await readFile(join(DIST, path.startsWith('/en/') ? 'en/404.html' : '404.html'));
    res.writeHead(404, { 'content-type': TYPES['.html'], ...headersFor(path) });
    res.end(body);
  }
}).listen(PORT, () => console.log(`dist/ on http://localhost:${PORT} (with _headers)`));
