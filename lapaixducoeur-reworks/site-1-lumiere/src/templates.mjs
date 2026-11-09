// HTML templates. Every function receives the helper bag `h` built in build.mjs.
const I = {
  heart: '<path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.4 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.6 0 5.6 3.5 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  check: '<path d="M4.5 12.5l5 5 10-11"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="3"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="3"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>',
  pause: '<path d="M8 5.5v13M16 5.5v13" stroke-width="3.2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>',
  letter: '<rect x="3" y="5.5" width="18" height="13" rx="3"/><path d="M3.5 7l8.5 6 8.5-6"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  pray: '<path d="M12 2.8c2.6 3 5 5.7 5 9.6a5 5 0 0 1-10 0c0-2.1 1-3.7 2.1-4.7.3 1.7 1 2.7 2 3.1-.1-3 .3-5.5.9-8z"/><path d="M9 21.2h6"/>',
  hands: '<path d="M2.5 13.5l4-3.5h4l3 2.5M2.5 19.5h11l7.5-5.5-1.8-1.8-5.2 3.3H9.5"/><path d="M15.5 4.5a2.3 2.3 0 0 1 4 1.6c0 2.2-3.8 4.4-3.8 4.4s-3.7-2.2-3.7-4.4a2.3 2.3 0 0 1 3.5-1.6z"/>',
  spark: '<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="3"/><path d="M3.5 7l8.5 6 8.5-6"/>',
  gift: '<rect x="3.5" y="9" width="17" height="11.5" rx="2"/><path d="M2.5 9h19M12 9v11.5M12 9S10.5 4 8 4.5 7 9 12 9zm0 0s1.5-5 4-4.5S17 9 12 9z"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  quote: '<path d="M10 7H6.5A2.5 2.5 0 0 0 4 9.5V13h5v5H4M20 7h-3.5A2.5 2.5 0 0 0 14 9.5V13h5v5h-5"/>',
  leaf: '<path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15"/><path d="M5 19l8-8"/>',
  bag: '<path d="M5 8h14l-1.2 12.5H6.2z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
  shirt: '<path d="M8 3.5L3.5 6.5l2 4 2-1V20.5h9V9.5l2 1 2-4L16 3.5c-.5 1.6-2 2.5-4 2.5s-3.5-.9-4-2.5z"/>',
  book: '<path d="M4 5.5A2 2 0 0 1 6 3.5h13v15H6a2 2 0 0 0-2 2z"/><path d="M4 20.5a2 2 0 0 0 2 2h13v-4"/>',
  coin: '<circle cx="12" cy="12" r="8.5"/><path d="M14.5 9.2c-.6-.8-1.5-1.2-2.5-1.2-1.4 0-2.5.8-2.5 2s1.1 1.6 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2c-1 0-2-.4-2.6-1.2M12 6.5V8M12 16v1.5"/>',
  external: '<path d="M14 4.5h5.5V10M19.5 4.5L11 13M17 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 4 18.5v-10A1.5 1.5 0 0 1 5.5 7H10"/>',
  alert: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.3v.2"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M4.5 20h15"/>',
};
const AREA_ICON = { food: 'bag', clothing: 'shirt', school: 'book', material: 'coin' };
const icon = (n, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${I[n] || ''}</svg>`;

const badge = (t, cls = '') => `<span class="badge ${cls}">${t.sample}</span>`;
const json = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;

// ---------- layout ----------
export function layout(h, p) {
  const { lang, key } = p;
  const t = h.T[lang];
  const S = h.S;
  const canonical = h.SITE + p.path;
  const other = t.other;
  const fullTitle = p.fullTitle || `${p.title} · ${S.site_name}`;
  const og = h.SITE + (p.ogImage || `/img/og-${lang}.jpg`);
  const org = `${h.SITE}/#org`;
  const graph = [
    {
      '@type': 'NGO', '@id': org, name: S.site_name, alternateName: S.alternate_name,
      url: `${h.SITE}/`, logo: `${h.SITE}/img/logo.png`, image: `${h.SITE}/img/og-fr.jpg`, email: S.email,
      foundingDate: String(S.founding_year), foundingLocation: { '@type': 'Place', name: 'Montréal, QC, Canada' },
      areaServed: 'CA', knowsLanguage: ['fr-CA', 'en-CA'], nonprofitStatus: 'NonprofitType',
      description: h.L(h.pages.home, lang).description,
      sameAs: S.social.map((s) => s.url).filter(Boolean),
      potentialAction: { '@type': 'DonateAction', name: t.give, target: { '@type': 'EntryPoint', urlTemplate: `${h.SITE}${h.url('give', lang)}` }, recipient: { '@id': org } },
    },
    { '@type': 'WebSite', '@id': `${h.SITE}/#website`, url: `${h.SITE}/`, name: S.site_name, inLanguage: ['fr-CA', 'en-CA'], publisher: { '@id': org } },
    { '@type': 'WebPage', '@id': `${canonical}#webpage`, url: canonical, name: fullTitle, description: p.description, inLanguage: t.locale, isPartOf: { '@id': `${h.SITE}/#website` }, about: { '@id': org } },
  ];
  if (p.crumbs) {
    graph.push({
      '@type': 'BreadcrumbList', '@id': `${canonical}#breadcrumb`,
      itemListElement: [[t.nav.home, h.url('home', lang)], ...p.crumbs].map(([name, u], i) => ({ '@type': 'ListItem', position: i + 1, name, item: h.SITE + u })),
    });
  }
  if (p.jsonld) graph.push(...[].concat(p.jsonld));

  const navKeys = ['about', 'missions', 'news', 'events', 'media', 'transparency'];
  const nav = navKeys.map((k) => `<li><a href="${h.url(k, lang)}"${k === key ? ' aria-current="page"' : ''}>${t.nav[k]}</a></li>`).join('');
  const crumbs = p.crumbs ? `<nav class="crumbs container" aria-label="${t.breadcrumbs}"><ol><li><a href="${h.url('home', lang)}">${t.nav.home}</a></li>${p.crumbs.map(([n, u], i) => i === p.crumbs.length - 1 ? `<li><span aria-current="page">${h.esc(n)}</span></li>` : `<li><a href="${u}">${h.esc(n)}</a></li>`).join('')}</ol></nav>` : '';
  const emblem = `<picture><source type="image/webp" srcset="/img/emblem-112.webp 1x, /img/emblem-224.webp 2x"><img src="/img/emblem-112.png" width="125" height="112" alt="" class="brand-mark"></picture>`;

  return `<!doctype html>
<html lang="${t.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${h.esc(fullTitle)}</title>
<meta name="description" content="${h.esc(p.description)}">
<link rel="canonical" href="${canonical}">
<link rel="alternate" hreflang="fr-CA" href="${h.SITE}${p.alt.fr}">
<link rel="alternate" hreflang="en-CA" href="${h.SITE}${p.alt.en}">
<link rel="alternate" hreflang="x-default" href="${h.SITE}${key === 'home' ? '/' : p.alt.fr}">
<link rel="alternate" type="application/rss+xml" title="${h.esc(t.nav.news)} · ${h.esc(S.site_name)}" href="${h.url('news', lang)}rss.xml">
<meta property="og:type" content="${p.ogType || 'website'}">
<meta property="og:site_name" content="${h.esc(S.site_name)}">
<meta property="og:title" content="${h.esc(p.ogTitle || p.title)}">
<meta property="og:description" content="${h.esc(p.description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${og}">
<meta property="og:image:alt" content="${h.esc(S.site_name)} — Kimia Na Motema">
<meta property="og:locale" content="${t.ogLocale}">
<meta property="og:locale:alternate" content="${h.T[other].ogLocale}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#FFFBF5">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="/favicon-180.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="preload" href="/fonts/outfit-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${h.hashed['src/styles.css']}">
<script src="${h.hashed['src/main.js']}" defer></script>
${json({ '@context': 'https://schema.org', '@graph': graph })}
</head>
<body class="page-${key} ${p.bodyClass || ''}">
<a class="skip-link" href="#main">${t.skip}</a>
<header class="site-header" data-header>
  <div class="container header-inner">
    <a class="brand" href="${h.url('home', lang)}" aria-label="${h.esc(S.site_name)} — ${t.nav.home}">${emblem}<span class="brand-text"><span class="brand-name">La Paix du Cœur</span><span class="brand-sub">Kimia Na Motema</span></span></a>
    <nav class="main-nav" id="main-nav" aria-label="${t.menuNav}" data-nav>
      <ul>${nav}</ul>
      <a class="nav-circle" href="${h.url('circle', lang)}">${icon('heart')}${t.nav.circle}</a>
    </nav>
    <div class="header-actions">
      <a class="lang-switch" href="${p.alt[other]}" hreflang="${other}-CA" lang="${other}-CA" aria-label="${t.switchLabel}"><span aria-hidden="true">${t.otherShort}</span></a>
      <a class="btn btn-primary btn-give" href="${h.url('give', lang)}#don"${key === 'give' ? ' aria-current="page"' : ''}>${icon('heart')}<span>${t.give}</span></a>
      <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="main-nav" data-nav-toggle><span class="sr-only">${t.menu}</span>${icon('menu', 'i-open')}${icon('close', 'i-close')}</button>
    </div>
  </div>
</header>
<main id="main" tabindex="-1">
${crumbs}
${p.body}
${p.noClosing ? '' : closing(h, lang)}
</main>
${footer(h, lang)}
${key === 'give' ? '' : `<div class="mobile-give" data-mobile-give><a class="btn btn-primary" href="${h.url('give', lang)}#don">${icon('heart')}${t.mobileGive}</a><a class="btn btn-soft" href="${h.url('circle', lang)}">${t.mobileCircle}</a></div>`}
</body>
</html>
`;
}

