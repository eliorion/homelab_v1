#!/usr/bin/env node
// Imports the association's public Google Calendar (iCal feed) into a site's content/events/.
// Usage: node calendar-sync.mjs --site <site-dir> --ics <https-url|file> [--days 365] [--dry-run]
// Only files named gcal-*.json are created or deleted; events typed in the CMS are never touched.
import { readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const TZ = 'America/Toronto'; // Montréal wall clock; must match the sites' "-05:00/-04:00" offsets.

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => {
  if (v.startsWith('--')) a.push([v.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return a;
}, []));
if (!args.site || !args.ics) {
  console.error('usage: node calendar-sync.mjs --site <site-dir> --ics <url|file> [--days 365] [--dry-run]');
  process.exit(2);
}
const siteDir = resolve(args.site);
const days = Number(args.days || 365);

// ---------- iCal parsing ----------
const unfold = (s) => s.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
const unescape = (s) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

function parseICS(text) {
  const events = [];
  let cur = null;
  for (const line of unfold(text).split('\n')) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const m = line.match(/^([A-Z-]+)((?:;[^:]*)?):(.*)$/);
    if (!m) continue;
    const [, name, rawParams, value] = m;
    const params = Object.fromEntries(rawParams.split(';').filter(Boolean).map((p) => p.split('=')));
    const prop = { value, params };
    if (name === 'EXDATE') (cur.EXDATE ||= []).push(...value.split(',').map((v) => ({ value: v, params })));
    else cur[name] = prop;
  }
  return events;
}

// ---------- time zones (wall clock <-> UTC without dependencies) ----------
const partsIn = (date, tz) => {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const o = Object.fromEntries(f.formatToParts(date).map((p) => [p.type, p.value]));
  return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour, mi: +o.minute, s: +o.second };
};
const offsetMin = (date, tz) => {
  const p = partsIn(date, tz);
  return (Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - date.getTime()) / 60000;
};
const wallToUtc = (w, tz) => {
  const guess = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, 0);
  let t = guess - offsetMin(new Date(guess), tz) * 60000;
  t = guess - offsetMin(new Date(t), tz) * 60000;
  return new Date(t);
};

function parseDate(prop) {
  const v = prop.value.trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/);
  if (!m) throw new Error(`bad date ${v}`);
  const [, y, mo, d, h, mi, , z] = m;
  if (h === undefined) return { allDay: true, wall: { y: +y, mo: +mo, d: +d, h: 0, mi: 0 } };
  let utc;
  if (z) utc = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi));
  else utc = wallToUtc({ y: +y, mo: +mo, d: +d, h: +h, mi: +mi }, prop.params.TZID || TZ);
  return { allDay: false, wall: partsIn(utc, TZ) };
}

