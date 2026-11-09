#!/usr/bin/env node
// Playwright pass over every dist/ page (sitemap + 404), FR and EN, at 375 and 1440 px.
// Usage: python3 -m http.server -d dist 8150 & node scripts/verify.mjs [http://localhost:8150] [--shots dir]
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(join(process.execPath, '../../lib/node_modules/playwright')); }
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const BASE = (process.argv.find((a) => a.startsWith('http')) || 'http://localhost:8150').replace(/\/$/, '');
const shotsIdx = process.argv.indexOf('--shots');
const SHOTS = shotsIdx > 0 ? process.argv[shotsIdx + 1] : null;
const SITE = JSON.parse(readFileSync(join(ROOT, 'content/settings.json'), 'utf8')).fr.site_url.replace(/\/$/, '');

const sitemap = readFileSync(join(DIST, 'sitemap.xml'), 'utf8');
const pages = [...new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(SITE, '') || '/'))];
pages.push('/404.html');
const problems = [];
const fail = (where, msg) => problems.push(`${where}: ${msg}`);
const links = new Set();
const titles = new Map();
const descs = new Map();

const browser = await playwright.chromium.launch();
for (const width of [375, 1440]) {
  const context = await browser.newContext({ viewport: { width, height: width < 500 ? 812 : 900 }, reducedMotion: 'reduce' });
  for (const path of pages) {
    const page = await context.newPage();
    const where = `${path} @${width}`;
    page.on('console', (m) => { if (m.type() === 'error') fail(where, `console: ${m.text()}`); });
    page.on('pageerror', (e) => fail(where, `pageerror: ${e.message}`));
    page.on('response', (r) => { if (r.url().startsWith(BASE) && r.status() >= 400) fail(where, `${r.status()} ${r.url().replace(BASE, '')}`); });
    const res = await page.goto(BASE + path, { waitUntil: 'networkidle' });
    if (!res || res.status() !== 200) fail(where, `status ${res && res.status()}`);
    const r = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll('img')];
      const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => { try { JSON.parse(s.textContent); return null; } catch (e) { return e.message; } });
      return {
        lang: document.documentElement.lang,
        h1: document.querySelectorAll('h1').length,
        noAlt: imgs.filter((i) => !i.hasAttribute('alt')).map((i) => i.getAttribute('src')),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        wide: [...document.querySelectorAll('body *')].filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1 && getComputedStyle(el).position !== 'fixed').slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${el.className}`),
        title: document.title,
        desc: document.querySelector('meta[name="description"]')?.content || '',
        ldErrors: ld.filter(Boolean),
        hrefs: [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')),
      };
    });
    if (!/^(fr|en)-CA$/.test(r.lang)) fail(where, `lang="${r.lang}"`);
    if (r.h1 !== 1) fail(where, `${r.h1} <h1>`);
    if (r.noAlt.length) fail(where, `img without alt: ${r.noAlt.join(', ')}`);
    if (r.overflow > 0) fail(where, `horizontal overflow ${r.overflow}px (${r.wide.join(', ')})`);
    if (r.ldErrors.length) fail(where, `invalid JSON-LD: ${r.ldErrors.join('; ')}`);
    if (width === 375 && path !== '/404.html') {
      if (titles.has(r.title)) fail(where, `duplicate title (also ${titles.get(r.title)})`); else titles.set(r.title, path);
      if (descs.has(r.desc)) fail(where, `duplicate description (also ${descs.get(r.desc)})`); else descs.set(r.desc, path);
      if (!r.desc) fail(where, 'no meta description');
    }
    for (const h of r.hrefs) if (h.startsWith('/') && !h.startsWith('//')) links.add(h.split('#')[0]);
    if (SHOTS && /\/(evenements|events)\/$/.test(path)) {
      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: join(SHOTS, `${path.split('/')[1]}-events-${width}.png`), fullPage: true });
    }
    await page.close();
  }
  await context.close();
}
await browser.close();

for (const href of links) {
  const r = await fetch(BASE + href, { method: 'HEAD' });
  if (r.status >= 400) fail(href, `internal link ${r.status}`);
}

const ics = [];
const walk = (d) => readdirSync(d).forEach((f) => { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f.endsWith('.ics')) ics.push(p); });
walk(DIST);
for (const f of ics) {
  const where = f.replace(DIST, '');
  const b = readFileSync(f);
  const s = b.toString('utf8');
  if (s.replace(/\r\n/g, '').includes('\n')) fail(where, 'bare LF in .ics');
  if (!s.endsWith('\r\n')) fail(where, '.ics does not end with CRLF');
  if (s.split('\r\n').some((l) => Buffer.byteLength(l) > 75)) fail(where, 'line longer than 75 octets');
  const n = (s.match(/BEGIN:VEVENT/g) || []).length;
  if (n < 1 || n !== (s.match(/END:VEVENT/g) || []).length) fail(where, `VEVENT count ${n}`);
  if (/(calendrier|calendar)\.ics$/.test(f) && !/X-WR-CALNAME:/.test(s)) fail(where, 'feed without X-WR-CALNAME');
}

console.log(`${pages.length} pages x 2 widths, ${links.size} internal links, ${ics.length} .ics files checked.`);
if (problems.length) { console.log(problems.join('\n')); process.exit(1); }
console.log('OK');
