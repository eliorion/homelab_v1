import { esc, inline, md, plain, fmtDate, fmtTime, fmtRange, capFirst, isoWithOffset, googleCalUrl, outlookCalUrl } from './lib.mjs';
import { ROUTES, FEEDS, T, EVENT_TYPES, NEWS_CATS, HOODS } from './strings.mjs';
import { icon, sampleBadge, knitBand, pageHead, orgNode } from './layout.mjs';

/* ===================================================================== shared bits */
const typeTag = (type, lang) => `<span class="tag tag-${type}"><span class="dot" aria-hidden="true"></span>${T[lang].types[type]}</span>`;

export const dateTile = (local, lang, cls = '') => `<span class="datetile ${cls}" aria-hidden="true">
  <span class="dt-wd">${fmtDate(local, lang, { weekday: 'short' })}</span><span class="dt-d">${Number(local.slice(8, 10))}</span><span class="dt-m">${fmtDate(local, lang, { month: 'short' })}</span></span>`;

function addToCal(ev, lang, ctx, cls = '') {
  const t = T[lang]; const d = ev[lang];
  const opts = { title: d.title, start: ev.start, end: ev.end, details: `${d.summary}\n\n${ctx.site}${ev.url[lang]}`, location: d.address };
  return `<details class="addcal ${cls}"><summary>${icon('cal')}<span>${t.addToCal}</span></summary><ul>
    <li><a href="${esc(googleCalUrl(opts))}" target="_blank" rel="noopener">${t.addGoogle}<span class="visually-hidden"> (${lang === 'fr' ? 'nouvel onglet' : 'new tab'})</span></a></li>
    <li><a href="${ev.ics[lang]}" download>${t.addIcs}</a></li>
    <li><a href="${esc(outlookCalUrl(opts))}" target="_blank" rel="noopener">${t.addOutlook}<span class="visually-hidden"> (${lang === 'fr' ? 'nouvel onglet' : 'new tab'})</span></a></li></ul></details>`;
}

function eventCard(ev, lang, ctx, { headingLevel = 3 } = {}) {
  const d = ev[lang]; const t = T[lang];
  const h = `h${headingLevel}`;
  return `<article class="ev-card">
    ${dateTile(ev.start, lang)}
    <div class="ev-card-body">
      <p class="ev-meta-top">${typeTag(ev.type, lang)} ${sampleBadge(lang, true)}</p>
      <${h} class="ev-title"><a href="${ev.url[lang]}" class="stretched">${esc(d.title)}</a></${h}>
      <p class="ev-meta"><span>${icon('clock')}<span class="visually-hidden">${t.when} : </span>${capFirst(fmtDate(ev.start, lang, { weekday: 'long', day: 'numeric', month: 'long' }))}, ${fmtRange(ev.start, ev.end, lang)}</span>
      <span>${icon('pin')}${t.hoods[ev.hood]}</span></p>
    </div></article>`;
}

function dots(taken, spots) {
  const n = Math.min(spots, 12);
  const on = Math.round((taken / spots) * n);
  return `<span class="dots" aria-hidden="true">${Array.from({ length: n }, (_, i) => `<i${i < on ? ' class="on"' : ''}></i>`).join('')}</span>`;
}

const honeypot = (lang, idp) => `<div class="hp" aria-hidden="true"><label for="${idp}-website">${T[lang].honeypot}</label><input id="${idp}-website" name="website" type="text" tabindex="-1" autocomplete="off"></div>
  <!-- Cloudflare Turnstile (production): <div class="cf-turnstile" data-sitekey="SITE_KEY" data-language="${lang}"></div> + https://challenges.cloudflare.com/turnstile/v0/api.js -->`;

function formShell(lang, { kind, idp, action, inner, submit, thanks, cls = '' }) {
  const t = T[lang];
  return `<form class="form ${cls}" data-form="${kind}" action="${action}" method="post" id="${idp}">
    ${inner}
    ${honeypot(lang, idp)}
    <div class="form-actions"><button class="btn btn-pine" type="submit">${submit}</button></div>
    <p class="form-note">${t.formNote}</p>
  </form>
  <div class="form-thanks" id="${idp}-thanks" role="status" tabindex="-1" hidden>${icon('check', 'i i-lg')}<p class="form-thanks-title">${t.thanksTitle}</p><p>${thanks}</p></div>`;
}
const field = (id, label, input, hint = '') => `<div class="field"><label for="${id}">${label}</label>${hint ? `<p class="hint" id="${id}-hint">${hint}</p>` : ''}${input}</div>`;
const req = (lang) => ` <span class="req">(${T[lang].required})</span>`;

export function newsletterForm(ctx, lang, idp, { compact = false } = {}) {
  const t = T[lang]; const p = ctx.pages.newsletter[lang];
  const topics = p.topics.map((tp, i) => `<label class="check-card"><input type="checkbox" name="topics" value="${tp.key}"${i < 2 ? ' checked' : ''}><span><strong>${esc(tp.label)}</strong>${compact ? '' : `<small>${esc(tp.desc)}</small>`}</span></label>`).join('');
  const inner = `<div class="field-row">
      ${field(`${idp}-email`, t.email + req(lang), `<input id="${idp}-email" name="email" type="email" autocomplete="email" required>`)}
      ${field(`${idp}-fname`, `${t.firstName} <span class="req">(${t.optional})</span>`, `<input id="${idp}-fname" name="first_name" type="text" autocomplete="given-name">`)}
    </div>
    <fieldset class="topics"><legend>${t.topicsLegend}</legend><div class="check-grid">${topics}</div></fieldset>
    <fieldset class="inline-radios"><legend>${t.langPref}</legend>
      <label><input type="radio" name="lang" value="fr"${lang === 'fr' ? ' checked' : ''}> Français</label>
      <label><input type="radio" name="lang" value="en"${lang === 'en' ? ' checked' : ''}> English</label></fieldset>
    <fieldset class="consent"><legend class="visually-hidden">${t.consentLegend}</legend>
      <label class="check-line"><input type="checkbox" name="casl_consent" value="yes" required> <span>${esc(p.consent)}${req(lang)}</span></label>
      <p class="hint">${esc(p.double_optin)}</p></fieldset>`;
  return formShell(lang, { kind: 'newsletter', idp, action: '/api/newsletter', inner, submit: t.subscribeBtn, thanks: t.thanksNewsletter, cls: compact ? 'form-compact' : '' });
}

const sectionHead = (label, title, { link, linkText, id, lead } = {}) => `<div class="section-head">
  <div><p class="label">${esc(label)}</p><h2${id ? ` id="${id}"` : ''}>${esc(title)}</h2>${lead ? `<p class="section-lead">${esc(lead)}</p>` : ''}</div>
  ${link ? `<a class="link-arrow" href="${link}">${esc(linkText)}${icon('arrow')}</a>` : ''}</div>`;

const AID_ICONS = { alimentaire: 'bowl', vestimentaire: 'coat', academique: 'book', materielle: 'hands' };
const aidGrid = (aid) => `<ul class="aid-grid">${aid.map((a) => `<li>${icon(AID_ICONS[a.key] || 'heart', 'i i-aid')}<h3>${esc(a.title)}</h3><p>${esc(a.text)}</p></li>`).join('')}</ul>`;

