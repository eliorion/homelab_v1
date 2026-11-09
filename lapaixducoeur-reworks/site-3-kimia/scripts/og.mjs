#!/usr/bin/env node
// Renders static/assets/og-{fr,en}.png (1200x630) with Playwright. Dev-time only; not part of build.mjs.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { hoop } from '../src/templates/svg.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const data = (f, type) => `url(data:${type};base64,${readFileSync(`${root}static/assets/${f}`).toString('base64')})`;
const copy = {
  fr: ['La Paix du Cœur', 'Kimia Na Motema', 'Association chrétienne au service des orphelins, des veuves et des démunis · Montréal, depuis 2014'],
  en: ['La Paix du Cœur', 'Kimia Na Motema', 'A Christian association serving orphans, widows and people in need · Montréal, since 2014'],
};
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
for (const [lang, [a, b, c]] of Object.entries(copy)) {
  await page.setContent(`<html><head><style>
@font-face{font-family:F;src:${data('fonts/fraunces.woff2', 'font/woff2')}}
@font-face{font-family:F;font-style:italic;src:${data('fonts/fraunces-italic.woff2', 'font/woff2')}}
@font-face{font-family:N;src:${data('fonts/nunito.woff2', 'font/woff2')}}
body{margin:0;width:1200px;height:630px;background:#FBF3E6 ${data('patterns/seeds.svg', 'image/svg+xml')};display:grid;grid-template-columns:1fr 470px;align-items:center;overflow:hidden;position:relative}
.t{padding:0 0 30px 80px}.k{font:800 20px N;letter-spacing:.14em;text-transform:uppercase;color:#3F5A3C}
h1{font:700 82px/1 F;font-variation-settings:"SOFT" 100;color:#4A2545;margin:18px 0 6px}
h2{font:italic 500 46px F;color:#A4482A;margin:0 0 24px}p{font:600 23px/1.45 N;color:#3A2632;max-width:600px;margin:0}
.b{position:absolute;left:0;right:0;bottom:0;height:34px;background:${data('patterns/band.svg', 'image/svg+xml')} repeat-x;background-size:auto 34px}
svg{width:440px;margin-bottom:20px}</style></head><body>
<div class="t"><div class="k">Montréal · 2014</div><h1>${a}</h1><h2>${b}</h2><p>${c}</p></div>${hoop({ id: 'og' })}<div class="b"></div></body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${root}static/assets/og-${lang}.png` });
}
await browser.close();
console.log('og images written');
