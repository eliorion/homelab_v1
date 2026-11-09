(function () {
  'use strict';
  var doc = document.documentElement;
  doc.classList.add('js');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function store(key, val) {
    try {
      if (val === undefined) return JSON.parse(window.localStorage.getItem(key) || 'null');
      window.localStorage.setItem(key, JSON.stringify(val));
    } catch (e) { return null; }
    return null;
  }

  function ready(fn) { document.readyState !== 'loading' ? fn() : document.addEventListener('DOMContentLoaded', fn); }

  ready(function () {
    // nav
    var toggle = document.querySelector('.nav-toggle');
    var nav = document.getElementById('site-nav');
    if (toggle && nav) {
      toggle.addEventListener('click', function () {
        var open = toggle.getAttribute('aria-expanded') !== 'true';
        toggle.setAttribute('aria-expanded', String(open));
        nav.classList.toggle('is-open', open);
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && nav.classList.contains('is-open')) {
          nav.classList.remove('is-open'); toggle.setAttribute('aria-expanded', 'false'); toggle.focus();
        }
      });
    }

    // slow reveals
    var revs = $$('[data-reveal]');
    if (reduce || !('IntersectionObserver' in window)) {
      revs.forEach(function (el) { el.classList.add('is-visible'); });
    } else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add('is-visible'); io.unobserve(en.target); }
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
      revs.forEach(function (el) { io.observe(el); });
    }

    // filters (stories by tag, wall by kind)
    $$('[data-filters]').forEach(function (group) {
      var section = group.closest('.wrap') || document;
      var target = section.querySelector('[data-filter-target]');
      var status = section.querySelector('[data-filter-status]');
      if (!target) return;
      var attr = group.getAttribute('data-filters') === 'wall' ? 'data-kind' : 'data-tags';
      function apply(val, btn) {
        $$('[data-filter]', group).forEach(function (b) { b.setAttribute('aria-pressed', String(b === btn)); });
        var shown = 0;
        Array.prototype.forEach.call(target.children, function (card) {
          var v = (card.getAttribute(attr) || '').split(' ');
          var ok = val === '*' || v.indexOf(val) !== -1;
          card.hidden = !ok;
          if (ok) { shown++; card.classList.add('is-visible'); }
        });
        if (status) status.textContent = shown + (doc.lang.indexOf('fr') === 0 ? ' résultat(s)' : ' result(s)');
      }
      group.addEventListener('click', function (e) {
        var b = e.target.closest('[data-filter]');
        if (b) apply(b.getAttribute('data-filter'), b);
      });
      var q = new URLSearchParams(window.location.search).get('tag');
      if (q) {
        var pre = group.querySelector('[data-filter="' + q.replace(/[^a-z-]/g, '') + '"]');
        if (pre) apply(q, pre);
      }
    });

    // "I prayed" counters (per viewer)
    var prayed = store('lpdc-prayed') || {};
    $$('[data-pray]').forEach(function (btn) {
      var id = btn.getAttribute('data-pray');
      var base = parseInt(btn.getAttribute('data-count'), 10) || 0;
      var countEl = btn.querySelector('.pray-btn__count');
      var tpl = btn.getAttribute('data-aria') || '';
      function render() {
        var on = !!prayed[id];
        var n = base + (on ? 1 : 0);
        btn.setAttribute('aria-pressed', String(on));
        countEl.textContent = n;
        btn.setAttribute('aria-label', tpl.replace('{n}', n));
      }
      render();
      btn.addEventListener('click', function () {
        prayed = store('lpdc-prayed') || prayed;
        if (prayed[id]) delete prayed[id]; else prayed[id] = 1;
        store('lpdc-prayed', prayed);
        render();
        btn.classList.remove('is-pulse'); void btn.offsetWidth; btn.classList.add('is-pulse');
      });
    });

    // forms: honeypot + friendly confirmation (no backend in the prototype)
    $$('form[data-form]').forEach(function (form) {
      var anon = form.querySelector('[data-anon]');
      var anonTarget = form.querySelector('[data-anon-target]');
      if (anon && anonTarget) {
        anon.addEventListener('change', function () { anonTarget.disabled = anon.checked; if (anon.checked) anonTarget.value = ''; });
      }
      $$('[data-count-target]', form).forEach(function (ta) {
        var out = document.getElementById(ta.getAttribute('data-count-target'));
        var span = out && out.querySelector('[data-count]');
        var max = parseInt(ta.getAttribute('maxlength'), 10);
        if (!span) return;
        ta.addEventListener('input', function () { span.textContent = max - ta.value.length; });
      });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var hp = form.querySelector('input[name="website"]');
        if (!form.checkValidity()) {
          var bad = form.querySelector(':invalid');
          if (form.reportValidity) form.reportValidity();
          if (bad) bad.focus();
          return;
        }
        // Production: POST to a Cloudflare Pages Function, which verifies Turnstile + the honeypot.
        if (hp && hp.value) return;
        var ok = form.querySelector('[data-success]');
        form.classList.add('is-sent');
        if (ok) { ok.hidden = false; if (ok.focus) ok.focus({ preventScroll: true }); ok.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' }); }
      });
    });

    // give widget (Zeffy placeholder)
    $$('form[data-give]').forEach(function (form) {
      var btn = form.querySelector('[data-give-btn]');
      var label = btn.querySelector('span');
      var other = form.querySelector('input[name="other"]');
      function amount() {
        var o = other && parseInt(other.value, 10);
        if (o > 0) return o;
        var r = form.querySelector('input[name="amount"]:checked');
        return r ? r.value : '';
      }
      function update() {
        var monthly = (form.querySelector('input[name="freq"]:checked') || {}).value === 'monthly';
        var tpl = btn.getAttribute(monthly ? 'data-label-monthly' : 'data-label-once');
        label.textContent = tpl.replace('{a}', amount());
      }
      form.addEventListener('change', function (e) {
        if (e.target.name === 'amount' && other) other.value = '';
        update();
      });
      if (other) other.addEventListener('input', update);
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var ok = form.querySelector('[data-success]');
        if (ok) ok.hidden = false;
      });
      update();
    });

    // demo notices (e.g. Zeffy registration link)
    $$('[data-demo-notice]').forEach(function (b) {
      b.addEventListener('click', function () {
        var out = b.closest('aside, form, div').parentNode.querySelector('[data-demo-out]');
        if (out) out.textContent = b.getAttribute('data-demo-notice');
      });
    });

    // copy Interac address
    $$('[data-copy]').forEach(function (b) {
      b.addEventListener('click', function () {
        var src = b.parentNode.querySelector('[data-copy-src]');
        var text = b.getAttribute('data-copy-text') || (src ? src.textContent.trim() : '');
        var label = b.querySelector('span');
        var done = function () { label.textContent = b.getAttribute('data-copied'); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () {});
        else if (!src) window.prompt(label.textContent, text);
        else {
          var r = document.createRange(); r.selectNodeContents(src);
          var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
          try { document.execCommand('copy'); done(); } catch (e) { /* manual copy */ }
        }
      });
    });

    // YouTube click-to-load facade
    $$('[data-yt]').forEach(function (box) {
      var btn = box.querySelector('.yt__btn');
      btn.addEventListener('click', function () {
        var f = document.createElement('iframe');
        f.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(box.getAttribute('data-yt')) + '?autoplay=1&rel=0';
        f.title = box.getAttribute('data-yt-title') || 'YouTube';
        f.allow = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture';
        f.allowFullscreen = true;
        f.loading = 'lazy';
        box.appendChild(f);
        btn.remove();
        f.focus();
      });
    });

    // gallery lightbox
    var dlg = document.querySelector('[data-lightbox-dialog]');
    if (dlg && typeof dlg.showModal === 'function') {
      var img = dlg.querySelector('[data-lightbox-img]');
      var cap = dlg.querySelector('[data-lightbox-cap]');
      $$('[data-lightbox]').forEach(function (a) {
        a.addEventListener('click', function (e) {
          e.preventDefault();
          var inner = a.querySelector('img');
          img.src = a.getAttribute('href');
          img.removeAttribute('srcset');
          img.alt = inner ? inner.alt : '';
          img.removeAttribute('width');
          img.removeAttribute('height');
          cap.textContent = a.getAttribute('data-caption') || '';
          dlg.showModal();
        });
      });
      dlg.querySelector('[data-close]').addEventListener('click', function () { dlg.close(); });
      dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
    }
  });
})();
