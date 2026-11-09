import { esc, inline, fmtDate } from './lib.mjs';
import { ROUTES, FEEDS, T } from './strings.mjs';

const ICONS = {
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15" rx="1.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  pin: '<path d="M12 21s-6.5-6.2-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21Z"/><circle cx="12" cy="9.8" r="2.3"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="1.5"/><path d="m4 7 8 6 8-6"/>',
  rss: '<path d="M5 5a14 14 0 0 1 14 14M5 11a8 8 0 0 1 8 8"/><circle cx="6" cy="18" r="1.3"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="1.5"/><path d="M15.5 8.5V5.8a1.3 1.3 0 0 0-1.3-1.3H5.8a1.3 1.3 0 0 0-1.3 1.3v8.4a1.3 1.3 0 0 0 1.3 1.3h2.7"/>',
  print: '<path d="M7 9V4h10v5M7 17H5a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 5 9h14a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 19 17h-2"/><rect x="7" y="14" width="10" height="6"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  play: '<path d="M8 5.5v13l11-6.5-11-6.5Z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 5h3v14H8zM13 5h3v14h-3z" fill="currentColor" stroke="none"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.6 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10Z"/>',
  check: '<path d="m5 12.5 4.2 4.2L19 7"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  snow: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5"/>',
  share: '<circle cx="6" cy="12" r="2.3"/><circle cx="17.5" cy="6" r="2.3"/><circle cx="17.5" cy="18" r="2.3"/><path d="m8 11 7.5-4M8 13l7.5 4"/>',
  bowl: '<path d="M3.5 11h17a8.5 8.5 0 0 1-17 0ZM8 7c0-1.5 1.5-1.5 1.5-3M12 7c0-1.5 1.5-1.5 1.5-3M16 7c0-1.5 1.5-1.5 1.5-3"/>',
  coat: '<path d="M9 3.5 12 6l3-2.5 4.5 2.5 1.5 8-3 1v6H6v-6l-3-1 1.5-8Z M12 6v14.5"/>',
  book: '<path d="M12 6.5c-2-1.5-5-2-8-1.5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5c-3-.5-6 0-8 1.5Zm0 0v13"/>',
  hands: '<path d="M3 14.5 7.5 12c1-.5 2.2-.3 3 .4l1.5 1.4h3.2a1.3 1.3 0 0 1 0 2.6H11M3 19.5l3.5-1.5h6l6.4-3.6a1.4 1.4 0 0 0-1.4-2.4L14 13.5M12 4.2a2.2 2.2 0 0 1 3.8 1.6c0 2.2-3.8 4.2-3.8 4.2S8.2 8 8.2 5.8A2.2 2.2 0 0 1 12 4.2Z"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5.5a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5v-13a.5.5 0 0 1 .5-.5H10"/>',
};
export const icon = (name, cls = 'i') =>
  `<svg class="${cls}" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;

export const sampleBadge = (lang, short = false) => `<span class="badge-sample">${T[lang][short ? 'sampleShort' : 'sample']}</span>`;
export const knitBand = (cls = '') => `<div class="knit-band ${cls}" aria-hidden="true"></div>`;

export function orgNode(ctx) {
  const s = ctx.settings.fr; const site = s.site_url;
  return {
    '@type': 'NGO', '@id': `${site}/#org`, name: 'La Paix du Cœur', alternateName: ['Kimia Na Motema', 'Association chrétienne La Paix du Cœur'],
    url: `${site}/`, logo: `${site}/assets/img/logo-320.png`, image: `${site}/assets/img/og-card.jpg`, email: s.email,
    foundingDate: String(s.founding_year), foundingLocation: { '@type': 'Place', name: 'Montréal, QC, Canada' },
    areaServed: { '@type': 'City', name: 'Montréal' }, knowsLanguage: ['fr-CA', 'en-CA'], nonprofitStatus: 'NonprofitType',
    description: s.tagline,
    potentialAction: { '@type': 'DonateAction', name: 'Faire un don / Give', target: `${site}${ROUTES.give.fr}`, recipient: { '@id': `${site}/#org` } },
  };
}

