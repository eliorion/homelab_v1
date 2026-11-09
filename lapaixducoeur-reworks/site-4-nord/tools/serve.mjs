#!/usr/bin/env node
// Preview server for dist/ that mimics Cloudflare Pages: pretty URLs, 404.html and the _headers file
// (including "! Header" detach rules), so the real CSP is exercised locally. Usage: node tools/serve.mjs [port]
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const PORT = Number(process.argv[2] || process.env.PORT || 8140);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.xml': 'application/xml; charset=utf-8', '.ics': 'text/calendar; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.yml': 'text/yaml; charset=utf-8' };

const rules = [];
let cur = null;
for (const line of readFileSync(join(DIST, '_headers'), 'utf8').split('\n')) {
  if (!line.trim() || line.trim().startsWith('#')) continue;
  if (!/^\s/.test(line)) { cur = { re: new RegExp('^' + line.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'), set: [], detach: [] }; rules.push(cur); continue; }
  const t = line.trim();
  if (t.startsWith('!')) cur.detach.push(t.slice(1).trim().toLowerCase());
  else { const i = t.indexOf(':'); cur.set.push([t.slice(0, i).trim(), t.slice(i + 1).trim()]); }
}
const headersFor = (path) => {
  const h = new Map();
  for (const r of rules) {
    if (!r.re.test(path)) continue;
    r.detach.forEach((k) => h.delete(k));
    for (const [k, v] of r.set) { const key = k.toLowerCase(); h.set(key, h.has(key) ? [h.get(key)[0], `${h.get(key)[1]}, ${v}`] : [k, v]); }
  }
  return [...h.values()];
};

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let path = decodeURIComponent(url.pathname);
  let file = normalize(join(DIST, path));
  if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
  if (existsSync(file) && statSync(file).isDirectory()) {
    if (!path.endsWith('/')) { res.writeHead(301, { Location: path + '/' + url.search }).end(); return; }
    file = join(file, 'index.html');
  }
  let status = 200;
  if (!existsSync(file)) { status = 404; file = join(DIST, '404.html'); path = '/404.html'; }
  const headers = Object.fromEntries(headersFor(url.pathname));
  headers['Content-Type'] = headers['Content-Type'] || TYPES[extname(file)] || 'application/octet-stream';
  delete headers['Strict-Transport-Security'];
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : readFileSync(file));
}).listen(PORT, () => console.log(`dist/ on http://localhost:${PORT}`));
