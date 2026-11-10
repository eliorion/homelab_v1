#!/usr/bin/env python3
"""Bundle the overview (FR + EN) and the five sites into one folder that works offline and as one artifact.

Usage: python3 make-bundle.py <reworks-dir> <out-dir>
Writes <out-dir>/artifact/ (main page without <html> wrapper, for the Artifact tool) and
<out-dir>/offline/ (index.html opens by double-click, no server needed).
"""
import os, re, shutil, subprocess, sys

root, out = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
SITES = ['site-1-lumiere', 'site-2-lettre', 'site-3-kimia', 'site-4-nord', 'site-5-coeur-ouvert']
tool = os.path.join(root, 'shared/tools/make-portable.py')
stage = os.path.join(out, 'stage')
shutil.rmtree(out, ignore_errors=True)
os.makedirs(stage)

# 1. portable copies, pruned to files something actually references (keeps the bundle under 511 files)
for s in SITES:
    dst = os.path.join(stage, s)
    subprocess.run([sys.executable, '-I', tool, os.path.join(root, s), dst], check=True, stdout=subprocess.DEVNULL)
    for d, _, fs in os.walk(dst):  # <picture> keeps its JPEG fallback; WebP twins would double the file count
        for n in fs:
            if n.endswith('.html'):
                p = os.path.join(d, n)
                h = open(p, encoding='utf-8').read()
                open(p, 'w', encoding='utf-8').write(re.sub(r'<source[^>]*type="image/webp"[^>]*>', '', h))
    texts = []
    for d, _, fs in os.walk(dst):
        for n in fs:
            if n.endswith(('.html', '.css', '.js')):
                texts.append(open(os.path.join(d, n), encoding='utf-8').read())
    blob = '\n'.join(texts)
    for d, _, fs in os.walk(dst):
        for n in fs:
            p = os.path.join(d, n)
            keep = n.endswith(('.html', '.css', '.js')) and n != '404.html'
            if not keep and not n.endswith(('.webmanifest', '.gitkeep')):
                keep = n in blob
            if not keep:
                os.remove(p)

# 2. "back to the proposals" pill on every site page
PILL = ('<a class="lpdc-back" href="{href}" style="position:fixed;left:12px;bottom:{b};z-index:2147483000;'
        'background:#1A221B;color:#fff;font:600 13px/1 system-ui,sans-serif;padding:10px 14px;border-radius:999px;'
        'text-decoration:none;box-shadow:0 6px 18px rgba(0,0,0,.25)">{label}</a>')
for s in SITES:
    base = os.path.join(stage, s)
    for d, _, fs in os.walk(base):
        for n in fs:
            if not n.endswith('.html'):
                continue
            p = os.path.join(d, n)
            rel = os.path.relpath(stage, d).replace(os.sep, '/')
            en = os.path.relpath(p, base).startswith('en' + os.sep)
            href = f'{rel}/{"en.html" if en else "index.html"}#{s[:6]}'
            label = '← All 5 proposals' if en else '← Les 5 propositions'
            b = '84px' if s == 'site-1-lumiere' else '16px'  # site 1 has a mobile donate bar at the bottom
            html = open(p, encoding='utf-8').read()
            html = html.replace('</body>', PILL.format(href=href, b=b, label=label) + '</body>', 1)
            open(p, 'w', encoding='utf-8').write(html)

# 3. overview pages: links to the in-bundle sites instead of separate artifacts
ART = {
    'YBNseFxzaiq9javHu9a916': 'site-1-lumiere', 'RSv633XD7uqzn3kPuo95Lp': 'site-2-lettre',
    'R42QTKeeReJ73mcghqc361': 'site-3-kimia', '631FkZCyh5cBkWWrCKHtTm': 'site-4-nord',
    'UNz1KbSMX64pmLQAsZ9eha': 'site-5-coeur-ouvert',
}
def localize(html, lang, other):
    for aid, s in ART.items():
        html = html.replace(f'href="https://claude.ai/artifact/{aid}" target="_blank" rel="noopener"', f'href="{s}/{lang}/index.html"')
    html = re.sub(r'href="https://claude\.ai/artifact/(LZnc1MruCEb1vj2QGVRXPi|FoBxBBs9i7P5HFTnaGKmus)" target="_blank" rel="noopener"', f'href="{other}"', html)
    for n in range(1, 6):  # anchors the sites' back pill returns to
        html = html.replace(f'<article class="proposal" id="p{n}">', f'<article class="proposal" id="p{n}"><span id="{SITES[n-1][:6]}"></span>', 1)
    return html

fr = localize(open(os.path.join(root, 'overview/proposals-fr.html'), encoding='utf-8').read(), 'fr', 'en.html')
en = localize(open(os.path.join(root, 'overview/proposals.html'), encoding='utf-8').read(), 'en', 'index.html')
shutil.copytree(os.path.join(root, 'overview/img'), os.path.join(stage, 'img'))

def standalone(body, lang):
    return (f'<!doctype html>\n<html lang="{lang}">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
            '<style>html,body{margin:0}</style>\n</head>\n<body>\n' + body + '\n</body>\n</html>\n')

open(os.path.join(stage, 'en.html'), 'w', encoding='utf-8').write(standalone(en, 'en-CA'))

for kind in ('artifact', 'offline'):
    shutil.copytree(stage, os.path.join(out, kind))
open(os.path.join(out, 'artifact', 'index.html'), 'w', encoding='utf-8').write(fr)
open(os.path.join(out, 'offline', 'index.html'), 'w', encoding='utf-8').write(standalone(fr, 'fr-CA'))
shutil.rmtree(stage)

# artifact: calendar/RSS files would push it past 511 files; offline: Chrome blocks file:// web fonts, so inline them
import base64
for d, _, fs in os.walk(os.path.join(out, 'artifact')):
    for n in fs:
        if n.endswith(('.ics', '.xml')):
            os.remove(os.path.join(d, n))
off = os.path.join(out, 'offline')
for d, _, fs in os.walk(off):
    for n in fs:
        p = os.path.join(d, n)
        if n.endswith('.css'):
            css = open(p, encoding='utf-8').read()
            def data(m):
                f = os.path.normpath(os.path.join(d, m.group(2)))
                if not os.path.exists(f):
                    return m.group(0)
                return 'url(data:font/woff2;base64,' + base64.b64encode(open(f, 'rb').read()).decode() + ')'
            open(p, 'w', encoding='utf-8').write(re.sub(r'url\((["\']?)([^)"\']+\.woff2)\1\)', data, css))
        elif n.endswith('.html'):
            h = open(p, encoding='utf-8').read()
            open(p, 'w', encoding='utf-8').write(re.sub(r'<link[^>]*rel="preload"[^>]*as="font"[^>]*>', '', h))

n = sum(len(f) for _, _, f in os.walk(os.path.join(out, 'artifact')))
print(f'bundle: {n} files in {out}/artifact (and /offline)')