/* ===================================================================== HOME */
export function homePage(ctx, lang) {
  const t = T[lang]; const p = ctx.pages.home[lang]; const pic = ctx.picture;
  const upcoming = ctx.events.filter((e) => !e.past).slice(0, 3);
  const latest = ctx.news.slice(0, 3);
  const drops = ctx.dropDates.slice(0, 4);
  const body = `
<section class="hero" aria-labelledby="hero-title">
  <canvas class="snow" data-snow aria-hidden="true"></canvas>
  <div class="wrap hero-grid">
    <div class="hero-text">
      <p class="label label-inv">${esc(p.hero_eyebrow)}</p>
      <h1 id="hero-title">${esc(p.hero_title)}</h1>
      <p class="hero-lead">${esc(p.hero_lead)}</p>
      <div class="hero-ctas"><a class="btn btn-snow" href="${ROUTES.events[lang]}">${icon('cal')}${t.fullCalendar}</a><a class="btn btn-maple" href="${ROUTES.give[lang]}">${icon('heart')}${t.donate}</a></div>
      <figure class="hero-verse"><blockquote><p>${esc(p.hero_verse)}</p></blockquote><figcaption>${esc(p.hero_verse_ref)}</figcaption></figure>
    </div>
    <div class="hero-media">${pic('food-bank-volunteers', p.hero_image_alt, { eager: true, sizes: '(min-width: 1000px) 560px, 100vw' })}</div>
  </div>
  <button class="snow-toggle" type="button" data-snow-toggle hidden aria-pressed="false">${icon('snow')}<span data-on>${t.snowPause}</span><span data-off hidden>${t.snowPlay}</span></button>
</section>
${knitBand()}
<section class="facts" aria-label="${t.factsLabel}"><div class="wrap"><ul class="facts-row">${t.facts.map(([n, l]) => `<li><strong>${n}</strong><span>${l}</span></li>`).join('')}</ul></div></section>

<section class="section"><div class="wrap">
  ${sectionHead(t.upcoming, lang === 'fr' ? 'Ce qui s’en vient' : 'What’s next', { link: ROUTES.events[lang], linkText: t.fullCalendar, lead: t.upcomingLead })}
  <div class="ev-cards">${upcoming.map((e) => eventCard(e, lang, ctx)).join('')}</div>
  <p class="subscribe-inline">${icon('cal')}<a href="${ctx.webcal}">${t.subscribe}</a> <span class="muted">— ${t.subscribeLead}</span></p>
</div></section>

<section class="section section-rule"><div class="wrap">
  ${sectionHead(lang === 'fr' ? 'S’impliquer' : 'Get involved', p.ways_title)}
  <ol class="ways">${p.ways.map((w, i) => `<li><span class="ways-n">0${i + 1}</span><h3>${esc(w.title)}</h3><p>${esc(w.text)}</p><a class="link-arrow" href="${ROUTES[w.link][lang]}">${esc(w.cta)}${icon('arrow')}</a></li>`).join('')}</ol>
</div></section>

<section class="section section-birch"><div class="wrap split">
  <div class="split-text">
    <p class="label">${lang === 'fr' ? 'Collectes alimentaires' : 'Food drives'}</p>
    <h2>${lang === 'fr' ? 'Un article de plus dans votre panier' : 'One more item in your cart'}</h2>
    <p>${esc(ctx.pages.drives[lang].lead)}</p>
    <a class="btn btn-pine" href="${ROUTES.drives[lang]}">${icon('pin')}${t.findDrive}</a>
  </div>
  <div class="split-table">
    <table class="info-table"><caption class="label">${t.nextDates} ${sampleBadge(lang, true)}</caption>
      <thead><tr><th scope="col">${lang === 'fr' ? 'Date' : 'Date'}</th><th scope="col">${t.neighbourhood}</th><th scope="col">${lang === 'fr' ? 'Lieu' : 'Location'}</th></tr></thead>
      <tbody>${drops.map((x) => `<tr><td>${capFirst(fmtDate(x.date, lang, { weekday: 'short', day: 'numeric', month: 'short' }))}<br><span class="muted">${fmtTime(x.date + 'T' + x.start, lang)} – ${fmtTime(x.date + 'T' + x.end, lang)}</span></td><td>${t.hoods[x.drop.hood]}</td><td>${esc(x.drop[lang].name)}</td></tr>`).join('')}</tbody>
    </table>
  </div>
</div></section>

<section class="section"><div class="wrap">
  ${sectionHead(lang === 'fr' ? 'Notre aide' : 'Our help', p.aid_title, { link: ROUTES.missions[lang], linkText: t.missions })}
  ${aidGrid(p.aid)}
</div></section>

<section class="verse-band"><div class="wrap"><figure>${icon('heart', 'i verse-heart')}<blockquote><p>${esc(p.verse2)}</p></blockquote><figcaption>${esc(p.verse2_ref)}</figcaption></figure></div></section>

<section class="section"><div class="wrap">
  ${sectionHead(t.nav[4][1], lang === 'fr' ? 'Nouvelles du terrain' : 'News from the field', { link: ROUTES.news[lang], linkText: t.seeAll })}
  <div class="news-cards">${latest.map((n) => newsCard(n, lang, ctx)).join('')}</div>
</div></section>

<section class="nl-band" aria-labelledby="nl-title"><div class="wrap nl-grid">
  <div class="nl-intro"><p class="label label-inv">${t.newsletter}</p><h2 id="nl-title">${t.newsletterTitle}</h2><p>${t.newsletterLead}</p></div>
  <div class="nl-form-wrap">${newsletterForm(ctx, lang, 'nl-home', { compact: true })}</div>
</div></section>`;
  return { title: p.meta_title, description: p.meta_description, body, bodyClass: 'is-home' };
}

