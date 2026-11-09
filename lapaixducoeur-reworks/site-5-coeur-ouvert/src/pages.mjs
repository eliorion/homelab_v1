import { ROUTES, UI } from './i18n.mjs';
import { esc, t, typo, inline, md, picture, icon, fmtDate, fmtTime, money, num, pick } from './lib.mjs';
import { ctx, pageHero, sampleBadge, newsletterForm } from './layout.mjs';

export function urlFor(kind, entry, lang) {
  const e = pick(entry, lang);
  const base = { news: ROUTES.news, event: ROUTES.events, campaign: ROUTES.campaigns }[kind][lang];
  return `${base}${e.slug}/`;
}
const abs = (p) => ctx.site + p;
const pct = (r, g) => (g > 0 ? Math.min(100, Math.round((r / g) * 1000) / 10) : 0);
const pad = (n) => String(n).padStart(2, '0');
const colon = (lang) => (lang === 'fr' ? ' :' : ':');
const tsec = (s) => s.split(':').reduce((a, b) => a * 60 + Number(b), 0);

function crumbs(lang, ...items) {
  return [{ name: UI[lang].home, url: ROUTES.home[lang] }, ...items];
}

/* ---------- shared components ---------- */

function thermoBar(lang, c, { big = false } = {}) {
  const L = UI[lang];
  const p = pct(c.raised, c.goal);
  return `<div class="thermo${big ? ' thermo--big' : ''}">
  <p class="thermo__figures"><span class="thermo__raised">${t(money(c.raised, lang), lang)}</span> <span class="thermo__of">${t(L.raised, lang)} · ${t(L.goal, lang)} ${t(money(c.goal, lang), lang)}</span></p>
  <div class="thermo__track" role="progressbar" aria-valuemin="0" aria-valuemax="${c.goal}" aria-valuenow="${c.raised}" aria-valuetext="${esc(typo(L.progressLabel(money(c.raised, lang), money(c.goal, lang)), lang))}">
    <svg viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true" focusable="false"><rect class="thermo__bg" width="100" height="10"/><rect class="thermo__fill" width="${p}" height="10"/></svg>
  </div>
  <p class="thermo__meta"><span>${t(`${num(Math.round(p), lang)} %`.replace(' %', lang === 'fr' ? ' %' : '%'), lang)} ${t(L.ofGoal, lang)}</span><span>${num(c.donors, lang)} ${t(L.donors, lang)}</span></p>
</div>`;
}

function thermoVertical(lang, c) {
  const p = pct(c.raised, c.goal);
  const top = 20; const bottom = 500; const h = bottom - top;
  const fillY = bottom - (h * p) / 100;
  const ticks = [0, 25, 50, 75, 100].map((v) => {
    const y = bottom - (h * v) / 100;
    return `<line x1="86" x2="${v % 50 === 0 ? 104 : 98}" y1="${y}" y2="${y}"/><text x="110" y="${y + 6}">${v === 100 ? t(money(c.goal, lang), lang) : `${v}${lang === 'fr' ? ' ' : ''}%`}</text>`;
  }).join('');
  return `<svg class="thermo-v" viewBox="0 0 220 580" aria-hidden="true" focusable="false">
  <rect class="thermo-v__tube" x="38" y="${top - 18}" width="44" height="${h + 40}" rx="22"/>
  <circle class="thermo-v__tube" cx="60" cy="530" r="40"/>
  <rect class="thermo-v__fill" x="46" y="${fillY}" width="28" height="${bottom - fillY + 30}"/>
  <circle class="thermo-v__bulb" cx="60" cy="530" r="30"/>
  <g class="thermo-v__ticks">${ticks}</g>
</svg>`;
}

function countdown(lang, iso, { compact = false } = {}) {
  const L = UI[lang];
  const ms = Math.max(0, new Date(iso) - ctx.now);
  const d = Math.floor(ms / 864e5); const h = Math.floor(ms / 36e5) % 24; const m = Math.floor(ms / 6e4) % 60; const s = Math.floor(ms / 1e3) % 60;
  const units = [['d', d, L.daysLeft], ['h', h, L.hours], ['m', m, L.minutes], ['s', s, L.seconds]];
  return `<div class="countdown${compact ? ' countdown--compact' : ''}" data-countdown="${esc(iso)}" data-ended="${esc(L.ended)}">
  <p class="kicker">${esc(L.countdownTo)}</p>
  <p class="vh" data-countdown-sr>${d} ${esc(L.noJsCountdown)}</p>
  <ol class="countdown__units" aria-hidden="true">${units.map(([k, v, l]) => `<li><span class="countdown__n" data-unit="${k}">${pad(v)}</span><span class="countdown__l">${esc(l)}</span></li>`).join('')}</ol>
</div>`;
}

function shareBar(lang, url, title) {
  const L = UI[lang];
  const u = encodeURIComponent(abs(url)); const tt = encodeURIComponent(typo(title, lang));
  return `<div class="sharebar" data-share data-share-url="${esc(abs(url))}" data-share-title="${esc(typo(title, lang))}">
  <p class="kicker">${esc(L.share)}</p>
  <ul>
    <li class="js-only"><button class="chip" type="button" data-share-native>${icon('share')} ${esc(L.share)}</button></li>
    <li><a class="chip" href="https://www.facebook.com/sharer/sharer.php?u=${u}" rel="noopener">Facebook</a></li>
    <li><a class="chip" href="https://wa.me/?text=${tt}%20${u}" rel="noopener">WhatsApp</a></li>
    <li><a class="chip" href="mailto:?subject=${tt}&amp;body=${u}">${icon('mail')} ${lang === 'fr' ? 'Courriel' : 'Email'}</a></li>
    <li class="js-only"><button class="chip" type="button" data-copy="${esc(abs(url))}" data-copied="${esc(L.copied)}">${icon('copy')} <span>${esc(L.copyLink)}</span></button></li>
  </ul>
</div>`;
}

function ytFacade(lang, v, { id, big = false } = {}) {
  const L = UI[lang];
  return `<div class="yt${big ? ' yt--big' : ''}" id="${id}" data-yt="${esc(v.youtube_id)}" data-yt-title="${esc(typo(v.title, lang))}" data-yt-lang="${lang}">
  <button class="yt__btn" type="button" aria-label="${esc(typo(`${L.playVideo} : ${v.title} (${v.duration})`.replace(' :', colon(lang)), lang))}">
    ${picture(v.poster, '', { cls: 'yt__poster ph ph--bw', sizes: big ? '(min-width: 1000px) 60vw, 100vw' : '(min-width: 900px) 30vw, 100vw' })}
    <span class="yt__play" aria-hidden="true">${icon('play')}</span>
    <span class="yt__dur" aria-hidden="true">${esc(v.duration)}</span>
  </button>
</div>`;
}

function chaptersList(lang, v, target) {
  const L = UI[lang];
  if (!v.chapters || !v.chapters.length) return '';
  return `<div class="chapters"><p class="kicker">${esc(L.chapters)}</p><ol>${v.chapters.map((c) => `<li><button type="button" class="chapters__btn" data-yt-seek="${tsec(c.time)}" data-yt-target="${target}"><span class="chapters__t">${esc(c.time)}</span> <span>${t(c.label, lang)}</span></button></li>`).join('')}</ol></div>`;
}

function audioPlayer(lang, a, id) {
  const L = UI[lang];
  return `<div class="player" data-player>
  <p class="player__kicker kicker">${esc(L.podcast)}${a.sample ? ` ${sampleBadge(lang)}` : ''}</p>
  <h3 class="player__title">${t(a.title, lang)}</h3>
  <p class="player__desc">${t(a.description, lang)}</p>
  <audio src="${esc(a.audio_url)}" preload="metadata" controls data-audio></audio>
  <div class="player__ui js-only">
    <button class="player__play" type="button" data-play aria-label="${esc(L.play)}" data-label-play="${esc(L.play)}" data-label-pause="${esc(L.pause)}">${icon('play', 'ico ico--play')}${icon('pause', 'ico ico--pause')}</button>
    <div class="player__track"><label class="vh" for="${id}-seek">${esc(L.seek)}</label><input id="${id}-seek" type="range" min="0" max="100" step="0.1" value="0" data-seek></div>
    <p class="player__time"><span data-cur>0:00</span> / <span data-dur>${esc(a.duration)}</span></p>
    <button class="player__speed chip" type="button" data-speed aria-label="${esc(L.speed)}">1×</button>
  </div>
  <details class="transcript"><summary>${esc(L.transcript)}</summary>${md(a.transcript, lang)}</details>
</div>`;
}