function closing(h, lang) {
  const t = h.T[lang], P = h.L(h.pages.home, lang), v = h.S.verse_of_week;
  return `<section class="section closing" aria-labelledby="closing-title">
  <div class="container">
    <div class="closing-panel">
      <div class="closing-sun" aria-hidden="true"></div>
      <figure class="verse verse-sm"><blockquote><p>${h.txt(v[lang + '_text'])}</p></blockquote><figcaption>${t.verseOfWeek} · ${h.txt(v[lang + '_ref'])}</figcaption></figure>
      <h2 id="closing-title" class="h2">${h.txt(P.closing_title)}</h2>
      <p class="lead">${h.txt(P.closing_text)}</p>
      <div class="cta-row center">
        <a class="btn btn-primary btn-lg" href="${h.url('give', lang)}#don">${icon('heart')}${t.give}</a>
        <a class="btn btn-ghost btn-lg" href="${h.url('circle', lang)}">${t.joinCircle}</a>
        <a class="btn btn-ghost btn-lg" href="${h.url('contact', lang)}#benevolat">${t.nav.contact}</a>
      </div>
    </div>
  </div>
</section>`;
}

function footer(h, lang) {
  const t = h.T[lang], S = h.S;
  const link = (k) => `<li><a href="${h.url(k, lang)}">${t.nav[k]}</a></li>`;
  const social = S.social.map((s) => s.url ? `<li><a href="${h.esc(s.url)}" rel="me noopener">${h.esc(s.name)}</a></li>` : `<li><span class="muted">${h.esc(s.name)} <span class="tbc">[${t.tbc}]</span></span></li>`).join('');
  return `<footer class="site-footer">
  <div class="container footer-grid">
    <div class="footer-brand">
      <a class="brand brand-footer" href="${h.url('home', lang)}"><img src="/img/emblem-112.png" width="125" height="112" alt="" class="brand-mark" loading="lazy"><span class="brand-text"><span class="brand-name">La Paix du Cœur</span><span class="brand-sub">Kimia Na Motema</span></span></a>
      <p>${h.txt(t.footerTagline)}</p>
      <p><a class="footer-mail" href="mailto:${S.email}">${icon('mail')}${S.email}</a></p>
    </div>
    <nav class="footer-nav" aria-label="${t.footerNav}">
      <div><h2 class="footer-h">${t.footerExplore}</h2><ul>${['about', 'missions', 'news', 'events', 'media'].map(link).join('')}</ul></div>
      <div><h2 class="footer-h">${t.footerGive}</h2><ul>${['give', 'circle', 'transparency', 'contact', 'privacy'].map(link).join('')}</ul></div>
      <div><h2 class="footer-h">${t.social}</h2><ul>${social}</ul></div>
    </nav>
    <form class="footer-news" data-form data-thanks="${h.esc(t.newsletterThanks)}" action="#" method="post">
      <h2 class="footer-h">${t.newsletter}</h2>
      <p>${h.txt(t.newsletterText)}</p>
      <div class="hp" aria-hidden="true"><label>${t.honeypot}<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
      <!-- Cloudflare Turnstile: <div class="cf-turnstile" data-sitekey="[SITE_KEY]"></div> (verified server-side in a Pages Function) -->
      <div class="inline-field">
        <label for="nl-email-${lang}" class="sr-only">${t.emailLabel}</label>
        <input id="nl-email-${lang}" type="email" name="email" required autocomplete="email" placeholder="${t.emailLabel}">
        <button class="btn btn-primary" type="submit">${t.subscribe}</button>
      </div>
      <label class="check small"><input type="checkbox" name="consent" required><span>${t.caslConsent}</span></label>
      <p class="form-status" role="status" aria-live="polite" hidden></p>
    </form>
  </div>
  <div class="container footer-bottom">
    <p>© ${new Date().getFullYear()} L’association chrétienne La Paix du Cœur / Kimia Na Motema. ${t.rights}</p>
    <p><a href="${h.url('privacy', lang)}">${t.nav.privacy}</a> · <a href="${h.url('transparency', lang)}">${t.nav.transparency}</a> · <a href="/" hreflang="x-default">FR / EN</a></p>
  </div>
</footer>`;
}

// ---------- shared components ----------
const pageHead = (h, lang, { eyebrow, title, intro, extra = '', cls = '' }) => `<header class="page-hero ${cls}">
  <div class="page-hero-glow" aria-hidden="true"></div>
  <div class="container narrow-left">
    ${eyebrow ? `<p class="eyebrow">${h.txt(eyebrow)}</p>` : ''}
    <h1 class="display-2">${h.txt(title)}</h1>
    ${intro ? `<p class="lead">${h.txt(intro)}</p>` : ''}
    ${extra}
  </div>
</header>`;

function counters(h, lang, P) {
  const t = h.T[lang];
  return `<section class="section-tight counters-wrap" aria-labelledby="counters-title">
  <div class="container">
    <div class="counters">
      <div class="counters-head"><h2 id="counters-title" class="h3">${h.txt(P.counters_title)}</h2>${badge(t)}</div>
      <ul class="counters-grid">${P.counters.map((c) => `<li><span class="big-num" data-count="${c.value}" data-locale="${t.locale}">${h.num(c.value, lang)}${h.esc(c.suffix || '')}</span><span class="counter-label">${h.txt(c.label)}${c.sample ? '<span class="dot-sample" aria-hidden="true">*</span>' : ''}</span></li>`).join('')}</ul>
      <p class="fine">* ${h.txt(t.countersNote)}</p>
    </div>
  </div>
</section>`;
}

function areaCards(h, lang, areas, { link = true } = {}) {
  return `<ul class="area-grid">${areas.map((a) => `<li class="area-card">
    <div class="photo photo-warm area-photo">${h.pic(a.image, a.image_alt, { sizes: '(min-width: 1100px) 280px, (min-width: 700px) 45vw, 92vw' })}</div>
    <div class="area-body">
      <span class="icon-chip area-${a.key}">${icon(AREA_ICON[a.key])}</span>
      <h3 class="h4">${link ? `<a class="stretched" href="${h.url('missions', lang)}#${a.key}">${h.txt(a.title)}</a>` : h.txt(a.title)}</h3>
      <p>${h.txt(a.text)}</p>
    </div>
  </li>`).join('')}</ul>`;
}

export function giftSlider(h, lang, { eyebrow, title, intro, id = 'ou-va-votre-don' }) {
  const t = h.T[lang], S = h.S;
  const areas = h.L(h.pages.missions, lang).areas;
  const nameOf = (k) => areas.find((a) => a.key === k)?.title || k;
  const amount = 100;
  let offset = 25;
  const segs = S.allocation.map((a) => {
    const s = `<circle class="seg seg-${a.key}" cx="21" cy="21" r="15.9155" pathLength="100" stroke-dasharray="${a.pct - 0.8} ${100 - a.pct + 0.8}" stroke-dashoffset="${offset}"></circle>`;
    offset -= a.pct;
    return s;
  }).join('');
  const data = S.allocation.map((a) => ({ key: a.key, pct: a.pct, unit: a.unit_cost, one: t.unit[a.key][0], many: t.unit[a.key][1] }));
  const eq = (a) => {
    const n = (amount * a.pct) / 100 / a.unit_cost;
    const v = new Intl.NumberFormat(t.locale, { maximumFractionDigits: 1 }).format(n);
    return `${t.approx} ${v} ${n >= 2 ? t.unit[a.key][1] : t.unit[a.key][0]}`;
  };
  return `<section class="section gift-viz" id="${id}" aria-labelledby="${id}-title">
  <div class="container gift-grid" data-gift data-locale="${t.locale}" data-alloc='${JSON.stringify(data).replace(/'/g, '&#39;')}'>
    <div class="gift-copy">
      <p class="eyebrow">${h.txt(eyebrow)}</p>
      <h2 id="${id}-title" class="h2">${h.txt(title)}</h2>
      <p class="lead">${h.txt(intro)}</p>
      <div class="slider-box">
        <div class="slider-top"><label for="${id}-amt">${t.sliderLabel}</label><output for="${id}-amt" class="slider-out" data-gift-out>${h.money(amount, lang)}</output></div>
        <input class="range" type="range" id="${id}-amt" min="10" max="500" step="5" value="${amount}" data-gift-range>
        <div class="slider-scale" aria-hidden="true"><span>${h.money(10, lang)}</span><span>${h.money(250, lang)}</span><span>${h.money(500, lang)}</span></div>
      </div>
      <p class="fine">${badge(t)} ${lang === 'fr' ? 'Répartition et coûts unitaires d’exemple, à confirmer par le rapport financier.' : 'Sample split and unit costs, to be confirmed by the financial report.'}</p>
    </div>
    <div class="gift-chart">
      <div class="donut-wrap">
        <svg class="donut" viewBox="0 0 42 42" role="img" aria-labelledby="${id}-donut-title"><title id="${id}-donut-title">${t.perArea}: ${S.allocation.map((a) => `${nameOf(a.key)} ${a.pct} %`).join(', ')}</title><circle class="donut-track" cx="21" cy="21" r="15.9155"></circle>${segs}</svg>
        <div class="donut-center" aria-hidden="true"><span class="donut-amt" data-gift-center>${h.money(amount, lang)}</span><span class="donut-cap">${t.perArea}</span></div>
      </div>
      <ul class="alloc-list" aria-live="polite">${S.allocation.map((a) => `<li class="alloc-${a.key}" data-key="${a.key}">
        <span class="alloc-dot" aria-hidden="true"></span>
        <span class="alloc-name">${h.txt(nameOf(a.key))} <span class="alloc-pct">${a.pct}&nbsp;%</span></span>
        <strong class="alloc-amt" data-amt>${h.money((amount * a.pct) / 100, lang)}</strong>
        <span class="alloc-eq" data-eq>${eq(a)}</span>
        <svg class="alloc-bar" viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true"><rect width="100" height="4" rx="2" class="bar-track"></rect><rect width="${a.pct}" height="4" rx="2" class="bar-fill"></rect></svg>
      </li>`).join('')}</ul>
    </div>
  </div>
</section>`;
}

