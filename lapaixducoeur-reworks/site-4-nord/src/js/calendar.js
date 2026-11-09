/* Events calendar: month grid / list toggle, type filters, shareable URL state. The list is server-rendered. */
(() => {
  'use strict';
  const dataEl = document.getElementById('cal-data');
  if (!dataEl) return;
  const D = JSON.parse(dataEl.textContent);
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const toolbar = $('[data-cal-toolbar]'); const gridWrap = $('[data-cal-grid]'); const list = $('[data-cal-list]');
  const status = $('[data-cal-status]'); const empty = $('[data-cal-empty]'); const title = $('[data-month-title]'); const monthNav = $('[data-month-nav]');
  const locale = D.lang === 'fr' ? 'fr-CA' : 'en-CA';
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } } };
  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const todayIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  const params = new URLSearchParams(location.search);
  const active = new Set((params.get('type') || '').split(',').filter((t) => D.types[t]));
  let view = params.get('view') || store.get('lpdc-cal-view') || (window.matchMedia('(min-width: 800px)').matches ? 'month' : 'list');
  if (view !== 'month' && view !== 'list') view = 'list';
  const firstUpcoming = D.events.find((e) => e.date >= todayIso) || D.events[0];
  let month = params.get('month') || (firstUpcoming ? firstUpcoming.date.slice(0, 7) : todayIso.slice(0, 7));
  if (!/^\d{4}-\d{2}$/.test(month)) month = todayIso.slice(0, 7);

  const matches = (type) => active.size === 0 || active.has(type);
  const shownLabel = (n) => (n === 1 ? D.shownOne : D.shownMany.replace('9999', n));

  function syncUrl() {
    const p = new URLSearchParams();
    p.set('view', view);
    if (view === 'month') p.set('month', month);
    if (active.size) p.set('type', [...active].join(','));
    history.replaceState(null, '', `${location.pathname}?${p}`);
  }

  function renderGrid() {
    const [y, m] = month.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const days = new Date(y, m, 0).getDate();
    const start = new Date(y, m - 1, 1 - first.getDay());
    const label = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(first);
    title.textContent = label.charAt(0).toUpperCase() + label.slice(1);
    const weeks = Math.ceil((first.getDay() + days) / 7);
    const byDate = {};
    D.events.filter((e) => matches(e.type)).forEach((e) => { (byDate[e.date] = byDate[e.date] || []).push(e); });
    const t = document.createElement('table');
    t.className = 'cal-grid';
    let html = `<caption class="visually-hidden">${title.textContent}</caption><thead><tr>${D.weekdays.map((w) => `<th scope="col">${w}</th>`).join('')}</tr></thead><tbody>`;
    const d = new Date(start);
    for (let w = 0; w < weeks; w++) {
      html += '<tr>';
      for (let i = 0; i < 7; i++) {
        const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        const out = d.getMonth() !== m - 1;
        const evs = byDate[iso] || [];
        const dayLabel = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
        html += `<td class="${out ? 'is-out' : ''}${iso === todayIso ? ' is-today' : ''}"><span class="cal-day"${iso === todayIso ? ` aria-label="${D.today} — ${dayLabel}"` : ''}>${d.getDate()}</span>`;
        html += evs.map((e) => `<a class="cal-ev tag-${e.type}" href="${e.url}"><b>${e.time}</b><span>${escapeHtml(e.title)}</span><span class="visually-hidden">, ${dayLabel}, ${D.types[e.type]}</span></a>`).join('');
        html += '</td>';
        d.setDate(d.getDate() + 1);
      }
      html += '</tr>';
    }
    t.innerHTML = html + '</tbody>';
    gridWrap.replaceChildren(t);
  }

  function escapeHtml(s) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function render() {
    $$('[data-view]', toolbar).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    $$('[data-type-filter]', toolbar).forEach((b) => b.setAttribute('aria-pressed', String(active.has(b.dataset.typeFilter))));
    monthNav.hidden = view !== 'month';
    gridWrap.hidden = view !== 'month';
    list.classList.toggle('agenda-mode', view === 'month');
    let shown = 0;
    $$('.ev-row', list).forEach((r) => {
      const ok = matches(r.dataset.type) && (view === 'list' || r.dataset.month === month);
      r.hidden = !ok; if (ok) shown += 1;
    });
    $$('.month-group', list).forEach((g) => { g.hidden = !$$('.ev-row', g).some((r) => !r.hidden); });
    empty.hidden = shown > 0;
    if (view === 'month') renderGrid();
    status.textContent = shownLabel(shown);
    syncUrl();
  }

  toolbar.hidden = false;
  toolbar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.view) { view = b.dataset.view; store.set('lpdc-cal-view', view); }
    if (b.dataset.typeFilter) { const t = b.dataset.typeFilter; if (active.has(t)) active.delete(t); else active.add(t); }
    if (b.dataset.monthStep) {
      const [y, m] = month.split('-').map(Number);
      const n = new Date(y, m - 1 + Number(b.dataset.monthStep), 1);
      month = `${n.getFullYear()}-${pad(n.getMonth() + 1)}`;
    }
    render();
  });
  render();
})();
