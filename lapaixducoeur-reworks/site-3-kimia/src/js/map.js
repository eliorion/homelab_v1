(() => {
  const root = document.querySelector('[data-serve]');
  if (!root) return;
  const svg = root.querySelector('.serve-map__svg');
  const btns = [...root.querySelectorAll('[data-zone]')];
  const panels = [...root.querySelectorAll('[data-zone-panel]')];
  const select = (key, focusBtn) => {
    btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.zone === key)));
    panels.forEach((p) => { p.hidden = p.dataset.zonePanel !== key; });
    svg.dataset.active = key;
    if (focusBtn) btns.find((b) => b.dataset.zone === key).focus();
  };
  btns.forEach((b) => { b.hidden = false; b.addEventListener('click', () => select(b.dataset.zone)); });
  root.querySelector('.serve-legend').addEventListener('keydown', (e) => {
    const i = btns.indexOf(document.activeElement);
    if (i < 0 || !['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].includes(e.key)) return;
    e.preventDefault();
    const fwd = e.key === 'ArrowDown' || e.key === 'ArrowRight';
    select(btns[(i + (fwd ? 1 : btns.length - 1)) % btns.length].dataset.zone, true);
  });
  svg.addEventListener('click', (e) => { const g = e.target.closest('[data-ring]'); if (g) select(g.dataset.ring); });
  select('mtl');
})();
