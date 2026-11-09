import { ROUTES, TAGS, ui } from './i18n.mjs';
import { esc, txt, md, plain } from './md.mjs';
import { deckle, drawHeart, scribble, seal, fleuron, envelope, icon } from './svg.mjs';

export function views(C) {
  const { L, pageHead, pic, fmtDate, fmtTime, fmtDay, fmtMonth, site, data } = C;
  const R = (k, lang) => ROUTES[k][lang];
  const sampleBadge = (lang) => `<span class="badge-sample">${ui(lang).sample}</span>`;
  const other = (lang) => (lang === 'fr' ? 'en' : 'fr');

  function hlLast(title, n = 3) {
    const m = title.match(/^(.*?)([.!?…]*)$/);
    const words = m[1].split(' ');
    if (words.length <= n) return `${esc(title)}`;
    const head = words.slice(0, -n).join(' ');
    const tail = words.slice(-n).join(' ');
    return `${esc(head)} <span class="hl">${esc(tail)}${scribble()}</span>${esc(m[2])}`;
  }

  function verse(text, ref, cls = '') {
    return `<figure class="verse ${cls}" data-reveal>
${fleuron()}
<blockquote><p>${txt(text)}</p></blockquote>
<figcaption>${txt(ref)}</figcaption>
</figure>`;
  }

  function verseOfWeek(lang) {
    const t = ui(lang);
    const v = site[lang].verse_of_week;
    return `<aside class="vow" aria-labelledby="vow-h-${lang}" data-reveal>
${seal('vow__seal', 5)}
<p class="vow__label" id="vow-h-${lang}">${t.verse_week} <span>· ${esc(v.week_label)}</span></p>
<blockquote class="vow__text"><p>${txt(v.text)}</p></blockquote>
<p class="vow__ref">${txt(v.reference)}</p>
<p class="vow__reflection">${txt(v.reflection)}</p>
</aside>`;
  }

  // ---------- stories ----------
  function tagChips(lang, tags, link = true) {
    return `<ul class="tags">${tags.map((k) => `<li>${link ? `<a class="tag" href="${R('stories', lang)}?tag=${k}">${TAGS[k][lang]}</a>` : `<span class="tag">${TAGS[k][lang]}</span>`}</li>`).join('')}</ul>`;
  }

  function storyCard(lang, s, i = 0) {
    const t = ui(lang);
    return `<article class="story-card" data-tags="${s.tags.join(' ')}" data-reveal>
<a class="story-card__link" href="${s.url[lang]}">
<div class="story-card__img">${pic(s.image, s.image_alt, { sizes: '(min-width: 1000px) 30vw, (min-width: 640px) 45vw, 92vw' })}</div>
<div class="story-card__body">
<p class="story-card__meta">${s.tags.map((k) => TAGS[k][lang]).join(' · ')}</p>
<h3 class="story-card__title">${esc(s.title)}</h3>
<p class="story-card__dek">${esc(s.dek)}</p>
<p class="story-card__more"><span>${t.read_story}</span> ${icon('arrow')} <span class="story-card__mins">${t.minutes(s.reading_minutes)}</span></p>
</div>
</a>
${s.sample ? sampleBadge(lang) : ''}
</article>`;
  }

  function storiesHub(lang) {
    const t = ui(lang);
    const p = data.pages.stories[lang];
    const used = [...new Set(data.stories.flatMap((s) => s.l[lang].tags))];
    const filters = `<div class="filters" role="group" aria-label="${esc(p.filter_label)}" data-filters="stories">
<button type="button" class="chip" aria-pressed="true" data-filter="*">${t.all}</button>
${Object.keys(TAGS).filter((k) => used.includes(k)).map((k) => `<button type="button" class="chip" aria-pressed="false" data-filter="${k}">${TAGS[k][lang]}</button>`).join('')}
</div>`;
    const content = `${pageHead(lang, { kicker: p.kicker, title: p.title, lede: p.intro, crumbs: [{ name: p.kicker, url: R('stories', lang) }], seed: 4 })}
<section class="section">
<div class="wrap">
${filters}
<p class="filters__status sr-only" role="status" aria-live="polite" data-filter-status></p>
<div class="story-grid" data-filter-target>
${data.stories.map((s, i) => storyCard(lang, { ...s.l[lang], url: s.url }, i)).join('\n')}
</div>
<p class="note-line">${icon('pen')} <a href="${R('charter', lang)}">${t.charter}</a></p>
</div>
</section>`;
    return L.page({ lang, paths: ROUTES.stories, title: p.meta_title, description: p.meta_description, navKey: 'stories', crumbs: [{ name: p.kicker, url: R('stories', lang) }], content, image: '/assets/img/og-bread-sharing.jpg' });
  }

  function storyPage(lang, s) {
    const t = ui(lang);
    const d = s.l[lang];
    const hub = data.pages.stories[lang];
    const roman = ['I', 'II', 'III', 'IV', 'V', 'VI'];
    const chapters = d.chapters.map((c, i) => `<section class="chapter" aria-labelledby="ch-${i}">
<p class="chapter__num" aria-hidden="true">${roman[i]}</p>
<h2 id="ch-${i}"><span class="sr-only">${t.chapter} ${i + 1} : </span>${esc(c.heading)}</h2>
${md(c.body)}
</section>
${i === 0 && d.pullquote ? `<figure class="pullquote" data-reveal><blockquote><p>${txt(d.pullquote.text)}</p></blockquote><figcaption>— ${esc(d.pullquote.who)}</figcaption></figure>` : ''}`).join('\n');
    const more = data.stories.filter((x) => x !== s).slice(0, 3);
    const crumbs = [{ name: hub.kicker, url: R('stories', lang) }, { name: d.title, url: s.url[lang] }];
    const content = `<article class="story">
<header class="story__head">
<div class="wrap wrap--narrow">
<nav class="crumbs" aria-label="${t.breadcrumb}"><ol><li><a href="${R('home', lang)}">${t.home}</a></li><li><a href="${R('stories', lang)}">${esc(hub.kicker)}</a></li><li><span aria-current="page">${esc(d.title)}</span></li></ol></nav>
${tagChips(lang, d.tags)}
<h1 class="story__title">${esc(d.title)}</h1>
<p class="story__dek">${esc(d.dek)}</p>
<p class="story__meta"><span>${esc(d.narrator)}</span> · <time datetime="${d.date}">${fmtDate(d.date, lang)}</time> · ${t.minutes(d.reading_minutes)} ${d.sample ? sampleBadge(lang) : ''}</p>
</div>
</header>
<figure class="story__hero">
${pic(d.image, d.image_alt, { sizes: '(min-width: 1200px) 1100px, 100vw', eager: true })}
<figcaption class="wrap wrap--narrow">${t.illustrative}</figcaption>
</figure>
<div class="wrap wrap--narrow story__body">
${chapters}
${d.verse ? verse(d.verse.text, d.verse.reference) : ''}
<aside class="margin-card"><p class="margin-card__label">${t.consent}</p><p>${txt(d.consent_note)}</p><p><a href="${R('charter', lang)}">${t.charter}</a></p></aside>
</div>
</article>
<section class="section section--paper2 after-story">
${deckle('top', 17)}
<div class="wrap wrap--narrow after-story__inner">
${drawHeart('after-story__heart')}
<h2>${t.after_story_title}</h2>
<p>${t.after_story_text}</p>
<div class="btn-row">
<a class="btn btn--ink" href="${R('letters', lang)}">${icon('pen')}<span>${t.write_letter}</span></a>
<a class="btn btn--ghost" href="${R('prayer', lang)}">${icon('pray')}<span>${t.pray}</span></a>
<a class="btn btn--give" href="${R('give', lang)}">${icon('heart')}<span>${t.give}</span></a>
</div>
</div>
</section>
<section class="section">
<div class="wrap">
<h2 class="section__title">${t.more_stories}</h2>
<div class="story-grid">${more.map((x) => storyCard(lang, { ...x.l[lang], url: x.url })).join('')}</div>
</div>
</section>`;
    const jsonld = [{
      '@type': 'Article',
      headline: d.title,
      description: d.dek,
      datePublished: d.date,
      inLanguage: lang === 'fr' ? 'fr-CA' : 'en-CA',
      image: C.abs(d.image),
      author: { '@id': C.ORG_ID },
      publisher: { '@id': C.ORG_ID },
      mainEntityOfPage: C.abs(s.url[lang]),
    }];
    return L.page({ lang, paths: s.url, title: `${d.title} — ${hub.kicker} | La Paix du Cœur`, description: d.dek, navKey: 'stories', crumbs, content, jsonld, ogType: 'article', image: C.og(d.image), bodyClass: 'is-story' });
  }

  // ---------- podcast ----------
  function player(lang, ep, cls = '', label = '') {
    const t = ui(lang);
    const d = ep.l[lang];
    return `<div class="player ${cls}" data-player data-lang="${lang}">
<audio preload="metadata" controls src="${esc(d.audio)}"></audio>
<div class="player__ui" hidden>
<button class="player__play" type="button" aria-label="${t.play}" data-label-play="${t.play}" data-label-pause="${t.pause}">
<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false"><path class="i-play" d="M24 16l26 16-26 16z"/><path class="i-pause" d="M20 16h8v32h-8zM36 16h8v32h-8z"/></svg>
</button>
<div class="player__main">
<p class="player__now">${t.now_playing}</p>
<p class="player__title" data-player-title>${label ? esc(label) : `${t.ep_short} ${d.number} — ${esc(d.title)}`}</p>
<div class="player__track">
<span class="player__time" data-cur>0:00</span>
<input class="player__scrub" type="range" min="0" max="1000" step="1" value="0" aria-label="${t.seek}" aria-valuetext="0:00">
<span class="player__time" data-dur>${esc(d.duration)}</span>
</div>
</div>
<div class="player__tools">
<button type="button" class="player__tool" data-skip="-15" aria-label="${t.back15}">−15</button>
<button type="button" class="player__tool" data-skip="15" aria-label="${t.fwd15}">+15</button>
<button type="button" class="player__tool player__speed" data-speed aria-label="${t.speed}">1×</button>
</div>
</div>
<p class="player__note">${t.audio_sample}</p>
</div>`;
  }

  function episodeItem(lang, ep) {
    const t = ui(lang);
    const d = ep.l[lang];
    const fr = ep.l.fr, en = ep.l.en;
    const first = lang === 'fr' ? [['fr', fr, t.transcript_fr], ['en', en, t.transcript_en]] : [['en', en, t.transcript_en], ['fr', fr, t.transcript_fr]];
    return `<article class="episode" id="${esc(d.slug)}" data-reveal>
<div class="episode__num" aria-hidden="true"><span>${t.ep_short}</span>${String(d.number).padStart(2, '0')}</div>
<div class="episode__body">
<h3 class="episode__title">${esc(d.title)}</h3>
<p class="episode__meta"><time datetime="${d.date}">${fmtDate(d.date, lang)}</time> · ${esc(d.duration)} · ${t.guests} ${txt(d.guests)} ${d.sample ? sampleBadge(lang) : ''}</p>
<p>${txt(d.summary)}</p>
<button type="button" class="btn btn--small btn--ink" data-play data-src="${esc(d.audio)}" data-title="${esc(`${t.ep_short} ${d.number} — ${d.title}`)}">${icon('play')}<span>${t.listen}</span></button>
<details class="transcript">
<summary>${t.transcript}</summary>
<div class="transcript__cols">
${first.map(([lg, x, label]) => `<section lang="${lg}" class="transcript__col"><h4>${label}</h4>${md(x.transcript)}</section>`).join('')}
</div>
</details>
</div>
</article>`;
  }

  function podcastPage(lang) {
    const t = ui(lang);
    const p = data.pages.podcast[lang];
    const eps = data.episodes;
    const content = `${pageHead(lang, { kicker: p.kicker, title: p.title, lede: p.intro, crumbs: [{ name: p.title, url: R('podcast', lang) }], cls: 'page-head--podcast', seed: 6 })}
<section class="section">
<div class="wrap podcast">
<div class="podcast__player">
${player(lang, eps[0], 'player--large')}
<p class="podcast__listen">${txt(p.listen_on)}</p>
</div>
<div class="podcast__list">
<h2 class="section__title">${t.all_episodes}</h2>
${eps.map((e) => episodeItem(lang, e)).join('\n')}
</div>
</div>
</section>`;
    const jsonld = [{
      '@type': 'PodcastSeries',
      name: p.title,
      description: p.intro,
      inLanguage: ['fr-CA', 'en-CA'],
      url: C.abs(R('podcast', lang)),
      publisher: { '@id': C.ORG_ID },
    }];
    return L.page({ lang, paths: ROUTES.podcast, title: p.meta_title, description: p.meta_description, navKey: 'podcast', crumbs: [{ name: p.title, url: R('podcast', lang) }], content, jsonld, scripts: ['player'], image: '/assets/img/og-bible-study.jpg' });
  }

  // ---------- prayer wall ----------
  function note(lang, n, i) {
    const t = ui(lang);
    const kindLabel = n.kind === 'espoir' ? t.kind_espoir : t.kind_priere;
    return `<article class="note note--${n.kind} note--v${i % 5}" data-kind="${n.kind}" data-reveal>
${n.kind === 'espoir' ? `<span class="note__stamp" aria-hidden="true">${icon('heart')}</span>` : '<span class="note__tape" aria-hidden="true"></span>'}
<p class="note__kind">${kindLabel}</p>
<blockquote class="note__text" lang="${n.lang}"><p>${esc(n.text)}</p></blockquote>
<p class="note__sign">— ${n.author ? esc(n.author) : t.anonymous} · <time datetime="${n.date}">${fmtDate(n.date, lang, true)}</time></p>
<button type="button" class="pray-btn" data-pray="${esc(n.id)}" data-count="${n.prayed}" aria-pressed="false" data-label="${esc(t.prayed)}" data-aria="${esc(t.prayed_aria('{n}'))}" aria-label="${esc(t.prayed_aria(n.prayed))}">${icon('pray')}<span class="pray-btn__label">${t.prayed}</span><span class="pray-btn__count">${n.prayed}</span></button>
</article>`;
  }

  function wallForm(lang) {
    const t = ui(lang);
    const id = `pw-${lang}`;
    return `<form class="form card-letter" data-form action="#" method="post" novalidate aria-labelledby="${id}-h">
<h2 id="${id}-h" class="card-letter__h">${t.wall_post_title}</h2>
<!-- Turnstile widget placeholder: <div class="cf-turnstile" data-sitekey="[à confirmer]"></div> -->
<div class="hp" aria-hidden="true"><label for="${id}-website">${t.f_hp}</label><input id="${id}-website" name="website" type="text" tabindex="-1" autocomplete="off"></div>
<fieldset class="seg">
<legend>${t.f_kind}</legend>
<label><input type="radio" name="kind" value="priere" checked> <span>${t.kind_priere}</span></label>
<label><input type="radio" name="kind" value="espoir"> <span>${t.kind_espoir}</span></label>
</fieldset>
<div class="field">
<label for="${id}-name">${t.f_firstname} <span class="opt">(${t.f_optional})</span></label>
<input id="${id}-name" name="firstname" type="text" autocomplete="given-name" maxlength="40" data-anon-target>
</div>
<label class="check"><input type="checkbox" name="anonymous" data-anon> <span>${t.f_anon}</span></label>
<div class="field">
<label for="${id}-msg">${t.f_message} <span class="opt">(${t.f_required})</span></label>
<textarea id="${id}-msg" name="message" rows="6" maxlength="600" required data-count-target="${id}-count" aria-describedby="${id}-count"></textarea>
<p class="field__help" id="${id}-count"><span data-count>600</span> ${t.f_chars}</p>
</div>
<label class="check"><input type="checkbox" name="private"> <span>${t.f_private}</span></label>
<button class="btn btn--ink btn--block" type="submit">${icon('pray')}<span>${t.f_submit_wall}</span></button>
<p class="form__demo">${t.form_demo}</p>
<div class="form__success" role="status" hidden data-success tabindex="-1">${drawHeart()}<p class="form__success-h">${t.wall_success_title}</p><p>${t.wall_success}</p></div>
</form>`;
  }

  function prayerPage(lang) {
    const t = ui(lang);
    const p = data.pages.prayer[lang];
    const content = `${pageHead(lang, { kicker: p.kicker, title: p.title, lede: p.intro, crumbs: [{ name: p.kicker, url: R('prayer', lang) }], seed: 8 })}
<section class="section">
<div class="wrap wall">
<div class="wall__side">
${wallForm(lang)}
<aside class="moderation">${icon('heart')}<p>${txt(p.moderation)}</p></aside>
${verse(p.verse_text, p.verse_ref, 'verse--small')}
</div>
<div class="wall__board">
<div class="wall__bar">
<div class="filters" role="group" aria-label="${t.wall_filter}" data-filters="wall">
<button type="button" class="chip" aria-pressed="true" data-filter="*">${t.wall_all}</button>
<button type="button" class="chip" aria-pressed="false" data-filter="priere">${t.wall_prayers}</button>
<button type="button" class="chip" aria-pressed="false" data-filter="espoir">${t.wall_hope}</button>
</div>
<p class="wall__samples">${sampleBadge(lang)} ${t.wall_samples}</p>
</div>
<p class="sr-only" role="status" aria-live="polite" data-filter-status></p>
<div class="masonry" data-filter-target>
${data.prayers.map((n, i) => note(lang, n, i)).join('\n')}
</div>
</div>
</div>
</section>`;
    return L.page({ lang, paths: ROUTES.prayer, title: p.meta_title, description: p.meta_description, navKey: 'prayer', crumbs: [{ name: p.kicker, url: R('prayer', lang) }], content, bodyClass: 'is-wall' });
  }

  // ---------- letters ----------
  function lettersPage(lang) {
    const t = ui(lang);
    const p = data.pages.letters[lang];
    const id = `lt-${lang}`;
    const form = `<form class="form letter-form" data-form data-letter action="#" method="post" novalidate aria-label="${esc(p.title)}">
<!-- Turnstile widget placeholder: <div class="cf-turnstile" data-sitekey="[à confirmer]"></div> -->
<div class="hp" aria-hidden="true"><label for="${id}-website">${t.f_hp}</label><input id="${id}-website" name="website" type="text" tabindex="-1" autocomplete="off"></div>
<div class="letter-form__paper">
<div class="field-row">
<div class="field"><label for="${id}-to">${t.letter_to}</label><select id="${id}-to" name="recipient">${t.letter_to_opts.map((o) => `<option>${esc(o)}</option>`).join('')}</select></div>
<div class="field"><label for="${id}-lang">${t.letter_lang}</label><select id="${id}-lang" name="language">${t.letter_lang_opts.map((o, i) => `<option${(lang === 'fr' && i === 0) || (lang === 'en' && i === 1) ? ' selected' : ''}>${o}</option>`).join('')}</select></div>
</div>
<div class="field field--ruled">
<label for="${id}-body">${t.letter_body} <span class="opt">(${t.f_required})</span></label>
<textarea id="${id}-body" name="letter" rows="12" maxlength="2000" required placeholder="${esc(t.letter_placeholder)}" data-count-target="${id}-count" aria-describedby="${id}-count"></textarea>
<p class="field__help" id="${id}-count"><span data-count>2000</span> ${t.f_chars}</p>
</div>
<div class="field-row">
<div class="field"><label for="${id}-sign">${t.letter_sign}</label><input id="${id}-sign" name="signature" type="text" maxlength="40" autocomplete="given-name" class="input-sign"></div>
<div class="field"><label for="${id}-email">${t.f_email} <span class="opt">(${t.f_optional})</span></label><input id="${id}-email" name="email" type="email" autocomplete="email" aria-describedby="${id}-eh"><p class="field__help" id="${id}-eh">${t.letter_email_help}</p></div>
</div>
<label class="check"><input type="checkbox" name="consent" required> <span>${t.letter_consent}</span></label>
<button class="btn btn--seal" type="submit">${seal('btn-seal', 12)}<span>${t.letter_submit}</span></button>
<p class="form__demo">${t.form_demo}</p>
</div>
<div class="form__success letter-success" role="status" hidden data-success tabindex="-1">${envelope('letter-success__env')}<p class="form__success-h">${t.letter_success_title}</p><p>${t.letter_success}</p></div>
</form>`;
    const content = `${pageHead(lang, { kicker: p.kicker, title: p.title, lede: p.intro, crumbs: [{ name: p.kicker, url: R('letters', lang) }], seed: 9 })}
<section class="section">
<div class="wrap letters">
<div class="letters__aside">
<div class="rules" data-reveal>
<h2>${esc(p.rules_title)}</h2>
<ol>${p.rules.map((r) => `<li>${txt(r)}</li>`).join('')}</ol>
</div>
<div class="ideas margin-card" data-reveal>
<p class="margin-card__label">${esc(p.ideas_title)}</p>
<ul>${p.ideas.map((r) => `<li>${txt(r)}</li>`).join('')}</ul>
</div>
</div>
<div class="letters__desk">${form}</div>
</div>
</section>`;
    return L.page({ lang, paths: ROUTES.letters, title: p.meta_title, description: p.meta_description, crumbs: [{ name: p.kicker, url: R('letters', lang) }], content });
  }

  // ---------- charter ----------
  function charterPage(lang) {
    const t = ui(lang);
    const p = data.pages.charter[lang];
    const content = `${pageHead(lang, { kicker: p.kicker, title: p.title, lede: p.intro, crumbs: [{ name: t.charter, url: R('charter', lang) }], seed: 13 })}
<section class="section">
<div class="wrap wrap--narrow">
<div class="charter" data-reveal>
<ol class="charter__list">
${p.commitments.map((c, i) => `<li><span class="charter__n" aria-hidden="true">${i + 1}</span><div><h2>${esc(c.title)}</h2><p>${txt(c.text)}</p></div></li>`).join('\n')}
</ol>
<div class="charter__sign">
${seal('charter__seal', 21)}
<p><span class="charter__script">La Paix du Cœur</span><br>Montréal · 2026</p>
</div>
</div>
<p class="note-line">${icon('mail')} ${txt(p.contact)} <a href="mailto:${site.fr.email}">${site.fr.email}</a></p>
</div>
</section>`;
    return L.page({ lang, paths: ROUTES.charter, title: p.meta_title, description: p.meta_description, crumbs: [{ name: t.charter, url: R('charter', lang) }], content });
  }

  // ---------- news ----------
  function newsCard(lang, n) {
    const t = ui(lang);
    const d = n.l[lang];
    return `<article class="news-card" data-reveal>
<a href="${n.url[lang]}" class="news-card__link">
<div class="news-card__img">${pic(d.image, d.image_alt, { sizes: '(min-width: 900px) 30vw, 92vw' })}</div>
<p class="news-card__date"><time datetime="${d.date}">${fmtDate(d.date, lang)}</time></p>
<h3 class="news-card__title">${esc(d.title)}</h3>
<p>${txt(d.summary)}</p>
<p class="news-card__more">${t.read_more} ${icon('arrow')}</p>
</a>
${d.sample ? sampleBadge(lang) : ''}
</article>`;
  }

  function newsList(lang) {
    const t = ui(lang);
    const p = data.pages.news[lang];
    const content = `${pageHead(lang, { kicker: p.kicker, title: p.title, lede: p.intro, crumbs: [{ name: p.kicker, url: R('news', lang) }], seed: 14 })}
<section class="section"><div class="wrap">
<div class="news-grid">${data.news.map((n) => newsCard(lang, n)).join('\n')}</div>
<p class="note-line">${icon('mail')} <a href="${lang === 'fr' ? '/fr/nouvelles/rss.xml' : '/en/news/rss.xml'}">${t.rss}</a></p>
</div></section>`;
    return L.page({ lang, paths: ROUTES.news, title: p.meta_title, description: p.meta_description, crumbs: [{ name: p.kicker, url: R('news', lang) }], content });
  }

  function newsPage(lang, n) {
    const t = ui(lang);
    const d = n.l[lang];
    const p = data.pages.news[lang];
    const crumbs = [{ name: p.kicker, url: R('news', lang) }, { name: d.title, url: n.url[lang] }];
    const content = `<article class="article">
${pageHead(lang, { title: d.title, lede: d.summary, crumbs, seed: 15, cls: 'page-head--article', extra: `<p class="article__meta">${t.published} <time datetime="${d.date}">${fmtDate(d.date, lang)}</time> ${d.sample ? sampleBadge(lang) : ''}</p>` })}
<div class="wrap wrap--narrow article__body">
<figure class="article__fig">${pic(d.image, d.image_alt, { sizes: '(min-width: 760px) 720px, 92vw', eager: true })}<figcaption>${t.illustrative}</figcaption></figure>
<div class="prose dropcap">${md(d.body)}</div>
<p class="note-line"><a href="${R('news', lang)}">← ${t.all_news}</a></p>
</div>
</article>`;
    const jsonld = [{
      '@type': 'NewsArticle',
      headline: d.title,
      description: d.summary,
      datePublished: `${d.date}T09:00:00-04:00`,
      dateModified: `${d.date}T09:00:00-04:00`,
      inLanguage: lang === 'fr' ? 'fr-CA' : 'en-CA',
      image: [C.abs(d.image)],
      author: { '@id': C.ORG_ID },
      publisher: { '@id': C.ORG_ID },
      mainEntityOfPage: C.abs(n.url[lang]),
    }];
    return L.page({ lang, paths: n.url, title: `${d.title} | La Paix du Cœur`, description: d.summary, crumbs, content, jsonld, ogType: 'article', image: C.og(d.image) });
  }

  // ---------- events ----------
  function eventLd(lang, e) {
    const d = e.l[lang];
    return {
      '@type': 'Event',
      name: d.title,
      description: plain(d.summary),
      startDate: C.isoLocal(d.start),
      endDate: C.isoLocal(d.end),
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      isAccessibleForFree: true,
      inLanguage: lang === 'fr' ? 'fr-CA' : 'en-CA',
      image: [C.abs(d.image)],
      url: C.abs(e.url[lang]),
      location: { '@type': 'Place', name: d.location, address: { '@type': 'PostalAddress', addressLocality: d.locality || 'Montréal', addressRegion: 'QC', addressCountry: 'CA' } },
      organizer: { '@id': C.ORG_ID },
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'CAD', availability: 'https://schema.org/InStock', url: C.abs(e.url[lang]) },
    };
  }

  function calLinks(lang, e) {
    const t = ui(lang);
    return `<a class="btn btn--small btn--ghost" href="${e.ics}" download>${icon('calendar')}<span>${t.add_cal}</span></a>
<a class="btn btn--small btn--ghost" href="${esc(C.gcal(lang, e))}" rel="noopener" target="_blank">${t.google_cal}</a>`;
  }

  function eventCard(lang, e, compact = false) {
    const t = ui(lang);
    const d = e.l[lang];
    return `<article class="event-card${compact ? ' event-card--compact' : ''}" data-reveal>
<div class="event-card__date" aria-hidden="true"><span class="event-card__day">${fmtDay(d.start)}</span><span class="event-card__month">${fmtMonth(d.start, lang)}</span></div>
<div class="event-card__body">
<h3 class="event-card__title"><a href="${e.url[lang]}">${esc(d.title)}</a></h3>
<p class="event-card__meta">${icon('clock')} <time datetime="${C.isoLocal(d.start)}">${fmtDate(d.start.slice(0, 10), lang)}, ${fmtTime(d.start, lang)}–${fmtTime(d.end, lang)}</time></p>
<p class="event-card__meta">${icon('pin')} ${txt(d.location)}</p>
${compact ? '' : `<p>${txt(d.summary)}</p><div class="btn-row">${calLinks(lang, e)}</div>`}
${d.sample ? sampleBadge(lang) : ''}
</div>
</article>`;
  }

  function eventsList(lang) {
    const p = data.pages.events[lang];
    const content = `${pageHead(lang, { kicker: p.kicker, title: p.title, lede: p.intro, crumbs: [{ name: p.kicker, url: R('events', lang) }], seed: 16 })}
<section class="section"><div class="wrap wrap--mid">
<div class="event-list">${data.events.length ? data.events.map((e) => eventCard(lang, e)).join('\n') : `<p>${esc(p.empty)}</p>`}</div>
</div></section>`;
    return L.page({ lang, paths: ROUTES.events, title: p.meta_title, description: p.meta_description, navKey: 'events', crumbs: [{ name: p.kicker, url: R('events', lang) }], content, jsonld: data.events.map((e) => eventLd(lang, e)), image: '/assets/img/og-food-bank-volunteers.jpg' });
  }

  function eventPage(lang, e) {
    const t = ui(lang);
    const d = e.l[lang];
    const p = data.pages.events[lang];
    const crumbs = [{ name: p.kicker, url: R('events', lang) }, { name: d.title, url: e.url[lang] }];
    const content = `${pageHead(lang, { kicker: p.kicker, title: d.title, lede: d.summary, crumbs, seed: 18, extra: d.sample ? sampleBadge(lang) : '' })}
<section class="section"><div class="wrap event-detail">
<div class="prose">
<figure class="article__fig">${pic(d.image, d.image_alt, { sizes: '(min-width: 900px) 600px, 92vw', eager: true })}</figure>
${md(d.body)}
</div>
<aside class="invite" data-reveal>
${seal('invite__seal', 27)}
<dl>
<dt>${t.event_when}</dt><dd><time datetime="${C.isoLocal(d.start)}">${fmtDate(d.start.slice(0, 10), lang)}</time><br>${fmtTime(d.start, lang)} – ${fmtTime(d.end, lang)}</dd>
<dt>${t.event_where}</dt><dd>${txt(d.location)}</dd>
</dl>
<div class="btn-stack">
<button type="button" class="btn btn--ink btn--block" data-demo-notice="${esc(t.register_note)}">${t.register}</button>
${calLinks(lang, e)}
</div>
<p class="invite__note" role="status" data-demo-out></p>
<p><a href="${R('events', lang)}">← ${t.all_events}</a></p>
</aside>
</div></section>`;
    return L.page({ lang, paths: e.url, title: `${d.title} | La Paix du Cœur`, description: plain(d.summary), crumbs, content, jsonld: [eventLd(lang, e)], image: C.og(d.image), navKey: 'events' });
  }

  // ---------- media ----------
  function ytFacade(lang, m) {
    const t = ui(lang);
    const d = m.l[lang];
    return `<figure class="video" data-reveal>
<div class="yt" data-yt="${esc(d.youtube_id)}" data-yt-title="${esc(d.title)}">
${pic(d.image, d.alt, { sizes: '(min-width: 900px) 45vw, 92vw' })}
<button type="button" class="yt__btn" aria-label="${esc(`${t.play_video} : ${d.title}`)}">${icon('play')}</button>
</div>
<figcaption><strong>${esc(d.title)}</strong> ${d.sample ? sampleBadge(lang) : ''}<br><span class="muted">${txt(d.caption)} ${t.video_note}</span></figcaption>
</figure>`;
  }

  function mediaPage(lang) {
    const t = ui(lang);
    const p = data.pages.media[lang];
    const photos = data.media.filter((m) => m.l.fr.type === 'photo');
    const videos = data.media.filter((m) => m.l.fr.type === 'video');
    const audios = data.media.filter((m) => m.l.fr.type === 'audio');
    const content = `${pageHead(lang, { kicker: p.kicker, title: p.title, lede: p.intro, crumbs: [{ name: p.kicker, url: R('media', lang) }], seed: 19 })}
<section class="section"><div class="wrap">
<h2 class="section__title">${esc(p.videos_title)}</h2>
<div class="video-grid">${videos.map((m) => ytFacade(lang, m)).join('')}</div>
</div></section>
<section class="section section--tight"><div class="wrap">
<h2 class="section__title">${esc(p.photos_title)} ${sampleBadge(lang)}</h2>
<ul class="gallery">
${photos.map((m, i) => { const d = m.l[lang]; return `<li class="gallery__item gallery__item--${i % 4}"><a class="gallery__link" href="${esc(d.image)}" data-lightbox data-caption="${esc(d.title)}" aria-label="${esc(`${t.open_photo} : ${d.title}`)}">${pic(d.image, d.alt, { sizes: '(min-width: 900px) 25vw, 46vw' })}</a><p class="gallery__cap">${esc(d.title)}</p></li>`; }).join('\n')}
</ul>
</div></section>
<section class="section section--tight"><div class="wrap wrap--mid">
<h2 class="section__title">${esc(p.audio_title)}</h2>
${audios.map((m) => { const d = m.l[lang]; const ep = data.episodes.find((e) => e.l.fr.audio === d.audio) || { l: { [lang]: { audio: d.audio, duration: '0:00' } } }; return `<div class="audio-item"><p><strong>${esc(d.title)}</strong> ${d.sample ? sampleBadge(lang) : ''}</p>${player(lang, ep, '', d.title)}<p class="muted">${txt(d.caption)} <a href="${R('podcast', lang)}">${t.nav.podcast} →</a></p></div>`; }).join('')}
</div></section>
<dialog class="lightbox" data-lightbox-dialog aria-label="${t.open_photo}">
<button type="button" class="lightbox__close" data-close aria-label="${t.lightbox_close}">×</button>
<img alt="" data-lightbox-img src="/assets/img/logo-160.png" width="160" height="139">
<p class="lightbox__cap" data-lightbox-cap></p>
</dialog>`;
    return L.page({ lang, paths: ROUTES.media, title: p.meta_title, description: p.meta_description, crumbs: [{ name: p.kicker, url: R('media', lang) }], content, scripts: ['player'], image: '/assets/img/og-elders.jpg' });
  }

  // ---------- give ----------
  function givePage(lang) {
    const t = ui(lang);
    const p = data.pages.give[lang];
    const email = site.fr.interac_email;
    const amounts = p.amounts.map((a, i) => `<label class="amount"><input type="radio" name="amount" value="${a.amount}"${i === 1 ? ' checked' : ''}><span class="amount__box"><span class="amount__n">${lang === 'fr' ? `${a.amount}&nbsp;$` : `$${a.amount}`}</span><span class="amount__t">${esc(a.text)}</span></span></label>`).join('');
    const content = `${pageHead(lang, { kicker: p.kicker, title: p.title, lede: p.intro, crumbs: [{ name: p.kicker, url: R('give', lang) }], seed: 22 })}
<section class="section"><div class="wrap give">
<form class="give__card card-letter" data-give action="#" method="post" novalidate aria-labelledby="give-h">
<h2 id="give-h" class="card-letter__h">${t.give_online}</h2>
<div class="seg seg--toggle" role="radiogroup" aria-label="${t.give_once} / ${t.give_monthly}">
<label><input type="radio" name="freq" value="once" checked> <span>${t.give_once}</span></label>
<label><input type="radio" name="freq" value="monthly"> <span>${t.give_monthly}</span></label>
</div>
<fieldset class="amounts"><legend>${t.give_amount}</legend>${amounts}</fieldset>
<div class="field"><label for="give-other">${t.give_other} (CAD)</label><input id="give-other" name="other" type="number" min="5" step="1" inputmode="numeric"></div>
<p class="muted small">${txt(p.amounts_note)}</p>
<button class="btn btn--give btn--block btn--lg" type="submit" data-give-btn data-label-once="${esc(t.give_btn('{a}', false))}" data-label-monthly="${esc(t.give_btn('{a}', true))}">${icon('heart')}<span>${t.give_btn(50, false)}</span></button>
<p class="give__zeffy">${txt(p.zeffy_note)}</p>
<p class="form__success" role="status" hidden data-success>${t.give_demo}</p>
<p class="muted small">${txt(p.receipt_note)}</p>
</form>
<div class="give__side">
<div class="paper-card" data-reveal>
<h2>${icon('mail')} ${esc(p.interac_title)}</h2>
<p>${txt(p.interac_text)}</p>
<p class="copy-row"><code data-copy-src>${email}</code> <button type="button" class="btn btn--small btn--ghost" data-copy data-copied="${t.copied}">${icon('copy')}<span>${t.copy}</span></button></p>
</div>
<div class="paper-card" data-reveal>
<h2>${esc(p.bank_title)}</h2>
<p>${txt(p.bank_text)}</p>
<p><a href="mailto:${email}">${email}</a></p>
</div>
${verse(lang === 'fr' ? 'Celui qui a pitié du pauvre prête à YHWH, qui lui rendra son bienfait.' : 'Whoever is kind to the poor lends to YHWH, and he will repay him for his deed.', lang === 'fr' ? 'Proverbes 19:17' : 'Proverbs 19:17', 'verse--small')}
</div>
</div></section>
<section class="section section--paper2">
${deckle('top', 23)}
<div class="wrap">
<h2 class="section__title">${esc(p.other_title)}</h2>
<div class="ways">${p.other.map((o, i) => `<a class="way" href="${R(o.link, lang)}" data-reveal>${icon(['pray', 'pen', 'hands', 'coat'][i])}<h3>${esc(o.title)}</h3><p>${txt(o.text)}</p></a>`).join('')}</div>
</div>
${deckle('bottom', 24)}
</section>`;
    return L.page({ lang, paths: ROUTES.give, title: p.meta_title, description: p.meta_description, navKey: 'give', crumbs: [{ name: p.kicker, url: R('give', lang) }], content, image: '/assets/img/og-bread-sharing.jpg' });
  }

  // ---------- contact ----------
  function contactPage(lang) {
    const t = ui(lang);
    const p = data.pages.contact[lang];
    const id = `ct-${lang}`;
    const email = site.fr.email;
    const content = `${pageHead(lang, { kicker: p.kicker, title: p.title, lede: p.intro, crumbs: [{ name: p.kicker, url: R('contact', lang) }], seed: 25 })}
<section class="section"><div class="wrap contact">
<form class="form card-letter" data-form action="#" method="post" novalidate aria-label="${esc(p.title)}">
<!-- Turnstile widget placeholder: <div class="cf-turnstile" data-sitekey="[à confirmer]"></div> -->
<div class="hp" aria-hidden="true"><label for="${id}-website">${t.f_hp}</label><input id="${id}-website" name="website" type="text" tabindex="-1" autocomplete="off"></div>
<div class="field-row">
<div class="field"><label for="${id}-name">${t.f_name} <span class="opt">(${t.f_required})</span></label><input id="${id}-name" name="name" type="text" required autocomplete="name"></div>
<div class="field"><label for="${id}-email">${t.f_email} <span class="opt">(${t.f_required})</span></label><input id="${id}-email" name="email" type="email" required autocomplete="email"></div>
</div>
<div class="field"><label for="${id}-subject">${t.f_subject}</label><select id="${id}-subject" name="subject">${t.contact_subject_opts.map((o) => `<option>${esc(o)}</option>`).join('')}</select></div>
<div class="field"><label for="${id}-msg">${t.f_message} <span class="opt">(${t.f_required})</span></label><textarea id="${id}-msg" name="message" rows="7" required maxlength="3000"></textarea></div>
<label class="check"><input type="checkbox" name="consent" required> <span>${t.contact_consent} <a href="${R('privacy', lang)}">${t.privacy}</a></span></label>
<button class="btn btn--ink" type="submit">${icon('mail')}<span>${t.contact_submit}</span></button>
<p class="form__demo">${t.form_demo}</p>
<div class="form__success" role="status" hidden data-success tabindex="-1">${drawHeart()}<p class="form__success-h">${t.contact_success_title}</p><p>${t.contact_success}</p></div>
</form>
<aside class="contact__side">
<div class="paper-card envelope-card" data-reveal>
${envelope('contact__env')}
<dl class="contact__dl">
<dt>${esc(p.email_label)}</dt><dd><a href="mailto:${email}">${email}</a></dd>
<dt>${esc(p.address_label)}</dt><dd>${txt(p.address)}</dd>
<dt>${esc(p.phone_label)}</dt><dd>${txt(p.phone)}</dd>
<dt>${t.footer_social}</dt><dd>${(site.fr.social || []).map((s) => esc(s.name)).join(', ')} <span class="tbc">${t.tbc}</span></dd>
</dl>
</div>
${verseOfWeek(lang)}
</aside>
</div></section>`;
    return L.page({ lang, paths: ROUTES.contact, title: p.meta_title, description: p.meta_description, crumbs: [{ name: p.kicker, url: R('contact', lang) }], content });
  }

  // ---------- simple text pages ----------
  function privacyPage(lang) {
    const p = data.pages.privacy[lang];
    const content = `${pageHead(lang, { kicker: p.kicker, title: p.title, lede: p.intro, crumbs: [{ name: p.kicker, url: R('privacy', lang) }], seed: 26 })}
<section class="section"><div class="wrap wrap--narrow prose">${md(p.body)}</div></section>`;
    return L.page({ lang, paths: ROUTES.privacy, title: p.meta_title, description: p.meta_description, crumbs: [{ name: p.kicker, url: R('privacy', lang) }], content });
  }

  function aboutPage(lang) {
    const t = ui(lang);
    const p = data.pages.about[lang];
    const content = `${pageHead(lang, { kicker: p.kicker, title: p.title, lede: p.intro, crumbs: [{ name: p.kicker, url: R('about', lang) }], seed: 28 })}
<section class="section"><div class="wrap about">
<div class="about__text prose">
<h2>${esc(p.story_title)}</h2>
<div class="dropcap">${md(p.story)}</div>
<h2>${esc(p.mission_title)}</h2>
<blockquote class="mission-quote"><p>${txt(p.mission)}</p></blockquote>
</div>
<aside class="about__side">
<figure class="polaroid polaroid--tilt-r" data-reveal><span class="tape" aria-hidden="true"></span>${pic('/assets/img/bible-study.jpg', lang === 'fr' ? 'Un groupe réuni autour d’une Bible ouverte.' : 'A group gathered around an open Bible.', { sizes: '(min-width: 900px) 30vw, 88vw' })}<figcaption class="margin-note">${t.illustrative}</figcaption></figure>
<div class="paper-card" data-reveal>
<h2>${esc(p.facts_title)}</h2>
<dl class="facts">${p.facts.map((f) => `<dt>${esc(f.label)}</dt><dd>${txt(f.value)}</dd>`).join('')}</dl>
</div>
</aside>
</div></section>
<section class="section section--paper2">
${deckle('top', 29)}
<div class="wrap">
<h2 class="section__title">${esc(p.values_title)}</h2>
<div class="values">${p.values.map((v, i) => `<div class="value" data-reveal><span class="value__n" aria-hidden="true">${['I', 'II', 'III', 'IV'][i]}</span><h3>${esc(v.title)}</h3><p>${txt(v.text)}</p></div>`).join('')}</div>
</div>
${deckle('bottom', 30)}
</section>
<section class="section"><div class="wrap wrap--narrow">
<h2 class="section__title">${esc(p.team_title)}</h2>
<div class="prose">${md(p.team_text)}</div>
${verse(lang === 'fr' ? 'La religion pure et sans souillure devant notre Elohîm et Père, c’est de visiter les orphelins et les veuves dans leurs tribulations…' : 'Religion that is pure and undefiled before our Elohim and Father is this: to visit orphans and widows in their affliction…', lang === 'fr' ? 'Yaacov (Jacques) 1:27' : 'James 1:27')}
</div></section>`;
    return L.page({ lang, paths: ROUTES.about, title: p.meta_title, description: p.meta_description, navKey: 'about', crumbs: [{ name: p.kicker, url: R('about', lang) }], content, image: '/assets/img/og-bible-study.jpg' });
  }

  function areasBlock(lang, areas) {
    const icons = ['bread', 'coat', 'book', 'hands'];
    return `<div class="areas">${areas.map((a, i) => `<div class="area" data-reveal>${icon(a.icon || icons[i], 'area__icon')}<h3>${esc(a.title)}</h3><p>${txt(a.text)}</p></div>`).join('')}</div>`;
  }

  function missionsPage(lang) {
    const t = ui(lang);
    const p = data.pages.missions[lang];
    const content = `${pageHead(lang, { kicker: p.kicker, title: p.title, lede: p.intro, crumbs: [{ name: p.kicker, url: R('missions', lang) }], seed: 32 })}
<section class="section"><div class="wrap">
<h2 class="section__title">${esc(p.programs_title)}</h2>
<div class="programs">${p.programs.map((g, i) => `<article class="program" data-reveal><div class="program__img">${pic(g.image, g.image_alt, { sizes: '(min-width: 900px) 30vw, 92vw' })}</div><p class="program__n">${String(i + 1).padStart(2, '0')}</p><h3>${esc(g.title)}</h3><p>${txt(g.text)}</p></article>`).join('')}</div>
</div></section>
<section class="section section--paper2">
${deckle('top', 33)}
<div class="wrap">
<h2 class="section__title">${esc(p.areas_title)}</h2>
${areasBlock(lang, p.areas)}
</div>
${deckle('bottom', 34)}
</section>
<section class="section"><div class="wrap fieldwork">
<h2 class="section__title">${esc(p.actions_title)}</h2>
<div class="fieldwork__grid">
${p.actions.map((a, i) => `<div class="paper-card" data-reveal>${icon(i ? 'heart' : 'bread')}<h3>${esc(a.title)}</h3><p>${txt(a.text)}</p></div>`).join('')}
<figure class="polaroid polaroid--tilt-l" data-reveal><span class="tape" aria-hidden="true"></span>${pic('/assets/img/bread-sharing.jpg', lang === 'fr' ? 'Des mains tendent une corbeille de petits pains.' : 'Hands holding out a basket of bread rolls.', { sizes: '(min-width: 900px) 30vw, 88vw' })}<figcaption class="margin-note">${t.illustrative}</figcaption></figure>
</div>
<div class="need" data-reveal><h2>${esc(p.need_title)}</h2><p>${txt(p.need_text)}</p><a class="btn btn--ink" href="${R('contact', lang)}">${icon('mail')}<span>${t.footer_contact}</span></a></div>
</div></section>`;
    return L.page({ lang, paths: ROUTES.missions, title: p.meta_title, description: p.meta_description, navKey: 'missions', crumbs: [{ name: p.kicker, url: R('missions', lang) }], content, image: '/assets/img/og-food-bank-volunteers.jpg' });
  }

  // ---------- home ----------
  function homePage(lang) {
    const t = ui(lang);
    const p = data.pages.home[lang];
    const s = { ...site.fr, ...site[lang] };
    const ep = data.episodes[0];
    const epD = ep.l[lang];
    const ps = lang === 'fr'
      ? ['«&nbsp;Défendez le faible et l’orphelin, rendez justice à l’affligé et au pauvre.&nbsp;»', 'Tehilim (Psaumes) 82:3']
      : ['“Defend the weak and the fatherless; uphold the cause of the poor and the oppressed.”', 'Tehilim (Psalms) 82:3'];
    const content = `<section class="hero">
<div class="wrap hero__grid">
<article class="letter hero__letter">
<p class="letter__dateline">${esc(p.dateline)}</p>
<p class="letter__salutation">${esc(p.salutation)}</p>
<h1 class="hero__title">${hlLast(p.title, 3)}</h1>
<div class="letter__body">${md(p.letter)}</div>
<div class="btn-row hero__ctas">
<a class="btn btn--ink" href="${R('stories', lang)}">${icon('pen')}<span>${esc(p.cta_primary)}</span></a>
<a class="btn btn--give" href="${R('give', lang)}">${icon('heart')}<span>${esc(p.cta_secondary)}</span></a>
</div>
<p class="letter__sign">${esc(s.signature)} ${drawHeart('draw-heart--sign')}</p>
<div class="letter__ps"><span class="letter__ps-label">${lang === 'fr' ? 'P.-S.' : 'P.S.'}</span><p class="letter__ps-text"><em>${ps[0]}</em> <span class="letter__ps-ref">— ${ps[1]}</span></p></div>
</article>
<div class="hero__side">
<p class="hero__note" aria-hidden="true"><strong>Kimia na motema</strong> — ${lang === 'fr' ? 'la paix du cœur, en lingala.' : 'peace of the heart, in Lingala.'}<svg viewBox="0 0 60 40"><path d="M10 4 C 20 20, 34 26, 48 30 M40 22 L48 30 L38 34"/></svg></p>
<figure class="polaroid hero__photo">
<span class="tape" aria-hidden="true"></span>
${pic('/assets/img/children-joy.jpg', lang === 'fr' ? 'Un groupe d’enfants sourit à l’objectif dans une rue ensoleillée.' : 'A group of children smile at the camera on a sunny street.', { sizes: '(min-width: 1000px) 40vw, 90vw', eager: true })}
<figcaption class="margin-note">${esc(p.photo_note)}</figcaption>
</figure>
</div>
${seal('hero__seal', 41)}
</div>
</section>

<section class="section section--stories">
<div class="wrap">
<header class="section-head">
<p class="kicker">${esc(p.stories_kicker)}</p>
<h2 class="section__title">${esc(p.stories_title)}</h2>
<p class="section-head__intro">${esc(p.stories_intro)}</p>
</header>
<div class="story-grid story-grid--home">
${data.stories.slice(0, 3).map((x) => storyCard(lang, { ...x.l[lang], url: x.url })).join('\n')}
</div>
<p class="center"><a class="link-arrow" href="${R('stories', lang)}">${t.all_stories} ${icon('arrow')}</a></p>
</div>
</section>

<section class="section section--paper2 section--vow">
${deckle('top', 42)}
<div class="wrap wrap--mid">${verseOfWeek(lang)}</div>
${deckle('bottom', 43)}
</section>

<section class="section">
<div class="wrap duo">
<div class="duo__podcast">
<p class="kicker">${esc(p.podcast_kicker)}</p>
<h2 class="section__title">${esc(p.podcast_title)}</h2>
<p>${esc(p.podcast_intro)}</p>
${player(lang, ep)}
<ul class="ep-lines">${data.episodes.map((e) => { const x = e.l[lang]; return `<li><span class="ep-lines__n" aria-hidden="true">${String(x.number).padStart(2, '0')}</span><span><a href="${R('podcast', lang)}#${esc(x.slug)}">${esc(x.title)}</a><small>${fmtDate(x.date, lang)} · ${esc(x.duration)}</small></span><button type="button" class="btn btn--small btn--ghost" data-play data-src="${esc(x.audio)}" data-title="${esc(`${t.ep_short} ${x.number} — ${x.title}`)}" aria-label="${esc(`${t.listen} : ${x.title}`)}">${icon('play')}</button></li>`; }).join('')}</ul>
<p><a class="link-arrow" href="${R('podcast', lang)}">${t.all_episodes} ${icon('arrow')}</a></p>
</div>
<div class="duo__prayer">
<p class="kicker">${esc(p.prayer_kicker)}</p>
<h2 class="section__title">${esc(p.prayer_title)}</h2>
<p>${esc(p.prayer_intro)}</p>
<div class="mini-wall">${data.prayers.slice(0, 3).map((n, i) => note(lang, n, i)).join('')}</div>
<p><a class="btn btn--ink" href="${R('prayer', lang)}">${icon('pray')}<span>${t.pray}</span></a></p>
</div>
</div>
</section>

<section class="section section--paper2">
${deckle('top', 44)}
<div class="wrap">
<header class="section-head">
<p class="kicker">${esc(p.areas_kicker)}</p>
<h2 class="section__title">${esc(p.areas_title)}</h2>
</header>
${areasBlock(lang, data.pages.missions[lang].areas)}
<p class="center"><a class="link-arrow" href="${R('missions', lang)}">${t.nav.missions} ${icon('arrow')}</a></p>
</div>
${deckle('bottom', 45)}
</section>

<section class="section">
<div class="wrap letter-cta" data-reveal>
<div class="letter-cta__art">${envelope('letter-cta__env')}</div>
<div class="letter-cta__text">
<p class="kicker">${esc(p.letter_kicker)}</p>
<h2 class="section__title">${esc(p.letter_title)}</h2>
<p>${esc(p.letter_text)}</p>
<a class="btn btn--ink" href="${R('letters', lang)}">${icon('pen')}<span>${esc(p.letter_cta)}</span></a>
</div>
</div>
</section>

<section class="section section--tight">
<div class="wrap duo duo--news">
<div>
<h2 class="section__title">${esc(p.agenda_title)}</h2>
<div class="event-list event-list--compact">${data.events.slice(0, 3).map((e) => eventCard(lang, e, true)).join('')}</div>
<p><a class="link-arrow" href="${R('events', lang)}">${t.all_events} ${icon('arrow')}</a></p>
</div>
<div>
<h2 class="section__title">${esc(p.news_title)}</h2>
<ul class="news-lines">${data.news.slice(0, 3).map((n) => `<li><time datetime="${n.l[lang].date}">${fmtDate(n.l[lang].date, lang)}</time><a href="${n.url[lang]}">${esc(n.l[lang].title)}</a></li>`).join('')}</ul>
<p><a class="link-arrow" href="${R('news', lang)}">${t.all_news} ${icon('arrow')}</a></p>
</div>
</div>
</section>

<section class="give-band">
${deckle('top', 46)}
<div class="wrap give-band__inner">
${seal('give-band__seal', 47)}
<div>
<h2 class="give-band__title">${esc(p.give_title)}</h2>
<p class="give-band__verse"><em>${lang === 'fr' ? '«&nbsp;Celui qui a pitié du pauvre prête à YHWH, qui lui rendra son bienfait.&nbsp;»' : '“Whoever is kind to the poor lends to YHWH, and he will repay him for his deed.”'}</em> — ${lang === 'fr' ? 'Proverbes 19:17' : 'Proverbs 19:17'}</p>
<p>${esc(p.give_text)}</p>
</div>
<div class="btn-row">
<a class="btn btn--give btn--lg" href="${R('give', lang)}">${icon('heart')}<span>${t.give}</span></a>
<a class="btn btn--light" href="${R('contact', lang)}">${t.footer_contact}</a>
</div>
</div>
</section>`;
    return L.page({ lang, paths: ROUTES.home, title: p.meta_title, description: p.meta_description, content, scripts: ['player'], bodyClass: 'is-home' });
  }

  return { homePage, aboutPage, missionsPage, storiesHub, storyPage, podcastPage, prayerPage, lettersPage, charterPage, newsList, newsPage, eventsList, eventPage, mediaPage, givePage, contactPage, privacyPage };
}
