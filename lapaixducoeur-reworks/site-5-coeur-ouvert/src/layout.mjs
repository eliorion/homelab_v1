import { ROUTES, UI } from './i18n.mjs';
import { esc, t, icon, typo, inline } from './lib.mjs';

export const ctx = { site: '', settings: null, assetV: {}, banner: null };

const abs = (p) => ctx.site + p;
const asset = (p) => `${p}?v=${ctx.assetV[p] || '1'}`;

const SOMMAIRE = [
  ['understand', ['home', 'about', 'missions']],
  ['act', ['campaigns', 'give', 'ambassadors', 'cards']],
  ['follow', ['news', 'events', 'videos', 'media', 'press', 'contact']],
];

export function orgLD() {
  const s = ctx.settings.fr;
  const sameAs = (s.social || []).map((x) => x.url).filter(Boolean);
  return {
    '@type': 'NGO',
    '@id': abs('/#org'),
    name: 'La Paix du Cœur',
    alternateName: ['Kimia Na Motema', 'Association chrétienne La Paix du Cœur'],
    url: abs('/'),
    logo: abs('/assets/img/logo.png'),
    image: abs('/assets/img/og-fr.jpg'),
    description: 'Association chrétienne fondée en 2014 à Montréal qui offre gratuitement une aide alimentaire, vestimentaire, scolaire et matérielle aux orphelins, aux veuves, aux démunis et aux sans-abri.',
    email: s.email,
    foundingDate: '2014',
    foundingLocation: { '@type': 'Place', name: 'Montréal, QC, Canada' },
    address: { '@type': 'PostalAddress', addressLocality: 'Montréal', addressRegion: 'QC', addressCountry: 'CA' },
    areaServed: { '@type': 'Country', name: 'Canada' },
    knowsLanguage: ['fr-CA', 'en-CA'],
    ...(sameAs.length ? { sameAs } : {}),
    potentialAction: {
      '@type': 'DonateAction',
      name: 'Faire un don / Give',
      target: [abs(ROUTES.give.fr), abs(ROUTES.give.en)],
      recipient: { '@id': abs('/#org') },
    },
  };
}

export function crumbsLD(crumbs) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: abs(c.url) })),
  };
}

function crumbsHTML(crumbs, lang) {
  if (!crumbs || crumbs.length < 2) return '';
  const L = UI[lang];
  return `<nav class="crumbs wrap" aria-label="${esc(L.breadcrumb)}"><ol>${crumbs.map((c, i) => i === crumbs.length - 1
    ? `<li><span aria-current="page">${t(c.name, lang)}</span></li>`
    : `<li><a href="${c.url}">${t(c.name, lang)}</a></li>`).join('')}</ol></nav>`;
}

function bannerHTML(lang, key) {
  const b = ctx.banner;
  if (!b || !b[lang] || key.startsWith('campaign')) return '';
  const { text, url, days } = b[lang];
  const L = UI[lang];
  return `<a class="ticker" href="${url}"><span class="ticker__dot" aria-hidden="true"></span><span class="ticker__text">${t(text, lang)}</span><span class="ticker__days"><span data-days-left>${days}</span>&nbsp;${esc(L.noJsCountdown)}</span><span class="ticker__cta">${esc(L.seeCampaign)} ${icon('arrow')}</span></a>`;
}