/* ===================================================================== EVENTS */
export function eventsPage(ctx, lang) {
  const t = T[lang]; const p = ctx.pages.events[lang];
  const crumbs = [[t.home, ROUTES.home[lang]], [p.title, ROUTES.events[lang]]];
  const upcoming = ctx.events.filter((e) => !e.past);
  const past = ctx.events.filter((e) => e.past);
  const months = [...new Set(upcoming.map((e) => e.start.slice(0, 7)))];
  const row = (e) => `<li class="ev-row" data-type="${e.type}" data-month="${e.start.slice(0, 7)}">
    ${dateTile(e.start, lang)}
    <div class="ev-row-body">
      <p class="ev-meta-top">${typeTag(e.type, lang)} ${sampleBadge(lang, true)}</p>
      <h3 class="ev-title"><a href="${e.url[lang]}">${esc(e[lang].title)}</a></h3>
      <p class="ev-meta"><span>${icon('clock')}<span class="visually-hidden">${t.when} : </span>${capFirst(fmtDate(e.start, lang, { weekday: 'long', day: 'numeric', month: 'long' }))}, ${fmtRange(e.start, e.end, lang)}</span><span>${icon('pin')}${t.hoods[e.hood]}</span></p>
      <p class="ev-summary">${esc(e[lang].summary)}</p>
    </div>
    <div class="ev-row-actions">${addToCal(e, lang, ctx)}</div></li>`;
  const list = months.map((m) => `<section class="month-group" data-month="${m}" aria-labelledby="m-${m}">
      <h2 class="month-title" id="m-${m}">${capFirst(fmtDate(m + '-01', lang, { month: 'long', year: 'numeric' }))}</h2>
      <ol class="ev-list">${upcoming.filter((e) => e.start.startsWith(m)).map(row).join('')}</ol></section>`).join('');
  const calData = upcoming.map((e) => ({ id: e.id, url: e.url[lang], title: e[lang].title, type: e.type, date: e.start.slice(0, 10), time: fmtTime(e.start, lang), hood: t.hoods[e.hood] }));
  const aside = `<div class="subscribe-card"><p class="label">${icon('cal')}${t.subscribe}</p><p>${t.subscribeLead}</p>
    <ul class="link-list"><li><a href="${esc(ctx.googleSub)}" target="_blank" rel="noopener">${t.subscribeGoogle}${icon('ext')}</a></li><li><a href="${ctx.webcal}">${t.subscribeWebcal}</a></li><li><a href="${FEEDS.combined}" download>${t.downloadIcs}</a></li>
    <li><button type="button" class="linkish" data-copy-text="${ctx.site}${FEEDS.combined}" data-copied="${t.copied}">${icon('copy')}${t.copyFeed}</button></li></ul></div>`;
  const body = `${pageHead(lang, { eyebrow: p.eyebrow, title: p.title, lead: p.lead, crumbs, aside })}
<section class="section section-tight"><div class="wrap">
  <div class="cal-toolbar" data-cal-toolbar hidden>
    <div class="seg" role="group" aria-label="${t.viewLabel}">
      <button type="button" class="seg-btn" data-view="month" aria-pressed="true">${t.viewMonth}</button><button type="button" class="seg-btn" data-view="list" aria-pressed="false">${t.viewList}</button>
    </div>
    <div class="chips" role="group" aria-label="${t.filterType}">
      ${EVENT_TYPES.map((ty) => `<button type="button" class="chip chip-${ty}" data-type-filter="${ty}" aria-pressed="false"><span class="dot" aria-hidden="true"></span>${t.typesPlural[ty]}</button>`).join('')}
    </div>
    <div class="month-nav" data-month-nav><button type="button" class="icon-btn" data-month-step="-1" aria-label="${t.prevMonth}">${icon('arrow', 'i flip')}</button><h2 class="month-nav-title" data-month-title aria-live="polite">&nbsp;</h2><button type="button" class="icon-btn" data-month-step="1" aria-label="${t.nextMonth}">${icon('arrow')}</button></div>
  </div>
  <p class="sample-line">${sampleBadge(lang)} <span class="muted small">${lang === 'fr' ? 'Les activités affichées sont des exemples : dates, lieux et places restent à confirmer.' : 'The activities shown are samples: dates, places and spots are still to be confirmed.'}</span></p>
  <p class="visually-hidden" role="status" data-cal-status></p>
  <div class="cal-grid-wrap" data-cal-grid hidden></div>
  <div class="cal-list" data-cal-list>${list}<p class="empty" data-cal-empty hidden>${t.noEvents}</p></div>
  ${past.length ? `<details class="past"><summary>${t.pastEvents} (${past.length})</summary><ol class="ev-list">${past.map(row).join('')}</ol></details>` : ''}
  <script type="application/json" id="cal-data">${JSON.stringify({ lang, events: calData, weekdays: t.weekdaysShort, today: t.today, types: t.types, shownOne: t.eventsShown(1), shownMany: t.eventsShown(9999), monthNames: null }).replace(/</g, '\\u003c')}</script>
</div></section>`;
  return { title: p.meta_title, description: p.meta_description, body, crumbs, scripts: ['calendar'] };
}

export function eventPage(ctx, lang, ev) {
  const t = T[lang]; const d = ev[lang]; const pic = ctx.picture;
  const crumbs = [[t.home, ROUTES.home[lang]], [ctx.pages.events[lang].title, ROUTES.events[lang]], [d.title, ev.url[lang]]];
  const openShifts = ev.shifts.filter((s) => s.spots - s.taken > 0);
  const others = ctx.events.filter((e) => !e.past && e.id !== ev.id).slice(0, 3);
  const rsvp = ev.rsvp === 'zeffy'
    ? `<section class="card card-birch" aria-labelledby="tix"><h2 id="tix">${t.ticketsTitle}</h2>${d.price ? `<p>${inline(d.price)}</p>` : ''}
        <a class="btn btn-maple" href="${ctx.settings[lang].zeffy_tickets_url || '#zeffy-placeholder'}" data-zeffy>${icon('heart')}${t.ticketsBtn}</a>
        <p class="placeholder-note" id="zeffy-placeholder">${t.ticketsNote}</p></section>`
    : `<section class="card" aria-labelledby="rsvp"><h2 id="rsvp">${t.rsvpTitle}</h2><p>${t.rsvpLead}</p>
        ${formShell(lang, { kind: 'rsvp', idp: 'rsvp-form', action: '/api/rsvp', submit: t.rsvpSend, thanks: t.thanksRsvp,
          inner: `<input type="hidden" name="event" value="${ev.id}"><div class="field-row">${field('rsvp-name', t.name + req(lang), '<input id="rsvp-name" name="name" type="text" autocomplete="name" required>')}
            ${field('rsvp-email', t.email + req(lang), '<input id="rsvp-email" name="email" type="email" autocomplete="email" required>')}</div>
            ${field('rsvp-n', t.rsvpPeople, '<input id="rsvp-n" name="people" type="number" min="1" max="10" value="1" inputmode="numeric">')}` })}</section>`;
  const shifts = ev.shifts.length ? `<section class="card" aria-labelledby="serve"><h2 id="serve">${t.serveTitle}</h2>
      <ul class="shift-mini">${ev.shifts.map((s) => `<li><span>${esc(s['role_' + lang])}<br><span class="muted">${fmtRange(s.start, s.end, lang)}</span></span><span class="spots">${dots(s.taken, s.spots)}<span>${t.spotsLeft(s.spots - s.taken)}</span></span></li>`).join('')}</ul>
      ${openShifts.length ? `<a class="btn btn-pine" href="${ROUTES.volunteer[lang]}#q-${ev.id}">${t.serveBtn}</a>` : ''}</section>` : '';
  const body = `${pageHead(lang, { eyebrow: t.types[ev.type], title: d.title, lead: d.summary, crumbs, cls: 'page-head-event' })}
<div class="wrap event-layout">
  <div class="event-main">
    <p class="sample-line">${sampleBadge(lang)}</p>
    <div class="event-photo">${pic(ev.image, d.image_alt, { sizes: '(min-width: 1000px) 720px, 100vw', eager: true })}</div>
    <div class="prose">${md(d.body)}</div>
    ${d.bring?.length ? `<h2 class="h-small">${t.bring}</h2><ul class="check-list">${d.bring.map((b) => `<li>${icon('check')}${esc(b)}</li>`).join('')}</ul>` : ''}
    ${shifts}
    ${rsvp}
  </div>
  <aside class="event-aside" aria-label="${lang === 'fr' ? 'Informations pratiques' : 'Practical information'}">
    <div class="facts-card">
      ${dateTile(ev.start, lang, 'datetile-lg')}
      <dl>
        <div><dt>${icon('clock')}${t.when}</dt><dd>${capFirst(fmtDate(ev.start, lang))}<br>${fmtRange(ev.start, ev.end, lang)}</dd></div>
        <div><dt>${icon('pin')}${t.where}</dt><dd>${inline(d.address)}<br><span class="muted">${t.hoods[ev.hood]}, Montréal</span></dd></div>
        <div><dt>${icon('arrow')}${t.meeting}</dt><dd>${inline(d.meeting_point)}</dd></div>
        <div><dt>${icon('cal')}${t.type}</dt><dd>${typeTag(ev.type, lang)}</dd></div>
      </dl>
      ${addToCal(ev, lang, ctx, 'addcal-block')}
      <button type="button" class="btn btn-ghost btn-block" data-share data-copied="${t.copied}" data-title="${esc(d.title)}">${icon('share')}<span>${t.share}</span></button>
    </div>
  </aside>
</div>
<section class="section section-rule"><div class="wrap">
  ${sectionHead(t.upcoming, t.otherEvents, { link: ROUTES.events[lang], linkText: t.fullCalendar })}
  <div class="ev-cards">${others.map((e) => eventCard(e, lang, ctx)).join('')}</div>
</div></section>`;
  const site = ctx.site;
  const ld = {
    '@type': 'Event', '@id': `${site}${ev.url[lang]}#event`, name: d.title, description: d.summary, url: `${site}${ev.url[lang]}`, inLanguage: t.locale,
    startDate: isoWithOffset(ev.start), endDate: isoWithOffset(ev.end),
    eventStatus: 'https://schema.org/EventScheduled', eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: { '@type': 'Place', name: plain(d.address), address: { '@type': 'PostalAddress', streetAddress: plain(d.address), addressLocality: 'Montréal', addressRegion: 'QC', addressCountry: 'CA' } },
    image: [`${site}${ctx.imageUrl(ev.image)}`], organizer: { '@id': `${site}/#org` },
    isAccessibleForFree: ev.rsvp !== 'zeffy',
    offers: { '@type': 'Offer', url: `${site}${ev.url[lang]}`, price: ev.rsvp === 'zeffy' ? '75' : '0', priceCurrency: 'CAD', availability: 'https://schema.org/InStock', validFrom: '2026-11-01T00:00:00-04:00' },
  };
  return { title: `${d.title} — ${capFirst(fmtDate(ev.start, lang, { day: 'numeric', month: 'long', year: 'numeric' }))} | La Paix du Cœur`, description: `${d.summary} ${capFirst(fmtDate(ev.start, lang))}, ${fmtRange(ev.start, ev.end, lang)}.`, body, crumbs, jsonld: [ld], ogImage: ctx.imageUrl(ev.image), ogType: 'article' };
}

