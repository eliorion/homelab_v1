// Playwright check of every page, FR + EN, at 375 px and 1440 px.
// Usage: node tests/serve.mjs 8120 &  then  node tests/verify.cjs [port] [--shots]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PORT = process.argv[2] && /^\d+$/.test(process.argv[2]) ? process.argv[2] : '8120';
const ORIGIN = `http://localhost:${PORT}`;
const SHOTS = process.argv.includes('--shots');
const DIST = path.join(__dirname, '..', 'dist');
const sitemap = fs.readFileSync(path.join(DIST, 'sitemap.xml'), 'utf8');
const pages = ['/', ...[...sitemap.matchAll(/<loc>https:\/\/lapaixducoeur\.ca([^<]+)<\/loc>/g)].map((m) => m[1])];

(async () => {
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
  const browser = await chromium.launch({ proxy });
  const problems = [];
  const linkSet = new Set();
  let checked = 0;
  for (const width of [375, 1440]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
    for (const p of pages) {
      const page = await ctx.newPage();
      const errs = [];
      page.on('console', (m) => { if (m.type() === 'error') errs.push(`console: ${m.text()}`); });
      page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
      page.on('response', (r) => { if (r.url().startsWith(ORIGIN) && r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url()}`); });
      page.on('requestfailed', (r) => { const f = r.failure() && r.failure().errorText; if (r.url().startsWith(ORIGIN) && !(/\.mp3$/.test(r.url()) && /ABORTED/.test(f))) errs.push(`failed ${r.url()} ${r.failure() && r.failure().errorText}`); });
      const res = await page.goto(ORIGIN + p, { waitUntil: 'networkidle' });
      if (!res || res.status() !== 200) errs.push(`status ${res && res.status()}`);
      await page.evaluate(async () => {
        for (let y = 0; y < document.documentElement.scrollHeight; y += 600) { window.scrollTo({ top: y, behavior: 'instant' }); await new Promise((r) => setTimeout(r, 30)); }
        window.scrollTo({ top: 0, behavior: 'instant' });
      });
      await page.waitForTimeout(150);
      const info = await page.evaluate(() => {
        const out = {};
        out.h1 = document.querySelectorAll('h1').length;
        out.noAlt = [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).map((i) => i.src);
        out.overflow = document.documentElement.scrollWidth - window.innerWidth;
        out.wide = out.overflow > 0 ? [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.right > window.innerWidth + 1 && getComputedStyle(e).position !== 'fixed'; }).slice(0, 5).map((e) => `${e.tagName}.${e.className}`) : [];
        out.links = [...document.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => h.startsWith(location.origin));
        out.title = document.title;
        out.desc = (document.querySelector('meta[name=description]') || {}).content;
        out.canonical = (document.querySelector('link[rel=canonical]') || {}).href;
        out.alts = [...document.querySelectorAll('link[rel=alternate][hreflang]')].map((l) => `${l.hreflang}=${l.href}`);
        out.lang = document.documentElement.lang;
        out.switch = (document.querySelector('.lang-switch') || {}).href || null;
        out.ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => { try { return JSON.parse(s.textContent)['@graph'].map((g) => g['@type']); } catch (e) { return 'INVALID'; } });
        out.js = [...document.querySelectorAll('script[src]')].map((s) => s.src);
        return out;
      });
      if (info.h1 !== 1) errs.push(`h1 count ${info.h1}`);
      if (info.noAlt.length) errs.push(`img without alt: ${info.noAlt.join(', ')}`);
      if (width === 375 && info.overflow > 0) errs.push(`horizontal overflow ${info.overflow}px ${info.wide.join(' ')}`);
      if (!info.title || !info.desc) errs.push('missing title/description');
      if (p !== '/' && info.alts.length !== 3) errs.push(`hreflang count ${info.alts.length}`);
      if (JSON.stringify(info.ld).includes('INVALID')) errs.push('invalid JSON-LD');
      if (p !== '/' && !JSON.stringify(info.ld).includes('NGO')) errs.push('no NGO JSON-LD');
      if (info.switch) {
        const sw = new URL(info.switch).pathname;
        const altPaths = info.alts.map((a) => new URL(a.split('=').slice(1).join('=')).pathname);
        if (!altPaths.includes(sw)) errs.push(`lang switch ${sw} not in hreflang alternates`);
      }
      info.links.forEach((l) => linkSet.add(l.split('#')[0]));
      if (errs.length) problems.push(`[${width}] ${p}\n  - ${errs.join('\n  - ')}`);
      if (SHOTS && (p === '/fr/' || p === '/en/')) {
        await page.screenshot({ path: path.join(__dirname, '..', 'screenshots', `${p.replace(/\//g, '') || 'root'}-${width}.png`), fullPage: true });
      }
      checked++;
      await page.close();
    }
    await ctx.close();
  }
  // every internal link + linked asset resolves
  const ctx = await browser.newContext();
  for (const l of linkSet) {
    const r = await ctx.request.get(l);
    if (r.status() >= 400) problems.push(`broken link ${l} -> ${r.status()}`);
  }
  // JS weight per page
  const jsDir = path.join(DIST, 'assets/js');
  const jsTotal = fs.readdirSync(jsDir).reduce((s, f) => s + fs.statSync(path.join(jsDir, f)).size, 0);
  await browser.close();
  console.log(`Checked ${checked} page loads (${pages.length} URLs x 2 widths), ${linkSet.size} internal links. Total JS (all files): ${(jsTotal / 1024).toFixed(1)} KB.`);
  if (problems.length) { console.log(`\n${problems.length} problem(s):\n${problems.join('\n')}`); process.exit(1); }
  console.log('All checks passed.');
})();
