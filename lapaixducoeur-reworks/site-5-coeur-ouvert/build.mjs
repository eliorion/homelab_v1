#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ROUTES, UI, FEEDS } from './src/i18n.mjs';
import { readJSON, loadDir, pick, writeFile, copyDir, setStaticRoot, esc, typo, isAllDay, localDate } from './src/lib.mjs';
import { ctx, layout, orgLD } from './src/layout.mjs';
import * as P from './src/pages.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');
const C = (...p) => path.join(ROOT, 'content', ...p);
const LANGS = ['fr', 'en'];

const settings = readJSON(C('settings.json'));
const pages = Object.fromEntries(fs.readdirSync(C('pages')).filter((f) => f.endsWith('.json')).map((f) => [f.replace('.json', ''), readJSON(C('pages', f))]));
const news = loadDir(C('news')).filter((n) => !pick(n, 'fr').draft).sort((a, b) => pick(b, 'fr').date.localeCompare(pick(a, 'fr').date));
const events = loadDir(C('events')).sort((a, b) => pick(a, 'fr').start.localeCompare(pick(b, 'fr').start));
const media = loadDir(C('media')).sort((a, b) => (pick(a, 'fr').order || 0) - (pick(b, 'fr').order || 0));
const campaigns = loadDir(C('campaigns')).sort((a, b) => (pick(a, 'fr').status === 'active' ? -1 : 1) - (pick(b, 'fr').status === 'active' ? -1 : 1));
const D = { settings, pages, news, events, media, campaigns };

const SITE = settings.fr.site_url.replace(/\/$/, '');
ctx.site = SITE;
ctx.settings = settings;
ctx.now = process.env.BUILD_DATE ? new Date(process.env.BUILD_DATE) : new Date();

/* 1. clean + static assets */
fs.rmSync(DIST, { recursive: true, force: true });
copyDir(path.join(ROOT, 'static'), DIST);
copyDir(path.join(ROOT, 'src', 'css'), path.join(DIST, 'assets', 'css'));
copyDir(path.join(ROOT, 'src', 'js'), path.join(DIST, 'assets', 'js'));
copyDir(path.join(ROOT, 'admin'), path.join(DIST, 'admin'));
setStaticRoot(path.join(ROOT, 'static'));
for (const f of ['/assets/css/site.css', '/assets/js/site.js', '/assets/js/campaign.js', '/assets/js/cards.js']) {
  const file = path.join(DIST, f);
  if (fs.existsSync(file)) ctx.assetV[f] = crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 8);
}

/* 2. campaign ticker banner */
const bannerCfg = settings.fr.banner;
if (bannerCfg && bannerCfg.enabled) {
  const camp = campaigns.find((c) => c.id === bannerCfg.campaign || pick(c, 'fr').slug === bannerCfg.campaign);
  if (camp && pick(camp, 'fr').status === 'active') {
    const days = Math.max(0, Math.floor((new Date(pick(camp, 'fr').end) - ctx.now) / 864e5));
    ctx.banner = Object.fromEntries(LANGS.map((l) => [l, { text: settings[l].banner.text, url: P.urlFor('campaign', camp, l), days }]));
  }
}

/* 3. pages */
const sitemap = [];
let count = 0;
function emit(key, alt, render) {
  for (const lang of LANGS) {
    const params = render(lang);
    const html = layout({ ...params, lang, key, alt });
    writeFile(path.join(DIST, alt[lang], 'index.html'), html);
    count++;
  }
  sitemap.push(alt);
}
const statics = [
  ['home', P.home], ['about', P.about], ['missions', P.missions], ['news', P.newsList], ['events', P.eventsList],
  ['media', P.media], ['videos', P.videos], ['give', P.give], ['campaigns', P.campaignsList], ['ambassadors', P.ambassadors],
  ['cards', P.cards], ['press', P.press], ['contact', P.contact], ['privacy', P.privacy],
];
for (const [key, fn] of statics) emit(key, { ...ROUTES[key], ...(key === 'home' ? { xdefault: '/' } : {}) }, (lang) => fn(lang, D));
for (const n of news) emit(`news:${n.id}`, { fr: P.urlFor('news', n, 'fr'), en: P.urlFor('news', n, 'en') }, (lang) => P.article(lang, D, n));
for (const e of events) emit(`event:${e.id}`, { fr: P.urlFor('event', e, 'fr'), en: P.urlFor('event', e, 'en') }, (lang) => P.eventPage(lang, D, e));
for (const c of campaigns) emit(`campaign:${c.id}`, { fr: P.urlFor('campaign', c, 'fr'), en: P.urlFor('campaign', c, 'en') }, (lang) => P.campaignPage(lang, D, c));

