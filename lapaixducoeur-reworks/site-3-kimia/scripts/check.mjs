#!/usr/bin/env node
// QA pass over dist/: static link/SEO checks, then Playwright at 375 and 1440 px on every page.
// Usage: node scripts/serve.mjs 8130 & node scripts/check.mjs [http://localhost:8130]
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const BASE = process.argv[2] || 'http://localhost:8130';
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const pages = walk(DIST).filter((f) => f.endsWith('.html') && !f.includes('/admin/')).map((f) => `/${relative(DIST, f)}`.replace(/index\.html$/, ''));
const problems = [];
const fail = (where, msg) => problems.push(`${where}: ${msg}`);
const exists = (p) => { const f = join(DIST, decodeURIComponent(p.split('#')[0].split('?')[0])); return existsSync(f) && (statSync(f).isFile() || existsSync(join(f, 'index.html'))); };

// static checks
const titles = new Map(), descs = new Map();
for (const p of pages) {
  const html = readFileSync(join(DIST, p.endsWith('/') ? `${p}index.html` : p), 'utf8');
  for (const [, href] of html.matchAll(/(?:href|src)="(\/[^"]*)"/g)) if (!exists(href)) fail(p, `broken internal ref ${href}`);
  for (const [, set] of html.matchAll(/srcset="([^"]+)"/g)) for (const part of set.split(',')) { const u = part.trim().split(' ')[0]; if (u.startsWith('/') && !exists(u)) fail(p, `broken srcset ${u}`); }
  if (p.includes('404')) continue;
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1];
  const desc = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1];
  if (!title) fail(p, 'no title'); else { if (titles.has(title)) fail(p, `duplicate title with ${titles.get(title)}`); titles.set(title, p); }
  if (!desc) fail(p, 'no description'); else { if (descs.has(desc)) fail(p, `duplicate description with ${descs.get(desc)}`); descs.set(desc, p); }
  if (!/<link rel="canonical"/.test(html)) fail(p, 'no canonical');
  if (!/og:title/.test(html)) fail(p, 'no og');
  if (p !== '/' && !/"@type":"NGO"/.test(html)) fail(p, 'no NGO ld');
  if (p !== '/' && !/DonateAction/.test(html)) fail(p, 'no DonateAction');
  if (p !== '/' && !['/fr/', '/en/'].includes(p) && !/BreadcrumbList/.test(html)) fail(p, 'no BreadcrumbList');
  if (/<script(?![^>]*(src=|application\/ld\+json))/.test(html)) fail(p, 'inline script');
  if (/\sstyle="/.test(html)) fail(p, 'inline style attribute');
  const alts = [...html.matchAll(/hreflang="(fr-CA|en-CA|x-default)" href="https:\/\/lapaixducoeur\.ca([^"]+)"/g)];
  if (alts.length !== 3) fail(p, `hreflang count ${alts.length}`);
  for (const [, , target] of alts) {
    if (!exists(target)) { fail(p, `hreflang target missing ${target}`); continue; }
    const other = readFileSync(join(DIST, target.endsWith('/') ? `${target}index.html` : target), 'utf8');
    if (!other.includes(`href="https://lapaixducoeur.ca${p}"`)) fail(p, `hreflang not reciprocal from ${target}`);
  }
}
console.log(`static: ${pages.length} pages checked`);

// browser checks
const browser = await chromium.launch();
for (const vw of [375, 1440]) {
  const ctx = await browser.newContext({ viewport: { width: vw, height: 900 }, deviceScaleFactor: 1 });
  for (const p of pages) {
    const page = await ctx.newPage();
    const where = `${p} @${vw}`;
    page.on('console', (m) => { if (m.type() === 'error') fail(where, `console: ${m.text()}`); });
    page.on('pageerror', (e) => fail(where, `pageerror: ${e.message}`));
    page.on('response', (r) => { if (r.url().startsWith(BASE) && r.status() >= 400 && !p.includes('404')) fail(where, `${r.status()} ${r.url()}`); });
    await page.goto(BASE + p, { waitUntil: 'networkidle' });
    const r = await page.evaluate(() => ({
      h1: document.querySelectorAll('h1').length,
      noAlt: [...document.images].filter((i) => !i.hasAttribute('alt')).map((i) => i.src),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      wide: [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1 && getComputedStyle(e).position !== 'fixed' && !e.closest('.tl-years,.thread,dialog')).slice(0, 3).map((e) => `${e.tagName}.${e.className}`),
      lang: document.documentElement.lang,
    }));
    if (r.h1 !== 1) fail(where, `${r.h1} h1`);
    if (r.noAlt.length) fail(where, `img without alt ${r.noAlt.join(', ')}`);
    if (r.overflow > 0) fail(where, `horizontal overflow ${r.overflow}px (${r.wide.join(', ')})`);
    if (!r.lang) fail(where, 'no lang');
    await page.close();
  }
  await ctx.close();
}
await browser.close();
if (problems.length) { console.log(problems.join('\n')); console.log(`\n${problems.length} problem(s)`); process.exit(1); }
console.log('browser: all pages clean at 375 and 1440 px');
