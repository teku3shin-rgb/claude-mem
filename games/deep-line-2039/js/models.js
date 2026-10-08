'use strict';
// プリミティブで組み立てるモデル：人物・変異体・武器・小道具
(function () {
  const DL = window.DL;
  const T = window.THREE;

  const GEO = {
    box: new T.BoxGeometry(1, 1, 1),
    sph: new T.SphereGeometry(0.5, 14, 10),
    sphLo: new T.SphereGeometry(0.5, 8, 6),
    cyl: new T.CylinderGeometry(0.5, 0.5, 1, 14),
    cylLo: new T.CylinderGeometry(0.5, 0.5, 1, 8),
    cone: new T.ConeGeometry(0.5, 1, 8),
    plane: new T.PlaneGeometry(1, 1),
    ico: new T.IcosahedronGeometry(0.5, 0),
  };
  DL.GEO = GEO;

  function mesh(geo, mat, sx, sy, sz, x, y, z, parent, shadow = true) {
    const m = new T.Mesh(geo, mat);
    m.scale.set(sx, sy, sz);
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = shadow;
    m.receiveShadow = shadow;
    if (parent) parent.add(m);
    return m;
  }
  const box = (w, h, d, mat, x, y, z, parent) => mesh(GEO.box, mat, w, h, d, x, y, z, parent);
  const sph = (w, h, d, mat, x, y, z, parent) => mesh(GEO.sph, mat, w, h, d, x, y, z, parent);
  const cyl = (r, h, mat, x, y, z, parent, lo) => mesh(lo ? GEO.cylLo : GEO.cyl, mat, r * 2, h, r * 2, x, y, z, parent);
  DL.box = box;
  DL.sph = sph;
  DL.cyl = cyl;
  const grp = (x, y, z, parent) => {
    const g = new T.Group();
    g.position.set(x || 0, y || 0, z || 0);
    if (parent) parent.add(g);
    return g;
  };
  const C = DL.cmat;

  // ================= 人物 =================
  function humanoid(o = {}) {
    const root = new T.Group();
    const skin = C(o.skin || 0xb58b6e, 0.8);
    const cloth = C(o.cloth || 0x3f3d35, 0.95);
    const pants = C(o.pants || 0x2c2b28, 0.95);
    const boots = C(0x1d1915, 0.9);
    const dark = C(0x151515, 0.6, 0.3);
    const hips = grp(0, 0.92, 0, root);
    const torso = grp(0, 0, 0, hips);
    box(0.42, 0.22, 0.24, pants, 0, 0.05, 0, torso);
    box(0.44, 0.5, 0.25, cloth, 0, 0.38, 0, torso);
    if (o.coat) box(0.47, 0.42, 0.29, cloth, 0, -0.12, 0, torso);
    if (o.vest) box(0.47, 0.36, 0.3, C(o.vest, 0.9), 0, 0.4, 0, torso);
    if (o.pack) {
      box(0.34, 0.42, 0.18, C(0x4a4230, 0.95), 0, 0.38, 0.21, torso);
      box(0.3, 0.12, 0.16, C(0x3a3426, 0.95), 0, 0.64, 0.2, torso);
    }
    if (o.scarf) box(0.3, 0.1, 0.27, C(o.scarf, 0.95), 0, 0.64, 0, torso);
    const head = grp(0, 0.66, 0, torso);
    box(0.1, 0.1, 0.1, skin, 0, 0.02, 0, head);
    box(0.2, 0.24, 0.22, skin, 0, 0.18, 0, head);
    if (!o.mask) {
      box(0.04, 0.02, 0.01, C(0x1a1410, 0.6), -0.05, 0.2, -0.111, head);
      box(0.04, 0.02, 0.01, C(0x1a1410, 0.6), 0.05, 0.2, -0.111, head);
    }
    if (o.hair) box(0.22, 0.08, 0.24, C(o.hair, 0.95), 0, 0.31, 0.01, head);
    if (o.beard) box(0.18, 0.08, 0.04, C(o.beard, 0.95), 0, 0.09, -0.11, head);
    if (o.hat === 'beanie') box(0.23, 0.1, 0.24, C(o.hatColor || 0x3a2f28, 0.95), 0, 0.33, 0, head);
    if (o.hat === 'helmet') {
      const hm = sph(0.27, 0.2, 0.29, C(o.hatColor || 0x3b4232, 0.6, 0.2), 0, 0.3, 0, head);
      hm.scale.y = 0.22;
      box(0.29, 0.03, 0.31, C(o.hatColor || 0x3b4232, 0.6, 0.2), 0, 0.27, 0, head);
    }
    if (o.hat === 'hood') box(0.26, 0.3, 0.27, cloth, 0, 0.22, 0.02, head);
    if (o.hat === 'cap') {
      box(0.22, 0.07, 0.23, C(o.hatColor || 0x2a3340, 0.9), 0, 0.31, 0, head);
      box(0.2, 0.02, 0.1, C(o.hatColor || 0x2a3340, 0.9), 0, 0.28, -0.14, head);
    }
    if (o.mask) {
      box(0.21, 0.18, 0.06, dark, 0, 0.16, -0.1, head);
      const f = cyl(0.045, 0.09, C(0x3a3a36, 0.5, 0.5), 0, 0.09, -0.16, head);
      f.rotation.x = Math.PI / 2 - 0.4;
      for (const sx of [-0.05, 0.05]) {
        const e = cyl(0.03, 0.02, C(0x0c1418, 0.2, 0.6, o.eyeGlow || 0, 0.6), sx, 0.21, -0.135, head);
        e.rotation.x = Math.PI / 2;
      }
    }
    const mkArm = (side) => {
      const sh = grp(side * 0.28, 0.58, 0, torso);
      box(0.12, 0.32, 0.13, cloth, 0, -0.15, 0, sh);
      const el = grp(0, -0.3, 0, sh);
      box(0.11, 0.3, 0.12, cloth, 0, -0.14, 0, el);
      box(0.09, 0.1, 0.1, o.gloves ? C(0x1c1a17, 0.9) : skin, 0, -0.32, 0, el);
      return { sh, el };
    };
    const mkLeg = (side) => {
      const hip = grp(side * 0.11, 0, 0, hips);
      box(0.17, 0.46, 0.19, pants, 0, -0.22, 0, hip);
      const kn = grp(0, -0.45, 0, hip);
      box(0.15, 0.42, 0.17, pants, 0, -0.2, 0, kn);
      box(0.15, 0.09, 0.26, boots, 0, -0.42, -0.04, kn);
      return { hip, kn };
    };
    const armL = mkArm(-1), armR = mkArm(1), legL = mkLeg(-1), legR = mkLeg(1);
    let gun = null;
    if (o.gun) {
      gun = grp(0, -0.3, -0.05, armR.el);
      const gm = C(0x1f1f1f, 0.5, 0.6);
      box(0.06, 0.1, 0.42, gm, 0, 0, -0.12, gun);
      cyl(0.015, 0.25, gm, 0, 0.02, -0.45, gun).rotation.x = Math.PI / 2;
      box(0.04, 0.14, 0.05, gm, 0, -0.1, -0.14, gun);
      box(0.05, 0.08, 0.2, C(0x4a3826, 0.8), 0, -0.02, 0.15, gun);
      gun.rotation.x = -Math.PI / 2;
    }
    if (o.guitar) {
      const gt = grp(0.02, 0.15, -0.28, torso);
      const wood = C(0x8a5a2c, 0.5);
      sph(0.36, 0.42, 0.1, wood, 0, 0, 0, gt);
      box(0.05, 0.5, 0.03, C(0x3a2a1a, 0.6), 0.12, 0.3, 0, gt).rotation.z = -0.9;
      gt.rotation.z = 1.1;
      o._guitar = gt;
    }
    if (o.lantern) {
      const lt = grp(0, -0.36, 0, armL.el);
      box(0.1, 0.14, 0.1, C(0x2a2a26, 0.5, 0.6), 0, -0.06, 0, lt);
      mesh(GEO.sphLo, new T.MeshBasicMaterial({ color: 0xffc070 }), 0.07, 0.09, 0.07, 0, -0.06, 0, lt, false);
    }
    if (o.glow) {
      const gm = new T.MeshBasicMaterial({ color: o.glow, transparent: true, opacity: 0.22, blending: T.AdditiveBlending, depthWrite: false });
      root.traverse((m) => {
        if (m.isMesh) {
          m.material = gm;
          m.castShadow = false;
        }
      });
      root.userData.glowMat = gm;
    }
    return { root, hips, torso, head, armL, armR, legL, legR, gun, opts: o };
  }

  // ポーズ（静的）
  function poseHuman(m, pose) {
    const z = (g) => {
      g.rotation.set(0, 0, 0);
    };
    [m.armL.sh, m.armL.el, m.armR.sh, m.armR.el, m.legL.hip, m.legL.kn, m.legR.hip, m.legR.kn, m.torso, m.head].forEach(z);
    m.hips.position.y = 0.92;
    m.root.rotation.set(0, m.root.rotation.y, 0);
    if (pose === 'sit' || pose === 'guitar' || pose === 'sitdesk') {
      m.hips.position.y = 0.48;
      m.legL.hip.rotation.x = 1.45;
      m.legR.hip.rotation.x = 1.45;
      m.legL.kn.rotation.x = -1.45;
      m.legR.kn.rotation.x = -1.45;
      m.torso.rotation.x = 0.08;
      m.armL.sh.rotation.x = 0.5;
      m.armR.sh.rotation.x = 0.5;
      m.armL.el.rotation.x = 0.8;
      m.armR.el.rotation.x = 0.8;
      if (pose === 'guitar') {
        m.armR.sh.rotation.x = 0.4;
        m.armR.el.rotation.x = 1.2;
        m.armL.sh.rotation.x = 0.9;
        m.armL.sh.rotation.z = 0.5;
        m.armL.el.rotation.x = 0.9;
      }
      if (pose === 'sitdesk') {
        m.armL.sh.rotation.x = 0.9;
        m.armR.sh.rotation.x = 0.9;
        m.armL.el.rotation.x = 0.6;
        m.armR.el.rotation.x = 0.6;
      }
    } else if (pose === 'floor') {
      m.hips.position.y = 0.16;
      m.legL.hip.rotation.x = 1.5;
      m.legR.hip.rotation.x = 1.4;
      m.legR.kn.rotation.x = -0.3;
      m.torso.rotation.x = -0.25;
      m.armL.sh.rotation.x = 0.3;
      m.armR.sh.rotation.x = 0.2;
      m.head.rotation.x = 0.3;
    } else if (pose === 'sleep') {
      m.root.rotation.z = Math.PI / 2;
      m.hips.position.y = 0.92;
      m.legR.kn.rotation.x = -0.4;
      m.legR.hip.rotation.x = 0.4;
      m.armL.sh.rotation.x = 0.4;
    } else if (pose === 'kneel') {
      m.hips.position.y = 0.48;
      m.legL.kn.rotation.x = -Math.PI / 2;
      m.legR.kn.rotation.x = -Math.PI / 2;
      m.armL.sh.rotation.x = Math.PI - 0.2;
      m.armR.sh.rotation.x = Math.PI - 0.2;
      m.armL.el.rotation.x = 0.6;
      m.armR.el.rotation.x = 0.6;
    } else if (pose === 'aim') {
      m.armR.sh.rotation.x = 1.35;
      m.armL.sh.rotation.x = 1.45;
      m.armL.sh.rotation.z = -0.45;
      m.armR.el.rotation.x = 0.15;
      m.armL.el.rotation.x = 0.3;
    } else if (pose === 'arms') {
      // 腕組み
      m.armL.sh.rotation.x = 0.4;
      m.armR.sh.rotation.x = 0.4;
      m.armL.el.rotation.x = 1.4;
      m.armR.el.rotation.x = 1.4;
      m.armL.el.rotation.y = 0.6;
      m.armR.el.rotation.y = -0.6;
    } else if (pose === 'hold') {
      m.armR.sh.rotation.x = 0.5;
      m.armR.el.rotation.x = 0.9;
      m.armL.sh.rotation.x = 0.7;
      m.armL.sh.rotation.z = -0.3;
      m.armL.el.rotation.x = 0.9;
    }
  }
  DL.poseHuman = poseHuman;

  // ================= 変異体 =================
  const MUT_LOOK = {
    mukuro: { s: 1, skin: 0xb3a59c, eye: 0xe8f08a },
    nushi: { s: 1.9, skin: 0x7d6c63, eye: 0xffa040 },
    hagure: { s: 0.9, skin: 0x4a403a, eye: 0xff4a30 },
    haha: { s: 1.45, skin: 0x8f857c, eye: 0xa8d8ff },
    pup: { s: 0.48, skin: 0xbfb2a8, eye: 0xa8d8ff },
  };
  const skinMats = {};
  function skinMat(kind) {
    if (skinMats[kind]) return skinMats[kind];
    const tx = DL.tex('skin');
    skinMats[kind] = new T.MeshStandardMaterial({ map: tx, bumpMap: tx, bumpScale: 0.04, color: MUT_LOOK[kind].skin, roughness: 0.7 });
    return skinMats[kind];
  }
  function mutant(kind) {
    const K = MUT_LOOK[kind] || MUT_LOOK.mukuro;
    const sk = skinMat(kind);
    const dark = C(0x241a18, 0.6);
    const teeth = C(0xd8d0b0, 0.4);
    const eyeM = new T.MeshBasicMaterial({ color: K.eye });
    const root = new T.Group();
    const inner = grp(0, 0, 0, root);
    inner.scale.setScalar(K.s);
    const dog = kind === 'hagure';
    const body = grp(0, dog ? 0.62 : 0.72, 0, inner);
    sph(0.5, 0.42, dog ? 1.05 : 0.9, sk, 0, 0, 0, body);
    sph(0.44, 0.34, 0.5, sk, 0, 0.12, 0.12, body);
    sph(0.36, 0.3, 0.4, sk, 0, -0.06, -0.32, body);
    // 背骨のこぶ
    for (let i = 0; i < 5; i++) sph(0.08, 0.07, 0.1, sk, 0, 0.22 - i * 0.02, -0.25 + i * 0.14, body);
    if (kind === 'nushi') {
      for (let i = 0; i < 6; i++) {
        const sp = mesh(GEO.cone, C(0x3a2e28, 0.7), 0.07, 0.24, 0.07, (i % 2 ? 0.08 : -0.08), 0.3, -0.3 + i * 0.13, body);
        sp.rotation.x = 0.4;
      }
    }
    if (dog) {
      const tail = grp(0, 0.05, 0.5, body);
      box(0.06, 0.06, 0.45, sk, 0, 0, 0.2, tail).rotation.x = -0.4;
    }
    const head = grp(0, 0.1, dog ? -0.55 : -0.48, body);
    sph(0.3, 0.26, dog ? 0.42 : 0.36, sk, 0, 0, -0.1, head);
    if (dog) sph(0.16, 0.14, 0.3, sk, 0, -0.04, -0.33, head);
    const jaw = grp(0, -0.08, -0.05, head);
    box(0.2, 0.05, dog ? 0.42 : 0.3, sk, 0, -0.02, -0.16, jaw);
    for (let i = 0; i < 4; i++) {
      for (const sx of [-1, 1]) {
        const tt = mesh(GEO.cone, teeth, 0.022, 0.05, 0.022, sx * (0.07 - i * 0.008), 0.02, -0.08 - i * 0.065, jaw, false);
        void tt;
        const tu = mesh(GEO.cone, teeth, 0.02, 0.045, 0.02, sx * (0.07 - i * 0.008), -0.06, -0.12 - i * 0.065 - (dog ? 0.08 : 0), head, false);
        tu.rotation.x = Math.PI;
      }
    }
    box(0.18, 0.02, 0.2, dark, 0, -0.07, -0.18, head);
    const eyes = [];
    for (const sx of [-1, 1]) {
      const e = mesh(GEO.sphLo, eyeM, 0.05, 0.035, 0.04, sx * 0.085, 0.04, dog ? -0.3 : -0.26, head, false);
      eyes.push(e);
    }
    if (!dog) {
      for (const sx of [-1, 1]) {
        const ear = mesh(GEO.cone, sk, 0.05, 0.14, 0.04, sx * 0.13, 0.12, 0.02, head);
        ear.rotation.z = -sx * 0.7;
      }
    } else {
      for (const sx of [-1, 1]) {
        const ear = mesh(GEO.cone, sk, 0.07, 0.16, 0.05, sx * 0.1, 0.16, -0.02, head);
        ear.rotation.z = -sx * 0.3;
      }
    }
    const legs = [];
    const mkLeg = (x, z, front) => {
      const top = grp(x, -0.04, z, body);
      const ul = front ? 0.36 : 0.32;
      box(front ? 0.1 : 0.14, ul, front ? 0.1 : 0.16, sk, 0, -ul / 2, 0, top);
      const kn = grp(0, -ul, 0, top);
      const ll = dog ? 0.32 : front ? 0.36 : 0.38;
      box(0.08, ll, 0.08, sk, 0, -ll / 2, 0, kn);
      for (let c = -1; c <= 1; c++) {
        const cl = mesh(GEO.cone, dark, 0.02, 0.07, 0.02, c * 0.025, -ll, -0.05, kn, false);
        cl.rotation.x = -1.3;
      }
      if (!front) kn.rotation.x = 0.35;
      else kn.rotation.x = -0.2;
      legs.push({ top, kn, front, base: kn.rotation.x });
    };
    mkLeg(-0.22, -0.3, true);
    mkLeg(0.22, -0.3, true);
    mkLeg(-0.2, 0.36, false);
    mkLeg(0.2, 0.36, false);
    return { root, inner, body, head, jaw, legs, eyes, scale: K.s, bodyY: body.position.y };
  }

  // ================= 一人称の武器 =================
  function viewWeapon(kind) {
    const g = new T.Group();
    const gun = C(0x2a2b2d, 0.42, 0.75);
    const gun2 = C(0x3d3c39, 0.5, 0.6);
    const wood = C(0x6b4426, 0.6);
    const glove = C(0x2b2520, 0.9);
    const sleeve = C(0x3b3a30, 0.95);
    const skin = C(0xa77c62, 0.8);
    const tape = C(0x222019, 0.95);
    const parts = {};
    const nos = (m) => {
      m.castShadow = false;
      m.receiveShadow = false;
      return m;
    };
    const B = (w, h, d, m, x, y, z, p) => nos(box(w, h, d, m, x, y, z, p || g));
    const Cy = (r, h, m, x, y, z, p) => {
      const c = nos(cyl(r, h, m, x, y, z, p || g));
      c.rotation.x = Math.PI / 2;
      return c;
    };
    const rightHand = (x, y, z) => {
      B(0.085, 0.09, 0.11, glove, x, y, z);
      B(0.03, 0.03, 0.06, skin, x - 0.04, y + 0.03, z - 0.06);
      const fa = B(0.085, 0.085, 0.42, sleeve, x + 0.03, y - 0.04, z + 0.25);
      fa.rotation.x = 0.12;
      fa.rotation.y = -0.18;
    };
    const leftHand = (x, y, z) => {
      B(0.085, 0.08, 0.11, glove, x, y, z);
      const fa = B(0.085, 0.085, 0.45, sleeve, x - 0.1, y - 0.06, z + 0.24);
      fa.rotation.y = 0.45;
      fa.rotation.x = 0.1;
    };
    if (kind === 'revolver') {
      B(0.034, 0.07, 0.15, gun, 0, 0.025, -0.06);
      Cy(0.012, 0.2, gun, 0, 0.05, -0.22);
      B(0.016, 0.014, 0.2, gun2, 0, 0.065, -0.22);
      parts.drum = new T.Group();
      parts.drum.position.set(0, 0.03, -0.07);
      g.add(parts.drum);
      Cy(0.031, 0.065, gun2, 0, 0, 0, parts.drum);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        Cy(0.007, 0.067, C(0x111111, 0.4, 0.5), Math.cos(a) * 0.019, Math.sin(a) * 0.019, 0, parts.drum);
      }
      const grip = B(0.032, 0.11, 0.045, wood, 0, -0.045, 0.025);
      grip.rotation.x = 0.35;
      B(0.012, 0.025, 0.02, gun, 0, 0.07, 0.015);
      B(0.006, 0.035, 0.035, gun, 0, -0.02, -0.03);
      B(0.006, 0.012, 0.01, gun2, 0, 0.078, -0.31);
      rightHand(0.005, -0.05, 0.03);
      parts.muzzle = new T.Vector3(0, 0.05, -0.33);
      parts.rest = new T.Vector3(0.2, -0.2, -0.38);
      parts.aim = new T.Vector3(0, -0.1, -0.34);
    } else if (kind === 'smg') {
      B(0.052, 0.075, 0.32, gun, 0, 0.02, -0.1);
      Cy(0.024, 0.24, gun2, 0, 0.035, -0.38);
      Cy(0.01, 0.06, gun, 0, 0.035, -0.52);
      for (let i = 0; i < 4; i++) Cy(0.0255, 0.018, tape, 0, 0.035, -0.29 - i * 0.06);
      const mag = B(0.03, 0.17, 0.05, gun2, 0, -0.09, -0.12);
      mag.rotation.x = -0.2;
      parts.mag = mag;
      const grip = B(0.032, 0.1, 0.045, C(0x3a2a1c, 0.8), 0, -0.065, 0.03);
      grip.rotation.x = 0.3;
      B(0.012, 0.012, 0.25, gun2, 0, 0.0, 0.17);
      B(0.012, 0.012, 0.25, gun2, 0, 0.05, 0.17);
      B(0.012, 0.08, 0.012, gun2, 0, 0.025, 0.29);
      B(0.02, 0.03, 0.05, gun, 0, 0.075, -0.05);
      B(0.014, 0.02, 0.012, gun2, 0, 0.065, -0.47);
      B(0.06, 0.02, 0.04, C(0x6a5a3a, 0.9), 0, 0.03, 0.03);
      rightHand(0.0, -0.06, 0.04);
      leftHand(-0.01, -0.02, -0.3);
      parts.muzzle = new T.Vector3(0, 0.035, -0.56);
      parts.rest = new T.Vector3(0.19, -0.21, -0.36);
      parts.aim = new T.Vector3(0, -0.12, -0.3);
    } else if (kind === 'shotgun') {
      Cy(0.017, 0.56, gun, -0.017, 0.035, -0.32);
      Cy(0.017, 0.56, gun, 0.017, 0.035, -0.32);
      B(0.06, 0.035, 0.22, wood, 0, 0.005, -0.26);
      B(0.055, 0.065, 0.12, gun2, 0, 0.025, -0.02);
      const st = B(0.048, 0.085, 0.32, wood, 0, -0.035, 0.18);
      st.rotation.x = -0.12;
      B(0.008, 0.012, 0.012, gun2, 0, 0.055, -0.59);
      rightHand(0.0, -0.06, 0.04);
      leftHand(-0.01, -0.03, -0.27);
      parts.muzzle = new T.Vector3(0, 0.035, -0.62);
      parts.rest = new T.Vector3(0.18, -0.21, -0.36);
      parts.aim = new T.Vector3(0, -0.11, -0.3);
    } else if (kind === 'knife') {
      B(0.008, 0.032, 0.2, C(0xb8bcc0, 0.25, 0.9), 0, 0, -0.14);
      B(0.02, 0.03, 0.1, C(0x2a2018, 0.8), 0, 0, 0.0);
      B(0.04, 0.012, 0.012, gun2, 0, 0, -0.045);
      B(0.085, 0.09, 0.11, glove, 0, -0.01, 0.02);
      const fa = B(0.085, 0.085, 0.42, sleeve, -0.05, -0.04, 0.24);
      fa.rotation.y = 0.3;
    } else if (kind === 'charger') {
      B(0.08, 0.06, 0.1, C(0x4a4a44, 0.6, 0.4), 0, 0, 0);
      parts.crank = new T.Group();
      parts.crank.position.set(0.05, 0, 0);
      g.add(parts.crank);
      B(0.01, 0.08, 0.012, gun2, 0.005, 0.035, 0, parts.crank);
      B(0.03, 0.012, 0.012, C(0x8a2a1a, 0.7), 0.02, 0.075, 0, parts.crank);
      B(0.085, 0.08, 0.11, glove, -0.02, -0.06, 0.02);
      const fa = B(0.085, 0.085, 0.42, sleeve, -0.1, -0.08, 0.24);
      fa.rotation.y = 0.4;
    } else if (kind === 'bomb') {
      Cy(0.026, 0.14, C(0x3a3a38, 0.5, 0.7), 0, 0, 0);
      B(0.004, 0.004, 0.06, C(0xc8a060, 0.8), 0, 0.02, -0.09);
      B(0.085, 0.09, 0.11, glove, 0, -0.03, 0.03);
      const fa = B(0.085, 0.085, 0.42, sleeve, 0.03, -0.06, 0.25);
      fa.rotation.y = -0.2;
    }
    return { group: g, parts };
  }

  // ================= 小道具 =================
  // 各関数は { obj, cols: [[x0,y0,z0,x1,y1,z1], ...] } を返す（ローカル座標）
  const P = {};
  P.crate = (o = {}) => {
    const w = o.w || 1, h = o.h || 1, d = o.d || 1;
    const tx = DL.tex('crate');
    const m = new T.Mesh(GEO.box, new T.MeshStandardMaterial({ map: tx, bumpMap: tx, bumpScale: 0.03, roughness: 0.85 }));
    m.scale.set(w, h, d);
    m.position.y = h / 2;
    m.castShadow = m.receiveShadow = true;
    const g = new T.Group();
    g.add(m);
    return { obj: g, cols: [[-w / 2, 0, -d / 2, w / 2, h, d / 2]] };
  };
  P.crates = (o = {}) => {
    const g = new T.Group(), cols = [];
    const r = DL.rng(o.seed || 3);
    const n = o.n || 3;
    for (let i = 0; i < n; i++) {
      const s = 0.7 + r() * 0.5;
      const c = P.crate({ w: s, h: s * 0.8, d: s });
      const x = (r() - 0.5) * 1.6, z = (r() - 0.5) * 1.2;
      c.obj.position.set(x, 0, z);
      c.obj.rotation.y = (r() - 0.5) * 0.4;
      g.add(c.obj);
      cols.push([x - s / 2, 0, z - s / 2, x + s / 2, s * 0.8, z + s / 2]);
      if (r() < 0.5) {
        const c2 = P.crate({ w: s * 0.7, h: s * 0.6, d: s * 0.7 });
        c2.obj.position.set(x, s * 0.8, z);
        c2.obj.rotation.y = r();
        g.add(c2.obj);
        cols[cols.length - 1][4] = s * 1.4;
      }
    }
    return { obj: g, cols };
  };
  P.barrel = (o = {}) => {
    const g = new T.Group();
    const col = o.color || DL.pick([0x5a3a28, 0x3a4a3a, 0x2f3a4a, 0x6a2a1e]);
    const m = C(col, 0.6, 0.5);
    cyl(0.3, 0.9, m, 0, 0.45, 0, g);
    cyl(0.31, 0.04, C(0x222222, 0.6, 0.6), 0, 0.2, 0, g);
    cyl(0.31, 0.04, C(0x222222, 0.6, 0.6), 0, 0.7, 0, g);
    if (o.fire) {
      cyl(0.27, 0.02, C(0x111111, 1), 0, 0.88, 0, g);
    }
    return { obj: g, cols: [[-0.3, 0, -0.3, 0.3, 0.9, 0.3]] };
  };
  P.sandbags = (o = {}) => {
    const g = new T.Group();
    const len = o.len || 2.4, rows = o.rows || 3;
    const m = C(0x7a6d52, 1);
    const r = DL.rng(o.seed || 9);
    for (let row = 0; row < rows; row++) {
      const n = Math.max(1, Math.round(len / 0.55));
      for (let i = 0; i < n; i++) {
        const x = -len / 2 + (i + 0.5 + (row % 2) * 0.5) * (len / n);
        if (x > len / 2) continue;
        const s = sph(0.58, 0.24, 0.36, m, x, 0.12 + row * 0.21, (r() - 0.5) * 0.05, g);
        s.rotation.y = (r() - 0.5) * 0.2;
      }
    }
    return { obj: g, cols: [[-len / 2, 0, -0.2, len / 2, rows * 0.21 + 0.05, 0.2]] };
  };
  P.tent = (o = {}) => {
    const g = new T.Group();
    const w = o.w || 2.2, d = o.d || 2.4, h = o.h || 1.6;
    const m = new T.MeshStandardMaterial({ color: o.color || DL.pick([0x5a5440, 0x46503c, 0x6a4a3a, 0x3e4650]), roughness: 1, side: T.DoubleSide, map: DL.tex('cloth') });
    const shape = new T.BufferGeometry();
    const hw = w / 2, hd = d / 2;
    const v = [-hw, 0, -hd, 0, h, -hd, 0, h, hd, -hw, 0, -hd, 0, h, hd, -hw, 0, hd, hw, 0, -hd, hw, 0, hd, 0, h, hd, hw, 0, -hd, 0, h, hd, 0, h, -hd, -hw, 0, hd, 0, h, hd, hw, 0, hd];
    shape.setAttribute('position', new T.Float32BufferAttribute(v, 3));
    const uv = [];
    for (let i = 0; i < v.length / 3; i++) uv.push(v[i * 3] * 0.5, v[i * 3 + 2] * 0.5 + v[i * 3 + 1] * 0.5);
    shape.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    shape.computeVertexNormals();
    const t = new T.Mesh(shape, m);
    t.castShadow = t.receiveShadow = true;
    g.add(t);
    box(0.04, h, 0.04, C(0x3a2a1a), 0, h / 2, -hd, g);
    box(w * 0.85, 0.08, d * 0.8, C(0x4a3a30, 1), 0, 0.04, 0, g);
    return { obj: g, cols: [[-hw, 0, -hd, hw, h, hd]] };
  };
  P.mattress = (o = {}) => {
    const g = new T.Group();
    box(0.9, 0.16, 1.9, C(o.color || 0x5a5248, 1), 0, 0.08, 0, g);
    box(0.85, 0.06, 1.1, C(o.blanket || DL.pick([0x6a3a30, 0x3a4a5a, 0x4a5a3a]), 1), 0, 0.18, 0.35, g);
    box(0.5, 0.1, 0.3, C(0xb0a890, 1), 0, 0.2, -0.7, g);
    return { obj: g, cols: [] };
  };
  P.table = (o = {}) => {
    const g = new T.Group();
    const w = o.w || 1.4, d = o.d || 0.8, h = o.h || 0.78;
    const wd = C(o.color || 0x5a4030, 0.8);
    box(w, 0.05, d, wd, 0, h, 0, g);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(0.05, h, 0.05, wd, x * (w / 2 - 0.05), h / 2, z * (d / 2 - 0.05), g);
    return { obj: g, cols: [[-w / 2, 0, -d / 2, w / 2, h + 0.03, d / 2]] };
  };
  P.chair = () => {
    const g = new T.Group();
    const wd = C(0x4a3626, 0.8);
    box(0.45, 0.04, 0.45, wd, 0, 0.45, 0, g);
    box(0.45, 0.5, 0.04, wd, 0, 0.7, 0.21, g);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(0.04, 0.45, 0.04, wd, x * 0.2, 0.22, z * 0.2, g);
    return { obj: g, cols: [] };
  };
  P.shelf = (o = {}) => {
    const g = new T.Group();
    const w = o.w || 1.6, h = o.h || 2;
    const m = C(0x3a3a36, 0.6, 0.5);
    for (let i = 0; i < 4; i++) box(w, 0.03, 0.45, m, 0, 0.1 + i * (h / 4), 0, g);
    for (const x of [-1, 1]) box(0.04, h, 0.45, m, x * w / 2, h / 2, 0, g);
    const r = DL.rng(o.seed || 4);
    for (let i = 0; i < 10; i++) {
      const s = 0.12 + r() * 0.2;
      box(s, s * (0.6 + r()), s, C(DL.pick([0x6a5a40, 0x404a3a, 0x8a7a5a, 0x2a3a4a]), 0.9), (r() - 0.5) * (w - 0.3), 0.12 + Math.floor(r() * 4) * (h / 4) + s * 0.4, (r() - 0.5) * 0.2, g);
    }
    return { obj: g, cols: [[-w / 2, 0, -0.25, w / 2, h, 0.25]] };
  };
  P.locker = () => {
    const g = new T.Group();
    const m = C(0x4a5650, 0.5, 0.5);
    box(0.6, 1.9, 0.5, m, 0, 0.95, 0, g);
    box(0.02, 1.7, 0.01, C(0x222, 0.5), 0, 1, -0.255, g);
    return { obj: g, cols: [[-0.3, 0, -0.25, 0.3, 1.9, 0.25]] };
  };
  P.desk = (o = {}) => {
    const g = new T.Group();
    const w = o.w || 2.4;
    const m = C(0x4a2e1e, 0.4);
    box(w, 0.08, 1.0, m, 0, 0.8, 0, g);
    box(w, 0.75, 0.06, m, 0, 0.4, 0.45, g);
    box(0.06, 0.75, 1.0, m, -w / 2 + 0.03, 0.4, 0, g);
    box(0.06, 0.75, 1.0, m, w / 2 - 0.03, 0.4, 0, g);
    box(0.3, 0.02, 0.4, C(0xd8d0b8, 1), -0.3, 0.85, 0, g);
    box(0.25, 0.02, 0.35, C(0xc8c0a8, 1), 0.4, 0.85, 0.1, g).rotation.y = 0.3;
    return { obj: g, cols: [[-w / 2, 0, -0.5, w / 2, 0.84, 0.5]] };
  };
  P.generator = () => {
    const g = new T.Group();
    const m = C(0x5a4a2a, 0.6, 0.4);
    box(1.4, 0.9, 0.8, m, 0, 0.45, 0, g);
    cyl(0.25, 0.9, C(0x3a3a3a, 0.5, 0.6), 0, 0.6, 0, g).rotation.z = Math.PI / 2;
    cyl(0.05, 0.9, C(0x2a2a2a, 0.5, 0.6), 0.5, 1.2, 0.2, g);
    box(0.3, 0.2, 0.05, C(0x1a1a1a), -0.4, 0.7, -0.41, g);
    return { obj: g, cols: [[-0.7, 0, -0.4, 0.7, 0.9, 0.4]] };
  };
  P.radio = () => {
    const g = new T.Group();
    box(0.7, 0.4, 0.4, C(0x3a3a32, 0.6, 0.3), 0, 0.2, 0, g);
    for (let i = 0; i < 3; i++) {
      const d = cyl(0.04, 0.03, C(0x1a1a1a), -0.2 + i * 0.12, 0.25, -0.21, g);
      d.rotation.x = Math.PI / 2;
    }
    box(0.25, 0.1, 0.01, C(0x2a3a2a, 0.3, 0, 0x60ff90, 0.4), 0.18, 0.28, -0.205, g);
    cyl(0.008, 0.8, C(0x888888, 0.4, 0.8), 0.3, 0.8, 0.1, g);
    return { obj: g, cols: [] };
  };
  P.cage = (o = {}) => {
    const g = new T.Group();
    const w = o.w || 2.4, d = o.d || 2.4, h = o.h || 2.2;
    const m = C(0x3a3632, 0.5, 0.7);
    const bars = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.round(len / 0.18);
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        box(0.03, h, 0.03, m, x0 + (x1 - x0) * t, h / 2, z0 + (z1 - z0) * t, g);
      }
    };
    bars(-w / 2, -d / 2, w / 2, -d / 2);
    bars(-w / 2, d / 2, w / 2, d / 2);
    bars(-w / 2, -d / 2, -w / 2, d / 2);
    const doorG = grp(w / 2, 0, -d / 2, g);
    const n = 12;
    for (let i = 0; i <= n; i++) box(0.03, h, 0.03, m, 0, h / 2, (d * i) / n, doorG);
    box(w, 0.05, d, m, 0, h, 0, g);
    box(w, 0.05, 0.05, m, 0, 0.1, -d / 2, g);
    return {
      obj: g, door: doorG,
      cols: [[-w / 2, 0, -d / 2 - 0.05, w / 2, h, -d / 2 + 0.05], [-w / 2, 0, d / 2 - 0.05, w / 2, h, d / 2 + 0.05], [-w / 2 - 0.05, 0, -d / 2, -w / 2 + 0.05, h, d / 2], [w / 2 - 0.05, 0, -d / 2, w / 2 + 0.05, h, d / 2]],
    };
  };
  P.corpse = (o = {}) => {
    const h = humanoid({ cloth: o.cloth || DL.pick([0x3a3830, 0x2a3036, 0x403428]), skin: 0x8a7a6a, hat: o.hat, mask: o.mask, pack: o.pack });
    poseHuman(h, 'floor');
    if (o.lying) {
      h.root.rotation.x = -Math.PI / 2;
      h.root.position.y = 0.1;
      const g = new T.Group();
      g.add(h.root);
      return { obj: g, cols: [] };
    }
    const g = new T.Group();
    g.add(h.root);
    return { obj: g, cols: [] };
  };
  P.bones = (o = {}) => {
    const g = new T.Group();
    const m = C(0xcfc6b0, 0.7);
    const r = DL.rng(o.seed || 12);
    const n = o.n || 10;
    for (let i = 0; i < n; i++) {
      const b = cyl(0.025, 0.25 + r() * 0.3, m, (r() - 0.5) * 1.6, 0.03, (r() - 0.5) * 1.6, g, true);
      b.rotation.z = Math.PI / 2;
      b.rotation.y = r() * 3;
    }
    for (let i = 0; i < (o.skulls || 1); i++) sph(0.18, 0.18, 0.22, m, (r() - 0.5) * 1.2, 0.09, (r() - 0.5) * 1.2, g);
    return { obj: g, cols: [] };
  };
  P.cocoon = () => {
    const g = new T.Group();
    const m = C(0x5a4a3e, 0.4);
    const s = sph(0.6, 1.0, 0.6, m, 0, 0.5, 0, g);
    s.rotation.z = 0.2;
    sph(0.4, 0.3, 0.4, C(0x3a2a22, 0.3), 0, 0.1, 0.1, g);
    return { obj: g, cols: [] };
  };
  P.campfire = () => {
    const g = new T.Group();
    const wd = C(0x3a2618, 0.9);
    for (let i = 0; i < 4; i++) {
      const l = cyl(0.06, 0.8, wd, 0, 0.1, 0, g, true);
      l.rotation.z = Math.PI / 2 - 0.3;
      l.rotation.y = (i / 4) * Math.PI;
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      mesh(GEO.ico, C(0x4a4a46, 1), 0.2, 0.15, 0.2, Math.cos(a) * 0.5, 0.06, Math.sin(a) * 0.5, g);
    }
    return { obj: g, cols: [[-0.55, 0, -0.55, 0.55, 0.3, 0.55]] };
  };
  P.trainCar = (o = {}) => {
    const g = new T.Group();
    const L = o.len || 18, W = 2.8, H = 3.4, F = 1.0;
    const body = C(o.color || 0x5a6058, 0.55, 0.45);
    const stripe = C(o.stripe || 0x9a7a30, 0.6, 0.3);
    const inner = C(0x6a6a5e, 0.9);
    const glass = new T.MeshStandardMaterial({ color: 0x0b0e10, roughness: 0.1, metalness: 0.6, transparent: true, opacity: 0.55 });
    box(W, F, L, C(0x262624, 0.7, 0.5), 0, F / 2, 0, g);
    // 側面（窓あり）
    for (const sx of [-1, 1]) {
      box(0.08, 0.9, L, body, sx * (W / 2 - 0.04), F + 0.45, 0, g);
      box(0.08, 0.5, L, body, sx * (W / 2 - 0.04), H - 0.25, 0, g);
      box(0.085, 0.12, L, stripe, sx * (W / 2 - 0.04), F + 0.8, 0, g);
      for (let i = 0; i < 7; i++) {
        const z = -L / 2 + 1 + i * ((L - 2) / 6);
        box(0.08, 1.0, 0.25, body, sx * (W / 2 - 0.04), F + 1.4, z, g);
        if (i < 6) {
          const gl = box(0.02, 1.0, (L - 2) / 6 - 0.25, glass, sx * (W / 2 - 0.04), F + 1.4, z + (L - 2) / 12, g);
          gl.castShadow = false;
        }
      }
      box(0.08, 1.0, 1.0, body, sx * (W / 2 - 0.04), F + 1.4, -L / 2 + 0.5, g);
      box(0.08, 1.0, 1.0, body, sx * (W / 2 - 0.04), F + 1.4, L / 2 - 0.5, g);
    }
    box(W, 0.12, L, body, 0, H, 0, g);
    box(W - 0.2, 0.02, L - 0.2, inner, 0, H - 0.07, 0, g);
    box(W - 0.2, 0.02, L - 0.2, C(0x3a3830, 0.9), 0, F + 0.01, 0, g);
    // 両端の壁（扉あり）
    for (const sz of [-1, 1]) {
      box(0.9, H - F, 0.08, body, -0.95, F + (H - F) / 2, sz * (L / 2 - 0.04), g);
      box(0.9, H - F, 0.08, body, 0.95, F + (H - F) / 2, sz * (L / 2 - 0.04), g);
      box(1.0, 0.5, 0.08, body, 0, H - 0.25, sz * (L / 2 - 0.04), g);
    }
    // 座席
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const z = -L / 2 + 2.5 + i * ((L - 5) / 2);
        box(0.5, 0.45, 3.2, C(0x5a3a2a, 0.9), sx * 1.05, F + 0.22, z, g);
        box(0.12, 0.5, 3.2, C(0x5a3a2a, 0.9), sx * 1.3, F + 0.65, z, g);
      }
    }
    for (let i = 0; i < 6; i++) box(0.02, 0.02, L - 1, C(0x999999, 0.3, 0.9), (i % 2 ? 0.7 : -0.7), H - 0.45, 0, g);
    const t = 0.15;
    const cols = [
      [-W / 2, 0, -L / 2, W / 2, F, L / 2],
      [-W / 2, F, -L / 2, -W / 2 + t, H, L / 2],
      [W / 2 - t, F, -L / 2, W / 2, H, L / 2],
      [-W / 2, H - 0.05, -L / 2, W / 2, H + 0.1, L / 2],
      [-W / 2, F, -L / 2, -0.5, H, -L / 2 + t],
      [0.5, F, -L / 2, W / 2, H, -L / 2 + t],
      [-W / 2, F, L / 2 - t, -0.5, H, L / 2],
      [0.5, F, L / 2 - t, W / 2, H, L / 2],
      [-W / 2 + 0.8, F, -L / 2 + 0.9, -0.8, F + 0.45, L / 2 - 0.9],
      [0.8, F, -L / 2 + 0.9, W / 2 - 0.8, F + 0.45, L / 2 - 0.9],
    ];
    return { obj: g, cols };
  };
  P.car = (o = {}) => {
    const g = new T.Group();
    const col = o.color || DL.pick([0x4a4e52, 0x5a3a2a, 0x2a3a4a, 0x6a6a5a, 0x3a3a30]);
    const m = C(col, 0.7, 0.4);
    const rust = C(0x5a3a22, 0.95, 0.2);
    const ash = C(0x9a968e, 1);
    box(1.8, 0.6, 4.2, m, 0, 0.55, 0, g);
    box(1.6, 0.55, 2.2, m, 0, 1.12, 0.2, g);
    box(1.62, 0.05, 2.0, ash, 0, 1.41, 0.2, g);
    box(1.82, 0.04, 1.2, ash, 0, 0.87, -1.4, g);
    box(1.55, 0.45, 0.04, C(0x0a0c0e, 0.1, 0.5), 0, 1.12, -0.92, g);
    box(1.85, 0.25, 4.25, rust, 0, 0.32, 0, g);
    for (const [x, z] of [[-0.85, -1.3], [0.85, -1.3], [-0.85, 1.3], [0.85, 1.3]]) {
      const w = cyl(0.33, 0.24, C(0x161616, 0.9), x, 0.3, z, g, true);
      w.rotation.z = Math.PI / 2;
    }
    return { obj: g, cols: [[-0.9, 0, -2.1, 0.9, 1.4, 2.1]] };
  };
  P.bus = () => {
    const g = new T.Group();
    const m = C(0x6a6a50, 0.7, 0.3);
    box(2.5, 2.6, 10, m, 0, 1.6, 0, g);
    box(2.52, 0.8, 9.6, C(0x0c0e10, 0.2, 0.5), 0, 2.1, 0, g);
    box(2.55, 0.25, 10.05, C(0x8a3a22, 0.8), 0, 1.0, 0, g);
    box(2.4, 0.05, 9.8, C(0x9a968e, 1), 0, 2.93, 0, g);
    for (const z of [-3.5, 3.5]) {
      for (const x of [-1.2, 1.2]) {
        const w = cyl(0.5, 0.3, C(0x161616, 0.9), x, 0.4, z, g, true);
        w.rotation.z = Math.PI / 2;
      }
    }
    g.rotation.z = 0.06;
    return { obj: g, cols: [[-1.3, 0, -5, 1.3, 2.9, 5]] };
  };
  P.rubble = (o = {}) => {
    const g = new T.Group();
    const w = o.w || 3, d = o.d || 3, h = o.h || 1.2;
    const r = DL.rng(o.seed || 21);
    const ms = [C(0x4c4944, 1), C(0x3e3b36, 1), C(0x57514a, 1)];
    const n = o.n || Math.round(w * d * 2.5);
    for (let i = 0; i < n; i++) {
      const x = (r() - 0.5) * w, z = (r() - 0.5) * d;
      const k = 1 - (Math.abs(x) / w + Math.abs(z) / d);
      const s = 0.3 + r() * 0.8;
      const rock = mesh(GEO.ico, ms[i % 3], s * (1 + r()), s * 0.7, s, x, Math.max(0, k) * h * 0.8 + s * 0.2, z, g);
      rock.rotation.set(r() * 3, r() * 3, r() * 3);
    }
    for (let i = 0; i < (o.rebar ? 6 : 0); i++) {
      const b = cyl(0.02, 1.5, C(0x5a3a22, 0.8, 0.5), (r() - 0.5) * w * 0.7, h * 0.6, (r() - 0.5) * d * 0.7, g, true);
      b.rotation.set(r() - 0.5, 0, r() - 0.5);
    }
    return { obj: g, cols: o.solid ? [[-w / 2, 0, -d / 2, w / 2, h, d / 2]] : [] };
  };
  P.pole = (o = {}) => {
    const g = new T.Group();
    const h = o.h || 7;
    const m = C(0x3a3c3a, 0.6, 0.6);
    cyl(0.09, h, m, 0, h / 2, 0, g, true);
    box(1.2, 0.08, 0.15, m, 0.5, h - 0.1, 0, g);
    box(0.4, 0.12, 0.25, C(0x2a2a2a, 0.5, 0.5), 1.0, h - 0.2, 0, g);
    if (o.fallen) {
      g.rotation.z = Math.PI / 2 - 0.12;
      g.position.y = 0.2;
    }
    return { obj: g, cols: o.fallen ? [] : [[-0.12, 0, -0.12, 0.12, h, 0.12]] };
  };
  P.tree = (o = {}) => {
    const g = new T.Group();
    const m = C(0x2a2420, 1);
    const r = DL.rng(o.seed || 5);
    cyl(0.18, 4, m, 0, 2, 0, g, true);
    for (let i = 0; i < 6; i++) {
      const b = cyl(0.06, 1.8, m, 0, 3 + r() * 1.2, 0, g, true);
      b.rotation.set((r() - 0.5) * 1.6, r() * 3, (r() - 0.5) * 1.6);
      b.position.x += Math.sin(b.rotation.z) * -0.6;
    }
    return { obj: g, cols: [[-0.2, 0, -0.2, 0.2, 4, 0.2]] };
  };
  P.barricade = (o = {}) => {
    const g = new T.Group();
    const w = o.w || 4, h = o.h || 2.2;
    const r = DL.rng(o.seed || 31);
    const wd = C(0x4a3a2a, 0.9), mt = C(0x4a4038, 0.6, 0.5);
    for (let i = 0; i < 7; i++) {
      const p = box(w * (0.7 + r() * 0.35), 0.18, 0.05, i % 3 === 0 ? mt : wd, (r() - 0.5) * 0.3, 0.2 + i * (h / 7), (r() - 0.5) * 0.1, g);
      p.rotation.z = (r() - 0.5) * 0.15;
    }
    for (const x of [-w / 2 + 0.2, w / 2 - 0.2]) box(0.12, h + 0.2, 0.12, wd, x, (h + 0.2) / 2, 0.1, g);
    box(w * 0.5, h * 0.6, 0.03, C(0x5a4a3a, 0.6, 0.5), (r() - 0.5), h * 0.35, -0.06, g);
    return { obj: g, cols: [[-w / 2, 0, -0.15, w / 2, h, 0.2]] };
  };
  P.gate = (o = {}) => {
    const g = new T.Group();
    const w = o.w || 4, h = o.h || 3.2;
    const m = C(0x3a3a36, 0.5, 0.7);
    const door = grp(0, 0, 0, g);
    for (let i = 0; i <= Math.round(w / 0.25); i++) box(0.05, h, 0.05, m, -w / 2 + i * 0.25, h / 2, 0, door);
    for (let i = 0; i < 4; i++) box(w, 0.08, 0.08, m, 0, 0.3 + i * (h - 0.5) / 3, 0, door);
    box(w * 0.98, h * 0.45, 0.03, C(0x4a4038, 0.6, 0.5), 0, h * 0.25, 0.02, door);
    return { obj: g, door, cols: [[-w / 2, 0, -0.12, w / 2, h, 0.12]] };
  };
  P.shutter = (o = {}) => {
    const g = new T.Group();
    const w = o.w || 8, h = o.h || 4;
    const door = grp(0, 0, 0, g);
    const m = C(0x5a5a52, 0.5, 0.6);
    for (let i = 0; i < Math.round(h / 0.2); i++) box(w, 0.18, 0.06, i % 2 ? m : C(0x4e4e48, 0.5, 0.6), 0, 0.1 + i * 0.2, 0, door);
    box(w, 0.1, 0.12, C(0xb08a20, 0.6, 0.3), 0, 0.05, 0, door);
    return { obj: g, door, cols: [[-w / 2, 0, -0.1, w / 2, h, 0.1]] };
  };
  P.naruko = () => {
    // 音響兵器「鳴子」
    const g = new T.Group();
    const mt = C(0x2e3236, 0.4, 0.8), br = C(0x8a6a3a, 0.35, 0.8);
    box(4, 0.4, 3, C(0x1e2022, 0.6, 0.6), 0, 0.2, 0, g);
    const drums = [];
    for (let i = 0; i < 3; i++) {
      const d = grp(-1.2 + i * 1.2, 1.6, 0, g);
      cyl(0.45, 2.2, mt, 0, 0, 0, d);
      for (let k = 0; k < 4; k++) cyl(0.47, 0.06, br, 0, -0.9 + k * 0.6, 0, d);
      drums.push(d);
    }
    for (const sx of [-1, 1]) {
      const horn = mesh(GEO.cone, br, 0.9, 1.4, 0.9, sx * 2.4, 2.4, 0, g);
      horn.rotation.z = sx * Math.PI / 2;
    }
    const lights = [];
    for (let i = 0; i < 6; i++) {
      const l = mesh(GEO.sphLo, new T.MeshBasicMaterial({ color: 0xff2a1a }), 0.12, 0.12, 0.12, -1.5 + i * 0.6, 0.55, -1.45, g, false);
      lights.push(l);
    }
    for (let i = 0; i < 8; i++) {
      const c = cyl(0.04, 3, C(0x111111, 0.8), -1.8 + i * 0.5, 2.9, 0.8, g, true);
      c.rotation.x = 0.3;
    }
    return { obj: g, drums, lights, cols: [[-2.2, 0, -1.5, 2.2, 3, 1.5]] };
  };
  P.panel = () => {
    const g = new T.Group();
    box(1.2, 1.8, 0.4, C(0x3a4038, 0.5, 0.6), 0, 0.9, 0, g);
    const lever = grp(0.3, 1.1, -0.22, g);
    box(0.06, 0.4, 0.06, C(0x8a1a12, 0.6), 0, 0.2, 0, lever);
    lever.rotation.x = -0.5;
    for (let i = 0; i < 4; i++) box(0.08, 0.08, 0.02, C(0x111, 0.3, 0, i < 2 ? 0xff3020 : 0x40ff60, 0.8), -0.35 + i * 0.12, 1.45, -0.205, g);
    return { obj: g, lever, cols: [[-0.6, 0, -0.2, 0.6, 1.8, 0.2]] };
  };
  P.banner = (o = {}) => {
    const g = new T.Group();
    const c = DL.mkCanvas(128, 384), x = c.getContext('2d');
    x.fillStyle = o.bg || '#6a1c18';
    x.fillRect(0, 0, 128, 384);
    x.strokeStyle = '#c8a860';
    x.lineWidth = 4;
    x.strokeRect(8, 8, 112, 368);
    x.fillStyle = '#e8d8a8';
    x.font = 'bold 56px ' + DL.FONT_MINCHO;
    x.textAlign = 'center';
    const txt = o.text || '評議会';
    for (let i = 0; i < txt.length; i++) x.fillText(txt[i], 64, 90 + i * 80);
    const m = new T.MeshStandardMaterial({ map: DL.toTex(c, { clamp: true }), roughness: 0.9, side: T.DoubleSide });
    const p = new T.Mesh(GEO.plane, m);
    p.scale.set(1.2, 3.6, 1);
    p.position.y = 1.8;
    g.add(p);
    return { obj: g, cols: [] };
  };
  P.clockTower = () => {
    const g = new T.Group();
    const m = C(0x8a8478, 0.9);
    cyl(3, 6, m, 0, 3, 0, g);
    cyl(3.2, 0.4, C(0x6a665e, 0.9), 0, 6.2, 0, g);
    cyl(2.2, 3, m, 0, 7.8, 0, g);
    const dome = sph(4.4, 3, 4.4, C(0x4a5a50, 0.6, 0.4), 0, 9.3, 0, g);
    dome.scale.y = 2.2;
    const tx = DL.clockTex();
    const fm = new T.MeshStandardMaterial({ map: tx, roughness: 0.8 });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const f = new T.Mesh(GEO.plane, fm);
      f.scale.set(2.6, 2.6, 1);
      f.position.set(Math.sin(a) * 3.05, 3.4, Math.cos(a) * 3.05);
      f.rotation.y = a;
      g.add(f);
    }
    return { obj: g, cols: [] };
  };
  P.stairHut = (o = {}) => {
    // 地上の地下鉄出入口
    const g = new T.Group();
    const w = o.w || 6, d = o.d || 6;
    const m = C(0x4a4c4e, 0.6, 0.4);
    box(w + 0.4, 0.3, d + 0.4, m, 0, 3.35, 0, g);
    for (const sx of [-1, 1]) box(0.25, 3.3, d, m, sx * (w / 2), 1.65, 0, g);
    box(w, 3.3, 0.25, m, 0, 1.65, d / 2, g);
    return { obj: g, cols: [] };
  };
  P.sign = (o = {}) => {
    const g = new T.Group();
    const tx = DL.signTex(o.jp || '', o.en || '', o);
    const m = new T.MeshStandardMaterial({ map: tx, roughness: 0.7, emissive: 0xffffff, emissiveMap: tx, emissiveIntensity: o.lit ? 0.35 : 0.04 });
    const p = new T.Mesh(GEO.plane, m);
    const w = o.w || 3;
    p.scale.set(w, w / 4, 1);
    g.add(p);
    box(w + 0.1, w / 4 + 0.1, 0.05, C(0x222222, 0.6, 0.5), 0, 0, -0.03, g);
    return { obj: g, cols: [] };
  };
  P.poster = (o = {}) => {
    const g = new T.Group();
    const tx = DL.posterTex(o.title || '灯りを\n絶やすな', o.sub || '月島駅自警団', o.seed || 1);
    const m = new T.MeshStandardMaterial({ map: tx, roughness: 0.95, transparent: true, alphaTest: 0.3 });
    const p = new T.Mesh(GEO.plane, m);
    p.scale.set(0.8, 1.12, 1);
    g.add(p);
    return { obj: g, cols: [] };
  };
  P.note = () => {
    const g = new T.Group();
    const p = new T.Mesh(GEO.plane, new T.MeshStandardMaterial({ color: 0xd8ceb0, roughness: 1, emissive: 0x3a3424 }));
    p.scale.set(0.22, 0.3, 1);
    p.rotation.x = -Math.PI / 2;
    p.rotation.z = 0.3;
    p.position.y = 0.01;
    g.add(p);
    return { obj: g, cols: [] };
  };
  P.pipes = (o = {}) => {
    // 長い配管（Z方向）
    const g = new T.Group();
    const len = o.len || 10;
    const r = DL.rng(o.seed || 41);
    const n = o.n || 3;
    for (let i = 0; i < n; i++) {
      const rad = 0.05 + r() * 0.1;
      const c = cyl(rad, len, C(DL.pick([0x4a4a44, 0x5a3a2a, 0x3a4440]), 0.6, 0.5), 0, i * 0.28, 0, g, true);
      c.rotation.x = Math.PI / 2;
    }
    return { obj: g, cols: [] };
  };
  P.lampBulb = (o = {}) => {
    const g = new T.Group();
    const cord = o.cord || 0.8;
    box(0.015, cord, 0.015, C(0x111111), 0, -cord / 2, 0, g);
    if (o.shade) {
      const sh = mesh(GEO.cone, C(0x3a4a3a, 0.6, 0.5), 0.36, 0.2, 0.36, 0, -cord - 0.02, 0, g, false);
      sh.material.side = T.DoubleSide;
    }
    const bulb = mesh(GEO.sphLo, new T.MeshBasicMaterial({ color: o.color || 0xffd090 }), 0.11, 0.14, 0.11, 0, -cord - 0.08, 0, g, false);
    return { obj: g, bulb, bulbY: -cord - 0.08, cols: [] };
  };
  P.lampCage = (o = {}) => {
    const g = new T.Group();
    box(0.2, 0.2, 0.1, C(0x2a2a2a, 0.5, 0.6), 0, 0, 0.05, g);
    const bulb = mesh(GEO.sphLo, new T.MeshBasicMaterial({ color: o.color || 0xffc880 }), 0.13, 0.13, 0.13, 0, 0, -0.06, g, false);
    for (let i = 0; i < 3; i++) box(0.012, 0.2, 0.012, C(0x1a1a1a, 0.5, 0.6), -0.06 + i * 0.06, 0, -0.12, g);
    return { obj: g, bulb, bulbY: 0, cols: [] };
  };
  P.lampTube = (o = {}) => {
    const g = new T.Group();
    box(1.3, 0.06, 0.18, C(0x5a5a5a, 0.5, 0.5), 0, 0.03, 0, g);
    const bulb = mesh(GEO.box, new T.MeshBasicMaterial({ color: o.color || 0xe8f0ff }), 1.2, 0.05, 0.07, 0, -0.02, 0, g, false);
    return { obj: g, bulb, bulbY: -0.02, cols: [] };
  };
  P.flood = (o = {}) => {
    const g = new T.Group();
    cyl(0.04, 1.8, C(0x2a2a2a, 0.5, 0.6), 0, 0.9, 0, g, true);
    const head = grp(0, 1.9, 0, g);
    box(0.5, 0.4, 0.25, C(0x3a3a36, 0.5, 0.6), 0, 0, 0, head);
    const bulb = mesh(GEO.box, new T.MeshBasicMaterial({ color: o.color || 0xfff0d0 }), 0.42, 0.32, 0.02, 0, 0, -0.13, head, false);
    head.rotation.x = 0.25;
    return { obj: g, bulb, bulbY: 1.9, cols: [[-0.2, 0, -0.2, 0.2, 2, 0.2]] };
  };
  P.signalHorn = () => {
    const g = new T.Group();
    const m = C(0x5a5248, 0.5, 0.6);
    const h = mesh(GEO.cone, m, 0.5, 0.6, 0.5, 0, 0, 0, g);
    h.rotation.x = -Math.PI / 2;
    return { obj: g, cols: [] };
  };

  DL.Models = { humanoid, mutant, viewWeapon, poseHuman };
  DL.Props = P;
})();
