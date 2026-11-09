// Hand-made SVG illustrations. Palette tokens mirror src/css/site.css.
export const C = {
  terra: '#C2603D', terra7: '#A4482A', sage: '#8FA98A', sage7: '#4C6B48', sageL: '#C9D8C3',
  mustard: '#E0A93B', mustardL: '#F2D48E', plum: '#4A2545', plum9: '#2E1530', sand: '#FBF3E6',
  cream: '#FFFAF1', sand2: '#F3E4CC', wood: '#C99A68', wood7: '#9C6E43',
};

const r = (n) => Math.round(n * 10) / 10;

export function leaf(x, y, deg, s, fill = C.sage, rib = C.sage7) {
  return `<g transform="translate(${r(x)} ${r(y)}) rotate(${r(deg)})"><path d="M0 0C${r(s * .3)} ${r(-s * .36)} ${r(s * .72)} ${r(-s * .34)} ${s} 0C${r(s * .72)} ${r(s * .34)} ${r(s * .3)} ${r(s * .36)} 0 0Z" fill="${fill}"/><path d="M${r(s * .08)} 0H${r(s * .8)}" stroke="${rib}" stroke-width="1.4" stroke-linecap="round" opacity=".55"/></g>`;
}

export function vine(cx, cy, rad, a0, a1, n, size, opts = {}) {
  const { fill = C.sage, alt = C.sage7, stem = C.sage7 } = opts;
  const pt = (a) => [cx + rad * Math.cos(a * Math.PI / 180), cy + rad * Math.sin(a * Math.PI / 180)];
  const [sx, sy] = pt(a0), [ex, ey] = pt(a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0, sweep = a1 > a0 ? 1 : 0;
  let out = `<path d="M${r(sx)} ${r(sy)}A${rad} ${rad} 0 ${large} ${sweep} ${r(ex)} ${r(ey)}" fill="none" stroke="${stem}" stroke-width="2.4" stroke-linecap="round"/>`;
  for (let i = 0; i < n; i++) {
    const t = a0 + (a1 - a0) * (i + .5) / n;
    const [x, y] = pt(t);
    const dir = a1 > a0 ? 90 : -90;
    const sz = size * (0.7 + 0.3 * Math.sin((i / n) * Math.PI));
    out += leaf(x, y, t + dir + (i % 2 ? 38 : -38) + (i % 2 ? 0 : 180) * 0, sz, i % 3 === 1 ? alt : fill);
    out += leaf(x, y, t + dir + (i % 2 ? -150 : 150), sz * .8, i % 3 === 2 ? alt : fill);
  }
  return out;
}

export const heartPath = (cx, cy, w) => {
  const s = w / 180;
  const p = (x, y) => `${r(cx + (x - 240) * s)} ${r(cy + (y - 250) * s)}`;
  return `M${p(240, 330)}C${p(150, 270)} ${p(150, 175)} ${p(205, 175)}C${p(225, 175)} ${p(236, 188)} ${p(240, 200)}C${p(244, 188)} ${p(255, 175)} ${p(275, 175)}C${p(330, 175)} ${p(330, 270)} ${p(240, 330)}Z`;
};

export function stitchedHeart(cx, cy, w, fill = C.terra, stitch = C.cream) {
  return `<path d="${heartPath(cx, cy, w)}" fill="${fill}"/><path d="${heartPath(cx, cy + w * .02, w * .8)}" fill="none" stroke="${stitch}" stroke-width="${r(Math.max(1.5, w / 60))}" stroke-dasharray="${r(w / 22)} ${r(w / 30)}" stroke-linecap="round"/>`;
}

const xStitch = (x, y, s, col) => `<path d="M${x - s} ${y - s}L${x + s} ${y + s}M${x + s} ${y - s}L${x - s} ${y + s}" stroke="${col}" stroke-width="2.2" stroke-linecap="round"/>`;

// Hero: embroidery hoop with a stitched heart held by two hands inside a leafy wreath.
export function hoop({ title = '', id = 'hoop' } = {}) {
  const linen = `<pattern id="${id}-linen" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 4H8M4 0V8" stroke="${C.wood}" stroke-width=".6" opacity=".22"/></pattern>`;
  const hands = (m) => {
    const f = (x) => m ? 480 - x : x;
    const palm = `M240 388C${f(150)} 350 ${f(104)} 272 ${f(118)} 204C${f(122)} 186 ${f(130)} 174 ${f(140)} 166`;
    return `<path d="${palm}" fill="none" stroke="${C.sage7}" stroke-width="24" stroke-linecap="round"/>
<path d="${palm}" fill="none" stroke="${C.sageL}" stroke-width="2" stroke-dasharray="7 7" stroke-linecap="round"/>
<path d="M${f(140)} 166C${f(150)} 156 ${f(164)} 152 ${f(178)} 156M${f(124)} 178C${f(126)} 160 ${f(136)} 146 ${f(152)} 140M${f(116)} 196C${f(110)} 178 ${f(114)} 160 ${f(126)} 148" fill="none" stroke="${C.sage7}" stroke-width="10" stroke-linecap="round"/>`;
  };
  return `<svg class="hoop" viewBox="0 0 480 500" role="img" aria-labelledby="${id}-t" xmlns="http://www.w3.org/2000/svg"><title id="${id}-t">${title}</title>
<defs>${linen}</defs>
<rect x="222" y="6" width="36" height="30" rx="6" fill="${C.wood7}"/><circle cx="240" cy="16" r="6" fill="${C.mustard}"/>
<circle cx="240" cy="250" r="214" fill="none" stroke="${C.wood}" stroke-width="18"/>
<circle cx="240" cy="250" r="214" fill="none" stroke="${C.wood7}" stroke-width="1.5" stroke-dasharray="2 10" opacity=".7"/>
<circle cx="240" cy="250" r="203" fill="${C.cream}"/><circle cx="240" cy="250" r="203" fill="url(#${id}-linen)"/>
<circle cx="240" cy="250" r="190" fill="none" stroke="${C.mustard}" stroke-width="2" stroke-dasharray="3 9" stroke-linecap="round"/>
${vine(240, 262, 168, 128, 232, 9, 30)}
${vine(240, 262, 168, 52, -52, 9, 30, { fill: C.sage, alt: C.mustard })}
${hands(false)}${hands(true)}
${stitchedHeart(240, 262, 150)}
${xStitch(120, 120, 6, C.mustard)}${xStitch(366, 112, 6, C.terra)}${xStitch(392, 370, 5, C.plum)}${xStitch(92, 360, 5, C.mustard)}
<circle cx="168" cy="96" r="4" fill="${C.terra}"/><circle cx="318" cy="84" r="3.5" fill="${C.sage7}"/><circle cx="420" cy="250" r="4" fill="${C.mustard}"/><circle cx="62" cy="250" r="3.5" fill="${C.terra}"/>
<g transform="rotate(38 404 430)"><rect x="396" y="370" width="7" height="104" rx="3.5" fill="#9AA0A6"/><rect x="398" y="374" width="3" height="14" rx="1.5" fill="${C.cream}"/></g>
<path d="M392 384C440 400 470 440 458 488" fill="none" stroke="${C.terra}" stroke-width="3" stroke-linecap="round"/>
</svg>`;
}

// Aid-area emblems: fabric patches with stitched borders.
function patch(id, bg, inner, title) {
  return `<svg viewBox="0 0 160 160" class="emblem" role="img" aria-label="${title}" xmlns="http://www.w3.org/2000/svg"><circle cx="80" cy="80" r="76" fill="${bg}"/><circle cx="80" cy="80" r="68" fill="none" stroke="${C.cream}" stroke-width="2.5" stroke-dasharray="6 6" stroke-linecap="round" opacity=".9"/>${inner}</svg>`;
}
export const emblems = {
  alimentaire: (t) => patch('al', C.mustardL, `
<path d="M62 52c-8-10 8-14 0-24M80 50c-8-10 8-14 0-24M98 52c-8-10 8-14 0-24" fill="none" stroke="${C.sage7}" stroke-width="4" stroke-linecap="round"/>
<path d="M32 76h96c0 28-20 48-48 48S32 104 32 76z" fill="${C.terra}"/>
<path d="M38 86h84" stroke="${C.cream}" stroke-width="2.5" stroke-dasharray="5 5" stroke-linecap="round"/>
<path d="M60 124h40" stroke="${C.terra7}" stroke-width="8" stroke-linecap="round"/>
<circle cx="56" cy="72" r="6" fill="${C.sage}"/><circle cx="72" cy="70" r="6" fill="${C.cream}"/><circle cx="90" cy="71" r="6" fill="${C.sage7}"/><circle cx="105" cy="72" r="6" fill="${C.cream}"/>`, t),
  vestimentaire: (t) => patch('ve', C.sageL, `
<path d="M80 30c-6 0-8 4-8 7 0 4 4 6 8 8l40 22H40l40-22" fill="none" stroke="${C.plum}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
<path d="M52 64l-22 14 8 18 12-6v38h60V90l12 6 8-18-22-14c-4 8-12 12-28 12s-24-4-28-12z" fill="${C.terra}"/>
<path d="M60 84v40M100 84v40" stroke="${C.cream}" stroke-width="2.5" stroke-dasharray="5 5" stroke-linecap="round"/>
<path d="M50 104h60" stroke="${C.mustard}" stroke-width="6"/><path d="M50 114h60" stroke="${C.plum}" stroke-width="3"/>`, t),
  academique: (t) => patch('ac', '#F4C9B4', `
<path d="M80 48c-14-8-32-10-50-8v72c18-2 36 0 50 8 14-8 32-10 50-8V40c-18-2-36 0-50 8z" fill="${C.cream}" stroke="${C.plum}" stroke-width="4" stroke-linejoin="round"/>
<path d="M80 48v72" stroke="${C.plum}" stroke-width="4"/>
<path d="M40 60c10-1 20 0 30 4M40 74c10-1 20 0 30 4M40 88c10-1 20 0 30 4M90 64c10-4 20-5 30-4M90 78c10-4 20-5 30-4" stroke="${C.sage7}" stroke-width="3" stroke-linecap="round" stroke-dasharray="4 4"/>
<g transform="rotate(-38 112 104)"><rect x="104" y="74" width="16" height="56" rx="3" fill="${C.mustard}"/><path d="M104 130l8 14 8-14z" fill="${C.wood}"/><rect x="104" y="74" width="16" height="9" fill="${C.terra}"/></g>`, t),
  materielle: (t) => patch('ma', '#D9C3D4', `
<rect x="40" y="66" width="80" height="58" rx="4" fill="${C.sage7}"/>
<rect x="34" y="52" width="92" height="20" rx="4" fill="${C.sage}"/>
<path d="M80 52v72" stroke="${C.terra}" stroke-width="10"/>
<path d="M80 52c-10-18-30-18-28-6 2 8 18 8 28 6zM80 52c10-18 30-18 28-6-2 8-18 8-28 6z" fill="${C.mustard}"/>
<path d="M46 80v38M114 80v38" stroke="${C.cream}" stroke-width="2.5" stroke-dasharray="5 5" stroke-linecap="round"/>
<path d="${heartPath(80, 98, 26)}" fill="${C.cream}"/>`, t),
};

// Category glyphs for timeline / events (24px).
export const glyph = {
  fondation: `<path d="${heartPath(12, 12, 20)}" fill="currentColor"/>`,
  collecte: `<path d="M4 9h16l-2 11H6zM8 9l3-5M16 9l-3-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`,
  maraude: `<path d="M17 4a8 8 0 1 0 3 12A7 7 0 0 1 17 4z" fill="currentColor"/>`,
  atelier: `<path d="M3 8l9-4 9 4-9 4zM7 10v5c3 2 7 2 10 0v-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`,
  partenariat: `<path d="M3 12l4-4 5 3 5-3 4 4-9 7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`,
  priere: `<path d="M12 3v18M7 8h10" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>`,
  international: `<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3.5 12h17M12 3.5c3 3 3 14 0 17M12 3.5c-3 3-3 14 0 17" fill="none" stroke="currentColor" stroke-width="1.6"/>`,
  communaute: `<circle cx="8" cy="9" r="3" fill="currentColor"/><circle cx="16" cy="9" r="3" fill="currentColor"/><path d="M3 19c1-4 9-4 9 0M12 19c1-4 9-4 9 0" fill="none" stroke="currentColor" stroke-width="2"/>`,
  gift: `<path d="M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7c-2-4-6-4-5-1 .5 1.5 3 1 5 1zM12 7c2-4 6-4 5-1-.5 1.5-3 1-5 1z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`,
  shield: `<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8.5 12l2.5 2.5 4.5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  aujourdhui: `<path d="M12 2l2.6 6.3 6.4.5-4.9 4.2 1.5 6.5L12 16l-5.6 3.5 1.5-6.5L3 8.8l6.4-.5z" fill="currentColor"/>`,
};
export const icon = (name, cls = 'glyph') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${glyph[name] || glyph.fondation}</svg>`;

export const ui = {
  arrow: `<svg class="i" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  chevron: `<svg class="i" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  close: `<svg class="i" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`,
  prev: `<svg class="i" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  next: `<svg class="i" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  play: `<svg class="i" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>`,
  pause: `<svg class="i" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>`,
  cal: `<svg class="i" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3.5" y="5" width="17" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  pin: `<svg class="i" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="9.5" r="2.5" fill="currentColor"/></svg>`,
  clock: `<svg class="i" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  mail: `<svg class="i" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="5.5" width="18" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 7l8 6 8-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`,
  check: `<svg class="i" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  copy: `<svg class="i" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 5H6a2 2 0 0 0-2 2v9" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,
  menu: `<svg class="i" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`,
  rss: `<svg class="i" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 5a14 14 0 0 1 14 14M5 11a8 8 0 0 1 8 8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="6" cy="18" r="2" fill="currentColor"/></svg>`,
  heart: `<svg class="i" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${heartPath(12, 12.5, 22)}" fill="currentColor"/></svg>`,
};

// Inline brand mark for the header: stitched heart in a small hoop.
export const mark = `<svg class="mark" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><circle cx="32" cy="32" r="29" fill="${C.cream}" stroke="${C.wood}" stroke-width="4"/>${vine(32, 34, 21, 120, 240, 4, 9)}${vine(32, 34, 21, 60, -60, 4, 9, { alt: C.mustard })}${stitchedHeart(32, 35, 30)}</svg>`;

// Where-we-serve diagram: concentric hoops, city/region level only.
export function serveMap(labels, id = 'map') {
  const knots = [[300, 140], [438, 230], [452, 382], [168, 448], [140, 258], [215, 168]];
  const far = [[300, 40], [552, 210], [520, 470], [86, 474], [48, 250], [140, 92]];
  return `<svg class="serve-map__svg" viewBox="0 0 600 600" role="img" aria-labelledby="${id}-t ${id}-d" xmlns="http://www.w3.org/2000/svg">
<title id="${id}-t">${labels.title}</title><desc id="${id}-d">${labels.desc}</desc>
<defs><pattern id="${id}-linen" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M0 5H10M5 0V10" stroke="${C.wood}" stroke-width=".6" opacity=".2"/></pattern></defs>
<g class="ring ring--intl" data-ring="intl"><circle cx="300" cy="300" r="270" fill="${C.sand2}"/><circle cx="300" cy="300" r="270" fill="url(#${id}-linen)"/><circle class="ring__line" cx="300" cy="300" r="262" fill="none" stroke="${C.plum}" stroke-width="2.5" stroke-dasharray="2 12" stroke-linecap="round"/></g>
<g class="ring ring--canada" data-ring="canada"><circle cx="300" cy="300" r="185" fill="#EAF0E5"/><circle class="ring__line" cx="300" cy="300" r="178" fill="none" stroke="${C.sage7}" stroke-width="2.5" stroke-dasharray="8 8" stroke-linecap="round"/></g>
<clipPath id="${id}-clip"><circle cx="300" cy="300" r="268"/></clipPath><g clip-path="url(#${id}-clip)"><path d="M40 420C140 380 200 360 260 320S380 230 470 210 560 150 590 120" fill="none" stroke="#B9CBB3" stroke-width="16" stroke-linecap="round" opacity=".7"/>
<path d="M40 420C140 380 200 360 260 320S380 230 470 210 560 150 590 120" fill="none" stroke="${C.cream}" stroke-width="2" stroke-dasharray="6 8" opacity=".9"/></g>
<g class="threads" fill="none" stroke-linecap="round">${knots.map(([x, y]) => `<path d="M300 300Q${(300 + x) / 2 + 20} ${(300 + y) / 2 - 20} ${x} ${y}" stroke="${C.sage7}" stroke-width="2" stroke-dasharray="5 6"/>`).join('')}${far.map(([x, y]) => `<path d="M300 300Q${(300 + x) / 2 - 30} ${(300 + y) / 2 + 30} ${x} ${y}" stroke="${C.plum}" stroke-width="1.6" stroke-dasharray="2 7" opacity=".7"/>`).join('')}</g>
${knots.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="8" fill="${C.sage7}"/><circle cx="${x}" cy="${y}" r="3" fill="${C.cream}"/>`).join('')}
${far.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7" fill="${C.cream}" stroke="${C.plum}" stroke-width="2.5"/>`).join('')}
<g class="ring ring--mtl" data-ring="mtl"><circle cx="300" cy="300" r="62" fill="${C.mustard}"/><circle class="ring__line" cx="300" cy="300" r="54" fill="none" stroke="${C.plum}" stroke-width="2.5" stroke-dasharray="6 6" stroke-linecap="round"/>${stitchedHeart(300, 304, 64, C.terra)}</g>
</svg>`;
}

// Gallery placeholder illustrations (written to dist/assets/illustrations/*.svg).
const frame = (bg, body, band = C.terra) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600"><rect width="800" height="600" fill="${bg}"/>${body}<rect y="560" width="800" height="40" fill="${band}"/><g fill="${C.cream}">${Array.from({ length: 20 }, (_, i) => `<path d="M${i * 40} 600l20-30 20 30z" opacity=".9"/><circle cx="${i * 40 + 20}" cy="566" r="3"/>`).join('')}</g></svg>`;
export const illustrations = {
  'maraude-nuit': () => frame(C.plum, `
<g fill="${C.mustardL}">${[[90, 80], [210, 140], [330, 60], [520, 110], [650, 70], [720, 170], [150, 200]].map(([x, y]) => `<path d="M${x} ${y - 8}l2.5 6 6 2.5-6 2.5-2.5 6-2.5-6-6-2.5 6-2.5z"/>`).join('')}</g>
<circle cx="620" cy="150" r="56" fill="${C.mustard}"/><circle cx="644" cy="132" r="56" fill="${C.plum}"/>
<path d="M0 560V380h60v-60h70v90h50V300h80v110h40v-70h90v220z" fill="${C.plum9}"/>
<path d="M460 560V330h90v-50h60v120h50V350h70v80h70v130z" fill="${C.plum9}"/>
<g fill="${C.mustardL}" opacity=".85"><rect x="80" y="340" width="12" height="16"/><rect x="200" y="320" width="12" height="16"/><rect x="226" y="360" width="12" height="16"/><rect x="490" y="360" width="12" height="16"/><rect x="580" y="300" width="12" height="16"/><rect x="690" y="380" width="12" height="16"/></g>
<rect x="300" y="380" width="200" height="180" rx="12" fill="${C.terra}"/><path d="M312 396h176v148H312z" fill="none" stroke="${C.cream}" stroke-width="3" stroke-dasharray="9 8"/>
<rect x="340" y="320" width="44" height="90" rx="10" fill="${C.sage}"/><rect x="346" y="306" width="32" height="20" rx="5" fill="${C.sage7}"/>
<path d="M410 360h50l-6 50h-38z" fill="${C.cream}"/><path d="M460 372c18 0 18 24 0 24" fill="none" stroke="${C.cream}" stroke-width="6"/>
<path d="M424 350c-8-12 8-16 0-30M444 350c-8-12 8-16 0-30" fill="none" stroke="${C.cream}" stroke-width="4" stroke-linecap="round"/>
<path d="${heartPath(400, 482, 70)}" fill="${C.mustard}"/>`, C.terra7),
  'atelier': () => frame(C.sageL, `
<rect x="140" y="60" width="520" height="250" rx="10" fill="${C.sage7}"/><rect x="152" y="72" width="496" height="226" rx="6" fill="none" stroke="${C.wood}" stroke-width="10"/>
<path d="M200 140h140M200 180h200M200 220h110" stroke="${C.cream}" stroke-width="6" stroke-linecap="round" stroke-dasharray="1 0"/>
<path d="${heartPath(530, 190, 110)}" fill="none" stroke="${C.mustardL}" stroke-width="6"/>
<rect x="80" y="380" width="640" height="26" rx="8" fill="${C.wood7}"/><path d="M120 406v154M680 406v154" stroke="${C.wood7}" stroke-width="16"/>
<path d="M200 380l10-40h120l10 40z" fill="${C.cream}"/><path d="M270 340v40" stroke="${C.plum}" stroke-width="3"/>
<rect x="420" y="330" width="44" height="50" rx="6" fill="${C.terra}"/><path d="M464 340c16 0 16 24 0 24" fill="none" stroke="${C.terra}" stroke-width="6"/>
<g transform="rotate(-20 560 360)"><rect x="520" y="352" width="110" height="14" rx="4" fill="${C.mustard}"/><path d="M630 352l18 7-18 7z" fill="${C.wood}"/></g>`, C.plum),
  'collecte': () => frame(C.mustardL, `
<circle cx="120" cy="110" r="40" fill="${C.mustard}"/>
<path d="M190 300h420l-40 230H230z" fill="${C.terra}"/><path d="M200 330h400" stroke="${C.cream}" stroke-width="4" stroke-dasharray="10 9"/>
<path d="M270 300c0-120 260-120 260 0" fill="none" stroke="${C.wood7}" stroke-width="14" stroke-linecap="round"/>
<rect x="260" y="200" width="70" height="100" rx="8" fill="${C.sage7}"/><rect x="260" y="232" width="70" height="30" fill="${C.cream}"/>
<path d="M350 300c-20-90 120-110 120-20v20z" fill="${C.wood}"/><path d="M380 250l16 20M410 238l16 20M440 246l12 18" stroke="${C.wood7}" stroke-width="5" stroke-linecap="round"/>
<circle cx="500" cy="270" r="34" fill="${C.terra7}"/><path d="M500 236c4-14 16-18 24-16" fill="none" stroke="${C.sage7}" stroke-width="5" stroke-linecap="round"/>
<circle cx="540" cy="290" r="22" fill="${C.sage}"/>
<path d="${heartPath(400, 430, 90)}" fill="${C.cream}"/>`, C.sage7),
  'vetements': () => frame('#F4D9CB', `
<path d="M40 110Q400 170 760 110" fill="none" stroke="${C.plum}" stroke-width="5"/>
<g transform="translate(110 132)"><path d="M0 24l40-24h80l40 24-18 40-22-10v120H40V54L18 64z" fill="${C.sage7}"/><path d="M40 90h80M40 110h80" stroke="${C.mustard}" stroke-width="8"/><path d="M50 80v90M110 80v90" stroke="${C.cream}" stroke-width="3" stroke-dasharray="7 6"/></g>
<g transform="translate(330 146)"><path d="M10 0h100v40c0 10-8 16-16 16H26c-8 0-16-6-16-16z" fill="${C.terra}"/><circle cx="60" cy="-16" r="18" fill="${C.mustard}"/><path d="M10 40h100" stroke="${C.cream}" stroke-width="4" stroke-dasharray="8 6"/><path d="M14 56v24h92V56" fill="${C.cream}"/><path d="M14 64h92M14 74h92" stroke="${C.terra}" stroke-width="4"/></g>
<g transform="translate(500 140)"><path d="M0 0h36v70c0 14 10 20 10 36 0 20-18 30-36 30S-20 120-20 100c0-20 20-24 20-40z" fill="${C.plum}"/><path d="M4 14h28" stroke="${C.mustard}" stroke-width="6"/></g>
<g transform="translate(590 140)"><path d="M0 0h36v70c0 14 10 20 10 36 0 20-18 30-36 30S-20 120-20 100c0-20 20-24 20-40z" fill="${C.plum}"/><path d="M4 14h28" stroke="${C.mustard}" stroke-width="6"/></g>
<g fill="${C.wood7}">${[150, 230, 360, 430, 512, 602].map((x) => `<rect x="${x}" y="${116 + Math.round(Math.sin(x / 120) * 6)}" width="8" height="26" rx="3"/>`).join('')}</g>
<path d="M200 540h400" stroke="${C.wood7}" stroke-width="10" stroke-linecap="round"/>
${[[C.terra, 260], [C.mustard, 310], [C.sage7, 360], [C.plum, 410], [C.terra7, 460]].map(([c, w], i) => `<rect x="${400 - (300 - i * 30) / 2}" y="${500 - i * 30}" width="${300 - i * 30}" height="28" rx="8" fill="${c}"/><path d="M${400 - (300 - i * 30) / 2 + 12} ${514 - i * 30}h${300 - i * 30 - 24}" stroke="${C.cream}" stroke-width="2" stroke-dasharray="6 6" opacity=".8"/>`).join('')}
<path d="${heartPath(400, 340, 50)}" fill="${C.terra}"/>`, C.plum),
  'priere': () => frame(C.plum9, `
<circle cx="400" cy="250" r="190" fill="${C.plum}"/><circle cx="400" cy="250" r="150" fill="none" stroke="${C.mustard}" stroke-width="3" stroke-dasharray="4 12" stroke-linecap="round"/>
<path d="M250 420c50-30 100-30 150 0 50-30 100-30 150 0v60c-50-30-100-30-150 0-50-30-100-30-150 0z" fill="${C.cream}"/><path d="M400 420v60" stroke="${C.terra}" stroke-width="5"/>
<path d="M280 440c30-14 70-14 100 4M420 444c30-18 70-18 100-4" stroke="${C.sage7}" stroke-width="3" stroke-dasharray="5 5"/>
${[[300, 300], [400, 260], [500, 300]].map(([x, y], i) => `<rect x="${x - 18}" y="${y}" width="36" height="${110 - i * 10 + (i === 1 ? 30 : 0)}" rx="6" fill="${C.sand2}"/><path d="M${x} ${y - 4}c-14-18 0-34 0-46 0 12 14 28 0 46z" fill="${C.mustard}"/>`).join('')}`, C.mustard),
  'communaute': () => frame(C.sand2, `
<circle cx="400" cy="320" r="150" fill="${C.wood}"/><circle cx="400" cy="320" r="132" fill="none" stroke="${C.cream}" stroke-width="3" stroke-dasharray="8 8"/>
${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => { const a = i / 8 * Math.PI * 2 - Math.PI / 2; const x = 400 + 210 * Math.cos(a), y = 320 + 190 * Math.sin(a); const col = [C.terra, C.sage7, C.mustard, C.plum][i % 4]; return `<circle cx="${r(x)}" cy="${r(y - 26)}" r="22" fill="${col}"/><path d="M${r(x - 34)} ${r(y + 30)}c0-40 68-40 68 0z" fill="${col}"/>`; }).join('')}
<circle cx="360" cy="300" r="20" fill="${C.terra}"/><circle cx="440" cy="330" r="24" fill="${C.sage}"/><rect x="380" y="340" width="40" height="30" rx="6" fill="${C.cream}"/>
<path d="${heartPath(400, 260, 46)}" fill="${C.mustard}"/>`, C.terra),
};

export const videoPoster = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720"><rect width="1280" height="720" fill="${C.plum}"/><circle cx="640" cy="360" r="300" fill="${C.plum9}"/><circle cx="640" cy="360" r="268" fill="none" stroke="${C.mustard}" stroke-width="4" stroke-dasharray="6 14" stroke-linecap="round"/>${vine(640, 380, 230, 130, 230, 8, 46)}${vine(640, 380, 230, 50, -50, 8, 46, { alt: C.mustard })}${stitchedHeart(640, 380, 220)}</svg>`;

export const ogImage = (title, sub) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630"><rect width="1200" height="630" fill="${C.sand}"/><rect y="590" width="1200" height="40" fill="${C.terra}"/>${hoop({ id: 'og' }).replace('<svg class="hoop" viewBox="0 0 480 500"', '<svg x="690" y="50" width="480" height="500" viewBox="0 0 480 500"')}<text x="70" y="250" font-family="Georgia, serif" font-size="66" font-weight="700" fill="${C.plum}">${title}</text><text x="70" y="320" font-family="Georgia, serif" font-style="italic" font-size="40" fill="${C.terra7}">${sub}</text></svg>`;
