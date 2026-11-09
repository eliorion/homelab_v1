import { readFileSync } from 'node:fs';

const IMAGES = JSON.parse(readFileSync(new URL('../images.json', import.meta.url), 'utf8'));

// Escapes HTML and applies French typographic non-breaking spaces (« x », x : y, x ! x ?).
export const esc = (s = '') => String(s)
  .replace(/« /g, '«\u00a0').replace(/ »/g, '\u00a0»').replace(/ ([:;!?])(?=\s|$)/g, '\u202f$1')
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Marks "[à confirmer]" style placeholders visibly. Input must already be escaped.
export const tbc = (html) => html.replace(/\[([^\]]+)\]/g, '<span class="tbc">[$1]</span>');
export const t = (s) => tbc(esc(s));

function inline(s) {
  return tbc(esc(s))
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt, url) => `<a href="${url}">${txt}</a>`);
}

// Minimal Markdown: ## / ### headings, paragraphs, - lists, 1. lists, > quotes, **b**, *i*, [t](u).
export function md(src = '') {
  const out = [];
  const blocks = String(src).replace(/\r/g, '').split(/\n{2,}/);
  for (const b of blocks) {
    const lines = b.split('\n');
    if (/^#{2,3} /.test(b)) {
      const lvl = b.startsWith('### ') ? 3 : 2;
      out.push(`<h${lvl}>${inline(b.replace(/^#{2,3} /, ''))}</h${lvl}>`);
    } else if (lines.every((l) => /^- /.test(l))) {
      out.push(`<ul>${lines.map((l) => `<li>${inline(l.slice(2))}</li>`).join('')}</ul>`);
    } else if (lines.every((l) => /^\d+\. /.test(l))) {
      out.push(`<ol>${lines.map((l) => `<li>${inline(l.replace(/^\d+\. /, ''))}</li>`).join('')}</ol>`);
    } else if (lines.every((l) => /^> ?/.test(l))) {
      out.push(`<blockquote><p>${inline(lines.map((l) => l.replace(/^> ?/, '')).join(' '))}</p></blockquote>`);
    } else if (b.trim()) {
      out.push(`<p>${lines.map(inline).join('<br>')}</p>`);
    }
  }
  return out.join('\n');
}

export const plain = (s = '') => String(s).replace(/[*#>[\]]/g, '').replace(/\s+/g, ' ').trim();

// Accepts a base name ("fruit") or a path; known photos become responsive <picture>, uploads a plain <img>.
export const imgName = (src = '') => { if (IMAGES[src]) return src; const m = src.match(/^\/assets\/img\/(.+)-\d+\.(?:jpg|webp)$/); return m && IMAGES[m[1]] ? m[1] : null; };
export function picture(src, alt, { sizes = '(min-width: 1000px) 33vw, (min-width: 640px) 50vw, 100vw', cls = '', eager = false } = {}) {
  const name = imgName(src);
  const lazy = eager ? 'fetchpriority="high"' : 'loading="lazy"';
  if (!name) return `<img src="${esc(src)}" width="1200" height="800" alt="${esc(alt)}"${cls ? ` class="${cls}"` : ''} ${lazy} decoding="async">`;
  const v = IMAGES[name];
  const [small, big] = v;
  const set = (ext) => v.map(([w]) => `/assets/img/${name}-${w}.${ext} ${w}w`).join(', ');
  return `<picture><source type="image/webp" srcset="${set('webp')}" sizes="${sizes}"><img src="/assets/img/${name}-${big[0]}.jpg" srcset="${set('jpg')}" sizes="${sizes}" width="${big[0]}" height="${big[1]}" alt="${esc(alt)}"${cls ? ` class="${cls}"` : ''} ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"></picture>`;
}
export const imageUrl = (src) => { const n = imgName(src); const v = n && IMAGES[n]; return v ? `/assets/img/${n}-${v[v.length - 1][0]}.jpg` : src; };
export const isPhoto = (src) => Boolean(imgName(src)) || /\.(jpe?g|png|webp)$/i.test(src);

// Media item (photo or illustration) as <picture>/<img>.
export function mediaImg(src, alt, opts = {}) {
  if (!/\.svg$/i.test(src)) return picture(src, alt, opts);
  return `<img src="${src}" width="800" height="600" alt="${esc(alt)}" loading="lazy" decoding="async">`;
}

const TZ = 'America/Toronto';
export function tzOffset(local) {
  const d = new Date(`${local}:00Z`);
  const name = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' }).formatToParts(d).find((p) => p.type === 'timeZoneName').value;
  const m = name.match(/GMT([+-]\d{2}):?(\d{2})?/);
  return m ? `${m[1]}:${m[2] || '00'}` : '-05:00';
}
export const isoWithTz = (local) => `${local}:00${tzOffset(local)}`;
const loc = (lang) => (lang === 'fr' ? 'fr-CA' : 'en-CA');
const asDate = (local) => new Date(`${local.length === 10 ? `${local}T12:00` : local}:00Z`);
export const fmtDate = (d, lang) => new Intl.DateTimeFormat(loc(lang), { dateStyle: 'long', timeZone: 'UTC' }).format(asDate(d));
export const fmtDay = (d, lang) => new Intl.DateTimeFormat(loc(lang), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(asDate(d));
export const fmtTime = (d, lang) => {
  const x = asDate(d);
  if (lang === 'fr') return `${x.getUTCHours()} h ${String(x.getUTCMinutes()).padStart(2, '0')}`.replace(' h 00', ' h');
  return new Intl.DateTimeFormat('en-CA', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(x).replace(':00', '').replace(/\s?([ap])\.?m\.?/i, ' $1m');
};
export const stampParts = (d, lang) => {
  const x = asDate(d);
  return {
    m: new Intl.DateTimeFormat(loc(lang), { month: 'short', timeZone: 'UTC' }).format(x).replace('.', ''),
    d: x.getUTCDate(), y: x.getUTCFullYear(),
  };
};

export const jsonld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;
