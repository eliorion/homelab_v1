(() => {
  const root = document.querySelector('[data-timeline]');
  if (!root) return;
  const list = root.querySelector('.timeline');
  const items = [...root.querySelectorAll('.milestone')];
  const links = [...root.querySelectorAll('[data-year-link]')];
  const bar = root.querySelector('.timeline__progress');
  const linkFor = (li) => links.find((a) => a.hash === `#${li.id}`);
  const smooth = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
  let current = null;

  function setActive(li) {
    if (current === li) return;
    current = li;
    items.forEach((m) => m.classList.toggle('is-active', m === li));
    links.forEach((a) => a.removeAttribute('aria-current'));
    const a = li && linkFor(li);
    if (a) {
      a.setAttribute('aria-current', 'true');
      const strip = a.closest('.tl-years');
      strip.scrollTo({ left: a.offsetLeft - strip.clientWidth / 2 + a.clientWidth / 2, behavior: smooth() });
    }
  }
  function onScroll() {
    const mid = innerHeight * 0.45;
    let best = null;
    for (const m of items) { if (!m.hidden && m.getBoundingClientRect().top <= mid) best = m; }
    setActive(best || items.find((m) => !m.hidden));
    const r = list.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (mid - r.top) / r.height));
    bar.style.setProperty('--p', `${(p * 100).toFixed(1)}%`);
  }
  let raf = 0;
  addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; onScroll(); }); }, { passive: true });
  root.addEventListener('filterchange', () => {
    links.forEach((a) => {
      const li = document.getElementById(a.hash.slice(1));
      a.classList.toggle('is-hidden', li.hidden);
      a.tabIndex = li.hidden ? -1 : 0;
      a.toggleAttribute('aria-disabled', li.hidden);
    });
    current = null;
    onScroll();
  });
  links.forEach((a) => a.addEventListener('click', (e) => {
    const li = document.getElementById(a.hash.slice(1));
    if (li.hidden) { e.preventDefault(); return; }
    setTimeout(() => { const s = li.querySelector('summary'); if (s) s.focus({ preventScroll: true }); }, 450);
  }));
  onScroll();
})();
