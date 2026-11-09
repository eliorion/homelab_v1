#!/usr/bin/env node
// La Paix du Cœur — «Chaleur du Nord». Zero-dependency static build: content/ + src/ -> dist/
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, cpSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makePicture, hash, slugify, icsCalendar, toUtc, plain, esc, fmtDate, isAllDay } from './src/lib.mjs';
import { ROUTES, FEEDS, T } from './src/strings.mjs';
import { layout } from './src/layout.mjs';
import * as V from './src/views.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, 'dist');
const C = (...p) => join(ROOT, 'content', ...p);
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const LANGS = ['fr', 'en'];

/** Sveltia single_file i18n: { fr: {...}, en: {...} }. Untranslated fields fall back to French. */
const localize = (raw) => ({ fr: raw.fr, en: { ...raw.fr, ...raw.en } });
const loadDir = (dir) => readdirSync(C(dir)).filter((f) => f.endsWith('.json')).sort()
  .map((f) => ({ id: f.replace(/\.json$/, ''), ...localize(readJson(C(dir, f))) }));

/* ------------------------------------------------------------------ content */
const buildDate = process.env.BUILD_DATE ? new Date(process.env.BUILD_DATE) : new Date();
const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(buildDate); // YYYY-MM-DD
const settings = localize(readJson(C('settings.json')));
const site = settings.fr.site_url.replace(/\/$/, '');
const pages = Object.fromEntries(readdirSync(C('pages')).filter((f) => f.endsWith('.json'))
  .map((f) => [f.replace(/\.json$/, ''), localize(readJson(C('pages', f)))]));

const slugFor = (item, lang) => item[lang].slug || slugify(item[lang].title);

const events = loadDir('events').map((e) => {
  const b = e.fr;
  const ev = { id: e.id, fr: e.fr, en: e.en, type: b.type, start: b.start, end: b.end, hood: b.neighbourhood, image: b.image, rsvp: b.rsvp || 'form', shifts: b.shifts || [],
    sample: Boolean(b.sample), synced: b.source === 'google-calendar', allDay: isAllDay(b.start, b.end) };
  ev.url = Object.fromEntries(LANGS.map((l) => [l, `${ROUTES.events[l]}${slugFor(e, l)}/`]));
  ev.ics = Object.fromEntries(LANGS.map((l) => [l, `${ev.url[l]}${slugFor(e, l)}.ics`]));
  ev.past = toUtc(ev.end) < buildDate;
  return ev;
}).sort((a, b) => a.start.localeCompare(b.start));

const news = loadDir('news').map((n) => ({ id: n.id, fr: n.fr, en: n.en, date: n.fr.date, category: n.fr.category, image: n.fr.image,
  url: Object.fromEntries(LANGS.map((l) => [l, `${ROUTES.news[l]}${slugFor(n, l)}/`])) }))
  .filter((n) => !n.fr.draft).sort((a, b) => b.date.localeCompare(a.date));

const media = loadDir('media').map((m) => ({ id: m.id, fr: m.fr, en: m.en, kind: m.fr.kind, youtube_id: m.fr.youtube_id, audio_file: m.fr.audio_file, image: m.fr.image, date: m.fr.date, duration: m.fr.duration }))
  .sort((a, b) => b.date.localeCompare(a.date));

const drops = loadDir('dropoffs').map((d) => ({ id: d.id, fr: d.fr, en: d.en, hood: d.fr.neighbourhood, dates: [...(d.fr.dates || [])].sort((a, b) => a.date.localeCompare(b.date)) }))
  .map((d) => ({ ...d, next: d.dates.find((x) => x.date >= todayStr)?.date || '9999' }))
  .sort((a, b) => a.next.localeCompare(b.next));
const dropDates = drops.flatMap((d) => d.dates.filter((x) => x.date >= todayStr).map((x) => ({ ...x, drop: d })))
  .sort((a, b) => a.date.localeCompare(b.date));

const manifest = readJson(join(ROOT, 'static/assets/img/manifest.json'));
const imageUrl = (ref) => {
  if (manifest[ref]) return `/assets/img/${ref}-${manifest[ref].widths.at(-1)}.jpg`;
  return ref;
};

/* ------------------------------------------------------------------ dist reset + static */
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
cpSync(join(ROOT, 'static'), DIST, { recursive: true, filter: (p) => !p.endsWith('manifest.json') });
cpSync(join(ROOT, 'admin'), join(DIST, 'admin'), { recursive: true });
const write = (rel, data) => { const p = join(DIST, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, data); };