function circleProgress(h, lang, { big = false } = {}) {
  const t = h.T[lang], S = h.S;
  const pct = Math.min(100, Math.round((S.circle_members / S.circle_goal) * 100));
  return `<div class="circle-progress ${big ? 'is-big' : ''}">
    <div class="cp-top"><span class="big-num" data-count="${S.circle_members}" data-locale="${t.locale}">${S.circle_members}</span><span class="cp-of">${t.circleOf} ${S.circle_goal} ${t.circleMembers}</span>${S.circle_sample ? badge(t) : ''}</div>
    <svg class="progress" viewBox="0 0 100 6" preserveAspectRatio="none" role="img" aria-label="${S.circle_members} ${t.circleOf} ${S.circle_goal} ${t.circleMembers} (${pct} %)"><rect width="100" height="6" rx="3" class="bar-track"></rect><rect width="${pct}" height="6" rx="3" class="bar-sun" data-grow></rect></svg>
    <div class="cp-scale"><span>0</span><span>${t.circleGoal} : ${S.circle_goal}</span></div>
  </div>`;
}

function newsCard(h, lang, n) {
  const x = h.L(n, lang), t = h.T[lang];
  return `<article class="news-card">
    <div class="photo photo-warm">${h.pic(x.image, x.image_alt, { sizes: '(min-width: 1100px) 360px, (min-width: 700px) 45vw, 92vw' })}</div>
    <div class="news-body">
      <p class="meta"><span class="tag">${h.txt(x.tag)}</span><time datetime="${x.date}">${h.fmtDate(x.date, lang)}</time>${x.sample ? badge(t, 'badge-sm') : ''}</p>
      <h3 class="h4"><a class="stretched" href="${h.url('news', lang, x.slug)}">${h.txt(x.title)}</a></h3>
      <p>${h.txt(x.summary)}</p>
      <span class="link-arrow" aria-hidden="true">${t.readMore} ${icon('arrow')}</span>
    </div>
  </article>`;
}

function eventCard(h, lang, e, { compact = false } = {}) {
  const x = h.L(e, lang), t = h.T[lang];
  const d = new Date(x.start);
  const day = h.fmtDate(x.start, lang, { day: 'numeric' });
  const mon = h.fmtDate(x.start, lang, { month: 'short' }).replace('.', '');
  const time = timeRange(h, lang, x);
  const ics = `${h.url('events', lang)}${x.slug}.ics`;
  return `<article class="event-card ${compact ? 'is-compact' : ''}">
    <div class="date-block" aria-hidden="true"><span class="db-day">${day}</span><span class="db-mon">${mon}</span><span class="db-year">${d.getUTCFullYear()}</span></div>
    <div class="event-body">
      <p class="meta"><time datetime="${x.start}">${h.fmtDate(x.start, lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</time>${x.sample ? badge(t, 'badge-sm') : ''}</p>
      <h3 class="h4"><a href="${h.url('events', lang, x.slug)}">${h.txt(x.title)}</a></h3>
      ${compact ? '' : `<p>${h.txt(x.summary)}</p>`}
      <ul class="event-facts"><li>${icon('clock')}<span>${time}</span></li><li>${icon('pin')}<span>${h.txt(x.location_name)}</span></li></ul>
      ${compact ? '' : `<div class="event-actions"><a class="btn btn-soft btn-sm" href="${ics}" download>${icon('cal')}${t.addCal}</a><a class="btn btn-link btn-sm" href="${h.gcal(e, lang)}" rel="noopener" target="_blank">${t.gcal}${icon('external')}</a>${x.ticket_url ? `<a class="btn btn-link btn-sm" href="${h.esc(x.ticket_url)}" rel="noopener">${t.tickets}</a>` : ''}</div>`}
    </div>
  </article>`;
}

const timeRange = (h, lang, x) => (h.isAllDay(x) ? h.T[lang].allDay
  : `${h.fmtDate(x.start, lang, { hour: 'numeric', minute: '2-digit' })} – ${h.fmtDate(x.end, lang, { hour: 'numeric', minute: '2-digit' })}`);
const calAnchor = (lang) => (lang === 'fr' ? 's-abonner' : 'subscribe');

// Subscribe block: full on the events list, compact in the event sidebar.
function calSubscribe(h, lang, { compact = false } = {}) {
  const t = h.T[lang], f = h.feed(lang);
  const ext = `rel="noopener" target="_blank"`;
  const copy = `<button class="btn btn-ghost btn-sm" type="button" data-copy-url="${f.https}" data-copied="${t.copied}">${icon('copy')}<span>${t.calCopy}</span></button>`;
  const view = f.view ? `<a class="btn btn-link btn-sm" href="${h.esc(f.view)}" ${ext}>${t.calViewGoogle}${icon('external')}</a>` : '';
  if (compact) {
    return `<div class="cal-sub is-compact">
      <p class="cal-sub-title">${icon('cal')}${t.calSubscribeShort}</p>
      <ul class="cal-sub-links">
        <li><a href="${f.webcal}">${t.calApple}</a></li>
        <li><a href="${h.esc(f.google)}" ${ext}>${t.calGoogle}</a></li>
        <li><a href="${h.esc(f.outlook)}" ${ext}>${t.calOutlook}</a></li>
        ${f.view ? `<li><a href="${h.esc(f.view)}" ${ext}>${t.calViewGoogle}</a></li>` : ''}
      </ul>
      ${copy}
      <p class="fine">${t.calHelp}</p>
    </div>`;
  }
  return `<section class="cal-sub card" id="${calAnchor(lang)}" aria-labelledby="cal-sub-title">
    <div class="cal-sub-sun" aria-hidden="true"></div>
    <div class="card-head"><span class="icon-chip">${icon('cal')}</span><h2 class="h3" id="cal-sub-title">${t.calTitle}</h2></div>
    <p class="cal-sub-intro">${t.calIntro}</p>
    <div class="cal-sub-actions">
      <a class="btn btn-primary btn-sm" href="${f.webcal}">${icon('cal')}${t.calApple}</a>
      <a class="btn btn-soft btn-sm" href="${h.esc(f.google)}" ${ext}>${t.calGoogle}${icon('external')}</a>
      <a class="btn btn-soft btn-sm" href="${h.esc(f.outlook)}" ${ext}>${t.calOutlook}${icon('external')}</a>
      ${copy}
      ${view}
    </div>
    <p class="fine cal-sub-help">${icon('check')}<span>${t.calHelp}</span></p>
  </section>`;
}

const sectionHead = (h, { eyebrow, title, intro, id, center = false, cls = '' }) => `<div class="section-head ${center ? 'center' : ''} ${cls}">
  ${eyebrow ? `<p class="eyebrow">${h.txt(eyebrow)}</p>` : ''}
  <h2 class="h2" id="${id}">${h.txt(title)}</h2>
  ${intro ? `<p class="lead">${h.txt(intro)}</p>` : ''}
</div>`;

const faqList = (h, items) => `<div class="faq">${items.map((f) => `<details><summary><span>${h.txt(f.q)}</span><span class="faq-icon" aria-hidden="true"></span></summary><div class="faq-a"><p>${h.txt(f.a)}</p></div></details>`).join('')}</div>`;

