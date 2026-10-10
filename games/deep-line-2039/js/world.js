'use strict';
// グリッドベースの3Dワールド：メッシュ生成・衝突判定・レイキャスト・経路探索・照明プール
(function () {
  const DL = window.DL;
  const T = window.THREE;
  const CS = DL.CS;
  const UNREACH = 65535;

  function pushOut(p, r, x0, z0, x1, z1) {
    const qx = p.x < x0 ? x0 : p.x > x1 ? x1 : p.x;
    const qz = p.z < z0 ? z0 : p.z > z1 ? z1 : p.z;
    const dx = p.x - qx, dz = p.z - qz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) return false;
    if (d2 > 1e-10) {
      const d = Math.sqrt(d2);
      p.x += (dx / d) * (r - d);
      p.z += (dz / d) * (r - d);
    } else {
      const l = p.x - x0, rr = x1 - p.x, t = p.z - z0, b = z1 - p.z;
      const m = Math.min(l, rr, t, b);
      if (m === l) p.x = x0 - r;
      else if (m === rr) p.x = x1 + r;
      else if (m === t) p.z = z0 - r;
      else p.z = z1 + r;
    }
    return true;
  }

  const boxHit = { t: 0, ax: 0, s: 0 };
  function rayBox(ox, oy, oz, dx, dy, dz, c) {
    let tmin = -Infinity, tmax = Infinity, ax = 0, sg = 0;
    const o = [ox, oy, oz], d = [dx, dy, dz], lo = [c.x0, c.y0, c.z0], hi = [c.x1, c.y1, c.z1];
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-9) {
        if (o[a] < lo[a] || o[a] > hi[a]) return false;
      } else {
        let t1 = (lo[a] - o[a]) / d[a], t2 = (hi[a] - o[a]) / d[a], s = -1;
        if (t1 > t2) {
          const tt = t1; t1 = t2; t2 = tt; s = 1;
        }
        if (t1 > tmin) {
          tmin = t1; ax = a; sg = s;
        }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return false;
      }
    }
    if (tmin < 0 || tmax < tmin) return false;
    boxHit.t = tmin;
    boxHit.ax = ax;
    boxHit.s = sg;
    return true;
  }

  class World {
    constructor(w, h) {
      this.w = w;
      this.h = h;
      const n = w * h;
      this.floor = new Float32Array(n);
      this.ceil = new Float32Array(n).fill(4);
      this.solid = new Uint8Array(n).fill(1);
      this.sky = new Uint8Array(n);
      this.fm = new Uint8Array(n);
      this.wm = new Uint8Array(n);
      this.cm = new Uint8Array(n).fill(DL.M.ceiling);
      this.wmSet = new Uint8Array(n);
      this.top = new Float32Array(n);
      this.cblock = new Uint8Array(n);
      this.colliders = [];
      this.group = new T.Group();
      this.meshes = [];
      this.flowM = new Uint16Array(n).fill(UNREACH);
      this.flowH = new Uint16Array(n).fill(UNREACH);
      this.queue = new Int32Array(n);
      this.surfaceOf = null; // 足音の材質判定
      this.ray = { hit: false, t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, collider: null };
    }
    idx(x, z) {
      return z * this.w + x;
    }
    inb(x, z) {
      return x >= 0 && z >= 0 && x < this.w && z < this.h;
    }
    isOpen(x, z) {
      return x >= 0 && z >= 0 && x < this.w && z < this.h && !this.solid[z * this.w + x];
    }
    carve(x0, z0, x1, z1, o = {}) {
      if (x1 < x0) [x0, x1] = [x1, x0];
      if (z1 < z0) [z0, z1] = [z1, z0];
      const M = DL.M;
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          if (!this.inb(x, z)) continue;
          const i = this.idx(x, z);
          const f = typeof o.f === 'function' ? o.f(x, z) : o.f || 0;
          this.solid[i] = 0;
          this.floor[i] = f;
          if (o.sky) this.ceil[i] = 80;
          else if (o.ch !== undefined) this.ceil[i] = f + o.ch;
          else if (o.c !== undefined) this.ceil[i] = typeof o.c === 'function' ? o.c(x, z) : o.c;
          else this.ceil[i] = f + 4;
          this.sky[i] = o.sky ? 1 : 0;
          this.fm[i] = M[o.fm || 'concrete'];
          this.wm[i] = M[o.wm || 'concrete'];
          this.cm[i] = M[o.cm || 'ceiling'];
          this.top[i] = 0;
        }
      }
    }
    fill(x0, z0, x1, z1, o = {}) {
      if (x1 < x0) [x0, x1] = [x1, x0];
      if (z1 < z0) [z0, z1] = [z1, z0];
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          if (!this.inb(x, z)) continue;
          const i = this.idx(x, z);
          this.solid[i] = 1;
          this.sky[i] = 0;
          this.top[i] = typeof o.top === 'function' ? o.top(x, z) : o.top || 0;
          if (o.wm) {
            this.wm[i] = DL.M[o.wm];
            this.wmSet[i] = 1;
          }
          if (o.cm) this.cm[i] = DL.M[o.cm];
        }
      }
    }
    floorAt(x, z) {
      const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
      if (!this.isOpen(cx, cz)) return 0;
      return this.floor[this.idx(cx, cz)];
    }
    skyAt(x, z) {
      const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
      return this.isOpen(cx, cz) && this.sky[this.idx(cx, cz)] === 1;
    }
    matAt(x, z) {
      const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
      if (!this.isOpen(cx, cz)) return 0;
      return this.fm[this.idx(cx, cz)];
    }
    addCollider(x0, y0, z0, x1, y1, z1, o = {}) {
      const c = {
        x0: Math.min(x0, x1), x1: Math.max(x0, x1),
        y0: Math.min(y0, y1), y1: Math.max(y0, y1),
        z0: Math.min(z0, z1), z1: Math.max(z0, z1),
        noRay: !!o.noRay, tag: o.tag || null, mat: o.mat || 'concrete',
      };
      this.colliders.push(c);
      return c;
    }
    removeCollider(c) {
      const i = this.colliders.indexOf(c);
      if (i >= 0) this.colliders.splice(i, 1);
      this.computeCBlock();
    }
    computeCBlock() {
      this.cblock.fill(0);
      for (const c of this.colliders) {
        const x0 = Math.floor(c.x0 / CS), x1 = Math.floor(c.x1 / CS), z0 = Math.floor(c.z0 / CS), z1 = Math.floor(c.z1 / CS);
        for (let z = z0; z <= z1; z++) {
          for (let x = x0; x <= x1; x++) {
            if (!this.inb(x, z)) continue;
            const cx = (x + 0.5) * CS, cz = (z + 0.5) * CS;
            if (cx < c.x0 || cx > c.x1 || cz < c.z0 || cz > c.z1) continue;
            const i = this.idx(x, z);
            if (c.y1 - this.floor[i] > 1.0 && c.y0 < this.floor[i] + 1.6) this.cblock[i] = 1;
          }
        }
      }
    }

    // ---------- メッシュ構築 ----------
    build() {
      for (const m of this.meshes) {
        this.group.remove(m);
        m.geometry.dispose();
      }
      this.meshes = [];
      const mats = DL.getMaterials();
      const CH = 16;
      const w = this.w;
      for (let cz0 = 0; cz0 < this.h; cz0 += CH) {
        for (let cx0 = 0; cx0 < this.w; cx0 += CH) {
          const B = {};
          const bk = (m) => B[m] || (B[m] = { p: [], n: [], u: [] });
          const floorQ = (m, x0, z0, x1, z1, y, down) => {
            const b = bk(m), s = DL.uvScale(m);
            const P = down ? [[x0, z0], [x1, z0], [x1, z1], [x0, z1]] : [[x0, z0], [x0, z1], [x1, z1], [x1, z0]];
            const ny = down ? -1 : 1;
            for (const k of [0, 1, 2, 0, 2, 3]) {
              b.p.push(P[k][0], y, P[k][1]);
              b.n.push(0, ny, 0);
              b.u.push(P[k][0] / s, P[k][1] / s);
            }
          };
          const wallQ = (m, xa, za, xb, zb, y0, y1, nx, nz) => {
            if (y1 - y0 < 0.002) return;
            if (-(zb - za) * nx + (xb - xa) * nz < 0) {
              let t = xa; xa = xb; xb = t;
              t = za; za = zb; zb = t;
            }
            const b = bk(m), s = DL.uvScale(m);
            const alongZ = xa === xb;
            const ua = (alongZ ? za : xa) / s, ub = (alongZ ? zb : xb) / s;
            const V = [[xa, y0, za, ua, y0 / s], [xb, y0, zb, ub, y0 / s], [xb, y1, zb, ub, y1 / s], [xa, y1, za, ua, y1 / s]];
            for (const k of [0, 1, 2, 0, 2, 3]) {
              b.p.push(V[k][0], V[k][1], V[k][2]);
              b.n.push(nx, 0, nz);
              b.u.push(V[k][3], V[k][4]);
            }
          };
          for (let z = cz0; z < Math.min(cz0 + CH, this.h); z++) {
            for (let x = cx0; x < Math.min(cx0 + CH, this.w); x++) {
              const i = z * w + x;
              const X0 = x * CS, X1 = X0 + CS, Z0 = z * CS, Z1 = Z0 + CS;
              if (this.solid[i]) {
                if (this.top[i] > 0) floorQ(DL.M.concrete, X0, Z0, X1, Z1, this.top[i], false);
                continue;
              }
              const f = this.floor[i], c = this.ceil[i], sky = this.sky[i];
              floorQ(this.fm[i], X0, Z0, X1, Z1, f, false);
              if (!sky) floorQ(this.cm[i], X0, Z0, X1, Z1, c, true);
              let skyNb = false;
              if (!sky) {
                for (const [ax, az] of [[x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]]) {
                  if (this.inb(ax, az) && !this.solid[az * w + ax] && this.sky[az * w + ax]) skyNb = true;
                }
              }
              const dirs = [[-1, 0, X0, Z0, X0, Z1, 1, 0], [1, 0, X1, Z0, X1, Z1, -1, 0], [0, -1, X0, Z0, X1, Z0, 0, 1], [0, 1, X0, Z1, X1, Z1, 0, -1]];
              for (const [dx, dz, xa, za, xb, zb, nx, nz] of dirs) {
                const ax = x + dx, az = z + dz;
                const inb = this.inb(ax, az);
                const j = inb ? az * w + ax : -1;
                if (!inb || this.solid[j]) {
                  let y1 = c;
                  if (sky) y1 = inb && this.top[j] > 0 ? this.top[j] : 30;
                  const m = inb && this.wmSet[j] ? this.wm[j] : this.wm[i];
                  wallQ(m, xa, za, xb, zb, f, y1, nx, nz);
                  if (!sky && skyNb && inb && this.top[j] > c + 0.45) wallQ(m, xa, za, xb, zb, c + 0.45, this.top[j], nx, nz);
                  continue;
                }
                const nf = this.floor[j], nc = this.ceil[j], nsky = this.sky[j];
                if (nf > f) wallQ(this.wm[i], xa, za, xb, zb, f, sky ? nf : Math.min(nf, c), nx, nz);
                if (!sky && !nsky && nc < c) wallQ(this.wm[i], xa, za, xb, zb, Math.max(nc, f), c, nx, nz);
                if (sky && !nsky) wallQ(this.wm[j], xa, za, xb, zb, nc, nc + 0.45, nx, nz);
              }
              if (!sky && skyNb) floorQ(DL.M.concrete, X0, Z0, X1, Z1, c + 0.45, false);
            }
          }
          for (const k in B) {
            const b = B[k];
            if (!b.p.length) continue;
            const g = new T.BufferGeometry();
            g.setAttribute('position', new T.Float32BufferAttribute(b.p, 3));
            g.setAttribute('normal', new T.Float32BufferAttribute(b.n, 3));
            g.setAttribute('uv', new T.Float32BufferAttribute(b.u, 2));
            g.computeBoundingSphere();
            const mesh = new T.Mesh(g, mats[k]);
            mesh.receiveShadow = true;
            mesh.castShadow = true;
            this.group.add(mesh);
            this.meshes.push(mesh);
          }
        }
      }
      // 壁際の細部（js/dress.js）
      if (DL.dressWorld) DL.dressWorld(this);
      this.computeCBlock();
    }

    // ---------- 衝突 ----------
    blocksCell(cx, cz, feet, h, step) {
      if (cx < 0 || cz < 0 || cx >= this.w || cz >= this.h) return true;
      const i = cz * this.w + cx;
      if (this.solid[i]) return true;
      if (this.floor[i] > feet + step) return true;
      if (!this.sky[i] && this.ceil[i] < feet + h) return true;
      return false;
    }
    collide(p, r, h, step) {
      const feet = p.y;
      for (let iter = 0; iter < 3; iter++) {
        let moved = false;
        const x0 = Math.floor((p.x - r) / CS), x1 = Math.floor((p.x + r) / CS);
        const z0 = Math.floor((p.z - r) / CS), z1 = Math.floor((p.z + r) / CS);
        for (let cz = z0; cz <= z1; cz++) {
          for (let cx = x0; cx <= x1; cx++) {
            if (this.blocksCell(cx, cz, feet, h, step)) {
              if (pushOut(p, r, cx * CS, cz * CS, (cx + 1) * CS, (cz + 1) * CS)) moved = true;
            }
          }
        }
        for (const c of this.colliders) {
          if (c.y1 <= feet + step || c.y0 >= feet + h) continue;
          if (c.x1 < p.x - r || c.x0 > p.x + r || c.z1 < p.z - r || c.z0 > p.z + r) continue;
          if (pushOut(p, r, c.x0, c.z0, c.x1, c.z1)) moved = true;
        }
        if (!moved) break;
      }
    }
    groundAt(x, z, r, feet, step) {
      let g = -1e9;
      const rr = r * 0.55;
      const x0 = Math.floor((x - rr) / CS), x1 = Math.floor((x + rr) / CS);
      const z0 = Math.floor((z - rr) / CS), z1 = Math.floor((z + rr) / CS);
      for (let cz = z0; cz <= z1; cz++) {
        for (let cx = x0; cx <= x1; cx++) {
          if (!this.isOpen(cx, cz)) continue;
          const f = this.floor[cz * this.w + cx];
          if (f <= feet + step + 1e-3 && f > g) g = f;
        }
      }
      for (const c of this.colliders) {
        if (c.y1 > feet + step + 1e-3 || c.y1 <= g) continue;
        if (c.x1 < x - rr || c.x0 > x + rr || c.z1 < z - rr || c.z0 > z + rr) continue;
        g = c.y1;
      }
      if (g < -1e8) g = this.floorAt(x, z);
      return g;
    }
    ceilAt(x, z, r, feet) {
      let cl = Infinity;
      const rr = r * 0.7;
      const x0 = Math.floor((x - rr) / CS), x1 = Math.floor((x + rr) / CS);
      const z0 = Math.floor((z - rr) / CS), z1 = Math.floor((z + rr) / CS);
      for (let cz = z0; cz <= z1; cz++) {
        for (let cx = x0; cx <= x1; cx++) {
          if (!this.isOpen(cx, cz)) continue;
          const i = cz * this.w + cx;
          if (!this.sky[i] && this.ceil[i] < cl) cl = this.ceil[i];
        }
      }
      for (const c of this.colliders) {
        if (c.y0 < feet + 0.2 || c.y0 >= cl) continue;
        if (c.x1 < x - rr || c.x0 > x + rr || c.z1 < z - rr || c.z0 > z + rr) continue;
        cl = c.y0;
      }
      return cl;
    }

    // ---------- レイキャスト ----------
    raycast(ox, oy, oz, dx, dy, dz, maxD, noColliders) {
      const R = this.ray;
      let best = maxD, nx = 0, ny = 0, nz = 0, hit = false, col = null;
      let cx = Math.floor(ox / CS), cz = Math.floor(oz / CS);
      const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
      const adx = Math.abs(dx), adz = Math.abs(dz);
      const tdx = adx > 1e-9 ? CS / adx : Infinity, tdz = adz > 1e-9 ? CS / adz : Infinity;
      let tmx = adx > 1e-9 ? (dx > 0 ? (cx + 1) * CS - ox : ox - cx * CS) / adx : Infinity;
      let tmz = adz > 1e-9 ? (dz > 0 ? (cz + 1) * CS - oz : oz - cz * CS) / adz : Infinity;
      let t = 0, enx = 0, enz = 0;
      for (let it = 0; it < 600; it++) {
        const tExit = Math.min(tmx, tmz);
        const yE = oy + dy * t;
        if (!this.inb(cx, cz)) {
          if (yE < 40 && t < best) {
            hit = true; best = t; nx = enx; ny = 0; nz = enz;
          }
          break;
        }
        const i = cz * this.w + cx;
        if (this.solid[i]) {
          const top = this.top[i];
          if (top > 0 && yE > top) {
            if (dy < 0) {
              const tr = (top - oy) / dy;
              if (tr >= t && tr <= tExit && tr < best) {
                hit = true; best = tr; nx = 0; ny = 1; nz = 0;
                break;
              }
            }
          } else {
            if (t < best) {
              hit = true; best = t; nx = enx; ny = 0; nz = enz;
            }
            break;
          }
        } else {
          const f = this.floor[i], c = this.sky[i] ? Infinity : this.ceil[i];
          if (it > 0 && (yE < f - 1e-4 || yE > c + 1e-4)) {
            if (t < best) {
              hit = true; best = t; nx = enx; ny = 0; nz = enz;
            }
            break;
          }
          if (dy < 0) {
            const tf = (f - oy) / dy;
            if (tf >= t - 1e-6 && tf <= tExit && tf < best) {
              hit = true; best = Math.max(0, tf); nx = 0; ny = 1; nz = 0;
              break;
            }
          } else if (dy > 0 && c !== Infinity) {
            const tc = (c - oy) / dy;
            if (tc >= t - 1e-6 && tc <= tExit && tc < best) {
              hit = true; best = Math.max(0, tc); nx = 0; ny = -1; nz = 0;
              break;
            }
          }
        }
        if (tExit >= best) break;
        if (tmx < tmz) {
          cx += sx; t = tmx; tmx += tdx; enx = -sx; enz = 0;
        } else {
          cz += sz; t = tmz; tmz += tdz; enx = 0; enz = -sz;
        }
      }
      if (!noColliders) {
        for (const c of this.colliders) {
          if (c.noRay) continue;
          if (rayBox(ox, oy, oz, dx, dy, dz, c) && boxHit.t < best) {
            best = boxHit.t;
            hit = true;
            col = c;
            nx = boxHit.ax === 0 ? boxHit.s : 0;
            ny = boxHit.ax === 1 ? boxHit.s : 0;
            nz = boxHit.ax === 2 ? boxHit.s : 0;
          }
        }
      }
      R.hit = hit;
      R.t = best;
      R.x = ox + dx * best;
      R.y = oy + dy * best;
      R.z = oz + dz * best;
      R.nx = nx;
      R.ny = ny;
      R.nz = nz;
      R.collider = col;
      return R;
    }
    los(ax, ay, az, bx, by, bz) {
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 0.05) return true;
      const r = this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d - 0.05);
      return !r.hit;
    }

    // ---------- 経路（距離場） ----------
    computeFlow(field, tx, tz, climb, maxDist) {
      field.fill(UNREACH);
      const w = this.w, h = this.h, q = this.queue;
      const cx = Math.floor(tx / CS), cz = Math.floor(tz / CS);
      if (!this.isOpen(cx, cz)) return;
      let qh = 0, qt = 0;
      const ti = cz * w + cx;
      field[ti] = 0;
      q[qt++] = ti;
      while (qh < qt) {
        const i = q[qh++];
        const d = field[i];
        if (d >= maxDist) continue;
        const x = i % w, z = (i / w) | 0;
        const f = this.floor[i];
        for (let k = 0; k < 4; k++) {
          const nx = k === 0 ? x - 1 : k === 1 ? x + 1 : x;
          const nz = k === 2 ? z - 1 : k === 3 ? z + 1 : z;
          if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
          const j = nz * w + nx;
          if (field[j] !== UNREACH || this.solid[j] || this.cblock[j]) continue;
          if (f - this.floor[j] > climb) continue;
          if (!this.sky[j] && this.ceil[j] - this.floor[j] < 1.3) continue;
          field[j] = d + 1;
          q[qt++] = j;
        }
      }
    }
    // 距離場から次に向かう地点（ワールド座標）を返す
    navTarget(field, x, z, out) {
      const w = this.w;
      const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
      if (!this.inb(cx, cz)) return false;
      const i = cz * w + cx;
      const cur = field[i];
      if (cur === UNREACH) return false;
      if (cur === 0) return false;
      let best = cur, bx = -1, bz = -1;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx, nz = cz + dz;
          if (!this.inb(nx, nz)) continue;
          const v = field[nz * w + nx];
          if (v === UNREACH) continue;
          if (dx && dz) {
            if (field[cz * w + nx] === UNREACH || field[nz * w + cx] === UNREACH) continue;
          }
          const score = v + (dx && dz ? 0.3 : 0);
          if (score < best) {
            best = score; bx = nx; bz = nz;
          }
        }
      }
      if (bx < 0) return false;
      out.x = (bx + 0.5) * CS;
      out.z = (bz + 0.5) * CS;
      return true;
    }
    flowAt(field, x, z) {
      const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
      if (!this.inb(cx, cz)) return UNREACH;
      return field[cz * this.w + cx];
    }
  }
  World.UNREACH = UNREACH;
  DL.World = World;

  // ---------- 照明プール ----------
  class LightPool {
    constructor(scene, n) {
      this.n = n;
      this.lights = [];
      for (let i = 0; i < n; i++) {
        const l = new T.PointLight(0xffffff, 0, 10, 2);
        scene.add(l);
        this.lights.push(l);
      }
      this.arr = [];
    }
    update(lamps, cam) {
      const arr = this.arr;
      arr.length = 0;
      for (const L of lamps) {
        if (!L.on || L.broken || L._f <= 0.01) continue;
        const dx = L.x - cam.x, dy = L.y - cam.y, dz = L.z - cam.z;
        const d = dx * dx + dy * dy + dz * dz;
        const lim = L.range + 34;
        if (d > lim * lim) continue;
        L._d = Math.sqrt(d) - L.range * 0.6 - (L.priority || 0);
        arr.push(L);
      }
      arr.sort((a, b) => a._d - b._d);
      for (let i = 0; i < this.n; i++) {
        const l = this.lights[i], L = arr[i];
        if (!L) {
          l.intensity = 0;
          continue;
        }
        l.position.set(L.x, L.y, L.z);
        l.color.setHex(L.color);
        l.distance = L.range;
        l.intensity = L.intensity * L._f;
      }
    }
  }
  DL.LightPool = LightPool;
})();
