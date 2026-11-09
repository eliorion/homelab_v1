(() => {
  /* YouTube click-to-load facade: nothing is requested from YouTube until the click */
  document.querySelectorAll('[data-yt]').forEach((box) => {
    const btn = box.querySelector('.yt__play');
    btn.hidden = false;
    btn.addEventListener('click', () => {
      const f = document.createElement('iframe');
      f.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(box.dataset.yt)}?autoplay=1&rel=0`;
      f.title = box.dataset.ytTitle;
      f.allow = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture';
      f.allowFullscreen = true;
      f.referrerPolicy = 'strict-origin-when-cross-origin';
      box.replaceChildren(f);
      f.focus();
    });
  });

  /* audio player around a native <audio> */
  const icons = {
    play: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
    pause: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>',
  };
  const t = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');
  document.querySelectorAll('[data-player]').forEach((p) => {
    const a = p.querySelector('audio');
    const pp = p.querySelector('[data-pp]'), seek = p.querySelector('[data-seek]'), cur = p.querySelector('[data-cur]'), dur = p.querySelector('[data-dur]'), sp = p.querySelector('[data-speed]');
    a.controls = false;
    p.querySelectorAll('.player__wave i').forEach((i) => { i.style.height = `${i.dataset.h}px`; });
    const speeds = [1, 1.25, 1.5, 0.75];
    const sync = () => {
      const playing = !a.paused;
      p.classList.toggle('is-playing', playing);
      pp.innerHTML = playing ? icons.pause : icons.play;
      pp.setAttribute('aria-label', playing ? p.dataset.pause : p.dataset.play);
    };
    pp.addEventListener('click', () => (a.paused ? a.play() : a.pause()));
    a.addEventListener('play', sync); a.addEventListener('pause', sync); a.addEventListener('ended', sync);
    a.addEventListener('loadedmetadata', () => { dur.textContent = t(a.duration); });
    a.addEventListener('timeupdate', () => {
      cur.textContent = t(a.currentTime);
      if (a.duration) { seek.value = (a.currentTime / a.duration) * 100; seek.setAttribute('aria-valuetext', `${t(a.currentTime)} / ${t(a.duration)}`); }
    });
    seek.addEventListener('input', () => { if (a.duration) a.currentTime = (seek.value / 100) * a.duration; });
    sp.addEventListener('click', () => {
      const n = speeds[(speeds.indexOf(a.playbackRate) + 1) % speeds.length];
      a.playbackRate = n;
      sp.textContent = `${n}×`;
    });
  });
})();
