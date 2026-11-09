import { ROUTES, UI, EVENT_CATS } from './i18n.mjs';
import { esc, t, md, picture, mediaImg, fmtDate, fmtDay, fmtTime, timeRange, stampParts, imageUrl, isPhoto } from './lib.mjs';
import { crumbs } from './layout.mjs';
import { hoop, emblems, icon, ui, serveMap, stitchedHeart, vine, heartPath, C, mark } from './svg.mjs';

const money = (n, lang) => (lang === 'fr' ? `${n}&nbsp;$` : `$${n}`);
const sampleBadge = (lang, on = true) => on ? `<span class="badge badge--sample">${UI[lang].sample}</span>` : '';
const sec = (cls, inner, attrs = '') => `<section class="section ${cls}"${attrs}>${inner}</section>`;
const head = (kicker, title, intro, { center = false, id = '' } = {}) => `<div class="section-head${center ? ' section-head--center' : ''}">${kicker ? `<p class="kicker">${kicker}</p>` : ''}<h2${id ? ` id="${id}"` : ''}>${title}</h2>${intro ? `<p>${t(intro)}</p>` : ''}</div>`;

const sprig = `<svg viewBox="0 0 240 200" aria-hidden="true" focusable="false">${vine(120, 230, 150, 200, 340, 9, 34)}${stitchedHeart(120, 120, 70)}</svg>`;
const sprigFor = (art) => art ? `<svg viewBox="0 0 160 160" aria-hidden="true" focusable="false">${art}</svg>` : sprig;

export function pageHero(lang, { trail, title, intro, art = '' }) {
  return `<div class="page-hero" data-knot><div class="wrap page-hero__in"><div>${crumbs(lang, trail)}<h1>${esc(title)}</h1>${intro ? `<p class="lead">${t(intro)}</p>` : ''}</div><div class="page-hero__art">${art || sprig}</div></div><div class="band band--thin" aria-hidden="true"></div></div>`;
}
const trailFor = (lang, ...items) => [{ name: UI[lang].home, path: ROUTES.home[lang] }, ...items];

/* ---------- shared fragments ---------- */
export function eventCard(lang, ev, { headingLevel = 3 } = {}) {
  const U = UI[lang], s = stampParts(ev.start, lang);
  const h = `h${headingLevel}`;
  return `<li class="event" data-cat="${ev.category}">
<div class="stamp" aria-hidden="true"><span class="stamp__m">${s.m}</span><span class="stamp__d">${s.d}</span><span class="stamp__y">${s.y}</span></div>
<div><div class="card__meta"><span class="badge badge--cat">${EVENT_CATS[lang][ev.category] || ev.category}</span>${sampleBadge(lang, ev.sample)}</div>
<${h}><a href="${ev.url}">${esc(ev.title)}</a></${h}>
<div class="event__meta"><span>${ui.cal}<time datetime="${ev.start}">${fmtDay(ev.start, lang)}</time></span><span>${ui.clock}${timeRange(ev, lang)}</span><span>${ui.pin}${t(ev.venue)}</span></div>
<p>${t(ev.summary)}</p>
<div class="cal-links"><a class="btn btn--sm btn--ghost" href="${ev.ics}" download>${ui.cal}${U.addCal}</a><a class="btn btn--sm btn--ghost" href="${ev.gcal}" rel="noopener" target="_blank">${U.google}<span class="sr-only"> (${lang === 'fr' ? 'nouvel onglet' : 'new tab'})</span></a></div>
</div></li>`;
}

// "Subscribe" block: webcal / Google / Outlook.com / copy link for the language's combined feed.
export function subscribeBlock(lang, S, { compact = false } = {}) {
  const U = UI[lang], B = U.sub;
  const https = `${S.siteUrl}${ROUTES.feed[lang]}`;
  const webcal = https.replace(/^https?:/, 'webcal:');
  const name = lang === 'fr' ? 'La Paix du Cœur — Événements' : 'La Paix du Cœur — Events';
  const tab = `<span class="sr-only"> (${lang === 'fr' ? 'nouvel onglet' : 'new tab'})</span>`;
  const ext = (href, label, cls) => `<a class="btn btn--sm ${cls}" href="${href}" rel="noopener" target="_blank">${label}${tab}</a>`;
  const links = [
    `<a class="btn btn--sm${compact ? ' btn--ghost' : ''}" href="${webcal}">${ui.cal}${B.apple}</a>`,
    ext(`https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`, B.google, 'btn--ghost'),
    ext(`https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(https)}&amp;name=${encodeURIComponent(name)}`, B.outlook, 'btn--ghost'),
  ].join('');
  const view = S.calendar_google_public_url ? `<p class="subscribe__view"><a class="link-arrow" href="${esc(S.calendar_google_public_url)}" rel="noopener" target="_blank">${B.view}${tab}${ui.arrow}</a></p>` : '';
  const copy = `<div class="copy-row"><code>${https}</code><button class="btn btn--sm btn--plum" type="button" data-copy="${https}" data-copied="${B.copied}" hidden>${ui.copy}${B.copy}</button><span class="status" aria-live="polite"></span></div>`;
  if (compact) {
    return `<div class="subscribe subscribe--compact"><h3>${B.compactTitle}</h3><div class="cal-links">${links}</div>${copy}<p class="subscribe__help">${B.help}</p>${view}</div>`;
  }
  return `<div class="subscribe" id="${lang === 'fr' ? 'abonnement' : 'subscribe'}"><div class="subscribe__in"><p class="kicker">${B.kicker}</p><h2>${B.title}</h2><p class="subscribe__help">${B.help}</p>
<div class="cal-links">${links}</div>
<p class="sr-only">${B.linkLabel}</p>${copy}${view}</div></div>`;
}
const subscribeAnchor = (lang) => `${ROUTES.events[lang]}#${lang === 'fr' ? 'abonnement' : 'subscribe'}`;

export function newsCard(lang, n) {
  return `<article class="card card--stitch reveal"><div class="card__media">${picture(n.image, n.imageAlt)}</div><div class="card__body">
<div class="card__meta"><time datetime="${n.date}">${fmtDate(n.date, lang)}</time><span>· ${esc(n.category)}</span>${sampleBadge(lang, n.sample)}</div>
<h3><a href="${n.url}">${esc(n.title)}</a></h3><p>${t(n.summary)}</p></div></article>`;
}

