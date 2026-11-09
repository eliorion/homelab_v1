(() => {
  'use strict';
  const doc = document.documentElement;
  doc.classList.add('js');
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const lang = doc.lang.startsWith('fr') ? 'fr' : 'en';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fmtMoney = (n) => new Intl.NumberFormat(lang === 'fr' ? 'fr-CA' : 'en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(n);

  /* Sommaire overlay: a :target fallback works without JS; this adds focus handling. */
  const menu = $('#sommaire');
  const openers = $$('[data-menu]');
  let lastFocus = null;
  const setMenu = (open) => {
    if (!menu) return;
    menu.classList.toggle('is-open', open);
    document.body.classList.toggle('menu-open', open);
    openers.forEach((b) => b.setAttribute('aria-expanded', String(open)));
    if (open) {
      lastFocus = document.activeElement;
      const first = $('.sommaire__close', menu);
      if (first) first.focus();
    } else if (lastFocus) {
      lastFocus.focus();
    }
  };
  openers.forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); setMenu(true); }));
  $$('[data-menu-close]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); setMenu(false); }));
  document.addEventListener('keydown', (e) => {
    if (!menu || !menu.classList.contains('is-open')) return;
    if (e.key === 'Escape') { setMenu(false); return; }
    if (e.key === 'Tab') {
      const f = $$('a, button', menu).filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });
  if (location.hash === '#sommaire') { history.replaceState(null, '', location.pathname); setMenu(true); }

  /* HOPE zoom: JS fallback only where CSS scroll timelines are unsupported. */
  const hope = $('[data-hope]');
  if (hope && !reduced && !(window.CSS && CSS.supports('animation-timeline: view()'))) {
    hope.classList.add('is-scrolly');
    let ticking = false;
    const update = () => {
      ticking = false;
      const r = hope.getBoundingClientRect();
      const span = r.height - window.innerHeight;
      const p = span > 0 ? Math.min(1, Math.max(0, -r.top / span)) : 1;
      hope.style.setProperty('--p', p.toFixed(4));
    };
    const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) window.addEventListener('scroll', onScroll, { passive: true });
        else window.removeEventListener('scroll', onScroll);
      });
    });
    io.observe(hope);
    update();
  }

  /* Countdowns */
  const pad = (n) => String(n).padStart(2, '0');
  $$('[data-countdown]').forEach((el) => {
    const end = new Date(el.dataset.countdown).getTime();
    const units = { d: $('[data-unit="d"]', el), h: $('[data-unit="h"]', el), m: $('[data-unit="m"]', el), s: $('[data-unit="s"]', el) };
    const sr = $('[data-countdown-sr]', el);
    const tick = () => {
      const ms = Math.max(0, end - Date.now());
      const d = Math.floor(ms / 864e5);
      if (units.d) units.d.textContent = pad(d);
      if (units.h) units.h.textContent = pad(Math.floor(ms / 36e5) % 24);
      if (units.m) units.m.textContent = pad(Math.floor(ms / 6e4) % 60);
      if (units.s) units.s.textContent = pad(Math.floor(ms / 1e3) % 60);
      if (sr && sr.dataset.d !== String(d)) { sr.dataset.d = String(d); sr.textContent = sr.textContent.replace(/^\d+/, String(d)); }
      if (ms === 0) { el.classList.add('is-ended'); return; }
      setTimeout(tick, 1000 - (Date.now() % 1000));
    };
    tick();
  });

  /* Forms: no backend in the prototype. A Cloudflare Pages Function receives them in production. */
  $$('form[data-form]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }
      const hp = form.querySelector('input[name="website"]');
      const box = document.createElement('div');
      box.className = 'form-thanks';
      box.setAttribute('role', 'status');
      box.tabIndex = -1;
      const p = document.createElement('p');
      p.textContent = form.dataset.thanks || 'Merci !';
      box.appendChild(p);
      if (hp && hp.value) { form.reset(); return; }
      form.replaceWith(box);
      box.focus();
    });
  });

  /* Copy buttons */
  const flash = (btn) => {
    const label = btn.querySelector('span') || btn;
    const prev = label.textContent;
    label.textContent = btn.dataset.copied || '✓';
    setTimeout(() => { label.textContent = prev; }, 1800);
  };
  const copyText = async (text, btn) => {
    try { await navigator.clipboard.writeText(text); flash(btn); } catch (err) {
      const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); flash(btn); } catch (e2) { /* clipboard unavailable */ }
      ta.remove();
    }
  };
  $$('[data-copy]').forEach((b) => b.addEventListener('click', () => copyText(b.dataset.copy, b)));
  $$('[data-copy-from]').forEach((b) => b.addEventListener('click', () => { const src = document.getElementById(b.dataset.copyFrom); if (src) copyText(src.textContent.trim(), b); }));

  /* Native share */
  $$('[data-share]').forEach((bar) => {
    const btn = $('[data-share-native]', bar);
    if (!btn) return;
    if (!navigator.share) { btn.closest('li').remove(); return; }
    btn.addEventListener('click', () => { navigator.share({ title: bar.dataset.shareTitle, url: bar.dataset.shareUrl }).catch(() => {}); });
  });

  /* YouTube facades: nothing loads from YouTube until a click. */
  const loadYT = (box, start = 0) => {
    const id = box.dataset.yt;
    const hl = box.dataset.ytLang || lang;
    const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0&modestbranding=1&cc_load_policy=1&hl=${hl}&cc_lang_pref=${hl}&start=${start}`;
    let frame = box.querySelector('iframe');
    if (!frame) {
      frame = document.createElement('iframe');
      frame.title = box.dataset.ytTitle || 'YouTube';
      frame.allow = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen';
      frame.allowFullscreen = true;
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      const btn = box.querySelector('.yt__btn');
      if (btn) btn.remove();
      box.appendChild(frame);
    }
    frame.src = src;
    frame.focus();
  };
  $$('[data-yt]').forEach((box) => {
    const btn = $('.yt__btn', box);
    if (btn) btn.addEventListener('click', () => loadYT(box));
  });
  $$('[data-yt-seek]').forEach((b) => b.addEventListener('click', () => {
    const box = document.getElementById(b.dataset.ytTarget);
    if (box) { loadYT(box, Number(b.dataset.ytSeek) || 0); box.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' }); }
  }));

  /* Audio player */
  const mmss = (s) => { if (!isFinite(s)) return '0:00'; const m = Math.floor(s / 60); return `${m}:${pad(Math.floor(s % 60))}`; };
  $$('[data-player]').forEach((pl) => {
    const a = $('[data-audio]', pl);
    const play = $('[data-play]', pl);
    const seek = $('[data-seek]', pl);
    const cur = $('[data-cur]', pl);
    const dur = $('[data-dur]', pl);
    const speed = $('[data-speed]', pl);
    if (!a || !play) return;
    a.removeAttribute('controls');
    play.addEventListener('click', () => { if (a.paused) a.play().catch(() => {}); else a.pause(); });
    a.addEventListener('play', () => { pl.classList.add('is-playing'); play.setAttribute('aria-label', play.dataset.labelPause); });
    a.addEventListener('pause', () => { pl.classList.remove('is-playing'); play.setAttribute('aria-label', play.dataset.labelPlay); });
    a.addEventListener('loadedmetadata', () => { dur.textContent = mmss(a.duration); });
    a.addEventListener('timeupdate', () => { cur.textContent = mmss(a.currentTime); if (a.duration) seek.value = String((a.currentTime / a.duration) * 100); });
    seek.addEventListener('input', () => { if (a.duration) a.currentTime = (Number(seek.value) / 100) * a.duration; });
    const rates = [1, 1.25, 1.5, 0.75];
    let ri = 0;
    speed.addEventListener('click', () => { ri = (ri + 1) % rates.length; a.playbackRate = rates[ri]; speed.textContent = `${rates[ri]}×`; });
  });

  /* Donate widget (Zeffy placeholder) */
  const donate = $('[data-donate]');
  if (donate) {
    const out = $('[data-impact-out]', donate);
    const other = $('#other-amount', donate);
    const note = $('[data-zeffy-note]', donate);
    const update = () => {
      const r = donate.querySelector('input[name="amount"]:checked');
      if (!r) return;
      out.textContent = '';
      if (r.value === 'other') {
        const v = Number(other.value);
        out.textContent = v > 0 ? `${lang === 'fr' ? 'Merci pour votre don de' : 'Thank you for your gift of'} ${fmtMoney(v)}.` : (lang === 'fr' ? 'Indiquez le montant de votre choix.' : 'Enter the amount of your choice.');
        return;
      }
      const b = document.createElement('strong');
      b.textContent = fmtMoney(Number(r.value));
      out.append(`${lang === 'fr' ? 'Votre don de' : 'Your gift of'} `, b, ` ${lang === 'fr' ? 'peut financer' : 'can pay for'} ${r.dataset.impact}.`);
    };
    donate.addEventListener('change', update);
    other.addEventListener('focus', () => { const r = donate.querySelector('input[name="amount"][value="other"]'); if (r) { r.checked = true; update(); } });
    other.addEventListener('input', update);
    donate.addEventListener('submit', (e) => {
      if (donate.getAttribute('action').startsWith('#')) {
        e.preventDefault();
        note.classList.add('is-on');
        note.setAttribute('role', 'status');
        note.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
      }
    });
  }
})();