/* 4. iCalendar files: one per event per language, plus subscribable feeds */
const icsEsc = (s) => typo(String(s), 'x').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
const icsDate = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsDay = (iso, plus = 0) => { const d = new Date(`${localDate(iso)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + plus); return d.toISOString().slice(0, 10).replace(/-/g, ''); };
const fold = (line) => {
  const out = []; let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > 75) { out.push(cur); cur = ` ${ch}`; } else cur += ch;
  }
  out.push(cur);
  return out.join('\r\n');
};
const ics = (lines) => `${lines.map(fold).join('\r\n')}\r\n`;
const calHead = (name) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//La Paix du Coeur//Site//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
  ...(name ? [`X-WR-CALNAME:${icsEsc(name)}`, 'X-WR-TIMEZONE:America/Toronto', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H'] : [])];
function vevent(ev, lang) {
  const e = pick(ev, lang);
  const url = P.urlFor('event', ev, lang);
  const where = e.address && e.address !== e.location ? `${e.location} — ${e.address}` : e.location;
  const when = isAllDay(e) ? [`DTSTART;VALUE=DATE:${icsDay(e.start)}`, `DTEND;VALUE=DATE:${icsDay(e.end, 1)}`] : [`DTSTART:${icsDate(e.start)}`, `DTEND:${icsDate(e.end)}`];
  return ['BEGIN:VEVENT', `UID:${ev.id}@lapaixducoeur.ca`, `DTSTAMP:${icsDate(ctx.now.toISOString())}`, ...when,
    `SUMMARY:${icsEsc(e.title)}${e.sample ? icsEsc(lang === 'fr' ? ' (exemple)' : ' (sample)') : ''}`, `DESCRIPTION:${icsEsc(`${e.summary}\n\n${SITE}${url}`)}`,
    `LOCATION:${icsEsc(where)}`, `URL:${SITE}${url}`, 'ORGANIZER;CN=La Paix du Coeur:mailto:lapaixducoeur.ca@gmail.com', 'END:VEVENT'];
}
for (const ev of events) {
  for (const lang of LANGS) {
    writeFile(path.join(DIST, P.urlFor('event', ev, lang).replace(/\/$/, '.ics')), ics([...calHead(), ...vevent(ev, lang), 'END:VCALENDAR']));
  }
}
const upcoming = P.upcomingEvents(D);
for (const [file, lang] of [[FEEDS.fr, 'fr'], [FEEDS.en, 'en'], [FEEDS.all, 'fr']]) {
  writeFile(path.join(DIST, file), ics([...calHead(UI[lang].feedName), ...upcoming.flatMap((ev) => vevent(ev, lang)), 'END:VCALENDAR']));
}

/* 5. RSS per language */
for (const lang of LANGS) {
  const L = UI[lang];
  const items = news.map((n) => {
    const e = pick(n, lang); const u = SITE + P.urlFor('news', n, lang);
    return `<item><title>${esc(typo(e.title, lang))}</title><link>${u}</link><guid>${u}</guid><pubDate>${new Date(`${e.date}T12:00:00-05:00`).toUTCString()}</pubDate><description>${esc(typo(e.excerpt, lang))}</description></item>`;
  }).join('\n');
  writeFile(path.join(DIST, ROUTES.news[lang], 'feed.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>La Paix du Cœur — ${esc(L.nav.news)}</title><link>${SITE}${ROUTES.news[lang]}</link><description>${esc(typo(pages.listings[lang].news.description, lang))}</description><language>${L.locale}</language>
<atom:link href="${SITE}${ROUTES.news[lang]}feed.xml" rel="self" type="application/rss+xml"/>
${items}
</channel></rss>
`);
}