// ---------- pages ----------
export function home(h, { lang, t }) {
  const P = h.L(h.pages.home, lang);
  const M = h.L(h.pages.missions, lang);
  const titleHtml = h.txt(P.hero_title).replace(h.esc(P.hero_highlight), `<span class="hl">${h.esc(P.hero_highlight)}</span>`);
  const upcoming = h.events.filter((e) => h.pick(e, 'fr', 'end') >= '2026-11-09').slice(0, 3);
  const body = `
<section class="hero" data-hero>
  <div class="hero-sky" aria-hidden="true"><div class="hero-sun"></div></div>
  <div class="hero-glow" aria-hidden="true"></div>
  <div class="container hero-grid">
    <div class="hero-copy">
      <p class="eyebrow rise rise-1">${h.txt(P.hero_eyebrow)}</p>
      <h1 class="display rise rise-2">${titleHtml}</h1>
      <p class="lead rise rise-3">${h.txt(P.hero_intro)}</p>
      <div class="cta-row rise rise-4">
        <a class="btn btn-primary btn-lg" href="${h.url('give', lang)}#don">${icon('heart')}${h.txt(P.hero_cta_primary)}</a>
        <a class="btn btn-ghost btn-lg" href="${h.url('missions', lang)}">${h.txt(P.hero_cta_secondary)}${icon('arrow')}</a>
      </div>
      <figure class="verse verse-hero rise rise-5"><blockquote><p>${h.txt(P.hero_verse_text)}</p></blockquote><figcaption>${h.txt(P.hero_verse_ref)}</figcaption></figure>
    </div>
    <div class="hero-media rise rise-3">
      <div class="arch photo-warm">${h.pic(P.hero_image, P.hero_image_alt, { sizes: '(min-width: 1000px) 520px, 92vw', eager: true })}</div>
      <div class="float-chip chip-a">${icon('bag')}<span><strong>${h.txt(P.hero_chip)}</strong>${badge(t, 'badge-sm')}</span></div>
      <a class="float-chip chip-b" href="${h.url('circle', lang)}">${icon('heart')}<span><strong>${t.nav.circle}</strong><span class="chip-sub">${h.S.circle_members}/${h.S.circle_goal} ${t.circleMembers}</span></span></a>
    </div>
  </div>
</section>
${counters(h, lang, P)}
<section class="section" aria-labelledby="areas-title">
  <div class="container">
    ${sectionHead(h, { eyebrow: P.areas_eyebrow, title: P.areas_title, intro: P.areas_intro, id: 'areas-title' })}
    ${areaCards(h, lang, M.areas)}
  </div>
</section>
${giftSlider(h, lang, { eyebrow: P.gift_eyebrow, title: P.gift_title, intro: P.gift_intro })}
<section class="section" aria-labelledby="circle-title">
  <div class="container circle-teaser">
    <div class="ct-copy">
      <p class="eyebrow">${h.txt(P.circle_eyebrow)}</p>
      <h2 id="circle-title" class="h2">${h.txt(P.circle_title)}</h2>
      <p class="lead">${h.txt(P.circle_intro)}</p>
      <ul class="ticks">${h.L(h.pages.circle, lang).benefits.slice(0, 3).map((b) => `<li>${icon('check')}<span>${h.txt(b.title)}</span></li>`).join('')}</ul>
      <div class="cta-row"><a class="btn btn-primary btn-lg" href="${h.url('give', lang)}#don">${icon('heart')}${t.joinCircle}</a><a class="btn btn-link" href="${h.url('circle', lang)}">${t.readMore}${icon('arrow')}</a></div>
    </div>
    <div class="ct-card">
      <div class="ct-sun" aria-hidden="true"></div>
      <p class="ct-label">${h.txt(h.L(h.pages.circle, lang).goal_title)}</p>
      ${circleProgress(h, lang, { big: true })}
      <p class="ct-note">${h.txt(h.L(h.pages.circle, lang).goal_text)}</p>
    </div>
  </div>
</section>
<section class="section trust" aria-labelledby="trust-title">
  <div class="container">
    ${sectionHead(h, { eyebrow: P.trust_eyebrow, title: P.trust_title, id: 'trust-title', center: true })}
    <ul class="trust-grid">${P.trust_points.map((x, i) => `<li><span class="icon-chip">${icon(['chart', 'lock', 'shield'][i] || 'check')}</span><h3 class="h4">${h.txt(x.title)}</h3><p>${h.txt(x.text)}</p></li>`).join('')}</ul>
    <p class="center"><a class="btn btn-ghost" href="${h.url('transparency', lang)}">${t.nav.transparency}${icon('arrow')}</a></p>
  </div>
</section>
<section class="section soft-bg" aria-labelledby="latest-title">
  <div class="container">
    <div class="split-head"><h2 class="h2" id="latest-title">${t.latest}</h2><a class="btn btn-link" href="${h.url('news', lang)}">${t.allNews}${icon('arrow')}</a></div>
    <div class="news-grid">${h.news.slice(0, 3).map((n) => newsCard(h, lang, n)).join('')}</div>
    <div class="split-head mt-xl"><h2 class="h2" id="upcoming-title">${t.upcoming}</h2><div class="split-links"><a class="btn btn-link" href="${h.url('events', lang)}#${calAnchor(lang)}">${icon('cal')}${t.calSubscribeShort}</a><a class="btn btn-link" href="${h.url('events', lang)}">${t.allEvents}${icon('arrow')}</a></div></div>
    <div class="event-row">${upcoming.map((e) => eventCard(h, lang, e, { compact: true })).join('')}</div>
  </div>
</section>`;
  return { title: P.title, fullTitle: P.title, ogTitle: P.hero_title, description: P.description, body, bodyClass: 'has-hero' };
}

export function about(h, { lang, t }) {
  const P = h.L(h.pages.about, lang);
  const body = `
${pageHead(h, lang, { eyebrow: 'Kimia Na Motema', title: P.heading, intro: P.intro })}
<section class="section-tight">
  <div class="container split">
    <div class="prose">${h.md(P.story)}</div>
    <div class="photo photo-warm rounded-xl">${h.pic(P.image, P.image_alt, { sizes: '(min-width: 900px) 46vw, 92vw' })}</div>
  </div>
</section>
<section class="section">
  <div class="container">
    <div class="mission-panel">
      <div class="mission-sun" aria-hidden="true"></div>
      <h2 class="h2">${h.txt(P.mission_title)}</h2>
      <p class="mission-text">${h.txt(P.mission)}</p>
    </div>
  </div>
</section>
<section class="section-tight" aria-labelledby="values-title">
  <div class="container">
    ${sectionHead(h, { title: P.values_title, id: 'values-title' })}
    <ul class="value-grid">${P.values.map((v, i) => `<li><span class="value-num">0${i + 1}</span><h3 class="h4">${h.txt(v.title)}</h3><p>${h.txt(v.text)}</p></li>`).join('')}</ul>
  </div>
</section>
<section class="section">
  <div class="container verse-band">
    <figure class="verse verse-lg"><blockquote><p>${h.txt(P.verse_text)}</p></blockquote><figcaption>${h.txt(P.verse_ref)}</figcaption></figure>
  </div>
</section>
<section class="section-tight" aria-labelledby="timeline-title">
  <div class="container split split-top">
    <div>
      ${sectionHead(h, { title: P.timeline_title, id: 'timeline-title' })}
      <ol class="timeline">${P.timeline.map((x) => `<li><span class="tl-year">${h.esc(x.year)}</span><p>${h.txt(x.text)}${x.sample ? ' ' + badge(t, 'badge-sm') : ''}</p></li>`).join('')}</ol>
    </div>
    <div class="photo photo-warm rounded-xl">${h.pic(P.image2, P.image2_alt, { sizes: '(min-width: 900px) 46vw, 92vw' })}</div>
  </div>
</section>
<section class="section" aria-labelledby="team-title">
  <div class="container">
    ${sectionHead(h, { title: P.team_title, intro: P.team_intro, id: 'team-title' })}
    <ul class="people-grid">${P.team.map((m) => `<li class="person"><span class="avatar" aria-hidden="true">${icon('heart')}</span><div><h3 class="h5">${h.txt(m.name)}</h3><p>${h.txt(m.role)}</p>${m.sample ? badge(t, 'badge-sm') : ''}</div></li>`).join('')}</ul>
  </div>
</section>`;
  return { title: P.title, description: P.description, body, crumbs: [[t.nav.about, h.url('about', lang)]] };
}

export function missions(h, { lang, t }) {
  const P = h.L(h.pages.missions, lang);
  const body = `
${pageHead(h, lang, { eyebrow: t.nav.missions, title: P.heading, intro: P.intro })}
<section class="section-tight" aria-labelledby="programmes-title">
  <div class="container">
    ${sectionHead(h, { title: P.programmes_title, id: 'programmes-title' })}
    <ul class="programme-grid">${P.programmes.map((x) => `<li class="card"><span class="icon-chip">${icon(x.icon)}</span><h3 class="h4">${h.txt(x.title)}</h3><p>${h.txt(x.text)}</p></li>`).join('')}</ul>
  </div>
</section>
<section class="section" aria-labelledby="areas-title">
  <div class="container">
    ${sectionHead(h, { title: P.areas_title, id: 'areas-title' })}
    <div class="area-rows">${P.areas.map((a, i) => `<article class="area-row ${i % 2 ? 'flip' : ''}" id="${a.key}">
      <div class="photo photo-warm rounded-xl">${h.pic(a.image, a.image_alt, { sizes: '(min-width: 900px) 46vw, 92vw' })}</div>
      <div class="area-row-body"><span class="icon-chip area-${a.key}">${icon(AREA_ICON[a.key])}</span><h3 class="h3">${h.txt(a.title)}</h3><p class="lead">${h.txt(a.text)}</p><a class="btn btn-link" href="${h.url('give', lang)}#don">${t.give}${icon('arrow')}</a></div>
    </article>`).join('')}</div>
  </div>
</section>
<section class="section soft-bg" aria-labelledby="actions-title">
  <div class="container">
    ${sectionHead(h, { title: P.actions_title, id: 'actions-title' })}
    <div class="action-grid">${P.actions.map((a) => `<article class="action-card"><div class="photo photo-warm">${h.pic(a.image, a.image_alt, { sizes: '(min-width: 900px) 560px, 92vw' })}</div><div class="action-body"><h3 class="h3">${h.txt(a.title)}</h3><p>${h.txt(a.text)}</p></div></article>`).join('')}</div>
    <div class="callout mt-xl">${icon('pin')}<div><h3 class="h4">${h.txt(P.reach_title)}</h3><p>${h.txt(P.reach_text)}</p></div></div>
    <p class="mt-l"><a class="btn btn-soft" href="${h.url('events', lang)}">${icon('cal')}${t.upcoming}</a></p>
  </div>
</section>`;
  return { title: P.title, description: P.description, body, crumbs: [[t.nav.missions, h.url('missions', lang)]] };
}

