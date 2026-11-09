(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const fr = document.documentElement.lang.startsWith('fr');
  const wide = () => innerWidth >= 1100;

  /* navigation: sub-menus */
  const toggles = $$('.nav__toggle');
  toggles.forEach((btn) => {
    const sub = document.getElementById(btn.getAttribute('aria-controls'));
    const item = btn.parentElement;
    btn.hidden = false;
    const set = (open) => { btn.setAttribute('aria-expanded', String(open)); sub.classList.toggle('is-open', open); };
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') !== 'true';
      toggles.forEach((b) => { if (b !== btn && b.getAttribute('aria-expanded') === 'true') b.click(); });
      set(open);
    });
    item.addEventListener('keydown', (e) => { if (e.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true') { e.stopPropagation(); set(false); btn.focus(); } });
    item.addEventListener('focusout', (e) => { if (wide() && !item.contains(e.relatedTarget)) set(false); });
  });
  document.addEventListener('click', (e) => {
    if (!wide() || e.target.closest('.nav__item')) return;
    toggles.forEach((b) => { if (b.getAttribute('aria-expanded') === 'true') b.click(); });
  });

  /* navigation: mobile menu (without JS it is a link to the footer site map) */
  const menuBtn = $('[data-menu-toggle]'), nav = $('#site-nav');
  if (menuBtn && nav) {
    const label = menuBtn.querySelector('span'), txt = label.textContent;
    menuBtn.setAttribute('role', 'button');
    menuBtn.setAttribute('aria-expanded', 'false');
    const set = (open) => {
      nav.classList.toggle('is-open', open);
      document.body.classList.toggle('menu-open', open);
      menuBtn.setAttribute('aria-expanded', String(open));
      label.textContent = open ? (fr ? 'Fermer' : 'Close') : txt;
      if (open) nav.querySelector('a').focus();
    };
    menuBtn.addEventListener('click', (e) => { e.preventDefault(); set(menuBtn.getAttribute('aria-expanded') !== 'true'); });
    menuBtn.addEventListener('keydown', (e) => { if (e.key === ' ') { e.preventDefault(); menuBtn.click(); } });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('is-open')) { set(false); menuBtn.focus(); } });
    matchMedia('(min-width: 1100px)').addEventListener('change', (m) => { if (m.matches) set(false); });
  }

  /* reveal on scroll */
  const rev = $$('.reveal');
  if ('IntersectionObserver' in window && !reduced.matches) {
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
    rev.forEach((el) => io.observe(el));
  } else rev.forEach((el) => el.classList.add('is-in'));

  /* generic filter chips: [data-filter-group] filters [data-cat] items in the same scope */
  $$('[data-filter-group]').forEach((group) => {
    const scope = group.closest('[data-timeline],[data-gallery],.wrap');
    const items = $$('[data-cat]', scope);
    const status = $('[data-filter-status]', scope), empty = $('[data-filter-empty]', scope);
    group.addEventListener('click', (e) => {
      const b = e.target.closest('[data-filter]');
      if (!b) return;
      const f = b.dataset.filter;
      $$('[data-filter]', group).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      let n = 0;
      items.forEach((it) => { const show = f === 'all' || it.dataset.cat === f || it.hasAttribute('data-always'); it.hidden = !show; if (show) n++; });
      if (status) status.textContent = `${n} ${status.dataset.label}`;
      if (empty) empty.hidden = n > 0;
      scope.dispatchEvent(new CustomEvent('filterchange', { detail: { filter: f } }));
    });
  });

  /* forms: validation, honeypot, friendly confirmation (a Pages Function receives the POST in production) */
  const msgs = fr
    ? { req: 'Ce champ est obligatoire.', email: 'Veuillez entrer un courriel valide.', consent: 'Veuillez cocher cette case pour continuer.' }
    : { req: 'This field is required.', email: 'Please enter a valid email address.', consent: 'Please tick this box to continue.' };
  const errFor = (el) => {
    const n = el.closest('.field, .check');
    if (!n) return null;
    const sib = n.nextElementSibling;
    return sib && sib.classList.contains('err') ? sib : $('.err', n);
  };
  let uid = 0;
  window.kimiaValidate = (els) => {
    let first = null;
    els.forEach((el) => {
      let m = '';
      if (el.type === 'checkbox') { if (el.required && !el.checked) m = msgs.consent; }
      else if (el.required && !el.value.trim()) m = msgs.req;
      else if (el.type === 'email' && el.value && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(el.value)) m = msgs.email;
      const er = errFor(el);
      if (er) {
        if (!er.id) er.id = `err-${++uid}`;
        er.textContent = m;
        el.setAttribute('aria-describedby', er.id);
      }
      el.setAttribute('aria-invalid', m ? 'true' : 'false');
      if (m && !first) first = el;
    });
    if (first) first.focus();
    return !first;
  };
  $$('form[data-form]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!window.kimiaValidate($$('input[required], textarea[required], select[required], input[type=email]', form))) return;
      if (form.website && form.website.value) return; // honeypot filled: silently drop
      const ok = document.createElement('p');
      ok.className = 'form-ok';
      ok.setAttribute('role', 'status');
      ok.tabIndex = -1;
      ok.innerHTML = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      ok.append(document.createTextNode(form.dataset.ok));
      form.replaceWith(ok);
      ok.focus();
    });
  });

  /* copy buttons */
  $$('[data-copy]').forEach((b) => {
    b.hidden = false;
    b.addEventListener('click', async () => {
      const st = b.parentElement.querySelector('.status');
      try { await navigator.clipboard.writeText(b.dataset.copy); if (st) st.textContent = b.dataset.copied; } catch { if (st) st.textContent = b.dataset.copy; }
      setTimeout(() => { if (st) st.textContent = ''; }, 3000);
    });
  });

  /* signature motion: an embroidery thread that stitches itself down the page */
  const main = $('#main');
  const knots = main ? $$('[data-knot]', main) : [];
  if (knots.length < 3) return;
  const NS = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs) => { const el = document.createElementNS(NS, tag); for (const k in attrs) el.setAttribute(k, attrs[k]); return el; };
  const svg = mk('svg', { class: 'thread', 'aria-hidden': 'true', focusable: 'false' });
  const mask = mk('mask', { id: 'thread-mask', maskUnits: 'userSpaceOnUse' });
  const reveal = mk('path', { fill: 'none', stroke: '#fff', 'stroke-width': '12', 'stroke-linecap': 'round' });
  mask.append(reveal);
  const defs = mk('defs', {});
  defs.append(mask);
  const shadow = mk('path', { class: 'thread__shadow', mask: 'url(#thread-mask)' });
  const line = mk('path', { class: 'thread__line', mask: 'url(#thread-mask)' });
  const knotG = mk('g', {});
  const needle = mk('circle', { class: 'thread__needle', r: '5' });
  svg.append(defs, shadow, line, knotG, needle);
  main.prepend(svg);
  let L = 0, samples = [], knotLens = [];

  function build() {
    const W = main.clientWidth, H = main.offsetHeight;
    const top = main.getBoundingClientRect().top;
    const gut = (W - Math.min(W - 32, 1200)) / 2;
    const narrow = gut < 70;
    const xL = narrow ? 7 : Math.max(20, gut / 2), xR = W - xL;
    const w = narrow ? 2.5 : 16;
    const ys = knots.map((k) => k.getBoundingClientRect().top - top).filter((y) => y > 120 && y < H - 60);
    let x = narrow ? xL : xR, y = 0, d = `M${x} ${y}`;
    const pts = [];
    ys.forEach((yb) => {
      const y1 = narrow ? yb : yb - 70, dy = y1 - y;
      d += ` C${x + w} ${y + dy / 3} ${x - w} ${y + (2 * dy) / 3} ${x} ${y1}`;
      if (narrow) { pts.push([x, yb]); y = yb; return; }
      const nx = x === xR ? xL : xR;
      d += ` C${x} ${yb + 10} ${nx} ${yb - 10} ${nx} ${yb + 70}`;
      pts.push([(x + nx) / 2, yb]);
      x = nx; y = yb + 70;
    });
    const yEnd = H - 24, dyE = yEnd - y;
    d += ` C${x + w} ${y + dyE / 3} ${x - w} ${y + (2 * dyE) / 3} ${x} ${yEnd}`;
    pts.push([x, yEnd]);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    Object.entries({ x: 0, y: 0, width: W, height: H }).forEach(([k, v]) => mask.setAttribute(k, v));
    [reveal, shadow, line].forEach((p) => p.setAttribute('d', d));
    L = reveal.getTotalLength();
    samples = [];
    for (let i = 0; i <= 400; i++) { const l = (L * i) / 400; samples.push([l, reveal.getPointAtLength(l).y]); }
    const lenAtY = (yy) => { for (const [l, sy] of samples) if (sy >= yy) return l; return L; };
    knotG.replaceChildren(...pts.map(([px, py]) => mk('circle', { class: 'thread__knot', cx: px, cy: py, r: narrow ? 4.5 : 7 })));
    knotLens = pts.map(([, py]) => lenAtY(py) - 2);
    reveal.style.strokeDasharray = `${L} ${L}`;
    update();
  }
  function update() {
    if (!L) return;
    let len = L;
    if (!reduced.matches) {
      const target = innerHeight * 0.62 - main.getBoundingClientRect().top;
      len = 0;
      for (const [l, sy] of samples) { if (sy > target) break; len = l; }
    }
    reveal.style.strokeDashoffset = String(L - len);
    const p = reveal.getPointAtLength(len);
    needle.setAttribute('cx', p.x);
    needle.setAttribute('cy', p.y);
    needle.style.display = reduced.matches || len >= L - 1 || len <= 0 ? 'none' : '';
    [...knotG.children].forEach((c, i) => c.classList.toggle('is-on', len >= knotLens[i]));
  }
  let raf = 0, timer;
  addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; update(); }); }, { passive: true });
  new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(build, 120); }).observe(main);
  reduced.addEventListener('change', update);
  build();
})();
