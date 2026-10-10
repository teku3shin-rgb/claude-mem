'use strict';
// 銃声・機械音・残響を「物理的な成り立ち」から合成する（録音素材なし）。
//
// 銃声は次の層でできている:
//   1. 衝撃波（Friedlander 波形: 一瞬で立ち上がり、負圧側へ振れて戻る 1ms 前後の圧力波）
//   2. 爆風の広帯域ノイズ（数十 ms）と、銃身・装薬ガスの低い「ドン」（数百 ms）
//   3. 作動音（ボルトの往復、薬莢の排出）
//   4. 空間の反射（トンネルの平行な壁でのフラッターエコー、長い残響）→ 環境ごとのインパルス応答で畳み込む
// サンプルは起動時に JS で計算して AudioBuffer にしておき、撃つたびに少し音程と音量を変えて鳴らす。
// DSP 部分（DL.SFX）は DOM に依存しないので、Node でも WAV に書き出して確かめられる。
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const DL = (root.DL = root.DL || {});

  // ---------------- DSP の小道具 ----------------
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // RBJ の双二次フィルター（その場で処理）
  function biquad(x, type, f, Q, sr, gainDb = 0) {
    const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr, c = Math.cos(w), s = Math.sin(w), al = s / (2 * Q);
    const A = Math.pow(10, gainDb / 40);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    else if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    else { b0 = 1 + al * A; b1 = -2 * c; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * c; a2 = 1 - al / A; } // peak
    b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      const y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = v; y2 = y1; y1 = y;
      x[i] = y;
    }
    return x;
  }
  const noiseArr = (n, r) => {
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = r() * 2 - 1;
    return a;
  };
  function addTo(dst, src, at = 0, gain = 1) {
    for (let i = 0; i < src.length && at + i < dst.length; i++) if (at + i >= 0) dst[at + i] += src[i] * gain;
  }
  function peakNorm(chs, peak = 0.95) {
    let m = 1e-9;
    for (const c of chs) for (let i = 0; i < c.length; i++) m = Math.max(m, Math.abs(c[i]));
    for (const c of chs) for (let i = 0; i < c.length; i++) c[i] *= peak / m;
    return chs;
  }
  // 減衰する正弦波の和（金属の部品が鳴る「モード」）
  function modal(sr, dur, modes, r) {
    const n = Math.floor(sr * dur), out = new Float32Array(n);
    for (const [f, decay, amp] of modes) {
      const ff = f * (1 + (r() - 0.5) * 0.04), ph = r() * 6.28, k = (2 * Math.PI * ff) / sr;
      for (let i = 0; i < n; i++) out[i] += Math.sin(k * i + ph) * Math.exp(-i / (sr * decay)) * amp;
    }
    return out;
  }
  // 打撃の「カチッ」: 接触のノイズに、部品の不規則な（倍音にならない）共鳴を重ねる
  function clickSound(sr, r, { f = 2600, dur = 0.12, decay = 0.02, noise = 0.5, ring = 1, partials } = {}) {
    const ps = partials || [1, 1.45 + r() * 0.4, 2.3 + r() * 0.6, 3.4 + r() * 0.9, 4.9 + r() * 1.3, 6.8 + r() * 2];
    const modes = ps.map((p, i) => [f * p, decay / (1 + i * 0.7), (ring * (0.6 + r() * 0.8)) / (1 + i * 0.6)]);
    const out = modal(sr, dur, modes, r);
    const nz = noiseArr(Math.floor(sr * 0.006), r);
    for (let i = 0; i < nz.length; i++) nz[i] *= Math.exp(-i / (sr * 0.0009)) * noise * 1.6;
    biquad(nz, 'bp', Math.min(f * 1.6, 9000), 0.8, sr);
    addTo(out, nz);
    return out;
  }
  const saturate = (x, drive) => {
    const k = Math.tanh(drive);
    for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * drive) / k;
    return x;
  };

  // ---------------- 銃声 ----------------
  // p: T（衝撃波の正圧の長さ s）, body/bodyF（爆風ノイズの減衰と中心周波数）, boom（低音の減衰）, boomF0→boomF1,
  //    gas（ガスの尾）, crack（超音速弾の衝撃音）, drive（飽和の強さ）, mech（作動音 [{t, f, amp}]）
  function gunshot(sr, p, seed) {
    const r = rng(seed);
    const n = Math.floor(sr * p.len);
    const L = new Float32Array(n), R = new Float32Array(n);
    // 1. 衝撃波（Friedlander）
    const T = p.T * (0.9 + r() * 0.2), b = 1.8;
    const fw = new Float32Array(Math.floor(sr * T * 8));
    for (let i = 0; i < fw.length; i++) {
      const x = i / (sr * T);
      fw[i] = (1 - x) * Math.exp(-b * x);
    }
    biquad(fw, 'hp', 60, 0.7, sr);
    // 2. 爆風ノイズ（左右で少し違うノイズにして広がりを出す）
    for (const [ch, s] of [[L, 0], [R, 1]]) {
      const rr = rng(seed * 7 + s * 131 + 3);
      const blast = noiseArr(Math.floor(sr * p.body * 6), rr);
      for (let i = 0; i < blast.length; i++) {
        const t = i / sr;
        blast[i] *= Math.min(1, t / 0.0003) * Math.exp(-t / p.body) * (1 + 0.6 * Math.exp(-t / (p.body * 0.15)));
      }
      biquad(blast, 'bp', p.bodyF * (0.92 + rr() * 0.16), 0.55, sr);
      biquad(blast, 'lp', p.bright || 7000, 0.7, sr);
      addTo(ch, blast, 0, p.bodyAmp || 1.4);
      // 3. ガスの尾（低めのノイズがゆっくり抜ける）
      const gas = noiseArr(Math.floor(sr * p.gas * 5), rr);
      for (let i = 0; i < gas.length; i++) {
        const t = i / sr;
        gas[i] *= Math.min(1, t / 0.004) * Math.exp(-t / p.gas);
      }
      biquad(gas, 'lp', p.gasF || 500, 0.7, sr);
      biquad(gas, 'lp', p.gasF || 500, 0.7, sr);
      addTo(ch, gas, Math.floor(sr * 0.002), p.gasAmp || 0.6);
      addTo(ch, fw, 0, p.crackAmp || 1.2);
    }
    // 4. 低音の「ドン」（音程が下がる正弦波）
    const boom = new Float32Array(Math.floor(sr * p.boom * 6));
    let ph = 0;
    for (let i = 0; i < boom.length; i++) {
      const t = i / sr;
      const f = p.boomF1 + (p.boomF0 - p.boomF1) * Math.exp(-t / 0.025);
      ph += (2 * Math.PI * f) / sr;
      boom[i] = Math.sin(ph) * Math.min(1, t / 0.001) * Math.exp(-t / p.boom);
    }
    addTo(L, boom, 0, p.boomAmp || 0.9);
    addTo(R, boom, 0, p.boomAmp || 0.9);
    // 5. 超音速弾の衝撃音（小銃）: 銃口の破裂よりわずかに早く届く鋭い N 波
    if (p.crack) {
      const cn = Math.floor(sr * 0.0006);
      const nw = new Float32Array(cn * 3);
      for (let i = 0; i < cn * 2; i++) nw[i] = 1 - i / cn;
      biquad(nw, 'hp', 800, 0.7, sr);
      addTo(L, nw, 0, p.crack);
      addTo(R, nw, 0, p.crack * 0.9);
    }
    // 6. 作動音
    for (const m of p.mech || []) {
      const c = clickSound(sr, r, { f: m.f, dur: 0.1, decay: m.decay || 0.012, noise: 0.8, ring: 1 });
      const at = Math.floor(sr * (m.t + r() * 0.003));
      addTo(L, c, at, m.amp);
      addTo(R, c, at, m.amp * 0.85);
    }
    // 7. 耳元の飽和（大音量の圧迫感）
    saturate(L, p.drive);
    saturate(R, p.drive);
    biquad(L, 'hp', 25, 0.7, sr);
    biquad(R, 'hp', 25, 0.7, sr);
    return peakNorm([L, R], 0.97);
  }

  const GUNS = {
    // 357 リボルバー: 重い破裂と長い低音
    revolver: { len: 1.0, T: 0.0011, body: 0.06, bodyF: 1000, bodyAmp: 1.6, gas: 0.12, gasF: 700, gasAmp: 0.7, boom: 0.055, boomF0: 170, boomF1: 62, boomAmp: 0.75, drive: 3.2, bright: 7500 },
    // 拳銃弾の短機関銃: 乾いて短く、ボルトの往復音が続く
    smg: { len: 0.5, T: 0.0006, body: 0.03, bodyF: 1500, bodyAmp: 1.4, gas: 0.05, gasF: 800, gasAmp: 0.4, boom: 0.03, boomF0: 220, boomF1: 85, boomAmp: 0.5, drive: 2.4, bright: 9000,
      mech: [{ t: 0.018, f: 2900, amp: 0.22, decay: 0.008 }, { t: 0.034, f: 1900, amp: 0.18, decay: 0.01 }] },
    // 12 番の二連: いちばん太く長い
    shotgun: { len: 1.4, T: 0.0016, body: 0.085, bodyF: 750, bodyAmp: 1.7, gas: 0.17, gasF: 550, gasAmp: 0.9, boom: 0.08, boomF0: 135, boomF1: 52, boomAmp: 0.95, drive: 3.6, bright: 6500 },
    // 敵の小銃: 鋭い衝撃音つき
    enemy: { len: 0.8, T: 0.0008, body: 0.045, bodyF: 1300, bodyAmp: 1.5, gas: 0.09, gasF: 750, gasAmp: 0.55, boom: 0.045, boomF0: 180, boomF1: 70, boomAmp: 0.6, drive: 3.0, bright: 9000, crack: 0.9,
      mech: [{ t: 0.028, f: 2300, amp: 0.15, decay: 0.01 }] },
  };

  // ---------------- 爆発 ----------------
  function explosion(sr, seed) {
    const r = rng(seed);
    const n = Math.floor(sr * 3.2);
    const L = new Float32Array(n), R = new Float32Array(n);
    const T = 0.004;
    const fw = new Float32Array(Math.floor(sr * T * 8));
    for (let i = 0; i < fw.length; i++) {
      const x = i / (sr * T);
      fw[i] = (1 - x) * Math.exp(-1.6 * x);
    }
    for (const [ch, s] of [[L, 0], [R, 1]]) {
      const rr = rng(seed * 11 + s);
      // 地響き（ブラウンノイズを低域で長く）
      const rum = noiseArr(n, rr);
      let last = 0;
      for (let i = 0; i < n; i++) {
        last = (last + 0.03 * rum[i]) / 1.03;
        const t = i / sr;
        rum[i] = last * 6 * Math.min(1, t / 0.01) * Math.exp(-t / 0.9);
      }
      biquad(rum, 'lp', 300, 0.7, sr);
      addTo(ch, rum, 0, 1.4);
      const blast = noiseArr(Math.floor(sr * 0.6), rr);
      for (let i = 0; i < blast.length; i++) blast[i] *= Math.exp(-i / (sr * 0.12));
      biquad(blast, 'lp', 3500, 0.7, sr);
      addTo(ch, blast, 0, 1.2);
      addTo(ch, fw, 0, 1.5);
      // 破片が降る音
      for (let k = 0; k < 26; k++) {
        const c = clickSound(sr, rr, { f: 1200 + rr() * 3500, dur: 0.08, decay: 0.01 + rr() * 0.02, noise: 1, ring: 0.4 });
        addTo(ch, c, Math.floor(sr * (0.25 + rr() * 1.6)), 0.06 + rr() * 0.12);
      }
    }
    const boom = new Float32Array(Math.floor(sr * 1.5));
    let ph = 0;
    for (let i = 0; i < boom.length; i++) {
      const t = i / sr;
      ph += (2 * Math.PI * (28 + 60 * Math.exp(-t / 0.08))) / sr;
      boom[i] = Math.sin(ph) * Math.exp(-t / 0.35);
    }
    addTo(L, boom, 0, 1.5);
    addTo(R, boom, 0, 1.5);
    saturate(L, 3);
    saturate(R, 3);
    return peakNorm([L, R], 0.97);
  }

  // ---------------- 着弾・跳弾・薬莢 ----------------
  function impact(sr, kind, seed) {
    const r = rng(seed);
    const n = Math.floor(sr * 0.6);
    const out = new Float32Array(n);
    if (kind === 'flesh') {
      const nz = noiseArr(Math.floor(sr * 0.12), r);
      for (let i = 0; i < nz.length; i++) nz[i] *= Math.exp(-i / (sr * 0.025));
      biquad(nz, 'lp', 700, 0.9, sr);
      addTo(out, nz, 0, 1);
      addTo(out, modal(sr, 0.15, [[90 + r() * 30, 0.03, 0.8]], r));
      const sq = noiseArr(Math.floor(sr * 0.08), r);
      for (let i = 0; i < sq.length; i++) sq[i] *= Math.exp(-i / (sr * 0.015));
      biquad(sq, 'bp', 1800, 2, sr);
      addTo(out, sq, Math.floor(sr * 0.006), 0.3);
    } else if (kind === 'metal') {
      addTo(out, clickSound(sr, r, { f: 900 + r() * 700, dur: 0.6, decay: 0.12, noise: 1, ring: 0.8, partials: [1, 2.32, 4.25, 6.63, 9.38] }));
    } else {
      // コンクリート: 乾いた破裂と砕けた粒
      const nz = noiseArr(Math.floor(sr * 0.1), r);
      for (let i = 0; i < nz.length; i++) nz[i] *= Math.exp(-i / (sr * 0.008));
      biquad(nz, 'hp', 900, 0.7, sr);
      addTo(out, nz, 0, 1.2);
      for (let k = 0; k < 7; k++) {
        const g = noiseArr(Math.floor(sr * 0.01), r);
        for (let i = 0; i < g.length; i++) g[i] *= Math.exp(-i / (sr * 0.002));
        biquad(g, 'hp', 3000, 0.7, sr);
        addTo(out, g, Math.floor(sr * (0.02 + r() * 0.2)), 0.15 + r() * 0.2);
      }
    }
    return peakNorm([out], 0.9);
  }
  function ricochet(sr, seed) {
    const r = rng(seed);
    const n = Math.floor(sr * 0.7), out = new Float32Array(n);
    const f0 = 3800 + r() * 1800, f1 = 900 + r() * 500;
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const f = f1 + (f0 - f1) * Math.exp(-t / 0.18);
      ph += (2 * Math.PI * f) / sr;
      out[i] = Math.sin(ph + Math.sin(ph * 0.031) * 2) * Math.min(1, t / 0.004) * Math.exp(-t / 0.22);
    }
    const nz = noiseArr(Math.floor(sr * 0.05), r);
    for (let i = 0; i < nz.length; i++) nz[i] *= Math.exp(-i / (sr * 0.006));
    biquad(nz, 'hp', 1500, 0.7, sr);
    addTo(out, nz, 0, 1.5);
    return peakNorm([out], 0.8);
  }
  // 耳元をかすめる弾: 衝撃波の破裂音と風切り
  function whiz(sr, seed) {
    const r = rng(seed);
    const n = Math.floor(sr * 0.35), out = new Float32Array(n);
    const cn = Math.floor(sr * 0.0004);
    for (let i = 0; i < cn * 2; i++) out[i] = 1 - i / cn;
    const nz = noiseArr(Math.floor(sr * 0.3), r);
    for (let i = 0; i < nz.length; i++) {
      const t = i / sr;
      nz[i] *= Math.exp(-Math.pow((t - 0.05) / 0.05, 2));
    }
    biquad(nz, 'bp', 2200, 3, sr);
    addTo(out, nz, 0, 0.6);
    biquad(out, 'hp', 300, 0.7, sr);
    return peakNorm([out], 0.85);
  }
  // 床に落ちて跳ねる薬莢（真鍮）/ 散弾のプラスチックの殻
  function casing(sr, kind, seed) {
    const r = rng(seed);
    const n = Math.floor(sr * 0.9), out = new Float32Array(n);
    let t = 0, amp = 1;
    const brass = kind !== 'shell';
    for (let k = 0; k < (brass ? 5 : 3); k++) {
      const c = brass
        ? clickSound(sr, r, { f: 3800 + r() * 2200, dur: 0.25, decay: 0.05, noise: 0.4, ring: 1, partials: [1, 1.52, 2.71, 4.1] })
        : clickSound(sr, r, { f: 700 + r() * 300, dur: 0.08, decay: 0.008, noise: 1.2, ring: 0.5 });
      addTo(out, c, Math.floor(sr * t), amp);
      t += (brass ? 0.09 : 0.07) * Math.pow(0.62, k) + r() * 0.01;
      amp *= 0.6;
    }
    return peakNorm([out], 0.6);
  }

  // ---------------- 装填・操作の音 ----------------
  function mech(sr, name, seed) {
    const r = rng(seed);
    const n = Math.floor(sr * 0.8), out = new Float32Array(n);
    const click = (t, o) => addTo(out, clickSound(sr, r, { ...o, decay: (o.decay || 0.01) * 0.7, noise: o.noise || 0.9 }), Math.floor(sr * t), o.amp || 1);
    const slide = (t, dur, f, amp) => {
      const nz = noiseArr(Math.floor(sr * dur), r);
      for (let i = 0; i < nz.length; i++) nz[i] *= Math.sin((Math.PI * i) / nz.length);
      biquad(nz, 'bp', f, 1.5, sr);
      addTo(out, nz, Math.floor(sr * t), amp);
    };
    switch (name) {
      case 'hammer': click(0, { f: 3100, decay: 0.01, amp: 0.7 }); click(0.06, { f: 2400, decay: 0.012, amp: 1 }); break;
      case 'dry': click(0, { f: 2700, decay: 0.008, amp: 1, noise: 0.8 }); break;
      case 'cylOpen': click(0, { f: 2200, decay: 0.012 }); slide(0.03, 0.12, 1800, 0.25); click(0.15, { f: 1500, decay: 0.03, amp: 0.8 }); break;
      case 'cylEject': for (let i = 0; i < 6; i++) addTo(out, casing(sr, 'brass', seed * 3 + i)[0], Math.floor(sr * (0.02 + r() * 0.12)), 0.35); break;
      case 'insert': click(0, { f: 3400, decay: 0.006, amp: 0.6 }); break;
      case 'cylClose': slide(0, 0.06, 2000, 0.2); click(0.06, { f: 1900, decay: 0.02, amp: 1.2 }); click(0.1, { f: 3200, decay: 0.008, amp: 0.4 }); break;
      case 'magOut': click(0, { f: 2600, decay: 0.008, amp: 0.8 }); slide(0.02, 0.15, 1300, 0.35); break;
      case 'magIn': slide(0, 0.08, 1100, 0.3); click(0.08, { f: 1400, decay: 0.025, amp: 1.3 }); click(0.1, { f: 2900, decay: 0.01, amp: 0.6 }); break;
      case 'boltBack': slide(0, 0.1, 1600, 0.35); click(0.1, { f: 2100, decay: 0.02, amp: 1 }); break;
      case 'boltFwd': slide(0, 0.05, 1800, 0.25); click(0.05, { f: 1700, decay: 0.03, amp: 1.3 }); break;
      case 'breakOpen': click(0, { f: 1500, decay: 0.03, amp: 1 }); slide(0.02, 0.18, 900, 0.3); break;
      case 'shellsOut': for (let i = 0; i < 2; i++) addTo(out, casing(sr, 'shell', seed * 5 + i)[0], Math.floor(sr * (0.25 + i * 0.05)), 0.7); slide(0, 0.06, 2400, 0.3); break;
      case 'shellIn': slide(0, 0.07, 1300, 0.3); click(0.07, { f: 900, decay: 0.012, amp: 0.8, noise: 1 }); break;
      case 'breakClose': click(0, { f: 1300, decay: 0.035, amp: 1.4 }); click(0.03, { f: 2600, decay: 0.012, amp: 0.6 }); break;
      default: click(0, { f: 2500, decay: 0.01 });
    }
    return peakNorm([out], 0.8);
  }

  // ---------------- 空間のインパルス応答 ----------------
  // 低・中・高の帯域ごとに残響時間を変えたノイズの尾に、初期反射とフラッターエコーを足す
  const SPACES = {
    tunnel: { rt: 2.4, er: [0.006, 0.009, 0.013, 0.017, 0.024, 0.031], flutter: 0.019, flutterN: 14, pre: 0.004, lowMul: 1.1, highMul: 0.5, level: 1 },
    station: { rt: 2.0, er: [0.012, 0.019, 0.027, 0.04, 0.055], flutter: 0.045, flutterN: 6, pre: 0.008, lowMul: 1.05, highMul: 0.6, level: 0.9 },
    hall: { rt: 3.0, er: [0.018, 0.029, 0.044, 0.061, 0.08], flutter: 0, flutterN: 0, pre: 0.012, lowMul: 1.1, highMul: 0.55, level: 0.95 },
    surface: { rt: 0.9, er: [0.03], echoes: [0.14, 0.29, 0.47, 0.71], flutter: 0, flutterN: 0, pre: 0.01, lowMul: 1.3, highMul: 0.35, level: 0.7 },
  };
  function impulse(sr, kind, seed) {
    const S = SPACES[kind] || SPACES.tunnel;
    const len = Math.floor(sr * Math.min(4.5, S.rt * 1.4 + (S.echoes ? 0.9 : 0)));
    const chs = [];
    for (let c = 0; c < 2; c++) {
      const r = rng(seed * 17 + c * 101);
      const out = new Float32Array(len);
      // 帯域ごとの尾
      for (const [band, mul, g] of [['low', S.lowMul, 0.55], ['mid', 1, 0.8], ['high', S.highMul, 0.45]]) {
        const nz = noiseArr(len, r);
        if (band === 'low') { biquad(nz, 'lp', 350, 0.7, sr); biquad(nz, 'lp', 350, 0.7, sr); }
        else if (band === 'mid') { biquad(nz, 'hp', 350, 0.7, sr); biquad(nz, 'lp', 2800, 0.7, sr); }
        else { biquad(nz, 'hp', 2800, 0.7, sr); }
        const rt = S.rt * mul;
        for (let i = 0; i < len; i++) {
          const t = i / sr - S.pre;
          nz[i] *= t < 0 ? 0 : Math.min(1, t / 0.03) * Math.exp((-6.9 * t) / rt);
        }
        addTo(out, nz, 0, g);
      }
      // 初期反射（左右で少しずらす）
      const tap = (t, g, lp) => {
        const k = Math.floor(sr * t);
        const w = Math.max(1, Math.floor(sr * 0.0004 * lp));
        for (let i = 0; i < w * 3; i++) if (k + i < len) out[k + i] += (g * Math.exp(-i / w) * (r() < 0.5 ? 1 : -1) * 2) / w;
      };
      S.er.forEach((t, i) => tap(t * (1 + (c ? 0.07 : -0.05) * (i % 2 ? 1 : -1)), 0.9 / (1 + i * 0.35), 1 + i));
      // 平行な壁のあいだを往復するフラッターエコー
      for (let i = 1; i <= S.flutterN; i++) tap(S.flutter * i * (1 + (c ? 0.01 : 0)), 0.55 * Math.pow(0.8, i), 1 + i * 0.6);
      // 屋外: 建物からのはね返り
      if (S.echoes) S.echoes.forEach((t, i) => tap(t * (1 + c * 0.03), 0.5 * Math.pow(0.7, i), 4 + i * 3));
      chs.push(out);
    }
    // エネルギーをそろえる
    let e = 0;
    for (const c of chs) for (let i = 0; i < c.length; i++) e += c[i] * c[i];
    const k = (S.level * 0.9) / Math.sqrt(e / 2);
    for (const c of chs) for (let i = 0; i < c.length; i++) c[i] *= k;
    return chs;
  }

  DL.SFX = { rng, biquad, gunshot, GUNS, explosion, impact, ricochet, whiz, casing, mech, impulse, SPACES };

  // ---------------- AudioEngine への組み込み ----------------
  const AE = DL.AudioEngine && DL.AudioEngine.prototype;
  if (!AE) return;
  const S = DL.SFX;
  const toBuf = (ctx, chs) => {
    const b = ctx.createBuffer(chs.length, chs[0].length, ctx.sampleRate);
    chs.forEach((c, i) => b.copyToChannel ? b.copyToChannel(c, i) : b.getChannelData(i).set(c));
    return b;
  };
  const baseInit = AE.init;
  AE.init = function () {
    const first = !this.ctx;
    baseInit.call(this);
    if (!first || !this.ctx || this.bank) return;
    const ctx = this.ctx, sr = ctx.sampleRate;
    this.bank = {};
    // 空間ごとの残響（2 つの畳み込みを切り替えて混ぜる）
    this.spaceBufs = {};
    for (const k in S.SPACES) this.spaceBufs[k] = toBuf(ctx, S.impulse(sr, k, 7));
    // this.reverb はこれ以降「残響への入り口」（GainNode）になり、既存の connect(this.reverb) はそのまま両方の畳み込みへ届く
    this.convA = this.reverb;
    this.convA.buffer = this.spaceBufs.tunnel;
    this.convB = ctx.createConvolver();
    this.convB.buffer = this.spaceBufs.station;
    this.revGainB = ctx.createGain();
    this.revGainB.gain.value = 0;
    this.convB.connect(this.revGainB);
    this.revGainB.connect(this.master);
    this.reverb = ctx.createGain();
    this.reverb.connect(this.convA);
    this.reverb.connect(this.convB);
    this.revActive = 'A';
    this.space = 'tunnel';
    // 耳鳴り・こもり用（効果音のバスの後ろに低域通過を挟む）
    this.sfx.disconnect();
    this.muffle = this.filt('lowpass', 20000, 0.7);
    this.sfx.connect(this.muffle);
    this.muffle.connect(this.master);
    // サンプルは少しずつ作る（起動を止めない）
    const jobs = [];
    for (const k in S.GUNS) for (let v = 0; v < 4; v++) jobs.push(['gun_' + k, () => S.gunshot(sr, S.GUNS[k], 100 + v * 31 + k.length)]);
    for (let v = 0; v < 2; v++) jobs.push(['explosion', () => S.explosion(sr, 50 + v)]);
    for (const k of ['wall', 'metal', 'flesh']) for (let v = 0; v < 3; v++) jobs.push(['imp_' + k, () => S.impact(sr, k, 200 + v * 13 + k.length)]);
    for (let v = 0; v < 3; v++) jobs.push(['ricochet', () => S.ricochet(sr, 300 + v)]);
    for (let v = 0; v < 2; v++) jobs.push(['whiz', () => S.whiz(sr, 400 + v)]);
    for (let v = 0; v < 3; v++) jobs.push(['brass', () => S.casing(sr, 'brass', 500 + v)]);
    for (const m of ['hammer', 'dry', 'cylOpen', 'cylEject', 'insert', 'cylClose', 'magOut', 'magIn', 'boltBack', 'boltFwd', 'breakOpen', 'shellsOut', 'shellIn', 'breakClose']) {
      jobs.push(['m_' + m, () => S.mech(sr, m, 600 + m.length)]);
    }
    const step = () => {
      const t0 = performance.now();
      while (jobs.length && performance.now() - t0 < 12) {
        const [key, fn] = jobs.shift();
        (this.bank[key] = this.bank[key] || []).push(toBuf(ctx, fn()));
      }
      if (jobs.length) setTimeout(step, 0);
    };
    step();
  };
  AE.setSpace = function (kind) {
    if (!this.spaceBufs || !this.spaceBufs[kind] || this.space === kind) return;
    this.space = kind;
    const t = this.ctx.currentTime;
    const [nextConv, nextGain, prevGain] = this.revActive === 'A' ? [this.convB, this.revGainB, this.revGain] : [this.convA, this.revGain, this.revGainB];
    nextConv.buffer = this.spaceBufs[kind];
    const lvl = this.revLevel !== undefined ? this.revLevel : 0.6;
    nextGain.gain.cancelScheduledValues(t);
    nextGain.gain.setValueAtTime(nextGain.gain.value, t);
    nextGain.gain.linearRampToValueAtTime(lvl, t + 1.2);
    prevGain.gain.cancelScheduledValues(t);
    prevGain.gain.setValueAtTime(prevGain.gain.value, t);
    prevGain.gain.linearRampToValueAtTime(0, t + 1.2);
    this.revActive = this.revActive === 'A' ? 'B' : 'A';
  };
  const baseSetReverb = AE.setReverb;
  AE.setReverb = function (v) {
    this.revLevel = v;
    if (!this.revGainB) return baseSetReverb.call(this, v);
    (this.revActive === 'A' ? this.revGain : this.revGainB).gain.value = v;
  };
  const baseAmb = AE.setAmbience;
  AE.setAmbience = function (kind) {
    baseAmb.call(this, kind);
    if (kind) this.setSpace(kind);
  };
  // 録り溜めたサンプルを鳴らす（距離による遅れ・高域の減衰・残響の割合つき）
  AE.playBank = function (key, pos, { gain = 1, ref = 8, rate = 1, jitter = 0.04, wet = 1, delay = true, dryLp } = {}) {
    const list = this.bank && this.bank[key];
    if (!list || !list.length) return null;
    const ctx = this.ctx;
    const s = this.spatial(pos, ref);
    const src = ctx.createBufferSource();
    src.buffer = list[(Math.random() * list.length) | 0];
    src.playbackRate.value = rate * (1 + (Math.random() - 0.5) * 2 * jitter);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    // 空気による高域の吸収（遠いほどこもる）
    lp.frequency.value = dryLp || Math.max(1400, 20000 * Math.exp(-s.d / 45));
    const g = ctx.createGain();
    g.gain.value = s.g * gain;
    src.connect(lp);
    lp.connect(g);
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = s.pan;
      g.connect(p);
      p.connect(this.sfx);
    } else g.connect(this.sfx);
    const w = ctx.createGain();
    w.gain.value = wet * Math.min(1, s.wet + 0.15) * gain * Math.max(0.35, Math.sqrt(s.g));
    lp.connect(w);
    w.connect(this.reverb);
    const at = ctx.currentTime + (delay && pos ? s.d / 343 : 0);
    src.start(at);
    return { src, at, d: s.d };
  };
  const baseShot = AE.shot;
  AE.shot = function (kind, pos) {
    if (!this.enabled) return;
    const k = this.bank && this.bank['gun_' + kind] ? kind : null;
    if (!k) return baseShot.call(this, kind, pos);
    const near = !pos;
    const gain = { revolver: 1.15, smg: 0.85, shotgun: 1.3, enemy: 1.0 }[kind] || 1;
    this.playBank('gun_' + kind, pos, { gain: gain * (near ? 1 : 1.4), ref: 14, jitter: kind === 'smg' ? 0.05 : 0.03, wet: near ? 0.85 : 1.1 });
    if (near) {
      // 撃った直後は周囲の音が一瞬遠のく
      const t = this.ctx.currentTime;
      this.ambBus.gain.cancelScheduledValues(t);
      this.ambBus.gain.setValueAtTime(0.25, t);
      this.ambBus.gain.linearRampToValueAtTime(0.7, t + 0.6);
      // 薬莢（短機関銃は撃つたび、散弾は装填のとき）
      if (kind === 'smg' && Math.random() < 0.7) {
        const P = { x: this.L.x + Math.cos(this.L.yaw) * 0.8, y: this.L.y - 1.5, z: this.L.z - Math.sin(this.L.yaw) * 0.8 };
        setTimeout(() => this.playBank('brass', P, { gain: 0.35, ref: 3, wet: 0.4, jitter: 0.08 }), 280 + Math.random() * 250);
      }
    }
  };
  AE.whiz = function (pos) {
    if (!this.enabled || !this.bank || !this.bank.whiz) return;
    this.playBank('whiz', pos, { gain: 0.7, ref: 3, wet: 0.3, delay: false });
  };
  const baseDry = AE.dryFire;
  AE.dryFire = function () {
    if (this.bank && this.bank.m_dry) this.playBank('m_dry', null, { gain: 0.6, wet: 0.3 });
    else baseDry.call(this);
  };
  // 装填: 武器ごとの手順の音
  const RELOAD = {
    revolver: [['m_cylOpen', 'm_cylEject'], ['m_insert', 'm_insert', 'm_insert'], ['m_cylClose', 'm_hammer']],
    smg: [['m_magOut'], ['m_magIn'], ['m_boltBack', 'm_boltFwd']],
    shotgun: [['m_breakOpen', 'm_shellsOut'], ['m_shellIn', 'm_shellIn'], ['m_breakClose']],
  };
  const baseReload = AE.reload;
  AE.reload = function (kind, phase) {
    if (!this.enabled) return;
    const seq = RELOAD[kind] && RELOAD[kind][phase];
    if (!seq || !this.bank || !this.bank[seq[0]]) return baseReload.call(this, kind, phase);
    seq.forEach((k, i) => setTimeout(() => this.playBank(k, null, { gain: 0.55, wet: 0.35 }), i * (k === 'm_insert' ? 140 : 180)));
  };
  const baseImpact = AE.impact;
  AE.impact = function (pos, kind) {
    if (!this.enabled) return;
    const key = 'imp_' + (kind === 'flesh' ? 'flesh' : kind === 'metal' ? 'metal' : 'wall');
    if (!this.bank || !this.bank[key]) return baseImpact.call(this, pos, kind);
    this.playBank(key, pos, { gain: 0.6, ref: 6, jitter: 0.1 });
    if (kind !== 'flesh' && Math.random() < 0.18) this.playBank('ricochet', pos, { gain: 0.35, ref: 8, jitter: 0.12 });
  };
  const baseExplosion = AE.explosion;
  AE.explosion = function (pos) {
    if (!this.enabled) return;
    if (!this.bank || !this.bank.explosion) return baseExplosion.call(this, pos);
    const r = this.playBank('explosion', pos, { gain: 2.2, ref: 16, wet: 1.2, jitter: 0.05 });
    // 近くの爆発: 耳鳴りと、音がこもる
    if (r && r.d < 12) this.tinnitus(1 - r.d / 12);
  };
  AE.tinnitus = function (k) {
    if (!this.enabled || !this.muffle) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const f = this.muffle.frequency;
    f.cancelScheduledValues(t);
    f.setValueAtTime(Math.max(300, 1200 - k * 900), t);
    f.exponentialRampToValueAtTime(20000, t + 2.5 + k * 2);
    const o = this.osc('sine', 5800 + Math.random() * 600, t, 4 + k * 2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06 * k + 0.01, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.5 + k * 2);
    o.connect(g);
    g.connect(this.master);
  };
})();
