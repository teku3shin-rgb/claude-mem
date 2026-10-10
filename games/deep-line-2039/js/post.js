'use strict';
// PC 向けの描画パイプライン
//   1. シーンを HDR（半精度浮動小数）のバッファへ、深度テクスチャつきで描く
//   2. SSAO: 深度から法線を復元し、半球内のサンプルで隅や接地面の陰りを求める（半解像度 → 深度を見ながらぼかす）
//   3. 体積光: 懐中電灯の円錐を影マップで遮りながら視線に沿って積分し、ランプのまわりの霞は解析的に足す
//   4. 合成したところへ一人称の武器を重ね、ブルーム（縮小・拡大の連鎖）を作る
//   5. トーンマップ（ACES）、色調、周辺減光、色収差、フィルムグレイン → FXAA
// 画質「低」では使わず、従来どおり直接描画する。
(function () {
  const T = THREE, DL = window.DL;

  const PRESETS = {
    low: null,
    medium: { ao: 0, vol: 1, volSteps: 18, bloom: 1, ca: 0, shadow: 1024, dpr: 1.25 },
    high: { ao: 1, aoSamples: 12, aoFull: 0, vol: 1, volSteps: 28, bloom: 1, ca: 1, shadow: 2048, dpr: 1.5 },
    ultra: { ao: 1, aoSamples: 20, aoFull: 1, vol: 1, volSteps: 44, bloom: 1, ca: 1, shadow: 2048, dpr: 2 },
  };

  const VS = `varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

  const COMMON = `
#include <packing>
varying vec2 vUv;
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

  // ---------- SSAO ----------
  const AO_FS = (n) => `${COMMON}
uniform sampler2D tDepth;
uniform mat4 proj, projInv;
uniform vec2 texel;
uniform vec3 kernel[${n}];
uniform float radius, power, near, far;
vec3 vpos(vec2 uv) {
  float d = texture2DLodEXT(tDepth, uv, 0.0).x;
  vec4 v = projInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return v.xyz / v.w;
}
void main() {
  float d0 = texture2D(tDepth, vUv).x;
  if (d0 >= 0.99999) { gl_FragColor = vec4(1.0); return; }
  vec3 p = vpos(vUv);
  vec3 pr = vpos(vUv + vec2(texel.x, 0.0)), pl = vpos(vUv - vec2(texel.x, 0.0));
  vec3 pu = vpos(vUv + vec2(0.0, texel.y)), pd = vpos(vUv - vec2(0.0, texel.y));
  vec3 dx = abs(pr.z - p.z) < abs(p.z - pl.z) ? pr - p : p - pl;
  vec3 dy = abs(pu.z - p.z) < abs(p.z - pd.z) ? pu - p : p - pd;
  vec3 nrm = normalize(cross(dx, dy));
  float a = 6.2831853 * ign(gl_FragCoord.xy);
  vec3 rv = vec3(cos(a), sin(a), 0.0);
  vec3 tg = normalize(rv - nrm * dot(rv, nrm));
  mat3 tbn = mat3(tg, cross(nrm, tg), nrm);
  float r = radius * clamp(-p.z * 0.12, 0.35, 1.0);
  float occ = 0.0;
  for (int i = 0; i < ${n}; i++) {
    vec3 s = p + tbn * kernel[i] * r;
    vec4 c = proj * vec4(s, 1.0);
    vec2 suv = c.xy / c.w * 0.5 + 0.5;
    float sz = perspectiveDepthToViewZ(texture2DLodEXT(tDepth, suv, 0.0).x, near, far);
    float range = smoothstep(0.0, 1.0, r / abs(p.z - sz));
    occ += (sz >= s.z + 0.02 - p.z * 0.0015 ? 1.0 : 0.0) * range;
  }
  float ao = pow(clamp(1.0 - occ / float(${n}), 0.0, 1.0), power);
  ao = mix(ao, 1.0, smoothstep(28.0, 55.0, -p.z));
  gl_FragColor = vec4(ao, ao, ao, 1.0);
}`;

  // 深度を見ながらぼかす（奥行きの違う画素は混ぜない）
  const BLUR_FS = `${COMMON}
uniform sampler2D tSrc, tDepth;
uniform vec2 dir;
uniform float near, far, sharp;
float lz(vec2 uv) { return -perspectiveDepthToViewZ(texture2DLodEXT(tDepth, uv, 0.0).x, near, far); }
void main() {
  float z0 = lz(vUv);
  vec4 sum = vec4(0.0);
  float ws = 0.0;
  for (int i = -4; i <= 4; i++) {
    vec2 uv = vUv + dir * float(i);
    float w = exp(-float(i * i) / 9.0) * exp(-abs(lz(uv) - z0) * sharp / (z0 * 0.04 + 0.04));
    sum += texture2D(tSrc, uv) * w;
    ws += w;
  }
  gl_FragColor = sum / max(ws, 1e-4);
}`;

  // ---------- 体積光 ----------
  const VOL_FS = (steps) => `${COMMON}
uniform sampler2D tDepth, tShadow;
uniform mat4 projInv, camWorld, shadowMat;
uniform vec3 camPos;
uniform vec3 fPos, fDir, fCol;
uniform float fCone, fPen, fDist, fShadow, shadowBias, fStr;
uniform vec3 pPos[8], pCol[8];
uniform float pRad[8];
uniform int pN;
uniform float density, time, pStr, maxDist;
float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// 漂う埃の濃さ（ゆっくり流れる 2 層のノイズ）
float dust(vec3 p) {
  float a = vnoise(p * 0.45 + vec3(0.0, -time * 0.05, time * 0.03));
  float b = vnoise(p * 1.6 + vec3(time * 0.04, time * 0.02, 0.0));
  return 0.25 + 1.5 * a * (0.55 + 0.45 * b);
}
void main() {
  float d = texture2D(tDepth, vUv).x;
  vec4 v = projInv * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec3 wp = (camWorld * vec4(v.xyz / v.w, 1.0)).xyz;
  vec3 rd = wp - camPos;
  float L = length(rd);
  rd /= L;
  L = min(L, maxDist);
  float j = ign(gl_FragCoord.xy);
  vec3 acc = vec3(0.0);
  // 懐中電灯
  if (fStr > 0.0) {
    float t0 = 0.8, t1 = min(L, fDist);
    float st = max(t1 - t0, 0.0) / float(${steps});
    for (int i = 0; i < ${steps}; i++) {
      float t = t0 + st * (float(i) + j);
      vec3 x = camPos + rd * t;
      vec3 tl = x - fPos;
      float dl = length(tl);
      float sp = smoothstep(fCone, fPen, dot(tl / dl, fDir));
      if (sp <= 0.0) continue;
      float att = pow(clamp(1.0 - dl / fDist, 0.0, 1.0), 2.0) / (1.0 + dl * dl * 0.06);
      float lit = 1.0;
      if (fShadow > 0.5) {
        vec4 sc = shadowMat * vec4(x, 1.0);
        sc.xyz /= sc.w;
        if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0)
          lit = step(sc.z + shadowBias, unpackRGBAToDepth(texture2DLodEXT(tShadow, sc.xy, 0.0)));
      }
      acc += fCol * (sp * att * lit * dust(x) * exp(-density * t) * st);
    }
    acc *= density * fStr;
  }
  // ランプのまわりの霞（逆二乗の散乱を視線に沿って解析的に積分）
  vec3 pa = vec3(0.0);
  for (int k = 0; k < 8; k++) {
    if (k >= pN) break;
    vec3 oc = pPos[k] - camPos;
    float b = dot(oc, rd);
    float h2 = max(dot(oc, oc) - b * b, 0.0);
    float R = pRad[k];
    if (h2 > R * R) continue;
    float hw = sqrt(R * R - h2);
    float ta = max(0.0, b - hw), tb = min(L, b + hw);
    if (tb <= ta) continue;
    float H = sqrt(h2 + 0.03);
    float I = (atan((tb - b) / H) - atan((ta - b) / H)) / H;
    float w = 1.0 - sqrt(h2) / R;
    pa += pCol[k] * (I * w * w * w * exp(-density * b));
  }
  acc += pa * density * pStr;
  gl_FragColor = vec4(acc, 1.0);
}`;

  const COMBINE_FS = `${COMMON}
uniform sampler2D tScene, tAO, tVol;
uniform float aoOn, volOn, aoStr;
void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  if (aoOn > 0.5) c *= mix(1.0, texture2D(tAO, vUv).r, aoStr);
  if (volOn > 0.5) c += texture2D(tVol, vUv).rgb;
  gl_FragColor = vec4(c, 1.0);
}`;

  // ---------- ブルーム ----------
  const DOWN_FS = `${COMMON}
uniform sampler2D tSrc;
uniform vec2 texel;
uniform float first, threshold, knee;
vec3 s(float x, float y) { return texture2D(tSrc, vUv + texel * vec2(x, y)).rgb; }
float kw(vec3 c) { return 1.0 / (1.0 + max(c.r, max(c.g, c.b))); }
void main() {
  vec3 a = s(-2.0, 2.0), b = s(0.0, 2.0), c = s(2.0, 2.0), d = s(-2.0, 0.0), e = s(0.0, 0.0), f = s(2.0, 0.0);
  vec3 g = s(-2.0, -2.0), h = s(0.0, -2.0), i = s(2.0, -2.0), j = s(-1.0, 1.0), k = s(1.0, 1.0), l = s(-1.0, -1.0), m = s(1.0, -1.0);
  vec3 col;
  if (first > 0.5) {
    // 最初の縮小は Karis 平均でちらつく明点を抑える
    vec3 g0 = (a + b + d + e) * 0.25, g1 = (b + c + e + f) * 0.25, g2 = (d + e + g + h) * 0.25, g3 = (e + f + h + i) * 0.25, g4 = (j + k + l + m) * 0.25;
    float w0 = kw(g0) * 0.125, w1 = kw(g1) * 0.125, w2 = kw(g2) * 0.125, w3 = kw(g3) * 0.125, w4 = kw(g4) * 0.5;
    col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
    float br = max(col.r, max(col.g, col.b));
    float rq = clamp(br - threshold + knee, 0.0, 2.0 * knee);
    rq = rq * rq / (4.0 * knee + 1e-4);
    col *= max(rq, br - threshold) / max(br, 1e-4);
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  gl_FragColor = vec4(col, 1.0);
}`;
  const UP_FS = `${COMMON}
uniform sampler2D tSrc;
uniform vec2 texel;
uniform float weight;
void main() {
  vec2 o = texel;
  vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
  c += (texture2D(tSrc, vUv + vec2(-o.x, 0.0)).rgb + texture2D(tSrc, vUv + vec2(o.x, 0.0)).rgb + texture2D(tSrc, vUv + vec2(0.0, -o.y)).rgb + texture2D(tSrc, vUv + vec2(0.0, o.y)).rgb) * 2.0;
  c += texture2D(tSrc, vUv + vec2(-o.x, -o.y)).rgb + texture2D(tSrc, vUv + vec2(o.x, -o.y)).rgb + texture2D(tSrc, vUv + vec2(-o.x, o.y)).rgb + texture2D(tSrc, vUv + vec2(o.x, o.y)).rgb;
  gl_FragColor = vec4(c / 16.0 * weight, 1.0);
}`;

  // ---------- 仕上げ ----------
  const FINAL_FS = `${COMMON}
uniform sampler2D tHDR, tBloom, tDirt;
uniform float exposure, bloomStr, dirtStr, sat, vign, grain, time, ca, dbg;
uniform sampler2D tDbg;
uniform vec3 shadowTint, highTint;
uniform vec2 res;
vec3 RRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 aces(vec3 color) {
  const mat3 ACESInputMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 ACESOutputMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color = ACESInputMat * (color / 0.6);
  color = RRTAndODTFit(color);
  return clamp(ACESOutputMat * color, 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
void main() {
  vec2 dc = vUv - 0.5;
  vec3 c;
  if (ca > 0.0) {
    vec2 off = dc * dot(dc, dc) * ca;
    c = vec3(texture2D(tHDR, vUv - off).r, texture2D(tHDR, vUv).g, texture2D(tHDR, vUv + off).b);
  } else c = texture2D(tHDR, vUv).rgb;
  vec3 b = texture2D(tBloom, vUv).rgb;
  c += b * (bloomStr + texture2D(tDirt, vUv).r * dirtStr);
  c = aces(c * exposure);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, sat);
  c *= mix(shadowTint, highTint, smoothstep(0.0, 0.45, l));
  vec2 vv = dc * vec2(res.x / res.y, 1.0);
  c *= mix(1.0, smoothstep(1.15, 0.2, length(vv)), vign);
  c = toSRGB(c);
  float n = ign(gl_FragCoord.xy + vec2(fract(time * 7.13) * 431.0, fract(time * 3.71) * 173.0)) - 0.5;
  c += n * grain * (1.0 - 0.6 * l);
  if (dbg > 0.5) c = toSRGB(texture2D(tDbg, vUv).rgb * (dbg > 1.5 ? 4.0 : 1.0));
  gl_FragColor = vec4(c, 1.0);
}`;

  function mkDirt() {
    // レンズの汚れ（明るい光のまわりにだけ浮かぶ）
    const S = 256, c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d');
    x.fillStyle = '#000';
    x.fillRect(0, 0, S, S);
    const r = DL.SFX ? DL.SFX.rng(91) : Math.random;
    for (let i = 0; i < 70; i++) {
      const px = r() * S, py = r() * S, rad = 2 + r() * (i < 12 ? 40 : 10);
      const g = x.createRadialGradient(px, py, 0, px, py, rad);
      const a = (i < 12 ? 0.18 : 0.35) * (0.4 + r() * 0.6);
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(0.7, `rgba(255,255,255,${a * 0.5})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      x.beginPath();
      x.arc(px, py, rad, 0, 6.29);
      x.fill();
    }
    const t = new T.CanvasTexture(c);
    t.minFilter = T.LinearFilter;
    return t;
  }

  class Post {
    constructor(G) {
      this.G = G;
      this.R = G.renderer;
      this.on = false;
      this.p = null;
      this.name = 'low';
      const R = this.R;
      this.supported = !!(R.capabilities.isWebGL2 && (R.extensions.has('EXT_color_buffer_float') || R.extensions.has('EXT_color_buffer_half_float')));
      this.fsScene = new T.Scene();
      this.fsCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      this.quad = new T.Mesh(new T.PlaneGeometry(2, 2));
      this.quad.frustumCulled = false;
      this.fsScene.add(this.quad);
      this.w = 0;
      this.h = 0;
      this.env = { sat: 0.9, shadowTint: new T.Color(0.96, 1.0, 1.0), highTint: new T.Color(1.04, 1.0, 0.94), vol: 1 };
      this.tmpV = new T.Vector3();
      this.tmpV2 = new T.Vector2();
      this.lampVis = new Map();
    }
    mat(fs, uniforms, extra) {
      return new T.ShaderMaterial(Object.assign({ uniforms, vertexShader: VS, fragmentShader: fs, depthTest: false, depthWrite: false, toneMapped: false }, extra || {}));
    }
    rt(w, h, o) {
      return new T.WebGLRenderTarget(Math.max(1, w | 0), Math.max(1, h | 0), Object.assign({
        minFilter: T.LinearFilter, magFilter: T.LinearFilter, format: T.RGBAFormat, type: T.HalfFloatType, depthBuffer: false, stencilBuffer: false,
      }, o || {}));
    }
    // 画質の切り替え。low（または非対応の環境）では null を返して従来の描画に戻る
    setPreset(name) {
      const p = this.supported ? PRESETS[name] || null : null;
      this.name = p ? name : 'low';
      this.p = p;
      this.dispose();
      this.on = !!p;
      if (p) this.build();
      return this.on;
    }
    build() {
      const p = this.p;
      // SSAO のサンプル（中心寄りに多く）
      const r = DL.SFX ? DL.SFX.rng(17) : Math.random;
      const kernel = [];
      for (let i = 0; i < (p.aoSamples || 8); i++) {
        const v = new T.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 0.85 + 0.15).normalize().multiplyScalar(r());
        const s = i / (p.aoSamples || 8);
        v.multiplyScalar(0.1 + 0.9 * s * s);
        kernel.push(v);
      }
      this.mAO = this.mat(AO_FS(kernel.length), {
        tDepth: { value: null }, proj: { value: new T.Matrix4() }, projInv: { value: new T.Matrix4() }, texel: { value: new T.Vector2() },
        kernel: { value: kernel }, radius: { value: 0.9 }, power: { value: 3.0 }, near: { value: 0.05 }, far: { value: 300 },
      });
      const blurU = () => ({ tSrc: { value: null }, tDepth: { value: null }, dir: { value: new T.Vector2() }, near: { value: 0.05 }, far: { value: 300 }, sharp: { value: 1 } });
      this.mBlur = this.mat(BLUR_FS, blurU());
      const pv = [], pc = [];
      for (let i = 0; i < 8; i++) {
        pv.push(new T.Vector3());
        pc.push(new T.Vector3());
      }
      this.mVol = this.mat(VOL_FS(p.volSteps || 20), {
        tDepth: { value: null }, tShadow: { value: null }, projInv: { value: new T.Matrix4() }, camWorld: { value: new T.Matrix4() }, shadowMat: { value: new T.Matrix4() },
        camPos: { value: new T.Vector3() }, fPos: { value: new T.Vector3() }, fDir: { value: new T.Vector3() }, fCol: { value: new T.Vector3() },
        fCone: { value: 0.9 }, fPen: { value: 0.95 }, fDist: { value: 28 }, fShadow: { value: 0 }, shadowBias: { value: -0.0004 }, fStr: { value: 0 },
        pPos: { value: pv }, pCol: { value: pc }, pRad: { value: new Array(8).fill(1) }, pN: { value: 0 },
        density: { value: 0.05 }, time: { value: 0 }, pStr: { value: 1 }, maxDist: { value: 40 },
      });
      this.mCombine = this.mat(COMBINE_FS, { tScene: { value: null }, tAO: { value: null }, tVol: { value: null }, aoOn: { value: 0 }, volOn: { value: 0 }, aoStr: { value: 0.85 } });
      this.mDown = this.mat(DOWN_FS, { tSrc: { value: null }, texel: { value: new T.Vector2() }, first: { value: 0 }, threshold: { value: 1.0 }, knee: { value: 0.6 } });
      this.mUp = this.mat(UP_FS, { tSrc: { value: null }, texel: { value: new T.Vector2() }, weight: { value: 1 } },
        { blending: T.CustomBlending, blendSrc: T.OneFactor, blendDst: T.OneFactor, blendEquation: T.AddEquation });
      this.dirt = this.dirt || mkDirt();
      this.mFinal = this.mat(FINAL_FS, {
        tHDR: { value: null }, tBloom: { value: null }, tDirt: { value: this.dirt }, exposure: { value: 1.15 }, bloomStr: { value: 0.22 }, dirtStr: { value: 0.9 },
        sat: { value: 0.9 }, vign: { value: 0.55 }, grain: { value: 0.035 }, time: { value: 0 }, ca: { value: p.ca ? 0.012 : 0 }, dbg: { value: 0 }, tDbg: { value: null },
        shadowTint: { value: new T.Color() }, highTint: { value: new T.Color() }, res: { value: new T.Vector2() },
      });
      const F = THREE.FXAAShader;
      this.mFXAA = F ? new T.ShaderMaterial({ uniforms: T.UniformsUtils.clone(F.uniforms), vertexShader: VS, fragmentShader: F.fragmentShader, depthTest: false, depthWrite: false, toneMapped: false }) : null;
      this.w = this.h = 0;
    }
    dispose() {
      this.disposeTargets();
      for (const k of ['mAO', 'mBlur', 'mVol', 'mCombine', 'mDown', 'mUp', 'mFinal', 'mFXAA']) {
        if (this[k]) this[k].dispose();
        this[k] = null;
      }
      this.w = this.h = 0;
    }
    ensureSize() {
      const v = this.R.getDrawingBufferSize(this.tmpV2);
      const w = v.x, h = v.y;
      if (w === this.w && h === this.h) return;
      this.disposeTargets();
      this.w = w;
      this.h = h;
      const dt = new T.DepthTexture(w, h, T.UnsignedIntType);
      dt.format = T.DepthFormat;
      this.rtScene = this.rt(w, h, { depthBuffer: true, depthTexture: dt });
      this.rtHDR = this.rt(w, h, { depthBuffer: true });
      const aw = this.p.aoFull ? w : w >> 1, ah = this.p.aoFull ? h : h >> 1;
      this.rtAO = this.rt(aw, ah, { type: T.UnsignedByteType });
      this.rtAO2 = this.rt(aw, ah, { type: T.UnsignedByteType });
      this.rtVol = this.rt(w >> 1, h >> 1);
      this.rtVol2 = this.rt(w >> 1, h >> 1);
      this.rtLDR = this.rt(w, h, { type: T.UnsignedByteType });
      this.mips = [];
      let mw = w >> 1, mh = h >> 1;
      for (let i = 0; i < 6 && mw >= 4 && mh >= 4; i++) {
        this.mips.push(this.rt(mw, mh));
        mw >>= 1;
        mh >>= 1;
      }
    }
    disposeTargets() {
      for (const k of ['rtScene', 'rtHDR', 'rtAO', 'rtAO2', 'rtVol', 'rtVol2', 'rtLDR']) {
        if (this[k]) {
          if (this[k].depthTexture) this[k].depthTexture.dispose();
          this[k].dispose();
          this[k] = null;
        }
      }
      if (this.mips) this.mips.forEach((m) => m.dispose());
      this.mips = null;
    }
    // 環境ごとの見た目（彩度・色かぶり・体積光の強さ）。露出は renderer.toneMappingExposure を使う
    setEnv(env) {
      const E = this.env;
      const outdoor = !!env.outdoor;
      E.sat = env.sat !== undefined ? env.sat : outdoor ? 0.78 : 0.9;
      // 暗部は青緑へ、明部は暖色へ（坑内の電球とコンクリートの冷たさ）
      if (outdoor) {
        E.shadowTint.setRGB(0.95, 1.0, 1.04);
        E.highTint.setRGB(1.0, 1.0, 0.98);
      } else if (env.gasFog) {
        E.shadowTint.setRGB(0.95, 1.03, 0.95);
        E.highTint.setRGB(1.04, 1.0, 0.92);
      } else {
        E.shadowTint.setRGB(0.94, 1.0, 1.02);
        E.highTint.setRGB(1.05, 1.0, 0.93);
      }
      E.vol = outdoor ? 0.35 : 1;
    }
    draw(mat, target) {
      this.quad.material = mat;
      this.R.setRenderTarget(target);
      this.R.render(this.fsScene, this.fsCam);
    }
    blur(src, tmp, dst, sharp) {
      const m = this.mBlur, u = m.uniforms;
      u.tDepth.value = this.rtScene.depthTexture;
      u.sharp.value = sharp;
      u.tSrc.value = src.texture;
      u.dir.value.set(1 / src.width, 0);
      this.draw(m, tmp);
      u.tSrc.value = tmp.texture;
      u.dir.value.set(0, 1 / src.height);
      this.draw(m, dst);
    }
    updateLampVisibility(G) {
      // 壁の向こうのランプは霞を弱める（体積光が壁を抜けて見えないように）
      const cam = G.camera.position, W = G.world;
      const vis = this.lampVis;
      for (const l of G.lightPool.lights) {
        if (l.intensity <= 0) continue;
        const dx = l.position.x - cam.x, dy = l.position.y - cam.y, dz = l.position.z - cam.z;
        const d = Math.hypot(dx, dy, dz);
        let target = 1;
        if (W && W.raycast && d > 0.5) {
          const r = W.raycast(cam.x, cam.y, cam.z, dx / d, dy / d, dz / d, d);
          if (r && r.hit && r.t < d - 0.6) target = 0.15;
        }
        const k = l.uuid;
        const cur = vis.has(k) ? vis.get(k) : target;
        vis.set(k, cur + (target - cur) * Math.min(1, G.dt * 6));
      }
    }
    render(G, showVm) {
      const R = this.R, p = this.p;
      this.ensureSize();
      const cam = G.camera, t = G.time;
      // 1. シーン
      R.setRenderTarget(this.rtScene);
      R.clear();
      R.render(G.scene, cam);
      const depth = this.rtScene.depthTexture;
      const near = cam.near, far = cam.far;
      // 2. SSAO
      if (p.ao) {
        const u = this.mAO.uniforms;
        u.tDepth.value = depth;
        u.proj.value.copy(cam.projectionMatrix);
        u.projInv.value.copy(cam.projectionMatrixInverse);
        u.texel.value.set(1 / this.w, 1 / this.h);
        u.near.value = near;
        u.far.value = far;
        this.draw(this.mAO, this.rtAO);
        this.mBlur.uniforms.near.value = near;
        this.mBlur.uniforms.far.value = far;
        this.blur(this.rtAO, this.rtAO2, this.rtAO, 1);
      }
      // 3. 体積光
      const fl = G.flashlight;
      const fog = G.scene.fog;
      let volOn = false;
      if (p.vol && fog) {
        const u = this.mVol.uniforms;
        u.tDepth.value = depth;
        u.projInv.value.copy(cam.projectionMatrixInverse);
        u.camWorld.value.copy(cam.matrixWorld);
        u.camPos.value.setFromMatrixPosition(cam.matrixWorld);
        u.density.value = Math.min(0.08, fog.density || 0.04);
        u.time.value = t;
        const fi = fl.intensity * this.env.vol;
        u.fStr.value = fi > 0.001 ? 1 : 0;
        if (fi > 0.001) {
          u.fPos.value.setFromMatrixPosition(fl.matrixWorld);
          this.tmpV.setFromMatrixPosition(fl.target.matrixWorld);
          u.fDir.value.copy(this.tmpV).sub(u.fPos.value).normalize();
          u.fCol.value.set(fl.color.r, fl.color.g, fl.color.b).multiplyScalar(fi * 0.35);
          u.fCone.value = Math.cos(fl.angle);
          u.fPen.value = Math.cos(fl.angle * (1 - fl.penumbra));
          u.fDist.value = fl.distance;
          const sm = fl.castShadow && fl.shadow.map;
          u.fShadow.value = sm ? 1 : 0;
          if (sm) {
            u.tShadow.value = fl.shadow.map.texture;
            u.shadowMat.value.copy(fl.shadow.matrix);
            u.shadowBias.value = fl.shadow.bias;
          }
        }
        this.updateLampVisibility(G);
        let n = 0;
        for (const l of G.lightPool.lights) {
          if (l.intensity <= 0.001 || n >= 8) continue;
          const vis = this.lampVis.get(l.uuid);
          const k = l.intensity * (vis === undefined ? 1 : vis) * this.env.vol;
          if (k < 0.01) continue;
          u.pPos.value[n].copy(l.position);
          u.pCol.value[n].set(l.color.r, l.color.g, l.color.b).multiplyScalar(k);
          u.pRad.value[n] = Math.max(1, l.distance * 0.55);
          n++;
        }
        u.pN.value = n;
        u.pStr.value = 0.55;
        volOn = u.fStr.value > 0 || n > 0;
        if (volOn) {
          this.draw(this.mVol, this.rtVol);
          this.mBlur.uniforms.near.value = near;
          this.mBlur.uniforms.far.value = far;
          this.blur(this.rtVol, this.rtVol2, this.rtVol, 0.5);
        }
      }
      // 4. 合成 → 一人称モデル
      const cu = this.mCombine.uniforms;
      cu.tScene.value = this.rtScene.texture;
      cu.tAO.value = p.ao ? this.rtAO.texture : null;
      cu.aoOn.value = p.ao ? 1 : 0;
      cu.tVol.value = volOn ? this.rtVol.texture : null;
      cu.volOn.value = volOn ? 1 : 0;
      this.draw(this.mCombine, this.rtHDR);
      if (showVm) {
        R.setRenderTarget(this.rtHDR);
        R.clearDepth();
        R.render(G.vmScene, G.vmCam);
      }
      // 5. ブルーム
      const mips = this.mips;
      const du = this.mDown.uniforms;
      let src = this.rtHDR;
      for (let i = 0; i < mips.length; i++) {
        du.tSrc.value = src.texture;
        du.texel.value.set(1 / src.width, 1 / src.height);
        du.first.value = i === 0 ? 1 : 0;
        this.draw(this.mDown, mips[i]);
        src = mips[i];
      }
      const uu = this.mUp.uniforms;
      for (let i = mips.length - 1; i > 0; i--) {
        uu.tSrc.value = mips[i].texture;
        uu.texel.value.set(1 / mips[i].width, 1 / mips[i].height);
        uu.weight.value = 0.85;
        this.draw(this.mUp, mips[i - 1]);
      }
      // 6. 仕上げ → FXAA
      const fu = this.mFinal.uniforms, E = this.env;
      fu.tHDR.value = this.rtHDR.texture;
      fu.tBloom.value = mips[0].texture;
      fu.exposure.value = R.toneMappingExposure;
      fu.sat.value = E.sat;
      fu.shadowTint.value.copy(E.shadowTint);
      fu.highTint.value.copy(E.highTint);
      fu.time.value = t;
      fu.res.value.set(this.w, this.h);
      // 確認用: G.post.debug = 'ao' | 'vol' | 'bloom'
      const dbg = this.debug === 'ao' && p.ao ? this.rtAO : this.debug === 'vol' && volOn ? this.rtVol : this.debug === 'bloom' ? mips[0] : null;
      fu.dbg.value = dbg ? (this.debug === 'ao' ? 1 : 2) : 0;
      fu.tDbg.value = dbg ? dbg.texture : null;
      if (this.mFXAA) {
        this.draw(this.mFinal, this.rtLDR);
        this.mFXAA.uniforms.tDiffuse.value = this.rtLDR.texture;
        this.mFXAA.uniforms.resolution.value.set(1 / this.w, 1 / this.h);
        this.draw(this.mFXAA, null);
      } else this.draw(this.mFinal, null);
    }
  }
  Post.PRESETS = PRESETS;
  DL.Post = Post;
})();