function header(ctx, lang, key, altPath) {
  const t = T[lang]; const s = ctx.settings[lang];
  const next = ctx.nextEvent;
  const navItems = t.nav.map(([k, label]) => {
    const cur = k === key;
    return `<li><a href="${ROUTES[k][lang]}"${cur ? ' aria-current="page"' : ''}>${label}</a></li>`;
  }).join('');
  const bar = next ? `<div class="topbar"><div class="wrap topbar-in">
      <p class="topbar-next"><span class="label label-inv">${t.nextOuting}</span> <a href="${next.url[lang]}">${esc(next[lang].title)} — ${fmtDate(next.start, lang, { weekday: 'short', day: 'numeric', month: 'short' })}</a></p>
      <p class="topbar-note">${inline(s.announcement)}</p></div></div>` : '';
  return `${bar}<header class="site-header"><div class="wrap header-in">
    <a class="brand" href="${ROUTES.home[lang]}"><picture><source type="image/webp" srcset="/assets/img/logo-96.webp 1x, /assets/img/logo-192.webp 2x"><img src="/assets/img/logo-96.png" width="56" height="49" alt=""></picture><span class="brand-text"><span class="brand-name">La Paix du Cœur</span><span class="brand-sub">Kimia Na Motema</span></span><span class="visually-hidden"> — ${t.home}</span></a>
    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav" data-nav-toggle>${icon('menu')}<span data-label-open>${t.menu}</span><span data-label-close hidden>${t.close}</span></button>
    <nav class="site-nav" id="site-nav" aria-label="${t.mainNav}"><ul>${navItems}</ul></nav>
    <div class="header-actions">
      <a class="lang-switch" href="${altPath}" hreflang="${t.other}-CA" lang="${t.other}" aria-label="${t.switchLabel}"><span aria-hidden="true">${t.otherShort}</span></a>
      <a class="btn btn-maple btn-sm" href="${ROUTES.give[lang]}"${key === 'give' ? ' aria-current="page"' : ''}>${icon('heart')}${t.donate}</a>
    </div></div></header>`;
}

function footer(ctx, lang) {
  const t = T[lang]; const s = ctx.settings[lang];
  const link = (k, label) => `<li><a href="${ROUTES[k][lang]}">${label}</a></li>`;
  const socials = s.social.map((x) => x.url
    ? `<li><a href="${esc(x.url)}" rel="me noopener">${esc(x.network)}</a></li>`
    : `<li>${esc(x.network)} <span class="tbc">${t.socialTbc}</span></li>`).join('');
  return `<footer class="site-footer">${knitBand('knit-footer')}
  <div class="wrap footer-grid">
    <div class="footer-brand">
      <p class="footer-name">La Paix du Cœur <span>Kimia Na Motema</span></p>
      <p>${esc(s.tagline)}</p>
      <figure class="footer-verse"><span class="label label-inv">${t.verseWeek}</span><blockquote><p>${lang === 'fr' ? '«' : '“'}${esc(s.verse_of_week.text)}${lang === 'fr' ? '»' : '”'}</p></blockquote><figcaption>${esc(s.verse_of_week.reference)}</figcaption></figure>
    </div>
    <nav class="footer-cols" aria-label="${t.footerNav}">
      <div><h2 class="label label-inv">${t.footerGetInvolved}</h2><ul>${link('events', t.nav[0][1])}${link('drives', t.nav[1][1])}${link('volunteer', t.nav[2][1])}${link('toolkits', t.nav[3][1])}${link('give', t.donate)}</ul></div>
      <div><h2 class="label label-inv">${t.footerOrg}</h2><ul>${link('about', t.nav[6][1])}${link('missions', t.missions)}${link('news', t.nav[4][1])}${link('media', t.nav[5][1])}${link('ethics', t.ethics)}</ul></div>
      <div><h2 class="label label-inv">${t.footerFollow}</h2><ul>
        <li><a href="mailto:${s.email}">${icon('mail')}${s.email}</a></li>${link('newsletter', t.newsletter)}${link('contact', t.contact)}
        <li><a href="${FEEDS.ics[lang]}">${icon('cal')}${t.calendarFeed}</a></li><li><a href="${FEEDS.rss[lang]}">${icon('rss')}${t.newsFeed}</a></li>${socials}</ul></div>
    </nav>
  </div>
  <div class="wrap footer-legal"><p>© ${ctx.buildDate.getFullYear()} La Paix du Cœur / Kimia Na Motema. ${t.legal} ${inline(t.charityNo)}</p>
    <p><a href="${ROUTES.privacy[lang]}">${t.privacy}</a> · <a href="${ROUTES.ethics[lang]}">${t.ethics}</a></p></div>
</footer>`;
}

