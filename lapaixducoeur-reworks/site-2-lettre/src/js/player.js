(function () {
  'use strict';
  var SPEEDS = [1, 1.25, 1.5, 2, 0.75];
  var fmt = function (s) {
    if (!isFinite(s) || s < 0) s = 0;
    var m = Math.floor(s / 60);
    var r = Math.floor(s % 60);
    return m + ':' + (r < 10 ? '0' : '') + r;
  };

  function init(root) {
    var audio = root.querySelector('audio');
    var ui = root.querySelector('.player__ui');
    if (!audio || !ui) return null;
    audio.removeAttribute('controls');
    ui.hidden = false;
    var play = root.querySelector('.player__play');
    var scrub = root.querySelector('.player__scrub');
    var cur = root.querySelector('[data-cur]');
    var dur = root.querySelector('[data-dur]');
    var speed = root.querySelector('[data-speed]');
    var title = root.querySelector('[data-player-title]');
    var seeking = false;
    var si = 0;

    function paint() {
      var d = audio.duration || 0;
      var p = d ? (audio.currentTime / d) : 0;
      if (!seeking) scrub.value = Math.round(p * 1000);
      scrub.style.setProperty('--p', (scrub.value / 10) + '%');
      cur.textContent = fmt(audio.currentTime);
      scrub.setAttribute('aria-valuetext', fmt(audio.currentTime) + ' / ' + fmt(d));
    }
    function state() {
      var playing = !audio.paused;
      root.classList.toggle('is-playing', playing);
      play.setAttribute('aria-label', play.getAttribute(playing ? 'data-label-pause' : 'data-label-play'));
    }
    play.addEventListener('click', function () {
      if (audio.paused) {
        document.querySelectorAll('[data-player] audio').forEach(function (a) { if (a !== audio) a.pause(); });
        var pr = audio.play();
        if (pr && pr.catch) pr.catch(function () {});
      } else audio.pause();
    });
    audio.addEventListener('play', state);
    audio.addEventListener('pause', state);
    audio.addEventListener('ended', state);
    audio.addEventListener('timeupdate', paint);
    audio.addEventListener('loadedmetadata', function () { dur.textContent = fmt(audio.duration); paint(); });
    scrub.addEventListener('input', function () {
      seeking = true;
      var d = audio.duration || 0;
      if (d) audio.currentTime = (scrub.value / 1000) * d;
      paint();
      seeking = false;
    });
    root.querySelectorAll('[data-skip]').forEach(function (b) {
      b.addEventListener('click', function () {
        var d = audio.duration || 0;
        audio.currentTime = Math.max(0, Math.min(d, audio.currentTime + parseFloat(b.getAttribute('data-skip'))));
      });
    });
    speed.addEventListener('click', function () {
      si = (si + 1) % SPEEDS.length;
      audio.playbackRate = SPEEDS[si];
      speed.textContent = String(SPEEDS[si]).replace('.', root.getAttribute('data-lang') === 'fr' ? ',' : '.') + '×';
    });
    paint();
    return {
      load: function (src, label) {
        if (audio.getAttribute('src') !== src) {
          audio.setAttribute('src', src);
          audio.load();
          audio.playbackRate = SPEEDS[si];
        }
        if (title && label) title.textContent = label;
        var pr = audio.play();
        if (pr && pr.catch) pr.catch(function () {});
        root.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        play.focus({ preventScroll: true });
      },
    };
  }

  function boot() {
    var players = [];
    document.querySelectorAll('[data-player]').forEach(function (el) { var p = init(el); if (p) players.push(p); });
    var main = players[0];
    document.querySelectorAll('[data-play]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (main) main.load(btn.getAttribute('data-src'), btn.getAttribute('data-title'));
      });
    });
  }
  document.readyState !== 'loading' ? boot() : document.addEventListener('DOMContentLoaded', boot);
})();
