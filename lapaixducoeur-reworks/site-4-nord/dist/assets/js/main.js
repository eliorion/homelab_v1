/* La Paix du Cœur — site behaviour. No dependencies, progressive enhancement only. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } },
  };

  /* ---- mobile navigation ---- */
  const toggle = $('[data-nav-toggle]');
  const nav = $('#site-nav');
  if (toggle && nav) {
    const setOpen = (open) => {
      toggle.setAttribute('aria-expanded', String(open));
      nav.classList.toggle('is-open', open);
      $('[data-label-open]', toggle).hidden = open;
      $('[data-label-close]', toggle).hidden = !open;
    };
    toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('is-open')) { setOpen(false); toggle.focus(); } });
  }

  /* ---- copy to clipboard ---- */
  const flash = (btn, label) => {
    const span = $('span', btn) || btn;
    const prev = span.textContent;
    span.textContent = label;
    setTimeout(() => { span.textContent = prev; }, 1800);
  };
  const copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.className = 'visually-hidden';
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      ta.remove(); return ok;
    }
  };
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy], [data-copy-text]');
    if (!btn) return;
    const text = btn.dataset.copyText || ($(btn.dataset.copy) || {}).textContent || '';
    if (await copyText(text.trim())) flash(btn, btn.dataset.copied || '✓');
  });

  /* ---- share (Web Share API, falls back to copying the URL) ---- */
  $$('[data-share]').forEach((btn) => btn.addEventListener('click', async () => {
    const data = { title: btn.dataset.title || document.title, url: location.href };
    if (navigator.share) { try { await navigator.share(data); return; } catch (e) { if (e.name === 'AbortError') return; } }
    if (await copyText(location.href)) flash(btn, btn.dataset.copied);
  }));

  /* ---- forms: honeypot + friendly confirmation (a Pages Function receives them in production) ---- */
  $$('form[data-form]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }
      const hp = form.querySelector('input[name="website"]');
      const thanks = document.getElementById(form.id + '-thanks');
      if (hp && hp.value) { form.reset(); return; }
      form.hidden = true;
      if (thanks) { thanks.hidden = false; thanks.focus(); }
    });
  });

  /* ---- volunteer: preselect a shift ---- */
  const shiftSelect = $('[data-shift-select]');
  if (shiftSelect) {
    $$('[data-shift]').forEach((a) => a.addEventListener('click', () => {
      shiftSelect.value = a.dataset.shift;
      setTimeout(() => shiftSelect.focus({ preventScroll: true }), 350);
    }));
  }

  /* ---- print ---- */
  $$('[data-print]').forEach((b) => b.addEventListener('click', () => window.print()));

  /* ---- generic single-select chip filters (news categories, food-drive neighbourhoods) ---- */
  function chipFilter({ chips, attr, items, status, empty, label, extra }) {
    let current = '';
    const apply = () => {
      let n = 0;
      items.forEach((it) => {
        const ok = (!current || it.getAttribute(attr) === current) && (!extra || extra(it));
        it.hidden = !ok; if (ok) n += 1;
      });
      chips.forEach((c) => c.setAttribute('aria-pressed', String((c.dataset.value || '') === current)));
      if (status) status.textContent = label(n);
      if (empty) empty.hidden = n > 0;
    };
    chips.forEach((c) => c.addEventListener('click', () => { current = c.dataset.value || ''; apply(); }));
    return apply;
  }
  const catWrap = $('[data-cat-filters]');
  if (catWrap) {
    catWrap.hidden = false;
    const chips = $$('[data-cat-filter]', catWrap); chips.forEach((c) => { c.dataset.value = c.dataset.catFilter; });
    const fr = document.documentElement.lang.startsWith('fr');
    chipFilter({ chips, attr: 'data-cat', items: $$('[data-cat-list] > [data-cat]'), status: $('[data-cat-status]'),
      label: (n) => (fr ? `${n} article${n > 1 ? 's' : ''}` : `${n} article${n === 1 ? '' : 's'}`) })();
  }
  const finder = $('[data-finder-filters]');
  if (finder) {
    finder.hidden = false;
    const list = $('[data-finder-list]');
    const chips = $$('[data-hood-filter]', finder); chips.forEach((c) => { c.dataset.value = c.dataset.hoodFilter; });
    const period = $('[data-period]', finder);
    const today = new Date(); const limit = new Date(today.getTime() + 30 * 864e5);
    const iso = (d) => d.toISOString().slice(0, 10);
    const within = (card) => {
      if (period.value !== '30') { $$('li[data-date]', card).forEach((li) => { li.hidden = false; }); return true; }
      let any = false;
      $$('li[data-date]', card).forEach((li) => { const ok = li.dataset.date >= iso(today) && li.dataset.date <= iso(limit); li.hidden = !ok; any = any || ok; });
      return any;
    };
    const apply = chipFilter({ chips, attr: 'data-hood', items: $$('.drop-card', list), status: $('[data-finder-status]'), empty: $('[data-finder-empty]'),
      label: (n) => (n === 1 ? list.dataset.labelOne : list.dataset.labelMany.replace(/^\d+/, n)), extra: within });
    period.addEventListener('change', apply);
    apply();
  }

  /* ---- tabs (toolkits) ---- */
  const tablist = $('[data-tabs]');
  if (tablist) {
    const tabs = $$('[role="tab"]', tablist);
    const panels = tabs.map((t) => document.getElementById(t.getAttribute('aria-controls')));
    tablist.hidden = false; tablist.parentElement.classList.add('has-tabs');
    const select = (i, focus) => {
      tabs.forEach((t, j) => { t.setAttribute('aria-selected', String(i === j)); t.tabIndex = i === j ? 0 : -1; });
      panels.forEach((p, j) => { p.hidden = i !== j; p.setAttribute('role', 'tabpanel'); p.setAttribute('aria-labelledby', tabs[j].id); p.tabIndex = 0; });
      if (focus) tabs[i].focus();
    };
    const choose = (i, focus) => {
      select(i, focus);
      store.set('lpdc-toolkit', tabs[i].id);
      if (history.replaceState) history.replaceState(null, '', '#' + panels[i].id);
    };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => choose(i));
      t.addEventListener('keydown', (e) => {
        const k = { ArrowRight: 1, ArrowLeft: -1, Home: -99, End: 99 }[e.key];
        if (k === undefined) return;
        e.preventDefault();
        const n = k === -99 ? 0 : k === 99 ? tabs.length - 1 : (i + k + tabs.length) % tabs.length;
        choose(n, true);
      });
    });
    const fromHash = panels.findIndex((p) => '#' + p.id === location.hash);
    const saved = tabs.findIndex((t) => t.id === store.get('lpdc-toolkit'));
    select(fromHash >= 0 ? fromHash : Math.max(0, saved), false);
  }

  /* ---- YouTube click-to-load facade (youtube-nocookie) ---- */
  $$('[data-yt]').forEach((box) => {
    const btn = $('.yt-play', box);
    btn.addEventListener('click', () => {
      const id = encodeURIComponent(box.dataset.yt);
      const f = document.createElement('iframe');
      f.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&hl=${document.documentElement.lang.slice(0, 2)}`;
      f.title = box.dataset.ytTitle || 'YouTube';
      f.allow = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen';
      f.setAttribute('allowfullscreen', '');
      f.referrerPolicy = 'strict-origin-when-cross-origin';
      box.replaceChildren(f);
      f.focus();
    });
  });

  /* ---- audio player ---- */
  const fmt = (s) => { if (!isFinite(s)) return '0:00'; const m = Math.floor(s / 60); return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };
  $$('[data-audio]').forEach((p) => {
    const a = $('audio', p); const btn = $('[data-audio-toggle]', p); const seek = $('[data-audio-seek]', p); const time = $('[data-audio-time]', p);
    const label = btn.getAttribute('aria-label').split(' — ')[1] || '';
    const sync = () => {
      const playing = !a.paused;
      p.classList.toggle('is-playing', playing);
      btn.setAttribute('aria-label', `${playing ? btn.dataset.labelPause : btn.dataset.labelPlay} — ${label}`);
    };
    btn.addEventListener('click', () => { if (a.paused) { $$('audio').forEach((o) => o !== a && o.pause()); a.play(); } else a.pause(); });
    a.addEventListener('play', sync); a.addEventListener('pause', sync); a.addEventListener('ended', sync);
    a.addEventListener('timeupdate', () => { if (a.duration) seek.value = (a.currentTime / a.duration) * 100; time.textContent = `${fmt(a.currentTime)} / ${fmt(a.duration)}`; });
    a.addEventListener('loadedmetadata', () => { time.textContent = `0:00 / ${fmt(a.duration)}`; });
    seek.addEventListener('input', () => { if (a.duration) a.currentTime = (seek.value / 100) * a.duration; });
  });

  /* ---- donate (Zeffy placeholder) ---- */
  const give = $('[data-give]');
  if (give) {
    const other = $('input[name="other_amount"]', give);
    other.addEventListener('focus', () => { $('input[value="other"]', give).checked = true; });
    give.addEventListener('submit', (e) => {
      if (give.getAttribute('action').startsWith('#')) {
        e.preventDefault();
        const st = $('[data-give-status]', give);
        st.classList.add('is-flash'); st.focus && st.setAttribute('tabindex', '-1'); st.focus();
      }
    });
  }

  /* ---- seasonal snow (home hero, Nov–Mar only, off with reduced motion) ---- */
  const canvas = $('[data-snow]');
  const snowBtn = $('[data-snow-toggle]');
  const winter = [10, 11, 0, 1, 2].includes(new Date().getMonth()) || /[?&]neige=1/.test(location.search);
  if (canvas && canvas.getContext && winter && !reduceMotion.matches) {
    const ctx = canvas.getContext('2d');
    let flakes = []; let raf = 0; let visible = true; let on = store.get('lpdc-snow') !== 'off';
    const size = () => {
      const r = canvas.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = r.width * dpr; canvas.height = r.height * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.min(70, Math.round((r.width * r.height) / 16000));
      flakes = Array.from({ length: n }, () => ({ x: Math.random() * r.width, y: Math.random() * r.height, r: 0.8 + Math.random() * 1.9, s: 0.25 + Math.random() * 0.55, d: Math.random() * Math.PI * 2, a: 0.35 + Math.random() * 0.45 }));
    };
    const frame = () => {
      const w = canvas.clientWidth; const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);
      for (const f of flakes) {
        f.y += f.s; f.d += 0.01; f.x += Math.sin(f.d) * 0.3;
        if (f.y > h + 4) { f.y = -4; f.x = Math.random() * w; }
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fillStyle = `rgba(255,255,255,${f.a})`; ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    };
    const run = () => { cancelAnimationFrame(raf); if (on && visible && !document.hidden) raf = requestAnimationFrame(frame); else if (!on) ctx.clearRect(0, 0, canvas.width, canvas.height); };
    const syncBtn = () => { snowBtn.setAttribute('aria-pressed', String(!on)); $('[data-on]', snowBtn).hidden = !on; $('[data-off]', snowBtn).hidden = on; };
    size(); snowBtn.hidden = false; syncBtn(); run();
    snowBtn.addEventListener('click', () => { on = !on; store.set('lpdc-snow', on ? 'on' : 'off'); syncBtn(); run(); });
    window.addEventListener('resize', () => { size(); });
    document.addEventListener('visibilitychange', run);
    if ('IntersectionObserver' in window) new IntersectionObserver(([en]) => { visible = en.isIntersecting; run(); }).observe(canvas);
    reduceMotion.addEventListener && reduceMotion.addEventListener('change', (e) => { if (e.matches) { on = false; run(); snowBtn.hidden = true; } });
  }
})();
