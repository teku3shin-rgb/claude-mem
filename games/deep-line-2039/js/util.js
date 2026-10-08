'use strict';
// 共通ユーティリティ・手続き型テクスチャ・マテリアル
(function () {
  const DL = (window.DL = window.DL || {});
  const T = window.THREE;

  DL.CS = 2; // グリッド1セル = 2m

  DL.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  DL.lerp = (a, b, t) => a + (b - a) * t;
  DL.rand = (a = 0, b = 1) => a + Math.random() * (b - a);
  DL.randi = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
  DL.pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  DL.chance = (p) => Math.random() < p;
  DL.wrapAngle = (a) => {
    a = (a + Math.PI) % (Math.PI * 2);
    if (a < 0) a += Math.PI * 2;
    return a - Math.PI;
  };
  DL.approach = (v, t, d) => (v < t ? Math.min(v + d, t) : Math.max(v - d, t));
  DL.damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
  DL.smooth = (t) => t * t * (3 - 2 * t);
  DL.rng = (seed) => {
    let s = seed >>> 0 || 0x9e3779b9;
    return () => {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  };
  // yaw の向き: forward = (-sin(yaw), 0, -cos(yaw))（three.js のカメラと同じ）
  DL.yawTo = (dx, dz) => Math.atan2(-dx, -dz);

  // ---------- 値ノイズ（タイル可能） ----------
  DL.makeNoise = function (seed) {
    const r = DL.rng(seed * 7919 + 13);
    const P = 128;
    const v = new Float32Array(P * P);
    for (let i = 0; i < v.length; i++) v[i] = r();
    return function (x, y, px, py) {
      px = Math.min(px | 0 || P, P);
      py = Math.min(py | 0 || px, P);
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = x - xi, yf = y - yi;
      const x0 = ((xi % px) + px) % px, y0 = ((yi % py) + py) % py;
      const x1 = (x0 + 1) % px, y1 = (y0 + 1) % py;
      const a = v[y0 * P + x0], b = v[y0 * P + x1], c = v[y1 * P + x0], d = v[y1 * P + x1];
      const u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
      return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
    };
  };
  DL.fbm = function (N, x, y, oct, px, py) {
    py = py || px;
    let s = 0, amp = 0.5, f = 1, norm = 0;
    for (let o = 0; o < oct; o++) {
      s += amp * N(x * f, y * f, px * f, py * f);
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return s / norm;
  };

  // ---------- キャンバス ----------
  function mkCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h || w;
    const gc = c.getContext.bind(c);
    c.getContext = (type, opts) => gc(type, Object.assign({ willReadFrequently: true }, opts || {}));
    return c;
  }
  DL.mkCanvas = mkCanvas;
  function toTex(c, opts = {}) {
    const t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = opts.clamp ? T.ClampToEdgeWrapping : T.RepeatWrapping;
    if (opts.srgb !== false) t.encoding = T.sRGBEncoding;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  }
  DL.toTex = toTex;
  function perPixel(ctx, S, fn) {
    // getImageData を多用するので willReadFrequently のキャンバスを推奨（既存の ctx でも動く）
    const img = ctx.getImageData(0, 0, S, S), d = img.data, o = [0, 0, 0];
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const k = (y * S + x) * 4;
        o[0] = d[k]; o[1] = d[k + 1]; o[2] = d[k + 2];
        fn(x, y, o);
        d[k] = o[0]; d[k + 1] = o[1]; d[k + 2] = o[2]; d[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  function cracks(g, r, S, n, alpha) {
    g.strokeStyle = `rgba(18,18,16,${alpha})`;
    g.lineWidth = 1;
    for (let i = 0; i < n; i++) {
      let x = r() * S, y = r() * S;
      g.beginPath();
      g.moveTo(x, y);
      for (let j = 0; j < 12; j++) {
        x += (r() - 0.5) * 20;
        y += (r() - 0.35) * 16;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  }
  function grime(g, S, seed, amt, warm) {
    const N = DL.makeNoise(seed), N2 = DL.makeNoise(seed + 5);
    perPixel(g, S, (x, y, o) => {
      const d = DL.fbm(N, (x / S) * 6, (y / S) * 6, 4, 6);
      const st = DL.fbm(N2, (x / S) * 24, (y / S) * 3, 3, 24, 3);
      const m = 1 - amt * (0.6 - 0.9 * d) - Math.max(0, st - 0.58) * amt * 1.4;
      o[0] *= m; o[1] *= m * (warm ? 0.97 : 1); o[2] *= m * (warm ? 0.9 : 1);
    });
  }

  // ---------- テクスチャ ----------
  function texConcrete(seed, base, S = 256) {
    const c = mkCanvas(S), g = c.getContext('2d');
    const N = DL.makeNoise(seed), N2 = DL.makeNoise(seed + 1), r = DL.rng(seed);
    perPixel(g, S, (x, y, o) => {
      const n = DL.fbm(N, (x / S) * 8, (y / S) * 8, 5, 8);
      const st = DL.fbm(N2, (x / S) * 16, (y / S) * 2, 3, 16, 2);
      const sp = r();
      const v = 0.5 + 0.75 * n - Math.max(0, st - 0.55) * 0.9 + (sp < 0.01 ? -0.25 : 0);
      o[0] = base[0] * v; o[1] = base[1] * v; o[2] = base[2] * v;
    });
    cracks(g, r, S, 5, 0.5);
    // 型枠の継ぎ目
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(0, S - 2, S, 2);
    return c;
  }
  function texTiles(seed, base, S = 256, n = 8) {
    const c = mkCanvas(S), g = c.getContext('2d'), r = DL.rng(seed);
    g.fillStyle = 'rgb(58,56,50)';
    g.fillRect(0, 0, S, S);
    const ts = S / n;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        if (r() < 0.045) {
          const k = 60 + r() * 20;
          g.fillStyle = `rgb(${k | 0},${(k - 2) | 0},${(k - 6) | 0})`;
          g.fillRect(i * ts, j * ts, ts, ts);
          continue;
        }
        const k = 0.82 + r() * 0.22;
        g.fillStyle = `rgb(${(base[0] * k) | 0},${(base[1] * k) | 0},${(base[2] * k) | 0})`;
        g.fillRect(i * ts + 1.5, j * ts + 1.5, ts - 3, ts - 3);
        g.fillStyle = 'rgba(255,255,255,0.09)';
        g.fillRect(i * ts + 1.5, j * ts + 1.5, ts - 3, 2);
        if (r() < 0.14) {
          g.strokeStyle = 'rgba(30,30,25,0.65)';
          g.beginPath();
          g.moveTo(i * ts + r() * ts, j * ts + 2);
          g.lineTo(i * ts + r() * ts, j * ts + ts - 2);
          g.stroke();
        }
      }
    }
    grime(g, S, seed + 3, 0.55, true);
    return c;
  }
  function texSlabs(seed, base, S = 256) {
    const c = mkCanvas(S), g = c.getContext('2d'), r = DL.rng(seed), N = DL.makeNoise(seed);
    perPixel(g, S, (x, y, o) => {
      const n = DL.fbm(N, (x / S) * 16, (y / S) * 16, 4, 16);
      const v = 0.62 + 0.55 * n + (r() - 0.5) * 0.12;
      o[0] = base[0] * v; o[1] = base[1] * v; o[2] = base[2] * v;
    });
    g.fillStyle = 'rgba(25,24,22,0.75)';
    for (let i = 0; i < 4; i++) {
      g.fillRect(i * 64, 0, 2, S);
      g.fillRect(0, i * 64, S, 2);
    }
    cracks(g, r, S, 4, 0.4);
    grime(g, S, seed + 9, 0.35, true);
    return c;
  }
  function texGravel(seed, S = 256) {
    const c = mkCanvas(S), g = c.getContext('2d'), r = DL.rng(seed), N = DL.makeNoise(seed);
    perPixel(g, S, (x, y, o) => {
      const n = DL.fbm(N, (x / S) * 16, (y / S) * 16, 3, 16);
      const v = 0.35 + 0.5 * n + (r() - 0.5) * 0.45;
      o[0] = 92 * v; o[1] = 84 * v; o[2] = 76 * v;
    });
    for (let i = 0; i < 500; i++) {
      const k = 40 + r() * 90;
      g.fillStyle = `rgba(${k | 0},${(k * 0.95) | 0},${(k * 0.88) | 0},0.85)`;
      g.beginPath();
      g.ellipse(r() * S, r() * S, 1 + r() * 3, 1 + r() * 2.5, r() * 3, 0, Math.PI * 2);
      g.fill();
    }
    return c;
  }
  function texBrick(seed, S = 256) {
    const c = mkCanvas(S), g = c.getContext('2d'), r = DL.rng(seed);
    g.fillStyle = 'rgb(62,55,48)';
    g.fillRect(0, 0, S, S);
    const bh = 16, bw = 42;
    for (let row = 0; row < S / bh; row++) {
      const off = row % 2 ? bw / 2 : 0;
      for (let x = -bw; x < S + bw; x += bw) {
        const k = 0.7 + r() * 0.35;
        g.fillStyle = `rgb(${(128 * k) | 0},${(66 * k) | 0},${(48 * k) | 0})`;
        g.fillRect(x + off + 1.5, row * bh + 1.5, bw - 3, bh - 3);
      }
    }
    grime(g, S, seed + 2, 0.6, true);
    return c;
  }
  function texMetal(seed, S = 256) {
    const c = mkCanvas(S), g = c.getContext('2d'), r = DL.rng(seed), N = DL.makeNoise(seed), N2 = DL.makeNoise(seed + 7);
    perPixel(g, S, (x, y, o) => {
      const n = DL.fbm(N, (x / S) * 8, (y / S) * 8, 5, 8);
      const rust = DL.fbm(N2, (x / S) * 4, (y / S) * 4, 4, 4);
      const t = DL.clamp((rust - 0.42) * 3, 0, 1);
      const v = 0.6 + 0.5 * n;
      o[0] = DL.lerp(78, 120, t) * v; o[1] = DL.lerp(80, 62, t) * v; o[2] = DL.lerp(82, 40, t) * v;
    });
    g.fillStyle = 'rgba(0,0,0,0.45)';
    for (let i = 0; i < 2; i++) {
      g.fillRect(i * 128, 0, 2, S);
      g.fillRect(0, i * 128, S, 2);
    }
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        for (const [ox, oy] of [[8, 8], [120, 8], [8, 120], [120, 120]]) {
          g.fillStyle = 'rgba(30,25,20,0.8)';
          g.beginPath();
          g.arc(i * 128 + ox, j * 128 + oy, 3, 0, 7);
          g.fill();
          g.fillStyle = 'rgba(200,190,170,0.25)';
          g.beginPath();
          g.arc(i * 128 + ox - 1, j * 128 + oy - 1, 1.2, 0, 7);
          g.fill();
        }
      }
    }
    void r;
    return c;
  }
  function texAsphalt(seed, S = 256) {
    const c = mkCanvas(S), g = c.getContext('2d'), r = DL.rng(seed), N = DL.makeNoise(seed), N2 = DL.makeNoise(seed + 3);
    perPixel(g, S, (x, y, o) => {
      const n = DL.fbm(N, (x / S) * 16, (y / S) * 16, 4, 16);
      const ash = DL.fbm(N2, (x / S) * 4, (y / S) * 4, 4, 4);
      const a = DL.clamp((ash - 0.48) * 2.5, 0, 1);
      const v = 0.6 + 0.5 * n + (r() - 0.5) * 0.2;
      o[0] = DL.lerp(46 * v, 120, a); o[1] = DL.lerp(46 * v, 116, a); o[2] = DL.lerp(48 * v, 110, a);
    });
    cracks(g, r, S, 8, 0.7);
    return c;
  }
  function texRubble(seed, S = 256) {
    const c = mkCanvas(S), g = c.getContext('2d'), r = DL.rng(seed), N = DL.makeNoise(seed);
    perPixel(g, S, (x, y, o) => {
      const n = DL.fbm(N, (x / S) * 8, (y / S) * 8, 5, 8);
      const v = 0.45 + 0.7 * n;
      o[0] = 88 * v; o[1] = 78 * v; o[2] = 66 * v;
    });
    for (let i = 0; i < 160; i++) {
      const k = 50 + r() * 80;
      g.fillStyle = `rgba(${k | 0},${(k * 0.96) | 0},${(k * 0.9) | 0},0.9)`;
      g.beginPath();
      const x = r() * S, y = r() * S, rr = 2 + r() * 7;
      g.moveTo(x + rr, y);
      for (let a = 1; a < 6; a++) g.lineTo(x + Math.cos(a * 1.2) * rr * (0.6 + r() * 0.5), y + Math.sin(a * 1.2) * rr * (0.6 + r() * 0.5));
      g.fill();
    }
    return c;
  }
  function texMarble(seed, S = 256) {
    const c = mkCanvas(S), g = c.getContext('2d'), N = DL.makeNoise(seed);
    perPixel(g, S, (x, y, o) => {
      const n = DL.fbm(N, (x / S) * 4, (y / S) * 4, 5, 4);
      const vein = Math.pow(1 - Math.abs(Math.sin(((x + y * 0.4) / S) * Math.PI * 3 + n * 9)), 10);
      const v = 0.86 + 0.12 * n - vein * 0.35;
      o[0] = 214 * v; o[1] = 212 * v; o[2] = 204 * v;
    });
    g.fillStyle = 'rgba(80,78,72,0.5)';
    g.fillRect(0, 0, S, 1.5);
    g.fillRect(0, 0, 1.5, S);
    g.fillRect(128, 0, 1.5, S);
    g.fillRect(0, 128, S, 1.5);
    return c;
  }
  function texWood(seed, S = 256) {
    const c = mkCanvas(S), g = c.getContext('2d'), r = DL.rng(seed), N = DL.makeNoise(seed);
    const tones = [];
    for (let i = 0; i < 8; i++) tones.push(0.7 + r() * 0.4);
    perPixel(g, S, (x, y, o) => {
      const plank = Math.floor(y / 32);
      const n = DL.fbm(N, (x / S) * 2, (y / S) * 16, 3, 2, 16);
      const grain = 0.85 + 0.15 * Math.sin((y + n * 40) * 0.9);
      const v = tones[plank % 8] * grain * (y % 32 < 2 ? 0.45 : 1);
      o[0] = 104 * v; o[1] = 76 * v; o[2] = 50 * v;
    });
    grime(g, S, seed + 4, 0.3, true);
    return c;
  }
  function texFacade(seed, S = 256) {
    const c = mkCanvas(S), g = c.getContext('2d'), r = DL.rng(seed), N = DL.makeNoise(seed);
    perPixel(g, S, (x, y, o) => {
      const n = DL.fbm(N, (x / S) * 8, (y / S) * 8, 4, 8);
      const v = 0.55 + 0.6 * n;
      o[0] = 108 * v; o[1] = 106 * v; o[2] = 100 * v;
    });
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < 2; i++) {
        const x = i * 128 + 22, y = j * 128 + 26, w = 84, h = 70;
        g.fillStyle = 'rgb(60,58,54)';
        g.fillRect(x - 4, y - 4, w + 8, h + 8);
        const broken = r() < 0.45;
        const k = broken ? 8 : 22 + r() * 18;
        g.fillStyle = `rgb(${k | 0},${(k + 2) | 0},${(k + 5) | 0})`;
        g.fillRect(x, y, w, h);
        if (!broken) {
          g.fillStyle = 'rgba(160,170,180,0.12)';
          g.beginPath();
          g.moveTo(x, y + h);
          g.lineTo(x + w * 0.6, y);
          g.lineTo(x + w * 0.8, y);
          g.lineTo(x + w * 0.2, y + h);
          g.fill();
        } else {
          g.fillStyle = 'rgba(120,120,115,0.5)';
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + w * 0.3, y);
          g.lineTo(x, y + h * 0.4);
          g.fill();
        }
        g.fillStyle = 'rgb(70,68,64)';
        g.fillRect(x + w / 2 - 2, y, 4, h);
      }
    }
    grime(g, S, seed + 6, 0.5, false);
    return c;
  }
  function texCeiling(seed, S = 256) {
    const c = texConcrete(seed, [58, 58, 56], S), g = c.getContext('2d'), r = DL.rng(seed + 1);
    for (let i = 0; i < 6; i++) {
      g.fillStyle = `rgba(0,0,0,${0.12 + r() * 0.15})`;
      g.beginPath();
      g.ellipse(r() * S, r() * S, 20 + r() * 40, 10 + r() * 30, r() * 3, 0, 7);
      g.fill();
    }
    return c;
  }
  function texSkin(seed, S = 256) {
    const c = mkCanvas(S), g = c.getContext('2d'), N = DL.makeNoise(seed), N2 = DL.makeNoise(seed + 2);
    perPixel(g, S, (x, y, o) => {
      const n = DL.fbm(N, (x / S) * 8, (y / S) * 8, 4, 8);
      const vein = Math.pow(1 - Math.abs(DL.fbm(N2, (x / S) * 6, (y / S) * 6, 3, 6) - 0.5) * 2, 18);
      const v = 0.7 + 0.45 * n;
      o[0] = 168 * v - vein * 50; o[1] = 150 * v - vein * 60; o[2] = 145 * v - vein * 30;
    });
    return c;
  }
  function texCrate(seed, S = 256) {
    const c = texWood(seed, S), g = c.getContext('2d');
    g.strokeStyle = 'rgba(40,28,18,0.9)';
    g.lineWidth = 14;
    g.strokeRect(7, 7, S - 14, S - 14);
    g.beginPath();
    g.moveTo(14, 14);
    g.lineTo(S - 14, S - 14);
    g.stroke();
    g.fillStyle = 'rgba(25,22,18,0.55)';
    g.font = 'bold 40px "Stardos Stencil", Impact, sans-serif';
    g.textAlign = 'center';
    g.fillText('7.62', S / 2, S / 2 + 50);
    return c;
  }

  // ---------- ワールド用マテリアル ----------
  DL.MATS = ['concrete', 'tile', 'tileg', 'tileo', 'platform', 'gravel', 'brick', 'metal', 'asphalt', 'rubble', 'marble', 'wood', 'facade', 'ceiling'];
  DL.M = {};
  DL.MATS.forEach((n, i) => (DL.M[n] = i));
  const MAT_DEF = {
    concrete: { tex: () => texConcrete(11, [100, 99, 94]), s: 3, rough: 0.95, bump: 0.035 },
    tile: { tex: () => texTiles(21, [200, 200, 186]), s: 1.6, rough: 0.5, bump: 0.02 },
    tileg: { tex: () => texTiles(22, [118, 150, 128]), s: 1.6, rough: 0.55, bump: 0.02 },
    tileo: { tex: () => texTiles(23, [178, 122, 78]), s: 1.6, rough: 0.55, bump: 0.02 },
    platform: { tex: () => texSlabs(31, [128, 122, 112]), s: 2.5, rough: 0.85, bump: 0.025 },
    gravel: { tex: () => texGravel(41), s: 2, rough: 1, bump: 0.05 },
    brick: { tex: () => texBrick(51), s: 2.2, rough: 0.9, bump: 0.04 },
    metal: { tex: () => texMetal(61), s: 2, rough: 0.6, bump: 0.02, metal: 0.45 },
    asphalt: { tex: () => texAsphalt(71), s: 4, rough: 0.95, bump: 0.03 },
    rubble: { tex: () => texRubble(81), s: 3, rough: 1, bump: 0.05 },
    marble: { tex: () => texMarble(91), s: 3, rough: 0.22, bump: 0.005 },
    wood: { tex: () => texWood(101), s: 2, rough: 0.8, bump: 0.02 },
    facade: { tex: () => texFacade(111), s: 4, rough: 0.9, bump: 0.02 },
    ceiling: { tex: () => texCeiling(121), s: 3, rough: 1, bump: 0.03 },
  };
  let matCache = null;
  DL.getMaterials = function () {
    if (matCache) return matCache;
    matCache = DL.MATS.map((name) => {
      const d = MAT_DEF[name];
      const tex = toTex(d.tex());
      const m = new T.MeshStandardMaterial({ map: tex, bumpMap: tex, bumpScale: d.bump, roughness: d.rough, metalness: d.metal || 0 });
      m.userData.s = d.s;
      return m;
    });
    return matCache;
  };
  DL.uvScale = (i) => MAT_DEF[DL.MATS[i]].s;

  // ---------- 小物用マテリアル ----------
  const cmCache = new Map();
  DL.cmat = function (hex, rough = 0.85, metal = 0, emissive = 0, emissiveIntensity = 1) {
    const key = hex + '|' + rough + '|' + metal + '|' + emissive + '|' + emissiveIntensity;
    let m = cmCache.get(key);
    if (!m) {
      m = new T.MeshStandardMaterial({ color: hex, roughness: rough, metalness: metal, emissive: emissive || 0, emissiveIntensity });
      cmCache.set(key, m);
    }
    return m;
  };
  const texCache = {};
  DL.tex = function (name) {
    if (texCache[name]) return texCache[name];
    let t;
    switch (name) {
      case 'skin': t = toTex(texSkin(5)); break;
      case 'crate': t = toTex(texCrate(7)); break;
      case 'wood': t = toTex(texWood(9)); break;
      case 'metal': t = toTex(texMetal(13)); break;
      case 'cloth': t = toTex(texConcrete(17, [120, 110, 92])); break;
      case 'glow': t = toTex(radial(64, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']]), { clamp: true, srgb: false }); break;
      case 'dot': t = toTex(radial(32, [[0, 'rgba(255,255,255,1)'], [0.5, 'rgba(255,255,255,0.8)'], [1, 'rgba(255,255,255,0)']]), { clamp: true, srgb: false }); break;
      case 'smoke': t = toTex(smoke(128), { clamp: true, srgb: false }); break;
      case 'flash': t = toTex(flashStar(128), { clamp: true, srgb: false }); break;
      case 'hole': t = toTex(holeTex(64), { clamp: true }); break;
      case 'blood': t = toTex(bloodTex(128), { clamp: true }); break;
      case 'fire': t = toTex(fireTex(64), { clamp: true, srgb: false }); break;
      default: t = null;
    }
    texCache[name] = t;
    return t;
  };
  function radial(S, stops) {
    const c = mkCanvas(S), g = c.getContext('2d');
    const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    for (const [o, col] of stops) gr.addColorStop(o, col);
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
    return c;
  }
  function smoke(S) {
    const c = mkCanvas(S), g = c.getContext('2d'), N = DL.makeNoise(3);
    const img = g.createImageData(S, S), d = img.data;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = x / S - 0.5, dy = y / S - 0.5;
        const r = Math.sqrt(dx * dx + dy * dy) * 2;
        const n = DL.fbm(N, (x / S) * 4, (y / S) * 4, 4, 4);
        const a = DL.clamp((1 - r) * (0.4 + n * 0.9), 0, 1);
        const k = (y * S + x) * 4;
        d[k] = d[k + 1] = d[k + 2] = 255;
        d[k + 3] = a * a * 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }
  function flashStar(S) {
    const c = radial(S, [[0, 'rgba(255,250,220,1)'], [0.18, 'rgba(255,200,120,0.85)'], [0.5, 'rgba(255,140,40,0.2)'], [1, 'rgba(255,120,0,0)']]);
    const g = c.getContext('2d');
    g.globalCompositeOperation = 'lighter';
    g.translate(S / 2, S / 2);
    for (let i = 0; i < 6; i++) {
      g.rotate(Math.PI / 3 + (i % 2) * 0.2);
      const gr = g.createLinearGradient(0, 0, S / 2, 0);
      gr.addColorStop(0, 'rgba(255,230,170,0.9)');
      gr.addColorStop(1, 'rgba(255,150,50,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(0, -4);
      g.lineTo(S / 2, 0);
      g.lineTo(0, 4);
      g.fill();
    }
    return c;
  }
  function holeTex(S) {
    const c = mkCanvas(S), g = c.getContext('2d');
    const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, 'rgba(5,5,5,1)');
    gr.addColorStop(0.25, 'rgba(15,14,12,0.95)');
    gr.addColorStop(0.45, 'rgba(60,58,52,0.6)');
    gr.addColorStop(1, 'rgba(60,58,52,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
    return c;
  }
  function bloodTex(S) {
    const c = mkCanvas(S), g = c.getContext('2d'), r = DL.rng(77);
    g.fillStyle = 'rgba(70,6,4,0.9)';
    for (let i = 0; i < 14; i++) {
      g.beginPath();
      g.arc(S / 2 + (r() - 0.5) * S * 0.5, S / 2 + (r() - 0.5) * S * 0.5, 4 + r() * S * 0.16, 0, 7);
      g.fill();
    }
    for (let i = 0; i < 20; i++) {
      g.beginPath();
      g.arc(r() * S, r() * S, 1 + r() * 3, 0, 7);
      g.fill();
    }
    return c;
  }
  function fireTex(S) {
    return radial(S, [[0, 'rgba(255,240,200,1)'], [0.3, 'rgba(255,170,60,0.8)'], [0.7, 'rgba(200,60,10,0.25)'], [1, 'rgba(120,20,0,0)']]);
  }

  // ---------- 看板・ポスター ----------
  DL.FONT_JP = '"Zen Kaku Gothic New", "Hiragino Sans", "Noto Sans JP", "Yu Gothic", "Noto Sans CJK JP", sans-serif';
  DL.FONT_MINCHO = '"Shippori Mincho B1", "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif CJK JP", serif';
  DL.signTex = function (jp, en, o = {}) {
    const c = mkCanvas(512, 128), g = c.getContext('2d');
    g.fillStyle = o.bg || '#1f3a52';
    g.fillRect(0, 0, 512, 128);
    if (o.line) {
      g.fillStyle = o.line;
      g.beginPath();
      g.arc(52, 64, 34, 0, 7);
      g.fill();
      g.fillStyle = '#fff';
      g.font = 'bold 34px ' + DL.FONT_JP;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(o.mark || 'Y', 52, 66);
    }
    g.strokeStyle = 'rgba(240,236,224,0.6)';
    g.lineWidth = 3;
    g.strokeRect(5, 5, 502, 118);
    g.fillStyle = o.fg || '#ece6d6';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 60px ' + DL.FONT_JP;
    g.fillText(jp, o.line ? 280 : 256, 52);
    g.font = '24px "Share Tech Mono", monospace';
    g.fillText(en, o.line ? 280 : 256, 102);
    grime(g, 512, 33, 0.5, true);
    const t = toTex(c, { clamp: true });
    return t;
  };
  DL.posterTex = function (title, sub, seed) {
    const c = mkCanvas(256, 360), g = c.getContext('2d'), r = DL.rng(seed);
    const bgs = ['#8a2d22', '#2f4a3a', '#c9b48a', '#2d3a4f'];
    g.fillStyle = bgs[seed % bgs.length];
    g.fillRect(0, 0, 256, 360);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.beginPath();
    g.arc(128, 150, 80, 0, 7);
    g.fill();
    g.fillStyle = seed % 4 === 2 ? '#2a241c' : '#efe6d0';
    g.font = 'bold 40px ' + DL.FONT_MINCHO;
    g.textAlign = 'center';
    const lines = title.split('\n');
    lines.forEach((l, i) => g.fillText(l, 128, 270 + i * 44 - (lines.length - 1) * 22));
    g.font = '18px ' + DL.FONT_JP;
    g.fillText(sub, 128, 338);
    // 破れ・汚れ
    const img = g.getImageData(0, 0, 256, 360), d = img.data, N = DL.makeNoise(seed + 40);
    for (let y = 0; y < 360; y++) {
      for (let x = 0; x < 256; x++) {
        const k = (y * 256 + x) * 4;
        const n = DL.fbm(N, (x / 256) * 6, (y / 360) * 6, 4, 6);
        const m = 0.5 + n * 0.6;
        d[k] *= m; d[k + 1] *= m; d[k + 2] *= m * 0.9;
        if (n < 0.28 && (x < 30 || y > 320 || x > 230)) d[k + 3] = 0;
      }
    }
    g.putImageData(img, 0, 0);
    void r;
    return toTex(c, { clamp: true });
  };
  DL.clockTex = function () {
    const c = mkCanvas(256), g = c.getContext('2d');
    g.fillStyle = '#c8c0a8';
    g.beginPath();
    g.arc(128, 128, 124, 0, 7);
    g.fill();
    g.strokeStyle = '#2a2620';
    g.lineWidth = 6;
    g.stroke();
    g.fillStyle = '#2a2620';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.fillRect(128 + Math.sin(a) * 100 - 3, 128 - Math.cos(a) * 100 - 8, 6, 16);
    }
    // 03:47 で止まった針
    const hand = (a, len, w) => {
      g.save();
      g.translate(128, 128);
      g.rotate(a);
      g.fillRect(-w / 2, -len, w, len);
      g.restore();
    };
    hand(((3 + 47 / 60) / 12) * Math.PI * 2, 60, 9);
    hand((47 / 60) * Math.PI * 2, 92, 6);
    grime(g, 256, 99, 0.6, true);
    return toTex(c, { clamp: true });
  };

  // ---------- localStorage（失敗しても動く） ----------
  DL.store = {
    get(k, def) {
      try {
        const v = localStorage.getItem('deepline:' + k);
        return v ? JSON.parse(v) : def;
      } catch (e) {
        return def;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem('deepline:' + k, JSON.stringify(v));
      } catch (e) { /* 保存できなくても続行 */ }
    },
    del(k) {
      try {
        localStorage.removeItem('deepline:' + k);
      } catch (e) { /* noop */ }
    },
  };
})();