/* ===================================================================== FOOD DRIVES */
export function drivesPage(ctx, lang) {
  const t = T[lang]; const p = ctx.pages.drives[lang];
  const crumbs = [[t.home, ROUTES.home[lang]], [p.title, ROUTES.drives[lang]]];
  const hoods = HOODS.filter((h) => ctx.drops.some((d) => d.hood === h));
  const cards = ctx.drops.map((d) => {
    const dates = d.dates.filter((x) => x.date >= ctx.todayStr);
    const opts = (x) => ({ title: `${lang === 'fr' ? 'Collecte alimentaire' : 'Food drive'} — ${d[lang].name}`, start: `${x.date}T${x.start}`, end: `${x.date}T${x.end}`, details: `La Paix du Cœur — ${ctx.site}${ROUTES.drives[lang]}`, location: plain(d[lang].address) });
    return `<li class="drop-card" data-hood="${d.hood}" data-dates="${dates.map((x) => x.date).join(' ')}">
      <p class="label">${t.hoods[d.hood]} ${sampleBadge(lang, true)}</p>
      <h3>${esc(d[lang].name)}</h3>
      <p class="drop-addr">${icon('pin')}<span>${inline(d[lang].address)}</span></p>
      <h4 class="mini-head">${t.nextDates}</h4>
      <ul class="drop-dates">${dates.map((x) => `<li data-date="${x.date}"><span>${capFirst(fmtDate(x.date, lang, { weekday: 'long', day: 'numeric', month: 'long' }))}</span><span class="muted">${fmtTime(x.date + 'T' + x.start, lang)} – ${fmtTime(x.date + 'T' + x.end, lang)}</span>
        <a class="mini-link" href="${esc(googleCalUrl(opts(x)))}" target="_blank" rel="noopener">${icon('cal')}<span class="visually-hidden">${t.addToCal} — ${fmtDate(x.date, lang, { day: 'numeric', month: 'long' })} (Google)</span><span aria-hidden="true">+</span></a></li>`).join('')}</ul>
      <p class="drop-note muted">${esc(d[lang].hours_note)}</p>
    </li>`;
  }).join('');
  const body = `${pageHead(lang, { eyebrow: p.eyebrow, title: p.title, lead: p.lead, crumbs })}
<section class="section section-tight"><div class="wrap">
  <ol class="steps">${p.steps.map((s, i) => `<li><span class="steps-n">${i + 1}</span><h2 class="h-small">${esc(s.title)}</h2><p>${esc(s.text)}</p></li>`).join('')}</ol>
</div></section>
<section class="section section-tight" aria-labelledby="finder-title"><div class="wrap finder">
  <div class="finder-main">
    <h2 id="finder-title">${t.findDrive}</h2>
    <div class="finder-filters" data-finder-filters hidden>
      <div class="chips" role="group" aria-label="${t.neighbourhood}">
        <button type="button" class="chip" data-hood-filter="" aria-pressed="true">${t.all}</button>
        ${hoods.map((h) => `<button type="button" class="chip" data-hood-filter="${h}" aria-pressed="false">${t.hoods[h]}</button>`).join('')}
      </div>
      <div class="field field-inline"><label for="period">${t.period}</label><select id="period" data-period><option value="all">${t.periodAll}</option><option value="30">${t.period30}</option></select></div>
    </div>
    <p class="result-count" role="status" data-finder-status>${t.drivesShown(ctx.drops.length)}</p>
    <ul class="drop-grid" data-finder-list data-label-one="${esc(t.drivesShown(1))}" data-label-many="${esc(t.drivesShown(2))}">${cards}</ul>
    <p class="empty" data-finder-empty hidden>${t.noDrives}</p>
  </div>
  <aside class="finder-aside">
    <div class="card card-birch"><h2 class="h-small">${t.mostNeeded}</h2><ul class="check-list">${p.needs.map((n) => `<li>${icon('check')}${esc(n)}</li>`).join('')}</ul><p class="muted small">${esc(p.avoid)}</p></div>
    <div class="card card-pine"><h2 class="h-small">${esc(p.partner_title)}</h2><p>${esc(p.partner_text)}</p><a class="btn btn-snow" href="${ROUTES.contact[lang]}">${t.becomePartner}</a></div>
  </aside>
</div></section>`;
  return { title: p.meta_title, description: p.meta_description, body, crumbs };
}