/* CSS + JS (versioned by content hash) */
const v = {};
const css = readFileSync(join(ROOT, 'src/css/site.css'), 'utf8');
v.css = await hash(css); write('assets/css/site.css', css);
for (const f of readdirSync(join(ROOT, 'src/js'))) {
  const js = readFileSync(join(ROOT, 'src/js', f), 'utf8');
  v[f.replace(/\.js$/, '')] = await hash(js); write(`assets/js/${f}`, js);
}
/* knit band SVGs (generated) */
write('assets/img/knit-band.svg', knitSvg({ bg: '#E8DFD0', base: '#DED3C1', motif: ['#2F4A3F', '#B5332E'] }));
write('assets/img/knit-band-pine.svg', knitSvg({ bg: '#22382F', base: '#2A4337', motif: ['#E8DFD0', '#C9534C'] }));
write('assets/img/knit-texture.svg', knitSvg({ bg: '#2F4A3F', base: '#355246', motif: null }));

/* ------------------------------------------------------------------ pages */
const nextEvent = events.find((e) => !e.past);
const webcal = `webcal://${site.replace(/^https?:\/\//, '')}${FEEDS.combined}`;
const subLinks = (lang) => {
  const https = `${site}${FEEDS.sub[lang]}`; const wc = https.replace(/^https?:/, 'webcal:');
  const name = `La Paix du Cœur — ${lang === 'fr' ? 'Activités' : 'Activities'}`;
  return { name, https, webcal: wc, google: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(wc)}`,
    outlook: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(https)}&name=${encodeURIComponent(name)}`,
    view: settings[lang].calendar_google_public_url || '' };
};
const ctx = { settings, pages, events, news, media, drops, dropDates, site, buildDate, todayStr, v, nextEvent, webcal,
  googleSub: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`, sub: { fr: subLinks('fr'), en: subLinks('en') },
  picture: makePicture(manifest), imageUrl };

const sitemap = [];
function emit(lang, path, alt, key, view, extra = {}) {
  let html = layout(ctx, { lang, key, path, alt, ...view, ...extra });
  if (lang === 'fr') html = frenchSpacing(html);
  write(path.replace(/^\//, '') + 'index.html', html);
  sitemap.push({ path, lang, alt });
}
function pair(key, viewFn) {
  for (const lang of LANGS) {
    const other = lang === 'fr' ? 'en' : 'fr';
    emit(lang, ROUTES[key][lang], ROUTES[key][other], key, viewFn(ctx, lang), key === 'home' ? { xDefault: '/' } : {});
  }
}
pair('home', V.homePage);
pair('about', V.aboutPage);
pair('missions', V.missionsPage);
pair('events', V.eventsPage);
pair('drives', V.drivesPage);
pair('volunteer', V.volunteerPage);
pair('toolkits', V.toolkitsPage);
pair('news', V.newsListPage);
pair('media', V.mediaPage);
pair('give', V.givePage);
pair('newsletter', V.newsletterPage);
pair('contact', V.contactPage);
pair('privacy', (c, l) => V.prosePage(c, l, 'privacy'));
pair('ethics', (c, l) => V.prosePage(c, l, 'ethics'));

const stamp = buildDate;
const icsEvent = (e, lang) => ({ uid: `${e.id}@lapaixducoeur.ca`, start: e.start, end: e.end, summary: `${e[lang].title}`,
  description: `${plain(e[lang].summary)}\n${e.sample ? T[lang].sample + '\n' : ''}${site}${e.url[lang]}`, location: plain(e[lang].address), url: `${site}${e.url[lang]}`, category: T[lang].types[e.type] });

for (const e of events) {
  for (const lang of LANGS) {
    const other = lang === 'fr' ? 'en' : 'fr';
    emit(lang, e.url[lang], e.url[other], 'events', V.eventPage(ctx, lang, e));
    write(e.ics[lang].slice(1), icsCalendar({ name: e[lang].title, events: [icsEvent(e, lang)], stamp }));
  }
}
for (const n of news) for (const lang of LANGS) emit(lang, n.url[lang], n.url[lang === 'fr' ? 'en' : 'fr'], 'news', V.articlePage(ctx, lang, n));

const auds = { fr: pages.toolkits.fr.audiences, en: pages.toolkits.en.audiences };
for (const lang of LANGS) {
  const other = lang === 'fr' ? 'en' : 'fr';
  for (const a of auds[lang]) {
    const twin = auds[other].find((x) => x.key === a.key) || auds[other][0];
    const paths = V.toolkitPaths(lang, a);
    emit(lang, paths.page, V.toolkitPaths(other, twin).page, 'toolkits', V.toolkitPrintPage(ctx, lang, a));
    write(paths.txt.slice(1), '﻿' + V.checklistTxt(lang, a, ctx));
  }
}

/* ------------------------------------------------------------------ calendars */
const upcoming = events.filter((e) => !e.past);
for (const lang of LANGS) {
  const feed = icsCalendar({ name: ctx.sub[lang].name, description: settings[lang].tagline, events: upcoming.map((e) => icsEvent(e, lang)), stamp });
  write(FEEDS.ics[lang].slice(1), feed);
  write(FEEDS.sub[lang].slice(1), feed);
}
write(FEEDS.combined.slice(1), icsCalendar({
  name: 'La Paix du Cœur — Calendrier / Calendar', description: `${settings.fr.tagline} / ${settings.en.tagline}`, stamp,
  events: upcoming.map((e) => ({ ...icsEvent(e, 'fr'), summary: `${e.fr.title} / ${e.en.title}`,
    description: `${plain(e.fr.summary)}\n${site}${e.url.fr}\n\n${plain(e.en.summary)}\n${site}${e.url.en}${e.sample ? `\n\n${T.fr.sample} / ${T.en.sample}` : ''}`,
    category: `${T.fr.types[e.type]} / ${T.en.types[e.type]}` })),
}));

/* ------------------------------------------------------------------ RSS */
for (const lang of LANGS) {
  const items = news.map((n) => `<item><title>${esc(n[lang].title)}</title><link>${site}${n.url[lang]}</link><guid isPermaLink="true">${site}${n.url[lang]}</guid>
<pubDate>${toUtc(n.date + 'T09:00').toUTCString()}</pubDate><category>${esc(T[lang].cats[n.category])}</category><description>${esc(n[lang].summary)}</description></item>`).join('\n');
  write(FEEDS.rss[lang].slice(1), `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>La Paix du Cœur — ${lang === 'fr' ? 'Nouvelles' : 'News'}</title><link>${site}${ROUTES.news[lang]}</link>
<atom:link href="${site}${FEEDS.rss[lang]}" rel="self" type="application/rss+xml"/>
<description>${esc(pages.news[lang].meta_description)}</description><language>${T[lang].locale.toLowerCase()}</language>
<lastBuildDate>${buildDate.toUTCString()}</lastBuildDate>
${items}
</channel></rss>
`);
}

/* ------------------------------------------------------------------ root chooser, 404 */
write('index.html', `<!doctype html>
<html lang="fr-CA">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>La Paix du Cœur — Kimia Na Motema · Montréal</title>
<meta name="description" content="Association chrétienne à Montréal depuis 2014 / A Christian charity in Montréal since 2014. Choisissez votre langue — Choose your language.">
<link rel="canonical" href="${site}/">
<link rel="alternate" hreflang="fr-CA" href="${site}/fr/"><link rel="alternate" hreflang="en-CA" href="${site}/en/"><link rel="alternate" hreflang="x-default" href="${site}/">
<meta property="og:type" content="website"><meta property="og:title" content="La Paix du Cœur — Kimia Na Motema"><meta property="og:description" content="${esc(settings.fr.tagline)}"><meta property="og:url" content="${site}/"><meta property="og:image" content="${site}/assets/img/og-card.jpg">
<meta name="theme-color" content="#2F4A3F"><link rel="icon" href="/favicon.ico" sizes="any"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/assets/css/site.css?v=${v.css}">
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': [V.orgNode(ctx), { '@type': 'WebSite', '@id': `${site}/#site`, name: 'La Paix du Cœur', url: `${site}/`, inLanguage: ['fr-CA', 'en-CA'], publisher: { '@id': `${site}/#org` } }] })}</script>
</head>
<body class="is-chooser"><main id="contenu" class="chooser">
<div class="chooser-card">
<picture><source type="image/webp" srcset="/assets/img/logo-192.webp 1x, /assets/img/logo-320.webp 2x"><img src="/assets/img/logo-192.png" width="160" height="139" alt="Logo de La Paix du Cœur : un cœur vert tenu par deux mains / La Paix du Cœur logo: a green heart held in two hands"></picture>
<h1>La Paix du Cœur <span>Kimia Na Motema</span></h1>
<p class="label">Montréal · 2014</p>
<ul class="chooser-links">
<li><a class="btn btn-pine" href="/fr/" hreflang="fr-CA" lang="fr">Entrer en français</a></li>
<li><a class="btn btn-ghost" href="/en/" hreflang="en-CA" lang="en">Enter in English</a></li>
</ul>
</div></main>
${'<div class="knit-band" aria-hidden="true"></div>'}
</body></html>
`);
sitemap.push({ path: '/', lang: 'x', alt: null });

write('404.html', `<!doctype html><html lang="fr-CA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Page introuvable / Page not found — La Paix du Cœur</title><meta name="description" content="Page introuvable / Page not found.">
<link rel="stylesheet" href="/assets/css/site.css?v=${v.css}"><link rel="icon" href="/favicon.ico" sizes="any"></head>
<body class="is-chooser"><main id="contenu" class="chooser"><div class="chooser-card">
<p class="label">404</p><h1>${T.fr.notFoundTitle} <span lang="en">${T.en.notFoundTitle}</span></h1>
<p>${T.fr.notFoundText}<br><span lang="en">${T.en.notFoundText}</span></p>
<ul class="chooser-links"><li><a class="btn btn-pine" href="/fr/">Accueil</a></li><li><a class="btn btn-ghost" href="/en/" lang="en">Home</a></li></ul>
</div></main></body></html>
`);

/* ------------------------------------------------------------------ sitemap, robots, headers */
const lastmod = todayStr;
const urlEntry = ({ path, lang, alt }) => {
  if (lang === 'x') return `<url><loc>${site}/</loc><lastmod>${lastmod}</lastmod><xhtml:link rel="alternate" hreflang="fr-CA" href="${site}/fr/"/><xhtml:link rel="alternate" hreflang="en-CA" href="${site}/en/"/><xhtml:link rel="alternate" hreflang="x-default" href="${site}/"/></url>`;
  const fr = lang === 'fr' ? path : alt; const en = lang === 'en' ? path : alt;
  const xd = fr === '/fr/' ? '/' : fr;
  return `<url><loc>${site}${path}</loc><lastmod>${lastmod}</lastmod><xhtml:link rel="alternate" hreflang="fr-CA" href="${site}${fr}"/><xhtml:link rel="alternate" hreflang="en-CA" href="${site}${en}"/><xhtml:link rel="alternate" hreflang="x-default" href="${site}${xd}"/></url>`;
};
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${sitemap.map(urlEntry).join('\n')}
</urlset>
`);
write('robots.txt', `User-agent: *\nAllow: /\nDisallow: /admin/\n\nSitemap: ${site}/sitemap.xml\n`);
write('_headers', readFileSync(join(ROOT, 'src/headers.txt'), 'utf8'));

