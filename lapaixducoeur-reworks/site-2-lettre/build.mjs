#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ROUTES, LANGS, LOCALE, ui } from './src/i18n.mjs';
import { esc, plain } from './src/md.mjs';
import { ctx } from './src/layout.mjs';
import { views } from './src/views.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');
const rd = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

function merge(base, over) {
  if (Array.isArray(base) && Array.isArray(over)) return over.map((x, i) => merge(base[i], x));
  if (base && over && typeof base === 'object' && typeof over === 'object' && !Array.isArray(base)) {
    const out = { ...base };
    for (const k of Object.keys(over)) out[k] = merge(base[k], over[k]);
    return out;
  }
  return over === undefined || over === '' ? base : over;
}
const localize = (doc) => ({ fr: doc.fr, en: merge(doc.fr, doc.en || {}) });
const slugify = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’']/g, '-').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function collection(dir) {
  const abs = path.join(ROOT, 'content', dir);
  return fs.readdirSync(abs).filter((f) => f.endsWith('.json')).sort().map((f) => ({ file: f, ...localize(rd(`content/${dir}/${f}`)) }));
}

// ---------- content ----------
const site = localize(rd('content/settings.json'));
const pages = {};
for (const f of fs.readdirSync(path.join(ROOT, 'content/pages'))) {
  if (f.endsWith('.json')) pages[f.replace('.json', '')] = localize(rd(`content/pages/${f}`));
}
const withUrls = (items, key) => items.map((it) => {
  const url = {};
  for (const l of LANGS) url[l] = `${ROUTES[key][l]}${it[l].slug || slugify(it[l].title)}/`;
  return { l: { fr: it.fr, en: it.en }, url, file: it.file };
});
const byDateDesc = (a, b) => (a.l.fr.date < b.l.fr.date ? 1 : -1);
const data = {
  pages,
  stories: withUrls(collection('stories'), 'stories').sort(byDateDesc),
  news: withUrls(collection('news'), 'news').sort(byDateDesc),
  events: withUrls(collection('events'), 'events').sort((a, b) => (a.l.fr.start > b.l.fr.start ? 1 : -1)),
  episodes: collection('episodes').map((e) => ({ l: { fr: e.fr, en: e.en } })).sort((a, b) => b.l.fr.number - a.l.fr.number),
  media: collection('media').map((m) => ({ l: { fr: m.fr, en: m.en } })).sort((a, b) => a.l.fr.order - b.l.fr.order),
  prayers: fs.readdirSync(path.join(ROOT, 'content/prayers')).filter((f) => f.endsWith('.json')).map((f) => rd(`content/prayers/${f}`)).filter((p) => p.published !== false).sort((a, b) => (a.date < b.date ? 1 : -1)),
};
for (const e of data.events) e.ics = `/ics/${e.l.fr.slug}.ics`;