/* ===================================================================== VOLUNTEER */
export function volunteerPage(ctx, lang) {
  const t = T[lang]; const p = ctx.pages.volunteer[lang];
  const crumbs = [[t.home, ROUTES.home[lang]], [p.title, ROUTES.volunteer[lang]]];
  const evs = ctx.events.filter((e) => !e.past && e.shifts.length);
  const options = evs.map((e) => `<optgroup label="${esc(fmtDate(e.start, lang, { day: 'numeric', month: 'short' }) + ' — ' + e[lang].title)}">${e.shifts.map((s) => `<option value="${e.id}__${s.id}"${s.spots - s.taken <= 0 ? ' disabled' : ''}>${esc(s['role_' + lang])} (${fmtRange(s.start, s.end, lang)})${s.spots - s.taken <= 0 ? ' — ' + t.spotsLeft(0) : ''}</option>`).join('')}</optgroup>`).join('');
  const groups = evs.map((e) => `<li class="shift-group" id="q-${e.id}">
      <div class="shift-event">${dateTile(e.start, lang)}<div><p class="ev-meta-top">${typeTag(e.type, lang)} ${sampleBadge(lang, true)}</p><h3><a href="${e.url[lang]}">${esc(e[lang].title)}</a></h3><p class="muted">${icon('pin')}${t.hoods[e.hood]}</p></div></div>
      <ul class="shift-rows">${e.shifts.map((s) => { const left = s.spots - s.taken; return `<li class="shift-row${left <= 0 ? ' is-full' : ''}">
        <div class="shift-role"><strong>${esc(s['role_' + lang])}</strong><span class="muted">${s.start.slice(0, 10) !== e.start.slice(0, 10) ? capFirst(fmtDate(s.start, lang, { weekday: 'short', day: 'numeric', month: 'short' })) + ', ' : ''}${fmtRange(s.start, s.end, lang)}</span></div>
        <div class="spots">${dots(s.taken, s.spots)}<span><strong>${t.spotsLeft(left)}</strong><span class="muted"> · ${t.spotsOf(s.taken, s.spots)}</span></span></div>
        <div>${left > 0 ? `<a class="btn btn-sm btn-pine" href="#inscription" data-shift="${e.id}__${s.id}">${t.signUp}<span class="visually-hidden"> — ${esc(s['role_' + lang])}, ${fmtDate(s.start, lang, { day: 'numeric', month: 'long' })}</span></a>` : `<a class="btn btn-sm btn-ghost" href="${ROUTES.contact[lang]}">${t.waitlist}</a>`}</div></li>`; }).join('')}</ul></li>`).join('');
  const inner = `<div class="field-row">${field('v-name', t.name + req(lang), '<input id="v-name" name="name" type="text" autocomplete="name" required>')}
      ${field('v-email', t.email + req(lang), '<input id="v-email" name="email" type="email" autocomplete="email" required>')}</div>
    <div class="field-row">${field('v-phone', t.phone, '<input id="v-phone" name="phone" type="tel" autocomplete="tel">')}
      ${field('v-shift', t.chooseShift + req(lang), `<select id="v-shift" name="shift" required data-shift-select><option value="">${t.chooseShiftPh}</option>${options}</select>`)}</div>
    ${field('v-msg', `${t.message} <span class="req">(${t.optional})</span>`, '<textarea id="v-msg" name="message" rows="3"></textarea>')}
    <label class="check-line"><input type="checkbox" name="first_time" value="yes"> <span>${t.firstTime}</span></label>
    <label class="check-line"><input type="checkbox" name="adult" value="yes" required> <span>${t.adult}${req(lang)}</span></label>`;
  const body = `${pageHead(lang, { eyebrow: p.eyebrow, title: p.title, lead: p.lead, crumbs })}
<section class="section section-tight"><div class="wrap"><ol class="steps steps-3">${p.expect.map((s, i) => `<li><span class="steps-n">${i + 1}</span><h2 class="h-small">${esc(s.title)}</h2><p>${esc(s.text)}</p></li>`).join('')}</ol></div></section>
<section class="section section-tight" aria-labelledby="shifts-title"><div class="wrap">
  <h2 id="shifts-title">${t.shiftsTitle}</h2>
  <ol class="shift-groups">${groups}</ol>
</div></section>
${knitBand('knit-thin')}
<section class="section section-birch" id="inscription" aria-labelledby="form-title"><div class="wrap split split-form">
  <div><h2 id="form-title">${t.formTitle}</h2>${formShell(lang, { kind: 'volunteer', idp: 'vol-form', action: '/api/volunteer', inner, submit: t.signUp, thanks: t.thanksVolunteer })}</div>
  <div><h2 class="h-small">${t.faq}</h2><div class="faq">${p.faq.map((f) => `<details><summary>${esc(f.q)}</summary><p>${inline(f.a)}</p></details>`).join('')}</div></div>
</div></section>`;
  return { title: p.meta_title, description: p.meta_description, body, crumbs };
}

/* ===================================================================== TOOLKITS */
export const checklistTxt = (lang, aud, ctx) => {
  const t = T[lang];
  const lines = [`LA PAIX DU CŒUR — ${t.toolkitFor(aud.name).toUpperCase()}`, `${t.checklist}`, '='.repeat(48), '',
    ...aud.checklist.map((c) => `[ ] ${c}`), '', `${t.notes}:`, '', '_'.repeat(48), '_'.repeat(48), '',
    `${t.contactEmail}: ${ctx.settings[lang].email}`, `${ctx.site}${ROUTES.toolkits[lang]}`, ''];
  return lines.join('\r\n');
};
export const toolkitPaths = (lang, aud) => {
  const base = `${ROUTES.toolkits[lang]}${aud.slug}/`;
  return { page: base, txt: `${base}${lang === 'fr' ? 'liste-de-verification' : 'checklist'}.txt` };
};

export function toolkitsPage(ctx, lang) {
  const t = T[lang]; const p = ctx.pages.toolkits[lang];
  const crumbs = [[t.home, ROUTES.home[lang]], [p.title, ROUTES.toolkits[lang]]];
  const panels = p.audiences.map((a, ai) => {
    const paths = toolkitPaths(lang, a);
    return `<section class="tk-panel" id="tk-${a.key}" data-tab-panel aria-labelledby="tk-h-${a.key}">
      <div class="tk-head"><h2 id="tk-h-${a.key}">${esc(t.toolkitFor(a.name))}</h2><p class="section-lead">${esc(a.intro)}</p></div>
      <h3 class="label">${t.ideas}</h3>
      <ol class="ways ways-3">${a.ideas.map((i, n) => `<li><span class="ways-n">0${n + 1}</span><h4>${esc(i.title)}</h4><p>${inline(i.text)}</p></li>`).join('')}</ol>
      <div class="tk-split">
        <div class="card"><h3 class="h-small">${t.checklist}</h3><ul class="box-list">${a.checklist.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
          <div class="btn-row"><a class="btn btn-pine btn-sm" href="${paths.page}">${icon('print')}${t.printChecklist}</a><a class="btn btn-ghost btn-sm" href="${paths.txt}" download>${icon('download')}${t.downloadTxt}</a></div></div>
        <div><h3 class="h-small">${t.captions}</h3><ul class="captions">${a.captions.map((c, ci) => `<li class="caption-card"><p id="cap-${a.key}-${ci}">${inline(c)}</p><button type="button" class="btn btn-ghost btn-sm" data-copy="#cap-${a.key}-${ci}" data-copied="${t.copied}">${icon('copy')}<span>${t.copy}</span></button></li>`).join('')}</ul></div>
      </div></section>`;
  }).join('');
  const body = `${pageHead(lang, { eyebrow: p.eyebrow, title: p.title, lead: p.lead, crumbs })}
<section class="section section-tight"><div class="wrap">
  <div class="tabs" role="tablist" aria-label="${p.eyebrow}" data-tabs hidden>${p.audiences.map((a, i) => `<button type="button" role="tab" id="tab-${a.key}" aria-controls="tk-${a.key}" aria-selected="${i === 0}"${i ? ' tabindex="-1"' : ''}>${esc(a.name)}</button>`).join('')}</div>
  ${panels}
  <p class="callout">${icon('mail')}<span>${esc(t.toolkitContact)} <a href="${ROUTES.contact[lang]}">${t.contact}</a></span></p>
</div></section>`;
  return { title: p.meta_title, description: p.meta_description, body, crumbs };
}

