import fs from 'node:fs';
import path from 'node:path';

export const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function typo(s = '', lang = 'fr') {
  s = String(s).replace(/'/g, '’');
  if (lang !== 'fr') return s;
  return s
    .replace(/ ([;:!?])/g, ' $1')
    .replace(/« /g, '« ').replace(/ »/g, ' »')
    .replace(/(\d) (\$|h\b|%)/g, '$1 $2')
    .replace(/(\d) (\d{3})/g, '$1 $2');
}

export const t = (s, lang) => esc(typo(s, lang));

export function inline(s, lang) {
  let out = t(s, lang);
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt, url) => `<a href="${url}">${txt}</a>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  out = out.replace(/\[(à confirmer|to confirm|si enregistré|if registered|prénom modifié|name changed)\]/g, '<span class="tbc">[$1]</span>');
  return out;
}

export function md(src = '', lang = 'fr', { h = 2 } = {}) {
  const blocks = String(src).replace(/\r/g, '').split(/\n{2,}/);
  return blocks.map((b) => {
    b = b.trim();
    if (!b) return '';
    const hm = b.match(/^(#{2,3}) (.*)$/);
    if (hm) { const lvl = Math.min(6, h + hm[1].length - 2); return `<h${lvl}>${inline(hm[2], lang)}</h${lvl}>`; }
    if (/^- /.test(b)) return `<ul>${b.split('\n').map((l) => `<li>${inline(l.replace(/^- /, ''), lang)}</li>`).join('')}</ul>`;
    if (/^> /.test(b)) {
      const txt = b.split('\n').map((l) => l.replace(/^> ?/, '')).join(' ');
      const m = txt.match(/^(.*?)\s+—\s+([^—]+)$/);
      return m
        ? `<blockquote class="pull"><p>${inline(m[1], lang)}</p><cite>${inline(m[2], lang)}</cite></blockquote>`
        : `<blockquote class="pull"><p>${inline(txt, lang)}</p></blockquote>`;
    }
    return `<p>${inline(b.replace(/\n/g, ' '), lang)}</p>`;
  }).join('\n');
}

export function imageSize(file) {
  const b = fs.readFileSync(file);
  if (b[0] === 0x89 && b[1] === 0x50) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  throw new Error(`Unknown image size: ${file}`);
}

let STATIC = '';
export const setStaticRoot = (dir) => { STATIC = dir; };

export function picture(src, alt, { cls = '', sizes = '100vw', eager = false, imgCls = '' } = {}) {
  if (alt === undefined) throw new Error(`Missing alt for ${src}`);
  const file = path.join(STATIC, src);
  const { w, h } = imageSize(file);
  const ext = path.extname(src);
  const base = src.slice(0, -ext.length);
  const has = (p) => fs.existsSync(path.join(STATIC, p));
  const set = (e) => {
    const parts = [];
    if (has(`${base}-640${e}`)) parts.push(`${base}-640${e} 640w`);
    parts.push(`${base}${e} ${w}w`);
    return parts.join(', ');
  };
  const webp = has(`${base}.webp`) ? `<source type="image/webp" srcset="${set('.webp')}" sizes="${sizes}">` : '';
  const load = eager ? 'fetchpriority="high"' : 'loading="lazy" decoding="async"';
  return `<picture class="${cls}">${webp}<img src="${src}" srcset="${set(ext)}" sizes="${sizes}" width="${w}" height="${h}" alt="${esc(alt)}" ${load}${imgCls ? ` class="${imgCls}"` : ''}></picture>`;
}

export const TZ = 'America/Toronto';
export function fmtDate(iso, lang, opts = { day: 'numeric', month: 'long', year: 'numeric' }) {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00-05:00` : iso);
  return new Intl.DateTimeFormat(lang === 'fr' ? 'fr-CA' : 'en-CA', { timeZone: TZ, ...opts }).format(d);
}
export function fmtTime(iso, lang) {
  return new Intl.DateTimeFormat(lang === 'fr' ? 'fr-CA' : 'en-CA', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}
export function money(n, lang) {
  return new Intl.NumberFormat(lang === 'fr' ? 'fr-CA' : 'en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(n);
}
export const num = (n, lang) => new Intl.NumberFormat(lang === 'fr' ? 'fr-CA' : 'en-CA').format(n);

const P = {
  basket: '<path d="M3 10h18l-2 10H5L3 10Z"/><path d="M8 10l4-6 4 6"/><path d="M9 14v3M12 14v3M15 14v3"/>',
  coat: '<path d="M9 3h6l5 4-2 5-2-1v10H8V11l-2 1-2-5 5-4Z"/><path d="M9 3l3 4 3-4M12 7v14"/>',
  pencil: '<path d="M4 20l1-5L16 4l4 4L9 19l-5 1Z"/><path d="M14 6l4 4"/>',
  boot: '<path d="M7 3h6v9l6 3c1 .5 2 1.6 2 3v2H4V3h3"/><path d="M4 16h17"/>',
  bowl: '<path d="M3 11h18a9 9 0 0 1-18 0Z"/><path d="M9 7c0-2 2-2 2-4M14 7c0-2 2-2 2-4"/>',
  gift: '<rect x="3" y="9" width="18" height="12"/><path d="M3 13h18M12 9v12"/><path d="M12 9c-3 0-5-1-5-3s3-2 5 3c2-5 5-5 5-3s-2 3-5 3Z"/>',
  heart: '<path d="M12 20 4.6 12.9C2.5 10.9 2.6 7.5 4.8 5.7c1.9-1.5 4.6-1.2 6.2.6L12 7.5l1-1.2c1.6-1.8 4.3-2.1 6.2-.6 2.2 1.8 2.3 5.2.2 7.2L12 20Z"/>',
  arrow: '<path d="M4 12h16M14 6l6 6-6 6"/>',
  play: '<path d="M7 4v16l13-8L7 4Z" fill="currentColor"/>',
  pause: '<path d="M7 4h4v16H7zM13 4h4v16h-4z" fill="currentColor" stroke="none"/>',
  share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="5" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/>',
  calendar: '<rect x="3" y="5" width="18" height="16"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  pin: '<path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12Z"/><circle cx="12" cy="9" r="2.5"/>',
  download: '<path d="M12 3v12M6 10l6 6 6-6M4 21h16"/>',
  copy: '<rect x="8" y="8" width="13" height="13"/><path d="M16 8V3H3v13h5"/>',
  close: '<path d="M5 5l14 14M19 5L5 19"/>',
  pray: '<path d="M12 3v6M9 21l-4-4V9l3-1 2 6M15 21l4-4V9l-3-1-2 6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-4 3.2-6 6.5-6s6 2 6.5 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14c3 0 5 1.6 5.5 5"/>',
  card: '<rect x="3" y="4" width="18" height="16"/><path d="M7 9h10M7 13h7"/>',
  mail: '<rect x="3" y="5" width="18" height="14"/><path d="M3 6l9 7 9-7"/>',
  rss: '<path d="M5 19h.01M5 12a7 7 0 0 1 7 7M5 5a14 14 0 0 1 14 14"/>',
  cc: '<rect x="3" y="5" width="18" height="14"/><path d="M10 10.5a2 2 0 1 0 0 3M16 10.5a2 2 0 1 0 0 3"/>',
};
export function icon(name, cls = 'ico') {
  return `<svg class="${cls}" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true" focusable="false">${P[name] || ''}</svg>`;
}

export function readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
export function loadDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    .map((f) => ({ id: f.replace(/\.json$/, ''), ...readJSON(path.join(dir, f)) }));
}
export const pick = (entry, lang) => ({ ...(entry.fr || {}), ...(entry[lang] || {}) });

export function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
export function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name); const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}