function donateWidget(h, lang, P) {
  const t = h.T[lang];
  const tile = (set, a, i, checked) => `<div class="amt-tile">
      <input type="radio" name="amount_${set}" id="amt-${set}-${a.amount}" value="${a.amount}" data-impact="${h.esc(a.impact)}"${checked ? ' checked' : ''}>
      <label for="amt-${set}-${a.amount}"><span class="amt-val">${h.money(a.amount, lang)}${set === 'monthly' ? `<small>${t.perMonth}</small>` : ''}</span><span class="amt-impact">= ${h.txt(a.impact)}</span><span class="amt-check" aria-hidden="true">${icon('check')}</span></label>
    </div>`;
  const proto = h.esc(t.zeffyProto);
  return `<form class="donate-card" id="don" action="${h.esc(h.S.donate_url)}" method="get" data-donate data-locale="${t.locale}" data-proto="${proto}" data-per="${h.esc(t.perMonth)}" data-sum-once="${h.esc(t.summaryOnce)}" data-sum-monthly="${h.esc(t.summaryMonthly)}" data-fee-label="${h.esc(t.coverFees)}">
  <div class="donate-top"><h2 class="h3">${h.txt(P.widget_title)}</h2><span class="secure-pill">${icon('lock')}Zeffy</span></div>
  <fieldset class="freq">
    <legend class="sr-only">${lang === 'fr' ? 'Fréquence du don' : 'Gift frequency'}</legend>
    <input type="radio" name="frequency" id="freq-monthly" value="monthly" checked><label for="freq-monthly">${icon('heart')}${t.monthly}<span class="pill">${t.recommended}</span></label>
    <input type="radio" name="frequency" id="freq-once" value="once"><label for="freq-once">${t.once}</label>
  </fieldset>
  <fieldset class="amounts" data-set="monthly">
    <legend>${t.chooseAmount} ${badge(t, 'badge-sm')}</legend>
    <div class="amt-grid">${P.amounts_monthly.map((a, i) => tile('monthly', a, i, i === 1)).join('')}</div>
  </fieldset>
  <fieldset class="amounts" data-set="once" disabled hidden>
    <legend>${t.chooseAmount} ${badge(t, 'badge-sm')}</legend>
    <div class="amt-grid">${P.amounts_once.map((a, i) => tile('once', a, i, i === 1)).join('')}</div>
  </fieldset>
  <div class="field custom-amt">
    <label for="amt-custom">${t.otherAmount}</label>
    <div class="money-input ${lang === 'en' ? 'pre' : ''}"><span aria-hidden="true">$</span><input type="number" id="amt-custom" name="custom_amount" min="5" max="100000" step="1" inputmode="numeric" placeholder="${lang === 'fr' ? 'ex. 75' : 'e.g. 75'}" data-custom></div>
  </div>
  <label class="check"><input type="checkbox" name="cover_fees" value="1" data-fees><span data-fee-text>${h.txt(t.coverFees.replace('{fee}', h.money(0.75, lang, 2)))}</span></label>
  <p class="fine fee-note">${h.txt(P.fees_note)}</p>
  <details class="dedicate">
    <summary>${icon('gift')}${t.dedicate}</summary>
    <div class="dedicate-body">
      <fieldset class="seg-mini"><legend class="sr-only">${t.dedicate}</legend>
        <input type="radio" name="tribute" id="trib-h" value="honour" checked><label for="trib-h">${t.honour}</label>
        <input type="radio" name="tribute" id="trib-m" value="memory"><label for="trib-m">${t.memory}</label>
      </fieldset>
      <div class="field"><label for="trib-name">${t.dedicateName}</label><input type="text" id="trib-name" name="tribute_name" autocomplete="off"></div>
      <div class="field"><label for="trib-email">${t.dedicateNotify}</label><input type="email" id="trib-email" name="tribute_email" autocomplete="off"></div>
    </div>
  </details>
  <div class="donate-summary" aria-live="polite"><span class="ds-sum" data-sum>${h.esc(t.summaryMonthly.replace('{amt}', h.money(25, lang)))}</span><span class="ds-impact" data-impact>= ${h.txt(P.amounts_monthly[1].impact)}</span></div>
  <button class="btn btn-primary btn-lg btn-block" type="submit">${t.continueZeffy}${icon('arrow')}</button>
  <p class="secure-note">${icon('lock')}<span>${h.txt(t.zeffyNote)}</span></p>
  <p class="proto-note" role="status" hidden data-proto-out></p>
</form>`;
}

export function give(h, { lang, t }) {
  const P = h.L(h.pages.give, lang);
  const H = h.L(h.pages.home, lang);
  const S = h.S;
  const body = `
${pageHead(h, lang, { eyebrow: t.nav.give, title: P.heading, intro: P.intro, cls: 'compact', extra: `<ul class="trust-chips"><li>${icon('lock')}Zeffy</li><li>${icon('shield')}${lang === 'fr' ? 'Reçu fiscal [si enregistré]' : 'Tax receipt [if registered]'}</li><li>${icon('heart')}${lang === 'fr' ? 'Équipe 100 % bénévole [à confirmer]' : '100% volunteer team [to confirm]'}</li></ul>`.replace(/\[([^\]]+)\]/g, '<span class="tbc">[$1]</span>') })}
<section class="section-tight give-main">
  <div class="container give-grid">
    ${donateWidget(h, lang, P)}
    <aside class="give-aside" aria-label="${lang === 'fr' ? 'Autres moyens de donner' : 'Other ways to give'}">
      <div class="card interac" id="interac">
        <div class="card-head"><span class="icon-chip">${icon('mail')}</span><h2 class="h4">${h.txt(P.interac_title)}</h2></div>
        <ol class="steps-sm">${P.interac_steps.map((s) => `<li>${h.txt(s)}</li>`).join('')}</ol>
        <div class="copy-field"><code id="interac-email">${S.interac_email}</code><button class="btn btn-soft btn-sm" type="button" data-copy="#interac-email" data-copied="${t.copied}">${icon('copy')}<span>${t.copyEmail}</span></button></div>
      </div>
      <div class="card bank">
        <div class="card-head"><span class="icon-chip">${icon('shield')}</span><h2 class="h4">${h.txt(P.bank_title)}</h2></div>
        <p>${h.txt(P.bank_text)}</p>
        <a class="btn btn-link" href="${h.url('contact', lang)}?sujet=banque#message">${t.nav.contact}${icon('arrow')}</a>
      </div>
      <a class="card circle-mini" href="${h.url('circle', lang)}">
        <span class="eyebrow">${t.nav.circle}</span>
        ${circleProgress(h, lang)}
        <span class="link-arrow">${t.readMore}${icon('arrow')}</span>
      </a>
    </aside>
  </div>
</section>
${giftSlider(h, lang, { eyebrow: H.gift_eyebrow, title: H.gift_title, intro: H.gift_intro, id: 'repartition' })}
<section class="section" aria-labelledby="inkind-title">
  <div class="container split split-top">
    <div>
      ${sectionHead(h, { eyebrow: lang === 'fr' ? 'Liste de souhaits' : 'Wish list', title: P.inkind_title, intro: P.inkind_intro, id: 'inkind-title' })}
      <ul class="wishlist">${P.wishlist.map((w) => `<li>${icon('check')}<div><strong>${h.txt(w.item)}</strong><span>${h.txt(w.note)}</span></div></li>`).join('')}</ul>
      <a class="btn btn-soft" href="${h.url('contact', lang)}?sujet=nature#message">${icon('gift')}${lang === 'fr' ? 'Proposer un don en nature' : 'Offer a gift in kind'}</a>
    </div>
    <div class="prayer-card" id="priere">
      <span class="icon-chip">${icon('pray')}</span>
      <h2 class="h3">${h.txt(P.prayer_title)}</h2>
      <p>${h.txt(P.prayer_text)}</p>
      <form class="stack" data-form data-thanks="${h.esc(lang === 'fr' ? 'Merci. Votre sujet de prière sera porté avec amour par notre équipe.' : 'Thank you. Your prayer request will be carried with love by our team.')}" action="#" method="post">
        <div class="hp" aria-hidden="true"><label>${t.honeypot}<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
        <!-- Cloudflare Turnstile placeholder -->
        <div class="field"><label for="pr-name">${lang === 'fr' ? 'Prénom (facultatif)' : 'First name (optional)'}</label><input id="pr-name" name="name" autocomplete="given-name"></div>
        <div class="field"><label for="pr-text">${lang === 'fr' ? 'Votre sujet de prière' : 'Your prayer request'} <span class="req">(${t.required})</span></label><textarea id="pr-text" name="request" rows="4" required></textarea></div>
        <label class="check"><input type="checkbox" name="chain" value="1"><span>${lang === 'fr' ? 'Je souhaite rejoindre la chaîne de prière (par courriel).' : 'I would like to join the prayer chain (by email).'}</span></label>
        <button class="btn btn-primary" type="submit">${lang === 'fr' ? 'Confier ce sujet' : 'Send my request'}</button>
        <p class="form-status" role="status" aria-live="polite" hidden></p>
      </form>
    </div>
  </div>
</section>
<section class="section soft-bg" aria-labelledby="other-title">
  <div class="container">
    ${sectionHead(h, { title: P.other_title, id: 'other-title' })}
    <ul class="programme-grid">${P.other_ways.map((o, i) => `<li class="card"><span class="icon-chip">${icon(['hands', 'gift', 'spark'][i] || 'heart')}</span><h3 class="h4"><a class="stretched" href="${h.url(o.link, lang)}${o.link === 'give' ? '#don' : '#benevolat'}">${h.txt(o.title)}</a></h3><p>${h.txt(o.text)}</p></li>`).join('')}</ul>
    <p class="mt-l center"><a class="btn btn-ghost" href="${h.url('transparency', lang)}#recus">${lang === 'fr' ? 'Questions sur les reçus fiscaux' : 'Questions about tax receipts'}${icon('arrow')}</a></p>
  </div>
</section>`;
  return { title: P.title, description: P.description, body, crumbs: [[t.nav.give, h.url('give', lang)]], noClosing: true };
}

