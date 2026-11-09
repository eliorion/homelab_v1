import { ROUTES, UI } from './i18n.mjs';
import { esc, t, jsonld } from './lib.mjs';
import { mark, ui } from './svg.mjs';

export function orgLd(S, lang) {
  const base = S.siteUrl;
  return {
    '@type': 'NGO',
    '@id': `${base}/#org`,
    name: 'La Paix du Cœur',
    alternateName: 'Kimia Na Motema',
    url: `${base}/`,
    logo: `${base}/assets/img/logo.png`,
    email: S.email,
    foundingDate: '2014',
    foundingLocation: { '@type': 'Place', name: 'Montréal, QC, Canada' },
    areaServed: [{ '@type': 'City', name: 'Montréal' }, { '@type': 'Country', name: 'Canada' }],
    description: S.tagline,
    knowsLanguage: ['fr-CA', 'en-CA'],
    potentialAction: {
      '@type': 'DonateAction',
      name: lang === 'fr' ? 'Faire un don' : 'Give',
      target: `${base}${ROUTES.give[lang]}`,
      recipient: { '@id': `${base}/#org` },
    },
  };
}

function navItem(lang, key, label, current) {
  const href = ROUTES[key][lang];
  return `<li class="nav__item"><a class="nav__link" href="${href}"${current === key ? ' aria-current="page"' : ''}>${label}</a></li>`;
}
function navGroup(lang, id, parentKey, label, children, current, U) {
  const isCur = children.some(([k]) => k === current);
  return `<li class="nav__item${isCur ? ' is-current' : ''}"><a class="nav__link" href="${ROUTES[parentKey][lang]}"${current === parentKey && !isCur ? ' aria-current="page"' : ''}>${label}</a><button class="nav__toggle" type="button" aria-expanded="false" aria-controls="sub-${id}" hidden><span class="sr-only">${U.submenu} : ${label}</span>${ui.chevron}</button>
<ul class="nav__sub" id="sub-${id}">${children.map(([k, l]) => `<li><a href="${ROUTES[k][lang]}"${current === k ? ' aria-current="page"' : ''}>${l}</a></li>`).join('')}</ul></li>`;
}

export function header(lang, key, altHref) {
  const U = UI[lang], N = U.nav;
  return `<header class="site-header"><div class="wrap site-header__in">
<a class="brand" href="${ROUTES.home[lang]}">${mark}<span><span class="brand__name">La Paix du Cœur</span><span class="brand__alt" lang="ln">Kimia Na Motema</span></span><span class="sr-only"> — ${U.home}</span></a>
<nav class="nav" id="site-nav" aria-label="${U.mainNav}"><ul class="nav__list">
${navGroup(lang, 'about', 'about', N.about, [['about', N.aboutUs], ['story', N.story], ['serve', N.serve]], key, U)}
${navItem(lang, 'missions', N.missions, key)}
${navGroup(lang, 'engage', 'volunteer', N.engage, [['volunteer', N.volunteer], ['workshops', N.workshops], ['events', N.events]], key, U)}
${navItem(lang, 'news', N.news, key)}
${navItem(lang, 'media', N.media, key)}
${navItem(lang, 'contact', N.contact, key)}
</ul><div class="nav__mobile-extra"><a class="btn" href="${ROUTES.give[lang]}">${ui.heart}${U.donate}</a><a class="btn btn--ghost" href="${altHref}" lang="${U.other}" hreflang="${U.other}-CA">${U.otherName}</a></div></nav>
<div class="header-actions">
<a class="lang" href="${altHref}" lang="${U.other}" hreflang="${U.other}-CA" title="${U.switchLabel}"><span aria-hidden="true">${U.otherShort}</span><span class="sr-only">${U.switchLabel}</span></a>
<a class="btn btn--sm header-donate" href="${ROUTES.give[lang]}"${key === 'give' ? ' aria-current="page"' : ''}>${ui.heart}${N.give}</a>
<a class="menu-btn" href="#site-map" data-menu-toggle aria-controls="site-nav">${ui.menu}<span>${U.menu}</span></a>
</div></div></header>`;
}

