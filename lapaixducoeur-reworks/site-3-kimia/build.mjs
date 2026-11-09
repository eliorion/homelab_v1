#!/usr/bin/env node
// Zero-dependency static build: content/ + src/ + static/ + admin/ -> dist/
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, cpSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROUTES, UI } from './src/templates/i18n.mjs';
import { page } from './src/templates/layout.mjs';
import * as P from './src/templates/pages.mjs';
import { illustrations, videoPoster, hoop, stitchedHeart, C } from './src/templates/svg.mjs';
import { isoWithTz, plain, imageUrl, esc, fmtDate } from './src/templates/lib.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, 'dist');
const LANGS = ['fr', 'en'];
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const dir = (d) => readdirSync(join(ROOT, d)).filter((f) => f.endsWith('.json')).sort().map((f) => ({ file: f, data: readJson(join(ROOT, d, f)) }));
const pick = (obj, lang) => ({ ...obj.fr, ...obj[lang] });

function write(rel, content) {
  const p = join(DIST, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}
const writePage = (path, html) => write(path.endsWith('/') ? `${path}index.html` : path, html);

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

const settings = readJson(join(ROOT, 'content/settings.json'));
const pagesRaw = Object.fromEntries(readdirSync(join(ROOT, 'content/pages')).filter((f) => f.endsWith('.json')).map((f) => [f.replace('.json', ''), readJson(join(ROOT, 'content/pages', f))]));
const newsRaw = dir('content/news');
const eventsRaw = dir('content/events');
const mediaRaw = dir('content/media');
const BUILD_DATE = process.env.BUILD_DATE || '2026-11-09';

// ---------- derived content ----------
const icsDate = (local) => local.replace(/[-:]/g, '') + '00';
function gcal(ev, lang, base) {
  const q = new URLSearchParams({ action: 'TEMPLATE', text: ev.title, dates: `${icsDate(ev.start)}/${icsDate(ev.end)}`, ctz: 'America/Toronto', details: `${plain(ev.summary)}\n${base}${ev.url}`, location: plain(ev.venue) });
  return `https://calendar.google.com/calendar/render?${q.toString().replace(/&/g, '&amp;')}`;
}
const data = {};
for (const lang of LANGS) {
  const S = pick(settings, lang);
  const news = newsRaw.map(({ data: d }) => pick(d, lang)).map((n) => ({ ...n, url: `${ROUTES.news[lang]}${n.slug}/` })).sort((a, b) => b.date.localeCompare(a.date));
  const events = eventsRaw.map(({ data: d, file }) => ({ ...pick(d, lang), id: file.replace('.json', '') }))
    .filter((e) => e.end.slice(0, 10) >= BUILD_DATE)
    .map((e) => { const url = `${ROUTES.events[lang]}${e.slug}/`; return { ...e, url, ics: `${ROUTES.events[lang]}${e.slug}.ics` }; })
    .map((e) => ({ ...e, gcal: gcal(e, lang, S.siteUrl) }))
    .sort((a, b) => a.start.localeCompare(b.start));
  const media = mediaRaw.map(({ data: d }) => pick(d, lang)).sort((a, b) => (a.order || 0) - (b.order || 0));
  const pages = Object.fromEntries(Object.entries(pagesRaw).map(([k, v]) => [k, pick(v, lang)]));
  data[lang] = { S, news, events, media, pages };
}
const other = (lang) => (lang === 'fr' ? 'en' : 'fr');

// ---------- ICS ----------
const icsEsc = (s) => plain(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
function fold(line) {
  const out = []; let cur = '';
  for (const ch of line) { if (Buffer.byteLength(cur + ch) > 73) { out.push(cur); cur = ' ' + ch; } else cur += ch; }
  out.push(cur); return out.join('\r\n');
}
const VTZ = ['BEGIN:VTIMEZONE', 'TZID:America/Toronto', 'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0400', 'TZNAME:EDT', 'DTSTART:19700308T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT', 'BEGIN:STANDARD', 'TZOFFSETFROM:-0400', 'TZOFFSETTO:-0500', 'TZNAME:EST', 'DTSTART:19701101T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD', 'END:VTIMEZONE'];
function vevent(ev, S, lang) {
  return ['BEGIN:VEVENT', `UID:${ev.id}-${lang}@lapaixducoeur.ca`, `DTSTAMP:${BUILD_DATE.replace(/-/g, '')}T120000Z`, `DTSTART;TZID=America/Toronto:${icsDate(ev.start)}`, `DTEND;TZID=America/Toronto:${icsDate(ev.end)}`, `SUMMARY:${icsEsc(ev.title)}${ev.sample ? (lang === 'fr' ? ' (exemple)' : ' (sample)') : ''}`, `DESCRIPTION:${icsEsc(`${ev.summary}\n\n${S.siteUrl}${ev.url}`)}`, `LOCATION:${icsEsc(ev.venue)}`, `URL:${S.siteUrl}${ev.url}`, 'END:VEVENT'];
}
const ics = (events, S, lang, name) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//La Paix du Coeur//Site//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${name}`, ...VTZ, ...events.flatMap((e) => vevent(e, S, lang)), 'END:VCALENDAR'].map(fold).join('\r\n') + '\r\n';

// ---------- render ----------
const sitemap = [];
function emit(lang, key, path, altPath, html, extra = {}) {
  const { S } = data[lang];
  writePage(path, page({ lang, S, key, path, altPath, body: html.body, title: html.title, description: html.description, ld: html.ld || [], breadcrumbs: html.breadcrumbs, scripts: html.scripts || [], ogType: html.ogType, ogImage: html.ogImage, ...extra }));
  if (lang === 'fr') sitemap.push({ fr: path, en: altPath, lastmod: html.lastmod || BUILD_DATE });
}
const bc = (lang, ...items) => [{ name: UI[lang].home, path: ROUTES.home[lang] }, ...items];

for (const lang of LANGS) {
  const D = data[lang], O = other(lang), S = D.S, pg = D.pages;
  const simple = (key, renderer, opts = {}) => {
    const p = pg[opts.content || key];
    const body = renderer(lang, { P: p, S, events: D.events, news: D.news, media: D.media, story: pg.story, missions: pg.missions, give: pg.give, volunteer: pg.volunteer });
    const trail = opts.trail || bc(lang, { name: p.title, path: ROUTES[key][lang] });
    emit(lang, key, ROUTES[key][lang], ROUTES[key][O], { body, title: p.metaTitle, description: p.description, breadcrumbs: key === 'home' ? null : trail, scripts: opts.scripts, ld: opts.ld });
  };
  simple('home', P.home, { scripts: [] });
  simple('about', P.about);
  simple('story', P.story, { scripts: ['timeline'], trail: bc(lang, { name: UI[lang].nav.about, path: ROUTES.about[lang] }, { name: pg.story.title, path: ROUTES.story[lang] }) });
  simple('missions', P.missions, { scripts: ['cards'] });
  simple('serve', P.serve, { scripts: ['map'], trail: bc(lang, { name: UI[lang].nav.about, path: ROUTES.about[lang] }, { name: pg.serve.title, path: ROUTES.serve[lang] }) });
  simple('workshops', P.workshops, { ld: D.events.filter((e) => e.category === 'atelier').map((e) => eventLd(e, lang, S)) });
  simple('volunteer', P.volunteer, { scripts: ['volunteer'] });
  simple('events', P.eventsList, { content: 'events', ld: D.events.map((e) => eventLd(e, lang, S)) });
  simple('news', P.newsList, { content: 'news' });
  simple('media', P.mediaPage, { content: 'media', scripts: ['gallery', 'media'] });
  simple('give', P.give, { scripts: ['give'] });
  simple('contact', P.contact);
  simple('privacy', P.privacy);

  // events: detail pages + ics
  D.events.forEach((ev) => {
    const twin = data[O].events.find((e) => e.id === ev.id);
    emit(lang, 'events', ev.url, twin.url, { body: P.eventPage(lang, { ev }), title: `${ev.title} — ${fmtDate(ev.start.slice(0, 10), lang)} | La Paix du Cœur`, description: plain(ev.summary).slice(0, 158), breadcrumbs: bc(lang, { name: UI[lang].nav.events, path: ROUTES.events[lang] }, { name: ev.title, path: ev.url }), ld: [eventLd(ev, lang, S)] });
    write(ev.ics.slice(1), ics([ev], S, lang, ev.title));
  });
  write(`${ROUTES.events[lang].slice(1)}${lang === 'fr' ? 'calendrier' : 'calendar'}.ics`, ics(D.events, S, lang, lang === 'fr' ? 'La Paix du Cœur — Événements' : 'La Paix du Cœur — Events'));

  // news: articles + rss
  D.news.forEach((n, i) => {
    const twin = data[O].news[i];
    const ld = { '@type': 'NewsArticle', '@id': `${S.siteUrl}${n.url}#article`, headline: n.title, description: plain(n.summary), datePublished: `${n.date}T09:00:00-05:00`, dateModified: `${n.date}T09:00:00-05:00`, inLanguage: UI[lang].locale, image: [`${S.siteUrl}${imageUrl(n.image)}`], mainEntityOfPage: `${S.siteUrl}${n.url}`, author: { '@id': `${S.siteUrl}/#org` }, publisher: { '@id': `${S.siteUrl}/#org` }, articleSection: n.category };
    emit(lang, 'news', n.url, twin.url, { body: P.article(lang, { n, prev: D.news[i + 1], next: D.news[i - 1], S }), title: `${n.title} | La Paix du Cœur`, description: plain(n.summary).slice(0, 158), breadcrumbs: bc(lang, { name: UI[lang].nav.news, path: ROUTES.news[lang] }, { name: n.title, path: n.url }), ld: [ld], ogType: 'article', ogImage: imageUrl(n.image), lastmod: n.date });
  });
  const rssItems = D.news.map((n) => `<item><title>${esc(n.title)}</title><link>${S.siteUrl}${n.url}</link><guid isPermaLink="true">${S.siteUrl}${n.url}</guid><pubDate>${new Date(`${n.date}T14:00:00Z`).toUTCString()}</pubDate><description>${esc(plain(n.summary))}</description></item>`).join('\n');
  write(`${ROUTES.news[lang].slice(1)}rss.xml`, `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>La Paix du Cœur — ${lang === 'fr' ? 'Nouvelles' : 'News'}</title><link>${S.siteUrl}${ROUTES.news[lang]}</link><atom:link href="${S.siteUrl}${ROUTES.news[lang]}rss.xml" rel="self" type="application/rss+xml"/><description>${esc(pg.news.description)}</description><language>${UI[lang].locale}</language>\n${rssItems}\n</channel></rss>\n`);

  // 404 (per language)
  writePage(`/${lang}/404.html`, page({ lang, S, key: '404', path: `/${lang}/404.html`, altPath: `/${O}/404.html`, title: `${UI[lang].notFound.title} | La Paix du Cœur`, description: UI[lang].notFound.text, body: P.notFound(lang), noindex: true }));
}

function eventLd(e, lang, S) {
  return {
    '@type': 'Event', '@id': `${S.siteUrl}${e.url}#event`, name: e.title, description: plain(e.summary), url: `${S.siteUrl}${e.url}`, inLanguage: UI[lang].locale,
    startDate: isoWithTz(e.start), endDate: isoWithTz(e.end), eventStatus: 'https://schema.org/EventScheduled', eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: { '@type': 'Place', name: plain(e.venue), address: { '@type': 'PostalAddress', addressLocality: 'Montréal', addressRegion: 'QC', addressCountry: 'CA' } },
    image: [`${S.siteUrl}/assets/og-${lang}.png`], isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'CAD', availability: 'https://schema.org/InStock', url: `${S.siteUrl}${e.url}`, validFrom: `${BUILD_DATE}T00:00:00-05:00` },
    organizer: { '@id': `${S.siteUrl}/#org` }, performer: { '@id': `${S.siteUrl}/#org` },
  };
}

// ---------- root: language chooser + 404 ----------
const base = settings.fr.siteUrl;
writePage('/', `<!doctype html>
<html lang="fr-CA">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>La Paix du Cœur — Kimia Na Motema | Choisir la langue / Choose language</title>
<meta name="description" content="Association chrétienne à Montréal depuis 2014. Christian charity in Montréal since 2014. Français · English.">
<link rel="canonical" href="${base}/">
<link rel="alternate" hreflang="fr-CA" href="${base}/fr/"><link rel="alternate" hreflang="en-CA" href="${base}/en/"><link rel="alternate" hreflang="x-default" href="${base}/">
<meta property="og:type" content="website"><meta property="og:title" content="La Paix du Cœur — Kimia Na Motema"><meta property="og:description" content="Association chrétienne à Montréal depuis 2014 · Christian charity in Montréal since 2014"><meta property="og:url" content="${base}/"><meta property="og:image" content="${base}/assets/og-fr.png">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/assets/css/site.css">
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': [{ '@type': 'NGO', '@id': `${base}/#org`, name: 'La Paix du Cœur', alternateName: 'Kimia Na Motema', url: `${base}/`, logo: `${base}/assets/img/logo.png`, email: settings.fr.email, foundingDate: '2014', potentialAction: { '@type': 'DonateAction', target: `${base}/fr/soutenir/`, recipient: { '@id': `${base}/#org` } } }] })}</script>
</head>
<body><main class="lang-choice" id="main"><div>${hoop({ title: 'La Paix du Cœur — Kimia Na Motema', id: 'lc' })}
<h1>La Paix du Cœur <span class="accent" lang="ln">Kimia Na Motema</span></h1>
<p class="lead">Association chrétienne · Montréal, depuis 2014<br><span lang="en">Christian charity · Montréal, since 2014</span></p>
<div class="btn-row btn-row--center"><a class="btn" href="/fr/" hreflang="fr-CA" lang="fr">Entrer en français</a><a class="btn btn--plum" href="/en/" hreflang="en-CA" lang="en">Enter in English</a></div></div></main></body></html>
`);
sitemap.unshift({ fr: '/fr/', en: '/en/', lastmod: BUILD_DATE, root: true });
// Cloudflare Pages serves /404.html for unknown paths.
cpSync(join(DIST, 'fr/404.html'), join(DIST, '404.html'));

// ---------- sitemap / robots / manifest ----------
const seen = new Set();
const urls = sitemap.filter((u) => !seen.has(u.fr) && seen.add(u.fr)).flatMap((u) => [u.fr, u.en].map((loc) => `<url><loc>${base}${loc}</loc><lastmod>${u.lastmod}</lastmod><xhtml:link rel="alternate" hreflang="fr-CA" href="${base}${u.fr}"/><xhtml:link rel="alternate" hreflang="en-CA" href="${base}${u.en}"/><xhtml:link rel="alternate" hreflang="x-default" href="${base}${u.root ? '/' : u.fr}"/></url>`));
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`);
write('site.webmanifest', JSON.stringify({ name: 'La Paix du Cœur — Kimia Na Motema', short_name: 'Paix du Cœur', start_url: '/fr/', display: 'standalone', background_color: '#FBF3E6', theme_color: '#4A2545', icons: [{ src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }, { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' }] }, null, 2));

// ---------- assets ----------
cpSync(join(ROOT, 'static'), DIST, { recursive: true });
cpSync(join(ROOT, 'src/css'), join(DIST, 'assets/css'), { recursive: true });
cpSync(join(ROOT, 'src/js'), join(DIST, 'assets/js'), { recursive: true });
cpSync(join(ROOT, 'admin'), join(DIST, 'admin'), { recursive: true });
for (const [name, fn] of Object.entries(illustrations)) write(`assets/illustrations/${name}.svg`, fn());
write('assets/illustrations/video-poster.svg', videoPoster());
write('favicon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="${C.cream}" stroke="${C.wood}" stroke-width="4"/>${stitchedHeart(32, 34, 40)}</svg>`);
if (!existsSync(join(DIST, 'assets/og-fr.png'))) console.warn('! static/assets/og-*.png missing (run scripts/og.mjs)');

const count = sitemap.length * 2;
console.log(`Built ${count} localized pages + root, ${data.fr.events.length * 2} event .ics files, 2 RSS feeds -> dist/`);
