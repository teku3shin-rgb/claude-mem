// index.html（Artifact 用の本体）から、インストールできる Web アプリ版を app/ に書き出す。
// 使い方: node job-search-scheduler/build.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const body = readFileSync(join(here, 'index.html'), 'utf8');
const out = join(here, 'app');
mkdirSync(out, { recursive: true });

const head = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#1f3c88">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="就活手帳">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="icon-180.png">
<style>
:root { color-scheme: light; padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }
body { margin: 0; -webkit-text-size-adjust: 100%; }
img { max-width: 100%; }
[hidden] { display: none !important; }
</style>
<script>window.__PWA__ = true;</script>
</head>
<body>
`;

const tail = `
<script>
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
</script>
</body>
</html>
`;

writeFileSync(join(out, 'index.html'), head + body + tail);
console.log('wrote app/index.html');
