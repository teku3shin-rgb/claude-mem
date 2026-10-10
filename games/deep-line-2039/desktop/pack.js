'use strict';
// 配布用のフォルダを作る: node pack.js [win32|darwin|linux] [x64|arm64]
// ゲーム本体（index.html, js/, vendor/）を game/ に写してから Electron と一緒にまとめる。
const fs = require('fs');
const path = require('path');

const platform = process.argv[2] || process.platform;
const arch = process.argv[3] || (platform === 'darwin' ? 'arm64' : 'x64');
const root = path.join(__dirname, '..');
const dst = path.join(__dirname, 'game');
fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(dst);
fs.copyFileSync(path.join(root, 'index.html'), path.join(dst, 'index.html'));
for (const d of ['js', 'vendor']) fs.cpSync(path.join(root, d), path.join(dst, d), { recursive: true });

(async () => {
  const mod = require('@electron/packager');
  const packager = mod.packager || mod.default || mod;
  const out = await packager({
    dir: __dirname,
    out: path.join(__dirname, 'dist'),
    name: 'DEEP LINE 2039',
    platform,
    arch,
    overwrite: true,
    asar: true,
    ignore: [/^\/dist($|\/)/, /^\/pack\.js$/],
  });
  console.log(out.join('\n'));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
