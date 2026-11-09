// Zero-dependency static server for dist/ that applies dist/_headers (incl. CSP), like Cloudflare Pages.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const PORT = +(process.argv[2] || 8120);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.xml': 'application/xml', '.ics': 'text/calendar; charset=utf-8', '.txt': 'text/plain', '.yml': 'text/yaml' };

const rules = [];
let cur = null;
for (const line of fs.readFileSync(path.join(DIST, '_headers'), 'utf8').split('\n')) {
  if (!line.trim() || line.trim().startsWith('#')) continue;
  if (!/^\s/.test(line)) { cur = { pat: new RegExp('^' + line.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'), set: [] }; rules.push(cur); continue; }
  const t = line.trim();
  if (t.startsWith('!')) cur.set.push([t.slice(1).trim(), null]);
  else { const i = t.indexOf(':'); cur.set.push([t.slice(0, i).trim(), t.slice(i + 1).trim()]); }
}
function headersFor(p) {
  const h = {};
  for (const r of rules) if (r.pat.test(p)) for (const [k, v] of r.set) { if (v === null) delete h[k.toLowerCase()]; else h[k.toLowerCase()] = v; }
  delete h['strict-transport-security'];
  if (h['content-security-policy']) h['content-security-policy'] = h['content-security-policy'].replace(/;\s*upgrade-insecure-requests/, '');
  return h;
}

http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(DIST, url);
  if (!file.startsWith(DIST)) { res.writeHead(400); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  let status = 200;
  if (!fs.existsSync(file)) { status = 404; file = path.join(DIST, '404.html'); }
  const h = { ...headersFor(url), 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' };
  const body = fs.readFileSync(file);
  const range = req.headers.range && /bytes=(\d+)-(\d*)/.exec(req.headers.range);
  if (range && status === 200) {
    const start = +range[1], end = range[2] ? +range[2] : body.length - 1;
    res.writeHead(206, { ...h, 'content-range': `bytes ${start}-${end}/${body.length}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 });
    return res.end(body.subarray(start, end + 1));
  }
  res.writeHead(status, { ...h, 'accept-ranges': 'bytes', 'content-length': body.length });
  res.end(body);
}).listen(PORT, () => console.log(`Serving dist/ with _headers on http://localhost:${PORT}`));