export function crumbsHtml(lang, crumbs) {
  if (!crumbs?.length) return '';
  const items = crumbs.map(([label, href], i) => i === crumbs.length - 1
    ? `<li><span aria-current="page">${esc(label)}</span></li>` : `<li><a href="${href}">${esc(label)}</a></li>`).join('');
  return `<nav class="crumbs" aria-label="${T[lang].breadcrumb}"><ol>${items}</ol></nav>`;
}

export function layout(ctx, o) {
  const { lang, key, path, alt, title, description, body, crumbs = [], jsonld = [], scripts = [], bodyClass = '', ogType = 'website', ogImage, xDefault } = o;
  const site = ctx.settings.fr.site_url;
  const t = T[lang];
  const frPath = lang === 'fr' ? path : alt; const enPath = lang === 'en' ? path : alt;
  const img = ogImage ? `${site}${ogImage}` : `${site}/assets/img/og-card.jpg`;
  const graph = [orgNode(ctx), {
    '@type': 'WebPage', '@id': `${site}${path}#page`, url: `${site}${path}`, name: title, description, inLanguage: t.locale,
    isPartOf: { '@type': 'WebSite', '@id': `${site}/#site`, name: 'La Paix du Cœur', url: `${site}/`, publisher: { '@id': `${site}/#org` } },
  }];
  if (crumbs.length) {
    graph.push({ '@type': 'BreadcrumbList', itemListElement: crumbs.map(([name, href], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${site}${href}` })) });
  }
  graph.push(...jsonld);
  const ld = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
  const scriptTags = ['main', ...scripts].map((n) => `<script src="/assets/js/${n}.js?v=${ctx.v[n]}" defer></script>`).join('');
  return `<!doctype html>
<html lang="${t.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${site}${path}">
<link rel="alternate" hreflang="fr-CA" href="${site}${frPath}">
<link rel="alternate" hreflang="en-CA" href="${site}${enPath}">
<link rel="alternate" hreflang="x-default" href="${site}${xDefault || frPath}">
<link rel="alternate" type="application/rss+xml" title="${esc(t.newsFeed)}" href="${FEEDS.rss[lang]}">
<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="La Paix du Cœur">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${site}${path}">
<meta property="og:image" content="${img}">
<meta property="og:image:alt" content="La Paix du Cœur — Kimia Na Motema">
<meta property="og:locale" content="${lang === 'fr' ? 'fr_CA' : 'en_CA'}">
<meta property="og:locale:alternate" content="${lang === 'fr' ? 'en_CA' : 'fr_CA'}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#2F4A3F">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" href="/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preload" href="/assets/fonts/manrope-var.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/css/site.css?v=${ctx.v.css}">
<script type="application/ld+json">${ld}</script>
${scriptTags}
</head>
<body class="${bodyClass}">
<a class="skip-link" href="#contenu">${t.skip}</a>
${header(ctx, lang, key, alt)}
<main id="contenu" tabindex="-1">
${body}
</main>
${footer(ctx, lang)}
</body>
</html>
`;
}

export function pageHead(lang, { eyebrow, title, lead, crumbs, aside = '', cls = '' }) {
  return `<header class="page-head ${cls}"><div class="wrap">
    ${crumbsHtml(lang, crumbs)}
    <div class="page-head-grid"><div class="page-head-text">
      ${eyebrow ? `<p class="label">${esc(eyebrow)}</p>` : ''}
      <h1>${esc(title)}</h1>
      ${lead ? `<p class="lead">${inline(lead)}</p>` : ''}
    </div>${aside ? `<div class="page-head-aside">${aside}</div>` : ''}</div>
  </div></header>`;
}
