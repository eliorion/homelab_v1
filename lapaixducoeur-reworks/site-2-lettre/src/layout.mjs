import { ROUTES, LOCALE, ui } from './i18n.mjs';
import { esc, txt } from './md.mjs';
import { deckle, drawHeart, icon, fleuron } from './svg.mjs';

const FONTS =
  'https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400..700;1,9..40,400&family=Fraunces:ital,opsz,wght,SOFT@0,9..144,300..650,30..100;1,9..144,300..600,30..100&display=swap';

export function ctx(site, assetsVersion) {
  const BASE = site.fr.base_url.replace(/\/$/, '');
  const abs = (p) => (/^https?:/.test(p) ? p : BASE + p);
  const ORG_ID = `${BASE}/#org`;

  function orgLd(lang) {
    const s = site[lang];
    return {
      '@type': 'NGO',
      '@id': ORG_ID,
      name: 'La Paix du Cœur',
      alternateName: ['Kimia Na Motema', 'L’association chrétienne La Paix du Cœur'],
      url: `${BASE}/`,
      logo: abs('/assets/img/logo.png'),
      image: abs('/assets/img/og-default.jpg'),
      email: s.email,
      foundingDate: s.founded,
      foundingLocation: { '@type': 'Place', name: 'Montréal, Québec, Canada' },
      areaServed: { '@type': 'City', name: 'Montréal' },
      description: s.default_description,
      knowsLanguage: ['fr-CA', 'en-CA'],
      nonprofitStatus: 'Nonprofit',
      potentialAction: {
        '@type': 'DonateAction',
        name: lang === 'fr' ? 'Faire un don' : 'Donate',
        target: abs(ROUTES.give[lang]),
        recipient: { '@id': ORG_ID },
      },
    };
  }

  function page(o) {
    const { lang, paths, title, description, content } = o;
    const t = ui(lang);
    const s = site[lang];
    const other = lang === 'fr' ? 'en' : 'fr';
    const url = abs(paths[lang]);
    const image = abs(o.image || '/assets/img/og-default.jpg');
    const graph = [orgLd(lang), {
      '@type': 'WebPage',
      '@id': `${url}#page`,
      url,
      name: title,
      description,
      inLanguage: LOCALE[lang],
      isPartOf: { '@type': 'WebSite', '@id': `${BASE}/#site`, name: 'La Paix du Cœur', url: `${BASE}/`, publisher: { '@id': ORG_ID } },
      about: { '@id': ORG_ID },
    }];
    if (o.crumbs) {
      graph.push({
        '@type': 'BreadcrumbList',
        itemListElement: [{ name: t.home, url: ROUTES.home[lang] }, ...o.crumbs].map((c, i) => ({
          '@type': 'ListItem', position: i + 1, name: c.name, item: abs(c.url),
        })),
      });
    }
    if (o.jsonld) graph.push(...o.jsonld);
    const ld = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
    const rss = lang === 'fr' ? '/fr/nouvelles/rss.xml' : '/en/news/rss.xml';
    const scripts = ['main', ...(o.scripts || [])]
      .map((n) => `<script src="/assets/js/${n}.js?v=${assetsVersion}" defer></script>`).join('');

    return `<!doctype html>
<html lang="${LOCALE[lang]}" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<link rel="alternate" hreflang="fr-CA" href="${abs(paths.fr)}">
<link rel="alternate" hreflang="en-CA" href="${abs(paths.en)}">
<link rel="alternate" hreflang="x-default" href="${abs(paths.fr)}">
<meta property="og:type" content="${o.ogType || 'website'}">
<meta property="og:site_name" content="La Paix du Cœur — Kimia Na Motema">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="${LOCALE[lang].replace('-', '_')}">
<meta property="og:locale:alternate" content="${LOCALE[other].replace('-', '_')}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#FAF5EC">
<link rel="icon" href="/favicon.png" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="alternate" type="application/rss+xml" title="${esc(t.rss)}" href="${rss}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="/assets/css/site.css?v=${assetsVersion}">
${scripts}
<script type="application/ld+json">${ld}</script>
</head>
<body class="${o.bodyClass || ''}">
<a class="skip" href="#main">${t.skip}</a>
${header(lang, o.navKey, paths[other])}
<main id="main" tabindex="-1">
${content}
</main>
${footer(lang)}
</body>
</html>
`;
  }

  function header(lang, navKey, otherPath) {
    const t = ui(lang);
    const other = lang === 'fr' ? 'en' : 'fr';
    const items = ['stories', 'podcast', 'prayer', 'missions', 'events', 'about']
      .map((k) => `<li><a href="${ROUTES[k][lang]}"${navKey === k ? ' aria-current="page"' : ''}>${t.nav[k]}</a></li>`).join('');
    return `<header class="site-header">
<div class="wrap header__inner">
<a class="brand" href="${ROUTES.home[lang]}"><img src="/assets/img/logo-160.png" width="160" height="139" alt="${lang === 'fr' ? 'Logo de La Paix du Cœur : un cœur vert tenu par deux mains' : 'La Paix du Cœur logo: a green heart held in two hands'}"><span class="brand__text"><span class="brand__name">La Paix du Cœur</span><span class="brand__sub">Kimia Na Motema</span></span></a>
<button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav"><span class="nav-toggle__bars" aria-hidden="true"></span><span class="nav-toggle__label">${t.menu}</span></button>
<nav id="site-nav" class="site-nav" aria-label="${t.nav_label}">
<ul class="site-nav__list">${items}</ul>
<div class="site-nav__extra">
<a class="lang-switch" href="${otherPath}" hreflang="${LOCALE[other]}" lang="${other}" title="${t.switch_title}"><span aria-hidden="true">${t.switch_short}</span><span class="sr-only">${t.switch_label}</span></a>
<a class="btn btn--give" href="${ROUTES.give[lang]}"${navKey === 'give' ? ' aria-current="page"' : ''}>${icon('heart')}<span>${t.give}</span></a>
</div>
</nav>
</div>
</header>`;
  }

  function footer(lang) {
    const t = ui(lang);
    const s = { ...site.fr, ...site[lang] };
    const R = (k) => ROUTES[k][lang];
    const social = (site.fr.social || []).map((x) =>
      x.url ? `<li><a href="${esc(x.url)}" rel="noopener">${esc(x.name)}</a></li>`
        : `<li>${esc(x.name)} <span class="tbc">${t.tbc}</span></li>`).join('');
    return `<footer class="site-footer">
${deckle('top', 31)}
<div class="wrap footer__grid">
<div class="footer__brand">
<img src="/assets/img/logo-160.png" width="160" height="139" alt="${lang === 'fr' ? 'Logo de La Paix du Cœur' : 'La Paix du Cœur logo'}" loading="lazy">
<p class="footer__tag">${esc(s.tagline)}</p>
<p class="footer__verse"><em>${lang === 'fr' ? '«&nbsp;Défendez le faible et l’orphelin, rendez justice à l’affligé et au pauvre.&nbsp;»' : '“Defend the weak and the fatherless; uphold the cause of the poor and the oppressed.”'}</em><br><span>Tehilim (${lang === 'fr' ? 'Psaumes' : 'Psalms'}) 82:3</span></p>
</div>
<div>
<h2 class="footer__h">${t.footer_explore}</h2>
<ul class="footer__links">
<li><a href="${R('about')}">${t.nav.about}</a></li>
<li><a href="${R('missions')}">${t.nav.missions}</a></li>
<li><a href="${R('stories')}">${t.nav.stories}</a></li>
<li><a href="${R('podcast')}">${t.nav.podcast}</a></li>
<li><a href="${R('news')}">${t.news}</a></li>
<li><a href="${R('media')}">${t.media}</a></li>
</ul>
</div>
<div>
<h2 class="footer__h">${t.footer_involve}</h2>
<ul class="footer__links">
<li><a href="${R('give')}">${t.give}</a></li>
<li><a href="${R('prayer')}">${t.nav.prayer}</a></li>
<li><a href="${R('letters')}">${t.letters}</a></li>
<li><a href="${R('events')}">${t.nav.events}</a></li>
<li><a href="${R('charter')}">${t.charter}</a></li>
<li><a href="${R('contact')}">${t.contact}</a></li>
</ul>
</div>
<div class="footer__nl">
<h2 class="footer__h">${esc(s.newsletter_title)}</h2>
<p>${esc(s.newsletter_text)}</p>
${newsletterForm(lang)}
</div>
</div>
<div class="wrap footer__bottom">
<p>© 2014–2026 La Paix du Cœur / Kimia Na Motema · ${t.footer_cra}${lang === "fr" ? "&nbsp;:" : ":"} ${site.fr.cra_number ? esc(site.fr.cra_number) : `<span class="tbc">${t.tbc}</span>`}</p>
<p><a href="mailto:${s.email}">${s.email}</a> · <a href="${R('privacy')}">${t.privacy}</a></p>
<ul class="footer__social" aria-label="${t.footer_social}">${social}</ul>
<p class="footer__made">${drawHeart('draw-heart--tiny')} ${t.footer_made}</p>
</div>
</footer>`;
  }

  function newsletterForm(lang) {
    const t = ui(lang);
    const id = `nl-${lang}`;
    return `<form class="form form--nl" data-form action="#" method="post" novalidate>
<!-- Turnstile widget placeholder: <div class="cf-turnstile" data-sitekey="[à confirmer]"></div> -->
<div class="hp" aria-hidden="true"><label for="${id}-website">${t.f_hp}</label><input id="${id}-website" name="website" type="text" tabindex="-1" autocomplete="off"></div>
<div class="nl-row"><label class="sr-only" for="${id}-email">${t.nl_email}</label><input id="${id}-email" name="email" type="email" required autocomplete="email" placeholder="${t.nl_email}"><button class="btn btn--ink" type="submit">${t.nl_submit}</button></div>
<label class="check"><input type="checkbox" name="consent" required> <span>${t.nl_consent}</span></label>
<p class="form__success" role="status" hidden data-success>${t.nl_success}</p>
</form>`;
  }

  function pageHead(lang, o) {
    const t = ui(lang);
    const crumbs = o.crumbs ? `<nav class="crumbs" aria-label="${t.breadcrumb}"><ol><li><a href="${ROUTES.home[lang]}">${t.home}</a></li>${o.crumbs
      .map((c, i) => (i === o.crumbs.length - 1 ? `<li><span aria-current="page">${esc(c.name)}</span></li>` : `<li><a href="${c.url}">${esc(c.name)}</a></li>`)).join('')}</ol></nav>` : '';
    return `<header class="page-head ${o.cls || ''}">
<div class="wrap page-head__inner">
${crumbs}
${o.kicker ? `<p class="kicker">${esc(o.kicker)}</p>` : ''}
<h1>${txt(o.title)}</h1>
${o.lede ? `<p class="lede">${txt(o.lede)}</p>` : ''}
${o.extra || ''}
</div>
${deckle('bottom', o.seed || 11)}
</header>`;
  }

  return { page, pageHead, abs, BASE, ORG_ID, orgLd, newsletterForm, fleuron };
}
