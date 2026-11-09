export const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const TBC = /\[([^\]]*(?:à confirmer|to confirm|si enregistré|if registered)[^\]]*)\](?!\()/gi;

function inline(s) {
  return esc(s)
    .replace(TBC, '<span class="tbc">[$1]</span>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => {
      const ext = /^https?:/.test(u);
      return `<a href="${u}"${ext ? ' rel="noopener"' : ''}>${t}</a>`;
    });
}

export const txt = (s = '') => inline(s);

export function md(src = '') {
  const blocks = String(src).replace(/\r/g, '').split(/\n{2,}/);
  return blocks
    .map((b) => {
      b = b.trim();
      if (!b) return '';
      let m;
      if ((m = b.match(/^(#{2,4})\s+(.*)$/))) return `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`;
      if (/^[-*]\s/.test(b)) {
        return `<ul>${b.split(/\n/).map((l) => `<li>${inline(l.replace(/^[-*]\s+/, ''))}</li>`).join('')}</ul>`;
      }
      if (/^\d+\.\s/.test(b)) {
        return `<ol>${b.split(/\n/).map((l) => `<li>${inline(l.replace(/^\d+\.\s+/, ''))}</li>`).join('')}</ol>`;
      }
      if (/^>\s?/.test(b)) {
        return `<blockquote><p>${inline(b.replace(/^>\s?/gm, '').replace(/\n/g, ' '))}</p></blockquote>`;
      }
      return `<p>${inline(b).replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');
}

export const plain = (src = '') =>
  String(src).replace(/[*#>_]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').trim();
