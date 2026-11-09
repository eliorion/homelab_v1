function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function deckle(pos = 'bottom', seed = 7, cls = '') {
  const r = rng(seed);
  const pts = [];
  for (let x = 0; x <= 1440; x += 12 + r() * 22) pts.push(`${x.toFixed(0)} ${(8 + r() * 14).toFixed(1)}`);
  pts.push('1440 14');
  const d = `M0 40 L0 12 L${pts.join(' L')} L1440 40 Z`;
  return `<div class="deckle deckle--${pos} ${cls}" aria-hidden="true"><svg viewBox="0 0 1440 40" preserveAspectRatio="none" focusable="false"><path d="${d}"/></svg></div>`;
}

export const heartPath =
  'M60 94 C50 84 28 72 17 57 C5 40 9 15 31 12 C45 10 55 20 60 31 C65 19 76 8 92 11 C113 16 115 45 95 64 C83 76 70 85 60 94 C68 90 86 88 104 92 C116 95 126 93 132 86';

export function drawHeart(cls = '') {
  return `<svg class="draw-heart ${cls}" viewBox="0 0 140 100" aria-hidden="true" focusable="false"><path pathLength="1" d="${heartPath}"/></svg>`;
}

export function scribble(cls = '') {
  return `<svg class="scribble ${cls}" viewBox="0 0 220 14" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path pathLength="1" d="M3 9 C40 3 78 2 112 6 S180 12 216 4"/></svg>`;
}

export function seal(cls = '', seed = 3) {
  const r = rng(seed);
  const n = 22;
  let d = '';
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rad = 44 + (r() - 0.5) * 5 + (i % 2 ? 2 : -1);
    const x = 50 + Math.cos(a) * rad;
    const y = 50 + Math.sin(a) * rad;
    d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)} `;
  }
  return `<svg class="seal ${cls}" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><path class="seal__wax" d="${d}Z"/><circle class="seal__ring" cx="50" cy="50" r="31"/><path class="seal__heart" d="M50 66 C40 58 33 52 33 44 C33 37 39 33 44 34 C47 35 49 37 50 40 C51 37 53 35 56 34 C61 33 67 37 67 44 C67 52 60 58 50 66 Z"/></svg>`;
}

export function fleuron(cls = '') {
  return `<svg class="fleuron ${cls}" viewBox="0 0 120 20" aria-hidden="true" focusable="false"><path d="M2 10 H44 M76 10 H118"/><path d="M60 16 C54 12 50 9 50 6 C50 3 53 2 55 3 C57 4 59 6 60 8 C61 6 63 4 65 3 C67 2 70 3 70 6 C70 9 66 12 60 16 Z"/><circle cx="48" cy="10" r="1.6"/><circle cx="72" cy="10" r="1.6"/></svg>`;
}

export function envelope(cls = '') {
  return `<svg class="envelope ${cls}" viewBox="0 0 240 160" aria-hidden="true" focusable="false">
<rect class="env__body" x="6" y="30" width="228" height="124" rx="6"/>
<path class="env__letter" d="M24 46 h192 v-36 h-192 Z"/>
<path class="env__lines" d="M40 22 h120 M40 32 h150"/>
<path class="env__fold" d="M6 154 L104 90 M234 154 L136 90"/>
<path class="env__flap" d="M6 36 L120 108 L234 36"/>
<g transform="translate(96 82) scale(.48)"><g class="env__seal">${seal('', 9).replace(/<\/?svg[^>]*>/g, '')}</g></g>
</svg>`;
}

const ICONS = {
  bread: '<path d="M8 30c0-9 7-15 24-15s24 6 24 15c0 3-2 5-5 5v14H13V35c-3 0-5-2-5-5z"/><path d="M22 24c2 3 2 6 0 9M32 22c2 4 2 8 0 11M42 24c2 3 2 6 0 9"/>',
  coat: '<path d="M24 8l8 6 8-6 12 6 6 18-8 3-3-9v32H17V26l-3 9-8-3 6-18z"/><path d="M32 14v42M27 30h2M27 40h2"/>',
  book: '<path d="M32 16c-6-4-14-5-22-4v38c8-1 16 0 22 4 6-4 14-5 22-4V12c-8-1-16 0-22 4z"/><path d="M32 16v38"/>',
  hands: '<path d="M32 50c-8-6-16-11-16-19 0-5 4-8 8-8 4 0 6 3 8 6 2-3 4-6 8-6 4 0 8 3 8 8 0 8-8 13-16 19z"/><path d="M6 40c4 6 12 14 26 18 14-4 22-12 26-18"/>',
  pray: '<path d="M30 8c-4 6-8 15-8 26v11l-9 9h15l2-6z"/><path d="M34 8c4 6 8 15 8 26v11l9 9H36l-2-6z"/>',
  pen: '<path d="M44 8l12 12-30 30-14 2 2-14z"/><path d="M38 14l12 12"/>',
  play: '<path d="M22 14l28 18-28 18z"/>',
  mail: '<rect x="8" y="16" width="48" height="34" rx="3"/><path d="M8 18l24 18 24-18"/>',
  calendar: '<rect x="8" y="12" width="48" height="42" rx="4"/><path d="M8 24h48M20 6v10M44 6v10"/>',
  pin: '<path d="M32 58s-16-16-16-30a16 16 0 0132 0c0 14-16 30-16 30z"/><circle cx="32" cy="28" r="6"/>',
  clock: '<circle cx="32" cy="32" r="24"/><path d="M32 18v14l10 6"/>',
  arrow: '<path d="M10 32h42M38 18l14 14-14 14"/>',
  heart: '<path d="M32 54C20 45 10 37 10 25c0-8 6-13 12-13 5 0 8 3 10 7 2-4 5-7 10-7 6 0 12 5 12 13 0 12-10 20-22 29z"/>',
  copy: '<rect x="20" y="20" width="32" height="36" rx="3"/><path d="M14 44V12a4 4 0 014-4h24"/>',
};

export function icon(name, cls = '') {
  return `<svg class="icon ${cls}" viewBox="0 0 64 64" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;
}

export const GRAIN =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .45 0 0 0 0 .35 0 0 0 0 .2 0 0 0 .09 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E";
