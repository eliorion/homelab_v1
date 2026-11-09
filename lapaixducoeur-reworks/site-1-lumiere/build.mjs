#!/usr/bin/env node
// Zero-dependency static build: content/ + src/ + static/ -> dist/
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { LANGS, ROUTES, T, url, typo } from './src/i18n.mjs';
import * as tpl from './src/templates.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, 'dist');
const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'));
const listJSON = (dir) => readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.json')).sort().map((f) => ({ file: f, ...readJSON(join(ROOT, dir, f)) }));

// ---------- helpers ----------
const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const tbc = (html) => html.replace(/\[([^\]\[<>\n]{2,80})\]/g, '<span class="tbc">[$1]</span>');
const txt = (s = '') => tbc(esc(s));

function inline(s) {
  return esc(s)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, h) => `<a href="${h}">${t}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/ {2}$/gm, '<br>');
}
function md(src = '', { breaks = false } = {}) {
  const blocks = String(src).replace(/\r/g, '').split(/\n{2,}/);
  const out = blocks.map((b) => {
    const t = b.trim();
    if (!t) return '';
    let m;
    if ((m = t.match(/^(#{2,4})\s+(.*)$/))) return `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`;
    if (/^[-*]\s/.test(t)) return `<ul>${t.split(/\n/).map((l) => `<li>${inline(l.replace(/^[-*]\s+/, ''))}</li>`).join('')}</ul>`;
    if (/^\d+\.\s/.test(t)) return `<ol>${t.split(/\n/).map((l) => `<li>${inline(l.replace(/^\d+\.\s+/, ''))}</li>`).join('')}</ol>`;
    if (t.startsWith('>')) return `<blockquote><p>${inline(t.replace(/^>\s?/gm, ''))}</p></blockquote>`;
    return `<p>${inline(t).replace(/\n/g, breaks ? '<br>' : ' ').replace(/<br> /g, '<br>')}</p>`;
  });
  return tbc(out.join('\n'));
}

function imageSize(file) {
  const b = readFileSync(file);
  if (b[0] === 0x89 && b[1] === 0x50) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  }
  return { w: 1200, h: 800 };
}

// Resolves /img/name.jpg to pre-generated -640/-1200 variants (webp + jpg) when present.
function pic(src, alt, { sizes = '100vw', cls = '', eager = false, imgCls = '' } = {}) {
  const ext = extname(src);
  const name = src.slice(0, -ext.length);
  const variants = [640, 1200].filter((w) => existsSync(join(ROOT, 'static', `${name}-${w}.jpg`)));
  const loading = eager ? 'fetchpriority="high"' : 'loading="lazy" decoding="async"';
  const a = `alt="${esc(alt)}"`;
  if (variants.length) {
    const big = variants[variants.length - 1];
    const { w, h } = imageSize(join(ROOT, 'static', `${name}-${big}.jpg`));
    const set = (e) => variants.map((v) => `${name}-${v}.${e} ${v === big ? w : v}w`).join(', ');
    return `<picture class="${cls}"><source type="image/webp" srcset="${set('webp')}" sizes="${sizes}"><img class="${imgCls}" src="${name}-${variants[0]}.jpg" srcset="${set('jpg')}" sizes="${sizes}" width="${w}" height="${h}" ${a} ${loading}></picture>`;
  }
  const file = join(ROOT, 'static', src);
  const { w, h } = existsSync(file) ? imageSize(file) : { w: 1200, h: 800 };
  const webp = existsSync(join(ROOT, 'static', `${name}.webp`)) ? `<source type="image/webp" srcset="${name}.webp">` : '';
  return `<picture class="${cls}">${webp}<img class="${imgCls}" src="${src}" width="${w}" height="${h}" ${a} ${loading}></picture>`;
}

const money = (n, lang, digits = 0) => new Intl.NumberFormat(T[lang].locale, { style: 'currency', currency: 'CAD', maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n).replace('CA', '');
const num = (n, lang) => new Intl.NumberFormat(T[lang].locale).format(n);
const fmtDate = (iso, lang, opts = { dateStyle: 'long' }) => new Intl.DateTimeFormat(T[lang].locale, { timeZone: 'America/Toronto', ...opts }).format(new Date(iso.length === 10 ? iso + 'T12:00:00-05:00' : iso));
const isAllDay = (x) => /T00:00(:00)?/.test(x.start.slice(10, 19)) && /T23:59/.test(x.end.slice(10, 16)) && x.start.slice(0, 10) <= x.end.slice(0, 10);
const bigImg = (src) => {
  const name = src.slice(0, -extname(src).length);
  const v = [1200, 640].find((w) => existsSync(join(ROOT, 'static', `${name}-${w}.jpg`)));
  return v ? `${name}-${v}.jpg` : src;
};
const pick = (item, lang, key) => item?.[lang]?.[key] ?? item?.fr?.[key] ?? item?.[key];
const L = (item, lang) => ({ ...item.fr, ...item[lang] });

// ---------- content ----------
const S = readJSON(join(ROOT, 'content/settings.json'));
const pages = Object.fromEntries(readdirSync(join(ROOT, 'content/pages')).filter((f) => f.endsWith('.json')).map((f) => [basename(f, '.json'), readJSON(join(ROOT, 'content/pages', f))]));
const news = listJSON('content/news').sort((a, b) => pick(b, 'fr', 'date').localeCompare(pick(a, 'fr', 'date')));
const events = listJSON('content/events').sort((a, b) => pick(a, 'fr', 'start').localeCompare(pick(b, 'fr', 'start')));
const media = listJSON('content/media');
const SITE = S.site_url.replace(/\/$/, '');
const FEED = { fr: '/fr/calendrier.ics', en: '/en/calendar.ics', both: '/calendar.ics' };
const feed = (lang) => {
  const https = `${SITE}${FEED[lang]}`;
  const webcal = https.replace(/^https?:/, 'webcal:');
  return {
    https, webcal,
    google: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`,
    outlook: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(https)}&name=${encodeURIComponent(T[lang].calName)}`,
    view: S.calendar_google_public_url || '',
  };
};

// ---------- assets ----------
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
function copyDir(from, to) {
  if (!existsSync(from)) return;
  mkdirSync(to, { recursive: true });
  for (const f of readdirSync(from)) {
    const s = join(from, f), d = join(to, f);
    statSync(s).isDirectory() ? copyDir(s, d) : copyFileSync(s, d);
  }
}
copyDir(join(ROOT, 'static'), DIST);
copyDir(join(ROOT, 'admin'), join(DIST, 'admin'));
const hashed = {};
for (const [src, out] of [['src/styles.css', 'css/site'], ['src/main.js', 'js/main']]) {
  const body = readFileSync(join(ROOT, src));
  const h = createHash('sha256').update(body).digest('hex').slice(0, 10);
  const ext = extname(src);
  mkdirSync(join(DIST, dirname(out)), { recursive: true });
  writeFileSync(join(DIST, `${out}.${h}${ext}`), body);
  hashed[src] = `/${out}.${h}${ext}`;
}

// ---------- page writer ----------
const sitemap = [];
const write = (path, html) => {
  const file = join(DIST, path.endsWith('/') ? path + 'index.html' : path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
};

const h = { esc, txt, tbc, md, pic, money, num, fmtDate, pick, L, url, T, S, SITE, ROUTES, hashed, pages, news, events, media, gcal, isAllDay, bigImg, feed };

function render(page) {
  // page: { key, lang, path, alt: {fr, en}, title, description, body, crumbs, jsonld, ogImage, ogType, bodyClass }
  const html = tpl.layout(h, page);
  write(page.path, page.lang === 'fr' ? typo(html, 'fr') : html);
  if (!page.noindex) sitemap.push(page);
}

for (const lang of LANGS) {
  const alt = (key, sub) => ({ fr: url(key, 'fr', sub?.fr), en: url(key, 'en', sub?.en) });
  const ctx = { lang, t: T[lang] };

  render({ key: 'home', lang, path: url('home', lang), alt: alt('home'), ...tpl.home(h, ctx) });
  for (const key of ['about', 'missions', 'give', 'circle', 'transparency', 'contact', 'privacy']) {
    render({ key, lang, path: url(key, lang), alt: alt(key), ...tpl[key](h, ctx) });
  }
  render({ key: 'news', lang, path: url('news', lang), alt: alt('news'), ...tpl.newsList(h, ctx) });
  for (const n of news) {
    const sub = { fr: pick(n, 'fr', 'slug'), en: pick(n, 'en', 'slug') };
    render({ key: 'news', lang, path: url('news', lang, sub[lang]), alt: alt('news', sub), ...tpl.article(h, ctx, n) });
  }
  render({ key: 'events', lang, path: url('events', lang), alt: alt('events'), ...tpl.eventList(h, ctx) });
  for (const e of events) {
    const sub = { fr: pick(e, 'fr', 'slug'), en: pick(e, 'en', 'slug') };
    render({ key: 'events', lang, path: url('events', lang, sub[lang]), alt: alt('events', sub), ...tpl.event(h, ctx, e) });
    write(`${url('events', lang)}${sub[lang]}.ics`, calendar([vevent(e, lang)], lang));
  }
  write(FEED[lang], calendar(upcomingEvents().map((e) => vevent(e, lang)), lang, T[lang].calName));
  render({ key: 'media', lang, path: url('media', lang), alt: alt('media'), ...tpl.media(h, ctx) });
  write(`${url('news', lang)}rss.xml`, rss(lang));
}
write(FEED.both, calendar(upcomingEvents().map((e) => vevent(e, 'both')), 'fr', 'La Paix du Cœur — événements / events'));
write('/index.html', tpl.chooser(h));
write('/404.html', tpl.notFound(h));

// ---------- ICS ----------
function icsDate(iso) { return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
function icsText(s = '') { return String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1'); }
function fold(line) {
  const out = []; let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > 74) { out.push(cur); cur = ' ' + ch; } else cur += ch;
  }
  out.push(cur);
  return out.join('\r\n');
}
function eventId(e) { return basename(e.file, '.json'); }
function upcomingEvents() { return events.filter((e) => new Date(pick(e, 'fr', 'end')) >= new Date()); }
function ymd(iso, days = 0) { const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10).replace(/-/g, ''); }
// lang 'both' = bilingual entry for the combined /calendar.ics feed
function vevent(e, lang) {
  const both = lang === 'both';
  const fr = L(e, 'fr'), en = L(e, 'en'), x = both ? fr : L(e, lang);
  const link = `${SITE}${url('events', both ? 'fr' : lang, x.slug)}`;
  const sample = (l) => (x.sample ? (l === 'fr' ? ' (exemple)' : ' (sample)') : '');
  const summary = both
    ? (fr.title === en.title ? fr.title + sample('fr') : `${fr.title} / ${en.title}${sample('fr')}`)
    : x.title + sample(lang);
  const desc = both
    ? `${[...new Set([fr.summary, en.summary.replace(/^\(In French\) /, '')])].join('\n\n')}\n\n${link}\n${SITE}${url('events', 'en', en.slug)}`
    : `${x.summary}\n${link}`;
  const location = both && fr.location_name !== en.location_name ? `${fr.location_name} / ${en.location_name}` : x.location_name;
  const when = isAllDay(x)
    ? [`DTSTART;VALUE=DATE:${ymd(x.start)}`, `DTEND;VALUE=DATE:${ymd(x.end, 1)}`]
    : [`DTSTART:${icsDate(x.start)}`, `DTEND:${icsDate(x.end)}`];
  return [
    'BEGIN:VEVENT',
    `UID:${eventId(e)}@lapaixducoeur.ca`,
    `DTSTAMP:${icsDate('2026-11-09T12:00:00Z')}`,
    ...when,
    `SUMMARY:${icsText(summary)}`,
    `DESCRIPTION:${icsText(desc)}`,
    `LOCATION:${icsText(location)}`,
    `URL:${link}`,
    'END:VEVENT',
  ];
}
function calendar(vevents, lang, name) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//La Paix du Coeur//Site//${lang.toUpperCase()}`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    ...(name ? [`X-WR-CALNAME:${icsText(name)}`, 'X-WR-TIMEZONE:America/Toronto', 'REFRESH-INTERVAL;VALUE=DURATION:PT12H', 'X-PUBLISHED-TTL:PT12H'] : []),
    ...vevents.flat(),
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
function gcal(e, lang) {
  const x = L(e, lang);
  const dates = isAllDay(x) ? `${ymd(x.start)}/${ymd(x.end, 1)}` : `${icsDate(x.start)}/${icsDate(x.end)}`;
  const q = new URLSearchParams({ action: 'TEMPLATE', text: x.title, dates, details: `${x.summary}\n${SITE}${url('events', lang, x.slug)}`, location: x.location_name });
  return `https://calendar.google.com/calendar/render?${q}`;
}

