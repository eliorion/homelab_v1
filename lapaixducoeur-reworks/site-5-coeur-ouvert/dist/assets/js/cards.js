(() => {
  'use strict';
  const root = document.querySelector('[data-cardgen]');
  const dataEl = document.getElementById('card-data');
  if (!root || !dataEl) return;
  const cfg = JSON.parse(dataEl.textContent);
  const form = root.querySelector('[data-card-form]');
  const canvas = root.querySelector('[data-card-canvas]');
  const dl = root.querySelector('[data-card-download]');
  const shareBtn = root.querySelector('[data-card-share]');
  const status = root.querySelector('[data-card-status]');
  const custom = form.querySelector('#card-custom');
  const ctx = canvas.getContext('2d');
  const baseLabel = canvas.getAttribute('aria-label');

  const PALETTE = {
    coral: { bg: '#E8503A', fg: '#141414', accent: '#F5F1EA', rule: '#141414' },
    ink: { bg: '#141414', fg: '#F5F1EA', accent: '#E8503A', rule: '#F5F1EA' },
    paper: { bg: '#F5F1EA', fg: '#141414', accent: '#E8503A', rule: '#141414' },
  };
  const DISPLAY = '"Anton", Impact, "Arial Narrow", sans-serif';
  const SERIF = '"Source Serif 4", Georgia, serif';

  const state = () => {
    const fd = new FormData(form);
    const v = fd.get('verse');
    const chosen = v === 'custom'
      ? { text: (custom.value || '').trim() || custom.placeholder, ref: '' }
      : cfg.verses[Number(v)];
    return { ...chosen, style: fd.get('style'), format: fd.get('format') };
  };

  const wrap = (text, maxW) => {
    const words = text.split(/\s+/);
    const lines = [];
    let line = '';
    words.forEach((w) => {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
    });
    if (line) lines.push(line);
    return lines;
  };

  const heart = (x, y, s, color) => {
    ctx.save(); ctx.translate(x, y); ctx.scale(s / 24, s / 24); ctx.fillStyle = color;
    ctx.fill(new Path2D('M12 21.2 3.9 13.4C1.5 11.1 1.6 7.2 4.1 5.2c2.2-1.8 5.3-1.4 7.1.6L12 6.7l.8-.9c1.8-2 4.9-2.4 7.1-.6 2.5 2 2.6 5.9.2 8.2L12 21.2Z'));
    ctx.restore();
  };

  const draw = () => {
    const s = state();
    const W = 1080; const H = s.format === 'story' ? 1920 : 1080;
    canvas.width = W; canvas.height = H;
    canvas.classList.toggle('is-story', s.format === 'story');
    const P = PALETTE[s.style] || PALETTE.coral;
    const M = 90;
    ctx.fillStyle = P.bg; ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'alphabetic';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '5px';
    ctx.fillStyle = P.fg;
    ctx.font = `30px ${DISPLAY}`;
    ctx.fillText('LA PAIX DU CŒUR · KIMIA NA MOTEMA', M, M + 24);
    ctx.fillStyle = P.rule; ctx.fillRect(M, M + 50, W - 2 * M, 5);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';

    const top = M + 50 + (s.format === 'story' ? 300 : 70);
    ctx.fillStyle = P.accent;
    ctx.font = `300px ${DISPLAY}`;
    ctx.fillText('“', M - 8, top + 210);

    const textTop = top + 170;
    const limit = H - M - 70 - 40 - (s.ref ? 90 : 0) - (s.format === 'story' ? 240 : 0);
    const maxW = W - 2 * M;
    const upper = s.text.toLocaleUpperCase(cfg.lang === 'fr' ? 'fr-CA' : 'en-CA');
    const LH = 1.04;
    let size = 150; let lines = [];
    for (; size >= 40; size -= 4) {
      ctx.font = `${size}px ${DISPLAY}`;
      lines = wrap(upper, maxW);
      if (textTop + size + (lines.length - 1) * size * LH <= limit) break;
    }
    ctx.fillStyle = P.fg;
    let y = textTop + size;
    lines.forEach((l, i) => {
      if (i === lines.length - 1 && s.style !== 'coral') ctx.fillStyle = P.accent;
      ctx.fillText(l, M, y);
      if (i < lines.length - 1) y += size * LH;
    });

    if (s.ref) {
      ctx.fillStyle = s.style === 'coral' ? P.fg : P.accent;
      ctx.font = `italic 46px ${SERIF}`;
      ctx.fillText(`— ${s.ref}`, M, y + 84);
    }

    ctx.fillStyle = P.rule; ctx.fillRect(M, H - M - 70, W - 2 * M, 5);
    heart(M, H - M - 44, 44, s.style === 'coral' ? P.fg : P.accent);
    ctx.fillStyle = P.fg;
    ctx.font = `34px ${DISPLAY}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
    ctx.fillText(cfg.sig.toUpperCase(), M + 62, H - M - 8);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';

    canvas.setAttribute('aria-label', `${baseLabel}${cfg.lang === 'fr' ? ' : ' : ': '}${s.text}${s.ref ? ` — ${s.ref}` : ''}`);
  };

  const blob = () => new Promise((res) => canvas.toBlob(res, 'image/png'));
  const fileName = () => `lapaixducoeur-${state().style}-${state().format}.png`;

  dl.addEventListener('click', async () => {
    const b = await blob();
    if (!b) return;
    const url = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = url; a.download = fileName();
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    status.textContent = cfg.lang === 'fr' ? 'Carte téléchargée. Merci de la partager !' : 'Card downloaded. Thank you for sharing it!';
  });

  const canShareFiles = () => {
    try { return !!(navigator.canShare && navigator.canShare({ files: [new File([new Blob(['x'])], 'x.png', { type: 'image/png' })] })); } catch (e) { return false; }
  };
  if (canShareFiles()) {
    shareBtn.hidden = false;
    shareBtn.addEventListener('click', async () => {
      const b = await blob();
      const file = new File([b], fileName(), { type: 'image/png' });
      try { await navigator.share({ files: [file], title: cfg.shareTitle, text: 'https://lapaixducoeur.ca' }); } catch (e) { /* cancelled */ }
    });
  }

  custom.addEventListener('input', () => { const r = form.querySelector('input[name="verse"][value="custom"]'); if (r) r.checked = true; draw(); });
  form.addEventListener('change', draw);
  form.addEventListener('submit', (e) => e.preventDefault());

  draw();
  if (document.fonts && document.fonts.load) {
    Promise.all([document.fonts.load(`100px ${DISPLAY}`), document.fonts.load(`italic 46px ${SERIF}`)]).then(draw).catch(() => {});
  }
})();