export function toolkitPrintPage(ctx, lang, aud) {
  const t = T[lang]; const p = ctx.pages.toolkits[lang]; const paths = toolkitPaths(lang, aud);
  const crumbs = [[t.home, ROUTES.home[lang]], [p.title, ROUTES.toolkits[lang]], [t.toolkitFor(aud.name), paths.page]];
  const body = `<div class="wrap printable">
  ${pageHead(lang, { eyebrow: `${t.checklist} · ${aud.name}`, title: t.toolkitFor(aud.name), lead: aud.intro, crumbs, cls: 'page-head-print' }).replace('class="wrap"', 'class=""')}
  <div class="btn-row no-print"><button type="button" class="btn btn-pine" data-print>${icon('print')}${t.print}</button><a class="btn btn-ghost" href="${paths.txt}" download>${icon('download')}${t.downloadTxt}</a></div>
  <h2>${t.checklist}</h2>
  <ul class="box-list box-list-print">${aud.checklist.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
  <h2>${t.ideas}</h2>
  <ul class="plain-list">${aud.ideas.map((i) => `<li><strong>${esc(i.title)}.</strong> ${esc(i.text)}</li>`).join('')}</ul>
  <h2>${t.notes}</h2><div class="note-lines" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
  <p class="print-foot">La Paix du Cœur / Kimia Na Motema · ${ctx.settings[lang].email} · ${ctx.site.replace('https://', '')}</p>
</div>`;
  return { title: `${t.toolkitFor(aud.name)} — ${t.checklist} | La Paix du Cœur`, description: `${aud.intro} ${t.checklist} ${lang === 'fr' ? 'à imprimer' : 'to print'}.`, body, crumbs, bodyClass: 'is-print' };
}

/* ===================================================================== NEWS */
export function newsCard(n, lang, ctx, { big = false } = {}) {
  const t = T[lang]; const d = n[lang];
  return `<article class="news-card${big ? ' news-card-big' : ''}" data-cat="${n.category}">
    <div class="news-img">${ctx.picture(n.image, d.image_alt, { sizes: big ? '(min-width: 1000px) 640px, 100vw' : '(min-width: 1000px) 400px, 100vw' })}</div>
    <div class="news-body"><p class="news-meta"><span class="label">${t.cats[n.category]}</span><time datetime="${n.date}">${fmtDate(n.date, lang, { day: 'numeric', month: 'long', year: 'numeric' })}</time></p>
    <h3><a class="stretched" href="${n.url[lang]}">${esc(d.title)}</a></h3><p>${esc(d.summary)}</p>${sampleBadge(lang, true)}</div></article>`;
}

export function newsListPage(ctx, lang) {
  const t = T[lang]; const p = ctx.pages.news[lang];
  const crumbs = [[t.home, ROUTES.home[lang]], [p.title, ROUTES.news[lang]]];
  const cats = NEWS_CATS.filter((c) => ctx.news.some((n) => n.category === c));
  const aside = `<a class="btn btn-ghost btn-sm" href="${FEEDS.rss[lang]}">${icon('rss')}${t.rss}</a>`;
  const body = `${pageHead(lang, { eyebrow: p.eyebrow, title: p.title, lead: p.lead, crumbs, aside })}
<section class="section section-tight"><div class="wrap">
  <div class="chips chips-filter" role="group" aria-label="${t.filterCat}" data-cat-filters hidden>
    <button type="button" class="chip" data-cat-filter="" aria-pressed="true">${t.allF}</button>
    ${cats.map((c) => `<button type="button" class="chip" data-cat-filter="${c}" aria-pressed="false">${t.cats[c]}</button>`).join('')}
  </div>
  <p class="visually-hidden" role="status" data-cat-status></p>
  <h2 class="visually-hidden">${p.title}</h2>
  <div class="news-grid" data-cat-list>${ctx.news.map((n, i) => newsCard(n, lang, ctx, { big: i === 0 })).join('')}</div>
</div></section>`;
  return { title: p.meta_title, description: p.meta_description, body, crumbs };
}

export function articlePage(ctx, lang, n) {
  const t = T[lang]; const d = n[lang];
  const crumbs = [[t.home, ROUTES.home[lang]], [ctx.pages.news[lang].title, ROUTES.news[lang]], [d.title, n.url[lang]]];
  const related = ctx.news.filter((x) => x.id !== n.id).slice(0, 3);
  const body = `<article class="article">
  ${pageHead(lang, { eyebrow: t.cats[n.category], title: d.title, lead: d.summary, crumbs, cls: 'page-head-article' })}
  <div class="wrap article-wrap">
    <p class="article-meta"><span>${t.by} ${inline(d.author)}</span><span>${t.published} <time datetime="${n.date}">${fmtDate(n.date, lang, { day: 'numeric', month: 'long', year: 'numeric' })}</time></span>${sampleBadge(lang)}</p>
    <div class="article-photo">${ctx.picture(n.image, d.image_alt, { eager: true, sizes: '(min-width: 1000px) 900px, 100vw' })}</div>
    <div class="prose">${md(d.body)}</div>
    <p class="article-share"><button type="button" class="btn btn-ghost btn-sm" data-share data-copied="${t.copied}" data-title="${esc(d.title)}">${icon('share')}<span>${t.share}</span></button> <a class="link-arrow" href="${ROUTES.news[lang]}">${t.backToNews}${icon('arrow')}</a></p>
  </div>
</article>
<section class="section section-rule"><div class="wrap">${sectionHead(t.nav[4][1], t.related)}<div class="news-cards">${related.map((r) => newsCard(r, lang, ctx)).join('')}</div></div></section>`;
  const site = ctx.site;
  const ld = { '@type': 'NewsArticle', '@id': `${site}${n.url[lang]}#article`, headline: d.title, description: d.summary, inLanguage: t.locale,
    datePublished: isoWithOffset(`${n.date}T09:00`), dateModified: isoWithOffset(`${n.date}T09:00`), image: [`${site}${ctx.imageUrl(n.image)}`],
    author: { '@type': 'Organization', name: plain(d.author), url: `${site}/` }, publisher: { '@id': `${site}/#org` },
    mainEntityOfPage: `${site}${n.url[lang]}`, articleSection: t.cats[n.category] };
  return { title: `${d.title} | La Paix du Cœur`, description: d.summary, body, crumbs, jsonld: [ld], ogType: 'article', ogImage: ctx.imageUrl(n.image) };
}

