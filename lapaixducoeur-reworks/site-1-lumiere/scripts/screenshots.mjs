// Usage: NODE_PATH=$(npm root -g) node scripts/screenshots.mjs [port] [outDir] [paths...]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [port = 8110, out = join(ROOT, 'screenshots'), ...paths] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const targets = paths.length ? paths : ['/fr/'];
const browser = await chromium.launch();
for (const [name, vp] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 375, height: 812 }]]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
  for (const p of targets) {
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${port}${p}`, { waitUntil: 'networkidle' });
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } window.scrollTo(0, 0); await new Promise((r) => setTimeout(r, 100)); window.dispatchEvent(new Event('scroll')); });
    await page.evaluate(() => document.querySelectorAll('img[loading="lazy"]').forEach((i) => { i.loading = 'eager'; }));
    await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete));
    await page.addStyleTag({ content: '.mobile-give:not(.is-shown){display:none!important}' });
    await page.waitForTimeout(2200);
    const slug = p === '/fr/' ? 'home' : p.replace(/\//g, '_').replace(/^_|_$/g, '');
    await page.screenshot({ path: join(out, `${slug}-${name}.png`), fullPage: true });
    await page.close();
  }
  await ctx.close();
}
await browser.close();
console.log('done');