export function circle(h, { lang, t }) {
  const P = h.L(h.pages.circle, lang);
  const body = `
<header class="page-hero circle-hero">
  <div class="page-hero-glow" aria-hidden="true"></div>
  <div class="container split">
    <div>
      <p class="eyebrow">${lang === 'fr' ? 'Don mensuel' : 'Monthly giving'}</p>
      <h1 class="display-2">${h.txt(P.heading)}</h1>
      <p class="lead">${h.txt(P.intro)}</p>
      <div class="cta-row"><a class="btn btn-primary btn-lg" href="${h.url('give', lang)}#don">${icon('heart')}${t.joinCircle}</a></div>
    </div>
    <div class="circle-visual">
      <div class="photo photo-warm arch">${h.pic(P.image, P.image_alt, { sizes: '(min-width: 900px) 460px, 92vw', eager: true })}</div>
      <div class="ct-card floating"><p class="ct-label">${h.txt(P.goal_title)}</p>${circleProgress(h, lang, { big: true })}</div>
    </div>
  </div>
</header>
<section class="section" aria-labelledby="benefits-title">
  <div class="container">
    ${sectionHead(h, { title: P.benefits_title, id: 'benefits-title' })}
    <ul class="benefit-grid">${P.benefits.map((b) => `<li class="card"><span class="icon-chip">${icon(b.icon)}</span><h3 class="h4">${h.txt(b.title)}</h3><p>${h.txt(b.text)}</p></li>`).join('')}</ul>
  </div>
</section>
<section class="section soft-bg" aria-labelledby="steps-title">
  <div class="container">
    ${sectionHead(h, { title: P.steps_title, id: 'steps-title', center: true })}
    <ol class="steps">${P.steps.map((s, i) => `<li><span class="step-num">${i + 1}</span><h3 class="h4">${h.txt(s.title)}</h3><p>${h.txt(s.text)}</p></li>`).join('')}</ol>
    <p class="center mt-l"><a class="btn btn-primary btn-lg" href="${h.url('give', lang)}#don">${icon('heart')}${t.giveMonthly}</a></p>
  </div>
</section>
<section class="section">
  <div class="container split split-top">
    <figure class="quote-card"><span class="quote-mark">${icon('quote')}</span><blockquote><p>${h.txt(P.quote)}</p></blockquote><figcaption>${h.txt(P.quote_author)}</figcaption></figure>
    <div>
      <h2 class="h3" id="faq-title">${h.txt(P.faq_title)}</h2>
      ${faqList(h, P.faq)}
    </div>
  </div>
</section>`;
  return { title: P.title, description: P.description, body, crumbs: [[t.nav.give, h.url('give', lang)], [t.nav.circle, h.url('circle', lang)]] };
}

function barList(h, lang, items, cls) {
  return `<ul class="bar-list ${cls}">${items.map((x, i) => `<li><div class="bl-top"><span>${h.txt(x.label)}</span><strong>${x.pct}&nbsp;%</strong></div><svg viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect width="100" height="8" rx="4" class="bar-track"></rect><rect width="${x.pct}" height="8" rx="4" class="bar-fill c${i}" data-grow></rect></svg></li>`).join('')}</ul>`;
}

export function transparency(h, { lang, t }) {
  const P = h.L(h.pages.transparency, lang);
  const ids = lang === 'fr' ? ['identite', 'gouvernance', 'rapport', 'protection', 'recus'] : ['identity', 'governance', 'report', 'safeguarding', 'receipts'];
  // keep #recus usable from both languages' give page links
  const recId = 'recus';
  const toc = [[ids[0], P.identity_title], [ids[1], P.board_title], [ids[2], `${P.report_title} ${P.report_year}`], [ids[3], P.safeguarding_title], [recId, P.faq_title]];
  const body = `
${pageHead(h, lang, { eyebrow: t.nav.transparency, title: P.heading, intro: P.intro })}
<div class="container doc-layout">
  <nav class="toc" aria-label="${t.tocLabel}"><p class="toc-h">${t.tocLabel}</p><ol>${toc.map(([id, l]) => `<li><a href="#${id}">${h.txt(l)}</a></li>`).join('')}</ol></nav>
  <div class="doc">
    <section id="${ids[0]}" class="doc-sec" aria-labelledby="${ids[0]}-t">
      <h2 class="h3" id="${ids[0]}-t">${h.txt(P.identity_title)}</h2>
      <dl class="facts">${P.identity.map((x) => `<div><dt>${h.txt(x.label)}</dt><dd>${h.txt(x.value)}</dd></div>`).join('')}</dl>
    </section>
    <section id="${ids[1]}" class="doc-sec" aria-labelledby="${ids[1]}-t">
      <h2 class="h3" id="${ids[1]}-t">${h.txt(P.board_title)}</h2>
      <p>${h.txt(P.board_intro)}</p>
      <ul class="people-grid compact">${P.board.map((m) => `<li class="person"><span class="avatar" aria-hidden="true">${icon('leaf')}</span><div><h3 class="h5">${h.txt(m.name)}</h3><p>${h.txt(m.role)}</p></div></li>`).join('')}</ul>
    </section>
    <section id="${ids[2]}" class="doc-sec report" aria-labelledby="${ids[2]}-t">
      <div class="report-head"><h2 class="h3" id="${ids[2]}-t">${h.txt(P.report_title)} ${h.esc(P.report_year)}</h2>${badge(t)}</div>
      <p>${h.txt(P.report_intro)}</p>
      <ul class="highlight-grid">${P.highlights.map((x) => `<li><span class="big-num sm">${h.esc(x.value)}</span><span>${h.txt(x.label)}</span></li>`).join('')}</ul>
      <div class="report-cols">
        <div class="card"><h3 class="h5">${h.txt(P.revenue_title)}</h3>${barList(h, lang, P.revenue, 'rev')}</div>
        <div class="card"><h3 class="h5">${h.txt(P.expenses_title)}</h3>${barList(h, lang, P.expenses, 'exp')}</div>
      </div>
    </section>
    <section id="${ids[3]}" class="doc-sec" aria-labelledby="${ids[3]}-t">
      <h2 class="h3" id="${ids[3]}-t">${h.txt(P.safeguarding_title)}</h2>
      <p>${h.txt(P.safeguarding_intro)}</p>
      <ul class="commit-list">${P.commitments.map((c) => `<li>${icon('shield')}<div><h3 class="h5">${h.txt(c.title)}</h3><p>${h.txt(c.text)}</p></div></li>`).join('')}</ul>
      <div class="callout warn">${icon('alert')}<div><h3 class="h5">${h.txt(P.fraud_title)}</h3><p>${h.txt(P.fraud_text)}</p></div></div>
    </section>
    <section id="${recId}" class="doc-sec" aria-labelledby="${recId}-t">
      <h2 class="h3" id="${recId}-t">${h.txt(P.faq_title)}</h2>
      ${faqList(h, P.faq)}
    </section>
  </div>
</div>`;
  const faqLd = { '@type': 'FAQPage', mainEntity: P.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) };
  return { title: P.title, description: P.description, body, crumbs: [[t.nav.transparency, h.url('transparency', lang)]], jsonld: faqLd };
}

export function contact(h, { lang, t }) {
  const P = h.L(h.pages.contact, lang);
  const fr = lang === 'fr';
  const hp = `<div class="hp" aria-hidden="true"><label>${t.honeypot}<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
        <!-- Cloudflare Turnstile: <div class="cf-turnstile" data-sitekey="[SITE_KEY]"></div> -->`;
  const req = `<span class="req">(${t.required})</span>`;
  const subjVals = ['info', 'benevolat', 'nature', 'banque', 'priere', 'medias'];
  const body = `
${pageHead(h, lang, { eyebrow: t.nav.contact, title: P.heading, intro: P.intro })}
<section class="section-tight">
  <div class="container contact-grid">
    <form class="card form-card stack" id="message" data-form data-thanks="${h.esc(t.formThanks)}" action="#" method="post">
      <h2 class="h3">${fr ? 'Écrire un message' : 'Send a message'}</h2>
      ${hp}
      <div class="field-row">
        <div class="field"><label for="c-name">${fr ? 'Nom' : 'Name'} ${req}</label><input id="c-name" name="name" required autocomplete="name"></div>
        <div class="field"><label for="c-email">${t.emailLabel} ${req}</label><input id="c-email" type="email" name="email" required autocomplete="email"></div>
      </div>
      <div class="field"><label for="c-subject">${fr ? 'Sujet' : 'Subject'}</label><select id="c-subject" name="subject" data-subject>${P.subjects.map((s, i) => `<option value="${subjVals[i] || i}">${h.esc(s)}</option>`).join('')}</select></div>
      <div class="field"><label for="c-msg">${fr ? 'Message' : 'Message'} ${req}</label><textarea id="c-msg" name="message" rows="6" required></textarea></div>
      <label class="check"><input type="checkbox" name="privacy" required><span>${fr ? 'J’accepte que mes renseignements servent uniquement à me répondre' : 'I agree that my information is used only to reply to me'} (<a href="${h.url('privacy', lang)}">${t.nav.privacy}</a>).</span></label>
      <button class="btn btn-primary btn-lg" type="submit">${fr ? 'Envoyer' : 'Send'}${icon('arrow')}</button>
      <p class="form-status" role="status" aria-live="polite" hidden></p>
    </form>
    <aside class="contact-aside">
      <div class="card"><div class="card-head"><span class="icon-chip">${icon('mail')}</span><h2 class="h4">${t.emailLabel}</h2></div><p><a class="big-link" href="mailto:${h.S.email}">${h.S.email}</a></p><p class="fine">${fr ? 'Aucun numéro de téléphone ni adresse postale publics [à confirmer].' : 'No public phone number or mailing address [to confirm].'}</p></div>
      <div class="card"><div class="card-head"><span class="icon-chip">${icon('shield')}</span><h2 class="h4">${fr ? 'Coordonnées bancaires' : 'Bank details'}</h2></div><p>${fr ? 'Sur demande seulement, pour votre sécurité. Choisissez le sujet « Coordonnées bancaires ».' : 'On request only, for your safety. Choose the “Bank details” subject.'}</p></div>
      <div class="card"><div class="card-head"><span class="icon-chip">${icon('heart')}</span><h2 class="h4">${t.social}</h2></div><p>${h.S.social.map((s) => s.url ? `<a href="${h.esc(s.url)}">${h.esc(s.name)}</a>` : `${h.esc(s.name)} <span class="tbc">[${t.tbc}]</span>`).join(' · ')}</p></div>
    </aside>
  </div>
</section>
<section class="section soft-bg" id="benevolat" aria-labelledby="vol-title">
  <div class="container split split-top">
    <div>
      ${sectionHead(h, { eyebrow: fr ? 'Bénévolat' : 'Volunteering', title: P.volunteer_title, intro: P.volunteer_text, id: 'vol-title' })}
      <div class="photo photo-warm rounded-xl">${h.pic('/img/food-bank-volunteers.jpg', fr ? 'Des bénévoles trient des denrées autour d’une table.' : 'Volunteers sort groceries around a table.', { sizes: '(min-width: 900px) 46vw, 92vw' })}</div>
    </div>
    <form class="card form-card stack" data-form data-thanks="${h.esc(fr ? 'Merci de vouloir servir avec nous ! Nous vous écrirons très bientôt.' : 'Thank you for wanting to serve with us! We will write to you very soon.')}" action="#" method="post">
      <h3 class="h4">${fr ? 'Je veux aider' : 'I want to help'}</h3>
      ${hp}
      <div class="field-row">
        <div class="field"><label for="v-name">${fr ? 'Nom' : 'Name'} ${req}</label><input id="v-name" name="name" required autocomplete="name"></div>
        <div class="field"><label for="v-email">${t.emailLabel} ${req}</label><input id="v-email" type="email" name="email" required autocomplete="email"></div>
      </div>
      <fieldset class="chips"><legend>${fr ? 'Ce que j’aime faire' : 'What I enjoy doing'}</legend>${P.skills.map((s, i) => `<label class="chip"><input type="checkbox" name="skills" value="${i}"><span>${h.esc(s)}</span></label>`).join('')}</fieldset>
      <div class="field"><label for="v-avail">${fr ? 'Disponibilités' : 'Availability'}</label><input id="v-avail" name="availability" placeholder="${fr ? 'ex. samedis, soirs de semaine' : 'e.g. Saturdays, weekday evenings'}"></div>
      <button class="btn btn-primary" type="submit">${fr ? 'Proposer mon aide' : 'Offer my help'}</button>
      <p class="form-status" role="status" aria-live="polite" hidden></p>
    </form>
  </div>
</section>`;
  return { title: P.title, description: P.description, body, crumbs: [[t.nav.contact, h.url('contact', lang)]], noClosing: true };
}