function newsCard(lang, n, { big = false } = {}) {
  const e = pick(n, lang);
  const url = urlFor('news', n, lang);
  return `<article class="ncard${big ? ' ncard--big' : ''}">
  <a class="ncard__link" href="${url}">
    ${picture(e.image, e.image_alt, { cls: 'ncard__img ph ph--bw', sizes: big ? '(min-width: 900px) 55vw, 100vw' : '(min-width: 900px) 25vw, 100vw' })}
    <p class="ncard__meta"><span class="ncard__cat">${t(e.category, lang)}</span> <time datetime="${e.date}">${fmtDate(e.date, lang)}</time></p>
    <h3 class="ncard__title">${t(e.title, lang)}</h3>
  </a>
  <p class="ncard__excerpt">${t(e.excerpt, lang)}</p>
  ${e.sample ? sampleBadge(lang) : ''}
</article>`;
}

function eventRow(lang, ev, { h = 3 } = {}) {
  const e = pick(ev, lang);
  const L = UI[lang];
  const url = urlFor('event', ev, lang);
  return `<article class="erow">
  <p class="erow__date"><time datetime="${e.start}"><span class="erow__day">${fmtDate(e.start, lang, { day: 'numeric' })}</span><span class="erow__month">${fmtDate(e.start, lang, { month: 'short' })}</span><span class="erow__wd">${fmtDate(e.start, lang, { weekday: 'long' })}</span></time></p>
  <div class="erow__body">
    <p class="erow__cat kicker">${t(e.category, lang)}${e.sample ? ` ${sampleBadge(lang)}` : ''}</p>
    <h${h} class="erow__title"><a href="${url}">${t(e.title, lang)}</a></h${h}>
    <p class="erow__info">${icon('calendar')} ${fmtTime(e.start, lang)} – ${fmtTime(e.end, lang)} <span aria-hidden="true">·</span> ${icon('pin')} ${t(e.location, lang)}</p>
    <p class="erow__sum">${t(e.summary, lang)}</p>
  </div>
  <p class="erow__actions"><a class="chip" href="${url.replace(/\/$/, '.ics')}" download>${icon('calendar')} .ics</a><a class="link-arrow" href="${url}">${esc(L.readMore)} ${icon('arrow')}</a></p>
</article>`;
}

function campaignSpot(lang, c, { h = 3 } = {}) {
  const e = pick(c, lang);
  const L = UI[lang];
  const url = urlFor('campaign', c, lang);
  return `<article class="spot">
  <div class="spot__media">${picture(e.image, e.image_alt, { cls: 'ph ph--duo', sizes: '(min-width: 900px) 40vw, 100vw' })}<p class="spot__stamp" aria-hidden="true">${lang === 'fr' ? 'Noël' : 'Xmas'}<br>2026</p></div>
  <div class="spot__body">
    <p class="kicker">${t(e.name, lang)} · ${esc(e.status === 'active' ? L.active : L.closed)}${e.sample ? ` ${sampleBadge(lang)}` : ''}</p>
    <h${h} class="spot__title display"><a href="${url}">${t(e.headline, lang)}</a></h${h}>
    ${thermoBar(lang, e)}
    ${e.status === 'active' ? countdown(lang, e.end, { compact: true }) : ''}
    <p class="spot__ctas"><a class="btn btn--coral" href="${url}#catalogue">${esc(L.giveNow)} ${icon('arrow')}</a> <a class="btn btn--ghost" href="${url}">${esc(L.seeCampaign)}</a></p>
  </div>
</article>`;
}

function sectionHead(lang, { n, kicker, title, id, sub = '' }) {
  const L = UI[lang];
  return `<header class="chapter__head">
    <p class="chapter__num" aria-hidden="true">${pad(n)}</p>
    <p class="kicker chapter__kicker">${esc(L.chapter)} ${pad(n)} <span aria-hidden="true">—</span> ${t(kicker, lang)}</p>
    <h2 id="${id}" class="chapter__title display reveal-lines">${t(title, lang)}</h2>
    ${sub}
  </header>`;
}

/* ---------- pages ---------- */

export function home(lang, D) {
  const L = UI[lang];
  const p = D.pages.home[lang];
  const mi = D.pages.missions[lang];
  const active = D.campaigns.filter((c) => pick(c, lang).status === 'active');
  const news = D.news.slice(0, 3);
  const events = D.events.filter((e) => new Date(pick(e, lang).end) >= ctx.now).slice(0, 3);
  const featured = D.media.find((m) => pick(m, lang).type === 'video' && pick(m, lang).featured);
  const issue = fmtDate(ctx.now.toISOString(), lang, { month: 'long', year: 'numeric' });
  const lines = p.verse_lines.map((l, i) => `<span class="line${i === p.verse_lines.length - 1 ? ' line--coral' : ''}"><span>${t(l, lang)}</span></span>`).join(' ');

  const body = `
<section class="hero" aria-labelledby="hero-title">
  <div class="wrap hero__grid">
    <p class="hero__folio"><span>${t(p.masthead, lang)}</span><span>${esc(issue)}</span></p>
    <h1 id="hero-title" class="hero__title display">${lines}</h1>
    <div class="hero__verse">
      <p class="hero__rest">${t(p.verse_rest, lang)}</p>
      <p class="hero__ref">— ${t(p.verse_ref, lang)}</p>
    </div>
    <figure class="hero__photo">
      ${picture('/assets/img/children-joy.jpg', lang === 'fr' ? 'Un groupe d’enfants souriants dans une rue, serrés les uns contre les autres' : 'A group of smiling children huddled together in a street', { cls: 'ph ph--duo', sizes: '(min-width: 900px) 32vw, 100vw', eager: true })}
    </figure>
    <div class="hero__intro">
      <p>${inline(p.intro, lang)}</p>
      <p class="hero__ctas"><a class="btn btn--coral" href="${active[0] ? urlFor('campaign', active[0], lang) : ROUTES.give[lang]}">${t(L.nav.campaigns, lang)} ${icon('arrow')}</a> <a class="btn btn--ghost" href="#chapitre-1">${lang === 'fr' ? 'Lire le récit' : 'Read the story'}</a></p>
    </div>
  </div>
</section>

<section class="chapter chapter--need" id="chapitre-1" aria-labelledby="ch1">
  <div class="wrap chapter__grid">
    ${sectionHead(lang, { n: 1, kicker: p.need.kicker, title: p.need.title, id: 'ch1' })}
    <ul class="need-lines">${p.need.lines.map((l) => `<li class="reveal">${t(l, lang)}</li>`).join('')}</ul>
    <figure class="need-photo reveal">${picture('/assets/img/widows.jpg', lang === 'fr' ? 'Deux femmes âgées assises côte à côte devant un mur de briques, l’une sourit' : 'Two older women sitting side by side in front of a brick wall, one smiling', { cls: 'ph ph--bw ph--offset', sizes: '(min-width: 900px) 30vw, 100vw' })}</figure>
    <p class="need-body">${t(p.need.body, lang)} <a class="link-arrow" href="${ROUTES.about[lang]}#ethique">${lang === 'fr' ? 'Notre charte du récit éthique' : 'Our ethical storytelling charter'} ${icon('arrow')}</a></p>
  </div>
</section>

<section class="chapter chapter--heart theme-ink" aria-labelledby="ch2">
  <div class="wrap chapter__grid">
    ${sectionHead(lang, { n: 2, kicker: p.heart.kicker, title: p.heart.title, id: 'ch2' })}
    <p class="heart-body">${t(p.heart.body, lang)}</p>
    <figure class="heart-photo reveal">${picture('/assets/img/elders.jpg', lang === 'fr' ? 'Trois femmes âgées rient ensemble autour d’une tasse de thé' : 'Three older women laughing together over a cup of tea', { cls: 'ph ph--duo', sizes: '(min-width: 900px) 45vw, 100vw' })}</figure>
    <blockquote class="bigquote reveal"><p>${t(p.heart.quote, lang)}</p><cite>${t(p.heart.quote_ref, lang)}</cite></blockquote>
  </div>
</section>

<section class="hope theme-ink" aria-labelledby="hope-word" data-hope>
  <div class="hope__sticky">
    <p class="hope__lead">${t(p.hope.lead, lang)}</p>
    <h2 class="hope__word display" id="hope-word"><span>${t(p.hope.word, lang)}</span></h2>
    <p class="hope__after">${t(p.hope.after, lang)}</p>
  </div>
</section>

<section class="chapter chapter--do" aria-labelledby="ch3">
  <div class="wrap">
    <div class="chapter__grid">
      ${sectionHead(lang, { n: 3, kicker: p.do.kicker, title: p.do.title, id: 'ch3' })}
      <p class="do-body">${t(p.do.body, lang)}</p>
    </div>
    <dl class="figures">${p.do.figures.map((f, i) => `<div class="figure reveal${i % 2 ? ' figure--coral' : ''}"><dt>${t(f.label, lang)}</dt><dd>${t(f.value, lang)}</dd></div>`).join('')}</dl>
    <ol class="areas">${mi.areas.map((a, i) => `<li class="area area--${i + 1} reveal">
      ${picture(a.image, a.alt, { cls: 'ph ph--bw', sizes: '(min-width: 900px) 40vw, 100vw' })}
      <p class="area__num" aria-hidden="true">${pad(i + 1)}</p>
      <h3 class="area__name display">${t(a.name, lang)}</h3>
      <p class="area__text">${t(a.text, lang)}</p>
    </li>`).join('')}</ol>
    <div class="programmes">
      <h3 class="programmes__title kicker">${lang === 'fr' ? 'Trois programmes' : 'Three programmes'}</h3>
      <ol>${mi.programmes.map((g, i) => `<li><span class="programmes__n" aria-hidden="true">${['I', 'II', 'III'][i]}</span><span class="programmes__name">${t(g.name, lang)}</span><span class="programmes__text">${t(g.text, lang)}</span></li>`).join('')}</ol>
      <p><a class="link-arrow" href="${ROUTES.missions[lang]}">${esc(L.seeMissions)} ${icon('arrow')}</a></p>
    </div>
  </div>
</section>

<section class="chapter chapter--act theme-coral" aria-labelledby="ch4">
  <div class="wrap">
    <div class="chapter__grid">
      ${sectionHead(lang, { n: 4, kicker: p.act.kicker, title: p.act.title, id: 'ch4' })}
      <p class="act-body">${t(p.act.body, lang)}</p>
    </div>
    <ul class="acts">
      ${[['give', 'heart', L.actGive, L.actGiveText, active[0] ? urlFor('campaign', active[0], lang) : ROUTES.give[lang]], ['amb', 'users', L.actAmb, L.actAmbText, ROUTES.ambassadors[lang]], ['cards', 'card', L.actCards, L.actCardsText, ROUTES.cards[lang]], ['pray', 'pray', L.actPray, L.actPrayText, ROUTES.events[lang]]]
    .map(([k, ic, h, tx, u], i) => `<li class="act reveal"><a href="${u}"><span class="act__n" aria-hidden="true">${pad(i + 1)}</span>${icon(ic, 'ico act__ico')}<span class="act__h display">${t(h, lang)}</span><span class="act__t">${t(tx, lang)}</span><span class="act__go" aria-hidden="true">${icon('arrow')}</span></a></li>`).join('')}
    </ul>
    <blockquote class="bigquote bigquote--center reveal"><p>${t(p.act.quote, lang)}</p><cite>${t(p.act.quote_ref, lang)}</cite></blockquote>
  </div>
</section>

${active.length ? `<section class="section campaign-home" aria-labelledby="camp-h"><div class="wrap"><h2 id="camp-h" class="section__title display">${lang === 'fr' ? 'Maintenant' : 'Right now'}</h2>${campaignSpot(lang, active[0])}</div></section>` : ''}

<section class="section journal" aria-labelledby="journal-h">
  <div class="wrap">
    <header class="section__head"><h2 id="journal-h" class="section__title display">${esc(L.latest)}</h2><a class="link-arrow" href="${ROUTES.news[lang]}">${esc(L.allNews)} ${icon('arrow')}</a></header>
    <div class="journal__grid">${news.map((n, i) => newsCard(lang, n, { big: i === 0 })).join('')}</div>
  </div>
</section>

<section class="section agenda-home theme-paper2" aria-labelledby="agenda-h">
  <div class="wrap agenda-home__grid">
    <header class="section__head section__head--stack"><h2 id="agenda-h" class="section__title display">${esc(L.upcoming)}</h2><p>${t(L.eventsSample, lang)}</p><a class="link-arrow" href="${ROUTES.events[lang]}">${esc(L.allEvents)} ${icon('arrow')}</a></header>
    <div class="agenda">${events.map((e) => eventRow(lang, e)).join('')}</div>
  </div>
</section>

${featured ? (() => { const v = pick(featured, lang); return `<section class="section watch theme-ink" aria-labelledby="watch-h">
  <div class="wrap watch__grid">
    <div class="watch__text">
      <p class="kicker">${esc(L.watch)} · ${esc(v.duration)} ${v.sample ? sampleBadge(lang) : ''}</p>
      <h2 id="watch-h" class="display watch__title">${t(v.title, lang)}</h2>
      <p>${t(v.description, lang)}</p>
      <p class="watch__cc">${icon('cc')} ${t(v.captions, lang)}</p>
      <p><a class="link-arrow" href="${ROUTES.videos[lang]}">${esc(L.watchAll)} ${icon('arrow')}</a></p>
    </div>
    <div class="watch__player">${ytFacade(lang, v, { id: 'yt-home', big: true })}<p class="yt__note">${t(L.loadNote, lang)}</p></div>
  </div>
</section>`; })() : ''}`;

  return { title: p.title, fullTitle: true, description: p.description, body, bodyClass: 'page-home' };
}