function header(lang, key, alt) {
  const L = UI[lang];
  const o = L.other;
  const navItem = (k, i) => {
    const cur = k === key || key.startsWith(`${k}:`) || (k === 'campaigns' && key.startsWith('campaign'));
    return `<li><a href="${ROUTES[k][lang]}"${cur ? ' aria-current="page"' : ''}><span class="sommaire__num" aria-hidden="true">${String(i).padStart(2, '0')}</span><span class="sommaire__label">${t(L.nav[k], lang)}</span></a></li>`;
  };
  let n = 0;
  const groups = SOMMAIRE.map(([g, keys]) => `<div class="sommaire__group"><p class="sommaire__head">${t(L.navGroups[g], lang)}</p><ul>${keys.map((k) => navItem(k, ++n)).join('')}</ul></div>`).join('');
  const s = ctx.settings[lang];
  const quick = ['campaigns', 'ambassadors', 'news', 'events'].map((k) => {
    const cur = k === key || (k === 'campaigns' && key.startsWith('campaign')) || key.startsWith(`${k.replace(/s$/, '')}:`);
    return `<li><a href="${ROUTES[k][lang]}"${cur ? ' aria-current="page"' : ''}>${t(L.nav[k], lang)}</a></li>`;
  }).join('');
  return `${bannerHTML(lang, key)}
<header class="masthead">
  <div class="masthead__bar wrap">
    <a class="brand" href="${ROUTES.home[lang]}" aria-label="${esc(L.homeLink)}">
      <img class="brand__mark" src="/assets/img/logo-mark-160.png" alt="" width="160" height="143">
      <span class="brand__text"><span class="brand__name">La Paix du Cœur</span><span class="brand__sub">Kimia Na Motema</span></span>
    </a>
    <nav class="quicknav" aria-label="${lang === 'fr' ? 'Navigation rapide' : 'Quick navigation'}"><ul>${quick}</ul></nav>
    <div class="masthead__tools">
      <a class="lang" href="${alt[o]}" hreflang="${o}-CA" lang="${o}"><span class="vh">${esc(L.otherName)} — </span><span aria-hidden="true">${L.otherShort}</span></a>
      <a class="btn btn--coral btn--sm masthead__give" href="${ROUTES.give[lang]}">${esc(L.donate)}</a>
      <a class="menu-btn" href="#sommaire" data-menu aria-controls="sommaire" aria-expanded="false"><span class="menu-btn__label">${esc(L.menu)}</span><span class="menu-btn__bars" aria-hidden="true"><span></span><span></span></span></a>
    </div>
  </div>
</header>
<div id="sommaire" class="sommaire" role="dialog" aria-modal="true" aria-label="${esc(L.menu)}">
  <div class="sommaire__inner wrap">
    <div class="sommaire__top">
      <p class="sommaire__title" aria-hidden="true">${esc(L.menu)}</p>
      <a class="sommaire__close" href="#main" data-menu-close>${icon('close')}<span>${esc(L.close)}</span></a>
    </div>
    <nav class="sommaire__nav" aria-label="${esc(L.menu)}">${groups}</nav>
    <aside class="sommaire__aside">
      <p class="kicker">${esc(L.verseWeek)}</p>
      <blockquote class="sommaire__verse"><p>${t(s.verse_of_week.text, lang)}</p><cite>${t(s.verse_of_week.ref, lang)}</cite></blockquote>
      <p><a class="link-arrow" href="mailto:${esc(s.email)}">${icon('mail')} ${esc(s.email)}</a></p>
      <p><a class="link-arrow" href="${alt[o]}" hreflang="${o}-CA" lang="${o}">${esc(L.otherName)} ${icon('arrow')}</a></p>
    </aside>
  </div>
</div>`;
}

export function newsletterForm(lang, id = 'nl') {
  const L = UI[lang];
  return `<form class="form form--inline" action="/api/newsletter" method="post" data-form data-thanks="${esc(L.thanksNews)}">
  <!-- Turnstile: <div class="cf-turnstile" data-sitekey="TURNSTILE_SITE_KEY"></div> — verified server-side by the Pages Function -->
  <div class="hp" aria-hidden="true"><label for="${id}-website">${esc(L.honeypot)}</label><input id="${id}-website" name="website" type="text" tabindex="-1" autocomplete="off"></div>
  <div class="field field--grow"><label for="${id}-email">${esc(L.email)}</label><input id="${id}-email" name="email" type="email" autocomplete="email" required></div>
  <fieldset class="checks"><legend>${esc(L.topics)}</legend>${L.topicList.map((tp, i) => `<label><input type="checkbox" name="topics" value="${esc(tp)}"${i < 2 ? ' checked' : ''}> ${esc(tp)}</label>`).join('')}</fieldset>
  <label class="consent"><input type="checkbox" name="consent" required> <span>${t(L.consent, lang)}</span></label>
  <button class="btn btn--coral" type="submit">${esc(L.subscribe)}</button>
</form>`;
}

function footer(lang, alt) {
  const L = UI[lang];
  const s = ctx.settings[lang];
  const link = (k) => `<li><a href="${ROUTES[k][lang]}">${t(L.nav[k], lang)}</a></li>`;
  const social = (s.social || []).map((x) => x.url
    ? `<li><a href="${esc(x.url)}" rel="noopener">${esc(x.name)}</a></li>`
    : `<li>${esc(x.name)}\u00A0<span class="tbc">${esc(L.tbc)}</span></li>`).join('');
  const year = 2026;
  return `<footer class="site-footer">
  <div class="wrap">
    <p class="footer-big"><span>${t(L.footerBig[0], lang)}</span> <span class="footer-big__accent">${t(L.footerBig[1], lang)}</span></p>
    <div class="footer-grid">
      <div class="footer-about">
        <img class="footer-logo" src="/assets/img/logo.png" alt="La Paix du Cœur — Kimia Na Motema" width="480" height="416" loading="lazy">
        <p>${t(L.footerAbout, lang)}</p>
        <p><a href="mailto:${esc(s.email)}">${esc(s.email)}</a></p>
      </div>
      <nav class="footer-col" aria-label="${esc(L.navGroups.act)}"><p class="footer-head">${esc(L.navGroups.act)}</p><ul>${['campaigns', 'give', 'ambassadors', 'cards', 'contact'].map(link).join('')}</ul></nav>
      <nav class="footer-col" aria-label="${esc(L.navGroups.follow)}"><p class="footer-head">${esc(L.navGroups.follow)}</p><ul>${['about', 'missions', 'news', 'events', 'videos', 'media', 'press'].map(link).join('')}</ul></nav>
      <div class="footer-news">
        <p class="footer-head">${esc(L.newsletter)}</p>
        <p class="footer-news__title">${t(L.newsletterTitle, lang)}</p>
        <p class="footer-news__blurb">${t(s.newsletter_blurb, lang)}</p>
        ${newsletterForm(lang, 'nl-footer')}
      </div>
    </div>
    <div class="footer-bottom">
      <p>© ${year} La Paix du Cœur — Kimia Na Motema. ${esc(L.rights)} ${esc(L.charity)}${lang === 'fr' ? '\u202F:' : ':'} ${inline(s.charity_number, lang)}</p>
      <ul class="footer-legal">
        <li><a href="${ROUTES.privacy[lang]}">${esc(L.privacyLink)}</a></li>
        <li><a href="${ROUTES.press[lang]}">${esc(L.pressLink)}</a></li>
        <li><a href="${ROUTES.news[lang]}feed.xml">${esc(L.rss)}</a></li>
        <li class="footer-social"><span class="vh">${esc(L.social)}${lang === 'fr' ? '\u202F:' : ':'} </span><ul>${social}</ul></li>
        <li><a href="${alt[L.other]}" hreflang="${L.other}-CA" lang="${L.other}">${esc(L.otherName)}</a></li>
      </ul>
    </div>
  </div>
</footer>`;
}

