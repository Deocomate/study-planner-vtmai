#!/usr/bin/env python3
"""Build dist/index.html: one self-contained page = src/style.css + src/js1..js5.js + i18n/vi.json.
Usage: python3 build.py   (no dependencies)"""
import json, re, pathlib
ROOT = pathlib.Path(__file__).resolve().parent
SRC = ROOT / 'src'
js = ''.join((SRC / f'js{i}.js').read_text(encoding='utf-8') for i in range(1, 6))
vi = json.loads((ROOT / 'i18n' / 'vi.json').read_text(encoding='utf-8'))
keys = set(re.findall(r"\bt\('((?:[^'\\]|\\.)*)'", js)) | set(re.findall(r'\bt\("((?:[^"\\]|\\.)*)"', js))
missing = sorted(k for k in keys if k not in vi)
if missing:
    print('Missing Vietnamese translations:', *missing, sep='\n  ')
js = js.replace('VI_FILL();', 'Object.assign(VI, ' + json.dumps(vi, ensure_ascii=False) + ');')
html = """<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="claude:viewport-fit-sides" content="cover">
<title>Study Planner</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">
<style>
""" + (SRC / 'style.css').read_text(encoding='utf-8') + """
</style>
</head>
<body>
<div class="holiday-sky" id="sky" aria-hidden="true"></div>
<header class="app-header" id="hdr"></header>
<main class="container-page" id="main"></main>
<footer id="foot"></footer>
<script>
""" + js + """
</script>
</body>
</html>
"""
out = ROOT / 'dist' / 'index.html'
out.write_text(html, encoding='utf-8')
print(f'Wrote {out} ({len(html):,} chars)')