// ---------- RSS ----------
function rss(lang) {
  const t = T[lang], P = L(pages.listings, lang);
  const items = news.map((n) => {
    const x = L(n, lang); const link = `${SITE}${url('news', lang, x.slug)}`;
    return `<item><title>${esc(x.title)}</title><link>${link}</link><guid>${link}</guid><pubDate>${new Date(x.date + 'T12:00:00-05:00').toUTCString()}</pubDate><description>${esc(x.summary)}</description></item>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${esc(`${P.news_heading} · ${S.site_name}`)}</title><link>${SITE}${url('news', lang)}</link><atom:link href="${SITE}${url('news', lang)}rss.xml" rel="self" type="application/rss+xml"/><description>${esc(P.news_description)}</description><language>${t.locale}</language>\n${items}\n</channel></rss>\n`;
}

// ---------- sitemap ----------
const seen = new Set();
const urls = sitemap.filter((p) => !seen.has(p.path) && seen.add(p.path)).map((p) => {
  const alts = ['fr', 'en'].map((l) => `<xhtml:link rel="alternate" hreflang="${l}-CA" href="${SITE}${p.alt[l]}"/>`).join('') + `<xhtml:link rel="alternate" hreflang="x-default" href="${SITE}${p.key === 'home' ? '/' : p.alt.fr}"/>`;
  return `<url><loc>${SITE}${p.path}</loc>${alts}</url>`;
});
urls.unshift(`<url><loc>${SITE}/</loc></url>`);
writeFileSync(join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`);

const jsSize = statSync(join(DIST, hashed['src/main.js'])).size;
console.log(`Built ${seen.size} pages + chooser/404 into dist/ (main.js ${(jsSize / 1024).toFixed(1)} KB)`);