export function about(lang, D) {
  const p = D.pages.about[lang];
  const L = UI[lang];
  const body = `${pageHero(lang, { num: '02', kicker: p.kicker, heading: p.heading, lede: p.lede })}
<section class="section">
  <div class="wrap prose-grid">
    <div class="prose dropcap">${md(p.body, lang)}</div>
    <aside class="aside-note"><p class="aside-note__big display" aria-hidden="true">Kimia<br>na<br>motema</p><p>${inline(p.name_story, lang)}</p></aside>
  </div>
</section>
<section class="section theme-paper2" aria-labelledby="tl-h">
  <div class="wrap">
    <h2 id="tl-h" class="section__title display">${lang === 'fr' ? 'Repères' : 'Milestones'}</h2>
    <ol class="timeline">${p.timeline.map((x) => `<li class="reveal"><p class="timeline__year display">${inline(x.year, lang)}</p><p>${t(x.text, lang)}</p></li>`).join('')}</ol>
  </div>
</section>
<section class="section" aria-labelledby="team-h">
  <div class="wrap">
    <h2 id="team-h" class="section__title display">${t(p.team_title, lang)} ${sampleBadge(lang)}</h2>
    <ul class="team">${p.team.map((m) => `<li><span class="team__mono" aria-hidden="true">${esc((m.name.match(/[A-ZÀ-Ý]/) || ['?'])[0])}</span><p class="team__name">${inline(m.name, lang)}</p><p class="team__role">${inline(m.role, lang)}</p></li>`).join('')}</ul>
  </div>
</section>
<section class="section theme-ink" id="ethique" aria-labelledby="eth-h">
  <div class="wrap ethics">
    <div><p class="kicker">${lang === 'fr' ? 'Engagement' : 'Commitment'}</p><h2 id="eth-h" class="section__title display">${t(p.ethics_title, lang)}</h2><p>${t(p.ethics_intro, lang)}</p></div>
    <ol class="ethics__list">${p.ethics.map((x, i) => `<li class="reveal"><span class="ethics__n" aria-hidden="true">${pad(i + 1)}</span><span>${t(x, lang)}</span></li>`).join('')}</ol>
  </div>
</section>
<section class="section">
  <div class="wrap"><blockquote class="bigquote bigquote--center"><p>${t(D.pages.home[lang].heart.quote, lang)}</p><cite>${t(D.pages.home[lang].heart.quote_ref, lang)}</cite></blockquote>
  <p class="center"><a class="btn btn--coral" href="${ROUTES.give[lang]}">${esc(L.donate)} ${icon('arrow')}</a> <a class="btn btn--ghost" href="${ROUTES.missions[lang]}">${esc(L.seeMissions)}</a></p></div>
</section>`;
  return { title: p.title, description: p.description, body, crumbs: crumbs(lang, { name: L.nav.about, url: ROUTES.about[lang] }) };
}