export function layout(p) {
  const { lang, key, alt, body, crumbs = [], ld = [], scripts = [], bodyClass = '' } = p;
  const L = UI[lang];
  const s = ctx.settings[lang];
  const title = p.fullTitle ? p.title : `${p.title} | La Paix du Cœur`;
  const url = alt[lang];
  const ogImg = p.ogImage || (lang === 'fr' ? '/assets/img/og-fr.jpg' : '/assets/img/og-en.jpg');
  const graph = [orgLD(), {
    '@type': p.pageType || 'WebPage', '@id': abs(url) + '#page', url: abs(url), name: typo(title, lang),
    description: typo(p.description, lang), inLanguage: L.locale, isPartOf: { '@type': 'WebSite', '@id': abs('/#site'), name: 'La Paix du Cœur', url: abs('/') }, about: { '@id': abs('/#org') },
  }];
  if (crumbs.length > 1) graph.push(crumbsLD(crumbs));
  graph.push(...ld);
  const ldJSON = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
  const feed = `${ROUTES.news[lang]}feed.xml`;
  return `<!doctype html>
<html lang="${L.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t(title, lang)}</title>
<meta name="description" content="${t(p.description, lang)}">
<link rel="canonical" href="${abs(url)}">
<link rel="alternate" hreflang="fr-CA" href="${abs(alt.fr)}">
<link rel="alternate" hreflang="en-CA" href="${abs(alt.en)}">
<link rel="alternate" hreflang="x-default" href="${abs(alt.xdefault || alt.fr)}">
<link rel="alternate" type="application/rss+xml" title="La Paix du Cœur — ${esc(L.nav.news)}" href="${feed}">
<meta property="og:type" content="${p.ogType || 'website'}">
<meta property="og:site_name" content="La Paix du Cœur">
<meta property="og:title" content="${t(p.ogTitle || p.title, lang)}">
<meta property="og:description" content="${t(p.description, lang)}">
<meta property="og:url" content="${abs(url)}">
<meta property="og:image" content="${abs(ogImg)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="${lang === 'fr' ? 'fr_CA' : 'en_CA'}">
<meta property="og:locale:alternate" content="${lang === 'fr' ? 'en_CA' : 'fr_CA'}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#141414">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preload" href="/assets/fonts/anton-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/source-serif-4-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${asset('/assets/css/site.css')}">
<script src="${asset('/assets/js/site.js')}" defer></script>
${scripts.map((sc) => `<script src="${asset(sc)}" defer></script>`).join('\n')}
<script type="application/ld+json">${ldJSON}</script>
</head>
<body class="${bodyClass}">
<a class="skip" href="#main">${esc(L.skip)}</a>
${header(lang, key, alt)}
${crumbsHTML(crumbs, lang)}
<main id="main" tabindex="-1">
${body}
</main>
${footer(lang, alt)}
</body>
</html>
`;
}

export function pageHero(lang, { num, kicker, heading, lede, sample, extra = '' }) {
  const L = UI[lang];
  return `<header class="page-hero wrap">
  <p class="page-hero__num" aria-hidden="true">${esc(num)}</p>
  <div class="page-hero__body">
    <p class="kicker">${t(kicker, lang)}${sample ? ` <span class="sample">${esc(L.sample)}</span>` : ''}</p>
    <h1 class="page-hero__title display reveal-lines">${t(heading, lang)}</h1>
    ${lede ? `<p class="page-hero__lede">${t(lede, lang)}</p>` : ''}
    ${extra}
  </div>
</header>`;
}

export const sampleBadge = (lang) => `<span class="sample">${esc(UI[lang].sample)}</span>`;