const personSvg = (i) => { const col = [C.terra, C.sage7, C.mustard, C.plum][i % 4]; return `<svg viewBox="0 0 84 84" aria-hidden="true" focusable="false"><circle cx="42" cy="42" r="40" fill="${C.sand2}"/><circle cx="42" cy="42" r="34" fill="none" stroke="${C.wood}" stroke-width="2" stroke-dasharray="4 4"/><circle cx="42" cy="34" r="12" fill="${col}"/><path d="M20 66c2-14 42-14 44 0z" fill="${col}"/></svg>`; };

/* ---------- HOME ---------- */
export function home(lang, { P, S, events, news, media, story, missions, give: giveP, volunteer: volP }) {
  const U = UI[lang];
  const aid = missions.aidAreas;
  const journey = story.milestones.filter((m) => ['2014', '2016', '2018', '2022'].includes(m.year)).concat(story.milestones.slice(-1));
  const strip = ['children-joy', 'maraude-nuit', 'food-bank-volunteers', 'vetements', 'elders'].map((k) => media.find((m) => m.src.includes(`/${k}`))).filter(Boolean);
  return `
<section class="hero" data-knot="hero"><div class="wrap hero__in">
<div><p class="kicker">${esc(P.heroKicker)}</p>
<h1>${esc(P.heroTitle)}</h1>
<p class="lead hero__lead">${t(P.heroLead)}</p>
<div class="btn-row"><a class="btn" href="${ROUTES.give[lang]}">${ui.heart}${U.donate}</a><a class="btn btn--ghost" href="${ROUTES.volunteer[lang]}">${U.volunteerCta}</a></div>
<figure class="verse"><blockquote>«&nbsp;${esc(P.verse.text)}&nbsp;»</blockquote><figcaption>${esc(P.verse.ref)}</figcaption></figure>
</div>
<div class="hero__art">${hoop({ title: lang === 'fr' ? 'Illustration : un cœur brodé tenu par deux mains, entouré de feuilles, dans un cercle à broder.' : 'Illustration: an embroidered heart held by two hands, surrounded by leaves, in an embroidery hoop.' })}</div>
</div><div class="band" aria-hidden="true"></div></section>

${sec('section--tight section--cream', `<div class="wrap"><div class="name-block reveal"><div><p class="kicker">Lingala</p><p class="name-block__title" lang="ln">${esc(P.nameTitle)}</p></div><p class="lead">${t(P.nameText)}</p></div>
<div class="grid grid--3 mt-2">${P.promises.map((p, i) => `<div class="promise reveal">${icon(['gift', 'communaute', 'shield'][i], 'i')}<h3>${esc(p.title)}</h3><p>${t(p.text)}</p></div>`).join('')}</div></div>`, ' data-knot')}

${sec('', `<div class="wrap">${head(U.nav.missions, esc(P.aidTitle), P.aidIntro)}
<div class="grid grid--4">${aid.map((a) => `<article class="aid-teaser reveal">${emblems[a.key]('')}<h3><a href="${ROUTES.missions[lang]}#aid-${a.key}">${esc(a.title)}</a></h3><p>${t(a.short)}</p></article>`).join('')}</div>
<p class="mt-2"><a class="link-arrow" href="${ROUTES.missions[lang]}">${U.seeMissions}${ui.arrow}</a></p></div>`, ' data-knot')}

${sec('section--sand2', `<div class="wrap">${head(U.nav.story, esc(P.journeyTitle), P.journeyIntro)}
<ol class="journey">${journey.map((m) => `<li class="reveal"><span class="journey__year">${esc(m.year)}</span><h3>${esc(m.title)}</h3>${m.category === 'aujourdhui' ? '' : `<p>${m.sample ? sampleBadge(lang) : `<span class="badge badge--ok">${U.confirmed}</span>`}</p>`}</li>`).join('')}</ol>
<a class="btn btn--plum" href="${ROUTES.story[lang]}">${U.exploreTimeline}${ui.arrow}</a></div>`, ' data-knot')}

${sec('', `<div class="wrap split"><div class="reveal">${serveMap({ title: U.map.title, desc: U.map.desc }, 'home-map')}</div>
<div>${head(U.nav.serve, esc(P.serveTitle), P.serveIntro)}<a class="btn btn--ghost" href="${ROUTES.serve[lang]}">${U.seeMap}${ui.arrow}</a></div></div>`, ' data-knot')}

${sec('section--plum on-dark', `<div class="wrap split split--rev"><div class="reveal">${picture('food-bank-volunteers', lang === 'fr' ? 'Des bénévoles trient des denrées dans des caisses.' : 'Volunteers sorting food into crates.', { sizes: '(min-width: 900px) 50vw, 100vw', cls: 'rounded' })}</div>
<div>${head(U.nav.volunteer, esc(P.volunteerTitle), P.volunteerIntro)}
<ul class="chips" role="list">${volP.skills.slice(0, 8).map((s) => `<li class="chip">${esc(s.label)}</li>`).join('')}</ul>
<div class="btn-row mt-2"><a class="btn btn--mustard" href="${ROUTES.volunteer[lang]}">${U.volunteerCta}${ui.arrow}</a><a class="btn btn--ghost" href="${ROUTES.workshops[lang]}">${U.nav.workshops}</a></div></div></div>`, ' data-knot')}

${sec('', `<div class="wrap"><div class="two-col two-col--even">
<div>${head(U.nav.events, esc(P.eventsTitle), '')}<ul class="event-list">${events.slice(0, 3).map((e) => eventCard(lang, e)).join('')}</ul><p class="mt-1 btn-row"><a class="link-arrow" href="${ROUTES.events[lang]}">${U.allEvents}${ui.arrow}</a><a class="link-arrow" href="${subscribeAnchor(lang)}">${ui.cal}${U.sub.cta}</a></p></div>
<div>${head(U.nav.news, esc(P.newsTitle), '')}<div class="grid">${news.slice(0, 2).map((n) => newsCard(lang, n)).join('')}</div><p class="mt-1"><a class="link-arrow" href="${ROUTES.news[lang]}">${U.allNews}${ui.arrow}</a></p></div>
</div></div>`, ' data-knot')}

${sec('section--cream section--tight', `<div class="wrap">${head(U.nav.media, esc(P.galleryTitle), '')}
<div class="gallery-strip">${strip.map((m) => `<div class="reveal">${mediaImg(m.src, m.alt, { sizes: '(min-width: 800px) 40vw, 50vw' })}</div>`).join('')}</div>
<p class="mt-1"><a class="link-arrow" href="${ROUTES.media[lang]}">${U.seeMedia}${ui.arrow}</a></p></div>`, ' data-knot')}

${sec('section--mustard', `<div class="wrap split"><div>${head(U.nav.give, esc(P.giveTitle), P.giveText)}
<div class="btn-row"><a class="btn" href="${ROUTES.give[lang]}">${ui.heart}${U.donate}</a><a class="btn btn--ghost" href="${ROUTES.contact[lang]}">${U.contactUs}</a></div></div>
<ul class="impact-list" role="list">${giveP.amounts.slice(0, 3).map((a) => `<li class="impact reveal"><svg viewBox="0 0 40 40" aria-hidden="true"><path d="${heartPath(20, 21, 36)}" fill="${C.terra}"/></svg><span><strong>${money(a.amount, lang)}</strong> =${t(a.label)}</span></li>`).join('')}</ul></div>
<p class="wrap"><small>${t(giveP.amountsNote)}</small></p>`, ' data-knot')}

<section class="section verse-band on-dark" data-knot><div class="wrap"><svg class="mark-heart" viewBox="0 0 48 44" aria-hidden="true">${stitchedHeart(24, 22, 46, C.terra, C.mustardL)}</svg><figure class="mb-0"><blockquote>«&nbsp;${esc(S.verseOfWeek.text)}&nbsp;»</blockquote><figcaption>${esc(S.verseOfWeek.ref)}</figcaption></figure></div></section>`;
}