export function privacy(h, { lang, t }) {
  const P = h.L(h.pages.privacy, lang);
  const body = `
${pageHead(h, lang, { title: P.heading, intro: `${lang === 'fr' ? 'Mise à jour le' : 'Updated'} ${h.fmtDate(P.updated, lang)}` })}
<section class="section-tight"><div class="container"><div class="prose prose-doc">${h.md(P.body)}</div></div></section>`;
  return { title: P.title, description: P.description, body, crumbs: [[t.nav.privacy, h.url('privacy', lang)]], noClosing: true };
}

export function newsList(h, { lang, t }) {
  const P = h.L(h.pages.listings, lang);
  const [first, ...rest] = h.news;
  const f = h.L(first, lang);
  const body = `
${pageHead(h, lang, { title: P.news_heading, intro: P.news_intro, extra: `<p><a class="btn btn-link" href="${h.url('news', lang)}rss.xml">RSS${icon('external')}</a></p>` })}
<section class="section-tight">
  <div class="container">
    <article class="feature-news">
      <div class="photo photo-warm">${h.pic(f.image, f.image_alt, { sizes: '(min-width: 900px) 600px, 92vw', eager: true })}</div>
      <div class="news-body">
        <p class="meta"><span class="tag">${h.txt(f.tag)}</span><time datetime="${f.date}">${h.fmtDate(f.date, lang)}</time>${f.sample ? badge(t, 'badge-sm') : ''}</p>
        <h2 class="h2"><a class="stretched" href="${h.url('news', lang, f.slug)}">${h.txt(f.title)}</a></h2>
        <p class="lead">${h.txt(f.summary)}</p>
        <span class="link-arrow" aria-hidden="true">${t.readMore}${icon('arrow')}</span>
      </div>
    </article>
    <div class="news-grid mt-xl">${rest.map((n) => newsCard(h, lang, n)).join('')}</div>
  </div>
</section>`;
  return { title: P.news_title, description: P.news_description, body, crumbs: [[t.nav.news, h.url('news', lang)]] };
}

export function article(h, { lang, t }, n) {
  const x = h.L(n, lang);
  const path = h.url('news', lang, x.slug);
  const others = h.news.filter((o) => o !== n).slice(0, 2);
  const body = `
<article class="article">
  <header class="article-head container narrow">
    <p class="meta"><span class="tag">${h.txt(x.tag)}</span><time datetime="${x.date}">${t.published} ${h.fmtDate(x.date, lang)}</time>${x.sample ? badge(t, 'badge-sm') : ''}</p>
    <h1 class="display-2">${h.txt(x.title)}</h1>
    <p class="lead">${h.txt(x.summary)}</p>
  </header>
  <div class="container article-media"><div class="photo photo-warm rounded-xl">${h.pic(x.image, x.image_alt, { sizes: '(min-width: 1100px) 1000px, 94vw', eager: true })}</div></div>
  <div class="container narrow">
    <div class="prose">${h.md(x.body)}</div>
    <div class="share"><span>${t.share}</span><button class="btn btn-soft btn-sm" type="button" data-copy-url="${h.SITE}${path}" data-copied="${t.copied}">${icon('copy')}<span>${t.copyLink}</span></button><a class="btn btn-soft btn-sm" href="mailto:?subject=${encodeURIComponent(x.title)}&amp;body=${encodeURIComponent(h.SITE + path)}">${icon('mail')}${t.emailLabel}</a></div>
    <p><a class="btn btn-link" href="${h.url('news', lang)}">${t.backNews}</a></p>
  </div>
</article>
<section class="section-tight soft-bg" aria-labelledby="more-title"><div class="container"><h2 class="h3" id="more-title">${t.latest}</h2><div class="news-grid two">${others.map((o) => newsCard(h, lang, o)).join('')}</div></div></section>`;
  const ld = {
    '@type': 'NewsArticle', headline: x.title, description: x.summary, datePublished: `${x.date}T12:00:00-05:00`, dateModified: `${x.date}T12:00:00-05:00`,
    inLanguage: t.locale, image: [`${h.SITE}${x.image.replace(/\.jpg$/, '-1200.jpg')}`], mainEntityOfPage: `${h.SITE}${path}`,
    author: { '@id': `${h.SITE}/#org` }, publisher: { '@id': `${h.SITE}/#org` },
  };
  return { title: x.title, description: x.summary, body, ogType: 'article', ogImage: x.image.replace(/\.jpg$/, '-1200.jpg'), crumbs: [[t.nav.news, h.url('news', lang)], [x.title, path]], jsonld: ld };
}

export function eventList(h, { lang, t }) {
  const P = h.L(h.pages.listings, lang);
  const body = `
${pageHead(h, lang, { title: P.events_heading, intro: P.events_intro })}
<section class="section-tight"><div class="container">${calSubscribe(h, lang)}<div class="event-list mt-l">${h.events.map((e) => eventCard(h, lang, e)).join('')}</div></div></section>`;
  return { title: P.events_title, description: P.events_description, body, crumbs: [[t.nav.events, h.url('events', lang)]], jsonld: h.events.map((e) => eventLd(h, lang, e)) };
}

function eventLd(h, lang, e) {
  const x = h.L(e, lang);
  const allDay = h.isAllDay(x);
  return {
    '@type': 'Event', name: x.title, description: x.summary, startDate: allDay ? x.start.slice(0, 10) : x.start, endDate: allDay ? x.end.slice(0, 10) : x.end, inLanguage: h.T[lang].locale,
    eventStatus: 'https://schema.org/EventScheduled', eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: { '@type': 'Place', name: x.location_name, address: { '@type': 'PostalAddress', addressLocality: x.locality, addressRegion: 'QC', addressCountry: 'CA' } },
    image: [`${h.SITE}${h.bigImg(x.image)}`], url: `${h.SITE}${h.url('events', lang, x.slug)}`,
    organizer: { '@id': `${h.SITE}/#org` },
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'CAD', availability: 'https://schema.org/InStock', url: x.ticket_url || `${h.SITE}${h.url('events', lang, x.slug)}` },
  };
}