/* ===================================================================== MEDIA */
export function mediaPage(ctx, lang) {
  const t = T[lang]; const p = ctx.pages.media[lang]; const pic = ctx.picture;
  const crumbs = [[t.home, ROUTES.home[lang]], [p.title, ROUTES.media[lang]]];
  const videos = ctx.media.filter((m) => m.kind === 'video');
  const audios = ctx.media.filter((m) => m.kind === 'audio');
  const photos = ctx.media.filter((m) => m.kind === 'photo');
  const body = `${pageHead(lang, { eyebrow: p.eyebrow, title: p.title, lead: p.lead, crumbs })}
<section class="section section-tight" aria-labelledby="vid"><div class="wrap">
  <h2 id="vid">${t.videos}</h2>
  ${videos.map((v) => `<figure class="video">
    <div class="yt" data-yt="${esc(v.youtube_id)}" data-yt-title="${esc(v[lang].title)}">
      ${pic(v.image, v[lang].image_alt, { sizes: '(min-width: 1000px) 900px, 100vw' })}
      <button type="button" class="yt-play">${icon('play', 'i i-play')}<span>${t.play}<span class="visually-hidden"> : ${esc(v[lang].title)}</span></span><span class="yt-dur">${esc(v.duration || '')}</span></button>
    </div>
    <figcaption><strong>${esc(v[lang].title)}</strong> ${sampleBadge(lang, true)}<br>${esc(v[lang].description)}<br><span class="muted small">${t.ytNote}</span></figcaption></figure>`).join('')}
</div></section>
<section class="section section-birch" aria-labelledby="pod"><div class="wrap">
  <h2 id="pod">${t.podcast}</h2>
  ${audios.map((a, i) => `<div class="audio-card">
    <div class="audio-art">${pic(a.image, a[lang].image_alt, { sizes: '200px' })}</div>
    <div class="audio-main">
      <p class="label">${lang === 'fr' ? 'Épisode' : 'Episode'} ${i + 1} ${sampleBadge(lang, true)}</p>
      <h3>${esc(a[lang].title)}</h3><p>${esc(a[lang].description)}</p>
      <div class="player" data-audio>
        <audio src="${esc(a.audio_file)}" preload="metadata"></audio>
        <button type="button" class="player-btn" data-audio-toggle aria-label="${t.playAudio} — ${esc(a[lang].title)}" data-label-play="${t.playAudio}" data-label-pause="${t.pauseAudio}">${icon('play', 'i i-play')}${icon('pause', 'i i-pause')}</button>
        <input type="range" class="player-seek" min="0" max="100" step="0.1" value="0" aria-label="${lang === 'fr' ? 'Position de lecture' : 'Playback position'}" data-audio-seek>
        <span class="player-time" data-audio-time>0:00 / ${esc(a.duration)}</span>
        <noscript><a href="${esc(a.audio_file)}">MP3</a></noscript>
      </div>
      <details class="transcript"><summary>${t.transcript}</summary><div class="prose">${md(a[lang].transcript)}</div></details>
    </div></div>`).join('')}
</div></section>
<section class="section" aria-labelledby="pho"><div class="wrap">
  <h2 id="pho">${t.photos}</h2>
  <ul class="gallery">${photos.map((ph) => `<li><figure>${pic(ph.image, ph[lang].image_alt, { sizes: '(min-width: 1000px) 400px, (min-width: 600px) 50vw, 100vw' })}<figcaption><strong>${esc(ph[lang].title)}</strong><span>${inline(ph[lang].description)}</span></figcaption></figure></li>`).join('')}</ul>
</div></section>`;
  const ld = videos.map((v) => ({ '@type': 'VideoObject', name: v[lang].title, description: v[lang].description, thumbnailUrl: `${ctx.site}${ctx.imageUrl(v.image)}`, uploadDate: `${v.date}T12:00:00-05:00`, embedUrl: `https://www.youtube-nocookie.com/embed/${v.youtube_id}` }));
  return { title: p.meta_title, description: p.meta_description, body, crumbs, jsonld: ld };
}

/* ===================================================================== GIVE */
export function givePage(ctx, lang) {
  const t = T[lang]; const p = ctx.pages.give[lang]; const s = ctx.settings[lang];
  const crumbs = [[t.home, ROUTES.home[lang]], [p.title, ROUTES.give[lang]]];
  const money = (n) => (lang === 'fr' ? `${n} $` : `$${n}`);
  const body = `${pageHead(lang, { eyebrow: p.eyebrow, title: p.title, lead: p.lead, crumbs, cls: 'page-head-quote' })}
<section class="section section-tight"><div class="wrap give-grid">
  <div class="card card-give" aria-labelledby="give-online">
    <p class="label">Zeffy</p><h2 id="give-online">${t.giveOnline}</h2><p>${t.giveOnlineLead}</p>
    <form class="give-form" data-give action="${s.zeffy_donate_url || '#zeffy-form'}" method="get">
      <fieldset class="seg seg-wide"><legend class="visually-hidden">${lang === 'fr' ? 'Fréquence' : 'Frequency'}</legend>
        <label><input type="radio" name="freq" value="once" checked><span>${t.once}</span></label><label><input type="radio" name="freq" value="monthly"><span>${t.monthly}</span></label></fieldset>
      <fieldset class="amounts"><legend class="visually-hidden">${lang === 'fr' ? 'Montant' : 'Amount'}</legend>
        ${p.amounts.map((a, i) => `<label class="amount"><input type="radio" name="amount" value="${a.amount}"${i === 1 ? ' checked' : ''}><span class="amount-n">${money(a.amount)}</span><span class="amount-l">${esc(a.label)}</span></label>`).join('')}
        <label class="amount amount-other"><input type="radio" name="amount" value="other"><span class="amount-n">${t.otherAmount}</span><span class="amount-l"><span class="visually-hidden">${t.otherAmount}</span><input type="number" name="other_amount" min="5" step="1" inputmode="numeric" aria-label="${t.otherAmount} (CAD)" placeholder="${money('…')}"></span></label>
      </fieldset>
      <p class="muted small">${inline(p.amounts_note)}</p>
      <button class="btn btn-maple btn-block" type="submit">${icon('heart')}${t.continueZeffy}</button>
      <p class="placeholder-note" id="zeffy-form" role="status" data-give-status>${t.zeffyNote}</p>
    </form>
  </div>
  <div class="give-side">
    <div class="card"><p class="label">Interac</p><h2 class="h-small">${t.interac}</h2>
      <ol class="num-list">${p.interac_steps.map((x) => `<li>${inline(x)}</li>`).join('')}</ol>
      <p class="copy-field"><span class="muted small">${t.interacTo}</span><code id="interac-email">${esc(s.interac_email)}</code><button type="button" class="btn btn-ghost btn-sm" data-copy="#interac-email" data-copied="${t.copied}">${icon('copy')}<span>${t.copy}</span></button></p></div>
    <div class="card card-birch"><h2 class="h-small">${t.bank}</h2><p>${inline(p.bank_note)}</p><h2 class="h-small">${t.receipts}</h2><p>${inline(p.receipt_note)}</p></div>
  </div>
</div></section>
${knitBand('knit-thin')}
<section class="section"><div class="wrap split">
  <div><h2>${t.inKind}</h2><ul class="check-list">${p.in_kind.map((x) => `<li>${icon('check')}${esc(x)}</li>`).join('')}</ul>
    <p><a class="link-arrow" href="${ROUTES.drives[lang]}">${t.findDrive}${icon('arrow')}</a></p></div>
  <div><h2>${t.otherWays}</h2><ul class="link-cards">
    <li><a href="${ROUTES.volunteer[lang]}"><strong>${t.nav[2][1]}</strong><span>${lang === 'fr' ? 'Donner quelques heures, un jeudi soir ou un samedi.' : 'Give a few hours on a Thursday night or a Saturday.'}</span></a></li>
    <li><a href="${ROUTES.toolkits[lang]}"><strong>${t.nav[3][1]}</strong><span>${lang === 'fr' ? 'Organiser une collecte dans votre église, école ou entreprise.' : 'Run a food drive at your church, school or workplace.'}</span></a></li>
    <li><a href="${ROUTES.newsletter[lang]}"><strong>${lang === 'fr' ? 'Prier avec nous' : 'Pray with us'}</strong><span>${lang === 'fr' ? 'Recevoir les sujets de prière du lundi.' : 'Receive Monday prayer requests.'}</span></a></li></ul></div>
</div></section>
<section class="section section-rule"><div class="wrap narrow"><h2>${t.faq}</h2><div class="faq">${p.faq.map((f) => `<details><summary>${esc(f.q)}</summary><p>${inline(f.a)}</p></details>`).join('')}</div></div></section>`;
  const faqLd = { '@type': 'FAQPage', mainEntity: p.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: plain(f.a) } })) };
  return { title: p.meta_title, description: p.meta_description, body, crumbs, jsonld: [faqLd] };
}

/* ===================================================================== NEWSLETTER / CONTACT */
export function newsletterPage(ctx, lang) {
  const t = T[lang]; const p = ctx.pages.newsletter[lang];
  const crumbs = [[t.home, ROUTES.home[lang]], [p.title, ROUTES.newsletter[lang]]];
  const body = `${pageHead(lang, { eyebrow: p.eyebrow, title: p.title, lead: p.lead, crumbs })}
<section class="section section-tight"><div class="wrap narrow">${newsletterForm(ctx, lang, 'nl-page')}</div></section>`;
  return { title: p.meta_title, description: p.meta_description, body, crumbs };
}