export function missions(lang, D) {
  const p = D.pages.missions[lang];
  const L = UI[lang];
  const body = `${pageHero(lang, { num: '03', kicker: p.kicker, heading: p.heading, lede: p.lede })}
<section class="section" aria-labelledby="prog-h">
  <div class="wrap">
    <h2 id="prog-h" class="section__title display">${lang === 'fr' ? 'Trois programmes' : 'Three programmes'}</h2>
    <ol class="bignum-list">${p.programmes.map((g, i) => `<li class="reveal"><span class="bignum" aria-hidden="true">${i + 1}</span><h3 class="display">${t(g.name, lang)}</h3><p>${t(g.text, lang)}</p></li>`).join('')}</ol>
  </div>
</section>
<section class="section theme-paper2" aria-labelledby="areas-h">
  <div class="wrap">
    <h2 id="areas-h" class="section__title display">${lang === 'fr' ? 'Quatre domaines d’aide' : 'Four areas of aid'}</h2>
    <ol class="areas">${p.areas.map((a, i) => `<li class="area area--${i + 1} reveal">${picture(a.image, a.alt, { cls: 'ph ph--bw', sizes: '(min-width: 900px) 40vw, 100vw' })}<p class="area__num" aria-hidden="true">${pad(i + 1)}</p><h3 class="area__name display">${t(a.name, lang)}</h3><p class="area__text">${t(a.text, lang)}</p></li>`).join('')}</ol>
  </div>
</section>
<section class="section" aria-labelledby="field-h">
  <div class="wrap">
    <h2 id="field-h" class="section__title display">${t(p.actions_title, lang)}</h2>
    ${p.actions.map((a, i) => `<article class="feature${i % 2 ? ' feature--flip' : ''} reveal">${picture(a.image, a.alt, { cls: 'ph ph--duo ph--offset', sizes: '(min-width: 900px) 50vw, 100vw' })}<div><h3 class="display feature__title">${t(a.name, lang)}</h3><p>${t(a.text, lang)}</p></div></article>`).join('')}
    <p class="where">${icon('pin')} ${inline(p.where, lang)}</p>
    <p class="center"><a class="btn btn--coral" href="${ROUTES.give[lang]}">${esc(L.donate)} ${icon('arrow')}</a> <a class="btn btn--ghost" href="${ROUTES.events[lang]}">${t(L.nav.events, lang)}</a></p>
  </div>
</section>`;
  return { title: p.title, description: p.description, body, crumbs: crumbs(lang, { name: L.nav.missions, url: ROUTES.missions[lang] }) };
}

export function newsList(lang, D) {
  const p = D.pages.listings[lang].news;
  const L = UI[lang];
  const body = `${pageHero(lang, { num: '08', kicker: p.kicker, heading: p.heading, lede: p.lede, extra: `<p><a class="link-arrow" href="${ROUTES.news[lang]}feed.xml">${icon('rss')} ${esc(L.rss)}</a></p>` })}
<section class="section"><div class="wrap"><h2 class="vh">${esc(L.nav.news)}</h2><div class="journal__grid journal__grid--list">${D.news.map((n, i) => newsCard(lang, n, { big: i === 0 })).join('')}</div></div></section>`;
  return { title: p.title, description: p.description, body, crumbs: crumbs(lang, { name: L.nav.news, url: ROUTES.news[lang] }) };
}

export function article(lang, D, n) {
  const e = pick(n, lang);
  const L = UI[lang];
  const url = urlFor('news', n, lang);
  const others = D.news.filter((x) => x !== n).slice(0, 2);
  const body = `<article class="article">
  <header class="article__head wrap">
    <p class="kicker">${t(e.category, lang)} ${e.sample ? sampleBadge(lang) : ''}</p>
    <h1 class="article__title display reveal-lines">${t(e.title, lang)}</h1>
    <p class="article__stand">${t(e.excerpt, lang)}</p>
    <p class="article__meta">${esc(L.by)} ${t(e.author, lang)} <span aria-hidden="true">·</span> <time datetime="${e.date}">${fmtDate(e.date, lang)}</time></p>
  </header>
  <figure class="article__fig wrap">${picture(e.image, e.image_alt, { cls: 'ph ph--duo', sizes: '(min-width: 1200px) 1200px, 100vw', eager: true })}</figure>
  <div class="article__body wrap"><div class="prose dropcap">${md(e.body, lang)}</div>
    <aside class="article__aside">${shareBar(lang, url, e.title)}</aside>
  </div>
</article>
<section class="section theme-paper2" aria-labelledby="more-h"><div class="wrap"><header class="section__head"><h2 id="more-h" class="section__title display">${lang === 'fr' ? 'Lire aussi' : 'Read next'}</h2><a class="link-arrow" href="${ROUTES.news[lang]}">${esc(L.allNews)} ${icon('arrow')}</a></header><div class="journal__grid journal__grid--two">${others.map((o) => newsCard(lang, o)).join('')}</div></div></section>`;
  const ld = [{
    '@type': 'NewsArticle', headline: typo(e.title, lang), description: typo(e.excerpt, lang), datePublished: e.date, dateModified: e.date,
    inLanguage: L.locale, image: [abs(e.image)], author: { '@type': 'Organization', name: typo(e.author, lang), url: abs('/') },
    publisher: { '@id': abs('/#org') }, mainEntityOfPage: abs(url),
  }];
  return { title: e.title, description: e.excerpt, body, ld, ogType: 'article', ogImage: e.image, crumbs: crumbs(lang, { name: L.nav.news, url: ROUTES.news[lang] }, { name: e.title, url }) };
}

export function eventLD(lang, ev) {
  const e = pick(ev, lang);
  return {
    '@type': 'Event', name: typo(e.title, lang), description: typo(e.summary, lang), startDate: e.start, endDate: e.end,
    eventStatus: 'https://schema.org/EventScheduled', eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: { '@type': 'Place', name: typo(e.location, lang), address: { '@type': 'PostalAddress', streetAddress: typo(e.address, lang), addressLocality: 'Montréal', addressRegion: 'QC', addressCountry: 'CA' } },
    image: [abs(e.image)], organizer: { '@id': abs('/#org') }, inLanguage: UI[lang].locale, url: abs(urlFor('event', ev, lang)),
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'CAD', availability: 'https://schema.org/InStock', url: abs(urlFor('event', ev, lang)), validFrom: '2026-11-01' },
  };
}

export function eventsList(lang, D) {
  const p = D.pages.listings[lang].events;
  const L = UI[lang];
  const body = `${pageHero(lang, { num: '09', kicker: p.kicker, heading: p.heading, lede: p.lede })}
<section class="section"><div class="wrap"><p class="notice">${t(L.eventsSample, lang)}</p><h2 class="vh">${esc(L.upcoming)}</h2><div class="agenda agenda--full">${D.events.map((e) => eventRow(lang, e)).join('')}</div></div></section>`;
  return { title: p.title, description: p.description, body, ld: D.events.map((e) => eventLD(lang, e)), crumbs: crumbs(lang, { name: L.nav.events, url: ROUTES.events[lang] }) };
}