export function event(h, { lang, t }, e) {
  const x = h.L(e, lang);
  const path = h.url('events', lang, x.slug);
  const body = `
<article class="article">
  <header class="page-hero compact"><div class="page-hero-glow" aria-hidden="true"></div><div class="container narrow-left">
    <p class="eyebrow">${t.nav.events}${x.sample ? ' ' + badge(t, 'badge-sm') : ''}</p>
    <h1 class="display-2">${h.txt(x.title)}</h1>
    <p class="lead">${h.txt(x.summary)}</p>
  </div></header>
  <div class="container event-detail">
    <div>
      <div class="photo photo-warm rounded-xl">${h.pic(x.image, x.image_alt, { sizes: '(min-width: 900px) 60vw, 92vw', eager: true })}</div>
      ${x.body ? `<div class="prose mt-l">${h.md(x.body, { breaks: x.source === 'google-calendar' })}</div>` : ''}
    </div>
    <aside class="card event-side">
      <dl class="facts stacked">
        <div><dt>${icon('cal')}${t.when}</dt><dd><time datetime="${x.start}">${h.fmtDate(x.start, lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</time><br>${timeRange(h, lang, x)}</dd></div>
        <div><dt>${icon('pin')}${t.where}</dt><dd>${h.txt(x.location_name)}</dd></div>
      </dl>
      <div class="stack-sm">
        <a class="btn btn-primary btn-block" href="${h.url('events', lang)}${x.slug}.ics" download>${icon('cal')}${t.addCal}</a>
        <a class="btn btn-soft btn-block" href="${h.gcal(e, lang)}" rel="noopener" target="_blank">${t.gcal}${icon('external')}</a>
        ${x.ticket_url ? `<a class="btn btn-ghost btn-block" href="${h.esc(x.ticket_url)}" rel="noopener">${t.tickets} <span class="tbc">[${t.tbc}]</span></a>` : `<p class="fine center">${t.free}</p>`}
      </div>
      ${calSubscribe(h, lang, { compact: true })}
    </aside>
  </div>
  <div class="container"><p class="mt-l"><a class="btn btn-link" href="${h.url('events', lang)}">${t.backEvents}</a></p></div>
</article>`;
  const shared = h.events.filter((o) => h.L(o, lang).title === x.title).length > 1;
  const title = shared ? `${x.title} — ${h.fmtDate(x.start, lang, { day: 'numeric', month: 'long', year: 'numeric' })}` : x.title;
  return { title, description: x.summary, body, ogImage: h.bigImg(x.image), crumbs: [[t.nav.events, h.url('events', lang)], [x.title, path]], jsonld: eventLd(h, lang, e) };
}

export function media(h, { lang, t }) {
  const P = h.L(h.pages.listings, lang);
  const items = h.media.map((m) => ({ ...h.L(m, lang) }));
  const videos = items.filter((m) => m.type === 'video');
  const audios = items.filter((m) => m.type === 'audio');
  const photos = items.filter((m) => m.type === 'photo');
  const body = `
${pageHead(h, lang, { title: P.media_heading, intro: P.media_intro })}
<section class="section-tight" aria-labelledby="videos-title">
  <div class="container">
    <h2 class="h3" id="videos-title">${lang === 'fr' ? 'Vidéos' : 'Videos'}</h2>
    <div class="video-grid">${videos.map((v) => `<figure class="video-card">
      <div class="yt" data-yt="${h.esc(v.youtube_id)}" data-title="${h.esc(v.title)}">
        ${h.pic(v.image, v.alt, { sizes: '(min-width: 900px) 560px, 92vw' })}
        <button class="yt-play" type="button" aria-label="${t.play} : ${h.esc(v.title)}"><span class="yt-btn">${icon('play')}</span></button>
      </div>
      <figcaption><h3 class="h5">${h.txt(v.title)}</h3><p>${h.txt(v.caption)}</p>${v.sample ? badge(t, 'badge-sm') : ''}</figcaption>
    </figure>`).join('')}</div>
    <p class="fine">${icon('lock')} ${t.videoNote}</p>
  </div>
</section>
<section class="section-tight" aria-labelledby="audio-title">
  <div class="container">
    <h2 class="h3" id="audio-title">${lang === 'fr' ? 'Balado « Les voix du cœur »' : '“Voices of the Heart” podcast'}</h2>
    ${audios.map((a, i) => `<div class="audio-card" data-audio>
      <div class="audio-art photo-warm">${h.pic(a.image, a.alt, { sizes: '160px' })}</div>
      <div class="audio-main">
        <h3 class="h4">${h.txt(a.title)}</h3>
        <p>${h.txt(a.caption)} ${a.sample ? badge(t, 'badge-sm') : ''}</p>
        <audio preload="metadata" src="${h.esc(a.audio_file)}" data-audio-el></audio>
        <div class="player">
          <button class="player-btn" type="button" data-audio-toggle data-play="${t.playAudio}" data-pause="${t.pauseAudio}" aria-label="${t.playAudio}">${icon('play', 'i-play')}${icon('pause', 'i-pause')}</button>
          <input class="range range-sm" type="range" min="0" max="100" step="0.1" value="0" aria-label="${t.seek}" data-audio-seek>
          <span class="player-time" data-audio-time>0:00</span>
        </div>
        <details class="transcript"><summary>${t.transcript}</summary><div class="prose">${h.md(a.transcript)}</div></details>
      </div>
    </div>`).join('')}
  </div>
</section>
<section class="section-tight" aria-labelledby="gallery-title">
  <div class="container">
    <h2 class="h3" id="gallery-title">${t.gallery} ${badge(t, 'badge-sm')}</h2>
    <ul class="gallery">${photos.map((p) => `<li><button type="button" class="g-item" data-lightbox="${p.image.replace(/\.jpg$/, '-1200.jpg')}" data-caption="${h.esc(p.title)}" aria-label="${t.openPhoto} : ${h.esc(p.title)}"><span class="photo photo-warm">${h.pic(p.image, p.alt, { sizes: '(min-width: 900px) 380px, 46vw' })}</span><span class="g-cap">${h.txt(p.title)}</span></button></li>`).join('')}</ul>
  </div>
</section>
<dialog class="lightbox" data-lightbox-dialog aria-label="${t.gallery}"><form method="dialog"><button class="lb-close" aria-label="${t.closePhoto}">${icon('close')}</button></form><img src="/img/emblem-112.png" alt="" width="1200" height="800" data-lb-img><p data-lb-cap></p></dialog>`;
  const ld = videos.map((v) => ({ '@type': 'VideoObject', name: v.title, description: v.caption, thumbnailUrl: `${h.SITE}${v.image.replace(/\.jpg$/, '-1200.jpg')}`, uploadDate: v.date, embedUrl: `https://www.youtube-nocookie.com/embed/${v.youtube_id}` }));
  return { title: P.media_title, description: P.media_description, body, crumbs: [[t.nav.media, h.url('media', lang)]], jsonld: ld };
}

export function chooser(h) {
  const S = h.S;
  return `<!doctype html>
<html lang="fr-CA">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>La Paix du Cœur — Kimia Na Motema · Français / English</title>
<meta name="description" content="Association chrétienne à Montréal depuis 2014 — Christian charity in Montréal since 2014. Choisissez votre langue / Choose your language.">
<link rel="canonical" href="${h.SITE}/">
<link rel="alternate" hreflang="fr-CA" href="${h.SITE}/fr/">
<link rel="alternate" hreflang="en-CA" href="${h.SITE}/en/">
<link rel="alternate" hreflang="x-default" href="${h.SITE}/">
<meta property="og:type" content="website"><meta property="og:title" content="La Paix du Cœur — Kimia Na Motema"><meta property="og:description" content="Allumer l’espérance, un cœur à la fois. · Kindling hope, one heart at a time."><meta property="og:url" content="${h.SITE}/"><meta property="og:image" content="${h.SITE}/img/og-fr.jpg"><meta property="og:locale" content="fr_CA"><meta property="og:locale:alternate" content="en_CA">
<meta name="theme-color" content="#FFFBF5">
<link rel="icon" href="/favicon.ico" sizes="48x48"><link rel="apple-touch-icon" href="/favicon-180.png">
<link rel="stylesheet" href="${h.hashed['src/styles.css']}">
<script src="${h.hashed['src/main.js']}" defer></script>
${json({ '@context': 'https://schema.org', '@type': 'NGO', '@id': `${h.SITE}/#org`, name: S.site_name, alternateName: S.alternate_name, url: `${h.SITE}/`, logo: `${h.SITE}/img/logo.png`, email: S.email, foundingDate: String(S.founding_year), potentialAction: { '@type': 'DonateAction', target: `${h.SITE}/fr/soutenir/`, recipient: { '@id': `${h.SITE}/#org` } } })}
</head>
<body class="chooser-page">
<main id="main" class="chooser">
  <div class="hero-sky" aria-hidden="true"><div class="hero-sun"></div></div>
  <div class="chooser-card">
    <img src="/img/emblem-224.png" width="251" height="224" alt="Logo de La Paix du Cœur : un cœur vert tenu par deux mains dans une couronne de feuilles" class="chooser-logo">
    <h1 class="display-2">La Paix du Cœur <span>Kimia Na Motema</span></h1>
    <p class="lead">Allumer l’espérance, un cœur à la fois.<br><span lang="en-CA">Kindling hope, one heart at a time.</span></p>
    <div class="cta-row center">
      <a class="btn btn-primary btn-lg" href="/fr/" hreflang="fr-CA" lang="fr-CA">Entrer en français</a>
      <a class="btn btn-ghost btn-lg" href="/en/" hreflang="en-CA" lang="en-CA">Enter in English</a>
    </div>
  </div>
</main>
</body>
</html>
`;
}

export function notFound(h) {
  return `<!doctype html>
<html lang="fr-CA">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Page introuvable · Page not found — La Paix du Cœur</title><meta name="description" content="Cette page n’existe pas. This page does not exist."><meta name="robots" content="noindex"><link rel="icon" href="/favicon.ico" sizes="48x48"><link rel="stylesheet" href="${h.hashed['src/styles.css']}"></head>
<body class="chooser-page"><main id="main" class="chooser"><div class="hero-sky" aria-hidden="true"><div class="hero-sun"></div></div><div class="chooser-card">
<img src="/img/emblem-224.png" width="251" height="224" alt="Logo de La Paix du Cœur" class="chooser-logo">
<h1 class="display-2">Page introuvable <span lang="en-CA">Page not found</span></h1>
<p class="lead">Cette page s’est égarée. <span lang="en-CA">This page has wandered off.</span></p>
<div class="cta-row center"><a class="btn btn-primary btn-lg" href="/fr/">Accueil</a><a class="btn btn-ghost btn-lg" href="/en/" lang="en-CA">Home</a></div>
</div></main></body></html>
`;
}
