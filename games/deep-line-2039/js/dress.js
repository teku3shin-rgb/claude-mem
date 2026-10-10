'use strict';
// ワールドの格子から、壁際の細部を自動で並べる（見た目だけ。当たり判定には加えない）
//   巾木と天井の見切り、壁沿いに垂れ下がるケーブルの束と支持金具、床近くの配管、壁際の瓦礫と紙くず、水たまり
// 配置は格子の座標から決まる乱数で決めるので、作り直しても同じになる。
(function () {
  const T = THREE, DL = window.DL, CS = DL.CS;

  const hash = (a, b, c = 0) => {
    let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };

  // 位置・法線・UV をためて最後に BufferGeometry にする
  class Buf {
    constructor() {
      this.p = [];
      this.n = [];
      this.u = [];
      this.i = [];
    }
    vert(x, y, z, nx, ny, nz, u, v) {
      this.p.push(x, y, z);
      this.n.push(nx, ny, nz);
      this.u.push(u, v);
      return this.p.length / 3 - 1;
    }
    quad(a, b, c, d) {
      this.i.push(a, b, c, a, c, d);
    }
    // 軸に沿った直方体（UV はワールドの寸法を s で割る）
    box(x0, y0, z0, x1, y1, z1, s) {
      const F = [
        [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], 1, 0, 0],
        [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], -1, 0, 0],
        [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], 0, 1, 0],
        [[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], 0, -1, 0],
        [[x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1], 0, 0, 1],
        [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], 0, 0, -1],
      ];
      for (const [A, B, C, D, nx, ny, nz] of F) {
        const uv = (q) => (nx ? [q[2] / s, q[1] / s] : ny ? [q[0] / s, q[2] / s] : [q[0] / s, q[1] / s]);
        const ids = [A, B, C, D].map((q) => {
          const [u, v] = uv(q);
          return this.vert(q[0], q[1], q[2], nx, ny, nz, u, v);
        });
        this.quad(ids[0], ids[1], ids[2], ids[3]);
      }
    }
    // 点列に沿った管（ケーブル・配管）
    tube(pts, r, seg) {
      const N = pts.length, base = this.p.length / 3;
      const up = new T.Vector3(0, 1, 0), t = new T.Vector3(), nrm = new T.Vector3(), bin = new T.Vector3();
      let len = 0;
      for (let k = 0; k < N; k++) {
        const a = pts[Math.max(0, k - 1)], b = pts[Math.min(N - 1, k + 1)];
        t.subVectors(b, a).normalize();
        nrm.crossVectors(t, up);
        if (nrm.lengthSq() < 1e-6) nrm.set(1, 0, 0);
        nrm.normalize();
        bin.crossVectors(nrm, t).normalize();
        if (k) len += pts[k].distanceTo(pts[k - 1]);
        for (let j = 0; j <= seg; j++) {
          const a2 = (j / seg) * Math.PI * 2, c = Math.cos(a2), s = Math.sin(a2);
          const nx = nrm.x * c + bin.x * s, ny = nrm.y * c + bin.y * s, nz = nrm.z * c + bin.z * s;
          this.vert(pts[k].x + nx * r, pts[k].y + ny * r, pts[k].z + nz * r, nx, ny, nz, len * 2, j / seg);
        }
      }
      for (let k = 0; k < N - 1; k++) {
        for (let j = 0; j < seg; j++) {
          const a = base + k * (seg + 1) + j, b = a + seg + 1;
          this.quad(a, b, b + 1, a + 1);
        }
      }
    }
    // 床に置く不規則な円盤（水たまり）
    blob(cx, y, cz, R, seed, n = 14) {
      const c = this.vert(cx, y, cz, 0, 1, 0, 0.5, 0.5);
      const ids = [];
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const rr = R * (0.65 + 0.35 * hash(seed, k) + 0.15 * Math.sin(a * 3 + seed));
        ids.push(this.vert(cx + Math.cos(a) * rr, y, cz + Math.sin(a) * rr, 0, 1, 0, 0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5));
      }
      for (let k = 0; k < n; k++) this.i.push(c, ids[(k + 1) % n], ids[k]);
    }
    geometry() {
      if (!this.i.length) return null;
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3));
      g.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3));
      g.setAttribute('uv', new T.Float32BufferAttribute(this.u, 2));
      g.setIndex(this.p.length / 3 > 65535 ? new T.Uint32BufferAttribute(this.i, 1) : new T.Uint16BufferAttribute(this.i, 1));
      g.computeBoundingSphere();
      return g;
    }
  }

  let mats = null;
  function materials() {
    if (mats) return mats;
    const W = DL.getMaterials(), M = DL.M;
    mats = {
      trim: W[M.concrete],
      trimS: DL.uvScale(M.concrete),
      plinth: W[M.marble],
      plinthS: DL.uvScale(M.marble),
      cable: new T.MeshStandardMaterial({ color: 0x17140f, roughness: 0.55, metalness: 0 }),
      cable2: new T.MeshStandardMaterial({ color: 0x2c2418, roughness: 0.7, metalness: 0 }),
      bracket: new T.MeshStandardMaterial({ color: 0x3c3a36, roughness: 0.55, metalness: 0.7 }),
      pipe: W[M.metal],
      pipeS: DL.uvScale(M.metal),
      rubble: new T.MeshStandardMaterial({ color: 0x6e6a62, roughness: 0.95, metalness: 0, flatShading: true }),
      paper: new T.MeshStandardMaterial({ color: 0x9c968a, roughness: 0.9, metalness: 0, side: T.DoubleSide }),
      // 水たまり: 環境マップなしの鏡面なので、懐中電灯やランプの光だけが濡れた照り返しとして映る
      puddle: new T.MeshStandardMaterial({ color: 0x060606, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.82, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    };
    return mats;
  }

  // 瓦礫のかけら（角ばった石を数種類）
  let rockGeo = null;
  function rocks() {
    if (rockGeo) return rockGeo;
    rockGeo = [];
    for (let v = 0; v < 3; v++) {
      const g = new T.IcosahedronGeometry(1, 0);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const k = 0.65 + hash(v, i, 3) * 0.6;
        p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.7, p.getZ(i) * k);
      }
      g.computeVertexNormals();
      g.userData.shared = true;
      rockGeo.push(g);
    }
    return rockGeo;
  }

  // ---------- 表面の細部（ワールドの素材のシェーダーに足す） ----------
  //   近くだけ効く細かい凹凸（ディテール法線）、タイル模様の繰り返しを崩す大きな色むら、
  //   床の濡れた所（粗さが下がって光を照り返す）、壁を縦に伝う水染み
  let detailTex = null;
  function detailNormal() {
    if (detailTex) return detailTex;
    const S = 256, N = DL.makeNoise(77), N2 = DL.makeNoise(78);
    const h = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const v = DL.fbm(N, (x / S) * 16, (y / S) * 16, 4, 16);
        const pit = Math.max(0, DL.fbm(N2, (x / S) * 32, (y / S) * 32, 2, 32) - 0.62) * 3;
        h[y * S + x] = v - pit;
      }
    }
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d'), img = g.createImageData(S, S), d = img.data;
    const H = (x, y) => h[((y + S) % S) * S + ((x + S) % S)];
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        let nx = (H(x - 1, y) - H(x + 1, y)) * 6, ny = (H(x, y + 1) - H(x, y - 1)) * 6, nz = 1;
        const l = Math.hypot(nx, ny, nz);
        const k = (y * S + x) * 4;
        d[k] = (nx / l * 0.5 + 0.5) * 255;
        d[k + 1] = (ny / l * 0.5 + 0.5) * 255;
        d[k + 2] = (nz / l * 0.5 + 0.5) * 255;
        d[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    detailTex = new T.CanvasTexture(c);
    detailTex.wrapS = detailTex.wrapT = T.RepeatWrapping;
    detailTex.anisotropy = 4;
    return detailTex;
  }
  const NOISE3 = `
varying vec3 vWPos;
float dlH3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float dlN3(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dlH3(i), dlH3(i + vec3(1, 0, 0)), f.x), mix(dlH3(i + vec3(0, 1, 0)), dlH3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(dlH3(i + vec3(0, 0, 1)), dlH3(i + vec3(1, 0, 1)), f.x), mix(dlH3(i + vec3(0, 1, 1)), dlH3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`;
  function enhance(m, i) {
    if (!m || m.userData.dlEnh) return;
    m.userData.dlEnh = true;
    const name = DL.MATS[i];
    const wetK = { concrete: 1, gravel: 0.6, asphalt: 1, platform: 0.8, rubble: 0.5, tile: 0.4, marble: 0.3 }[name] || 0;
    const det = m.normalMap ? detailNormal() : null;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.detailN = { value: det };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D detailN;' + NOISE3)
        .replace('#include <map_fragment>', `#include <map_fragment>
  vec3 dlWN = normalize(cross(dFdx(vWPos), dFdy(vWPos)));
  float dlFloor = smoothstep(0.6, 0.9, abs(dlWN.y));
  float dlM = dlN3(vWPos * 0.22) * 0.6 + dlN3(vWPos * 0.9 + 7.0) * 0.4;
  diffuseColor.rgb *= mix(0.72, 1.12, dlM);
  // 壁を伝う水染み（縦に伸ばしたノイズ）
  float dlS = smoothstep(0.55, 0.85, dlN3(vec3(vWPos.x * 2.3, vWPos.y * 0.18, vWPos.z * 2.3))) * (1.0 - dlFloor);
  diffuseColor.rgb *= 1.0 - dlS * 0.35;
  float dlWet = max(smoothstep(0.58, 0.74, dlN3(vWPos * vec3(0.45, 0.0, 0.45) + 3.0)) * dlFloor * ${wetK.toFixed(2)}, dlS * 0.6);
  diffuseColor.rgb *= 1.0 - dlWet * 0.25;`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = clamp(roughnessFactor * mix(1.0, 0.18, dlWet), 0.05, 1.0);`);
      if (det) {
        sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  {
    float dlFade = 1.0 - smoothstep(3.0, 11.0, length(vViewPosition));
    if (dlFade > 0.0) {
      vec3 dN = texture2D(detailN, vUv * 2.0).xyz * 2.0 - 1.0;
      dN.xy *= 0.35 * dlFade * (1.0 - dlWet * 0.8);
      normal = perturbNormal2Arb(-vViewPosition, normal, dN, faceDirection);
    }
  }`);
      }
    };
    m.customProgramCacheKey = () => 'dlenh' + name + (det ? 'd' : '');
    m.needsUpdate = true;
  }
  const baseGetMaterials = DL.getMaterials;
  DL.getMaterials = function () {
    const ms = baseGetMaterials();
    if (!ms.dlEnh) {
      ms.dlEnh = true;
      ms.forEach(enhance);
    }
    return ms;
  };

  const TRIM_WALLS = new Set(['concrete', 'brick', 'tile', 'tileg', 'tileo', 'marble', 'facade']);
  const TILE_WALLS = new Set(['tile', 'tileg', 'tileo', 'marble']);
  const WET_FLOORS = new Set(['concrete', 'gravel', 'asphalt', 'platform', 'rubble']);

  // World.build() の最後に呼ばれる
  DL.dressWorld = function (W) {
    if (W.dress) {
      W.group.remove(W.dress);
      W.dress.traverse((o) => {
        if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
      });
    }
    const root = new T.Group();
    root.name = 'dress';
    W.dress = root;
    W.group.add(root);
    const Mt = materials(), MN = DL.MATS, w = W.w;
    const CH = 16;
    const rock = rocks();
    const tmpM = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), sc = new T.Vector3(), pos = new T.Vector3();
    const rockList = [[], [], []], paperList = [];
    // 壁の 1 本の直線（同じ向き・同じ座標・同じ床の高さ）ごとにケーブルや配管を付けるか決める
    const runPick = (nx, nz, line, f, salt) => hash(nx * 3 + nz * 7 + 11, Math.round(line * 10), Math.round(f * 10) + salt);
    for (let cz0 = 0; cz0 < W.h; cz0 += CH) {
      for (let cx0 = 0; cx0 < W.w; cx0 += CH) {
        const B = { trim: new Buf(), plinth: new Buf(), cable: new Buf(), cable2: new Buf(), bracket: new Buf(), pipe: new Buf(), puddle: new Buf() };
        for (let z = cz0; z < Math.min(cz0 + CH, W.h); z++) {
          for (let x = cx0; x < Math.min(cx0 + CH, W.w); x++) {
            const i = z * w + x;
            if (W.solid[i]) continue;
            const f = W.floor[i], c = W.ceil[i], sky = W.sky[i];
            const X0 = x * CS, Z0 = z * CS;
            const wallMat = MN[W.wm[i]];
            // 水たまり（屋内の濡れやすい床）
            const fmat = MN[W.fm[i]];
            if (WET_FLOORS.has(fmat) && hash(x, z, 5) < (sky ? 0.05 : 0.09)) {
              const R = 0.35 + hash(x, z, 6) * 0.7;
              B.puddle.blob(X0 + 0.5 + hash(x, z, 7) * (CS - 1), f + 0.006, Z0 + 0.5 + hash(x, z, 8) * (CS - 1), R, x * 31 + z);
            }
            // 床の紙くず
            if (!sky && hash(x, z, 9) < 0.12) {
              const n = 1 + Math.floor(hash(x, z, 10) * 3);
              for (let k = 0; k < n; k++) paperList.push([X0 + hash(x, z, 20 + k) * CS, f + 0.004 + k * 0.001, Z0 + hash(x, z, 30 + k) * CS, hash(x, z, 40 + k) * 6.28, 0.12 + hash(x, z, 50 + k) * 0.14]);
            }
            const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            for (const [dx, dz] of dirs) {
              const ax = x + dx, az = z + dz;
              const inb = W.inb(ax, az);
              const j = inb ? az * w + ax : -1;
              if (inb && !W.solid[j]) continue;
              const m = inb && W.wmSet[j] ? MN[W.wm[j]] : wallMat;
              // 壁の面（部屋側の法線は -dx, -dz）
              const nx = -dx, nz = -dz;
              const wx = dx < 0 ? X0 : dx > 0 ? X0 + CS : null;
              const wz = dz < 0 ? Z0 : dz > 0 ? Z0 + CS : null;
              const alongZ = wx !== null;
              const line = alongZ ? wx : wz;
              const a0 = alongZ ? Z0 : X0, a1 = a0 + CS;
              // 壁から部屋側へ d、壁に沿って a の位置
              const at = (a, d, y) => (alongZ ? new T.Vector3(line + nx * d, y, a) : new T.Vector3(a, y, line + nz * d));
              const slab = (buf, d0, d1, y0, y1, s) => {
                if (alongZ) buf.box(Math.min(line + nx * d0, line + nx * d1), y0, a0, Math.max(line + nx * d0, line + nx * d1), y1, a1, s);
                else buf.box(a0, y0, Math.min(line + nz * d0, line + nz * d1), a1, y1, Math.max(line + nz * d0, line + nz * d1), s);
              };
              const wallH = sky ? 0 : c - f;
              // 巾木（段のある 2 枚）と天井の見切り
              if (TRIM_WALLS.has(m) && (!sky || m === 'facade')) {
                const tile = TILE_WALLS.has(m);
                const bf = tile ? B.plinth : B.trim, s = tile ? Mt.plinthS : Mt.trimS;
                slab(bf, -0.01, 0.07, f, f + 0.17, s);
                slab(bf, -0.01, 0.04, f + 0.17, f + 0.21, s);
                if (!sky && wallH > 2.2) {
                  slab(B.trim, -0.01, 0.1, c - 0.12, c + 0.01, Mt.trimS);
                  slab(B.trim, -0.01, 0.05, c - 0.2, c - 0.12, Mt.trimS);
                }
              }
              if (sky || !TRIM_WALLS.has(m) || TILE_WALLS.has(m)) {
                // 壁際の瓦礫だけ
              } else if (wallH > 2.6) {
                // ケーブルの束（壁の直線ごとに半分ほど）
                if (runPick(nx, nz, line, f, 1) < 0.55) {
                  const n = 2 + Math.floor(runPick(nx, nz, line, f, 2) * 3);
                  const h0 = f + Math.min(2.35, wallH - 0.55) + runPick(nx, nz, line, f, 3) * 0.25;
                  for (let k = 0; k < n; k++) {
                    const pts = [];
                    const sag = 0.05 + hash(Math.round(a0 * 10), k, Math.round(line * 10)) * 0.13;
                    const d = 0.07 + k * 0.045, y = h0 - k * 0.035;
                    for (let s = 0; s <= 6; s++) {
                      const u = s / 6;
                      pts.push(at(a0 + u * CS, d, y - sag * 4 * u * (1 - u)));
                    }
                    (k % 3 === 2 ? B.cable2 : B.cable).tube(pts, 0.014 + (k === 0 ? 0.008 : 0), 5);
                  }
                  // 支持金具（格子点ごとに）
                  const by = h0 + 0.04;
                  if (alongZ) B.bracket.box(Math.min(line, line + nx * (0.1 + n * 0.045)), by - 0.02, a0 - 0.02, Math.max(line, line + nx * (0.1 + n * 0.045)), by, a0 + 0.02, 1);
                  else B.bracket.box(a0 - 0.02, by - 0.02, Math.min(line, line + nz * (0.1 + n * 0.045)), a0 + 0.02, by, Math.max(line, line + nz * (0.1 + n * 0.045)), 1);
                }
                // 床近くの配管（ケーブルの無い壁の 1/3 ほど）
                else if (runPick(nx, nz, line, f, 4) < 0.5) {
                  const r = 0.06 + runPick(nx, nz, line, f, 5) * 0.05;
                  const y = f + 0.42 + runPick(nx, nz, line, f, 6) * 0.3;
                  B.pipe.tube([at(a0, r + 0.06, y), at(a1, r + 0.06, y)], r, 8);
                  // 継ぎ手のフランジと支え
                  const fl = at(a0, r + 0.06, y);
                  if (alongZ) B.pipe.box(fl.x - r * 1.35, y - r * 1.35, a0 - 0.03, fl.x + r * 1.35, y + r * 1.35, a0 + 0.03, Mt.pipeS);
                  else B.pipe.box(a0 - 0.03, y - r * 1.35, fl.z - r * 1.35, a0 + 0.03, y + r * 1.35, fl.z + r * 1.35, Mt.pipeS);
                  const st = at(a0 + CS / 2, r + 0.06, f);
                  if (alongZ) B.bracket.box(Math.min(line, st.x) - 0.02, f, a0 + CS / 2 - 0.025, Math.max(line, st.x) + 0.02, y - r, a0 + CS / 2 + 0.025, 1);
                  else B.bracket.box(a0 + CS / 2 - 0.025, f, Math.min(line, st.z) - 0.02, a0 + CS / 2 + 0.025, y - r, Math.max(line, st.z) + 0.02, 1);
                }
              }
              // 壁際の瓦礫
              const nr = Math.floor(hash(x * 4 + dx + 7, z * 4 + dz + 7, 12) * (m === 'rubble' ? 7 : sky ? 2 : 4));
              for (let k = 0; k < nr; k++) {
                const h1 = hash(x * 4 + dx, z * 4 + dz, 100 + k), h2 = hash(x * 4 + dx, z * 4 + dz, 200 + k), h3 = hash(x * 4 + dx, z * 4 + dz, 300 + k);
                const s = 0.035 + h3 * h3 * 0.16;
                const p = at(a0 + h1 * CS, 0.08 + h2 * h2 * 0.45, f + s * 0.25);
                rockList[k % 3].push([p.x, p.y, p.z, s, h1 * 9, h2 * 9]);
              }
            }
          }
        }
        const add = (buf, mat, shadow) => {
          const g = buf.geometry();
          if (!g) return;
          const mesh = new T.Mesh(g, mat);
          mesh.castShadow = shadow;
          mesh.receiveShadow = true;
          root.add(mesh);
        };
        add(B.trim, Mt.trim, true);
        add(B.plinth, Mt.plinth, true);
        add(B.cable, Mt.cable, true);
        add(B.cable2, Mt.cable2, true);
        add(B.bracket, Mt.bracket, true);
        add(B.pipe, Mt.pipe, true);
        const pg = B.puddle.geometry();
        if (pg) {
          const pm = new T.Mesh(pg, Mt.puddle);
          pm.renderOrder = 1;
          root.add(pm);
        }
      }
    }
    // 瓦礫と紙くずはインスタンスで
    rockList.forEach((list, v) => {
      if (!list.length) return;
      const im = new T.InstancedMesh(rock[v], Mt.rubble, list.length);
      list.forEach(([x, y, z, s, ry, rx], k) => {
        e.set(rx * 0.3, ry, 0);
        q.setFromEuler(e);
        sc.set(s * (0.8 + (ry % 1) * 0.6), s, s * (0.8 + (rx % 1) * 0.6));
        pos.set(x, y, z);
        tmpM.compose(pos, q, sc);
        im.setMatrixAt(k, tmpM);
      });
      im.castShadow = true;
      im.receiveShadow = true;
      root.add(im);
    });
    if (paperList.length) {
      const pg = new T.PlaneGeometry(1, 0.75);
      pg.rotateX(-Math.PI / 2);
      const im = new T.InstancedMesh(pg, Mt.paper, paperList.length);
      paperList.forEach(([x, y, z, ry, s], k) => {
        e.set(0, ry, 0);
        q.setFromEuler(e);
        sc.set(s, 1, s);
        pos.set(x, y, z);
        tmpM.compose(pos, q, sc);
        im.setMatrixAt(k, tmpM);
      });
      im.receiveShadow = true;
      root.add(im);
    }
    return root;
  };
})();
