(() => {
  const form = document.querySelector('[data-vform]');
  if (!form) return;
  const steps = [...form.querySelectorAll('.vstep')];
  const dots = [...document.querySelectorAll('.steps li')];
  const status = document.querySelector('[data-vstatus]');
  const prev = form.querySelector('[data-vprev]'), next = form.querySelector('[data-vnext]'), submit = form.querySelector('[data-vsubmit]');
  const done = document.querySelector('[data-vdone]');
  const summary = form.querySelector('[data-vsummary]');
  const names = JSON.parse(form.dataset.steps);
  let cur = 0;

  function go(i, focus = true) {
    cur = i;
    steps.forEach((s, j) => { s.hidden = j !== i; });
    dots.forEach((d, j) => { d.classList.toggle('is-done', j < i); d.classList.toggle('is-current', j === i); });
    prev.hidden = i === 0;
    next.hidden = i === steps.length - 1;
    submit.hidden = i !== steps.length - 1;
    status.textContent = `${form.dataset.stepLabel} ${i + 1} ${form.dataset.of} ${steps.length} : ${names[i]}`;
    if (i === steps.length - 1) renderSummary();
    if (focus) steps[i].querySelector('legend').scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    if (focus) { const f = steps[i].querySelector('input:not([type=hidden]):not([tabindex="-1"]), select, textarea'); if (f) f.focus({ preventScroll: true }); }
  }
  const checked = (name) => [...form.querySelectorAll(`input[name=${name}]:checked`)].map((i) => i.closest('label').textContent.trim());
  function renderSummary() {
    const rows = [
      [names[0], [form.querySelector('#v-name').value, form.email.value, form.region.value].filter(Boolean).join(' · ')],
      [names[1], [...checked('skills'), form.skills_other.value].filter(Boolean).join(', ')],
      [names[2], [...checked('days'), ...checked('moments'), ...checked('frequency')].join(', ') || '—'],
      [form.dataset.langsLabel, checked('languages').join(', ') || '—'],
    ];
    const dl = document.createElement('dl');
    rows.forEach(([k, v]) => { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; dl.append(dt, dd); });
    summary.replaceChildren(dl);
    summary.hidden = false;
  }
  function validStep(i) {
    const s = steps[i];
    const ok = window.kimiaValidate([...s.querySelectorAll('input[required], input[type=email], textarea[required]')]);
    if (!ok) return false;
    const group = s.querySelector('[data-required-group]');
    if (group) {
      const err = s.querySelector('#v-skills-err');
      const any = group.querySelector('input:checked');
      err.textContent = any ? '' : form.dataset.msgSkill;
      if (!any) { group.querySelector('input').focus(); return false; }
    }
    return true;
  }
  next.addEventListener('click', () => { if (validStep(cur)) go(cur + 1); });
  prev.addEventListener('click', () => go(cur - 1));
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && cur < steps.length - 1) { e.preventDefault(); next.click(); }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (cur !== steps.length - 1) { next.click(); return; }
    if (!validStep(cur)) return;
    if (form.website.value) return; // honeypot: silently drop bots
    const first = form.querySelector('#v-name').value.trim().split(/\s+/)[0];
    const h = done.querySelector('h3');
    h.dataset.base = h.dataset.base || h.textContent;
    h.textContent = first ? `${first}, ${h.dataset.base.charAt(0).toLowerCase()}${h.dataset.base.slice(1)}` : h.dataset.base;
    form.hidden = true;
    document.querySelector('.steps').hidden = true;
    status.textContent = '';
    done.hidden = false;
    done.focus();
  });
  done.querySelector('[data-vagain]').addEventListener('click', () => {
    form.reset();
    summary.hidden = true;
    form.hidden = false;
    done.hidden = true;
    document.querySelector('.steps').hidden = false;
    go(0);
  });
  go(0, false);
})();
