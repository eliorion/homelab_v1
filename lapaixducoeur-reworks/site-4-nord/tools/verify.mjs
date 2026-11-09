#!/usr/bin/env node
// End-to-end check of dist/ (served by tools/serve.mjs) with Playwright, at 375 px and 1440 px.
// Usage: node tools/serve.mjs 8140 & node tools/verify.mjs [http://localhost:8140] [--shots dir]
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(join(process.execPath, '../../lib/node_modules/playwright')); }
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv.find((a) => a.startsWith('http')) || 'http://localhost:8140';
const shotsIdx = process.argv.indexOf('--shots');
const SHOTS = shotsIdx > 0 ? process.argv[shotsIdx + 1] : null;
const SITE = 'https://lapaixducoeur.ca';

const sitemap = readFileSync(join(ROOT, 'dist/sitemap.xml'), 'utf8');
const pages = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(SITE, ''));
const problems = [];
const fail = (where, msg) => problems.push(`${where}: ${msg}`);
const links = new Set();
const alternates = {};

const browser = await playwright.chromium.launch();
for (const width of [375, 1440]) {
  const context = await browser.newContext({ viewport: { width, height: width < 500 ? 812 : 900 }, deviceScaleFactor: 1 });
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
      return {
        h1: document.querySelectorAll('h1').length,
        noAlt: imgs.filter((i) => !i.hasAttribute('alt')).map((i) => i.src),
        noSize: imgs.filter((i) => !i.getAttribute('width') || !i.getAttribute('height')).map((i) => i.src),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        title: document.title, desc: document.querySelector('meta[name=description]')?.content || '',
        canonical: document.querySelector('link[rel=canonical]')?.href || '',
        lang: document.documentElement.lang,
        alts: Object.fromEntries([...document.querySelectorAll('link[rel=alternate][hreflang]')].map((l) => [l.hreflang, l.getAttribute('href')])),
        links: [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).filter((h) => h.startsWith('/') && !h.startsWith('//')),
        ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => { try { const j = JSON.parse(s.textContent); return (j['@graph'] || [j]).map((n) => n['@type']); } catch { return ['INVALID']; } }).flat(),
        skip: !!document.querySelector('.skip-link'),
        unlabeled: [...document.querySelectorAll('input:not([type=hidden]):not([type=radio]):not([type=checkbox]), select, textarea')].filter((el) => !el.labels?.length && !el.getAttribute('aria-label')).map((el) => el.name),
        inlineScripts: [...document.querySelectorAll('script:not([src])')].filter((s) => !/json/.test(s.type)).length,
        jsBytes: performance.getEntriesByType('resource').filter((e) => e.initiatorType === 'script').reduce((a, e) => a + (e.encodedBodySize || 0), 0),
      };
    });
    if (r.h1 !== 1) fail(where, `${r.h1} h1`);
    if (r.noAlt.length) fail(where, `img without alt: ${r.noAlt.join(', ')}`);
    if (r.noSize.length) fail(where, `img without width/height: ${r.noSize.join(', ')}`);
    if (width === 375 && r.overflow > 0) fail(where, `horizontal overflow ${r.overflow}px`);
    if (!r.title || !r.desc || !r.canonical) fail(where, 'missing title/description/canonical');
    if (!r.skip && path !== '/') fail(where, 'no skip link');
    if (r.unlabeled.length) fail(where, `unlabeled fields: ${r.unlabeled.join(', ')}`);
    if (r.inlineScripts) fail(where, 'inline executable script');
    if (r.jsBytes > 30000) fail(where, `JS ${r.jsBytes} bytes`);
    if (r.ld.includes('INVALID')) fail(where, 'invalid JSON-LD');
    if (path !== '/' && !r.ld.includes('NGO')) fail(where, 'no NGO JSON-LD');
    if (path !== '/' && !['/fr/', '/en/'].includes(path) && !r.ld.includes('BreadcrumbList')) fail(where, 'no BreadcrumbList');
    if (/\/(evenements|events)\/[^/]+\/$/.test(path) && !r.ld.includes('Event')) fail(where, 'no Event JSON-LD');
    if (/\/(nouvelles|news)\/[^/]+\/$/.test(path) && !r.ld.includes('NewsArticle')) fail(where, 'no NewsArticle JSON-LD');
    if (!r.alts['fr-CA'] || !r.alts['en-CA'] || !r.alts['x-default']) fail(where, 'missing hreflang');
    if (width === 375) { alternates[path] = r.alts; r.links.forEach((l) => links.add(l.split('#')[0])); }
    if (SHOTS && width === 1440) { /* screenshots handled separately */ }
    await page.close();
  }
  await context.close();
}

// hreflang reciprocity
for (const [path, alts] of Object.entries(alternates)) {
  for (const lang of ['fr-CA', 'en-CA']) {
    const target = alts[lang].replace(SITE, '');
    const back = alternates[target];
    if (!back) { fail(path, `hreflang ${lang} -> ${target} not in sitemap`); continue; }
    if (back['fr-CA'] !== alts['fr-CA'] || back['en-CA'] !== alts['en-CA']) fail(path, `hreflang not reciprocal with ${target}`);
  }
}
// internal links and assets
const ctx = await browser.newContext();
for (const l of links) {
  const res = await ctx.request.get(BASE + l, { maxRedirects: 0 });
  if (res.status() !== 200) fail('link', `${res.status()} ${l}`);
}
await browser.close();

console.log(`Checked ${pages.length} pages x 2 widths, ${links.size} internal links.`);
if (problems.length) { console.log(`${problems.length} problem(s):\n` + [...new Set(problems)].join('\n')); process.exit(1); }
console.log('All checks passed.');