console.log(`Built ${sitemap.length} pages, ${events.length} events, ${news.length} news, ${drops.length} drop-off points -> dist/ (today = ${todayStr})`);

/** French typography: narrow no-break space inside « guillemets » (text nodes only). */
function frenchSpacing(html) {
  return html.replace(/>([^<]*)</g, (m, text) => '>' + text.replace(/«[ \u00a0\u202f]?(?=\S)/g, '«\u202f').replace(/(\S)[ \u00a0\u202f]?»/g, '$1\u202f»') + '<');
}

/* ------------------------------------------------------------------ knit band generator */
function knitSvg({ bg, base, motif }) {
  const heart = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...', '.......'];
  const flake = ['X..X..X', '.X.X.X.', '..XXX..', 'XXX.XXX', '..XXX..', '.X.X.X.', 'X..X..X'];
  const cols = 18; const rows = motif ? 13 : 4; const cw = 8; const ch = 7;
  const grid = Array.from({ length: rows }, () => Array(cols).fill(0));
  if (motif) {
    for (let x = 0; x < cols; x++) { grid[0][x] = x % 2 ? 0 : 1; grid[12][x] = x % 2 ? 1 : 0; grid[1][x] = 0; }
    const put = (shape, ox, oy, val) => shape.forEach((r, y) => [...r].forEach((c, x) => { if (c === 'X') grid[oy + y][ox + x] = val; }));
    put(heart, 1, 3, 2); put(flake, 10, 3, 1);
  }
  const stitch = (x, y, color) => `<path d="M${x * cw + 0.8} ${y * ch + 0.6}q${cw / 4} ${ch * 0.95} ${cw / 2 - 0.8} ${ch - 0.4}q${cw / 4 - 0.4} ${-ch * 0.05} ${cw / 2 - 0.8} ${-ch + 0.4}" stroke="${color}"/>`;
  let out = '';
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const val = grid[y][x];
    const color = val === 0 ? base : motif[val === 2 ? 1 : 0];
    out += stitch(x, y, color);
  }
  const W = cols * cw; const H = rows * ch;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${bg}"/><g fill="none" stroke-width="2.2" stroke-linecap="round">${out}</g></svg>`;
}