/* 6. root language chooser + 404 */
const head = (title, desc, extra = '') => `<!doctype html>
<html lang="fr-CA">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${extra}
<meta name="theme-color" content="#141414">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/assets/css/site.css?v=${ctx.assetV['/assets/css/site.css']}">
</head>`;
const rootLD = JSON.stringify({ '@context': 'https://schema.org', '@graph': [orgLD(), { '@type': 'WebSite', '@id': `${SITE}/#site`, name: 'La Paix du Cœur', url: `${SITE}/`, inLanguage: ['fr-CA', 'en-CA'], publisher: { '@id': `${SITE}/#org` } }] });
writeFile(path.join(DIST, 'index.html'), `${head('La Paix du Cœur — Kimia Na Motema · Choisir la langue / Choose your language', 'Association chrétienne de Montréal au service des orphelins, des veuves et des démunis. A Christian association in Montréal serving orphans, widows and people in need.', `<link rel="canonical" href="${SITE}/">
<link rel="alternate" hreflang="fr-CA" href="${SITE}/fr/">
<link rel="alternate" hreflang="en-CA" href="${SITE}/en/">
<link rel="alternate" hreflang="x-default" href="${SITE}/">
<meta property="og:type" content="website">
<meta property="og:title" content="La Paix du Cœur — Kimia Na Motema">
<meta property="og:description" content="Défendez le faible et l’orphelin. — Defend the weak and the fatherless.">
<meta property="og:url" content="${SITE}/">
<meta property="og:image" content="${SITE}/assets/img/og-fr.jpg">
<meta property="og:locale" content="fr_CA">
<meta property="og:locale:alternate" content="en_CA">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${rootLD}</script>`)}
<body class="chooser">
<a class="skip" href="#main">Aller au contenu / Skip to content</a>
<main id="main" class="chooser__main" tabindex="-1">
  <img class="chooser__logo" src="/assets/img/logo-mark-160.png" alt="" width="160" height="143">
  <h1 class="chooser__title display">La Paix du Cœur <span>Kimia Na Motema</span></h1>
  <ul class="chooser__langs">
    <li><a href="/fr/" hreflang="fr-CA" lang="fr"><span class="chooser__big display">Français</span><span class="chooser__verse">«&nbsp;Défendez le faible et l’orphelin.&nbsp;» — Ps&nbsp;82:3</span></a></li>
    <li><a href="/en/" hreflang="en-CA" lang="en"><span class="chooser__big display">English</span><span class="chooser__verse">“Defend the weak and the fatherless.” — Ps&nbsp;82:3</span></a></li>
  </ul>
  <p class="chooser__foot">Montréal · 2014</p>
</main>
</body>
</html>
`);
writeFile(path.join(DIST, '404.html'), `${head('Page introuvable / Page not found | La Paix du Cœur', 'Page introuvable. Page not found.', '<meta name="robots" content="noindex">')}
<body class="chooser">
<a class="skip" href="#main">Aller au contenu / Skip to content</a>
<main id="main" class="chooser__main" tabindex="-1">
  <p class="nf__num display" aria-hidden="true">404</p>
  <h1 class="chooser__title display">Page introuvable <span lang="en">Page not found</span></h1>
  <ul class="chooser__langs">
    <li><a href="/fr/" lang="fr"><span class="chooser__big display">Accueil</span><span class="chooser__verse">${esc(UI.fr.notFoundText)}</span></a></li>
    <li><a href="/en/" lang="en"><span class="chooser__big display">Home</span><span class="chooser__verse">${esc(UI.en.notFoundText)}</span></a></li>
  </ul>
</main>
</body>
</html>
`);

/* 7. sitemap */
const today = ctx.now.toISOString().slice(0, 10);
writeFile(path.join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
<url><loc>${SITE}/</loc><lastmod>${today}</lastmod><xhtml:link rel="alternate" hreflang="fr-CA" href="${SITE}/fr/"/><xhtml:link rel="alternate" hreflang="en-CA" href="${SITE}/en/"/><xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/"/></url>
${sitemap.flatMap((alt) => LANGS.map((l) => `<url><loc>${SITE}${alt[l]}</loc><lastmod>${today}</lastmod><xhtml:link rel="alternate" hreflang="fr-CA" href="${SITE}${alt.fr}"/><xhtml:link rel="alternate" hreflang="en-CA" href="${SITE}${alt.en}"/><xhtml:link rel="alternate" hreflang="x-default" href="${SITE}${alt.xdefault || alt.fr}"/></url>`)).join('\n')}
</urlset>
`);
console.log(`Built ${count} pages + root + 404, ${events.length * 2} .ics + 3 feeds (${upcoming.length} upcoming), 2 RSS feeds, sitemap (${sitemap.length * 2 + 1} URLs) -> dist/`);
