'use strict';
// 章の定義：地形・登場人物・台詞・イベント
(function () {
  const DL = window.DL;
  const T = window.THREE;
  const C = DL.cmat;
  const PI = Math.PI;
  const Y = { N: DL.yawTo(0, 1), S: DL.yawTo(0, -1), E: DL.yawTo(1, 0), W: DL.yawTo(-1, 0) };
  const F = { N: [0, 1], S: [0, -1], E: [1, 0], W: [-1, 0] };

  // ================= 章の作業用コンテキスト =================
  class LevelCtx {
    constructor(G, def) {
      this.G = G;
      this.def = def;
      this.W = G.world;
      this.f = {};
      this.onDeath = null;
      this.tickers = [];
      this.tick = (dt) => {
        for (let i = this.tickers.length - 1; i >= 0; i--) if (this.tickers[i](dt) === false) this.tickers.splice(i, 1);
      };
    }
    get P() {
      return this.G.player;
    }
    room(x0, z0, x1, z1, o) {
      this.W.carve(x0, z0, x1, z1, o);
    }
    solid(x0, z0, x1, z1, o) {
      this.W.fill(x0, z0, x1, z1, o);
    }
    fy(x, z) {
      return this.W.floorAt(x, z);
    }
    add(o) {
      this.G.scene.add(o);
      return o;
    }
    box(w, h, d, color, x, y, z, o = {}) {
      const m = DL.box(w, h, d, typeof color === 'number' ? C(color, o.rough || 0.85, o.metal || 0) : color, x, y, z, null);
      if (o.rot) m.rotation.y = o.rot;
      this.add(m);
      if (o.col) this.W.addCollider(x - w / 2, y - h / 2, z - d / 2, x + w / 2, y + h / 2, z + d / 2, { mat: o.mat });
      return m;
    }
    prop(kind, x, z, o = {}) {
      const r = DL.Props[kind](o);
      const y = o.y !== undefined ? o.y : this.fy(x, z);
      const rot = o.rot || 0;
      r.obj.position.set(x, y, z);
      r.obj.rotation.y = rot;
      this.add(r.obj);
      r.colliders = [];
      if (!o.noCol) {
        const c = Math.cos(rot), s = Math.sin(rot);
        for (const b of r.cols) {
          const pts = [[b[0], b[2]], [b[3], b[2]], [b[3], b[5]], [b[0], b[5]]].map(([lx, lz]) => [lx * c + lz * s, -lx * s + lz * c]);
          const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
          r.colliders.push(this.W.addCollider(x + Math.min(...xs), y + b[1], z + Math.min(...zs), x + Math.max(...xs), y + b[4], z + Math.max(...zs), { mat: o.mat || (kind === 'car' || kind === 'trainCar' || kind === 'barrel' || kind === 'gate' || kind === 'shutter' || kind === 'cage' ? 'metal' : 'wood') }));
        }
        if (this.W.meshes.length) this.W.computeCBlock();
      }
      return r;
    }
    removeColliders(r) {
      for (const c of r.colliders || []) {
        const i = this.W.colliders.indexOf(c);
        if (i >= 0) this.W.colliders.splice(i, 1);
      }
      r.colliders = [];
      this.W.computeCBlock();
    }
    // 扉・シャッターを持ち上げて開く
    openDoor(r, h = 3.4, dur = 2, axis = 'y') {
      this.removeColliders(r);
      const d = r.door;
      if (!d) return Promise.resolve();
      const start = this.G.time;
      return new Promise((res) => {
        this.tickers.push(() => {
          const k = Math.min(1, (this.G.time - start) / dur);
          if (axis === 'y') d.position.y = DL.smooth(k) * h;
          else d.rotation.y = DL.smooth(k) * h;
          if (k >= 1) {
            res();
            return false;
          }
          return true;
        });
      });
    }
    track(x0, z0, x1, z1) {
      const alongZ = x0 === x1;
      const len = alongZ ? Math.abs(z1 - z0) : Math.abs(x1 - x0);
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const y = this.fy(cx, cz);
      const railM = C(0x6a645c, 0.35, 0.85), slM = C(0x3a3028, 0.95);
      for (const off of [-0.72, 0.72]) {
        const r = DL.box(alongZ ? 0.07 : len, 0.13, alongZ ? len : 0.07, railM, alongZ ? cx + off : cx, y + 0.17, alongZ ? cz : cz + off, null);
        r.castShadow = false;
        this.add(r);
      }
      const n = Math.floor(len / 0.75);
      const im = new T.InstancedMesh(DL.GEO.box, slM, n);
      const m = new T.Matrix4(), q = new T.Quaternion(), sc = new T.Vector3(alongZ ? 2.4 : 0.26, 0.11, alongZ ? 0.26 : 2.4), p = new T.Vector3();
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) * 0.75;
        p.set(alongZ ? cx : Math.min(x0, x1) + t, y + 0.055, alongZ ? Math.min(z0, z1) + t : cz);
        m.compose(p, q, sc);
        im.setMatrixAt(i, m);
      }
      im.receiveShadow = true;
      this.add(im);
    }
    tunnelDecor(x0, z0, x1, z1, axis, o = {}) {
      // x0..x1 / z0..z1 はメートル。axis 方向に伸びるトンネルの壁際に、リブ・配管・ケーブルを並べる
      const alongZ = axis === 'z';
      const len = alongZ ? z1 - z0 : x1 - x0;
      const midX = (x0 + x1) / 2, midZ = (z0 + z1) / 2;
      const cx = Math.floor(midX / DL.CS), cz = Math.floor(midZ / DL.CS);
      const cy = this.W.isOpen(cx, cz) ? this.W.ceil[this.W.idx(cx, cz)] : 4.4;
      const fy = this.fy(midX, midZ);
      const span = alongZ ? x1 - x0 : z1 - z0;
      const n = Math.floor(len / (o.every || 4));
      const im = new T.InstancedMesh(DL.GEO.box, C(0x5a5850, 0.95), n * 3);
      const m = new T.Matrix4(), q = new T.Quaternion(), s = new T.Vector3(), p = new T.Vector3();
      let k = 0;
      for (let i = 0; i < n; i++) {
        const t = (alongZ ? z0 : x0) + (i + 0.5) * (len / n);
        const put = (px, py, pz, sx, sy, sz) => {
          p.set(px, py, pz);
          s.set(sx, sy, sz);
          m.compose(p, q, s);
          im.setMatrixAt(k++, m);
        };
        if (alongZ) {
          put(x0 + 0.12, fy + (cy - fy) / 2, t, 0.24, cy - fy, 0.4);
          put(x1 - 0.12, fy + (cy - fy) / 2, t, 0.24, cy - fy, 0.4);
          put(midX, cy - 0.14, t, span, 0.28, 0.4);
        } else {
          put(t, fy + (cy - fy) / 2, z0 + 0.12, 0.4, cy - fy, 0.24);
          put(t, fy + (cy - fy) / 2, z1 - 0.12, 0.4, cy - fy, 0.24);
          put(t, cy - 0.14, midZ, 0.4, 0.28, span);
        }
      }
      im.castShadow = true;
      im.receiveShadow = true;
      this.add(im);
      if (o.pipes !== false) {
        const pp = DL.Props.pipes({ len, n: 3, seed: Math.floor(x0 + z0) });
        if (alongZ) pp.obj.position.set(x0 + 0.38, fy + 2.5, midZ);
        else {
          pp.obj.position.set(midX, fy + 2.5, z0 + 0.38);
          pp.obj.rotation.y = PI / 2;
        }
        this.add(pp.obj);
        const cab = C(0x141414, 0.7);
        for (let i = 0; i < 2; i++) {
          const b = alongZ ? DL.box(0.04, 0.04, len, cab, x1 - 0.3, fy + 2.0 + i * 0.12, midZ, null) : DL.box(len, 0.04, 0.04, cab, midX, fy + 2.0 + i * 0.12, z1 - 0.3, null);
          b.castShadow = false;
          this.add(b);
        }
      }
    }
    edge(x, z0, z1, y) {
      const m = DL.box(0.32, 0.02, z1 - z0, C(0xa88c34, 0.7), x, y + 0.012, (z0 + z1) / 2, null);
      m.castShadow = false;
      this.add(m);
    }
    lamp(kind, x, y, z, o = {}) {
      const G = this.G;
      const color = o.color || (kind === 'tube' ? 0xdfe8ff : kind === 'fire' ? 0xff8a3a : 0xffbf78);
      let r = null, ly = y, bx = x, by = y, bz = z;
      if (kind === 'bulb') {
        r = DL.Props.lampBulb({ cord: o.cord || 0.8, color, shade: o.shade });
        r.obj.position.set(x, y, z);
        ly = by = y + r.bulbY;
      } else if (kind === 'cage') {
        r = DL.Props.lampCage({ color });
        r.obj.position.set(x, y, z);
        const fc = o.face || F.E;
        r.obj.rotation.y = DL.yawTo(fc[0], fc[1]);
        bx = x + fc[0] * 0.08;
        bz = z + fc[1] * 0.08;
      } else if (kind === 'tube') {
        r = DL.Props.lampTube({ color });
        r.obj.position.set(x, y - 0.03, z);
        r.obj.rotation.y = o.yaw || 0;
        ly = by = y - 0.1;
      } else if (kind === 'flood') {
        r = DL.Props.flood({ color });
        r.obj.position.set(x, y, z);
        const fc = o.face || F.S;
        r.obj.rotation.y = DL.yawTo(fc[0], fc[1]);
        ly = by = y + 1.9;
        bx = x + fc[0] * 0.3;
        bz = z + fc[1] * 0.3;
        this.W.addCollider(x - 0.2, y, z - 0.2, x + 0.2, y + 2, z + 0.2, { mat: 'metal' });
      } else if (kind === 'fire') {
        if (o.campfire) this.prop('campfire', x, z, { y });
        else if (o.barrel) this.prop('barrel', x, z, { y, fire: true, color: 0x3a2a22 });
        const fyy = y + (o.barrel ? 0.9 : 0.05);
        G.fx.addFire(x, fyy, z, o.scale || (o.barrel ? 0.8 : 1));
        ly = by = fyy + 0.6;
      }
      if (r) this.add(r.obj);
      const bulb = r ? r.bulb : null;
      const L = {
        x: bx, y: ly, z: bz, color, intensity: o.intensity !== undefined ? o.intensity : 1, range: o.range || 10,
        on: o.on !== false, broken: false, kind, flicker: o.flicker || 0, fs: 3 + Math.random() * 4, ph: Math.random() * 10, _f: 1,
        bulb, bulbColor: bulb ? bulb.material.color.clone() : null,
        shootable: o.shootable !== undefined ? o.shootable : kind === 'bulb' || kind === 'cage' || kind === 'tube',
        priority: o.priority || 0,
      };
      if (kind === 'cage') {
        const fc = o.face || F.E;
        L.x = x + fc[0] * 0.3;
        L.z = z + fc[1] * 0.3;
      }
      if (o.glow !== false && kind !== 'fire') {
        const s = new T.Sprite(new T.SpriteMaterial({ map: DL.tex('glow'), color, transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
        s.position.set(bx, by, bz);
        const sc = kind === 'tube' ? 1.8 : kind === 'flood' ? 2.2 : 0.95;
        s.scale.set(sc, kind === 'tube' ? 0.7 : sc, sc);
        this.add(s);
        L.glow = s;
        L.glowA = o.glowA || 1;
      }
      G.lamps.push(L);
      return L;
    }
    sign(jp, en, x, y, z, face, o = {}) {
      const r = DL.Props.sign(Object.assign({ jp, en }, o));
      r.obj.position.set(x, y, z);
      r.obj.rotation.y = Math.atan2(face[0], face[1]);
      this.add(r.obj);
      return r;
    }
    poster(x, y, z, face, o = {}) {
      const r = DL.Props.poster(o);
      r.obj.position.set(x, y, z);
      r.obj.rotation.y = Math.atan2(face[0], face[1]);
      r.obj.rotation.z = (Math.random() - 0.5) * 0.08;
      this.add(r.obj);
      return r;
    }
    note(x, z, title, text, o = {}) {
      const G = this.G;
      const y = o.y !== undefined ? o.y : this.fy(x, z);
      const r = DL.Props.note();
      r.obj.position.set(x, y + 0.01, z);
      this.add(r.obj);
      let found = false;
      G.addInteract({
        pos: { x, y: y + 0.15, z }, r: 2.0, label: 'メモを読む', name: '',
        onUse: () => {
          if (!found) {
            found = true;
            if (!G.notes.find((n) => n.title === title)) G.notes.push({ title });
          }
          G.ui.openNote(title, text);
        },
      });
    }
    pickup(type, n, x, z, y) {
      return this.G.spawnPickup(type, n, x, z, y);
    }
    gas(x0, z0, x1, z1, o = {}) {
      this.G.zones.push({ x0, z0, x1, z1, s: o.s || 1, y1: o.y1 });
      this.G.fx.addGas(x0, z0, x1, z1, 0, o.color);
    }
    npc(o) {
      return this.G.addEntity(new DL.Human(this.G, Object.assign({ role: 'npc' }, o)));
    }
    ally(o) {
      return this.G.addEntity(new DL.Human(this.G, Object.assign({ role: 'ally' }, o)));
    }
    enemy(o) {
      const e = this.G.addEntity(new DL.Human(this.G, Object.assign({ role: 'enemy', name: o.name || '赤環の兵' }, o)));
      if (o.lantern) {
        const L = this.lamp('none', o.x, 1, o.z, { color: 0xffb060, intensity: 0.7, range: 7, glow: false, shootable: false });
        L.follow = e;
        e.lamp = L;
      }
      return e;
    }
    ghost(o) {
      const g = this.G.addEntity(new DL.Human(this.G, Object.assign({ role: 'ghost', look: o.look || {} }, o)));
      // 子どもの影: Blender の子どもの模型があればそれを等倍で使う
      if (o.scale) g.mesh.scale.setScalar(g.model && g.model.skinned && o.look && o.look.model === 'yuki' ? 1 : o.scale);
      return g;
    }
    mutant(kind, x, z, o = {}) {
      return this.G.addEntity(new DL.Mutant(this.G, kind, x, z, o));
    }
    // ---------- 進行 ----------
    wait(s) {
      return this.G.wait(s);
    }
    until(fn) {
      return this.G.until(fn);
    }
    say(n, t, d) {
      return this.G.say(n, t, d);
    }
    async talk(lines) {
      for (const l of lines) await this.say(l[0], l[1], l[2]);
    }
    choose(q, opts) {
      return this.G.choose(q, opts);
    }
    objective(t) {
      this.G.ui.objective(t);
    }
    hint(t) {
      this.G.ui.toast(t);
    }
    inZone(x0, z0, x1, z1) {
      const p = this.G.player.pos;
      return p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
    }
    zone(x0, z0, x1, z1) {
      return this.until(() => this.inZone(x0, z0, x1, z1));
    }
    dist(e) {
      const p = this.G.player.pos;
      return Math.hypot(p.x - e.pos.x, p.z - e.pos.z);
    }
    allDead(list) {
      return this.until(() => list.every((e) => !e.alive || e.removed));
    }
    alive(list) {
      return list.filter((e) => e.alive && !e.removed).length;
    }
    shop(title, items) {
      this.G.ui.openShop(title, items);
    }
    end() {
      return this.G.nextChapter();
    }
    ending(k) {
      return this.G.showEnding(k);
    }
    interact(o) {
      return this.G.addInteract(o);
    }
    collapse(x0, z0, x1, z1, fx = true) {
      const G = this.G;
      this.W.fill(x0, z0, x1, z1, { wm: 'rubble' });
      this.W.build();
      const cx = ((x0 + x1 + 1) / 2) * DL.CS, cz = ((z0 + z1 + 1) / 2) * DL.CS;
      const w = (x1 - x0 + 1) * DL.CS, d = (z1 - z0 + 1) * DL.CS;
      this.prop('rubble', cx, cz - d / 2 - 0.6, { w: w, d: 2, h: 2.4, seed: 7, noCol: true, rebar: true });
      this.prop('rubble', cx, cz + d / 2 + 0.6, { w: w, d: 2, h: 2.4, seed: 8, noCol: true, rebar: true });
      if (fx) {
        G.audio.rumble(4, 1.2);
        G.player.shake(1.1);
        for (let i = 0; i < 6; i++) G.fx.smoke(cx + DL.rand(-2, 2), 1 + Math.random() * 2, cz + DL.rand(-4, 4), { life: 4, size: 2, grow: 2, a: 0.5, color: 0x6a665e, rise: 0.2 });
        G.fx.dust(cx, 2, cz - d / 2 - 1, 30, 2);
        G.fx.dust(cx, 2, cz + d / 2 + 1, 30, 2);
      }
    }
  }
  DL.LevelCtx = LevelCtx;

  // ================= 見た目のプリセット =================
  const pick = DL.pick;
  const LOOK = {
    haru: { cloth: 0x3a3d34, pants: 0x2a2a26 },
    kuroda: { model: 'kuroda', gun: true, cloth: 0x3a3b30, pants: 0x2a2a24, coat: true, vest: 0x4a4636, pack: true, beard: 0x2a2620, hat: 'beanie', hatColor: 0x26261f, gloves: true, scarf: 0x5a3a2a },
    minami: { model: 'minami', cloth: 0x4a3a40, pants: 0x3a3030, coat: true, hair: 0xb8b0a8, skin: 0xb89a80, scarf: 0x6a5a3a },
    shino: { model: 'shino', cloth: 0x3a4a52, pants: 0x2a2e30, hair: 0x1a1612, skin: 0xc0987a },
    goro: { model: 'goro', cloth: 0x5a4a32, pants: 0x3a3226, vest: 0x6a5a3a, beard: 0x3a3028, hat: 'cap', hatColor: 0x3a3a30 },
    sota: { model: 'sota', cloth: 0x5a3a2a, pants: 0x2a2a30, hair: 0x2a2018, guitar: true },
    yuki: { model: 'yuki', cloth: 0x8a5a4a, pants: 0x3a3a46, hair: 0x1a1410, skin: 0xc8a080 },
    guard: { model: 'guard', cloth: 0x3c4232, pants: 0x2c3026, vest: 0x4a5038, hat: 'helmet', hatColor: 0x3a4030, gloves: true, gun: true },
    traveler: { model: 'traveler', cloth: 0x4a4a3a, pants: 0x3a362e, pack: true, hat: 'hood', beard: 0x3a3228 },
    nagata: { model: 'nagata', cloth: 0x2a3440, pants: 0x232a30, vest: 0x3a4450, hat: 'cap', hatColor: 0x222a34, gloves: true, gun: true },
    sakaki: { model: 'sakaki', cloth: 0x2a2a2e, pants: 0x222226, coat: true, hair: 0x9a9a9a, skin: 0xb89880, scarf: 0x6a1c18 },
    yamada: { model: 'yamada', cloth: 0x5a5040, pants: 0x3a3428, hat: 'cap', hatColor: 0x4a3a2a, beard: 0x2a2420 },
    scout: { model: 'scout', cloth: 0x3a3c32, pants: 0x2a2a24, vest: 0x4a4838, hat: 'beanie', mask: true, pack: true, gloves: true, gun: true },
  };
  // model: Blender で作った人物（tools/build_humans.py）。無い環境では残りの値で旧来の模型を組む
  const citizen = () => ({ model: pick(['citizen1', 'citizen2', 'citizen3', 'citizen4']), cloth: pick([0x4a4036, 0x3a4048, 0x5a4a3a, 0x40382e, 0x4a3a3a, 0x384034]), pants: pick([0x2a2a26, 0x33302a, 0x2a2e32]), hair: pick([0x1a1612, 0x3a3028, 0x8a8478, undefined]), coat: Math.random() < 0.4, hat: pick([undefined, 'beanie', undefined, 'hood']), scarf: pick([undefined, 0x5a3a2a, 0x3a4a5a]) });
  const bandit = () => {
    const mask = Math.random() < 0.45;
    return { model: mask ? 'bandit1' : pick(['bandit2', 'bandit3']), cloth: pick([0x4a2a24, 0x3a2a2a, 0x2e2a28]), pants: 0x2a2624, vest: pick([0x5a2a20, 0x6a2a1e, 0x3a3a30]), hat: pick(['hood', 'beanie', undefined]), scarf: 0x9a2a1e, mask, gloves: true };
  };
  const ghostLook = () => ({ model: pick(['citizen1', 'citizen3', 'citizen4']), coat: Math.random() < 0.5, hat: pick([undefined, 'cap', undefined]), pack: Math.random() < 0.3 });

  function kit(o = {}) {
    const inv = o.inv || {};
    return {
      inv: { medkit: inv.medkit !== undefined ? inv.medkit : 2, filter: inv.filter !== undefined ? inv.filter : 2, bomb: inv.bomb !== undefined ? inv.bomb : 2, mil: inv.mil !== undefined ? inv.mil : 20, ammo: Object.assign({ p: 18, r: 60, s: 0 }, inv.ammo || {}) },
      weapons: o.weapons || ['revolver', 'smg'],
      mag: { revolver: 6, smg: 30, shotgun: 2 },
      magMil: { revolver: false, smg: false, shotgun: false },
      cur: o.cur || 'revolver',
      mask: { integ: 100 },
      filterTime: DL.FILTER_TIME,
      battery: 100,
      milMode: false,
    };
  }

  const SHOP = (G) => [
    { name: '拳銃弾 ×6', desc: 'リボルバー「六連」用', price: 3, give: () => G.player.give('ammo_p', 6) },
    { name: '小銃弾 ×30', desc: '短機関銃「継ぎ接ぎ」用', price: 6, give: () => G.player.give('ammo_r', 30) },
    { name: 'ガスマスク用フィルター', desc: '1個で約100秒', price: 5, give: () => G.player.give('filter', 1) },
    { name: '医療キット', desc: '体力を大きく回復する [H]', price: 7, give: () => G.player.give('medkit', 1) },
    { name: 'パイプ爆弾', desc: '投げてから約2秒で爆発する [Q]', price: 5, give: () => G.player.give('bomb', 1) },
    { name: '散弾 ×6', desc: 'まだ持っていない銃の弾だ', price: 4, give: () => G.player.give('ammo_s', 6) },
  ];

  const tunnel = (o = {}) => Object.assign({ f: 0, c: 4.4, fm: 'gravel', wm: 'concrete', cm: 'ceiling' }, o);

  // ================= 第一章 月島 =================
  const ch1 = {
    num: '第一章　CHAPTER I', title: '月島', place: '月島駅（有楽町線）',
    w: 26, h: 48, flash: false,
    intro: [
      '二〇一九年の夏、東京の空が白く焼けた。人々はそれを「大閃光」と呼ぶ。',
      '二十年が過ぎた今も地上には灰が降り続け、変異した獣たちが街を歩いている。',
      '生き残った者たちは地下鉄の駅に逃げ込み、わずかな灯りを分け合って暮らしている。',
      '月島駅。隅田川の下にある、有楽町線の東の果ての小さな駅。',
      '僕の名はハル。この駅で生まれ、まだ一度も空を見たことがない。',
    ],
    env: { fog: 0x0a0907, density: 0.045, hemi: 0.16, hemiSky: 0x8a7a68, hemiGround: 0x1a1612, amb: 'station', reverb: 0.5, exposure: 1.2 },
    build(L) {
      const G = L.G;
      L.room(2, 6, 3, 33, { f: 0, c: 6.5, fm: 'gravel', wm: 'tile' });
      L.room(4, 6, 12, 33, { f: 1, c: 6.5, fm: 'platform', wm: 'tile' });
      L.room(2, 1, 3, 5, tunnel());
      L.room(2, 34, 5, 37, tunnel());
      L.room(4, 34, 5, 34, tunnel({ f: 0.75, fm: 'platform' }));
      L.room(4, 35, 5, 35, tunnel({ f: 0.5, fm: 'platform' }));
      L.room(4, 36, 5, 36, tunnel({ f: 0.25, fm: 'platform' }));
      L.room(2, 38, 3, 47, tunnel());
      L.room(14, 25, 19, 30, { f: 1, c: 4, fm: 'wood', wm: 'brick' });
      L.room(13, 27, 13, 27, { f: 1, c: 3, fm: 'platform', wm: 'tile' });
      L.room(14, 18, 18, 22, { f: 1, c: 3.6, fm: 'platform', wm: 'tileg' });
      L.room(13, 20, 13, 20, { f: 1, c: 3, fm: 'platform', wm: 'tile' });
      L.room(14, 8, 21, 14, { f: 1, c: 4.5, fm: 'platform', wm: 'brick' });
      L.room(13, 10, 13, 11, { f: 1, c: 3.2, fm: 'platform', wm: 'tile' });

      L.track(6, 2, 6, 96);
      L.tunnelDecor(4, 76, 8, 96, 'z');
      L.tunnelDecor(4, 2, 8, 11, 'z', { pipes: false });
      L.edge(8.16, 12, 68, 1);
      // 照明
      for (const z of [16, 26, 36, 46, 56, 66]) L.lamp('bulb', 17, 6.5, z, { cord: 1.8, intensity: 1.0, range: 11, flicker: z === 46 ? 0.25 : 0 });
      for (const z of [40, 52, 62]) L.lamp('bulb', 23, 6.5, z, { cord: 2.6, intensity: 0.55, range: 7, color: 0xffa860 });
      L.lamp('fire', 17, 1, 34, { campfire: true, intensity: 1.5, range: 9 });
      L.lamp('cage', 4.12, 3.2, 14, { face: F.E, color: 0xff4020, intensity: 1.1, range: 9, flicker: 0.15 });
      L.lamp('bulb', 34, 5, 56, { cord: 1.4, shade: true, intensity: 1.1, range: 9 });
      L.lamp('tube', 33, 4.6, 41, { color: 0xb8ffd0, intensity: 0.9, range: 8 });
      L.lamp('bulb', 34, 5.5, 20, { cord: 1.0, intensity: 1.0, range: 10 });
      L.lamp('bulb', 40, 5.5, 26, { cord: 1.0, intensity: 0.8, range: 9 });
      L.lamp('cage', 4.12, 2.6, 86, { face: F.E, intensity: 0.7, range: 9 });
      L.lamp('cage', 11.88, 2.6, 71, { face: F.W, intensity: 0.8, range: 8 });
      // 看板とポスター
      const signO = { line: '#7a6a4a', mark: '線', bg: '#1f2629' };
      L.sign('月島', 'TSUKISHIMA', 4.06, 3.6, 30, F.E, signO);
      L.sign('月島', 'TSUKISHIMA', 4.06, 3.6, 54, F.E, signO);
      L.sign('月島', 'TSUKISHIMA', 25.94, 3.6, 34, F.W, signO);
      L.sign('駅長室', 'STATION MASTER', 25.94, 3.3, 55, F.W, { w: 1.8, bg: '#3a2a20' });
      L.sign('無線室', 'RADIO', 25.94, 3.3, 41, F.W, { w: 1.8, bg: '#24352c' });
      L.sign('ゴロウの店', 'MARKET', 25.94, 3.6, 22, F.W, { w: 2.2, bg: '#4a3420' });
      L.poster(25.95, 2.2, 46, F.W, { title: '灯りを\n絶やすな', sub: '月島駅自警団', seed: 1 });
      L.poster(25.95, 2.2, 30, F.W, { title: '地上に\n出るな', sub: '放射能・ムクロ注意', seed: 2 });
      L.poster(25.95, 2.2, 62, F.W, { title: '配給は\n水曜日', sub: '食糧係', seed: 3 });
      L.poster(39.94, 2.6, 58, F.W, { title: '東京\n地下鉄網', sub: '二〇三九年 改訂', seed: 4 });
      // ホームの小道具
      L.prop('trainCar', 6, 23, { color: 0x4a4e44, stripe: 0x7a5a2a });
      L.prop('sandbags', 6, 11.6, { len: 4, rows: 4 });
      L.prop('barricade', 6, 10.7, { w: 4, h: 2.8 });
      L.prop('sandbags', 12, 13.4, { len: 6, rows: 3, seed: 2 });
      L.prop('mattress', 10.8, 26, { rot: 0 });
      L.prop('crate', 10.0, 23.6, { w: 0.6, h: 0.5, d: 0.6 });
      for (const [x, z, r] of [[23.5, 40, 0.1], [23.5, 47, -0.1], [23.6, 60, 0.05], [11, 50, 1.6], [11, 62, 1.5]]) L.prop('tent', x, z, { rot: r });
      L.prop('mattress', 21, 52);
      L.prop('mattress', 20, 64, { rot: 0.2 });
      L.prop('table', 20.8, 30, { rot: 0.3 });
      L.prop('chair', 19.8, 29.2, { rot: 0.2 });
      L.prop('crates', 24.5, 15, { seed: 3 });
      L.prop('crates', 9.6, 15, { seed: 5, n: 2 });
      L.prop('barrel', 25, 33);
      L.prop('barrel', 9, 66);
      L.prop('barrel', 24.8, 66.5);
      // 駅長室
      L.prop('desk', 35, 56, { rot: PI / 2 });
      L.prop('shelf', 39.5, 52, { rot: -PI / 2, seed: 2 });
      L.prop('chair', 36.6, 56, { rot: PI / 2 });
      L.prop('locker', 29, 61.4, { rot: PI });
      L.note(34.7, 55.2, '月島駅・記録簿', '十月一日\n豊洲側バリケードにムクロ七体。見張りのタケシが負傷。\n\n十月四日\nムクロ十一体。これで三晩続けて。\n群れは何かに追われるように、まっすぐこちらへ向かってくる。\n\n十月七日\n無線のシノが、毎晩同じ時刻に流れる信号を記録した。\n発信源は永田町と推定。\n評議会に問い合わせたが、返事はない。', { y: 1.86 });
      // 無線室
      L.prop('table', 36.8, 41, { rot: PI / 2, w: 2.2 });
      L.prop('radio', 36.8, 40.4, { y: 1.81, rot: PI / 2 });
      L.prop('radio', 36.8, 41.8, { y: 1.81, rot: PI / 2 });
      L.prop('chair', 35.2, 41, { rot: -PI / 2 });
      L.prop('shelf', 31, 45.3, { rot: PI, w: 1.4, seed: 7 });
      // 市場
      L.prop('table', 35, 23, { rot: PI / 2, w: 2.6 });
      L.prop('shelf', 43.4, 18.5, { rot: -PI / 2, seed: 4 });
      L.prop('shelf', 43.4, 25.5, { rot: -PI / 2, seed: 6 });
      L.prop('crates', 30, 28, { seed: 9 });
      L.prop('crates', 41, 15, { seed: 11, n: 2 });
      L.prop('barrel', 29.5, 17);
      // ゲート
      L.f.gate = L.prop('gate', 6, 76, { w: 4, h: 3.6 });
      L.prop('sandbags', 10, 70.2, { len: 3, rows: 2, seed: 4 });

      // ---- 人物 ----
      const busy = (h) => {
        if (h.busy) return true;
        h.busy = true;
        return false;
      };
      L.f.kuroda = L.npc({
        name: 'クロダ', x: 15, z: 27, yaw: Y.W, y: 1, look: LOOK.kuroda,
        talk: async (h) => {
          if (busy(h)) return;
          if (L.f.ready) {
            const c = await L.choose('クロダ「準備はいいか? ここを出たら、しばらく月島には戻れないぞ」', ['行こう', 'まだ準備がある']);
            if (c === 0) L.f.leave = true;
            else await L.say('クロダ', 'ゴロウの店は南東の扉だ。軍用弾で弾やフィルターが買える。');
          } else if (L.f.alarm) await L.say('クロダ', '話は後だ! ムクロを片付けろ!', 1.5);
          else if (!L.f.metMinami) await L.say('クロダ', '駅長室は東の壁の扉だ。ミナミ駅長を待たせるなよ。');
          else if (!L.f.tape) await L.say('クロダ', 'シノの無線室は、駅長室のひとつ南の扉だ。');
          h.busy = false;
        },
      });
      L.npc({
        name: 'ミナミ駅長', x: 36.6, z: 56, yaw: Y.W, y: 1, pose: 'sitdesk', look: LOOK.minami, turn: false, talkR: 3.2,
        talk: async (h) => {
          if (busy(h)) return;
          if (!L.f.metMinami) {
            await L.talk([
              ['ミナミ', '来たね、ハル。…座っておくれ。いや、立ったままでいい。時間がないんだ。'],
              ['ミナミ', 'この三週間、ムクロの群れが日に日に増えている。まるで何かに追い立てられているようにね。'],
              ['ミナミ', '無線室のシノが、妙な信号を拾った。毎晩同じ時刻に流れる、低い唸り声のような音だ。'],
              ['ミナミ', 'シノの計算では、発信源は永田町。評議会のある駅だよ。'],
              ['ハル', '永田町が…どうして?'],
              ['ミナミ', 'それを確かめてほしい。シノの録音テープを永田町まで届けて、評議会に信号を止めるよう頼むんだ。'],
              ['ハル', '僕が、永田町まで…?'],
              ['ミナミ', 'クロダが一緒に行く。お前の父さんも、あの人と同じモグリだった。…これは駅からの餞別だよ。'],
            ]);
            G.player.give('mil', 10);
            L.f.metMinami = true;
            L.objective('無線室でシノからテープを受け取る');
            L.hint('ゴロウの店（南東の扉）で、軍用弾と物資を交換できる');
          } else await L.say('ミナミ', '気をつけてお行き。月島の灯りを、絶やさないでおくれ。');
          h.busy = false;
        },
      });
      L.npc({
        name: 'シノ', x: 35.2, z: 41, yaw: Y.E, y: 1, pose: 'sitdesk', look: LOOK.shino, turn: false, talkR: 2.8,
        talk: async (h) => {
          if (busy(h)) return;
          if (!L.f.metMinami) await L.say('シノ', 'ハル? 先に駅長のところへ行って。大事な話があるんだって。');
          else if (!L.f.tape) {
            await L.say('シノ', 'ハル! 駅長から聞いたよ。…ちょっと、これを聞いてみて。');
            G.audio.signal(5, 0.6, h.pos);
            G.ui.sub('', '（低い唸りが、ゆっくりと脈を打つ）');
            await L.wait(4.6);
            await L.talk([
              ['シノ', 'ただの雑音じゃない。周波数がずっと一定なの。誰かが、わざと流してる。'],
              ['シノ', 'それに、信号が強い夜ほどムクロが押し寄せてくる。…偶然だと思う?'],
              ['シノ', 'テープはこれ。絶対に失くさないで。それと、これも。ガスマスク用のフィルター。'],
              ['シノ', '新富町から先は空気が悪いって噂だから。…ちゃんと帰ってきてよ。'],
            ]);
            G.player.give('filter', 1);
            G.ui.toast('録音テープを受け取った');
            L.f.tape = true;
          } else await L.say('シノ', 'ちゃんと帰ってきてよ。約束だからね。');
          h.busy = false;
        },
      });
      L.npc({
        name: 'ゴロウ', x: 36.6, z: 23, yaw: Y.W, y: 1, look: LOOK.goro, talkLabel: '取引する', talkR: 3.4,
        talk: () => {
          G.ui.bark('ゴロウ', 'いらっしゃい。払いは軍用弾だけだよ。');
          L.shop('ゴロウの店', SHOP(G));
        },
      });
      L.npc({
        name: 'ソウタ', x: 15.6, z: 35, yaw: DL.yawTo(1.4, -1), y: 1, pose: 'guitar', look: LOOK.sota, turn: false, talkLabel: '話を聞く',
        talk: async (h) => {
          if (busy(h)) return;
          const lines = [
            ['ソウタ', 'よう、ハル。…一曲聴いていくか?'],
            ['ソウタ', 'この歌はな、大閃光の前の歌なんだ。地上には海があって、夏には人が泳いでたらしい。'],
            ['ソウタ', '俺も見たことはない。親父が口ずさんでたのを、指が覚えてるだけさ。'],
            ['ソウタ', '歌ってのは不思議だよな。誰も覚えてない場所のことを、ちゃんと覚えてる。'],
            ['ソウタ', '行くんだろ、永田町。帰ってきたら地上の話を聞かせてくれよ。新しい歌にするから。'],
          ];
          let ok = true;
          for (const [n, t] of lines) {
            if (L.dist(h) > 6 || L.f.alarm) {
              ok = false;
              break;
            }
            await L.say(n, t);
          }
          if (ok && !G.flags.sota) G.flags.sota = true;
          h.busy = false;
        },
      });
      const yuki = L.npc({
        name: 'ユキ', x: 19.5, z: 45, yaw: Y.W, y: 1, look: LOOK.yuki,
        talk: async (h) => {
          if (L.f.yukiDone) {
            if (!h.busy) await L.say('ユキ', G.flags.yuki ? 'お守り、なくさないでね!' : '…');
            return;
          }
          if (busy(h)) return;
          await L.say('ユキ', 'ねえ、お兄ちゃん。軍用弾、一個だけちょうだい…? お母さんの薬と交換できるの。');
          const c = await L.choose('ユキに軍用弾を1発あげる?', ['軍用弾を1発あげる', '断る']);
          if (c === 0 && G.player.inv.mil > 0) {
            G.player.inv.mil--;
            G.flags.yuki = true;
            await L.say('ユキ', 'ありがとう! …これ、お守り。トンネルの神様が守ってくれるんだって。');
            G.ui.toast('ユキのお守りを受け取った');
          } else if (c === 0) await L.say('ユキ', '…持ってないの? そっか。');
          else await L.say('ユキ', '…そっか。ごめんね。');
          L.f.yukiDone = true;
          h.busy = false;
        },
      });
      yuki.mesh.scale.setScalar(0.68);
      L.f.guards = [
        L.npc({ name: '見張り', x: 11, z: 15.6, y: 1, yaw: Y.S, look: LOOK.guard, allyDmg: 9 }),
        L.npc({ name: '見張り', x: 19, z: 15.4, y: 1, yaw: Y.S, look: LOOK.guard, allyDmg: 9 }),
      ];
      L.f.gateGuard = L.npc({ name: '門番', x: 10.6, z: 74.4, yaw: Y.S, look: LOOK.guard, talk: async (h) => {
        if (busy(h)) return;
        await L.say('門番', L.f.ready ? 'クロダさんと一緒なら大丈夫だ。気をつけてな。' : 'ここから先は新富町へのトンネルだ。許可がなきゃ通せない。');
        h.busy = false;
      } });
      const sitters = [[13.2, 40, Y.E, 'sit'], [19.2, 37.5, DL.yawTo(-2, -3.5), 'sit'], [21, 52, Y.S, 'sleep'], [14, 58, Y.E, 'stand'], [22.4, 64, Y.W, 'sit'], [20.5, 32.4, Y.N, 'sit']];
      sitters.forEach(([x, z, yaw, pose], i) => L.npc({ name: ['住人', '老人', '眠っている男', '住人', '母親', '住人'][i], x, z, y: 1, yaw, pose, look: citizen(), armsPose: pose === 'stand' ? 'arms' : undefined, turn: false }));
      G.audio.startGuitar({ x: 15.6, y: 1.8, z: 35 }, 0.75);
    },
    stages: [
      {
        start: [12, 26, Y.E, false],
        async run(L) {
          await L.wait(1.2);
          await L.say('クロダ', 'ハル、起きたか。ミナミ駅長がお前を呼んでる。');
          await L.say('クロダ', '駅長室は東の壁の扉だ。…ゆうべも豊洲側のバリケードにムクロが来た。急げよ。');
          L.objective('駅長室でミナミ駅長と話す');
          L.hint('WASD 移動 ／ マウス 視点 ／ E 話す・調べる');
          await L.wait(4);
          L.hint('Tab 手帳 ／ Esc 一時停止');
          await L.until(() => L.f.tape);
        },
      },
      {
        start: [24, 41, Y.W, false],
        skip(L) {
          L.f.metMinami = true;
          L.f.tape = true;
        },
        async run(L) {
          const G = L.G;
          L.f.metMinami = true;
          L.f.tape = true;
          await L.wait(0.8);
          L.f.alarm = true;
          G.audio.alarm(9);
          await L.say('見張り', 'ムクロだ! 南のバリケードを越えてきたぞ!', 2.4);
          L.objective('ムクロを撃退する');
          L.hint('左クリック 撃つ ／ 右クリック 狙う ／ R リロード ／ 1・2 武器');
          const k = L.f.kuroda;
          k.teleport(17, 29, Y.S);
          k.o.allyDmg = 9;
          k.role = 'ally';
          for (const g of L.f.guards) g.role = 'ally';
          const w1 = [L.mutant('mukuro', 6, 13, { hunt: true }), L.mutant('mukuro', 7, 12.6, { hunt: true }), L.mutant('mukuro', 21, 13, { y: 1, hunt: true })];
          await Promise.race([L.wait(9), L.until(() => L.alive(w1) <= 1)]);
          G.audio.mutant('mukuro', { x: 6, y: 1, z: 8 }, 'screech');
          const w2 = [L.mutant('mukuro', 5, 12.6, { hunt: true }), L.mutant('mukuro', 7, 13.6, { hunt: true }), L.mutant('mukuro', 23, 12.8, { y: 1, hunt: true })];
          await L.allDead(w1.concat(w2));
          L.f.alarm = false;
          k.role = 'npc';
          for (const g of L.f.guards) g.role = 'npc';
          await L.wait(1.5);
          await L.say('クロダ', 'よくやった、ハル。…これだけの数が一度に来るなんて、やはり普通じゃない。');
          await L.say('クロダ', '北のゲートで待ってる。準備ができたら来い。ゴロウの店で弾を買っておけ。');
          L.objective('北ゲートでクロダと合流する');
          L.f.ready = true;
          await k.walk([[17, 60], [10.5, 66], [10.5, 71.5], [9.6, 73.2]], { speed: 3 });
          k.yaw = Y.S;
          await L.until(() => L.f.leave);
          await L.say('クロダ', '門を開けてくれ。');
          await L.say('門番', '気をつけてな、クロダさん。ハルも。…月島の灯りを頼んだぞ。');
          G.audio.clank({ x: 6, y: 1.5, z: 76 }, 0.9);
          await L.openDoor(L.f.gate, 3.3, 2.4);
          L.objective('クロダについて新富町へ向かう');
          k.walk([[6, 79], [6, 90]], { speed: 2.6 });
          await L.until(() => L.P.pos.z > 82);
          await L.end();
        },
      },
    ],
  };

  // ================= 第二章 残響 =================
  const ch2 = {
    num: '第二章　CHAPTER II', title: '残響', place: '月島 ― 新富町間トンネル',
    w: 22, h: 64, flash: true,
    kit: kit({ inv: { mil: 18, filter: 2 } }),
    intro: [
      '月島を出るのは初めてじゃない。けれど、こんなに遠くへ行くのは初めてだった。',
      'トンネルは、どこまでも続く生き物の腸のようだ。',
      'クロダは言った。トンネルでは耳を信じろ。目は嘘をつく、と。',
    ],
    env: { fog: 0x040506, density: 0.06, hemi: 0.05, amb: 'tunnel', reverb: 0.75, exposure: 1.25 },
    build(L) {
      const G = L.G;
      L.room(5, 0, 6, 22, tunnel());
      L.room(7, 10, 7, 10, tunnel({ c: 2.8, fm: 'concrete' }));
      L.room(8, 8, 10, 11, tunnel({ c: 3, fm: 'concrete', wm: 'brick' }));
      L.room(5, 21, 18, 22, tunnel());
      L.room(17, 21, 18, 63, tunnel());
      L.track(12, 0, 12, 44);
      L.track(12, 44, 36, 44);
      L.track(36, 44, 36, 128);
      L.tunnelDecor(10, 0, 14, 42, 'z');
      L.tunnelDecor(14, 42, 34, 46, 'x');
      L.tunnelDecor(34, 46, 38, 128, 'z');
      L.lamp('cage', 10.12, 2.8, 8, { face: F.E, intensity: 0.8, range: 10 });
      L.lamp('cage', 13.88, 2.8, 28, { face: F.W, intensity: 0.7, range: 9, flicker: 0.4 });
      L.lamp('bulb', 19, 3, 19.5, { cord: 0.5, intensity: 0.8, range: 7 });
      L.lamp('cage', 24, 2.8, 42.12, { face: F.N, intensity: 0.7, range: 10 });
      L.lamp('cage', 34.12, 2.8, 50, { face: F.E, intensity: 0.6, range: 9 });
      L.lamp('cage', 37.88, 2.8, 84, { face: F.W, intensity: 0.6, range: 9 });
      L.f.echoLamps = [
        L.lamp('cage', 34.12, 2.8, 96, { face: F.E, intensity: 0.7, range: 10 }),
        L.lamp('cage', 37.88, 2.8, 106, { face: F.W, intensity: 0.7, range: 10 }),
        L.lamp('cage', 34.12, 2.8, 116, { face: F.E, intensity: 0.6, range: 10 }),
      ];
      L.lamp('cage', 37.88, 2.6, 126.5, { face: F.W, intensity: 1.0, range: 12, color: 0xd8f0a0 });
      // 列車
      L.prop('trainCar', 36, 61, { color: 0x5a5e58, stripe: 0x8a6a2a });
      L.prop('crate', 36, 51.3, { w: 1.2, h: 0.5, d: 0.8 });
      L.prop('crate', 36, 70.7, { w: 1.2, h: 0.5, d: 0.8 });
      L.prop('corpse', 35.4, 58, { y: 1.0, rot: 0.6 });
      L.prop('corpse', 36.6, 65, { y: 1.0, rot: 2.6, hat: 'cap' });
      L.prop('bones', 36, 62, { y: 1.0, n: 5 });
      L.note(36.4, 56, '乗客の手帳', '八月十四日\n電車が止まって三時間。冷房も照明も消えた。\n車掌さんは「もうすぐ動きます」と言うけれど、誰も信じていない。\n\n地上で何かがあったらしい。\nトンネルの先の方から、熱い風が吹いてくる。\n\n息子が「まっくらだね」と言う。\n大丈夫、すぐに明るくなるよ、と私は答えた。', { y: 1.02 });
      L.pickup('ammo_p', 6, 35.2, 63, 1.47);
      L.pickup('mil', 3, 36.8, 54, 1.47);
      // 保守室
      L.prop('shelf', 21.4, 18, { rot: -PI / 2, seed: 3 });
      L.prop('crates', 17.5, 22.5, { seed: 6, n: 2 });
      L.prop('table', 18.2, 16.8, {});
      L.pickup('ammo_r', 20, 17.8, 16.8, 0.82);
      L.pickup('filter', 1, 21, 22.6);
      L.pickup('ammo_p', 6, 18.5, 17.2, 0.82);
      L.prop('barrel', 13, 34);
      L.prop('crates', 30, 45.2, { seed: 13, n: 2 });
      L.prop('rubble', 13, 12, { w: 1.6, d: 2, h: 0.7, seed: 4 });
      L.prop('corpse', 11, 38, { rot: 1.2, mask: true, pack: true });
      L.pickup('ammo_r', 15, 11.4, 38.6);
      L.pickup('bomb', 1, 37, 90);
      L.pickup('medkit', 1, 35, 101);
      L.poster(14.0 - 0.05, 2.0, 20, F.W, { title: '保守\n通路', sub: '関係者以外立入禁止', seed: 5 });
      // 旅人
      L.npc({
        name: '傷ついた旅人', x: 20, z: 20.5, yaw: Y.W, pose: 'floor', look: LOOK.traveler, talkLabel: '話しかける',
        talk: async (h) => {
          if (h.busy) return;
          h.busy = true;
          if (L.f.travelerDone) {
            await L.say('旅人', G.flags.traveler ? '…あんたのことは忘れないよ。' : '…行ってくれ。');
            h.busy = false;
            return;
          }
          await L.say('旅人', '頼む…足をやられた。医療キットを…ひとつ分けてくれないか…');
          const c = await L.choose('旅人に医療キットを渡す?', ['医療キットを渡す', '立ち去る']);
          if (c === 0 && G.player.inv.medkit > 0) {
            G.player.inv.medkit--;
            G.flags.traveler = true;
            await L.say('旅人', '恩に着る…。これを持っていけ。新富町で拾った軍用弾だ。');
            G.player.give('mil', 8);
            await L.say('旅人', 'それと…気をつけろ。新富町は、もう人のいる駅じゃない。');
          } else if (c === 0) await L.say('旅人', '…持ってないのか。そうか…。');
          else await L.say('旅人', '…そうか。そうだよな。');
          L.f.travelerDone = true;
          h.busy = false;
        },
      });
      L.f.kuroda = L.ally({ name: 'クロダ', x: 12, z: 7, yaw: Y.N, look: LOOK.kuroda, allyDmg: 12 });
    },
    stages: [
      {
        start: [12, 3, Y.N, true],
        async run(L) {
          const G = L.G, k = L.f.kuroda;
          await L.wait(1);
          L.objective('クロダと共に新富町を目指す');
          const w1 = k.walk([[12, 14]], { waitFor: 10, speed: 2.6 });
          await L.say('クロダ', 'ライトは節約しろ。電池が切れたら、手回しで充電だ。その間は銃を撃てないがな。');
          L.hint('F ライト ／ T 長押しで充電');
          await w1;
          await L.say('クロダ', 'トンネルでは耳を信じろ。目は嘘をつく。');
          await L.say('クロダ', '右手に保守室がある。使えるものがあれば拾っておけ。');
          await k.walk([[12, 30]], { waitFor: 10, speed: 2.6 });
          await L.until(() => L.P.pos.z > 24 || L.P.pos.x > 16);
          await L.say('クロダ', '…静かに。何か来る。');
          const pack = [L.mutant('mukuro', 24, 44, { hunt: true }), L.mutant('mukuro', 28, 43.5, { hunt: true }), L.mutant('mukuro', 31, 45, { hunt: true })];
          G.audio.mutant('mukuro', { x: 26, y: 1, z: 44 }, 'screech');
          await L.allDead(pack);
          await L.wait(0.8);
          await L.say('クロダ', 'まだ若い群れだ。…何かに追われて、巣を捨てて来てる。');
          await k.walk([[12.6, 43], [30, 44], [36, 47], [36, 49.6]], { waitFor: 11, speed: 2.8 });
          await L.until(() => L.P.pos.x > 30);
          await L.say('クロダ', '列車か。…あの日から、ずっとここに止まってるんだろう。');
          await L.say('クロダ', '中を抜けるしかなさそうだ。先に行け、ハル。後ろは俺が見る。');
          L.objective('列車の中を抜ける');
          await L.until(() => L.P.pos.z > 73);
          k.walk([[36, 73.4]], { speed: 2.4 });
          await L.until(() => L.P.pos.z > 83);
          if (k.pos.z > 75) k.teleport(36, 73.5, Y.N);
          L.collapse(17, 38, 18, 39);
          await L.wait(2.2);
          await L.say('ハル', 'クロダさん!');
          G.audio.radio(1.2);
          await L.say('クロダ', '（瓦礫の向こうから）…ハル! 無事か!?');
          await L.say('クロダ', 'こっちは塞がれた。俺は別の道を探す。お前は先に新富町へ行け!');
          await L.say('クロダ', '永田町で会おう。…止まるなよ、ハル!');
          k.remove();
        },
      },
      {
        start: [36, 87, Y.N, true],
        skip(L) {
          L.collapse(17, 38, 18, 39, false);
          L.f.kuroda.remove();
        },
        async run(L) {
          const G = L.G, P = G.player;
          L.objective('ひとりで新富町駅を目指す');
          await L.until(() => L.P.pos.z > 95);
          // ---- 残響 ----
          P.flashLock = true;
          P.flash.on = false;
          G.audio.click(0.5, 3000);
          for (const lp of L.f.echoLamps) lp.flicker = 0.85;
          G.audio.whisper(7, 0.7);
          await L.wait(1.6);
          const ghosts = [];
          const spots = [[35, 106, 'stand'], [37.2, 108, 'floor'], [34.8, 111, 'stand'], [36.4, 113, 'stand'], [37.3, 116, 'floor'], [35.5, 118, 'stand'], [36.6, 120, 'stand']];
          for (const [x, z, pose] of spots) ghosts.push(L.ghost({ x, z, yaw: Y.S, pose, look: ghostLook() }));
          ghosts.push(L.ghost({ x: 36.1, z: 109.5, yaw: Y.S, scale: 0.62, look: { model: 'yuki', hair: 0x222222 } }));
          await L.wait(2.4);
          await L.say('？？？', '…まだ、動かないの?', 2.2);
          await L.say('？？？', '…電気、つかないね。', 2.2);
          ghosts.forEach((g, i) => {
            if (i % 2) g.walk([[g.pos.x, g.pos.z + 10]], { speed: 0.6 });
          });
          const tr = { z: 133 };
          const grp = new T.Group();
          for (const sx of [-0.7, 0.7]) {
            const s = new T.Sprite(new T.SpriteMaterial({ map: DL.tex('glow'), color: 0xeef4ff, transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
            s.position.set(sx, 0, 0);
            s.scale.set(2.2, 2.2, 2.2);
            grp.add(s);
          }
          L.add(grp);
          const lamp = { x: 36, y: 2, z: tr.z, color: 0xe8f0ff, intensity: 4, range: 34, on: true, broken: false, _f: 1, priority: 60, transient: true };
          G.lamps.push(lamp);
          G.audio.ghostTrain(6);
          L.tickers.push((dt) => {
            tr.z -= dt * (tr.z > 125 ? 8 : 26);
            grp.position.set(36, 1.8, tr.z);
            lamp.z = tr.z - 1;
            lamp.intensity = 4 + Math.random();
            return tr.z > 40;
          });
          await L.until(() => tr.z < P.pos.z + 2);
          G.ui.whiteFlash(1);
          P.shake(0.9);
          ghosts.forEach((g) => g.remove());
          await L.until(() => tr.z < P.pos.z - 25);
          L.G.scene.remove(grp);
          const i = G.lamps.indexOf(lamp);
          if (i >= 0) G.lamps.splice(i, 1);
          for (const lp of L.f.echoLamps) lp.flicker = 0.1;
          G.breakLamp(L.f.echoLamps[1]);
          await L.wait(1.4);
          await L.say('子どもの声', '…おかあさん。まっくらだよ。', 3.2);
          await L.wait(0.8);
          P.flashLock = false;
          P.flash.on = true;
          G.audio.click(0.5, 3000);
          await L.say('ハル', '…今のは、何だったんだ…?');
          await L.say('ハル', '（クロダさんが言ってた。トンネルでは、目は嘘をつく…）');
          const pack = [L.mutant('mukuro', 36, 124, { hunt: true }), L.mutant('mukuro', 35, 122, { hunt: true }), L.mutant('mukuro', 37, 125.5, { hunt: true }), L.mutant('mukuro', 36, 119, { hunt: true })];
          G.audio.mutant('mukuro', { x: 36, y: 1, z: 124 }, 'screech');
          L.objective('新富町駅を目指す');
          await L.until(() => L.P.pos.z > 121);
          await L.say('ハル', '新富町の入口だ…灯りがひとつも見えない。');
          await L.end();
        },
      },
    ],
  };

  // ================= 第三章 瘴気 =================
  const ch3 = {
    num: '第三章　CHAPTER III', title: '瘴気', place: '新富町駅',
    w: 24, h: 60, flash: true,
    kit: kit({ inv: { mil: 22, filter: 3, medkit: 2 } }),
    intro: [
      '新富町。かつて二百人が暮らしていた駅だ。',
      '今は誰もいない。灯りも、声も、生活の匂いさえも。',
      'ただ緑色の霧だけが、ホームを満たしていた。',
    ],
    env: { fog: 0x060705, density: 0.055, hemi: 0.05, amb: 'tunnel', reverb: 0.7, exposure: 1.25, gasFog: 0x18200e },
    build(L) {
      const G = L.G;
      L.room(3, 0, 4, 9, tunnel());
      L.room(3, 10, 4, 37, { f: 0, c: 6.5, fm: 'gravel', wm: 'tileg' });
      L.room(5, 10, 10, 37, { f: 1, c: 6.5, fm: 'platform', wm: 'tileg' });
      L.room(11, 10, 12, 37, { f: 0, c: 6.5, fm: 'gravel', wm: 'tileg' });
      L.room(13, 32, 13, 32, { f: 0, c: 2.8, fm: 'concrete', wm: 'metal' });
      L.room(14, 30, 18, 34, { f: 0, c: 3.4, fm: 'metal', wm: 'metal' });
      L.room(6, 38, 9, 49, { f: (x, z) => 1 + (z - 37) * 0.5, c: (x, z) => 1 + (z - 37) * 0.5 + 3.6, fm: 'metal', wm: 'tileg' });
      L.room(4, 50, 11, 57, { f: 7, c: 10.6, fm: 'platform', wm: 'tileg' });
      L.room(11, 38, 12, 47, tunnel({ fm: 'rubble' }));
      L.track(8, 0, 8, 76);
      L.track(24, 20, 24, 96);
      L.tunnelDecor(6, 0, 10, 20, 'z');
      L.tunnelDecor(22, 76, 26, 96, 'z', { pipes: false });
      L.edge(10.16, 20, 76, 1);
      L.edge(21.84, 20, 76, 1);
      // 照明（発電機で点く）
      L.f.hallLamps = [26, 36, 46, 56, 66].map((z) => L.lamp('bulb', 16, 6.5, z, { cord: 1.6, intensity: 1.0, range: 12, on: false }));
      L.f.hallLamps.push(L.lamp('bulb', 16, 10.6, 108, { cord: 1, intensity: 1, range: 12, on: false }));
      L.lamp('cage', 25.88, 2.6, 60, { face: F.W, color: 0xff3018, intensity: 0.9, range: 8, flicker: 0.3 });
      L.lamp('bulb', 33, 3.4, 65, { cord: 0.4, intensity: 0.7, range: 8, flicker: 0.2 });
      L.lamp('cage', 6.12, 2.6, 10, { face: F.E, intensity: 0.5, range: 8 });
      L.lamp('tube', 16, 10.6, 104, { intensity: 0.6, range: 10, flicker: 0.4 });
      // ガス
      L.gas(4, 22, 26, 76, {});
      L.gas(22, 76, 26, 96, {});
      // 看板
      const signO = { line: '#7a6a4a', mark: '線', bg: '#1f2629' };
      L.sign('新富町', 'SHINTOMICHO', 6.06, 3.6, 34, F.E, signO);
      L.sign('新富町', 'SHINTOMICHO', 25.94, 3.6, 50, F.W, signO);
      L.sign('出口　地上へ', 'EXIT', 16, 6.0, 75.9, F.S, { w: 2.4, bg: '#2a3a2a' });
      L.poster(6.05, 2.4, 44, F.E, { title: '新富町\n自治会', sub: '夜間の外出禁止', seed: 7 });
      L.poster(25.95, 2.4, 40, F.W, { title: '音に\n注意', sub: 'ムクロは音に寄る', seed: 8 });
      // シャッター
      L.f.shutter = L.prop('shutter', 16, 76, { w: 8, h: 3.7, y: 1 });
      // 発電機室
      L.f.genProp = L.prop('generator', 34, 61.4, {});
      L.prop('table', 35, 68.4, {});
      L.prop('shelf', 29, 69.4, { rot: PI, seed: 9, w: 1.4 });
      L.pickup('shotgun', 1, 35, 68.4, 0.82);
      L.pickup('ammo_s', 6, 34.2, 68.6, 0.82);
      L.pickup('filter', 1, 30.5, 61);
      L.note(35.6, 68.2, '無線記録（新富町）', '十月二日\n永田町へ救援を要請。返答は「待機せよ」のみ。\n\n十月五日\n再度要請。返答なし。\n\n十月六日\nガス管が割れた。地下水の汚染がひどい。\n待機して、いったい何を待てというのか。', { y: 0.83 });
      // ホーム
      for (const [x, z, r] of [[12, 30, 1.6], [12, 40, 1.5], [19, 52, -1.5], [12, 60, 1.6]]) L.prop('tent', x, z, { rot: r, color: 0x3a3e32 });
      L.prop('corpse', 13.5, 33, { y: 1, rot: 0.4, mask: true });
      L.prop('corpse', 18.6, 44, { y: 1, rot: 2.1 });
      L.prop('corpse', 14, 62.5, { y: 1, rot: -0.8, mask: true, pack: true });
      L.prop('bones', 20, 70, { y: 1, n: 8, skulls: 2 });
      L.prop('crates', 19.5, 27, { seed: 14 });
      L.prop('barrel', 20.5, 36);
      L.prop('barrel', 11.2, 70);
      L.prop('mattress', 15, 50, { rot: 0.3 });
      L.prop('table', 17, 56, { rot: 0.5 });
      L.pickup('filter', 1, 14.2, 50.5);
      L.pickup('mask', 1, 13.2, 33.6);
      L.pickup('medkit', 1, 20, 30);
      L.pickup('ammo_p', 6, 17, 56, 1.82);
      L.pickup('ammo_r', 20, 9, 16);
      L.pickup('filter', 1, 8.6, 6);
      L.note(16, 50.6, '新富町駅・駅長日誌', '十月三日\nまた「あの音」が始まった。夜になると、低い唸りがトンネルの奥から聞こえてくる。\n\nムクロどもは音から逃げるように、こちらへ押し寄せてくる。\nまるで、何かに追われる羊の群れだ。\n\n誰かが言った。あれは永田町の方角から来る音だ、と。', { y: 1 });
      L.note(23, 77, '誰かの走り書き', 'ガス管が割れた。もうこの駅はだめだ。\n\n上の出口から地上へ逃げる。\n\nサオリ、ケン。銀座で待っていてくれ。必ず行く。');
      // 巣
      L.prop('bones', 24, 84, { n: 12, skulls: 3, seed: 3 });
      L.prop('bones', 23.5, 91, { n: 10, skulls: 2, seed: 5 });
      L.prop('cocoon', 25, 88);
      L.prop('cocoon', 23, 93);
      L.prop('rubble', 24, 95, { w: 4, d: 2, h: 2, seed: 9 });
      // 変異体（徘徊）
      L.mutant('mukuro', 16, 44, { y: 1 });
      L.mutant('mukuro', 13, 58, { y: 1 });
      L.mutant('mukuro', 24, 40, { state: 'sleep' });
      // 発電機
      L.interact({
        pos: { x: 34, y: 0.9, z: 61.4 }, r: 2.3, label: '発電機を始動する', name: '',
        enabled: () => !L.f.genOn,
        onUse: () => {
          L.f.genOn = true;
        },
      });
    },
    stages: [
      {
        start: [8, 3, Y.N, true],
        async run(L) {
          await L.wait(1);
          await L.say('ハル', '新富町…。誰か、いませんか…?');
          L.objective('新富町駅を抜けて先へ進む');
          await L.until(() => L.P.pos.z > 17);
          await L.say('ハル', '…ひどい匂いだ。マスクをつけないと。');
          L.hint('G ガスマスク ／ 腕時計の数字がフィルターの残り時間');
          await L.until(() => L.inZone(10, 64, 22, 76) || L.f.genOn);
          if (!L.f.genOn) {
            await L.say('ハル', 'シャッターが下りてる…。どこかに電源があるはずだ。');
            L.objective('発電機を探してシャッターを開ける');
            L.hint('東側の線路の奥に、赤いランプの扉がある');
          }
          await L.until(() => L.f.genOn);
        },
      },
      {
        start: [31, 65, Y.W, true],
        async run(L) {
          const G = L.G;
          L.f.genOn = true;
          const eng = G.audio.engine({ x: 34, y: 1, z: 61.4 });
          void eng;
          G.audio.clank({ x: 34, y: 1, z: 61 }, 0.8);
          await L.wait(1.2);
          for (const lp of L.f.hallLamps) {
            lp.on = true;
            lp.flicker = 0.5;
          }
          G.audio.click(0.6, 900);
          await L.wait(0.6);
          for (const lp of L.f.hallLamps) lp.flicker = 0.05;
          await L.say('ハル', '動いた…! でも、この音じゃ…', 2);
          G.audio.mutant('mukuro', { x: 24, y: 1, z: 90 }, 'screech');
          const total = 52;
          const t0 = G.time;
          let left = total;
          L.objective(`シャッターが開くまで持ちこたえる（あと${total}秒）`);
          L.hint('東の線路の奥に、ムクロの巣がある');
          L.tickers.push(() => {
            const r = Math.max(0, Math.ceil(total - (G.time - t0)));
            if (r !== left && r % 10 === 0 && r > 0) L.objective(`シャッターが開くまで持ちこたえる（あと${r}秒）`);
            left = r;
            return r > 0;
          });
          const all = [];
          all.push(L.mutant('mukuro', 24, 90, { hunt: true }), L.mutant('mukuro', 23.4, 93, { hunt: true }), L.mutant('mukuro', 24.6, 86, { hunt: true }));
          await L.wait(13);
          all.push(L.mutant('mukuro', 8, 6, { hunt: true }), L.mutant('mukuro', 7.5, 9, { hunt: true }), L.mutant('mukuro', 8.5, 3, { hunt: true }));
          await L.wait(9);
          G.audio.mutant('nushi', { x: 24, y: 1, z: 94 }, 'roar');
          G.player.shake(0.4);
          await L.wait(1.5);
          const boss = L.mutant('nushi', 24, 93, { hunt: true });
          all.push(boss, L.mutant('mukuro', 23.4, 89, { hunt: true }));
          await L.say('ハル', '何だ、あれは…!', 1.6);
          L.hint('大物は突進のあと壁にぶつかると動きが止まる。そこが狙い目だ');
          await L.wait(11);
          all.push(L.mutant('mukuro', 24, 92, { hunt: true }), L.mutant('mukuro', 23.5, 88, { hunt: true }), L.mutant('mukuro', 8, 5, { hunt: true }));
          await L.until(() => G.time - t0 >= total);
          G.audio.clank({ x: 16, y: 2, z: 76 }, 1);
          L.objective('エスカレーターを上って地上へ');
          await L.openDoor(L.f.shutter, 3.6, 3.5);
          await L.until(() => L.P.pos.z > 103);
          await L.say('ハル', '地上への階段だ…。この先に、空がある。');
          await L.end();
        },
      },
    ],
  };

  // ================= 第四章 灰の空 =================
  const ch4 = {
    num: '第四章　CHAPTER IV', title: '灰の空', place: '銀座（地上）',
    w: 60, h: 80, flash: false,
    kit: kit({ weapons: ['revolver', 'smg', 'shotgun'], inv: { mil: 26, filter: 2, ammo: { s: 10 } } }),
    intro: [
      '階段の先に、空があった。',
      '灰色で、重たくて、どこまでも続いていた。',
      '父さんが見ていた空も、こんな色だったのだろうか。',
    ],
    env: { fog: 0x5e605f, bg: 0x6a6c6b, density: 0.024, hemi: 0.5, hemiSky: 0xa8acae, hemiGround: 0x34302c, sun: 0.32, amb: 'surface', reverb: 0.12, exposure: 1.0, outdoor: true, ash: true, rad: 1 },
    build(L) {
      const G = L.G;
      const h = (x, z) => {
        const a = Math.sin(Math.floor(x / 3) * 12.9898 + Math.floor(z / 3) * 78.233) * 43758.5453;
        return 10 + (a - Math.floor(a)) * 26;
      };
      L.solid(0, 0, 59, 79, { top: h, wm: 'facade' });
      const sky = { sky: true, f: 0, fm: 'asphalt', wm: 'facade' };
      L.room(6, 5, 54, 9, sky);
      L.room(24, 5, 31, 75, sky);
      L.room(6, 30, 54, 34, sky);
      L.room(10, 52, 50, 56, sky);
      L.room(44, 9, 46, 30, sky);
      L.room(12, 34, 14, 52, sky);
      // 歩道
      L.room(24, 10, 24, 29, Object.assign({}, sky, { f: 0.15, fm: 'platform' }));
      L.room(31, 10, 31, 29, Object.assign({}, sky, { f: 0.15, fm: 'platform' }));
      L.room(24, 35, 24, 51, Object.assign({}, sky, { f: 0.15, fm: 'platform' }));
      L.room(31, 35, 31, 51, Object.assign({}, sky, { f: 0.15, fm: 'platform' }));
      // 新富町側の出口（スタート）
      L.room(48, 2, 50, 4, { f: 0, c: 3.2, fm: 'platform', wm: 'concrete' });
      // 母獣の巣（崩れた店）
      L.room(16, 26, 20, 29, { f: 0, c: 4.5, fm: 'rubble', wm: 'brick' });
      // 銀座一丁目駅入口
      L.room(32, 66, 33, 68, { f: 0, c: 3.2, fm: 'platform', wm: 'tileo' });
      L.room(34, 67, 39, 67, { f: (x) => -(x - 33) * 0.5, c: (x) => -(x - 33) * 0.5 + 3.2, fm: 'platform', wm: 'tileo' });
      // 時計塔
      L.solid(32, 35, 37, 40, { top: 16, wm: 'facade' });
      L.prop('clockTower', 70, 76, { y: 16, noCol: true });
      // 大通りを塞ぐ瓦礫
      L.prop('rubble', 56, 87, { w: 16, d: 14, h: 4.5, seed: 31, n: 70, solid: true, rebar: true });
      L.prop('bus', 52, 85, { rot: 0.5, noCol: true });
      // 車・柱・木
      const cars = [[86, 15, 1.6], [72, 13, 1.4], [40, 16, 1.5], [52, 24, 0.1], [61, 38, 3.0], [58, 52, 0.3], [20, 62, 1.6], [100, 66, 1.5], [27, 80, 0.05], [44, 109, 1.5], [55, 120, 3.1], [61, 132, 0.2], [91, 40, 0.0]];
      cars.forEach(([x, z, r], i) => L.prop('car', x, z, { rot: r, seed: i }));
      L.prop('bus', 30, 64, { rot: 1.62 });
      for (const [x, z] of [[49, 30], [63, 46], [49, 58], [63, 100], [49, 120], [63, 138]]) L.prop('tree', x, z, { seed: x + z });
      for (const [x, z, f] of [[49.5, 16, false], [62.5, 26, true], [49.5, 44, false], [62.5, 60, false], [49.5, 100, true], [62.5, 118, false]]) L.prop('pole', x, z, { fallen: f, rot: f ? 0.4 : x < 56 ? 0 : PI });
      L.prop('rubble', 18, 14, { w: 4, d: 4, h: 1.5, seed: 2 });
      L.prop('rubble', 106, 18, { w: 4, d: 3, h: 1.2, seed: 5 });
      L.prop('rubble', 44, 66, { w: 3, d: 3, h: 1.2, seed: 8 });
      L.prop('rubble', 28, 96, { w: 3, d: 4, h: 1.6, seed: 11 });
      L.prop('rubble', 36, 56, { w: 4, d: 3, h: 1.8, seed: 13 });
      L.prop('barricade', 24, 64, { w: 5, h: 2, rot: 0.1 });
      // 横断歩道
      for (let i = 0; i < 7; i++) {
        L.box(1.2, 0.02, 4, 0x7c7a74, 50 + i * 2, 0.012, 58, { rough: 1 });
        L.box(4, 0.02, 1.2, 0x7c7a74, 46, 0.012, 61 + i * 1.3, { rough: 1 });
      }
      L.sign('銀座四丁目', 'GINZA 4-CHOME', 64.2, 4.5, 56, F.N, { w: 3.6, bg: '#2a3a52' });
      L.sign('銀座一丁目駅 →', 'GINZA-ITCHOME STA. NORTH', 47.8, 3.2, 100, F.E, { w: 3.4, bg: '#2a3a52' });
      L.sign('銀座一丁目', 'GINZA-ITCHOME', 64.8, 4.2, 135, F.W, { w: 3.0, bg: '#6a3a1a', line: '#7a6a4a', mark: '線' });
      L.sign('新富町', 'SHINTOMICHO', 99, 3.6, 10.2, F.N, { w: 2.6, bg: '#1f2629', line: '#7a6a4a', mark: '線' });
      // 拾得物
      L.pickup('filter', 1, 97.5, 7.5);
      L.pickup('filter', 1, 72, 15.6);
      L.pickup('ammo_s', 6, 88, 17.4);
      L.pickup('filter', 1, 54, 60);
      L.pickup('filter', 1, 38, 57);
      L.pickup('medkit', 1, 39.5, 54.5);
      L.pickup('filter', 1, 27, 90);
      L.pickup('ammo_r', 20, 25.5, 92);
      L.pickup('bomb', 1, 40, 108);
      L.pickup('ammo_p', 6, 60, 128);
      L.note(98, 9, '新富町の住人の書き置き', '地上の空気は毒だ。マスクを外すな。\n\nフィルターは車の中や、崩れた店に残っていることがある。\n\n犬のような獣が群れで動いている。\n大通りの北は瓦礫で塞がっている。西の路地を抜けろ。');
      // 母獣と仔
      L.f.mother = L.mutant('haha', 37, 55.4, { yaw: Y.N });
      L.f.pups = [L.mutant('pup', 34.6, 54.2), L.mutant('pup', 39.4, 54), L.mutant('pup', 36.6, 53.2)];
      L.onDeath = (e) => {
        if ((e === L.f.mother || L.f.pups.includes(e)) && !G.flags.killedMother) G.flags.killedMother = true;
      };
    },
    stages: [
      {
        start: [99, 6.5, Y.N, false],
        async run(L) {
          const G = L.G;
          await L.wait(1.5);
          await L.say('ハル', 'これが…空か。');
          await L.wait(1);
          await L.say('ハル', '灰色で、重たくて…。どこまでも続いてる。');
          L.objective('銀座一丁目駅の入口を探す（北）');
          L.hint('地上の空気は汚染されている。G でガスマスクを着ける');
          await L.until(() => G.player.pos.x < 82 || G.player.pos.z > 24);
          const p1 = [L.mutant('hagure', 56, 30, { hunt: true }), L.mutant('hagure', 60, 34, { hunt: true }), L.mutant('hagure', 52, 27, { hunt: true })];
          G.audio.mutant('hagure', { x: 56, y: 1, z: 30 }, 'screech');
          await L.until(() => G.player.pos.z > 56);
          // 無線
          G.audio.radio(2);
          await L.say('無線', '（ザッ…）…ル…ハル、聞こえるか…', 2.4);
          await L.say('ハル', 'クロダさん!? 生きてたんだ…!');
          G.audio.radio(1.2);
          await L.say('クロダ', '（ザザッ）…古い保守通路を見つけた…有楽町の手前で…', 2.6);
          await L.say('クロダ', '…銀座一丁目は、赤環の縄張りだ…。灯りを…避けろ…（ザッ）', 3);
          await L.say('クロダ', '…永田町で会おう…', 2);
          // 頭上を巨大な影が横切る
          const bird = new T.Group();
          const wm = new T.MeshBasicMaterial({ color: 0x1a1816, side: T.DoubleSide });
          const wg = new T.BufferGeometry();
          wg.setAttribute('position', new T.Float32BufferAttribute([0, 0, -2, 0, 0, 3, -9, 0.6, 1, 0, 0, -2, 9, 0.6, 1, 0, 0, 3], 3));
          bird.add(new T.Mesh(wg, wm));
          L.add(bird);
          const b0 = G.time;
          G.audio.mutant('hagure', { x: 50, y: 30, z: 66 }, 'screech');
          L.tickers.push(() => {
            const k = (G.time - b0) / 5;
            bird.position.set(-10 + k * 150, 34 - k * 6, 40 + k * 50);
            bird.rotation.y = -0.9;
            bird.rotation.z = Math.sin(G.time * 4) * 0.25;
            if (k >= 1) {
              G.scene.remove(bird);
              return false;
            }
            return true;
          });
          await L.wait(2);
          await L.say('ハル', '…何だ、今の影は。');
          const p2 = [L.mutant('hagure', 100, 64, { hunt: true }), L.mutant('hagure', 104, 66, { hunt: true }), L.mutant('hagure', 96, 62, { hunt: true })];
          G.audio.mutant('hagure', { x: 100, y: 1, z: 64 }, 'screech');
          await L.until(() => G.player.pos.z > 74 || L.alive(p2) === 0);
          await L.until(() => G.player.pos.z > 100);
          if (L.f.mother.alive && !L.f.mother.provoked && !G.flags.killedMother) G.flags.mother = true;
          const p3 = [L.mutant('hagure', 56, 122, { hunt: true }), L.mutant('hagure', 58, 126, { hunt: true })];
          void p3;
          await L.until(() => G.player.pos.z > 126 && G.player.pos.x > 56);
          await L.say('ハル', '銀座一丁目…。ここから地下へ戻れる。');
          await L.until(() => G.player.pos.x > 70 && G.player.pos.z > 130);
          await L.end();
        },
      },
    ],
  };

  // ================= 第五章 赤環 =================
  const ch5 = {
    num: '第五章　CHAPTER V', title: '赤環', place: '銀座一丁目駅',
    w: 26, h: 52, flash: false,
    kit: kit({ weapons: ['revolver', 'smg', 'shotgun'], inv: { mil: 28, filter: 2, ammo: { s: 10 } } }),
    intro: [
      '銀座一丁目は、赤環の縄張りだった。',
      '奴らは駅を襲い、人をさらい、弾を奪う。',
      '戦うか、闇に紛れるか。選ぶのは僕だ。',
    ],
    env: { fog: 0x070605, density: 0.05, hemi: 0.07, amb: 'station', reverb: 0.55, exposure: 1.2 },
    build(L) {
      const G = L.G;
      L.room(13, 0, 15, 1, { f: 3, c: 6, fm: 'platform', wm: 'tileo' });
      L.room(9, 2, 18, 9, { f: 3, c: 6.5, fm: 'platform', wm: 'tileo' });
      L.solid(11, 5, 11, 5, {});
      L.solid(16, 5, 16, 5, {});
      L.room(12, 10, 15, 13, { f: (x, z) => 3 - (z - 9) * 0.5, c: (x, z) => 3 - (z - 9) * 0.5 + 3.6, fm: 'platform', wm: 'tileo' });
      L.room(7, 14, 8, 42, { f: 0, c: 6.5, fm: 'gravel', wm: 'tileo' });
      L.room(9, 14, 18, 42, { f: 1, c: 6.5, fm: 'platform', wm: 'tileo' });
      L.room(19, 14, 20, 42, { f: 0, c: 6.5, fm: 'gravel', wm: 'tileo' });
      L.room(7, 43, 8, 51, tunnel());
      L.room(21, 32, 21, 32, { f: 0, c: 2.8, fm: 'concrete', wm: 'brick' });
      L.room(22, 30, 24, 34, { f: 0, c: 3.2, fm: 'wood', wm: 'brick' });
      L.track(16, 28, 16, 102);
      L.track(40, 28, 40, 86);
      L.tunnelDecor(14, 86, 18, 104, 'z');
      L.edge(18.16, 28, 86, 1);
      L.edge(37.84, 28, 86, 1);
      // 照明（撃てる電球）
      for (const z of [34, 44, 54, 64, 74, 82]) L.lamp('bulb', 28, 6.5, z, { cord: 1.6, intensity: 1.0, range: 10, color: 0xffb070 });
      L.lamp('bulb', 22, 6.5, 8, { cord: 1.2, intensity: 0.9, range: 9 });
      L.lamp('tube', 33, 6.5, 14, { intensity: 0.8, range: 9, color: 0xffe8c8 });
      L.lamp('cage', 24.12, 4.4, 24, { face: F.E, intensity: 0.7, range: 8 });
      L.lamp('cage', 14.12, 2.6, 84, { face: F.E, intensity: 0.8, range: 9 });
      L.lamp('bulb', 47, 3.2, 64, { cord: 0.4, intensity: 0.8, range: 7 });
      L.lamp('fire', 22, 1, 44, { barrel: true, intensity: 1.2, range: 8 });
      L.lamp('fire', 33, 1, 60, { barrel: true, intensity: 1.2, range: 8 });
      L.lamp('fire', 24, 1, 77, { barrel: true, intensity: 1.0, range: 7 });
      // 看板
      const signO = { line: '#7a6a4a', mark: '線', bg: '#1f2629' };
      L.sign('銀座一丁目', 'GINZA-ITCHOME', 14.06, 3.6, 50, F.E, signO);
      L.sign('銀座一丁目', 'GINZA-ITCHOME', 41.94, 3.6, 60, F.W, signO);
      L.poster(14.05, 2.2, 66, F.E, { title: '赤環に\n従え', sub: '銀座一丁目は赤環の駅', seed: 9 });
      L.poster(41.95, 2.2, 40, F.W, { title: '奪え\n生きろ', sub: '赤環', seed: 10 });
      L.poster(18.05, 4.8, 12, F.E, { title: '改札\n通行税', sub: '軍用弾 五発', seed: 11 });
      // 小道具
      L.prop('sandbags', 28, 31, { len: 6, rows: 3 });
      L.prop('crates', 20.5, 38, { seed: 15 });
      L.prop('tent', 20, 58, { rot: 1.6, color: 0x5a2a22 });
      L.prop('mattress', 20.4, 58.2, { rot: 0 });
      L.prop('tent', 35.5, 50, { rot: -1.5, color: 0x4a2a24 });
      L.prop('tent', 35.5, 68, { rot: -1.6, color: 0x3a2a22 });
      L.prop('table', 25, 46, { rot: 0.4 });
      L.prop('chair', 24, 47.4, {});
      L.prop('crates', 34.5, 78, { seed: 17 });
      L.prop('crates', 20, 80, { seed: 19, n: 2 });
      L.prop('barricade', 16, 88, { w: 4, h: 1.2, seed: 5 });
      L.prop('sandbags', 16, 89.2, { len: 3.6, rows: 2 });
      L.prop('desk', 47, 66, { rot: PI / 2, w: 2 });
      L.prop('shelf', 49.4, 61.4, { rot: -PI / 2, seed: 21, w: 1.4 });
      L.prop('trainCar', 40, 50, { color: 0x5a3a30, stripe: 0x8a2a1e, len: 16 });
      L.prop('corpse', 18.6, 66, { y: 1, rot: 0.8 });
      // 改札
      for (let i = 0; i < 5; i++) L.prop('locker', 21 + i * 3.2, 18.6, { rot: 0 });
      // 檻
      L.f.cage = L.prop('cage', 30, 72, {});
      L.pickup('ammo_r', 24, 21.2, 38.8, 1.85);
      L.pickup('mil', 6, 47.4, 66, 0.85);
      L.pickup('filter', 1, 48.5, 62.5);
      L.pickup('medkit', 1, 25, 46.2, 1.82);
      L.pickup('ammo_s', 6, 34.6, 78);
      L.note(46.6, 65.6, '赤環の帳簿', '十月の上納\n・新富町の生き残り二名 → 永田町へ引き渡し（軍用弾四十発）\n・行商人一名、檻に入れておく。身代金を待つ\n\n永田町の連中は気前がいい。\n「鳴子」の音が東へ流れている限り、こっちに獣は来ない。\n持ちつ持たれつ、というやつだ。', { y: 0.85 });
      // 行商人
      const yamada = (L.f.yamada = L.npc({
        name: 'ヤマダ', x: 30, z: 72, y: 1, yaw: Y.S, pose: 'floor', look: LOOK.yamada, talkLabel: '檻を開ける', talkR: 2.8,
        talk: async (h) => {
          if (h.busy || L.f.freed) return;
          h.busy = true;
          L.f.freed = true;
          G.audio.clank({ x: 31, y: 2, z: 72 }, 0.6);
          const dc = L.f.cage.colliders[3];
          L.f.cage.colliders = [dc];
          L.openDoor(L.f.cage, -1.7, 0.8, 'rot');
          h.setPose('stand');
          await L.say('ヤマダ', '助かった…! 俺はヤマダ、行商人だ。赤環に荷を全部取られてな。');
          await L.say('ヤマダ', '礼だ、これを持っていけ。…隠し持ってた分だ。');
          G.player.give('filter', 2);
          G.player.give('medkit', 1);
          G.flags.prisoner = true;
          await L.say('ヤマダ', 'あんたも早く逃げろよ。北西のトンネルが永田町へ続いてる。');
          h.busy = true;
          h.walk([[32.6, 71.6], [31, 80], [19.6, 84.2], [16.4, 85.4]], { speed: 3.2 }).then(() => h.remove());
        },
      }));
      void yamada;
      // 赤環の兵
      const E = (o) => L.enemy(Object.assign({ look: bandit(), acc: 0.85 }, o));
      L.f.bandits = [
        E({ x: 22, z: 8, y: 3, patrol: [[22, 8], [35, 8], [35, 16], [22, 16]], lantern: true }),
        E({ x: 28, z: 32.5, y: 1, yaw: Y.S }),
        E({ x: 21, z: 42.2, y: 1, yaw: DL.yawTo(1, 1.2), name: '赤環の兵（太った男）' }),
        E({ x: 23.6, z: 45.2, y: 1, yaw: DL.yawTo(-1, -1.2) }),
        E({ x: 34, z: 36, y: 1, patrol: [[34, 36], [34, 72], [26, 82]], lantern: true }),
        E({ x: 20.4, z: 58.2, y: 1, sleep: true, pose: 'sleep', yaw: Y.S }),
        E({ x: 26.6, z: 69, y: 1, yaw: DL.yawTo(1, 1) }),
        E({ x: 47, z: 67.6, y: 0, pose: 'sitdesk', yaw: Y.S, name: '赤環の頭目', hp: 160, look: Object.assign(bandit(), { coat: true, mask: false, beard: 0x1a1612 }) }),
      ];
      L.f.exitGuard = E({ x: 16, z: 84, y: 0, yaw: Y.S, canSurrender: true, name: '若い赤環の兵', look: Object.assign(bandit(), { model: 'bandit3', mask: false, hair: 0x1a1612 }), pitch: 1.2 });
    },
    stages: [
      {
        start: [29, 1.2, Y.N, false],
        async run(L) {
          const G = L.G;
          await L.wait(1);
          await L.say('ハル', '（クロダさんの言う通りだ。赤い布を巻いた連中がいる…）');
          L.objective('赤環の駅を抜け、北西のトンネルへ向かう');
          L.hint('暗がりでは見つかりにくい。電球は撃てば消える ／ 腕時計のランプが青いと見られている');
          await L.wait(3.5);
          L.hint('気づかれていない敵の背後から V で静かに倒せる ／ C でしゃがむと足音が小さい');
          await L.until(() => L.P.pos.z > 18);
          const [a, b] = [L.f.bandits[2], L.f.bandits[3]];
          const lines = [
            [a, '聞いたか? 永田町の連中、また「鳴子」を鳴らしてるらしい。'],
            [b, '鳴子?'],
            [a, 'でかい音を出す旧政府の機械さ。ムクロどもはあの音が大嫌いでな。音から逃げて、東へ流れていく。'],
            [b, '東って…月島のほうか。気の毒に。'],
            [a, 'おかげでこっちは静かなもんだ。永田町さまさまだよ。'],
          ];
          for (const [who, t] of lines) {
            if (!who.alive || who.state === 'combat' || who.state === 'suspicious') break;
            await L.say(who === a ? '赤環の兵' : '赤環の兵（若い声）', t);
          }
          await L.say('ハル', '（鳴子…。それが、あの信号の正体なのか…）');
          await L.until(() => L.P.pos.z > 86);
          const g = L.f.exitGuard;
          if (g.alive && g.surrendered) {
            G.flags.spared = true;
            G.flags.executed = false;
          }
          if (g.surrendered && !g.alive) G.flags.executed = true;
          await L.until(() => L.P.pos.z > 96);
          await L.end();
        },
      },
    ],
  };

  // ================= 第六章 永田町 =================
  const ch6 = {
    num: '第六章　CHAPTER VI', title: '永田町', place: '永田町駅',
    w: 34, h: 46, flash: true,
    kit: kit({ weapons: ['revolver', 'smg', 'shotgun'], inv: { mil: 34, filter: 2, medkit: 3, bomb: 3, ammo: { s: 14, r: 90, p: 24 } } }),
    intro: [
      '永田町。地下鉄のいくつもの線が交わる、評議会の駅。',
      '大理石の壁は、ここだけが二十年前の世界の続きであるかのように白く光っていた。',
      '僕はテープを握りしめた。',
    ],
    env: { fog: 0x0c0d0f, density: 0.032, hemi: 0.22, hemiSky: 0xc8d0dc, hemiGround: 0x2a2a2c, amb: 'hall', reverb: 0.6, exposure: 1.15 },
    build(L) {
      const G = L.G;
      L.room(11, 0, 12, 5, tunnel());
      L.room(9, 6, 14, 7, { f: 0, c: 5, fm: 'concrete', wm: 'concrete' });
      L.room(3, 8, 22, 30, { f: 0, c: 7.5, fm: 'marble', wm: 'marble' });
      for (const z of [11, 15, 19, 23, 27]) {
        L.solid(7, z, 7, z, { wm: 'marble' });
        L.solid(18, z, 18, z, { wm: 'marble' });
      }
      L.room(12, 31, 13, 31, { f: 0, c: 3.5, fm: 'marble', wm: 'marble' });
      L.room(8, 32, 17, 40, { f: 0, c: 5.5, fm: 'wood', wm: 'wood' });
      L.room(23, 21, 23, 21, { f: 0, c: 3.2, fm: 'metal', wm: 'metal' });
      L.room(24, 15, 31, 27, { f: 0, c: 6.5, fm: 'metal', wm: 'metal' });
      L.track(24, 0, 24, 12);
      L.tunnelDecor(22, 0, 26, 12, 'z');
      // 照明
      for (const x of [12, 26, 40]) for (const z of [20, 32, 44, 56]) L.lamp('tube', x, 7.5, z, { intensity: 0.85, range: 13 });
      L.lamp('bulb', 20, 5.5, 72, { cord: 1, shade: true, intensity: 1, range: 10 });
      L.lamp('bulb', 32, 5.5, 72, { cord: 1, shade: true, intensity: 1, range: 10 });
      L.lamp('bulb', 26, 5.5, 78, { cord: 1, shade: true, intensity: 0.9, range: 9 });
      L.lamp('tube', 56, 6.5, 36, { intensity: 0.6, range: 11, color: 0xffd0c0 });
      L.lamp('tube', 56, 6.5, 50, { intensity: 0.6, range: 11, color: 0xffd0c0 });
      L.lamp('cage', 22.12, 2.6, 6, { face: F.E, intensity: 0.7, range: 9 });
      L.lamp('flood', 19, 0, 13.4, { face: F.S, intensity: 0.8, range: 16, shootable: false });
      L.lamp('flood', 29, 0, 13.4, { face: F.S, intensity: 0.8, range: 16, shootable: false });
      // 看板
      const signO = { line: '#7a6a4a', mark: '線', bg: '#1f2629' };
      L.sign('永田町', 'NAGATACHO', 6.06, 3.6, 30, F.E, signO);
      L.sign('永田町', 'NAGATACHO', 45.94, 3.6, 30, F.W, signO);
      L.sign('評議室', 'COUNCIL', 26, 4.4, 62.05, F.S, { w: 2.6, bg: '#4a1c18' });
      L.sign('機械室　関係者以外立入禁止', 'MACHINE ROOM', 45.94, 4.0, 43, F.W, { w: 3.2, bg: '#3a3a30' });
      L.poster(6.05, 2.4, 44, F.E, { title: '秩序と\n灯り', sub: '永田町評議会', seed: 12 });
      L.poster(45.95, 2.4, 22, F.W, { title: '評議会を\n信じよ', sub: '永田町評議会', seed: 13 });
      // ゲート
      L.f.gate = L.prop('gate', 24, 12, { w: 4, h: 4.2 });
      L.prop('sandbags', 19.6, 17, { len: 3.4, rows: 3 });
      L.prop('sandbags', 28.4, 17, { len: 3.4, rows: 3 });
      // 評議室
      L.prop('desk', 26, 75, { w: 3.2 });
      L.prop('banner', 20, 81.8, { text: '評議会', rot: PI });
      L.prop('banner', 32, 81.8, { text: '永田町', rot: PI });
      for (const x of [19, 22, 30, 33]) L.prop('chair', x, 70, { rot: PI });
      L.prop('shelf', 17, 76, { rot: PI / 2, seed: 30 });
      // 機械室
      L.f.naruko = L.prop('naruko', 55, 42, {});
      L.f.panel = L.prop('panel', 63.5, 48, { rot: PI / 2 });
      L.f.mdoor = { colliders: [L.W.addCollider(46.9, 0, 42, 47.1, 3.2, 44, { mat: 'metal' })] };
      L.f.mdoorMesh = L.box(0.12, 3.2, 2, C(0x4a4a44, 0.5, 0.6), 47, 1.6, 43, {});
      // 住居
      for (const [x, z, r] of [[10, 22, 1.6], [10, 34, 1.5], [10, 48, 1.6]]) L.prop('tent', x, z, { rot: r, color: 0x3a4250 });
      L.prop('table', 13, 28, {});
      L.prop('crates', 42, 20, { seed: 25 });
      L.prop('crates', 42, 58, { seed: 27, n: 2 });
      L.pickup('ammo_r', 20, 42.4, 20.4, 1.0);
      L.pickup('medkit', 1, 52, 33);
      L.pickup('ammo_s', 8, 61, 54);
      L.note(24.0, 74.7, '評議会議事録（抜粋）', '議題：鳴子の運用について\n\n東端各駅（月島・豊洲方面）からの苦情が増加。\n議長は運用継続を決定。\n\n「中央五千人の安全は、外縁八十人の犠牲に優先する」\n\n反対一。記録には残さないこと。', { y: 0.86 });
      // 人物
      L.f.captain = L.npc({ name: '警備隊長オオタ', x: 24, z: 15, yaw: Y.S, look: LOOK.nagata, turn: false });
      const guards = (L.f.guards = []);
      for (const [x, z, yaw] of [[20, 14.6, Y.S], [28, 14.6, Y.S], [14, 40, Y.E], [36, 30, Y.W], [40, 52, Y.W], [20, 58, Y.N], [21, 70, Y.E], [31, 70, Y.W]]) guards.push(L.npc({ name: '永田町の警備兵', x, z, yaw, look: LOOK.nagata, turn: false }));
      L.f.sakaki = L.npc({
        name: '評議長サカキ', x: 26, z: 77, yaw: Y.S, look: LOOK.sakaki, turn: false, talkR: 3.8,
        talk: async (h) => {
          if (h.busy || L.f.talked) return;
          if (!L.f.metCaptain) {
            await L.say('サカキ', '…誰だね、君は。警備はどうした。');
            return;
          }
          h.busy = true;
          await L.talk([
            ['サカキ', '月島からよく来てくれた。私は評議長のサカキだ。…届け物があるそうだね。'],
            ['ハル', '月島の無線士が記録した信号です。毎晩同じ時刻に流れて…そのたびにムクロが押し寄せてくる。'],
            ['サカキ', '聞かせてもらおう。'],
          ]);
          G.audio.signal(4.5, 0.5, h.pos);
          G.ui.sub('', '（テープから、低い唸りが流れる）');
          await L.wait(4.5);
          await L.talk([
            ['サカキ', '…なるほど。シノという娘は優秀だな。'],
            ['サカキ', '隠すつもりはない。この音は我々が流している。旧政府の音響兵器、「鳴子」だ。'],
            ['サカキ', 'ムクロはこの音を嫌う。鳴子を鳴らせば、群れは音から逃げ、外側の駅へ流れていく。'],
            ['ハル', '外側…月島へ、ですか。'],
            ['サカキ', '中央の駅には五千人が暮らしている。月島は八十人だ。数を比べれば、答えは明らかだろう。'],
            ['サカキ', '君には選ぶ権利がある。ここに残り、永田町の市民として生きるか。…あるいは、何も見なかったことにして帰るかだ。'],
          ]);
          const c = await L.choose('どうする?', ['永田町に残る', '鳴子を止める']);
          if (c === 0) {
            await L.say('ハル', '…わかりました。');
            await L.say('サカキ', '賢明な判断だ。君の部屋を用意させよう。');
            L.ending('ash');
            return;
          }
          await L.say('ハル', '月島には、僕の家族がいるんです。…鳴子は止めます。');
          await L.say('サカキ', '…残念だ。その子を捕らえろ。', 2);
          L.f.talked = true;
        },
      });
      for (const [x, z, yaw, pose] of [[8, 26, Y.E, 'sit'], [12.6, 30, Y.N, 'sit'], [8.4, 38, Y.E, 'sleep'], [14, 52, Y.W, 'stand'], [9, 54, Y.E, 'sit']]) L.npc({ name: '永田町の住人', x, z, yaw, pose, look: citizen(), turn: false });
      L.f.hum = G.audio.machine({ x: 55, y: 2, z: 42 });
      L.tickers.push((dt) => {
        if (L.f.narukoOff) return true;
        for (const d of L.f.naruko.drums) d.rotation.y += dt * 3;
        L.f.naruko.lights.forEach((l, i) => (l.visible = Math.sin(G.time * 4 + i) > 0));
        return true;
      });
      L.interact({
        pos: { x: 63.2, y: 1.3, z: 48 }, r: 2.4, label: '鳴子を止める', name: '',
        enabled: () => L.f.talked && !L.f.narukoOff,
        onUse: () => {
          L.f.narukoOff = true;
        },
      });
    },
    stages: [
      {
        start: [24, 4, Y.N, true],
        async run(L) {
          const G = L.G;
          await L.wait(1);
          await L.say('ハル', '…永田町。本当に、着いたんだ。');
          L.objective('永田町の評議室へ向かう');
          await L.until(() => L.P.pos.z > 6);
          const cap = L.f.captain;
          await L.say('オオタ', '止まれ! どこの駅の者だ。');
          await L.say('ハル', '月島から来ました。評議会に、届け物があります。');
          await L.say('オオタ', '月島…? 東の果ての駅か。よく生きてここまで来たな。');
          await L.say('オオタ', '評議長がお会いになる。ついて来い。…銃はしまっておけよ。');
          L.f.metCaptain = true;
          G.audio.clank({ x: 24, y: 2, z: 12 }, 0.9);
          await L.openDoor(L.f.gate, 4, 2.4);
          await cap.walk([[24, 22], [26, 40], [26, 58.5]], { waitFor: 10, speed: 2.6 });
          cap.yaw = Y.S;
          await L.say('オオタ', '中へ入れ。評議長がお待ちだ。');
          L.objective('評議長サカキと話す');
          await L.until(() => L.f.talked);
        },
      },
      {
        start: [26, 66, Y.S, true],
        skip(L) {
          L.removeColliders(L.f.gate);
          L.f.gate.door.position.y = 4;
          L.f.talked = true;
          L.f.metCaptain = true;
        },
        async run(L) {
          const G = L.G;
          L.f.talked = true;
          if (L.f.sakaki) L.f.sakaki.remove();
          G.audio.alarm(10);
          L.removeColliders(L.f.mdoor);
          L.f.mdoorMesh.visible = false;
          const foes = [];
          const all = [L.f.captain].concat(L.f.guards);
          for (const g of all) {
            if (!g.alive) continue;
            g.remove();
            const e = L.enemy({ name: '永田町の警備兵', x: g.pos.x, z: g.pos.z, yaw: g.yaw, look: LOOK.nagata, acc: 0.7, dmg: 6 });
            e.lastKnown.copy(G.player.pos);
            e.enterCombat();
            foes.push(e);
          }
          L.objective('鳴子を止める（東の機械室）');
          L.hint('機械室の扉が開いている。東の壁の黄色い扉だ');
          await L.until(() => L.f.narukoOff);
          G.audio.clank({ x: 63, y: 1.5, z: 48 }, 1);
          L.f.panel.lever.rotation.x = 0.6;
          if (L.f.hum) L.f.hum.wind(5);
          for (const l of L.f.naruko.lights) l.visible = false;
          G.player.shake(0.3);
          await L.say('ハル', '止まった…。止まったんだ…!', 2);
          L.objective('南のゲートから脱出する');
          const late = [L.enemy({ name: '永田町の警備兵', x: 22, z: 20, look: LOOK.nagata, acc: 0.7, dmg: 6 }), L.enemy({ name: '永田町の警備兵', x: 28, z: 21, look: LOOK.nagata, acc: 0.7, dmg: 6 })];
          for (const e of late) {
            e.lastKnown.set(40, 0, 43);
            e.state = 'combat';
            e.aware = 1.2;
          }
          const good = G.moralScore() >= 4;
          let k = null;
          if (good) {
            await L.until(() => G.player.pos.z < 40 && G.player.pos.x < 46);
            k = L.ally({ name: 'クロダ', x: 24, z: 8, yaw: Y.N, look: LOOK.kuroda, allyDmg: 22 });
            L.ally({ name: '月島のモグリ', x: 22.6, z: 6, yaw: Y.N, look: LOOK.scout, allyDmg: 16 });
            L.ally({ name: '月島のモグリ', x: 25.4, z: 6, yaw: Y.N, look: LOOK.scout, allyDmg: 16 });
            G.audio.shot('enemy', { x: 24, y: 1.5, z: 8 });
            await L.say('クロダ', 'ハル! 伏せろ!', 1.6);
            await L.say('ハル', 'クロダさん…!', 1.6);
          }
          await L.until(() => L.P.pos.z < 13.5);
          if (k) {
            await L.say('クロダ', '待たせたな。月島の若いのを連れてきた。お前のことが心配で、皆ついて来やがった。');
            await L.say('クロダ', '…よくやった、ハル。帰るぞ。月島へ。');
            L.ending('dawn');
          } else {
            await L.say('ハル', '（走れ。月島まで、止まるな…）', 2.4);
            L.ending('silence');
          }
        },
      },
    ],
  };

  DL.CHAPTERS = [ch1, ch2, ch3, ch4, ch5, ch6];

  DL.ENDINGS = {
    dawn: {
      num: 'ENDING　夜明け', title: '夜明け',
      lines: [
        '鳴子が止まって三日後、ムクロの群れは散り散りになり、トンネルに静けさが戻った。',
        'クロダは言った。お前の父さんも、きっと同じことをしただろう、と。',
        '月島へ帰る前に、僕らは一度だけ地上へ出た。',
        '灰色の雲の切れ間から、細い光が差していた。',
        '生まれて初めて、僕は空の色を知った。',
      ],
    },
    silence: {
      num: 'ENDING　沈黙', title: '沈黙',
      lines: [
        '鳴子は止まった。けれど、追手は執拗だった。',
        '暗いトンネルを、僕はひとりで走り続けた。どれだけ走ったのか覚えていない。',
        '月島に帰り着いたとき、迎えてくれたのはシノの泣き顔と、空っぽのままのクロダの寝床だった。',
        'ムクロの群れは、もう来ない。',
        'それでも夜になると、耳の奥であの低い唸りが鳴り続けている。',
      ],
    },
    ash: {
      num: 'ENDING　灰', title: '灰',
      lines: [
        '僕は永田町に残った。白い大理石の壁と、温かい食事と、清潔な寝床。',
        'その冬、月島駅からの無線は途絶えた。',
        '鳴子は今夜も鳴り続けている。',
        '僕は耳を塞いで眠る。眠れない夜は、シノの声を思い出そうとする。',
        '思い出せない夜が、少しずつ増えていく。',
      ],
    },
  };
})();
