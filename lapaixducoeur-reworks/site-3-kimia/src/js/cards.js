(() => {
  document.querySelectorAll('[data-aid]').forEach((card) => {
    const front = card.querySelector('.aid-card__front'), back = card.querySelector('.aid-card__back');
    const open = front.querySelector('.flip-btn'), close = back.querySelector('[data-flip-back]');
    const title = back.querySelector('.aid-card__back-title');
    open.hidden = false; close.hidden = false; title.tabIndex = -1;
    const set = (flipped, focus) => {
      card.classList.toggle('is-flipped', flipped);
      open.setAttribute('aria-expanded', String(flipped));
      front.inert = flipped; back.inert = !flipped;
      if (focus) (flipped ? title : open).focus({ preventScroll: true });
    };
    open.addEventListener('click', () => set(true, true));
    close.addEventListener('click', () => set(false, true));
    card.addEventListener('keydown', (e) => { if (e.key === 'Escape' && card.classList.contains('is-flipped')) set(false, true); });
    set(false, false);
  });
})();
