// Usage: NODE_PATH=$(npm root -g) node scripts/verify.mjs [port]  (serve dist/ first)
import { createRequire } from 'node:module';
import { readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.argv[2] || 8110;
const BASE = `http://localhost:${PORT}`;
const pages = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (!p.includes('/admin')) walk(p); } else if (f === 'index.html') pages.push('/' + p.slice(join(ROOT, 'dist').length + 1).replace(/index\.html$/, ''));
  }
})(join(ROOT, 'dist'));
pages.sort();

const browser = await chromium.launch();
const problems = [];
const linkSet = new Set();
for (const width of [375, 1440]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  for (const path of pages) {
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push(String(e)));
    page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(BASE)) errs.push(`${r.status()} ${r.url()}`); });
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
    const r = await page.evaluate(() => ({
      h1: document.querySelectorAll('h1').length,
      noAlt: Array.from(document.querySelectorAll('img')).filter((i) => !i.hasAttribute('alt')).map((i) => i.src),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      title: document.title,
      desc: document.querySelector('meta[name=description]')?.content || '',
      canonical: document.querySelector('link[rel=canonical]')?.href || '',
      hreflang: document.querySelectorAll('link[rel=alternate][hreflang]').length,
      links: Array.from(document.querySelectorAll('a[href]')).map((a) => a.getAttribute('href')).filter((h) => h.startsWith('/')),
      inlineScripts: Array.from(document.querySelectorAll('script:not([src])')).filter((s) => s.type !== 'application/ld+json').length,
      styleAttrs: document.querySelectorAll('[style]').length,
    }));
    r.links.forEach((l) => linkSet.add(l.split('#')[0].split('?')[0]));
    const tag = `${width}px ${path}`;
    if (errs.length) problems.push(`${tag}: console/network errors: ${errs.join(' | ')}`);
    if (r.h1 !== 1) problems.push(`${tag}: ${r.h1} h1`);
    if (r.noAlt.length) problems.push(`${tag}: img without alt ${r.noAlt.join(', ')}`);
    if (r.overflow > 0) problems.push(`${tag}: horizontal overflow ${r.overflow}px`);
    if (!r.title || !r.desc || !r.canonical) problems.push(`${tag}: missing title/description/canonical`);
    if (path !== '/' && path !== '/404.html' && r.hreflang < 3) problems.push(`${tag}: hreflang count ${r.hreflang}`);
    if (r.inlineScripts) problems.push(`${tag}: ${r.inlineScripts} inline scripts`);
    await page.close();
  }
  await ctx.close();
}
// internal link + asset check
for (const l of linkSet) {
  const res = await fetch(BASE + l);
  if (res.status >= 400) problems.push(`broken internal link ${l} (${res.status})`);
}
// unique titles
await browser.close();
console.log(`Checked ${pages.length} pages x 2 widths, ${linkSet.size} internal links.`);
console.log(problems.length ? problems.join('\n') : 'ALL CHECKS PASSED');
process.exit(problems.length ? 1 : 0);