// ---------- images ----------
function jpegSize(file) {
  const b = fs.readFileSync(file);
  if (b[0] === 0x89) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  let i = 2;
  while (i < b.length) {
    const m = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
    i += 2 + len;
  }
  return { w: 1200, h: 800 };
}
const IMGDIR = path.join(ROOT, 'static/assets/img');
const IMG = {};
for (const f of fs.readdirSync(IMGDIR)) {
  const m = f.match(/^(.+?)\.(jpe?g|png)$/);
  if (!m || /-640$/.test(m[1]) || /^og-/.test(m[1])) continue;
  const n = m[1];
  IMG[`/assets/img/${f}`] = {
    n, ext: m[2], ...jpegSize(path.join(IMGDIR, f)),
    webp: fs.existsSync(path.join(IMGDIR, `${n}.webp`)),
    sm: fs.existsSync(path.join(IMGDIR, `${n}-640.${m[2]}`)) ? jpegSize(path.join(IMGDIR, `${n}-640.${m[2]}`)) : null,
  };
}
function pic(src, alt, { sizes = '100vw', cls = '', eager = false } = {}) {
  const info = IMG[src];
  const load = eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"';
  if (!info) return `<img class="${cls}" src="${esc(src)}" alt="${esc(alt)}" width="1200" height="800" ${load} decoding="async">`;
  const { n, ext, w, h, sm, webp } = info;
  const set = (e) => `${sm ? `/assets/img/${n}-640.${e} ${sm.w}w, ` : ''}/assets/img/${n}.${e} ${w}w`;
  return `<picture class="${cls}">${webp ? `<source type="image/webp" srcset="${set('webp')}" sizes="${sizes}">` : ''}<img src="/assets/img/${n}.${ext}" srcset="${set(ext)}" sizes="${sizes}" width="${w}" height="${h}" alt="${esc(alt)}" ${load} decoding="async"></picture>`;
}
const og = (src) => {
  const m = String(src).match(/\/assets\/img\/(.+)\.jpe?g$/);
  return m && fs.existsSync(path.join(IMGDIR, `og-${m[1]}.jpg`)) ? `/assets/img/og-${m[1]}.jpg` : '/assets/img/og-default.jpg';
};

// ---------- dates (America/Montreal) ----------
const nthSunday = (y, mo, n) => { const d = new Date(Date.UTC(y, mo, 1)); const first = (7 - d.getUTCDay()) % 7 + 1; return first + (n - 1) * 7; };
function mtlOffset(wall) {
  const [y, mo, d, h] = [+wall.slice(0, 4), +wall.slice(5, 7) - 1, +wall.slice(8, 10), +(wall.slice(11, 13) || 12)];
  const start = Date.UTC(y, 2, nthSunday(y, 2, 2), 2);
  const end = Date.UTC(y, 10, nthSunday(y, 10, 1), 2);
  const t = Date.UTC(y, mo, d, h);
  return t >= start && t < end ? -4 : -5;
}
const isoLocal = (wall) => { const o = mtlOffset(wall); return `${wall}:00${o === -4 ? '-04:00' : '-05:00'}`; };
const toUTC = (wall) => new Date(Date.parse(`${wall}:00Z`) - mtlOffset(wall) * 3600e3);
const icsStamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const wallDate = (s) => new Date(`${s.slice(0, 10)}T12:00:00Z`);
const fmtDate = (s, lang, short = false) => new Intl.DateTimeFormat(LOCALE[lang], short ? { day: 'numeric', month: 'short', timeZone: 'UTC' } : { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(wallDate(s));
const fmtTime = (s, lang) => {
  const [h, m] = s.slice(11, 16).split(':').map(Number);
  if (lang === 'fr') return `${h}&nbsp;h${m ? String(m).padStart(2, '0') : ''}`;
  const hh = ((h + 11) % 12) + 1;
  return `${hh}${m ? `:${String(m).padStart(2, '0')}` : ''}&nbsp;${h < 12 ? 'a.m.' : 'p.m.'}`;
};
const fmtDay = (s) => String(+s.slice(8, 10));
const fmtMonth = (s, lang) => new Intl.DateTimeFormat(LOCALE[lang], { month: 'short', timeZone: 'UTC' }).format(wallDate(s)).replace('.', '');

function gcal(lang, e) {
  const d = e.l[lang];
  const q = new URLSearchParams({ action: 'TEMPLATE', text: d.title, dates: `${icsStamp(toUTC(d.start))}/${icsStamp(toUTC(d.end))}`, details: `${plain(d.summary)}\n${L.abs(e.url[lang])}`, location: d.location });
  return `https://calendar.google.com/calendar/render?${q}`;
}

function ics(e) {
  const fold = (line) => {
    const out = [];
    let cur = '';
    for (const ch of line) {
      if (Buffer.byteLength(cur + ch) > (out.length ? 74 : 75)) { out.push(cur); cur = ''; }
      cur += ch;
    }
    out.push(cur);
    return out.join('\r\n ');
  };
  const escI = (s) => plain(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const fr = e.l.fr, en = e.l.en;
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//La Paix du Coeur//Site//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${fr.slug}@lapaixducoeur.ca`,
    `DTSTAMP:${icsStamp(new Date(Date.UTC(2026, 10, 9)))}`,
    `DTSTART:${icsStamp(toUTC(fr.start))}`,
    `DTEND:${icsStamp(toUTC(fr.end))}`,
    `SUMMARY:${escI(`${fr.title} / ${en.title}`)}`,
    `DESCRIPTION:${escI(`${fr.summary}\n\n${en.summary}\n\n${L.abs(e.url.fr)}`)}`,
    `LOCATION:${escI(fr.location)}`,
    `URL:${L.abs(e.url.fr)}`,
    'END:VEVENT', 'END:VCALENDAR', '',
  ].map((l) => (l ? fold(l) : l)).join('\r\n');
}

// ---------- assets ----------
function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, f.name), d = path.join(dst, f.name);
    f.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}