export function footer(lang, S) {
  const U = UI[lang], N = U.nav, F = U.footer;
  const social = S.social.filter((s) => s.url);
  const year = new Date('2026-11-09').getFullYear();
  return `<footer class="site-footer on-dark"><div class="band" aria-hidden="true"></div>
<div class="wrap footer-top">
<div class="footer-brand">${mark}<p><strong>La Paix du Cœur / <span lang="ln">Kimia Na Motema</span></strong><br>${esc(S.tagline)}</p>
<blockquote class="footer-verse"><span class="sr-only">${F.verse} : </span>${esc(S.verseOfWeek.text)}<small>${F.verse} · ${esc(S.verseOfWeek.ref)}</small></blockquote></div>
<div><h2>${F.explore}</h2><ul id="site-map">
<li><a href="${ROUTES.home[lang]}">${U.home}</a></li><li><a href="${ROUTES.about[lang]}">${N.aboutUs}</a></li><li><a href="${ROUTES.story[lang]}">${N.story}</a></li><li><a href="${ROUTES.missions[lang]}">${N.missions}</a></li><li><a href="${ROUTES.serve[lang]}">${N.serve}</a></li><li><a href="${ROUTES.news[lang]}">${N.news}</a></li><li><a href="${ROUTES.media[lang]}">${N.media}</a></li></ul></div>
<div><h2>${F.engage}</h2><ul>
<li><a href="${ROUTES.volunteer[lang]}">${N.volunteer}</a></li><li><a href="${ROUTES.workshops[lang]}">${N.workshops}</a></li><li><a href="${ROUTES.events[lang]}">${N.events}</a></li><li><a href="${ROUTES.give[lang]}">${N.give}</a></li><li><a href="${ROUTES.contact[lang]}">${N.contact}</a></li><li><a href="mailto:${S.email}">${S.email}</a></li></ul>
<p class="social-tbc">${social.length ? social.map((s) => `<a href="${esc(s.url)}" rel="me">${esc(s.name)}</a>`).join(' · ') : `${S.social.map((s) => esc(s.name)).join(' · ')} ${t(lang === 'fr' ? '[liens à confirmer]' : '[links to confirm]')}`}</p></div>
<div class="newsletter"><h2>${F.newsletter}</h2><p>${esc(S.newsletterIntro)}</p>
<form class="form" data-form="newsletter" action="/api/newsletter" method="post" novalidate data-ok="${esc(F.thanks)}">
<div class="field"><label for="nl-email">${F.email}</label><input id="nl-email" name="email" type="email" autocomplete="email" required placeholder="nom@exemple.ca"><span class="err" id="nl-email-err" aria-live="polite"></span></div>
<label class="check"><input type="checkbox" name="consent" required> <span>${F.consent}</span></label><span class="err" aria-live="polite"></span>
<div class="hp" aria-hidden="true"><label for="nl-website">${U.form.hp}</label><input id="nl-website" name="website" type="text" tabindex="-1" autocomplete="off"></div>
<!-- Turnstile widget goes here in production (sitekey from Cloudflare dashboard). -->
<button class="btn btn--mustard" type="submit">${F.subscribe}</button>
</form></div>
</div>
<div class="wrap footer-bottom"><span>© ${year} La Paix du Cœur / <span lang="ln">Kimia Na Motema</span>. ${F.rights} ${lang === 'fr' ? 'N° d’organisme de bienfaisance' : 'Charity registration no.'} ${t(S.charityNumber)}</span><span><a href="${ROUTES.privacy[lang]}">${N.privacy}</a> · ${F.static}</span></div>
</footer>`;
}

export function crumbs(lang, items) {
  const U = UI[lang];
  return `<nav class="crumbs" aria-label="${U.breadcrumb}"><ol>${items.map((it, i) => i === items.length - 1 ? `<li><span aria-current="page">${esc(it.name)}</span></li>` : `<li><a href="${it.path}">${esc(it.name)}</a></li>`).join('')}</ol></nav>`;
}

export function page(o) {
  const { lang, S, title, description, path, altPath, body, key = '', ld = [], breadcrumbs, scripts = [], ogImage, ogType = 'website', noindex = false } = o;
  const U = UI[lang];
  const base = S.siteUrl;
  const frPath = lang === 'fr' ? path : altPath, enPath = lang === 'en' ? path : altPath;
  const og = `${base}${ogImage || `/assets/og-${lang}.png`}`;
  const graph = [orgLd(S, lang), { '@type': 'WebPage', '@id': `${base}${path}#page`, url: `${base}${path}`, name: title, description, inLanguage: U.locale, isPartOf: { '@type': 'WebSite', '@id': `${base}/#site`, url: `${base}/`, name: 'La Paix du Cœur', publisher: { '@id': `${base}/#org` } }, about: { '@id': `${base}/#org` } }];
  if (breadcrumbs) graph.push({ '@type': 'BreadcrumbList', itemListElement: breadcrumbs.map((b, i) => ({ '@type': 'ListItem', position: i + 1, name: b.name, item: `${base}${b.path}` })) });
  graph.push(...ld);
  return `<!doctype html>
<html lang="${U.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${noindex ? '<meta name="robots" content="noindex">\n' : ''}<link rel="canonical" href="${base}${path}">
<link rel="alternate" hreflang="fr-CA" href="${base}${frPath}">
<link rel="alternate" hreflang="en-CA" href="${base}${enPath}">
<link rel="alternate" hreflang="x-default" href="${base}${key === 'home' ? '/' : frPath}">
<link rel="alternate" type="application/rss+xml" title="${lang === 'fr' ? 'Nouvelles — La Paix du Cœur' : 'News — La Paix du Cœur'}" href="${ROUTES.news[lang]}rss.xml">
<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="La Paix du Cœur — Kimia Na Motema">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${base}${path}">
<meta property="og:image" content="${og}">
<meta property="og:image:alt" content="${lang === 'fr' ? 'Un cœur brodé tenu par deux mains, dans un cercle à broder' : 'An embroidered heart held by two hands, in an embroidery hoop'}">
<meta property="og:locale" content="${lang === 'fr' ? 'fr_CA' : 'en_CA'}">
<meta property="og:locale:alternate" content="${lang === 'fr' ? 'en_CA' : 'fr_CA'}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#4A2545">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="preload" href="/assets/fonts/fraunces.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/nunito.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/css/site.css">
<script src="/assets/js/boot.js"></script>
<script src="/assets/js/site.js" defer></script>
${scripts.map((s) => `<script src="/assets/js/${s}.js" defer></script>`).join('\n')}
${jsonld({ '@context': 'https://schema.org', '@graph': graph })}
</head>
<body class="page-${key || 'x'}" data-lang="${lang}">
<a class="skip" href="#main">${U.skip}</a>
${header(lang, key, altPath)}
<main id="main" tabindex="-1">
${body}
</main>
${footer(lang, S)}
</body>
</html>
`;
}
