(() => {
  const root = document.querySelector('[data-gallery]');
  if (!root) return;
  const dlg = root.querySelector('[data-lightbox]');
  const img = dlg.querySelector('.lightbox__img');
  const title = dlg.querySelector('[data-lb-title]'), cap = dlg.querySelector('[data-lb-caption]'), count = dlg.querySelector('[data-lb-count]');
  const all = [...root.querySelectorAll('.g-item')];
  let list = all, idx = 0, opener = null;
  const visible = () => all.filter((a) => !a.closest('li').hidden);

  function show(i) {
    idx = (i + list.length) % list.length;
    const a = list[idx];
    img.src = a.getAttribute('href');
    img.alt = a.dataset.alt;
    const thumb = a.querySelector('img');
    img.width = thumb.width; img.height = thumb.height;
    title.textContent = a.dataset.title;
    cap.textContent = a.dataset.caption;
    count.textContent = `${idx + 1} / ${list.length}`;
  }
  function open(a) {
    list = visible();
    opener = a;
    show(list.indexOf(a));
    dlg.showModal();
    dlg.querySelector('[data-lb-close]').focus();
  }
  all.forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); open(a); }));
  dlg.querySelector('[data-lb-prev]').addEventListener('click', () => show(idx - 1));
  dlg.querySelector('[data-lb-next]').addEventListener('click', () => show(idx + 1));
  dlg.querySelector('[data-lb-close]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => { if (opener) opener.focus(); });
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(idx - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); show(idx + 1); }
    else if (e.key === 'Tab') {
      const f = [...dlg.querySelectorAll('button')];
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!dlg.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    }
  });
})();