/* ---------- ABOUT ---------- */
export function about(lang, { P }) {
  const U = UI[lang];
  return `${pageHero(lang, { trail: trailFor(lang, { name: P.title, path: ROUTES.about[lang] }), title: P.title, intro: P.intro, art: sprigFor(`<g transform="scale(.333)">${hoop({ id: 'ab' }).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</g>`) })}
${sec('', `<div class="wrap split"><div><h2>${esc(P.aboutTitle)}</h2><p class="lead">${t(P.aboutText)}</p></div>
<div class="photo-stack reveal">${picture('bible-study', lang === 'fr' ? 'Un groupe assis en cercle autour d’une grande Bible ouverte.' : 'A group seated in a circle around a large open Bible.', { sizes: '(min-width: 900px) 45vw, 100vw' })}${picture('elders', lang === 'fr' ? 'Trois femmes âgées rient ensemble autour d’un thé.' : 'Three older women laughing together over tea.', { sizes: '(min-width: 900px) 25vw, 55vw' })}</div></div>`, ' data-knot')}
${sec('section--plum on-dark', `<div class="wrap--narrow center"><p class="kicker">${esc(P.missionTitle)}</p><p class="lead">${t(P.missionText)}</p></div>`, ' data-knot')}
${sec('section--cream', `<div class="wrap split"><div><h2>${esc(P.nameTitle)}</h2><p>${t(P.nameText)}</p></div><div class="values">${P.values.map((v) => `<div class="value reveal"><h3>${esc(v.title)}</h3><p>${t(v.text)}</p></div>`).join('')}</div></div>`, ' data-knot')}
${sec('', `<div class="wrap">${head('', esc(P.programmesTitle), '')}<ol class="num-list grid--3 grid">${P.programmes.map((p) => `<li class="reveal"><h3>${esc(p.title)}</h3><p>${t(p.text)}</p></li>`).join('')}</ol></div>`, ' data-knot')}
${sec('section--sand2', `<div class="wrap">${head('', esc(P.teamTitle), P.teamIntro)}<div class="team">${P.team.map((p, i) => `<div class="person reveal">${personSvg(i)}<h3>${t(p.name)}</h3><p>${t(p.role)}</p></div>`).join('')}</div></div>`, ' data-knot')}
${sec('section--plum on-dark', `<div class="wrap split"><div><h2>${esc(P.ethicsTitle)}</h2><ul class="ethics">${P.ethics.map((e) => `<li>${ui.check}<span>${t(e)}</span></li>`).join('')}</ul></div>
<div>${P.verses.map((v) => `<figure class="verse"><blockquote>«&nbsp;${esc(v.text)}&nbsp;»</blockquote><figcaption>${esc(v.ref)}</figcaption></figure>`).join('')}</div></div>`, ' data-knot')}
${sec('section--tight', `<div class="wrap--narrow center"><h2>${esc(P.legalTitle)}</h2><p>${t(P.legalText)}</p><div class="btn-row btn-row--center"><a class="btn" href="${ROUTES.volunteer[lang]}">${U.volunteerCta}</a><a class="btn btn--ghost" href="${ROUTES.give[lang]}">${U.donate}</a></div></div>`, ' data-knot')}`;
}

/* ---------- STORY (timeline) ---------- */
export function story(lang, { P }) {
  const U = UI[lang];
  const cats = [...new Set(P.milestones.map((m) => m.category))].filter((c) => c !== 'aujourdhui');
  const id = (m, i) => `y-${i}-${String(m.year).toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
  return `${pageHero(lang, { trail: trailFor(lang, { name: U.nav.about, path: ROUTES.about[lang] }, { name: P.title, path: ROUTES.story[lang] }), title: P.title, intro: P.intro })}
<section class="section" data-knot><div class="wrap" data-timeline>
<p class="tl-note">${ui.heart}<span>${t(P.note)}</span></p>
<div class="tl-controls"><div class="tl-controls__row">
<ul class="tl-years" aria-label="${U.tl.years}">${P.milestones.map((m, i) => `<li><a href="#${id(m, i)}" data-year-link>${esc(m.year)}</a></li>`).join('')}</ul>
<div class="chips tl-filters" role="group" aria-label="${U.tl.filter}" data-filter-group><button class="chip" type="button" aria-pressed="true" data-filter="all">${U.tl.all}</button>${cats.map((c) => `<button class="chip" type="button" aria-pressed="false" data-filter="${c}">${icon(c)}${esc(P.categories[c])}</button>`).join('')}</div>
</div></div>
<h2 class="sr-only">${U.tl.listLabel}</h2>
<p class="sr-only" aria-live="polite" data-filter-status data-label="${U.tl.shown}"></p>
<ol class="timeline"><span class="timeline__progress" aria-hidden="true"></span>
${P.milestones.map((m, i) => `<li class="milestone${m.category === 'aujourdhui' ? ' milestone--today' : ''}" id="${id(m, i)}" data-cat="${m.category}"${m.category === 'aujourdhui' ? ' data-always' : ''}>
<div class="milestone__knot" aria-hidden="true">${icon(m.category)}</div>
<p class="milestone__year">${esc(m.year)}</p>
<article class="milestone__card"><div class="milestone__meta"><span class="badge badge--cat">${esc(P.categories[m.category])}</span>${m.category === 'aujourdhui' ? '' : m.sample ? sampleBadge(lang) : `<span class="badge badge--ok">${ui.check}${U.confirmed}</span>`}</div>
<h3>${esc(m.title)}</h3><p>${t(m.text)}</p>
<details><summary>${U.learnMore}</summary><p>${t(m.detail)}</p></details>
${m.category === 'aujourdhui' ? `<div class="btn-row mt-1"><a class="btn btn--mustard btn--sm" href="${ROUTES.volunteer[lang]}">${U.volunteerCta}</a><a class="btn btn--sm" href="${ROUTES.give[lang]}">${U.donate}</a></div>` : ''}
</article></li>`).join('\n')}
</ol>
<p class="empty" hidden data-filter-empty>${U.tl.none}</p>
</div></section>`;
}

/* ---------- MISSIONS ---------- */
export function missions(lang, { P }) {
  const U = UI[lang];
  return `${pageHero(lang, { trail: trailFor(lang, { name: P.title, path: ROUTES.missions[lang] }), title: P.title, intro: P.intro, art: sprigFor(`<g transform="translate(14 14) scale(.825)">${emblems.alimentaire('').replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</g>`) })}
<section class="section" data-knot><div class="wrap">${head('', esc(P.aidTitle), P.aidIntro)}
<div class="aid-grid">${P.aidAreas.map((a) => `<article class="aid-card reveal" id="aid-${a.key}" data-aid>
<div class="aid-card__inner">
<div class="aid-card__face aid-card__front">${emblems[a.key]('')}<div><h3>${esc(a.title)}</h3><p>${t(a.short)}</p><button class="flip-btn" type="button" aria-expanded="false" aria-controls="aid-${a.key}-back" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>${U.aid.flip}</button></div></div>
<div class="aid-card__face aid-card__back" id="aid-${a.key}-back"><p class="aid-card__back-title">${esc(a.title)}</p><div class="aid-card__cols">
<div><h4>${U.aid.how}</h4><ul>${a.how.map((x) => `<li>${t(x)}</li>`).join('')}</ul></div>
<div><h4>${U.aid.help}</h4><ul>${a.help.map((x) => `<li>${t(x)}</li>`).join('')}</ul></div></div>
<button class="flip-btn" type="button" data-flip-back hidden>${ui.prev}${U.aid.back}</button></div>
</div></article>`).join('')}</div></div></section>
${sec('section--sand2', `<div class="wrap">${head('', esc(P.programmesTitle), '')}<ol class="num-list grid grid--3">${P.programmes.map((p) => `<li class="reveal"><h3>${esc(p.title)}</h3><p>${t(p.text)}</p></li>`).join('')}</ol></div>`, ' data-knot')}
${sec('section--plum on-dark', `<div class="wrap split"><div>${head('', esc(P.actionsTitle), '')}<div class="grid">${P.actions.map((a) => `<div class="feature reveal"><span class="feature__icon">${icon(a.icon)}</span><div><h3>${esc(a.title)}</h3><p>${t(a.text)}</p></div></div>`).join('')}</div>
<div class="btn-row mt-2"><a class="btn btn--mustard" href="${ROUTES.events[lang]}">${U.nav.events}</a><a class="btn btn--ghost" href="${ROUTES.serve[lang]}">${U.nav.serve}</a></div></div>
<figure class="verse"><blockquote>«&nbsp;${esc(P.verse.text)}&nbsp;»</blockquote><figcaption>${esc(P.verse.ref)}</figcaption></figure></div>`, ' data-knot')}`;
}

/* ---------- SERVE (map) ---------- */
export function serve(lang, { P }) {
  const U = UI[lang];
  return `${pageHero(lang, { trail: trailFor(lang, { name: U.nav.about, path: ROUTES.about[lang] }, { name: P.title, path: ROUTES.serve[lang] }), title: P.title, intro: P.intro })}
<section class="section" data-knot><div class="wrap serve" data-serve>
<div class="serve-map">${serveMap({ title: U.map.title, desc: U.map.desc })}<p class="map-caption">${esc(P.legendNote)}</p></div>
<div><h2 class="sr-only">${U.map.zones}</h2>
<div class="serve-legend" role="group" aria-label="${U.map.zones}">${P.zones.map((z, i) => `<button class="zone-btn" type="button" data-zone="${z.key}" aria-pressed="${i === 0}" aria-controls="zone-${z.key}" hidden><span class="zone-btn__dot" aria-hidden="true"></span>${esc(z.title)}<small>${t(z.status)}</small></button>`).join('')}</div>
<div aria-live="polite">${P.zones.map((z) => `<article class="zone-panel" id="zone-${z.key}" data-zone-panel="${z.key}"><span class="badge ${z.key === 'mtl' ? 'badge--ok' : 'badge--sample'}">${t(z.status)}</span><h3 class="mt-1">${esc(z.title)}</h3><p>${t(z.text)}</p><ul>${z.items.map((x) => `<li>${t(x)}</li>`).join('')}</ul></article>`).join('')}</div>
<aside class="why"><span class="why__icon">${ui.heart}</span><div><h3>${esc(P.whyTitle)}</h3><p>${t(P.whyText)}</p></div></aside>
</div></div></section>
${sec('section--sand2 section--tight', `<div class="wrap--narrow center"><h2>${esc(P.partnerTitle)}</h2><p class="lead">${t(P.partnerText)}</p><a class="btn" href="${ROUTES.contact[lang]}">${U.contactUs}</a></div>`, ' data-knot')}`;
}

/* ---------- WORKSHOPS ---------- */
export function workshops(lang, { P, events }) {
  const U = UI[lang];
  const ws = events.filter((e) => e.category === 'atelier');
  return `${pageHero(lang, { trail: trailFor(lang, { name: U.nav.engage, path: ROUTES.volunteer[lang] }, { name: P.title, path: ROUTES.workshops[lang] }), title: P.title, intro: P.intro, art: sprigFor(`<g transform="translate(14 14) scale(.825)">${emblems.academique('').replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</g>`) })}
${sec('', `<div class="wrap">${head('', esc(P.formatsTitle), '')}<div class="grid grid--4">${P.formats.map((f, i) => `<div class="promise reveal">${icon(['atelier', 'communaute', 'priere', 'maraude'][i], 'i')}<h3>${esc(f.title)}</h3><p>${t(f.text)}</p></div>`).join('')}</div></div>`, ' data-knot')}
${sec('section--sand2', `<div class="wrap">${head('', esc(P.upcomingTitle), P.upcomingIntro)}<ul class="event-list">${ws.map((e) => eventCard(lang, e)).join('')}</ul></div>`, ' data-knot')}
${sec('', `<div class="wrap split"><div>${head('', esc(P.themesTitle), '')}<ul class="tag-themes">${P.themes.map((x) => `<li>${t(x)}</li>`).join('')}</ul></div>
<div class="form-card"><h2>${esc(P.teachTitle)}</h2><p>${t(P.teachText)}</p><a class="btn" href="${ROUTES.contact[lang]}">${U.contactUs}${ui.arrow}</a></div></div>`, ' data-knot')}
${sec('section--sand2 section--tight', `<div class="wrap illus-frame"><img src="/assets/illustrations/atelier.svg" width="800" height="600" alt="${lang === 'fr' ? 'Illustration : un tableau vert orné d’un cœur et une table d’atelier.' : 'Illustration: a green chalkboard with a heart and a workshop table.'}" loading="lazy"></div>`)}`;
}

/* ---------- VOLUNTEER ---------- */
export function volunteer(lang, { P }) {
  const U = UI[lang], V = U.vol, F = U.form;
  const chip = (name, value, label, type = 'checkbox', checked = false) => `<label class="chip chip--check"><input type="${type}" name="${name}" value="${esc(value)}"${checked ? ' checked' : ''}> ${esc(label)}</label>`;
  return `${pageHero(lang, { trail: trailFor(lang, { name: P.title, path: ROUTES.volunteer[lang] }), title: P.title, intro: P.intro })}
${sec('', `<div class="wrap">${head('', esc(P.rolesTitle), '')}<div class="grid grid--4">${P.roles.map((r) => `<div class="feature reveal"><span class="feature__icon">${icon(r.icon)}</span><div><h3>${esc(r.title)}</h3><p>${t(r.text)}</p></div></div>`).join('')}</div></div>`, ' data-knot')}
<section class="section section--sand2" data-knot><div class="wrap two-col">
<div class="form-card">
<h2 id="vform-title">${esc(P.formTitle)}</h2>
<ol class="steps" aria-hidden="true">${V.steps.map((s, i) => `<li${i === 0 ? ' class="is-current"' : ''}><span>${esc(s)}</span></li>`).join('')}</ol>
<p class="vstep__status" aria-live="polite" data-vstatus></p>
<form class="vform" data-vform action="/api/benevolat" method="post" novalidate aria-labelledby="vform-title" data-msg-required="${esc(F.required)}" data-msg-email="${esc(F.invalidEmail)}" data-msg-consent="${esc(F.needConsent)}" data-msg-skill="${esc(V.needSkill)}" data-step-label="${V.step}" data-of="${V.of}" data-steps="${esc(JSON.stringify(V.steps))}" data-langs-label="${esc(V.langs)}">
<fieldset class="vstep" data-step="1"><legend>${V.s1}</legend>
<div class="field"><label for="v-name">${F.name} <span class="req" aria-hidden="true">*</span></label><input id="v-name" name="name" type="text" autocomplete="name" required aria-describedby="v-name-err"><span class="err" id="v-name-err"></span></div>
<div class="subgrid"><div class="field"><label for="v-email">${F.email} <span class="req" aria-hidden="true">*</span></label><input id="v-email" name="email" type="email" autocomplete="email" required aria-describedby="v-email-err"><span class="err" id="v-email-err"></span></div>
<div class="field"><label for="v-phone">${F.phone} <span class="hint">${F.optional}</span></label><input id="v-phone" name="phone" type="tel" autocomplete="tel"></div></div>
<div class="field"><label for="v-region">${V.region}</label><select id="v-region" name="region">${V.regions.map((r) => `<option>${esc(r)}</option>`).join('')}</select></div>
</fieldset>
<fieldset class="vstep" data-step="2" aria-describedby="v-skills-hint v-skills-err"><legend>${V.s2}</legend>
<p class="hint" id="v-skills-hint">${V.s2hint}</p>
<div class="chips" data-required-group="skills">${P.skills.map((s) => chip('skills', s.key, s.label)).join('')}</div><span class="err" id="v-skills-err"></span>
<div class="field"><label for="v-other">${V.other} <span class="hint">${F.optional}</span></label><input id="v-other" name="skills_other" type="text"></div>
</fieldset>
<fieldset class="vstep" data-step="3"><legend>${V.s3}</legend>
<fieldset><legend class="legend-like">${V.days}</legend><div class="chips mt-1">${V.dayNames.map((d) => chip('days', d, d)).join('')}</div></fieldset>
<fieldset><legend class="legend-like">${V.moments}</legend><div class="chips mt-1">${V.momentNames.map((d) => chip('moments', d, d)).join('')}</div></fieldset>
<fieldset><legend class="legend-like">${V.freq}</legend><div class="chips mt-1">${V.freqNames.map((d, i) => chip('frequency', d, d, 'radio', i === 1)).join('')}</div></fieldset>
<fieldset><legend class="legend-like">${V.langs}</legend><div class="chips mt-1">${P.languages.map((d) => chip('languages', d, d)).join('')}</div></fieldset>
</fieldset>
<fieldset class="vstep" data-step="4"><legend>${V.s4}</legend>
<div class="field"><label for="v-msg">${V.msg}</label><textarea id="v-msg" name="message"></textarea></div>
<div class="summary" data-vsummary hidden></div>
<label class="check"><input type="checkbox" name="consent" required aria-describedby="v-consent-err"> <span>${t(P.consent)} <span class="req" aria-hidden="true">*</span></span></label><span class="err" id="v-consent-err"></span>
<div class="hp" aria-hidden="true"><label for="v-website">${F.hp}</label><input id="v-website" name="website" type="text" tabindex="-1" autocomplete="off"></div>
<!-- Turnstile widget goes here in production; the Pages Function verifies the token server-side. -->
</fieldset>
<div class="vnav"><button class="btn btn--ghost" type="button" data-vprev hidden>${ui.prev}${V.prevBtn}</button><button class="btn" type="button" data-vnext>${V.nextBtn}${ui.arrow}</button><button class="btn" type="submit" data-vsubmit hidden>${ui.heart}${V.submit}</button></div>
<div class="vsubmit-nojs"><button class="btn" type="submit">${V.submit}</button></div>
</form>
<div class="form-done" data-vdone hidden tabindex="-1"><svg viewBox="0 0 96 90" aria-hidden="true">${stitchedHeart(48, 46, 90)}</svg><h3>${esc(P.confirmTitle)}</h3><p data-vdone-text>${t(P.confirmText)}</p><button class="btn btn--ghost" type="button" data-vagain>${V.again}</button></div>
</div>
<div>${picture('food-bank-volunteers', lang === 'fr' ? 'Des bénévoles préparent des denrées.' : 'Volunteers preparing food.', { sizes: '(min-width: 900px) 35vw, 100vw' })}
<div class="faq mt-2"><h2>${esc(P.faqTitle)}</h2>${P.faq.map((f) => `<details><summary>${esc(f.q)}</summary><p>${t(f.a)}</p></details>`).join('')}</div></div>
</div></section>`;
}

/* ---------- EVENTS ---------- */
export function eventsList(lang, { P, S, events }) {
  const U = UI[lang];
  const cats = [...new Set(events.map((e) => e.category))];
  return `${pageHero(lang, { trail: trailFor(lang, { name: P.title, path: ROUTES.events[lang] }), title: P.title, intro: P.intro })}
<section class="section" data-knot><div class="wrap">
<div class="chips" role="group" aria-label="${U.gallery.filter}" data-filter-group data-filter-scope="events"><button class="chip" type="button" aria-pressed="true" data-filter="all">${U.tl.all}</button>${cats.map((c) => `<button class="chip" type="button" aria-pressed="false" data-filter="${c}">${icon(c)}${EVENT_CATS[lang][c]}</button>`).join('')}</div>
<p class="sr-only" aria-live="polite" data-filter-status data-label="${lang === 'fr' ? 'événements affichés' : 'events shown'}"></p>
<h2 class="sr-only">${P.title}</h2>
<ul class="event-list mt-2">${events.map((e) => eventCard(lang, e)).join('')}</ul>
<div class="mt-2">${subscribeBlock(lang, S)}</div>
</div></section>`;
}

export function eventPage(lang, { ev, S }) {
  const U = UI[lang];
  const img = ev.image || '';
  return `${pageHero(lang, { trail: trailFor(lang, { name: U.nav.events, path: ROUTES.events[lang] }, { name: ev.title, path: ev.url }), title: ev.title, intro: ev.summary })}
<section class="section" data-knot><div class="wrap event-detail">
<div><div class="card__meta mb-0"><span class="badge badge--cat">${EVENT_CATS[lang][ev.category]}</span>${sampleBadge(lang, ev.sample)}</div>
${img ? `<div class="illus-frame mt-1"><img src="${img}" width="800" height="600" alt="" loading="lazy"></div>` : ''}
<div class="prose mt-2">${md(ev.body)}</div></div>
<aside class="info-box"><h2 class="sr-only">${U.details}</h2><dl>
<div><dt>${U.when}</dt><dd><time datetime="${ev.start}">${fmtDay(ev.start, lang)}</time><br>${timeRange(ev, lang)}</dd></div>
<div><dt>${U.where}</dt><dd>${t(ev.venue)}</dd></div>
<div><dt>${U.what}</dt><dd>${EVENT_CATS[lang][ev.category]} · ${U.free}</dd></div></dl>
<div class="cal-links"><a class="btn btn--sm" href="${ev.ics}" download>${ui.cal}${U.addCal}</a><a class="btn btn--sm btn--ghost" href="${ev.gcal}" rel="noopener" target="_blank">${U.google}<span class="sr-only"> (${lang === 'fr' ? 'nouvel onglet' : 'new tab'})</span></a></div>
${ev.ticketUrl ? `<p class="mt-1 mb-0"><a class="btn btn--sm btn--plum" href="${esc(ev.ticketUrl)}" rel="noopener" target="_blank">${U.tickets}<span class="sr-only"> (${lang === 'fr' ? 'nouvel onglet' : 'new tab'})</span></a></p>` : ''}
<p class="mt-1 mb-0"><a class="link-arrow" href="${ROUTES.volunteer[lang]}">${U.register}${ui.arrow}</a></p>
${subscribeBlock(lang, S, { compact: true })}
</aside></div></section>`;
}

/* ---------- NEWS ---------- */
export function newsList(lang, { P, news }) {
  const U = UI[lang];
  const [first, ...rest] = news;
  return `${pageHero(lang, { trail: trailFor(lang, { name: P.title, path: ROUTES.news[lang] }), title: P.title, intro: P.intro })}
<section class="section" data-knot><div class="wrap"><h2 class="sr-only">${P.title}</h2>
<article class="feature-news"><div class="card__media">${picture(first.image, first.imageAlt, { sizes: '(min-width: 900px) 55vw, 100vw' })}</div><div class="card__body">
<div class="card__meta"><time datetime="${first.date}">${fmtDate(first.date, lang)}</time><span>· ${esc(first.category)}</span>${sampleBadge(lang, first.sample)}</div>
<h2><a href="${first.url}">${esc(first.title)}</a></h2><p class="lead">${t(first.summary)}</p><span class="link-arrow" aria-hidden="true">${U.readMore}${ui.arrow}</span></div></article>
<div class="grid grid--3">${rest.map((n) => newsCard(lang, n)).join('')}</div>
<p class="mt-2"><a class="link-arrow" href="${ROUTES.news[lang]}rss.xml">${ui.rss}RSS</a></p>
</div></section>`;
}

export function article(lang, { n, prev, next, S }) {
  const U = UI[lang];
  const abs = `${S.siteUrl}${n.url}`;
  return `<div class="page-hero" data-knot><div class="wrap--narrow page-hero__in article-head"><div>${crumbs(lang, trailFor(lang, { name: U.nav.news, path: ROUTES.news[lang] }, { name: n.title, path: n.url }))}
<div class="card__meta"><span>${U.published} <time datetime="${n.date}">${fmtDate(n.date, lang)}</time></span><span>· ${esc(n.category)}</span>${sampleBadge(lang, n.sample)}</div>
<h1>${esc(n.title)}</h1><p class="lead">${t(n.summary)}</p></div></div><div class="band band--thin" aria-hidden="true"></div></div>
<article class="section" data-knot><div class="wrap--narrow">
<figure class="article-figure">${picture(n.image, n.imageAlt, { sizes: '(min-width: 800px) 760px, 100vw', eager: true })}</figure>
<div class="prose">${md(n.body)}</div>
<div class="share"><strong>${U.share}</strong><a class="btn btn--sm btn--ghost" href="mailto:?subject=${encodeURIComponent(n.title)}&amp;body=${encodeURIComponent(abs)}">${ui.mail}${U.byEmail}</a><button class="btn btn--sm btn--ghost" type="button" data-copy="${abs}" data-copied="${U.copied}" hidden>${ui.copy}${U.copyLink}</button><span class="status" aria-live="polite"></span></div>
<nav class="article-nav" aria-label="${lang === 'fr' ? 'Autres articles' : 'More articles'}">${prev ? `<a href="${prev.url}" rel="prev"><small>${U.prev}</small>${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a href="${next.url}" rel="next"><small>${U.next}</small>${esc(next.title)}</a>` : ''}</nav>
<p class="mt-2"><a class="link-arrow" href="${ROUTES.news[lang]}">${ui.prev}${U.backNews}</a></p>
</div></article>`;
}

/* ---------- MEDIA ---------- */
export function mediaPage(lang, { P, media }) {
  const U = UI[lang], G = U.gallery, M = U.media;
  const items = media.filter((m) => m.type === 'photo' || m.type === 'illustration');
  const video = media.find((m) => m.type === 'video');
  const audio = media.find((m) => m.type === 'audio');
  const cats = Object.keys(P.categories).filter((c) => c === 'all' || items.some((i) => i.category === c));
  const full = (m) => imageUrl(m.src);
  return `${pageHero(lang, { trail: trailFor(lang, { name: P.title, path: ROUTES.media[lang] }), title: P.title, intro: P.intro })}
<section class="section" data-knot><div class="wrap" data-gallery data-label-prev="${G.prev}" data-label-next="${G.next}" data-label-close="${G.close}">
${head('', esc(P.galleryTitle), '')}
<div class="chips" role="group" aria-label="${G.filter}" data-filter-group>${cats.map((c, i) => `<button class="chip" type="button" aria-pressed="${i === 0}" data-filter="${c}">${esc(P.categories[c])}</button>`).join('')}</div>
<p class="sr-only" aria-live="polite" data-filter-status data-label="${G.count}"></p>
<ul class="gallery-grid">${items.map((m, i) => `<li data-cat="${m.category}"><a class="g-item" href="${full(m)}" data-index="${i}" data-title="${esc(m.title)}" data-caption="${esc(m.caption)}" data-alt="${esc(m.alt)}">${mediaImg(m.src, m.alt, { sizes: '(min-width: 1100px) 25vw, (min-width: 700px) 33vw, 50vw' })}<span class="g-item__cap"><span>${esc(m.title)}<span class="sr-only"> — ${G.open}</span></span><span class="g-item__type">${m.type === 'photo' ? G.photo : G.illus}</span></span></a></li>`).join('')}</ul>
<p class="empty mt-1" hidden data-filter-empty>${U.tl.none}</p>
<dialog class="lightbox" aria-labelledby="lb-title" data-lightbox>
<figure class="lightbox__fig"><img class="lightbox__img" src="${full(items[0])}" alt="" width="960" height="640"><figcaption class="lightbox__cap"><p class="lightbox__count" data-lb-count></p><h2 id="lb-title" data-lb-title></h2><p data-lb-caption></p></figcaption></figure>
<div class="lightbox__bar"><button class="lb-btn" type="button" data-lb-prev aria-label="${G.prev}">${ui.prev}</button><button class="lb-btn" type="button" data-lb-close aria-label="${G.close}">${ui.close}</button><button class="lb-btn" type="button" data-lb-next aria-label="${G.next}">${ui.next}</button></div>
</dialog>
</div></section>
<section class="section section--sand2" data-knot><div class="wrap media-row">
<div><h2>${esc(P.videoTitle)}</h2>
<div class="yt" data-yt="${esc(video.youtubeId)}" data-yt-title="${esc(video.title)}"><img src="${video.src}" alt="${esc(video.alt)}" width="1280" height="720" loading="lazy"><button class="yt__play" type="button" hidden><span class="circle">${ui.play}</span><span class="yt__label">${M.play}${lang === 'fr' ? '&nbsp;:' : ':'} ${esc(video.title)}</span></button></div>
<p class="media-note">${sampleBadge(lang, video.sample)} ${t(video.caption)} ${M.loadNote}</p>
<noscript><p><a href="https://www.youtube.com/watch?v=${esc(video.youtubeId)}">${M.play} (YouTube)</a></p></noscript></div>
<div><h2>${esc(P.audioTitle)}</h2>
<div class="player" data-player data-play="${M.playAudio}" data-pause="${M.pauseAudio}">
<p class="player__title">${esc(audio.title)}</p>
<div class="player__wave" aria-hidden="true">${Array.from({ length: 36 }, (_, i) => `<i data-h="${Math.round(8 + Math.abs(Math.sin(i * 1.7) * 22))}"></i>`).join('')}</div>
<audio src="${audio.audioUrl}" preload="metadata" controls></audio>
<div class="player__ui"><button class="player__btn" type="button" data-pp aria-label="${M.playAudio}">${ui.play}</button>
<div class="player__track"><input class="player__range" type="range" min="0" max="100" step="0.1" value="0" aria-label="${M.position}" data-seek><div class="player__time"><span data-cur>0:00</span><span data-dur>${esc(audio.duration)}</span></div></div>
<button class="player__speed" type="button" data-speed aria-label="${M.speed}">1×</button></div>
<details class="transcript"><summary>${M.transcript}</summary>${md(audio.transcript)}</details>
</div>
<p class="media-note">${sampleBadge(lang, audio.sample)} ${t(audio.caption)}</p></div>
</div></section>`;
}

/* ---------- GIVE ---------- */
export function give(lang, { P, S }) {
  const U = UI[lang], G = U.give;
  return `${pageHero(lang, { trail: trailFor(lang, { name: P.title, path: ROUTES.give[lang] }), title: P.title, intro: P.intro, art: sprigFor(`<g transform="translate(14 14) scale(.825)">${emblems.materielle('').replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</g>`) })}
<section class="section" data-knot><div class="wrap two-col">
<div class="give-box"><h2 id="give-title">${esc(P.amountsTitle)}</h2>
<form data-give action="${esc(S.donateUrl)}" method="get" aria-labelledby="give-title" data-demo="${esc(G.demo)}" data-impact="${esc(G.impact)}" data-makes="${esc(G.makes)}" data-month="${esc(G.perMonth)}">
<fieldset><legend class="sr-only">${lang === 'fr' ? 'Fréquence' : 'Frequency'}</legend><div class="freq"><label><input type="radio" name="frequency" value="once" checked> ${G.once}</label><label><input type="radio" name="frequency" value="monthly"> ${G.monthly}</label></div></fieldset>
<fieldset><legend class="sr-only">${lang === 'fr' ? 'Montant' : 'Amount'}</legend><div class="amounts">${P.amounts.map((a, i) => `<label class="amount"><input type="radio" name="amount" value="${a.amount}" data-label="${esc(a.label)}"${i === 1 ? ' checked' : ''}><strong>${money(a.amount, lang)}</strong><small>${t(a.label)}</small></label>`).join('')}</div></fieldset>
<div class="field"><label for="g-custom">${G.custom}</label><input id="g-custom" name="custom" type="number" min="5" step="1" inputmode="numeric"></div>
<p class="impact" aria-live="polite" data-impact-out><svg viewBox="0 0 40 40" aria-hidden="true"><path d="${heartPath(20, 21, 36)}" fill="${C.terra}"/></svg><span>${G.impact} <strong>${money(P.amounts[1].amount, lang)}</strong> ${G.makes} ${t(P.amounts[1].label)}.</span></p>
<button class="btn" type="submit">${ui.heart}${G.cta}</button>
<p class="zeffy-note">${t(P.zeffyNote)}</p><p class="status" aria-live="polite" data-give-status></p>
<p class="zeffy-note"><small>${t(P.amountsNote)}</small></p>
</form>
<hr class="seam"><h3>${esc(P.monthlyTitle)}</h3><p>${t(P.monthlyText)}</p>
</div>
<div class="grid">
<div class="info-box"><h2>${esc(P.interacTitle)}</h2><ol>${P.interacSteps.map((s) => `<li>${t(s)}</li>`).join('')}</ol>
<p class="mb-0"><strong>${G.recipient}</strong></p><div class="copy-row"><code>${esc(S.interacEmail)}</code><button class="btn btn--sm btn--plum" type="button" data-copy="${esc(S.interacEmail)}" data-copied="${G.copied}" hidden>${ui.copy}${G.copy}</button><span class="status" aria-live="polite"></span></div></div>
<div class="info-box"><h2>${esc(P.bankTitle)}</h2><p>${t(P.bankText)}</p><a class="link-arrow" href="mailto:${S.email}?subject=${encodeURIComponent(lang === 'fr' ? 'Coordonnées bancaires' : 'Bank details')}">${ui.mail}${S.email}</a></div>
<div class="info-box"><h2>${esc(P.receiptTitle)}</h2><p class="mb-0">${t(P.receiptText)}</p></div>
</div></div></section>
${sec('section--sand2', `<div class="wrap">${head('', esc(P.otherTitle), '')}<div class="grid grid--4">${P.other.map((o, i) => `<div class="promise reveal">${icon(['collecte', 'communaute', 'priere', 'maraude'][i], 'i')}<h3>${esc(o.title)}</h3><p>${t(o.text)}</p></div>`).join('')}</div></div>`, ' data-knot')}
${sec('section--tight', `<div class="wrap--narrow"><h2>${esc(P.trustTitle)}</h2><ul class="trust">${P.trust.map((x) => `<li>${ui.check}<span>${t(x)}</span></li>`).join('')}</ul></div>`, ' data-knot')}`;
}

/* ---------- CONTACT ---------- */
export function contact(lang, { P, S }) {
  const U = UI[lang], F = U.form;
  return `${pageHero(lang, { trail: trailFor(lang, { name: P.title, path: ROUTES.contact[lang] }), title: P.title, intro: P.intro })}
<section class="section" data-knot><div class="wrap two-col">
<div class="form-card"><h2 id="c-title">${lang === 'fr' ? 'Écrivez-nous' : 'Write to us'}</h2>
<form class="form" data-form="contact" action="/api/contact" method="post" novalidate aria-labelledby="c-title" data-ok="${esc(F.thanks)}">
<div class="subgrid"><div class="field"><label for="c-name">${F.name} <span class="req" aria-hidden="true">*</span></label><input id="c-name" name="name" type="text" autocomplete="name" required><span class="err"></span></div>
<div class="field"><label for="c-email">${F.email} <span class="req" aria-hidden="true">*</span></label><input id="c-email" name="email" type="email" autocomplete="email" required><span class="err"></span></div></div>
<div class="field"><label for="c-subject">${F.subject}</label><select id="c-subject" name="subject">${P.subjects.map((s) => `<option>${esc(s)}</option>`).join('')}</select></div>
<div class="field"><label for="c-msg">${F.message} <span class="req" aria-hidden="true">*</span></label><textarea id="c-msg" name="message" required></textarea><span class="err"></span></div>
<label class="check"><input type="checkbox" name="consent" required> <span>${F.consentContact} <span class="req" aria-hidden="true">*</span></span></label><span class="err"></span>
<div class="hp" aria-hidden="true"><label for="c-website">${F.hp}</label><input id="c-website" name="website" type="text" tabindex="-1" autocomplete="off"></div>
<!-- Turnstile widget goes here in production; the Pages Function verifies the token server-side. -->
<div><button class="btn" type="submit">${ui.mail}${F.send}</button></div>
<p class="hint">${t(P.response)}</p>
</form></div>
<div class="grid">
<div class="info-box"><h2>${lang === 'fr' ? 'Courriel' : 'Email'}</h2><p class="mb-0"><a class="link-arrow" href="mailto:${S.email}">${ui.mail}${S.email}</a></p><p class="hint mt-1 mb-0">${lang === 'fr' ? 'Montréal (Québec), Canada — aucune adresse publique.' : 'Montréal, Québec, Canada — no public street address.'}</p></div>
<div class="info-box"><h2>${esc(P.helpTitle)}</h2><p class="mb-0">${t(P.helpText)}</p></div>
<div class="info-box"><h2>${esc(P.socialTitle)}</h2><p class="mb-0">${S.social.map((s) => esc(s.name)).join(' · ')} ${t(`[${P.socialNote.replace(/\.$/, '')}]`)}</p></div>
</div></div></section>`;
}

/* ---------- PRIVACY ---------- */
export function privacy(lang, { P }) {
  return `${pageHero(lang, { trail: trailFor(lang, { name: P.title, path: ROUTES.privacy[lang] }), title: P.title, intro: `${lang === 'fr' ? 'Dernière mise à jour' : 'Last updated'} : ${fmtDate(P.updated, lang)}` })}
<section class="section" data-knot><div class="wrap--narrow prose">${md(P.body)}</div></section>`;
}

export function notFound(lang) {
  const U = UI[lang];
  return `<section class="section notfound" data-knot><div class="wrap--narrow"><svg viewBox="0 0 200 180" aria-hidden="true">${stitchedHeart(100, 90, 150)}<path d="M150 150c20 10 40 0 46-20" fill="none" stroke="${C.terra}" stroke-width="3" stroke-dasharray="6 6"/></svg><h1>${U.notFound.title}</h1><p class="lead">${U.notFound.text}</p><a class="btn" href="${ROUTES.home[lang]}">${U.notFound.back}</a></div></section>`;
}

export const _mark = mark;