const gcalDate = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export function eventPage(lang, D, ev) {
  const e = pick(ev, lang);
  const L = UI[lang];
  const url = urlFor('event', ev, lang);
  const gcal = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(typo(e.title, lang))}&dates=${gcalDate(e.start)}/${gcalDate(e.end)}&details=${encodeURIComponent(typo(e.summary, lang) + ' — ' + abs(url))}&location=${encodeURIComponent(typo(e.location, lang))}`;
  const body = `<article class="event">
  <header class="event__head wrap">
    <p class="event__date display" aria-hidden="true"><span>${fmtDate(e.start, lang, { day: 'numeric' })}</span><span>${fmtDate(e.start, lang, { month: 'short' })}</span></p>
    <div>
      <p class="kicker">${t(e.category, lang)} ${e.sample ? sampleBadge(lang) : ''}</p>
      <h1 class="event__title display reveal-lines">${t(e.title, lang)}</h1>
      <p class="page-hero__lede">${t(e.summary, lang)}</p>
    </div>
  </header>
  <div class="wrap event__grid">
    <div>
      ${picture(e.image, e.image_alt, { cls: 'ph ph--duo ph--offset', sizes: '(min-width: 900px) 55vw, 100vw', eager: true })}
      <div class="prose">${md(e.body, lang)}</div>
    </div>
    <aside class="event__card">
      <dl class="facts">
        <div><dt>${esc(L.when)}</dt><dd><time datetime="${e.start}">${fmtDate(e.start, lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</time><br>${fmtTime(e.start, lang)} – ${fmtTime(e.end, lang)}</dd></div>
        <div><dt>${esc(L.where)}</dt><dd>${t(e.location, lang)}<br>${inline(e.address, lang)}</dd></div>
        <div><dt>${esc(L.price)}</dt><dd>${t(e.price, lang)}</dd></div>
      </dl>
      <p class="kicker">${esc(L.addCal)}</p>
      <p class="event__cal"><a class="btn btn--ink btn--sm" href="${url.replace(/\/$/, '.ics')}" download>${icon('download')} ${esc(L.icsFile)}</a> <a class="btn btn--ghost btn--sm" href="${esc(gcal)}" rel="noopener">${esc(L.gcal)}</a></p>
      ${e.ticket_url ? `<p><a class="btn btn--coral btn--block" href="${esc(e.ticket_url)}">${esc(L.tickets)}</a></p>` : `<p class="tbc-note">${t(L.ticketsSoon, lang)}</p>`}
      ${shareBar(lang, url, e.title)}
    </aside>
  </div>
</article>`;
  return { title: e.title, description: e.summary, body, ld: [eventLD(lang, ev)], ogImage: e.image, crumbs: crumbs(lang, { name: L.nav.events, url: ROUTES.events[lang] }, { name: e.title, url }) };
}

export function media(lang, D) {
  const p = D.pages.listings[lang].media;
  const L = UI[lang];
  const items = D.media.map((m) => ({ m, e: pick(m, lang) }));
  const photos = items.filter((x) => x.e.type === 'photo').sort((a, b) => a.e.order - b.e.order);
  const audios = items.filter((x) => x.e.type === 'audio');
  const videos = items.filter((x) => x.e.type === 'video').sort((a, b) => a.e.order - b.e.order);
  const body = `${pageHero(lang, { num: '11', kicker: p.kicker, heading: p.heading, lede: p.lede })}
<section class="section" aria-labelledby="pod-h"><div class="wrap"><h2 id="pod-h" class="section__title display">${esc(L.podcast)}</h2>${audios.map((a, i) => audioPlayer(lang, a.e, `aud${i}`)).join('')}</div></section>
<section class="section theme-paper2" aria-labelledby="gal-h"><div class="wrap"><h2 id="gal-h" class="section__title display">${esc(L.gallery)}</h2>
  <ul class="gallery">${photos.map((x) => `<li><figure>${picture(x.e.image, x.e.alt, { cls: 'ph ph--bw', sizes: '(min-width: 900px) 33vw, 100vw' })}<figcaption>${t(x.e.title, lang)}</figcaption></figure></li>`).join('')}</ul>
  <p class="notice">${lang === 'fr' ? 'Photos publiées avec le consentement des personnes. Pour demander un retrait, ' : 'Photos published with the consent of the people shown. To ask for a removal, '}<a href="${ROUTES.contact[lang]}">${lang === 'fr' ? 'écrivez-nous' : 'write to us'}</a>.</p>
</div></section>
<section class="section" aria-labelledby="vid-h"><div class="wrap"><header class="section__head"><h2 id="vid-h" class="section__title display">${t(L.nav.videos, lang)}</h2><a class="link-arrow" href="${ROUTES.videos[lang]}">${esc(L.watchAll)} ${icon('arrow')}</a></header>
  <ul class="vgrid">${videos.slice(0, 3).map((x) => `<li><a class="vthumb" href="${ROUTES.videos[lang]}#${x.m.id}">${picture(x.e.poster, '', { cls: 'ph ph--bw', sizes: '(min-width: 900px) 30vw, 100vw' })}<span class="yt__play" aria-hidden="true">${icon('play')}</span><span class="vthumb__title">${t(x.e.title, lang)} <span class="vthumb__dur">${esc(x.e.duration)}</span></span></a></li>`).join('')}</ul>
</div></section>`;
  return { title: p.title, description: p.description, body, crumbs: crumbs(lang, { name: L.nav.media, url: ROUTES.media[lang] }) };
}

export function videos(lang, D) {
  const p = D.pages.listings[lang].videos;
  const L = UI[lang];
  const vids = D.media.map((m) => ({ m, e: pick(m, lang) })).filter((x) => x.e.type === 'video').sort((a, b) => a.e.order - b.e.order);
  const [first, ...rest] = vids;
  const body = `${pageHero(lang, { num: '10', kicker: p.kicker, heading: p.heading, lede: p.lede })}
<section class="section theme-ink" aria-labelledby="${first.m.id}-h" id="${first.m.id}">
  <div class="wrap vfeature">
    <div class="vfeature__player">${ytFacade(lang, first.e, { id: 'yt-feature', big: true })}<p class="yt__note">${t(L.loadNote, lang)}</p></div>
    <div class="vfeature__info">
      <p class="kicker">${esc(L.video)} · ${esc(first.e.duration)} ${first.e.sample ? sampleBadge(lang) : ''}</p>
      <h2 id="${first.m.id}-h" class="display vfeature__title">${t(first.e.title, lang)}</h2>
      <p>${t(first.e.description, lang)}</p>
      ${chaptersList(lang, first.e, 'yt-feature')}
      <p class="cc-note">${icon('cc')} <span><strong>${esc(L.captions)}${colon(lang)}</strong> ${t(first.e.captions, lang)}. ${t(L.captionsNote, lang)}</span></p>
    </div>
  </div>
</section>
<section class="section" aria-labelledby="more-v"><div class="wrap"><h2 id="more-v" class="section__title display">${lang === 'fr' ? 'Toutes les vidéos' : 'All videos'}</h2>
  <ul class="vlist">${rest.map((x, i) => `<li id="${x.m.id}" class="vlist__item">${ytFacade(lang, x.e, { id: `yt-${i}` })}<div><p class="kicker">${esc(x.e.duration)} ${x.e.sample ? sampleBadge(lang) : ''}</p><h3 class="vlist__title display">${t(x.e.title, lang)}</h3><p>${t(x.e.description, lang)}</p>${chaptersList(lang, x.e, `yt-${i}`)}<p class="cc-note">${icon('cc')} <span>${t(x.e.captions, lang)}</span></p></div></li>`).join('')}</ul>
</div></section>`;
  return { title: p.title, description: p.description, body, crumbs: crumbs(lang, { name: L.nav.videos, url: ROUTES.videos[lang] }) };
}

export function give(lang, D) {
  const p = D.pages.give[lang];
  const L = UI[lang];
  const s = D.settings[lang];
  const active = D.campaigns.filter((c) => pick(c, lang).status === 'active');
  const body = `${pageHero(lang, { num: '05', kicker: p.kicker, heading: p.heading, lede: p.lede })}
<section class="section" aria-labelledby="donate-h">
  <div class="wrap give-grid">
    <form class="donate" action="${esc(s.zeffy_url || '#zeffy')}" method="get" data-donate>
      <h2 id="donate-h" class="display donate__title">${esc(L.yourGift)}</h2>
      <fieldset class="seg"><legend class="vh">${lang === 'fr' ? 'Fréquence' : 'Frequency'}</legend>
        <label><input type="radio" name="frequency" value="once" checked><span>${esc(L.once)}</span></label>
        <label><input type="radio" name="frequency" value="monthly"><span>${esc(L.monthly)}</span></label>
      </fieldset>
      <fieldset class="amounts"><legend>${esc(L.amount)} <span class="sample">${esc(L.sample)}</span></legend>
        ${p.amounts.map((a, i) => `<label class="amount"><input type="radio" name="amount" value="${a.value}" data-impact="${esc(typo(a.label, lang))}"${i === 2 ? ' checked' : ''}><span class="amount__v display">${t(money(a.value, lang), lang)}</span><span class="amount__l">${t(a.label, lang)}</span></label>`).join('')}
        <label class="amount amount--other"><input type="radio" name="amount" value="other" data-impact=""><span class="amount__v display">${esc(L.otherAmount)}</span><span class="amount__field"><label class="vh" for="other-amount">${esc(L.otherAmount)}</label><input id="other-amount" name="other" type="number" min="5" step="1" inputmode="numeric" placeholder="${lang === 'fr' ? 'Montant en $' : 'Amount in $'}"></span></label>
      </fieldset>
      <p class="donate__impact" data-impact-out aria-live="polite">${esc(L.impactPrefix)} <strong>${t(money(p.amounts[2].value, lang), lang)}</strong> ${esc(L.impactJoin)} ${t(p.amounts[2].label, lang)}.</p>
      <button class="btn btn--coral btn--block btn--lg" type="submit" data-zeffy>${esc(L.zeffyBtn)} ${icon('arrow')}</button>
      <p class="donate__note" data-zeffy-note>${icon('heart')} ${t(L.zeffyNote, lang)}</p>
      <p class="donate__receipt">${inline(p.receipt_text, lang)}</p>
    </form>
    <aside class="interac">
      <p class="kicker">${lang === 'fr' ? 'Autre option' : 'Another option'}</p>
      <h2 class="display interac__title">${t(p.interac_title, lang)}</h2>
      <p>${t(p.interac_text, lang)}</p>
      <p class="interac__email"><span>${esc(s.interac_email)}</span> <button class="chip js-only" type="button" data-copy="${esc(s.interac_email)}" data-copied="${esc(L.copied)}">${icon('copy')} <span>${esc(L.copy)}</span></button></p>
      <p class="interac__bank">${t(p.bank_text, lang)}</p>
    </aside>
  </div>
</section>
${active.length ? `<section class="section theme-paper2" aria-labelledby="gc-h"><div class="wrap"><h2 id="gc-h" class="section__title display">${lang === 'fr' ? 'Campagne en cours' : 'Current campaign'}</h2>${campaignSpot(lang, active[0])}</div></section>` : ''}
<section class="section" aria-labelledby="other-h"><div class="wrap">
  <h2 id="other-h" class="section__title display">${t(p.other_title, lang)}</h2>
  <ul class="tiles">${p.other.map((o, i) => `<li class="tile reveal"><span class="tile__n" aria-hidden="true">${pad(i + 1)}</span><h3 class="display">${t(o.name, lang)}</h3><p>${t(o.text, lang)}</p><a class="link-arrow" href="${[ROUTES.contact, ROUTES.events, ROUTES.contact, ROUTES.ambassadors][i][lang]}">${[lang === 'fr' ? 'Confier une intention' : 'Send a prayer request', L.nav.events, lang === 'fr' ? 'Nous écrire' : 'Write to us', L.nav.ambassadors][i]} ${icon('arrow')}</a></li>`).join('')}</ul>
</div></section>`;
  return { title: p.title, description: p.description, body, scripts: [], crumbs: crumbs(lang, { name: L.nav.give, url: ROUTES.give[lang] }) };
}

export function campaignsList(lang, D) {
  const p = D.pages.listings[lang].campaigns;
  const L = UI[lang];
  const list = D.campaigns.map((c) => ({ c, e: pick(c, lang) }));
  const active = list.filter((x) => x.e.status === 'active');
  const closed = list.filter((x) => x.e.status !== 'active');
  const body = `${pageHero(lang, { num: '04', kicker: p.kicker, heading: p.heading, lede: p.lede })}
<section class="section"><div class="wrap"><h2 class="section__title display">${esc(L.active)}</h2>${active.map((x) => campaignSpot(lang, x.c)).join('')}</div></section>
${closed.length ? `<section class="section theme-paper2"><div class="wrap"><h2 class="section__title display">${esc(L.closed)}</h2><ul class="past">${closed.map((x) => `<li class="past__item">${picture(x.e.image, x.e.image_alt, { cls: 'ph ph--bw', sizes: '(min-width: 900px) 30vw, 100vw' })}<div><p class="kicker">${t(x.e.name, lang)} · ${esc(L.closed)} ${x.e.sample ? sampleBadge(lang) : ''}</p><h3 class="display past__title"><a href="${urlFor('campaign', x.c, lang)}">${t(x.e.headline, lang)}</a></h3>${thermoBar(lang, x.e)}</div></li>`).join('')}</ul></div></section>` : ''}`;
  return { title: p.title, description: p.description, body, crumbs: crumbs(lang, { name: L.otherCampaigns, url: ROUTES.campaigns[lang] }) };
}

export function campaignPage(lang, D, c) {
  const e = pick(c, lang);
  const L = UI[lang];
  const url = urlFor('campaign', c, lang);
  const isActive = e.status === 'active';
  const others = D.campaigns.filter((x) => x !== c);
  const giftData = JSON.stringify({ lang, matching: !!(e.matching && e.matching.enabled), labels: { remove: L.remove, add: L.add, qty: L.qty, zeffyNote: typo(L.zeffyNote, lang) } }).replace(/</g, '\\u003c');
  const body = `<section class="camp-hero theme-ink" aria-labelledby="camp-title">
  <div class="wrap camp-hero__grid">
    <div class="camp-hero__text">
      <p class="kicker">${t(e.name, lang)} · ${esc(isActive ? L.active : L.closed)} ${e.sample ? sampleBadge(lang) : ''}</p>
      <p class="camp-hero__year display" aria-hidden="true">${lang === 'fr' ? 'Noël' : 'Xmas'}<span>${e.end.slice(0, 4)}</span></p>
      <h1 id="camp-title" class="camp-hero__title display reveal-lines">${t(e.headline, lang)}</h1>
      <p class="camp-hero__lede">${t(e.lede, lang)}</p>
      <p class="camp-hero__ctas">${isActive ? `<a class="btn btn--coral btn--lg" href="#catalogue">${lang === 'fr' ? 'Offrir un cadeau' : 'Give a gift'} ${icon('arrow')}</a> <a class="btn btn--ghost-light" href="${ROUTES.ambassadors[lang]}">${lang === 'fr' ? 'Collecter avec moi' : 'Fundraise with me'}</a>` : ''}</p>
    </div>
    <div class="camp-hero__meter">
      <div class="camp-meter">
        ${thermoVertical(lang, e)}
        <div class="camp-meter__fig">
          <p class="camp-meter__pct display">${num(Math.round(pct(e.raised, e.goal)), lang)}<span>%</span></p>
          ${thermoBar(lang, e, { big: true })}
        </div>
      </div>
      ${isActive ? countdown(lang, e.end) : `<p class="kicker">${esc(L.ended)}</p>`}
    </div>
  </div>
</section>
${e.matching && e.matching.enabled ? `<aside class="match theme-coral" aria-label="${esc(typo(e.matching.title, lang))}"><div class="wrap match__inner"><p class="match__x display" aria-hidden="true">×2</p><div><p class="match__title display">${t(e.matching.title, lang)}</p><p>${t(e.matching.text, lang)} ${sampleBadge(lang)}</p></div><a class="btn btn--ink" href="#catalogue">${esc(L.giveNow)} ${icon('arrow')}</a></div></aside>` : ''}
<section class="section" aria-labelledby="story-h">
  <div class="wrap camp-story">
    <figure class="camp-story__fig">${picture(e.image, e.image_alt, { cls: 'ph ph--duo ph--offset', sizes: '(min-width: 900px) 40vw, 100vw' })}</figure>
    <div class="prose dropcap"><h2 id="story-h" class="vh">${lang === 'fr' ? 'Le récit de la campagne' : 'The campaign story'}</h2>${md(e.story, lang)}</div>
  </div>
</section>
<section class="section theme-paper2 catalogue" id="catalogue" aria-labelledby="cat-h">
  <div class="wrap">
    <header class="section__head section__head--stack"><p class="kicker">${lang === 'fr' ? 'Choisissez ce que vous offrez' : 'Choose what you give'}</p><h2 id="cat-h" class="section__title display">${esc(L.catalogue)}</h2><p>${esc(L.indicative)} — ${sampleBadge(lang)}</p></header>
    <div class="catalogue__grid">
      <ul class="gifts">${e.gifts.map((g) => `<li class="gift" data-gift="${esc(g.id)}" data-price="${g.price}" data-name="${esc(typo(g.name, lang))}">
        <span class="gift__icon">${icon(g.icon, 'ico')}</span>
        <h3 class="gift__name display">${t(g.name, lang)}</h3>
        <p class="gift__price display">${t(money(g.price, lang), lang)}</p>
        <p class="gift__text">${t(g.text, lang)}</p>
        ${isActive ? `<button class="btn btn--ink btn--sm gift__add js-only" type="button" data-add aria-label="${esc(typo(`${L.add} : ${g.name}, ${money(g.price, lang)}`.replace(' :', colon(lang)), lang))}">+ ${esc(L.add)}</button>` : ''}
      </li>`).join('')}</ul>
      ${isActive ? `<aside class="basket js-only" aria-labelledby="basket-h" data-basket>
        <script type="application/json" id="gift-data">${giftData}</script>
        <h3 id="basket-h" class="display basket__title">${esc(L.basket)}</h3>
        <p class="basket__empty" data-empty>${t(L.basketEmpty, lang)}</p>
        <ul class="basket__list" data-list></ul>
        <p class="basket__total"><span>${esc(L.total)}</span> <output data-total>${t(money(0, lang), lang)}</output></p>
        ${e.matching && e.matching.enabled ? `<p class="basket__match">${esc(L.matched)}${colon(lang)} <output data-matched>${t(money(0, lang), lang)}</output></p>` : ''}
        <div class="field"><label for="honour">${esc(L.inHonour)}</label><input id="honour" name="honour" type="text" placeholder="${esc(typo(L.inHonourPh, lang))}" autocomplete="off"></div>
        <button class="btn btn--coral btn--block" type="button" data-zeffy disabled>${esc(L.zeffyBtn)} ${icon('arrow')}</button>
        <p class="basket__note" data-zeffy-note hidden role="status"></p>
        <p class="basket__alt"><a href="${ROUTES.give[lang]}">${lang === 'fr' ? 'Ou faire un don libre' : 'Or give any amount'}</a></p>
      </aside>
      <noscript><p class="notice">${lang === 'fr' ? 'Activez JavaScript pour composer votre sélection, ou ' : 'Turn on JavaScript to build your selection, or '}<a href="${ROUTES.give[lang]}">${lang === 'fr' ? 'faites un don libre' : 'give any amount'}</a>.</p></noscript>` : ''}
    </div>
  </div>
</section>
<section class="section" aria-labelledby="spread-h">
  <div class="wrap spread">
    <div><p class="kicker">${lang === 'fr' ? 'Sensibiliser' : 'Spread the word'}</p><h2 id="spread-h" class="section__title display">${lang === 'fr' ? 'Votre voix compte autant que votre don.' : 'Your voice matters as much as your gift.'}</h2>
    <p>${lang === 'fr' ? 'Partagez la campagne, créez une carte avec un verset ou lancez votre propre collecte.' : 'Share the campaign, make a verse card or start your own fundraiser.'}</p>
    <p><a class="btn btn--ink" href="${ROUTES.cards[lang]}">${icon('card')} ${t(L.nav.cards, lang)}</a> <a class="btn btn--ghost" href="${ROUTES.ambassadors[lang]}">${t(L.nav.ambassadors, lang)}</a></p></div>
    ${shareBar(lang, url, e.headline)}
  </div>
</section>
${others.length ? `<section class="section theme-paper2"><div class="wrap"><h2 class="section__title display">${esc(L.otherCampaigns)}</h2><ul class="past">${others.map((o) => { const x = pick(o, lang); return `<li class="past__item">${picture(x.image, x.image_alt, { cls: 'ph ph--bw', sizes: '(min-width: 900px) 30vw, 100vw' })}<div><p class="kicker">${t(x.name, lang)} · ${esc(x.status === 'active' ? L.active : L.closed)}</p><h3 class="display past__title"><a href="${urlFor('campaign', o, lang)}">${t(x.headline, lang)}</a></h3>${thermoBar(lang, x)}</div></li>`; }).join('')}</ul></div></section>` : ''}`;
  return {
    title: `${e.name} — ${e.headline}`, ogTitle: e.headline, description: e.description, body, scripts: isActive ? ['/assets/js/campaign.js'] : [],
    ogImage: e.og_image || e.image, bodyClass: 'page-campaign',
    crumbs: crumbs(lang, { name: L.otherCampaigns, url: ROUTES.campaigns[lang] }, { name: e.name, url }),
  };
}

export function ambassadors(lang, D) {
  const p = D.pages.ambassadors[lang];
  const L = UI[lang];
  const teams = [...p.teams].sort((a, b) => b.raised - a.raised);
  const active = D.campaigns.filter((c) => pick(c, lang).status === 'active');
  const body = `${pageHero(lang, { num: '06', kicker: p.kicker, heading: p.heading, lede: p.lede, extra: `<p><a class="btn btn--coral" href="#start">${esc(L.startPage)} ${icon('arrow')}</a></p>` })}
<section class="section theme-ink" aria-labelledby="steps-h">
  <div class="wrap">
    <h2 id="steps-h" class="section__title display">${lang === 'fr' ? 'Comment ça marche' : 'How it works'}</h2>
    <ol class="steps">${p.steps.map((s, i) => `<li class="reveal"><span class="steps__n display" aria-hidden="true">${i + 1}</span><p class="kicker">${esc(L.step)} ${i + 1}</p><h3 class="display steps__title">${t(s.title, lang)}</h3><p>${t(s.text, lang)}</p></li>`).join('')}</ol>
  </div>
</section>
<section class="section" aria-labelledby="lb-h">
  <div class="wrap">
    <header class="section__head"><h2 id="lb-h" class="section__title display">${esc(L.leaderboard)}</h2>${sampleBadge(lang)}</header>
    <table class="board">
      <caption class="vh">${esc(L.leaderboard)} — ${esc(L.sample)}</caption>
      <thead><tr><th scope="col">#</th><th scope="col">${esc(L.team)}</th><th scope="col">${esc(L.type)}</th><th scope="col">${esc(L.progress)}</th></tr></thead>
      <tbody>${teams.map((tm, i) => { const pc = pct(tm.raised, tm.goal); return `<tr><td class="board__rank display">${pad(i + 1)}</td><th scope="row" class="board__name">${inline(tm.name, lang)}</th><td class="board__type">${t(tm.type, lang)}</td><td class="board__prog"><svg viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true" focusable="false"><rect class="thermo__bg" width="100" height="6"/><rect class="thermo__fill" width="${pc}" height="6"/></svg><span>${t(money(tm.raised, lang), lang)} / ${t(money(tm.goal, lang), lang)} · ${Math.round(pc)}${lang === 'fr' ? ' ' : ''}%</span></td></tr>`; }).join('')}</tbody>
    </table>
  </div>
</section>
<section class="section theme-paper2" id="start" aria-labelledby="start-h">
  <div class="wrap amb-grid">
    <div>
      <h2 id="start-h" class="section__title display">${t(p.form_title, lang)}</h2>
      <p>${t(p.form_intro, lang)}</p>
      <h3 class="kicker">${esc(L.toolkit)}</h3>
      <ul class="checklist">${p.toolkit.map((x) => `<li>${t(x, lang)}</li>`).join('')}</ul>
    </div>
    <form class="form card-form" action="/api/ambassador" method="post" data-form data-thanks="${esc(typo(L.thanksAmb, lang))}">
      <!-- Turnstile: <div class="cf-turnstile" data-sitekey="TURNSTILE_SITE_KEY"></div> -->
      <div class="hp" aria-hidden="true"><label for="amb-website">${esc(L.honeypot)}</label><input id="amb-website" name="website" type="text" tabindex="-1" autocomplete="off"></div>
      <div class="field-row">
        <div class="field"><label for="amb-name">${esc(L.yourName)}</label><input id="amb-name" name="name" type="text" autocomplete="name" required></div>
        <div class="field"><label for="amb-email">${esc(L.email)}</label><input id="amb-email" name="email" type="email" autocomplete="email" required></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="amb-occ">${esc(L.occasion)}</label><select id="amb-occ" name="occasion" required>${L.occasions.map((o) => `<option>${t(o, lang)}</option>`).join('')}</select></div>
        <div class="field"><label for="amb-date">${lang === 'fr' ? 'Date de l’occasion (facultatif)' : 'Date of the occasion (optional)'}</label><input id="amb-date" name="date" type="date"></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="amb-goal">${esc(L.goalLabel)}</label><input id="amb-goal" name="goal" type="number" min="50" step="10" value="500" inputmode="numeric" required></div>
        <div class="field"><label for="amb-camp">${esc(L.campaignLabel)}</label><select id="amb-camp" name="campaign">${active.map((c) => `<option>${t(pick(c, lang).name, lang)}</option>`).join('')}<option>${lang === 'fr' ? 'La mission en général' : 'The mission in general'}</option></select></div>
      </div>
      <div class="field"><label for="amb-why">${esc(L.whyLabel)}</label><textarea id="amb-why" name="why" rows="4"></textarea></div>
      <label class="consent"><input type="checkbox" name="consent" required> <span>${lang === 'fr' ? 'J’accepte que La Paix du Cœur me contacte au sujet de ma page de collecte.' : 'I agree that La Paix du Cœur may contact me about my fundraising page.'}</span></label>
      <button class="btn btn--coral btn--block" type="submit">${esc(L.startPage)} ${icon('arrow')}</button>
      <p class="form__proto">${t(L.protoNote, lang)}</p>
    </form>
  </div>
</section>`;
  return { title: p.title, description: p.description, body, ogImage: lang === 'fr' ? '/assets/img/og-ambassadeurs.jpg' : '/assets/img/og-ambassadors.jpg', crumbs: crumbs(lang, { name: L.nav.ambassadors, url: ROUTES.ambassadors[lang] }) };
}

export function cards(lang, D) {
  const p = D.pages.cards[lang];
  const L = UI[lang];
  const data = JSON.stringify({ verses: p.verses.map((v) => ({ text: typo(v.text, lang), ref: typo(v.ref, lang) })), sig: L.cardSig, shareTitle: typo(p.heading, lang), lang }).replace(/</g, '\\u003c');
  const body = `${pageHero(lang, { num: '07', kicker: p.kicker, heading: p.heading, lede: p.lede })}
<section class="section" aria-labelledby="gen-h">
  <div class="wrap cardgen" data-cardgen>
    <script type="application/json" id="card-data">${data}</script>
    <form class="cardgen__controls" data-card-form>
      <h2 id="gen-h" class="vh">${lang === 'fr' ? 'Générateur de cartes' : 'Card generator'}</h2>
      <fieldset class="vchoice"><legend class="kicker">${esc(L.cardVerse)}</legend>
        ${p.verses.map((v, i) => `<label class="vchoice__opt"><input type="radio" name="verse" value="${i}"${i === 0 ? ' checked' : ''}><span><span class="vchoice__text">${t(v.text, lang)}</span><span class="vchoice__ref">${t(v.ref, lang)}</span></span></label>`).join('')}
        <label class="vchoice__opt"><input type="radio" name="verse" value="custom"><span><span class="vchoice__text">${esc(L.cardCustom)}</span></span></label>
        <div class="field"><label class="vh" for="card-custom">${esc(L.cardCustom)}</label><textarea id="card-custom" name="custom" rows="3" maxlength="140" placeholder="${esc(L.cardCustomPh)}"></textarea></div>
      </fieldset>
      <fieldset class="seg seg--3"><legend class="kicker">${esc(L.cardStyle)}</legend>${Object.entries(L.styles).map(([k, v], i) => `<label><input type="radio" name="style" value="${k}"${i === 0 ? ' checked' : ''}><span><i class="swatch swatch--${k}" aria-hidden="true"></i>${esc(v)}</span></label>`).join('')}</fieldset>
      <fieldset class="seg"><legend class="kicker">${esc(L.cardFormat)}</legend>${Object.entries(L.formats).map(([k, v], i) => `<label><input type="radio" name="format" value="${k}"${i === 0 ? ' checked' : ''}><span>${esc(v)}</span></label>`).join('')}</fieldset>
    </form>
    <div class="cardgen__preview">
      <canvas width="1080" height="1080" data-card-canvas role="img" aria-label="${esc(L.cardPreview)}">${esc(L.cardPreview)}</canvas>
      <p class="cardgen__actions"><button class="btn btn--coral" type="button" data-card-download>${icon('download')} ${esc(L.download)}</button> <button class="btn btn--ink" type="button" data-card-share hidden>${icon('share')} ${esc(L.shareCard)}</button></p>
      <p class="cardgen__status" data-card-status role="status"></p>
      <noscript><p class="notice">${lang === 'fr' ? 'Le générateur de cartes nécessite JavaScript.' : 'The card generator needs JavaScript.'}</p></noscript>
    </div>
  </div>
</section>`;
  return { title: p.title, description: p.description, body, scripts: ['/assets/js/cards.js'], crumbs: crumbs(lang, { name: L.nav.cards, url: ROUTES.cards[lang] }) };
}

export function press(lang, D) {
  const p = D.pages.press[lang];
  const L = UI[lang];
  const s = D.settings[lang];
  const boiler = (k, label, l2) => `<article class="boiler" lang="${l2}"><header><p class="kicker">${label}</p><button class="chip js-only" type="button" data-copy-from="${k}" data-copied="${esc(L.copied)}">${icon('copy')} <span>${esc(L.copy)}</span></button></header><p id="${k}">${t(p[k], l2)}</p></article>`;
  const photos = ['children-joy', 'food-bank-volunteers', 'bread-sharing', 'elders'];
  const body = `${pageHero(lang, { num: '12', kicker: p.kicker, heading: p.heading, lede: p.lede })}
<section class="section" aria-labelledby="bp-h"><div class="wrap">
  <h2 id="bp-h" class="section__title display">${esc(L.pressBoiler)}</h2>
  <div class="boilers">
    <div><h3 class="kicker boilers__lang">${esc(L.frenchLabel)}</h3>${boiler('boilerplate_short_fr', L.short, 'fr')}${boiler('boilerplate_long_fr', L.long, 'fr')}</div>
    <div><h3 class="kicker boilers__lang">${esc(L.englishLabel)}</h3>${boiler('boilerplate_short_en', L.short, 'en')}${boiler('boilerplate_long_en', L.long, 'en')}</div>
  </div>
</div></section>
<section class="section theme-paper2" aria-labelledby="kf-h"><div class="wrap press-grid">
  <div><h2 id="kf-h" class="section__title display">${esc(L.keyFacts)}</h2>
  <dl class="facts facts--table">${p.facts.map((f) => `<div><dt>${t(f.label, lang)}</dt><dd>${inline(f.value, lang)}</dd></div>`).join('')}</dl></div>
  <div><h2 class="section__title display">${esc(L.logos)}</h2>
    <ul class="logos">
      <li><img src="/assets/press/logo-couleur.png" alt="${lang === 'fr' ? 'Logo couleur : un cœur vert tenu par deux mains dans une couronne de feuilles' : 'Colour logo: a green heart held by two hands inside a leafy wreath'}" width="480" height="416" loading="lazy"><a class="chip" href="/assets/press/logo-couleur.png" download>${icon('download')} ${esc(L.logoColor)}</a></li>
      <li class="logos--ink"><img src="/assets/press/logo-ink.png" alt="${lang === 'fr' ? 'Logo noir sur fond clair' : 'Black logo on a light background'}" width="480" height="416" loading="lazy"><a class="chip" href="/assets/press/logo-ink.png" download>${icon('download')} ${esc(L.logoInk)}</a></li>
    </ul>
    <h2 class="section__title display">${esc(L.mediaContact)}</h2>
    <p class="press-contact"><a class="link-arrow" href="mailto:${esc(s.email)}?subject=${encodeURIComponent(lang === 'fr' ? 'Demande médias' : 'Media enquiry')}">${icon('mail')} ${esc(s.email)}</a><br>${lang === 'fr' ? 'Porte-parole' : 'Spokesperson'}${colon(lang)} <span class="tbc">${esc(L.tbc)}</span></p>
  </div>
</div></section>
<section class="section" aria-labelledby="pp-h"><div class="wrap">
  <h2 id="pp-h" class="section__title display">${esc(L.pressPhotos)}</h2>
  <ul class="press-photos">${photos.map((ph) => { const m = D.media.find((x) => x.id === `photo-${ph}`); const alt = m ? pick(m, lang).alt : ''; return `<li>${picture(`/assets/img/${ph}.jpg`, alt, { cls: 'ph ph--bw', sizes: '(min-width: 900px) 25vw, 50vw' })}<a class="chip" href="/assets/img/${ph}.jpg" download>${icon('download')} JPG</a></li>`; }).join('')}</ul>
  <p class="notice">${inline(p.photo_note, lang)}</p>
</div></section>`;
  return { title: p.title, description: p.description, body, crumbs: crumbs(lang, { name: L.nav.press, url: ROUTES.press[lang] }) };
}

export function contact(lang, D) {
  const p = D.pages.contact[lang];
  const L = UI[lang];
  const s = D.settings[lang];
  const body = `${pageHero(lang, { num: '13', kicker: p.kicker, heading: p.heading, lede: p.lede })}
<section class="section"><div class="wrap contact-grid">
  <form class="form card-form" action="/api/contact" method="post" data-form data-thanks="${esc(typo(L.thanksForm, lang))}">
    <h2 class="vh">${lang === 'fr' ? 'Formulaire de contact' : 'Contact form'}</h2>
    <!-- Turnstile: <div class="cf-turnstile" data-sitekey="TURNSTILE_SITE_KEY"></div> -->
    <div class="hp" aria-hidden="true"><label for="c-website">${esc(L.honeypot)}</label><input id="c-website" name="website" type="text" tabindex="-1" autocomplete="off"></div>
    <div class="field-row">
      <div class="field"><label for="c-name">${esc(L.yourName)}</label><input id="c-name" name="name" type="text" autocomplete="name" required></div>
      <div class="field"><label for="c-email">${esc(L.email)}</label><input id="c-email" name="email" type="email" autocomplete="email" required></div>
    </div>
    <div class="field"><label for="c-subject">${esc(L.subject)}</label><select id="c-subject" name="subject">${p.subjects.map((x) => `<option>${t(x, lang)}</option>`).join('')}</select></div>
    <div class="field"><label for="c-msg">${esc(L.message)}</label><textarea id="c-msg" name="message" rows="7" required></textarea></div>
    <button class="btn btn--coral" type="submit">${esc(L.send)} ${icon('arrow')}</button>
    <p class="form__proto">${t(L.protoNote, lang)}</p>
  </form>
  <aside class="contact-aside">
    <p class="kicker">${esc(L.email)}</p>
    <p class="contact-aside__email display"><a href="mailto:${esc(s.email)}">${esc(s.email).replace('@', '<wbr>@')}</a></p>
    <p>${t(p.note, lang)}</p>
    <p class="kicker">${esc(L.social)}</p>
    <ul class="plain">${(s.social || []).map((x) => `<li>${x.url ? `<a href="${esc(x.url)}" rel="noopener">${esc(x.name)}</a>` : `${esc(x.name)} <span class="tbc">${esc(L.tbc)}</span>`}</li>`).join('')}</ul>
    <p class="kicker">${esc(L.mediaContact)}</p>
    <p><a class="link-arrow" href="${ROUTES.press[lang]}">${esc(L.pressLink)} ${icon('arrow')}</a></p>
  </aside>
</div></section>`;
  return { title: p.title, description: p.description, body, pageType: 'ContactPage', crumbs: crumbs(lang, { name: L.nav.contact, url: ROUTES.contact[lang] }) };
}

export function privacy(lang, D) {
  const p = D.pages.privacy[lang];
  const L = UI[lang];
  const body = `${pageHero(lang, { num: '14', kicker: p.kicker, heading: p.heading, lede: p.lede })}
<section class="section"><div class="wrap"><div class="prose prose--legal">${md(p.body, lang)}</div></div></section>`;
  return { title: p.title, description: p.description, body, crumbs: crumbs(lang, { name: L.nav.privacy, url: ROUTES.privacy[lang] }) };
}
