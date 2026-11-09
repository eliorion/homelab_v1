// Shared helpers for build.mjs. Zero dependencies.
export const TZ = 'America/Toronto';

export const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const slugify = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/œ/g, 'oe').replace(/æ/g, 'ae').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* ---------- Markdown (tiny subset: ## headings, lists, quotes, bold, italic, links) ---------- */
export function inline(s) {
  return esc(s)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${u}">${t}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[(à confirmer|to confirm|[^\]]*(?:à confirmer|to confirm|si enregistré|if registered)[^\]]*)\]/g,
      '<span class="tbc">[$1]</span>');
}

export function md(src = '', { headingShift = 0 } = {}) {
  const blocks = String(src).replace(/\r/g, '').split(/\n{2,}/);
  return blocks.map((b) => {
    const t = b.trim();
    if (!t) return '';
    const h = t.match(/^(#{2,4})\s+(.*)$/);
    if (h) { const n = Math.min(6, h[1].length + headingShift); return `<h${n}>${inline(h[2])}</h${n}>`; }
    if (/^>\s?/.test(t)) return `<blockquote class="verse"><p>${inline(t.replace(/^>\s?/gm, ''))}</p></blockquote>`;
    if (/^[-*]\s/.test(t)) return `<ul>${t.split('\n').map((l) => `<li>${inline(l.replace(/^[-*]\s+/, ''))}</li>`).join('')}</ul>`;
    if (/^\d+\.\s/.test(t)) return `<ol>${t.split('\n').map((l) => `<li>${inline(l.replace(/^\d+\.\s+/, ''))}</li>`).join('')}</ol>`;
    return `<p>${inline(t).replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
}

export const plain = (s = '') => String(s).replace(/[*_>#]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').trim();

/* ---------- Time: content stores Montréal wall-clock time "YYYY-MM-DDTHH:MM" ---------- */
const parts = (local) => {
  const [d, t = '00:00'] = local.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm] = t.split(':').map(Number);
  return { y, m, day, hh, mm };
};
export function tzOffset(local) {
  const { y, m, day, hh, mm } = parts(local);
  const guess = new Date(Date.UTC(y, m - 1, day, hh + 5, mm));
  const name = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' })
    .formatToParts(guess).find((p) => p.type === 'timeZoneName').value; // GMT-05:00
  return name.replace('GMT', '') || '+00:00';
}
export const isoWithOffset = (local) => `${local.length === 10 ? local + 'T00:00' : local}:00${tzOffset(local)}`;
export const toUtc = (local) => new Date(isoWithOffset(local));
const asUtcWall = (local) => { const { y, m, day, hh, mm } = parts(local); return new Date(Date.UTC(y, m - 1, day, hh, mm)); };
const L = (lang) => (lang === 'fr' ? 'fr-CA' : 'en-CA');

export function fmtDate(local, lang, opts = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) {
  return new Intl.DateTimeFormat(L(lang), { timeZone: 'UTC', ...opts }).format(asUtcWall(local));
}
export function fmtTime(local, lang) {
  const { hh, mm } = parts(local);
  if (lang === 'fr') return `${hh} h${mm ? ' ' + String(mm).padStart(2, '0') : ''}`;
  const h12 = ((hh + 11) % 12) + 1;
  return `${h12}${mm ? ':' + String(mm).padStart(2, '0') : ''} ${hh < 12 ? 'a.m.' : 'p.m.'}`;
}
export const fmtRange = (start, end, lang) => `${fmtTime(start, lang)} – ${fmtTime(end, lang)}`;
/** All-day convention shared with shared/tools/calendar-sync.mjs: start T00:00, end T23:59. */
export const isAllDay = (start, end) => /T00:00$/.test(start) && /T23:59$/.test(end);
const nextDay = (local) => { const { y, m, day } = parts(local); return new Date(Date.UTC(y, m - 1, day + 1)).toISOString().slice(0, 10); };
export const fmtWhen = (start, end, lang) => (isAllDay(start, end) ? (lang === 'fr' ? 'Toute la journée' : 'All day') : fmtRange(start, end, lang));
export const capFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* ---------- Calendar (RFC 5545) ---------- */
const icsEsc = (s = '') => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function fold(line) {
  const out = []; let cur = ''; let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}
const icsLocal = (local) => local.replace(/[-:]/g, '') + '00';
const icsUtc = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const VTIMEZONE = [
  'BEGIN:VTIMEZONE', `TZID:${TZ}`, 'X-LIC-LOCATION:America/Toronto',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0400', 'TZNAME:EDT', 'DTSTART:19700308T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:-0400', 'TZOFFSETTO:-0500', 'TZNAME:EST', 'DTSTART:19701101T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD',
  'END:VTIMEZONE',
];
export function icsCalendar({ name, description, events, stamp }) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//La Paix du Coeur//Calendrier//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEsc(name)}`, `X-WR-CALDESC:${icsEsc(description || '')}`, `X-WR-TIMEZONE:${TZ}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H', 'X-PUBLISHED-TTL:PT12H', ...VTIMEZONE];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${icsUtc(stamp)}`,
      ...(isAllDay(e.start, e.end)
        ? [`DTSTART;VALUE=DATE:${e.start.slice(0, 10).replace(/-/g, '')}`, `DTEND;VALUE=DATE:${nextDay(e.end).replace(/-/g, '')}`]
        : [`DTSTART;TZID=${TZ}:${icsLocal(e.start)}`, `DTEND;TZID=${TZ}:${icsLocal(e.end)}`]),
      `SUMMARY:${icsEsc(e.summary)}`, `DESCRIPTION:${icsEsc(e.description)}`, `LOCATION:${icsEsc(e.location)}`,
      `URL:${e.url}`, `CATEGORIES:${icsEsc(e.category)}`, 'STATUS:CONFIRMED', 'TRANSP:OPAQUE');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
export function googleCalUrl({ title, start, end, details, location }) {
  const dates = isAllDay(start, end) ? `${start.slice(0, 10).replace(/-/g, '')}/${nextDay(end).replace(/-/g, '')}` : `${icsLocal(start)}/${icsLocal(end)}`;
  const q = new URLSearchParams({ action: 'TEMPLATE', text: title, dates, ctz: TZ, details, location });
  return `https://calendar.google.com/calendar/render?${q}`;
}
export function outlookCalUrl({ title, start, end, details, location }) {
  const allday = isAllDay(start, end);
  const q = new URLSearchParams({ path: '/calendar/action/compose', rru: 'addevent', subject: title,
    startdt: allday ? start.slice(0, 10) : isoWithOffset(start), enddt: allday ? nextDay(end) : isoWithOffset(end), ...(allday ? { allday: 'true' } : {}), body: details, location });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${q}`;
}

/* ---------- Images ---------- */
export function makePicture(manifest) {
  const keyOf = (ref = '') => {
    if (manifest[ref]) return ref;
    const m = String(ref).match(/\/assets\/img\/([a-z0-9-]+?)-\d+\.(?:jpg|webp)$/);
    return m && manifest[m[1]] ? m[1] : null;
  };
  /** opts: sizes, cls, eager, ratio ("4/5" etc. purely presentational via class) */
  return function picture(ref, alt, { sizes = '(min-width: 1000px) 50vw, 100vw', cls = '', eager = false, imgCls = '' } = {}) {
    const key = keyOf(ref);
    const load = eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"';
    if (!key) {
      return `<img class="${imgCls} graded" src="${esc(ref)}" alt="${esc(alt)}" width="1600" height="1067" ${load} decoding="async">`;
    }
    const { w, h, widths } = manifest[key];
    const set = (ext) => widths.map((x) => `/assets/img/${key}-${x}.${ext} ${x}w`).join(', ');
    const fallback = `/assets/img/${key}-${widths[Math.min(1, widths.length - 1)]}.jpg`;
    return `<picture${cls ? ` class="${cls}"` : ''}><source type="image/webp" srcset="${set('webp')}" sizes="${sizes}">` +
      `<img${imgCls ? ` class="${imgCls}"` : ''} src="${fallback}" srcset="${set('jpg')}" sizes="${sizes}" alt="${esc(alt)}" width="${w}" height="${h}" ${load} decoding="async"></picture>`;
  };
}

export const hash = async (buf) => {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(buf).digest('hex').slice(0, 10);
};
