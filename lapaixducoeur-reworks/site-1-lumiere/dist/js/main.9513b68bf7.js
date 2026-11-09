(() => {
  'use strict';
  const d = document;
  const $ = (s, r = d) => r.querySelector(s);
  const $$ = (s, r = d) => Array.from(r.querySelectorAll(s));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const locale = d.documentElement.lang || 'fr-CA';
  const fr = locale.startsWith('fr');
  const money = (n, digits = 0) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'CAD', maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n).replace('CA', '');
  d.documentElement.classList.add('js');

  // Header: shadow on scroll, mobile menu
  const header = $('[data-header]');
  const toggle = $('[data-nav-toggle]');
  const nav = $('[data-nav]');
  const onScroll = () => header && header.classList.toggle('is-scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  if (toggle && nav) {
    const set = (open) => {
      toggle.setAttribute('aria-expanded', String(open));
      nav.classList.toggle('is-open', open);
    };
    toggle.addEventListener('click', () => set(toggle.getAttribute('aria-expanded') !== 'true'));
    d.addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('is-open')) { set(false); toggle.focus(); } });
    nav.addEventListener('click', (e) => { if (e.target.closest('a')) set(false); });
  }

  // Hero: light follows the cursor (fine pointers only, never with reduced motion)
  const hero = $('[data-hero]');
  if (hero && !reduce && matchMedia('(hover: hover) and (pointer: fine)').matches) {
    let raf = 0;
    hero.addEventListener('pointermove', (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        const r = hero.getBoundingClientRect();
        hero.style.setProperty('--mx', `${e.clientX - r.left}px`);
        hero.style.setProperty('--my', `${e.clientY - r.top}px`);
        hero.classList.add('glow-on');
        raf = 0;
      });
    });
    hero.addEventListener('pointerleave', () => hero.classList.remove('glow-on'));
  }

  // Count-up numbers and growing bars, triggered on first view
  const countUp = (el) => {
    const end = Number(el.dataset.count);
    const fmt = new Intl.NumberFormat(el.dataset.locale || locale);
    if (reduce || !end) return;
    const t0 = performance.now(), dur = 1600;
    const step = (t) => {
      const p = Math.max(0, Math.min(1, (t - t0) / dur));
      el.textContent = fmt.format(Math.round(end * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  const grow = (el) => {
    if (reduce) return;
    const w = el.getAttribute('width');
    el.setAttribute('width', '0');
    el.style.transition = 'none';
    requestAnimationFrame(() => {
      const t0 = performance.now(), end = Number(w), dur = 1200;
      const step = (t) => {
        const p = Math.max(0, Math.min(1, (t - t0) / dur));
        el.setAttribute('width', String(end * (1 - Math.pow(1 - p, 3))));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  };
  const watched = $$('[data-count], [data-grow], .reveal');
  if ('IntersectionObserver' in window && watched.length) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const el = en.target;
        io.unobserve(el);
        if (el.dataset.count) countUp(el);
        if (el.hasAttribute('data-grow')) grow(el);
        if (el.classList.contains('reveal')) el.classList.add('is-in');
      });
    }, { threshold: 0.35 });
    watched.forEach((el) => io.observe(el));
  }

  // "Where your gift goes" slider
  $$('[data-gift]').forEach((box) => {
    const range = $('[data-gift-range]', box);
    const out = $('[data-gift-out]', box);
    const center = $('[data-gift-center]', box);
    const wrap = $('.donut-wrap', box);
    let alloc = [];
    try { alloc = JSON.parse(box.dataset.alloc); } catch (e) { return; }
    const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
    const update = () => {
      const v = Number(range.value);
      const pct = ((v - range.min) / (range.max - range.min)) * 100;
      range.style.setProperty('--p', `${pct}%`);
      out.textContent = money(v);
      center.textContent = money(v);
      alloc.forEach((a) => {
        const li = $(`[data-key="${a.key}"]`, box);
        if (!li) return;
        const share = (v * a.pct) / 100;
        const n = share / a.unit;
        $('[data-amt]', li).textContent = money(share, share % 1 ? 2 : 0);
        $('[data-eq]', li).textContent = `≈ ${nf.format(n)} ${n >= 2 ? a.many : a.one}`;
      });
      if (!reduce && wrap) { wrap.classList.remove('pulse'); void wrap.offsetWidth; wrap.classList.add('pulse'); }
    };
    range.addEventListener('input', update);
    range.style.setProperty('--p', `${((range.value - range.min) / (range.max - range.min)) * 100}%`);
  });

  // Donation widget
  const form = $('[data-donate]');
  if (form) {
    const sets = $$('.amounts', form);
    const custom = $('[data-custom]', form);
    const fees = $('[data-fees]', form);
    const feeText = $('[data-fee-text]', form);
    const sumEl = $('[data-sum]', form);
    const impEl = $('[data-impact]', form);
    const protoOut = $('[data-proto-out]', form);
    const freq = () => form.querySelector('input[name="frequency"]:checked').value;
    const active = () => sets.find((s) => s.dataset.set === freq());
    const amount = () => {
      const c = Number(custom.value);
      if (c >= 1) return { v: c, impact: '' };
      const r = active().querySelector('input[type="radio"]:checked');
      return r ? { v: Number(r.value), impact: r.dataset.impact } : { v: 0, impact: '' };
    };
    const summary = () => {
      const { v, impact } = amount();
      const fee = Math.round(v * 0.03 * 100) / 100;
      const total = fees.checked ? v + fee : v;
      feeText.textContent = form.dataset.feeLabel.replace('{fee}', money(fee || 0, 2));
      const tpl = freq() === 'monthly' ? form.dataset.sumMonthly : form.dataset.sumOnce;
      const amt = money(total, total % 1 ? 2 : 0);
      sumEl.textContent = tpl.replace('{amt}', amt);
      impEl.textContent = impact ? `= ${impact}` : (fr ? 'Merci : chaque dollar compte.' : 'Thank you: every dollar counts.');
      return sumEl.textContent;
    };
    form.addEventListener('change', (e) => {
      if (e.target.name === 'frequency') {
        sets.forEach((s) => { const on = s.dataset.set === freq(); s.hidden = !on; s.disabled = !on; });
      }
      if (e.target.name.startsWith('amount_')) custom.value = '';
      summary();
    });
    custom.addEventListener('input', () => {
      const radios = active().querySelectorAll('input[type="radio"]');
      if (custom.value) radios.forEach((r) => { r.checked = false; });
      else if (radios[1] && !active().querySelector('input:checked')) radios[1].checked = true;
      summary();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const { v } = amount();
      if (!v || v < 1) { custom.focus(); return; }
      protoOut.hidden = false;
      protoOut.textContent = form.dataset.proto.replace('{sum}', summary());
    });
    summary();
  }

  // Copy to clipboard
  const copyText = async (text, btn) => {
    try { await navigator.clipboard.writeText(text); } catch (e) {
      const ta = d.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      d.body.appendChild(ta); ta.select(); try { d.execCommand('copy'); } catch (err) { /* noop */ } ta.remove();
    }
    const label = btn.querySelector('span');
    const prev = label.textContent;
    label.textContent = btn.dataset.copied;
    btn.classList.add('is-copied');
    setTimeout(() => { label.textContent = prev; btn.classList.remove('is-copied'); }, 2200);
  };
  $$('[data-copy]').forEach((b) => b.addEventListener('click', () => copyText($(b.dataset.copy).textContent.trim(), b)));
  $$('[data-copy-url]').forEach((b) => b.addEventListener('click', () => copyText(b.dataset.copyUrl, b)));

  // Forms: honeypot + friendly confirmation (a Pages Function receives them in production)
  $$('[data-form]').forEach((f) => {
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!f.checkValidity()) { f.reportValidity(); return; }
      const status = $('.form-status', f);
      const trap = f.querySelector('input[name="website"]');
      status.hidden = false;
      status.textContent = f.dataset.thanks;
      if (!trap || !trap.value) f.reset();
      status.setAttribute('tabindex', '-1');
      status.focus();
    });
  });
  const subj = $('[data-subject]');
  if (subj) {
    const q = new URLSearchParams(location.search).get('sujet');
    if (q && subj.querySelector(`option[value="${q}"]`)) subj.value = q;
  }

  // YouTube facade
  $$('[data-yt]').forEach((box) => {
    const btn = $('.yt-play', box);
    btn.addEventListener('click', () => {
      const f = d.createElement('iframe');
      f.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(box.dataset.yt)}?autoplay=1&rel=0`;
      f.title = box.dataset.title;
      f.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
      f.allowFullscreen = true;
      f.referrerPolicy = 'strict-origin-when-cross-origin';
      box.appendChild(f);
      btn.remove();
      f.focus();
    });
  });

  // Audio player
  $$('[data-audio]').forEach((card) => {
    const a = $('[data-audio-el]', card);
    const btn = $('[data-audio-toggle]', card);
    const seek = $('[data-audio-seek]', card);
    const time = $('[data-audio-time]', card);
    const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    const paint = () => {
      const p = a.duration ? (a.currentTime / a.duration) * 100 : 0;
      seek.value = p; seek.style.setProperty('--p', `${p}%`);
      time.textContent = a.duration ? `${fmt(a.currentTime)} / ${fmt(a.duration)}` : fmt(a.currentTime);
    };
    btn.addEventListener('click', () => (a.paused ? a.play() : a.pause()));
    a.addEventListener('play', () => { btn.classList.add('is-playing'); btn.setAttribute('aria-label', btn.dataset.pause); });
    a.addEventListener('pause', () => { btn.classList.remove('is-playing'); btn.setAttribute('aria-label', btn.dataset.play); });
    a.addEventListener('timeupdate', paint);
    a.addEventListener('loadedmetadata', paint);
    seek.addEventListener('input', () => { if (a.duration) a.currentTime = (seek.value / 100) * a.duration; });
  });

  // Lightbox
  const dlg = $('[data-lightbox-dialog]');
  if (dlg && typeof dlg.showModal === 'function') {
    const img = $('[data-lb-img]', dlg), cap = $('[data-lb-cap]', dlg);
    $$('[data-lightbox]').forEach((b) => b.addEventListener('click', () => {
      const src = b.querySelector('img');
      img.src = b.dataset.lightbox; img.alt = src ? src.alt : '';
      cap.textContent = b.dataset.caption;
      dlg.showModal();
    }));
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  }

  // Transparency TOC highlight
  const tocLinks = $$('.toc a');
  if (tocLinks.length && 'IntersectionObserver' in window) {
    const map = new Map(tocLinks.map((l) => [l.getAttribute('href').slice(1), l]));
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) { tocLinks.forEach((l) => l.classList.remove('is-active')); const l = map.get(en.target.id); if (l) l.classList.add('is-active'); }
      });
    }, { rootMargin: '-30% 0px -60% 0px' });
    map.forEach((_, id) => { const s = d.getElementById(id); if (s) io.observe(s); });
  }

  // Mobile give bar steps aside when the footer is in view
  const bar = $('[data-mobile-give]');
  const foot = $('.site-footer');
  if (bar) {
    let footIn = false;
    const paint = () => bar.classList.toggle('is-shown', scrollY > 420 && !footIn);
    if (foot && 'IntersectionObserver' in window) new IntersectionObserver(([en]) => { footIn = en.isIntersecting; paint(); }).observe(foot);
    addEventListener('scroll', paint, { passive: true });
    paint();
  }
})();
