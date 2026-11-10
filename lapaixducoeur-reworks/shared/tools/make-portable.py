#!/usr/bin/env python3
"""Copy a site's dist/ into a folder that works without a web root (artifact preview, file share, USB key).

Root-absolute links (/fr/a-propos/, /assets/x.css) become relative ones (../../fr/a-propos/index.html),
directory links get an explicit index.html, and server-only files are dropped.
Usage: python3 make-portable.py <site-dir> <out-dir>
"""
import os, re, shutil, sys

site, out = sys.argv[1], sys.argv[2]
dist = os.path.join(site, 'dist')
SKIP = {'admin', '_headers', 'sitemap.xml', 'robots.txt', 'index.html'}  # root index = language chooser; '/' maps to fr/

shutil.rmtree(out, ignore_errors=True)
shutil.copytree(dist, out, ignore=lambda d, names: [n for n in names if d == dist and n in SKIP])

roots = sorted((n for n in os.listdir(out)), key=len, reverse=True)
seg = '|'.join(re.escape(n) for n in roots)
pat = re.compile(r'(?<=["\'(\s,=;])/((?:%s)(?:/[^"\'()\s,<>&#?]*)?)(?=[/"\'()\s,<>&#?])' % seg)
root_link = re.compile(r'(?<=href=["\'])/(?=["\'#])')

def target(rel):
    p = os.path.join(out, rel.rstrip('/'))
    if os.path.isdir(p):
        return rel.rstrip('/') + '/index.html'
    return rel

def rewrite(path):
    prefix = os.path.relpath(out, os.path.dirname(path)).replace(os.sep, '/')
    prefix = '' if prefix == '.' else prefix + '/'
    with open(path, encoding='utf-8') as f:
        text = f.read()
    text = pat.sub(lambda m: prefix + target(m.group(1)), text)
    text = root_link.sub(prefix + 'fr/index.html', text)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)

count = 0
for d, _, files in os.walk(out):
    for n in files:
        if n.endswith(('.html', '.css')):
            rewrite(os.path.join(d, n))
            count += 1
print(f'{out}: rewrote {count} html/css files, {sum(len(f) for _, _, f in os.walk(out))} files total')
