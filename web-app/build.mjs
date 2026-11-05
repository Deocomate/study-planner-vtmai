#!/usr/bin/env node
// Build dist/index.html from src/ and i18n/vi.json.
// Usage: node build.mjs   (no dependencies)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, 'src');
const read = (p) => readFileSync(p, 'utf8');
let js = [1, 2, 3, 4, 5].map((i) => read(join(SRC, `js${i}.js`))).join('');
const vi = JSON.parse(read(join(ROOT, 'i18n', 'vi.json')));
const keys = new Set([...js.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g), ...js.matchAll(/\bt\("((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]));
const missing = [...keys].filter((k) => !(k in vi)).sort();
if (missing.length) console.log('Missing Vietnamese translations:\n  ' + missing.join('\n  '));
// Match Python's json.dumps(ensure_ascii=False): ", " and ": " separators.
const dumps = (v) => (Array.isArray(v) ? `[${v.map(dumps).join(', ')}]`
  : v && typeof v === 'object' ? `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${dumps(x)}`).join(', ')}}`
    : JSON.stringify(v));
js = js.replace('VI_FILL();', () => `Object.assign(VI, ${dumps(vi)});`);
const html = `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="claude:viewport-fit-sides" content="cover">
<title>Study Planner</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">
<style>
${read(join(SRC, 'style.css'))}
</style>
</head>
<body>
<div class="holiday-sky" id="sky" aria-hidden="true"></div>
<header class="app-header" id="hdr"></header>
<main class="container-page" id="main"></main>
<footer id="foot"></footer>
<script>
${js}
</script>
</body>
</html>
`;
const out = join(ROOT, 'dist', 'index.html');
writeFileSync(out, html, 'utf8');
console.log(`Wrote ${out} (${html.length.toLocaleString('en-US')} chars)`);
