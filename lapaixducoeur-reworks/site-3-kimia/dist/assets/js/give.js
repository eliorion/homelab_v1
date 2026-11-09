(() => {
  const form = document.querySelector('[data-give]');
  if (!form) return;
  const out = form.querySelector('[data-impact-out] span');
  const custom = form.querySelector('#g-custom');
  const status = form.querySelector('[data-give-status]');
  const amounts = [...form.querySelectorAll('input[name=amount]')];
  const fmt = (n) => (document.documentElement.lang.startsWith('fr') ? `${n} $` : `$${n}`);
  function render() {
    const monthly = form.querySelector('input[name=frequency]:checked').value === 'monthly';
    const checked = amounts.find((o) => o.checked);
    const val = Number(custom.value) || (checked ? Number(checked.value) : 0);
    let label = checked && !custom.value ? checked.dataset.label : '';
    if (custom.value) {
      const fits = amounts.filter((o) => Number(o.value) <= val);
      label = fits.length ? fits[fits.length - 1].dataset.label : '';
    }
    const s = document.createElement('strong');
    s.textContent = `${fmt(val)}${monthly ? ` ${form.dataset.month}` : ''}`;
    out.replaceChildren(`${form.dataset.impact} `, s, label ? ` ${form.dataset.makes} ${label}.` : '.');
  }
  form.addEventListener('change', (e) => { if (e.target.name === 'amount') custom.value = ''; render(); });
  custom.addEventListener('input', () => { if (custom.value) amounts.forEach((o) => { o.checked = false; }); render(); });
  form.addEventListener('submit', (e) => { e.preventDefault(); status.textContent = form.dataset.demo; });
  render();
})();
