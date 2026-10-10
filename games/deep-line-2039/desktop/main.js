'use strict';
// デスクトップ版（Electron）: ブラウザの枠なしでゲームを全画面で動かす
//   npm install && npm start
// ゲーム本体は一つ上のディレクトリの index.html をそのまま読む。
const { app, BrowserWindow, globalShortcut, screen } = require('electron');
const path = require('path');

// GPU を確実に使う（ブロックリストの古いドライバーでも WebGL2 を有効に）
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('force_high_performance_gpu');

const args = process.argv.slice(app.isPackaged ? 1 : 2);
const windowed = args.includes('--windowed');
const query = {};
// --gfx=low|medium|high|ultra で画質、--dev --ch=N で章を直接開く（--debug は Node が使うので別名）
for (const a of args) {
  const m = /^--(gfx|ch)=(.+)$/.exec(a);
  if (m) query[m[1]] = m[2];
  if (a === '--dev') query.debug = '1';
}

function create() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: Math.min(1920, width),
    height: Math.min(1080, height),
    fullscreen: !windowed,
    backgroundColor: '#050505',
    autoHideMenuBar: true,
    title: 'DEEP LINE 2039',
    webPreferences: { backgroundThrottling: false, contextIsolation: true, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  // 配布版は同梱の game/、開発中は一つ上のディレクトリを読む
  const packed = path.join(__dirname, 'game', 'index.html');
  win.loadFile(require('fs').existsSync(packed) ? packed : path.join(__dirname, '..', 'index.html'), { query });
  // F11 で全画面の切り替え、Ctrl+Shift+I で開発者ツール
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    } else if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      win.webContents.toggleDevTools();
      e.preventDefault();
    }
  });
  if (process.env.DL_SMOKE) {
    // 動作確認用: 読み込みとエラーを標準出力に出し、一定時間で終了する
    win.webContents.on('console-message', (_e, level, msg) => console.log(`[console:${level}] ${msg}`));
    win.webContents.on('did-finish-load', () => console.log('[smoke] loaded'));
    setTimeout(async () => {
      const r = await win.webContents.executeJavaScript('JSON.stringify({ ready: !!(window.DL && DL.game && DL.game.ready), post: DL.game && DL.game.post && DL.game.post.name, webgl2: !!(DL.game && DL.game.renderer.capabilities.isWebGL2) })');
      console.log('[smoke] state', r);
      const img = await win.webContents.capturePage();
      require('fs').writeFileSync(process.env.DL_SMOKE, img.toPNG());
      app.quit();
    }, +(process.env.DL_SMOKE_MS || 20000));
  }
}

app.whenReady().then(create);
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => globalShortcut.unregisterAll());
