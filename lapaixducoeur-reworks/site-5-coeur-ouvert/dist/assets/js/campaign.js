(() => {
  'use strict';
  const basket = document.querySelector('[data-basket]');
  const dataEl = document.getElementById('gift-data');
  if (!basket || !dataEl) return;
  const cfg = JSON.parse(dataEl.textContent);
  const L = cfg.labels;
  const C = cfg.lang === 'fr' ? ' : ' : ': ';
  const money = (n) => new Intl.NumberFormat(cfg.lang === 'fr' ? 'fr-CA' : 'en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(n);
  const list = basket.querySelector('[data-list]');
  const empty = basket.querySelector('[data-empty]');
  const total = basket.querySelector('[data-total]');
  const matched = basket.querySelector('[data-matched]');
  const zeffy = basket.querySelector('[data-zeffy]');
  const note = basket.querySelector('[data-zeffy-note]');
  const honour = basket.querySelector('#honour');
  const gifts = new Map();
  document.querySelectorAll('[data-gift]').forEach((li) => {
    gifts.set(li.dataset.gift, { el: li, name: li.dataset.name, price: Number(li.dataset.price), qty: 0 });
  });

  const btn = (label, text, fn) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = text; b.setAttribute('aria-label', label);
    b.addEventListener('click', fn);
    return b;
  };

  const render = (focusId) => {
    list.textContent = '';
    let sum = 0;
    gifts.forEach((g, id) => {
      g.el.classList.toggle('is-added', g.qty > 0);
      if (!g.qty) return;
      sum += g.qty * g.price;
      const li = document.createElement('li');
      const name = document.createElement('span'); name.className = 'basket__name'; name.textContent = g.name;
      const line = document.createElement('span'); line.className = 'basket__line'; line.textContent = money(g.qty * g.price);
      const qty = document.createElement('span'); qty.className = 'basket__qty';
      const out = document.createElement('output'); out.textContent = String(g.qty); out.setAttribute('aria-label', `${L.qty}${C}${g.name}`);
      const minus = btn(`${L.remove}${C}${g.name}`, '−', () => { g.qty = Math.max(0, g.qty - 1); render(g.qty ? `${id}-minus` : null); });
      const plus = btn(`${L.add}${C}${g.name}`, '+', () => { g.qty += 1; render(`${id}-plus`); });
      minus.dataset.fid = `${id}-minus`; plus.dataset.fid = `${id}-plus`;
      qty.append(minus, out, plus);
      li.append(name, line, qty);
      list.appendChild(li);
    });
    empty.hidden = sum > 0;
    total.textContent = money(sum);
    if (matched) matched.textContent = money(cfg.matching ? sum * 2 : sum);
    zeffy.disabled = sum === 0;
    note.hidden = true;
    const announce = basket.querySelector('.basket__total');
    if (announce) announce.setAttribute('aria-live', 'polite');
    if (focusId) { const f = list.querySelector(`[data-fid="${focusId}"]`); if (f) f.focus(); }
  };

  document.querySelectorAll('[data-add]').forEach((b) => {
    b.addEventListener('click', () => {
      const g = gifts.get(b.closest('[data-gift]').dataset.gift);
      g.qty += 1;
      render();
    });
  });

  zeffy.addEventListener('click', () => {
    const who = honour.value.trim();
    note.textContent = `${L.zeffyNote}${who ? ` — ${who}` : ''} (${total.textContent})`;
    note.hidden = false;
  });

  render();
})();