const write = (rel, content) => {
  const p = path.join(DIST, rel.replace(/^\//, ''), rel.endsWith('/') ? 'index.html' : '');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
};

rmrf(DIST);
copyDir(path.join(ROOT, 'static'), DIST);
copyDir(path.join(ROOT, 'src/css'), path.join(DIST, 'assets/css'));
copyDir(path.join(ROOT, 'src/js'), path.join(DIST, 'assets/js'));
copyDir(path.join(ROOT, 'admin'), path.join(DIST, 'admin'));
const version = crypto.createHash('sha1')
  .update(['src/css/site.css', 'src/js/main.js', 'src/js/player.js'].map((f) => fs.readFileSync(path.join(ROOT, f))).join(''))
  .digest('hex').slice(0, 8);

const L = ctx(site, version);
const C = { L, pageHead: (lang, o) => L.pageHead(lang, o), pic, og, fmtDate, fmtTime, fmtDay, fmtMonth, isoLocal, gcal, abs: L.abs, ORG_ID: L.ORG_ID, site, data };
const V = views(C);

const sitemap = [];
const emit = (paths, render) => {
  for (const lang of LANGS) write(paths[lang], render(lang));
  sitemap.push(paths);
};

emit(ROUTES.home, V.homePage);
emit(ROUTES.about, V.aboutPage);
emit(ROUTES.missions, V.missionsPage);
emit(ROUTES.stories, V.storiesHub);
for (const s of data.stories) emit(s.url, (l) => V.storyPage(l, s));
emit(ROUTES.podcast, V.podcastPage);
emit(ROUTES.prayer, V.prayerPage);
emit(ROUTES.letters, V.lettersPage);
emit(ROUTES.charter, V.charterPage);
emit(ROUTES.news, V.newsList);
for (const n of data.news) emit(n.url, (l) => V.newsPage(l, n));
emit(ROUTES.events, V.eventsList);
for (const e of data.events) {
  emit(e.url, (l) => V.eventPage(l, e));
  write(e.ics, ics(e));
}
emit(ROUTES.media, V.mediaPage);
emit(ROUTES.give, V.givePage);
emit(ROUTES.contact, V.contactPage);
emit(ROUTES.privacy, V.privacyPage);

// ---------- root chooser + 404 ----------
const rootHtml = (kind) => {
  const is404 = kind === '404';
  const title = is404 ? 'Page introuvable / Page not found — La Paix du Cœur' : 'La Paix du Cœur — Kimia Na Motema · Français / English';
  const desc = site.fr.default_description;
  const ld = JSON.stringify({ '@context': 'https://schema.org', '@graph': [L.orgLd('fr')] }).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="fr-CA">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${esc(desc)}">
${is404 ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${L.BASE}/">
<link rel="alternate" hreflang="fr-CA" href="${L.BASE}/fr/">
<link rel="alternate" hreflang="en-CA" href="${L.BASE}/en/">
<link rel="alternate" hreflang="x-default" href="${L.BASE}/">`}
<meta property="og:type" content="website">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${L.BASE}/">
<meta property="og:image" content="${L.BASE}/assets/img/og-default.jpg">
<meta property="og:locale" content="fr_CA">
<meta property="og:locale:alternate" content="en_CA">
<meta name="theme-color" content="#FAF5EC">
<link rel="icon" href="/favicon.png" type="image/png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400..700;1,9..40,400&family=Fraunces:ital,opsz,wght,SOFT@0,9..144,300..650,30..100;1,9..144,300..600,30..100&display=swap">
<link rel="stylesheet" href="/assets/css/site.css?v=${version}">
<script src="/assets/js/main.js?v=${version}" defer></script>
<script type="application/ld+json">${ld}</script>
</head>
<body class="is-chooser">
<main id="main" class="chooser">
<div class="chooser__card letter">
<img class="chooser__logo" src="/assets/img/logo.png" width="480" height="416" alt="Logo de La Paix du Cœur : un cœur vert tenu par deux mains, dans une couronne de feuilles">
${is404 ? `<h1>Cette lettre s’est égarée <span lang="en">/ This letter went astray</span></h1>
<p>La page demandée n’existe pas ou a changé d’adresse. <span lang="en">The page you asked for doesn’t exist or has moved.</span></p>` : `<h1>La Paix du Cœur <span class="chooser__sub">Kimia Na Motema</span></h1>
<p class="chooser__verse"><em>«&nbsp;Défendez le faible et l’orphelin, rendez justice à l’affligé et au pauvre.&nbsp;»</em><br><span>Tehilim (Psaumes) 82:3</span></p>`}
<div class="chooser__langs">
<a class="btn btn--ink btn--lg" href="/fr/" hreflang="fr-CA" lang="fr">Entrer en français</a>
<a class="btn btn--ghost btn--lg" href="/en/" hreflang="en-CA" lang="en">Enter in English</a>
</div>
</div>
</main>
</body>
</html>
`;
};
write('/index.html', rootHtml('index'));
write('/404.html', rootHtml('404'));

// ---------- sitemap, robots, rss, headers ----------
const urlEntry = (loc, alts) => `<url><loc>${loc}</loc>${alts}</url>`;
const sm = [`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">`];
for (const p of sitemap) {
  const alts = `<xhtml:link rel="alternate" hreflang="fr-CA" href="${L.abs(p.fr)}"/><xhtml:link rel="alternate" hreflang="en-CA" href="${L.abs(p.en)}"/><xhtml:link rel="alternate" hreflang="x-default" href="${L.abs(p.fr)}"/>`;
  for (const l of LANGS) sm.push(urlEntry(L.abs(p[l]), alts));
}
sm.push('</urlset>\n');
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), sm.join('\n'));

for (const lang of LANGS) {
  const t = ui(lang);
  const items = data.news.map((n) => {
    const d = n.l[lang];
    return `<item><title>${esc(d.title)}</title><link>${L.abs(n.url[lang])}</link><guid>${L.abs(n.url[lang])}</guid><pubDate>${new Date(`${d.date}T13:00:00Z`).toUTCString()}</pubDate><description>${esc(d.summary)}</description></item>`;
  }).join('\n');
  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>La Paix du Cœur — ${t.news}</title><link>${L.abs(ROUTES.news[lang])}</link><description>${esc(site[lang].tagline)}</description><language>${LOCALE[lang]}</language>
<atom:link href="${L.abs(`${ROUTES.news[lang]}rss.xml`)}" rel="self" type="application/rss+xml"/>
${items}
</channel></rss>
`;
  fs.writeFileSync(path.join(DIST, ROUTES.news[lang], 'rss.xml'), feed);
}

const count = sitemap.length * 2;
console.log(`Built ${count} pages + ${data.events.length} .ics + sitemap + 2 RSS feeds into dist/ (assets v${version}).`);