const pad = (n) => String(n).padStart(2, '0');
const wallKey = (w) => `${w.y}-${pad(w.mo)}-${pad(w.d)}T${pad(w.h)}:${pad(w.mi)}`;
const addDays = (w, n) => { const t = new Date(Date.UTC(w.y, w.mo - 1, w.d + n)); return { ...w, y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() }; };
const dow = (w) => new Date(Date.UTC(w.y, w.mo - 1, w.d)).getUTCDay();
const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const minutesBetween = (a, b) => (Date.UTC(b.y, b.mo - 1, b.d, b.h, b.mi) - Date.UTC(a.y, a.mo - 1, a.d, a.h, a.mi)) / 60000;
const addMinutes = (w, n) => { const t = new Date(Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) + n * 60000); return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes() }; };
const isoOffset = (w) => {
  const off = offsetMin(wallToUtc(w, TZ), TZ);
  const sign = off <= 0 ? '-' : '+';
  return `${wallKey(w)}:00${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
};

// ---------- recurrence (DAILY / WEEKLY / MONTHLY; COUNT, UNTIL, INTERVAL, BYDAY, BYMONTHDAY) ----------
function expand(start, rruleText, horizon) {
  const r = Object.fromEntries(rruleText.split(';').map((kv) => kv.split('=')));
  const interval = Number(r.INTERVAL || 1);
  const count = r.COUNT ? Number(r.COUNT) : Infinity;
  const until = r.UNTIL ? wallKey(parseDate({ value: r.UNTIL, params: {} }).wall) : null;
  const out = [];
  const push = (w) => {
    const k = wallKey(w);
    if (k < wallKey(start) || (until && k.slice(0, 10) > until.slice(0, 10)) || k > horizon) return false;
    out.push(w);
    return true;
  };
  const limit = 500;
  if (r.FREQ === 'DAILY') {
    for (let i = 0, w = start; out.length < count && i < limit && wallKey(w) <= horizon; i++, w = addDays(w, interval)) push(w);
  } else if (r.FREQ === 'WEEKLY') {
    const by = (r.BYDAY ? r.BYDAY.split(',') : [DAYS[dow(start)]]).map((d) => DAYS.indexOf(d.slice(-2)));
    const weekStart = addDays(start, -dow(start));
    for (let wk = 0; wk < limit && out.length < count; wk++) {
      const base = addDays(weekStart, wk * 7 * interval);
      if (wallKey(base) > horizon) break;
      for (const d of by.sort()) { if (out.length >= count) break; push(addDays(base, d)); }
    }
  } else if (r.FREQ === 'MONTHLY') {
    for (let i = 0; i < limit && out.length < count; i++) {
      const m0 = new Date(Date.UTC(start.y, start.mo - 1 + i * interval, 1));
      const y = m0.getUTCFullYear(), mo = m0.getUTCMonth() + 1;
      const first = { ...start, y, mo, d: 1 };
      if (wallKey(first) > horizon) break;
      const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      let cands = [];
      if (r.BYDAY) {
        for (const spec of r.BYDAY.split(',')) {
          const [, n, dd] = spec.match(/^([+-]?\d*)([A-Z]{2})$/);
          const all = [];
          for (let d = 1; d <= dim; d++) if (dow({ y, mo, d }) === DAYS.indexOf(dd)) all.push(d);
          const k = Number(n || 0);
          cands.push(...(k === 0 ? all : [k > 0 ? all[k - 1] : all[all.length + k]]).filter(Boolean));
        }
      } else cands = (r.BYMONTHDAY ? r.BYMONTHDAY.split(',').map(Number) : [start.d]).filter((d) => d <= dim);
      for (const d of cands.sort((a, b) => a - b)) { if (out.length >= count) break; push({ ...start, y, mo, d }); }
    }
  } else {
    push(start); // unsupported FREQ (e.g. YEARLY): keep the first occurrence only
  }
  return out;
}

// ---------- description conventions ----------
const stripHtml = (s) => s
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n').replace(/<li>/gi, '- ')
  .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, (_, href, txt) => (txt === href ? href : `${txt} (${href})`))
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

const META_KEYS = {
  category: ['catégorie', 'categorie', 'category', 'type'],
  image: ['image', 'photo'],
  ticket: ['inscription', 'billets', 'billet', 'tickets', 'registration', 'zeffy'],
  hood: ['quartier', 'neighbourhood', 'neighborhood'],
  price: ['prix', 'price'],
  meeting: ['rendez-vous', 'rencontre', 'meeting point', 'meeting'],
  location_en: ['lieu en', 'location en'],
};
const CATEGORY_WORDS = [
  ['maraude', /maraude|outreach/i],
  ['collecte', /collecte|food drive|denrée/i],
  ['atelier', /atelier|workshop|formation|séminaire|seminar|conférence|conference/i],
  ['priere', /pri[eè]re|prayer|culte|worship|louange|veillée/i],
  ['gala', /gala|souper|dinner|bénéfice|benefit/i],
];

function parseDescription(raw = '') {
  const text = stripHtml(unescape(raw)).replace(/\r/g, '');
  const meta = {};
  const body = { fr: [], en: [] };
  let lang = 'fr';
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (/^(-{2,}\s*)?(en|english|anglais)(\s*-{2,})?\s*:?$/i.test(t)) { lang = 'en'; continue; }
    const kv = t.match(/^([A-Za-zÀ-ÿ -]{2,20})\s*:\s*(.+)$/);
    if (kv) {
      const key = kv[1].trim().toLowerCase();
      const found = Object.entries(META_KEYS).find(([, names]) => names.includes(key));
      if (found) { meta[found[0]] = kv[2].trim(); continue; }
    }
    if (/^#(exemple|sample)\b/i.test(t)) { meta.sample = true; continue; }
    body[lang].push(line);
  }
  const clean = (a) => a.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { meta, fr: clean(body.fr), en: clean(body.en) };
}

const slugify = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/œ/g, 'oe').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const longDate = (w, l) => new Intl.DateTimeFormat(l === 'fr' ? 'fr-CA' : 'en-CA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  .format(new Date(Date.UTC(w.y, w.mo - 1, w.d))); // series occurrences need distinct summaries (unique meta descriptions)
const firstSentence = (s) => {
  const p = s.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim();
  const m = p.match(/^(.{20,200}?[.!?])(\s|$)/);
  return m ? m[1] : p.slice(0, 200);
};

// ---------- per-site field mapping ----------
const SITES = {
  'site-1-lumiere': {
    dates: 'offset',
    images: { maraude: '/img/elders.jpg', collecte: '/img/food-bank-volunteers.jpg', atelier: '/img/lunchboxes.jpg', priere: '/img/bible-study.jpg', gala: '/img/bible-study.jpg' },
    map: (e, l) => ({ location_name: e.location[l], locality: 'Montréal', ticket_url: e.ticket }),
  },
  'site-2-lettre': {
    dates: 'local',
    images: { maraude: '/assets/img/bread-sharing.jpg', collecte: '/assets/img/fruit.jpg', atelier: '/assets/img/lunchboxes.jpg', priere: '/assets/img/bible-study.jpg', gala: '/assets/img/bible-study.jpg' },
    map: (e, l) => ({ location: e.location[l], locality: 'Montréal', registration_url: e.ticket }),
  },
  'site-3-kimia': {
    dates: 'local', noAlt: true,
    images: { maraude: '/assets/illustrations/maraude-nuit.svg', collecte: '/assets/illustrations/collecte.svg', atelier: '/assets/illustrations/atelier.svg', priere: '/assets/illustrations/priere.svg', gala: '/assets/illustrations/priere.svg' },
    map: (e) => ({ venue: e.location.fr, category: e.category === 'gala' ? 'priere' : e.category, ticketUrl: e.ticket }),
  },
  'site-4-nord': {
    dates: 'local',
    images: { maraude: '/assets/img/bread-sharing-1600.jpg', collecte: '/assets/img/food-bank-volunteers-1600.jpg', atelier: '/assets/img/library-768.jpg', priere: '/assets/img/bible-study-740.jpg', gala: '/assets/img/elders-1024.jpg' },
    map: (e, l, site) => ({
      address: e.location[l], meeting_point: e.meeting || '', type: e.category === 'priere' ? 'culte' : e.category,
      neighbourhood: site.hood(e), rsvp: e.ticket ? 'zeffy' : 'form', ...(e.ticket ? { ticket_url: e.ticket } : {}),
      ...(e.price ? { price: e.price } : {}), bring: [], shifts: [],
    }),
    hood(e) {
      const HOODS = ['centre-ville', 'montreal-nord', 'saint-michel', 'villeray', 'riviere-des-prairies', 'saint-leonard', 'ahuntsic', 'hochelaga'];
      const probe = slugify(`${e.hood || ''} ${e.location.fr}`);
      return HOODS.find((h) => probe.includes(h)) || (e.hood && HOODS.includes(slugify(e.hood)) ? slugify(e.hood) : 'centre-ville');
    },
  },
  'site-5-coeur-ouvert': {
    dates: 'offset',
    images: { maraude: '/assets/img/bread-sharing.jpg', collecte: '/assets/img/fruit.jpg', atelier: '/assets/img/library.jpg', priere: '/assets/img/bible-study.jpg', gala: '/assets/img/bible-study.jpg' },
    labels: {
      fr: { maraude: 'Maraude', collecte: 'Collecte', atelier: 'Atelier', priere: 'Rencontre', gala: 'Rencontre' },
      en: { maraude: 'Street outreach', collecte: 'Food drive', atelier: 'Workshop', priere: 'Gathering', gala: 'Gathering' },
    },
    map: (e, l, site) => ({ location: e.location[l], address: e.location[l], category: site.labels[l][e.category], ticket_url: e.ticket, ...(e.price ? { price: e.price } : {}) }),
  },
};
const ALT = {
  maraude: { fr: 'Des mains tendent des petits pains lors d’une maraude.', en: 'Hands offering bread rolls during street outreach.' },
  collecte: { fr: 'Des bénévoles trient des denrées pour une collecte.', en: 'Volunteers sorting food for a food drive.' },
  atelier: { fr: 'Illustration d’un atelier de formation.', en: 'Illustration of a training workshop.' },
  priere: { fr: 'Un groupe réuni autour d’une Bible ouverte.', en: 'A group gathered around an open Bible.' },
  gala: { fr: 'Des invités réunis lors d’une soirée de l’association.', en: 'Guests gathered at an association evening.' },
};

// ---------- main ----------
const siteKey = basename(siteDir);
const site = SITES[siteKey];
if (!site) { console.error(`unknown site ${siteKey}; known: ${Object.keys(SITES).join(', ')}`); process.exit(2); }

const source = args.ics;
const text = /^https?:\/\//.test(source)
  ? await (await fetch(source, { headers: { 'user-agent': 'lapaixducoeur-calendar-sync' } })).text()
  : readFileSync(source, 'utf8');
if (!text.includes('BEGIN:VCALENDAR')) { console.error('source is not an iCal feed'); process.exit(1); }

const now = partsIn(new Date(), TZ);
const today = `${now.y}-${pad(now.mo)}-${pad(now.d)}T00:00`;
const horizon = wallKey(addDays({ ...now, h: 23, mi: 59 }, days));

const vevents = parseICS(text).filter((v) => v.DTSTART && (v.STATUS?.value || '') !== 'CANCELLED'
  && !/^(private|confidential)$/i.test(v.CLASS?.value || ''));
const overrides = new Map(vevents.filter((v) => v['RECURRENCE-ID']).map((v) => [`${v.UID.value}|${wallKey(parseDate(v['RECURRENCE-ID']).wall)}`, v]));

const occurrences = [];
for (const v of vevents.filter((x) => !x['RECURRENCE-ID'])) {
  const s = parseDate(v.DTSTART);
  const e = v.DTEND ? parseDate(v.DTEND) : { wall: addMinutes(s.wall, s.allDay ? 1439 : 120) };
  const dur = s.allDay ? 1439 : minutesBetween(s.wall, e.wall);
  const ex = new Set((v.EXDATE || []).map((x) => wallKey(parseDate(x).wall)));
  const starts = v.RRULE ? expand(s.wall, v.RRULE.value, horizon) : [s.wall];
  for (const w of starts) {
    const key = wallKey(w);
    if (ex.has(key)) continue;
    const ov = overrides.get(`${v.UID.value}|${key}`);
    if (ov) {
      if ((ov.STATUS?.value || '') === 'CANCELLED') continue;
      const os = parseDate(ov.DTSTART); const oe = ov.DTEND ? parseDate(ov.DTEND) : { wall: addMinutes(os.wall, dur) };
      occurrences.push({ v: ov, uid: v.UID.value, rid: key, start: os.wall, end: oe.wall, series: Boolean(v.RRULE) });
    } else occurrences.push({ v, uid: v.UID.value, rid: key, start: w, end: addMinutes(w, dur), series: Boolean(v.RRULE) });
  }
}

const upcoming = occurrences.filter((o) => wallKey(o.end) >= today && wallKey(o.start) <= horizon)
  .sort((a, b) => wallKey(a.start).localeCompare(wallKey(b.start)));

const fmt = (w) => (site.dates === 'offset' ? isoOffset(w) : wallKey(w));
const written = new Set();
for (const o of upcoming) {
  const v = o.v;
  const [titleFr, titleEn] = unescape(v.SUMMARY?.value || 'Événement').split(/\s+[|/]\s+/);
  const desc = parseDescription(v.DESCRIPTION?.value);
  const locFr = unescape(v.LOCATION?.value || 'Montréal');
  const category = (desc.meta.category && slugify(desc.meta.category).replace('culte', 'priere'))
    || CATEGORY_WORDS.find(([, re]) => re.test(`${titleFr} ${desc.fr}`))?.[0] || 'collecte';
  const cat = ['maraude', 'collecte', 'atelier', 'priere', 'gala'].includes(category) ? category : 'collecte';
  const ev = {
    category: cat, ticket: desc.meta.ticket || (v.URL?.value ?? ''), hood: desc.meta.hood, price: desc.meta.price, meeting: desc.meta.meeting,
    location: { fr: locFr, en: desc.meta.location_en || locFr },
  };
  const id = createHash('sha1').update(`${o.uid}|${o.rid}`).digest('hex').slice(0, 10);
  const date = wallKey(o.start).slice(0, 10);
  const image = desc.meta.image
    ? (desc.meta.image.startsWith('/') || /^https?:/.test(desc.meta.image) ? desc.meta.image : site.images[cat].replace(/[^/]+$/, desc.meta.image))
    : site.images[cat];
  const lang = (l) => {
    const title = (l === 'en' ? titleEn : titleFr) || titleFr;
    const body = (l === 'en' ? desc.en : desc.fr) || desc.fr || title;
    const untranslated = l === 'en' && !desc.en && Boolean(desc.fr);
    const lead = `${untranslated ? '(In French) ' : ''}${firstSentence(body)}`;
    return {
      slug: `${slugify(title)}-${date}`,
      title,
      summary: o.series ? `${lead} (${longDate(o.start, l)})` : lead,
      body,
      start: fmt(o.start),
      end: fmt(o.end),
      image,
      ...(site.noAlt ? {} : { image_alt: ALT[cat][l] }),
      sample: Boolean(desc.meta.sample),
      source: 'google-calendar',
      ...site.map(ev, l, site),
    };
  };
  const file = `gcal-${date}-${id}.json`;
  written.add(file);
  const json = `${JSON.stringify({ fr: lang('fr'), en: lang('en') }, null, 2)}\n`;
  const path = join(siteDir, 'content/events', file);
  if (args['dry-run']) console.log(`would write ${file}: ${titleFr} @ ${wallKey(o.start)}`);
  else if (!existsSync(path) || readFileSync(path, 'utf8') !== json) writeFileSync(path, json);
}

let removed = 0;
for (const f of readdirSync(join(siteDir, 'content/events'))) {
  if (f.startsWith('gcal-') && !written.has(f)) {
    if (!args['dry-run']) unlinkSync(join(siteDir, 'content/events', f));
    removed++;
  }
}
console.log(`${siteKey}: ${written.size} event(s) from Google Calendar, ${removed} stale removed${args['dry-run'] ? ' (dry run)' : ''}.`);