export function contactPage(ctx, lang) {
  const t = T[lang]; const p = ctx.pages.contact[lang]; const s = ctx.settings[lang];
  const crumbs = [[t.home, ROUTES.home[lang]], [p.title, ROUTES.contact[lang]]];
  const inner = `<div class="field-row">${field('c-name', t.name + req(lang), '<input id="c-name" name="name" type="text" autocomplete="name" required>')}
    ${field('c-email', t.email + req(lang), '<input id="c-email" name="email" type="email" autocomplete="email" required>')}</div>
    ${field('c-subject', t.subject, `<select id="c-subject" name="subject">${p.subjects.map((x) => `<option>${esc(x)}</option>`).join('')}</select>`)}
    ${field('c-msg', t.message + req(lang), '<textarea id="c-msg" name="message" rows="6" required></textarea>')}`;
  const body = `${pageHead(lang, { eyebrow: p.eyebrow, title: p.title, lead: p.lead, crumbs })}
<section class="section section-tight"><div class="wrap split split-form">
  <div>${formShell(lang, { kind: 'contact', idp: 'contact-form', action: '/api/contact', inner, submit: t.send, thanks: t.thanksContact })}</div>
  <aside class="contact-aside">
    <div class="card"><h2 class="h-small">${t.contactEmail}</h2><p><a class="big-link" href="mailto:${s.email}">${icon('mail')}${s.email}</a></p>
      <p class="muted small">${lang === 'fr' ? 'Pas de téléphone ni d’adresse publique pour l’instant [à confirmer].' : 'No public phone number or street address for now [to confirm].'}</p></div>
    <div class="card card-birch"><h2 class="h-small">${t.socials}</h2><ul class="plain-list">${s.social.map((x) => `<li>${esc(x.network)} ${x.url ? `<a href="${esc(x.url)}">${esc(x.url)}</a>` : `<span class="tbc">${t.socialTbc}</span>`}</li>`).join('')}</ul></div>
    <p class="muted small">${inline(t.responsible)} — <a href="${ROUTES.privacy[lang]}">${t.privacy}</a></p>
  </aside>
</div></section>`;
  return { title: p.meta_title, description: p.meta_description, body, crumbs };
}

/* ===================================================================== ABOUT / MISSIONS / PROSE */
export function aboutPage(ctx, lang) {
  const t = T[lang]; const p = ctx.pages.about[lang]; const home = ctx.pages.home[lang];
  const crumbs = [[t.home, ROUTES.home[lang]], [p.eyebrow, ROUTES.about[lang]]];
  const body = `${pageHead(lang, { eyebrow: p.eyebrow, title: p.title, lead: p.lead, crumbs })}
<section class="section section-tight"><div class="wrap split split-media">
  <div class="prose prose-lg"><p>${esc(p.about)}</p></div>
  <div class="framed">${ctx.picture('bible-study', lang === 'fr' ? 'Un groupe assis en cercle autour d’une Bible ouverte' : 'A group sitting in a circle around an open Bible', { sizes: '(min-width: 1000px) 560px, 100vw' })}</div>
</div></section>
<section class="mission-band" aria-labelledby="mission"><div class="wrap narrow"><p class="label label-inv">${lang === 'fr' ? 'Notre mission' : 'Our mission'}</p><h2 id="mission" class="visually-hidden">${lang === 'fr' ? 'Notre mission' : 'Our mission'}</h2><p class="mission-text">${esc(p.mission)}</p></div></section>
${knitBand()}
<section class="section"><div class="wrap">
  ${sectionHead(lang === 'fr' ? 'Valeurs' : 'Values', lang === 'fr' ? 'Ce qui nous guide' : 'What guides us')}
  <ol class="ways">${p.values.map((v, i) => `<li><span class="ways-n">0${i + 1}</span><h3>${esc(v.title)}</h3><p>${esc(v.text)}</p></li>`).join('')}</ol>
  <p><a class="link-arrow" href="${ROUTES.ethics[lang]}">${t.ethics}${icon('arrow')}</a></p>
</div></section>
<section class="section section-birch"><div class="wrap">
  ${sectionHead(lang === 'fr' ? 'Repères' : 'Milestones', lang === 'fr' ? 'Depuis 2014' : 'Since 2014')}
  <ol class="timeline">${p.timeline.map((x) => `<li><span class="tl-year">${inline(x.year)}</span><p>${inline(x.text)}</p></li>`).join('')}</ol>
</div></section>
<section class="section"><div class="wrap split">
  <div><h2>${lang === 'fr' ? 'L’équipe' : 'The team'}</h2><p>${inline(p.team_note)}</p><p class="muted">${inline(p.legal_note)}</p></div>
  <div class="verse-stack">
    <figure class="verse-card"><blockquote><p>${esc(home.hero_verse)}</p></blockquote><figcaption>${esc(home.hero_verse_ref)}</figcaption></figure>
    <figure class="verse-card"><blockquote><p>${esc(home.verse2)}</p></blockquote><figcaption>${esc(home.verse2_ref)}</figcaption></figure>
  </div>
</div></section>`;
  return { title: p.meta_title, description: p.meta_description, body, crumbs };
}

export function missionsPage(ctx, lang) {
  const t = T[lang]; const p = ctx.pages.missions[lang];
  const crumbs = [[t.home, ROUTES.home[lang]], [p.title, ROUTES.missions[lang]]];
  const body = `${pageHead(lang, { eyebrow: p.eyebrow, title: p.title, lead: p.lead, crumbs })}
<section class="section section-tight"><div class="wrap">
  <ol class="programmes">${p.programmes.map((g, i) => `<li class="programme">
    <div class="programme-img">${ctx.picture(g.image, g.image_alt, { sizes: '(min-width: 1000px) 520px, 100vw' })}</div>
    <div class="programme-text"><span class="ways-n">0${i + 1}</span><h2>${esc(g.title)}</h2><p>${esc(g.text)}</p></div></li>`).join('')}</ol>
</div></section>
${knitBand('knit-thin')}
<section class="section section-birch"><div class="wrap">
  ${sectionHead(lang === 'fr' ? 'Sur le terrain' : 'On the ground', lang === 'fr' ? 'Nos actions' : 'Our activities')}
  <div class="action-cards">${p.actions.map((a) => `<article class="card"><h3>${esc(a.title)}</h3><p>${esc(a.text)}</p><a class="link-arrow" href="${ROUTES[a.link][lang]}">${a.link === 'drives' ? t.findDrive : t.fullCalendar}${icon('arrow')}</a></article>`).join('')}</div>
</div></section>
<section class="section"><div class="wrap">
  ${sectionHead(lang === 'fr' ? 'Domaines d’aide' : 'Areas of help', ctx.pages.home[lang].aid_title)}
  ${aidGrid(p.aid)}
  <p class="callout">${icon('pin')}<span>${inline(p.abroad)}</span></p>
</div></section>`;
  return { title: p.meta_title, description: p.meta_description, body, crumbs };
}

export function prosePage(ctx, lang, key) {
  const t = T[lang]; const p = ctx.pages[key][lang];
  const crumbs = [[t.home, ROUTES.home[lang]], [p.eyebrow, ROUTES[key][lang]]];
  const body = `${pageHead(lang, { eyebrow: p.eyebrow, title: p.title, lead: p.lead, crumbs })}
<section class="section section-tight"><div class="wrap narrow prose">${md(p.body)}</div></section>`;
  return { title: p.meta_title, description: p.meta_description, body, crumbs };
}

export { orgNode };
