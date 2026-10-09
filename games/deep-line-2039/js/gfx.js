'use strict';
// Blender で作ったモデル・テクスチャ（js/assets.js）を読み込み、ゲーム用に組み立てる。
// アセットが無い・読めない環境では null を返し、models.js のプリミティブ版にフォールバックする。
(function () {
  const DL = window.DL;
  const T = window.THREE;
  const A = (DL.ASSET = { ready: false, models: {}, tex: {} });

  function b64ToBuffer(b64) {
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf.buffer;
  }

  DL.loadAssets = async function (renderer) {
    const src = window.DL_ASSETS;
    if (!src || !T.GLTFLoader) return false;
    const aniso = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 4;
    const texJobs = Object.keys(src.tex).map((k) => new Promise((res) => {
      const img = new Image();
      img.onload = () => {
        const t = new T.Texture(img);
        t.wrapS = t.wrapT = T.RepeatWrapping;
        t.anisotropy = aniso;
        t.encoding = k.endsWith('_c') ? T.sRGBEncoding : T.LinearEncoding;
        t.needsUpdate = true;
        A.tex[k] = t;
        res();
      };
      img.onerror = () => res();
      img.src = src.tex[k];
    }));
    const loader = new T.GLTFLoader();
    const modelJobs = Object.keys(src.models).map((k) => new Promise((res) => {
      try {
        loader.parse(b64ToBuffer(src.models[k]), '', (gltf) => {
          gltf.scene.traverse((m) => {
            if (m.isMesh) m.geometry.userData.shared = true;
          });
          A.models[k] = gltf.scene;
          res();
        }, (e) => {
          console.warn('asset', k, e);
          res();
        });
      } catch (e) {
        console.warn('asset', k, e);
        res();
      }
    }));
    await Promise.all(texJobs.concat(modelJobs));
    A.ready = Object.keys(A.models).length > 0;
    return A.ready;
  };

  // ---------------- ワールド用マテリアル ----------------
  const WORLD = {
    concrete: { n: 1.0 }, tile: { n: 0.8 }, tileg: { n: 0.8 }, tileo: { n: 0.8 }, platform: { n: 0.8 }, gravel: { n: 1.2, r: 0.95 },
    brick: { n: 1.1, r: 0.9 }, metal: { n: 0.8, m: 0.4 }, asphalt: { n: 1.0, r: 0.95 }, rubble: { n: 1.2, r: 0.97 }, marble: { n: 0.4 },
    wood: { n: 0.9 }, facade: { n: 0.8 }, ceiling: { n: 1.0, r: 0.95 },
  };
  DL.worldMaterial = function (name) {
    const c = A.tex[name + '_c'], nm = A.tex[name + '_n'], r = A.tex[name + '_r'];
    if (!c || !nm) return null;
    const d = WORLD[name] || {};
    const m = new T.MeshStandardMaterial({ map: c, normalMap: nm, roughnessMap: r || null, roughness: r ? 1 : d.r || 0.9, metalness: d.m || 0 });
    m.normalScale.set(d.n || 1, d.n || 1);
    return m;
  };

  // ---------------- 役割ごとのマテリアル（色だけ差し替える） ----------------
  const ROLE = {
    skin: { tex: 'skin', r: 0.62, c: 0xb58b6e }, cloth: { tex: 'fabric', c: 0x3f3d35 }, pants: { tex: 'fabric', c: 0x2c2b28 },
    boots: { tex: 'leather', c: 0x2a221c }, vest: { tex: 'fabric', c: 0x4a4636 }, hair: { tex: 'fur', c: 0x2a2018 }, beard: { tex: 'fur', c: 0x2a2018 },
    hat: { tex: 'fabric', c: 0x3a2f28 }, helmet: { tex: 'paint', c: 0x3b4232, m: 0.25 }, scarf: { tex: 'fabric', c: 0x5a3a2a },
    pack: { tex: 'burlap', c: 0x6a5c42 }, gear: { tex: 'leather', c: 0x1e1c1a }, rubber: { tex: 'rubber', c: 0x232321 },
    glass: { r: 0.08, m: 0.6, c: 0x0e1214 }, eye: { r: 0.3, c: 0x140f0c }, glove: { tex: 'leather', c: 0x2a2420 },
    metal: { tex: 'gunmetal', m: 0.8, c: 0x3a3c40 }, wood: { tex: 'gunwood', c: 0x4e4440 }, lampglow: { basic: 0xffc070 },
    mskin: { tex: 'mskin', c: 0xffffff }, claw: { r: 0.45, c: 0x2c241e }, teeth: { r: 0.35, c: 0xd4cbb0 }, mouth: { r: 0.6, c: 0x1a0606 },
    fur: { tex: 'fur', c: 0x6a5a50 }, gunmetal: { tex: 'gunmetal', m: 0.85, c: 0x34373b }, gunmetal2: { tex: 'gunmetal', m: 0.7, c: 0x55555a },
    sleeve: { tex: 'fabric', c: 0x3b3a30 }, dark: { r: 0.6, c: 0x050505 }, tape: { tex: 'fabric', c: 0x26241e }, blade: { tex: 'gunmetal', m: 1, r: 0.25, c: 0xc8ccd0 },
    red: { r: 0.6, c: 0x7a1a10 }, canvas: { tex: 'burlap', c: 0x8a7a58 }, olive: { tex: 'paint', c: 0x4a5040, m: 0.3 }, brass: { r: 0.3, m: 1, c: 0xc8a050 },
    fuse: { r: 0.8, c: 0xc0a070 }, barrel: { tex: 'paint', m: 0.35, c: 0x5a3a28 }, crate: { tex: 'wood', c: 0xd8b890 }, sandbag: { tex: 'burlap', c: 0xc8b088 },
    rock: { tex: 'rock', c: 0xb0a898 }, carbody: { tex: 'paint', m: 0.35, c: 0x5a6058 }, stripe: { tex: 'paint', c: 0x9a7a30 }, interior: { tex: 'fabric', c: 0x7a7a6e },
    seat: { tex: 'fabric', c: 0x6a3020 }, carfloor: { tex: 'rubber', c: 0x3a3a34 }, tire: { tex: 'rubber', c: 0x1a1a1a }, ash: { tex: 'asphalt', c: 0xd0ccc4 },
    headlight: { r: 0.2, c: 0xb0b0a0 },
  };
  const roleCache = new Map();
  DL.roleMat = function (role, color) {
    const d = ROLE[role] || { c: 0x888888 };
    const col = color !== undefined && color !== null ? color : d.c;
    const key = role + '|' + col;
    let m = roleCache.get(key);
    if (m) return m;
    if (d.basic) m = new T.MeshBasicMaterial({ color: d.basic });
    else {
      const map = d.tex ? A.tex[d.tex + '_c'] : null;
      const nm = d.tex ? A.tex[d.tex + '_n'] : null;
      const rm = d.tex ? A.tex[d.tex + '_r'] : null;
      const tint = new T.Color(col);
      if (map && d.tex !== 'wood' && d.tex !== 'asphalt') tint.multiplyScalar(1.25);
      m = new T.MeshStandardMaterial({ color: tint, map: map || null, normalMap: nm || null, roughnessMap: rm || null, roughness: rm ? 1 : d.r !== undefined ? d.r : 0.9, metalness: d.m || 0 });
      if (rm && d.r !== undefined) m.roughness = d.r * 1.6;
    }
    m.name = role;
    roleCache.set(key, m);
    return m;
  };

  function prep(root, colors, shadow = true) {
    root.traverse((m) => {
      if (!m.isMesh) return;
      const role = (m.material && m.material.name) || 'cloth';
      m.material = DL.roleMat(role, colors ? colors[role] : undefined);
      m.castShadow = shadow;
      m.receiveShadow = shadow;
    });
    return root;
  }
  function cloneNode(model, name) {
    const src = A.models[model] && A.models[model].getObjectByName(name);
    if (!src) return null;
    const c = src.clone(true);
    c.position.set(0, 0, 0);
    return c;
  }
  const by = (root) => (name) => root.getObjectByName(name);

  // ---------------- 人物 ----------------
  DL.gfx = {};
  DL.gfx.humanoid = function (o) {
    const root = cloneNode('human', 'root');
    if (!root) return null;
    const n = by(root);
    const hatOn = o.hat === 'beanie' || o.hat === 'helmet' || o.hat === 'hood' || o.hat === 'cap';
    const want = {
      opt_coat: !!o.coat, opt_vest: o.vest !== undefined, opt_vestPouch: o.vest !== undefined, opt_pack: !!o.pack, opt_scarf: o.scarf !== undefined,
      opt_hair: o.hair !== undefined && !hatOn, opt_beard: o.beard !== undefined, opt_beanie: o.hat === 'beanie', opt_helmet: o.hat === 'helmet',
      opt_hood: o.hat === 'hood', opt_cap: o.hat === 'cap', opt_mask: !!o.mask, opt_gun: !!o.gun, opt_guitar: !!o.guitar, opt_lantern: !!o.lantern,
    };
    root.traverse((m) => {
      if (Object.prototype.hasOwnProperty.call(want, m.name)) m.visible = want[m.name];
    });
    for (const s of ['L', 'R']) {
      const g = n('hand_glove' + s), k = n('hand_skin' + s);
      if (g) g.visible = !!o.gloves;
      if (k) k.visible = !o.gloves;
    }
    const eyes = n('eyes');
    if (eyes && o.mask) eyes.visible = false;
    const colors = {
      skin: o.skin, cloth: o.cloth, pants: o.pants, vest: o.vest, hair: o.hair, beard: o.beard,
      hat: o.hatColor, helmet: o.hatColor, scarf: o.scarf,
    };
    prep(root, colors);
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
    return {
      root, hips: n('hips'), torso: n('torso'), head: n('head'),
      armL: { sh: n('shL'), el: n('elL') }, armR: { sh: n('shR'), el: n('elR') },
      legL: { hip: n('hipL'), kn: n('knL') }, legR: { hip: n('hipR'), kn: n('knR') },
      gun: o.gun ? n('opt_gun') : null, opts: o,
    };
  };

  // ---------------- 変異体 ----------------
  const MUT = {
    mukuro: { model: 'mukuro', skin: 0xffffff, eye: 0xe8f08a },
    nushi: { model: 'mukuro', skin: 0x9a8a82, eye: 0xffa040, spikes: true },
    haha: { model: 'mukuro', skin: 0xd0c8c0, eye: 0xa8d8ff },
    pup: { model: 'mukuro', skin: 0xffffff, eye: 0xa8d8ff },
    hagure: { model: 'hagure', skin: 0x6a5a50, eye: 0xff4a30 },
  };
  DL.gfx.mutant = function (kind, scale) {
    const K = MUT[kind] || MUT.mukuro;
    const root = cloneNode(K.model, 'root');
    if (!root) return null;
    const n = by(root);
    const sp = n('opt_spikes');
    if (sp) sp.visible = !!K.spikes;
    prep(root, { mskin: K.skin, fur: K.skin });
    const eyeMat = new T.MeshBasicMaterial({ color: K.eye });
    const eyes = n('eyes');
    if (eyes) {
      eyes.traverse((m) => {
        if (m.isMesh) {
          m.material = eyeMat;
          m.castShadow = false;
        }
      });
    }
    const inner = n('inner');
    inner.scale.setScalar(scale);
    const body = n('body');
    const legs = [['legFL', 'kneeFL', true], ['legFR', 'kneeFR', true], ['legBL', 'kneeBL', false], ['legBR', 'kneeBR', false]].map(([a, b, f]) => {
      const L = { top: n(a), kn: n(b), front: f, base: f ? -0.2 : 0.35 };
      L.kn.rotation.x = L.base;
      return L;
    });
    return { root, inner, body, head: n('head'), jaw: n('jaw'), legs, eyes: eyes ? [eyes] : [], scale, bodyY: body.position.y };
  };

  // ---------------- 一人称の武器 ----------------
  const VIEW = {
    revolver: { rest: [0.2, -0.205, -0.38], aim: [0, -0.072, -0.32] },
    smg: { rest: [0.19, -0.205, -0.36], aim: [0, -0.07, -0.3] },
    shotgun: { rest: [0.18, -0.205, -0.36], aim: [0, -0.07, -0.3] },
    knife: {}, charger: {}, bomb: {},
  };
  DL.gfx.weapon = function (kind) {
    const g = cloneNode('weapons', kind);
    if (!g) return null;
    const n = by(g);
    prep(g, null, false);
    const parts = {};
    for (const k of ['drum', 'mag', 'crank']) if (n(k)) parts[k] = n(k);
    const mz = n('muzzle');
    parts.muzzle = mz ? mz.position.clone() : new T.Vector3(0, 0.04, -0.4);
    const v = VIEW[kind] || {};
    if (v.rest) parts.rest = new T.Vector3(...v.rest);
    if (v.aim) parts.aim = new T.Vector3(...v.aim);
    return { group: g, parts };
  };

  // ---------------- 小道具 ----------------
  DL.gfx.prop = function (kind, o = {}) {
    const g = cloneNode('props', kind);
    if (!g) return null;
    const colors = {};
    if (o.color !== undefined) {
      colors.barrel = o.color;
      colors.carbody = o.color;
    }
    if (o.stripe !== undefined) colors.stripe = o.stripe;
    prep(g, colors);
    return g;
  };
  DL.gfx.rock = function (i) {
    const g = cloneNode('props', 'rock' + (i % 3));
    if (!g) return null;
    return prep(g, null);
  };
})();
