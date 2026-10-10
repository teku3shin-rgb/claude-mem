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

  // gltfpack で圧縮したモデルの展開。WebAssembly 版が使えなければ純 JS 版にする
  async function meshoptDecoder() {
    const w = window.MeshoptDecoder;
    if (w && w.supported !== false && w.ready) {
      try {
        await w.ready;
        return w;
      } catch (e) {
        console.warn('meshopt wasm', e);
      }
    }
    return window.MeshoptDecoderReference || null;
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
        // 人物・変異体のアトラスは glTF の UV（上下反転なし）に合わせる
        if (/^(ch|mu)_/.test(k)) {
          t.flipY = false;
          t.wrapS = t.wrapT = T.ClampToEdgeWrapping;
        }
        t.needsUpdate = true;
        A.tex[k] = t;
        res();
      };
      img.onerror = () => res();
      img.src = src.tex[k];
    }));
    const loader = new T.GLTFLoader();
    const dec = await meshoptDecoder();
    if (dec) loader.setMeshoptDecoder(dec);
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

  DL.gfx = {};

  // ---------------- スキニングの共通処理 ----------------
  // 読み込んだモデルごとに一度だけ、ボーンの基本姿勢の回転を 0 にそろえる。
  // こうすると旧来の手続き型アニメーション（ピボットの rotation.x など）がそのまま同じ向きに効く。
  function rebindSkeleton(src) {
    const meshes = [];
    src.traverse((m) => {
      if (m.isSkinnedMesh) meshes.push(m);
    });
    if (!meshes.length) return null;
    const skel = meshes[0].skeleton;
    const top = skel.bones.find((b) => !b.parent || !b.parent.isBone);
    src.updateMatrixWorld(true);
    src.attach(top);
    src.updateMatrixWorld(true);
    const inv = new T.Matrix4().copy(src.matrixWorld).invert();
    const pos = new Map();
    for (const b of skel.bones) pos.set(b, new T.Vector3().setFromMatrixPosition(b.matrixWorld).applyMatrix4(inv));
    for (const b of skel.bones) {
      b.quaternion.identity();
      b.scale.set(1, 1, 1);
      b.position.copy(pos.get(b));
      if (b.parent && b.parent.isBone) b.position.sub(pos.get(b.parent));
    }
    return { meshes, skel, pos };
  }
  // ボーンの上に空のピボットを挟む（ゲームが位置を直接書き換える関節用）。at はモデル空間でのピボットの位置。
  function insertPivot(src, info, boneName, name, parent, at) {
    const bone = src.getObjectByName(boneName);
    const p = new T.Object3D();
    p.name = name;
    const parentPos = parent === src ? new T.Vector3() : info.pos.get(parent);
    p.position.copy(at).sub(parentPos);
    parent.add(p);
    p.add(bone);
    bone.position.copy(info.pos.get(bone)).sub(at);
    return p;
  }
  // grow: 視錐台カリング用の境界球の広げ方（ポーズや拡大で基本姿勢からはみ出す分）
  function finishBind(src, info, grow) {
    src.updateMatrixWorld(true);
    for (const m of info.meshes) {
      m.bind(info.skel);
      m.geometry.computeBoundingSphere();
      m.geometry.boundingSphere.radius = m.geometry.boundingSphere.radius * grow + 0.3;
    }
  }
  const skinnedMats = new Map();
  function skinnedMat(key, make) {
    let m = skinnedMats.get(key);
    if (!m) {
      m = make();
      m.skinning = true;
      skinnedMats.set(key, m);
    }
    return m;
  }

  // ---------------- 人物（MakeHuman 製、tools/build_humans.py） ----------------
  const HIP_Y = 0.92;
  function prepCharacter(src) {
    if (src.userData.dlReady) return src.userData.dlReady;
    const info = rebindSkeleton(src);
    if (!info) return null;
    const pelvis = src.getObjectByName('pelvis');
    // 腰: ゲームは hips.position.y = 0.92 を「立った状態」として書き換えるので、その高さにピボットを置く
    const hipAt = new T.Vector3(0, HIP_Y, 0);
    insertPivot(src, info, 'pelvis', 'hipsP', src, hipAt);
    // 胴: 腰の位置で回し、呼吸の上下動（position.y）を受ける
    const torsoP = new T.Object3D();
    torsoP.name = 'torsoP';
    pelvis.add(torsoP);
    const sp = src.getObjectByName('spine_01');
    torsoP.add(sp);
    finishBind(src, info, 1.3);
    src.userData.dlReady = { hipY: info.pos.get(pelvis).y };
    return src.userData.dlReady;
  }
  function charMaterials(model, root, o) {
    root.traverse((m) => {
      if (!m.isMesh) return;
      const name = (m.material && m.material.name) || 'body';
      if (o.glow) {
        m.material = skinnedMat('glow|' + o.glow, () => new T.MeshBasicMaterial({ color: o.glow, transparent: true, opacity: 0.22, blending: T.AdditiveBlending, depthWrite: false }));
        m.castShadow = false;
        return;
      }
      if (name === 'body') {
        m.material = skinnedMat('body|' + model, () => new T.MeshStandardMaterial({
          map: A.tex['ch_' + model + '_c'] || null, normalMap: A.tex['ch_' + model + '_n'] || null,
          roughnessMap: A.tex['ch_' + model + '_r'] || null, roughness: 1, metalness: 0,
          // 焼き込んだ AO で暗くなる分を少し持ち上げる
          color: new T.Color(1.18, 1.18, 1.18),
        }));
      } else {
        // 装備は役割ごとのタイル素材（色は人物ごとの指定があれば使う）
        const role = name.replace(OPT_RE, '').replace(/\.\d+$/, '');
        const c = GEAR_COLOR[role] ? o[GEAR_COLOR[role]] : undefined;
        const base = DL.roleMat(role, c);
        m.material = skinnedMat('gear|' + role + '|' + (c === undefined ? '' : c), () => base.clone());
      }
      m.castShadow = true;
      m.receiveShadow = true;
    });
  }
  // 装備の役割 -> 色を受け取る LOOK のキー
  const GEAR_COLOR = { helmet: 'hatColor', hat: 'hatColor', vest: 'vest' };
  // 持ち替えるもの（銃・ギター・ランタン）はマテリアル名の接頭辞で見分ける（gltfpack はノード名を残さないため）
  const OPT_RE = /^(gun|guitar|lantern)_/;
  // 複数のメッシュをまとめて表示・非表示にする
  const multi = (list) => ({
    get visible() {
      return list.some((m) => m.visible);
    },
    set visible(v) {
      for (const m of list) m.visible = v;
    },
  });
  DL.gfx.character = function (model, o = {}) {
    const src = A.models[model];
    if (!src || !T.SkeletonUtils) return null;
    const ready = prepCharacter(src);
    if (!ready) return null;
    const root = T.SkeletonUtils.clone(src);
    const n = by(root);
    const opt = { gun: [], guitar: [], lantern: [] };
    root.traverse((m) => {
      const k = m.isMesh && m.material && OPT_RE.exec(m.material.name || '');
      if (k) opt[k[1]].push(m);
    });
    charMaterials(model, root, o);
    for (const k in opt) for (const m of opt[k]) m.visible = !!o[k];
    const gun = opt.gun.length ? multi(opt.gun) : null;
    return {
      root, hips: n('hipsP'), torso: n('torsoP'), head: n('head'),
      armL: { sh: n('upperarm_l'), el: n('lowerarm_l') }, armR: { sh: n('upperarm_r'), el: n('lowerarm_r') },
      legL: { hip: n('thigh_l'), kn: n('calf_l') }, legR: { hip: n('thigh_r'), kn: n('calf_r') },
      gun: o.gun ? gun : null, opts: o, hipY: ready.hipY, skinned: true,
    };
  };

  // ---------------- 人物（旧来の剛体パーツ版） ----------------
  DL.gfx.humanoid = function (o) {
    if (o.model && A.models[o.model]) {
      const c = DL.gfx.character(o.model, o);
      if (c) return c;
    }
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
  // Blender 製のスキニング変異体（tools/build_mutants.py）。種類 -> モデル名と目の色
  const MUT_SKIN = {
    mukuro: { model: 'mukuro', eye: 0xe8f08a }, nushi: { model: 'nushi', eye: 0xffa040 }, haha: { model: 'haha', eye: 0xa8d8ff },
    pup: { model: 'haha', eye: 0xa8d8ff }, hagure: { model: 'hagure', eye: 0xff4a30 },
  };
  function prepMutant(src) {
    if (src.userData.dlReady) return src.userData.dlReady;
    const info = rebindSkeleton(src);
    if (!info) return null;
    // ゲームは inner.scale（大きさ）と body.position.y（胴の上下）を書き換えるので、その位置にピボットを挟む
    const inner = new T.Object3D();
    inner.name = 'inner';
    src.add(inner);
    // メッシュにも同じ名前が付くことがあるので、骨格のボーンから探す
    const body = info.skel.bones.find((b) => /^body(_\d+)?$/.test(b.name));
    const at = info.pos.get(body).clone();
    const bodyP = new T.Object3D();
    bodyP.name = 'bodyP';
    bodyP.position.copy(at);
    inner.add(bodyP);
    bodyP.add(body);
    body.position.set(0, 0, 0);
    finishBind(src, info, 2.2);
    src.userData.dlReady = { bodyY: at.y };
    return src.userData.dlReady;
  }
  function skinnedMutant(kind, scale) {
    const K = MUT_SKIN[kind];
    const src = K && A.models[K.model];
    if (!src || !T.SkeletonUtils) return null;
    let isSkinned = false;
    src.traverse((m) => {
      if (m.isSkinnedMesh) isSkinned = true;
    });
    if (!isSkinned) return null;
    const ready = prepMutant(src);
    if (!ready) return null;
    const root = T.SkeletonUtils.clone(src);
    const n = by(root);
    const eyes = [];
    root.traverse((m) => {
      if (!m.isMesh) return;
      const name = (m.material && m.material.name) || '';
      m.castShadow = true;
      m.receiveShadow = true;
      if (name.startsWith('eye')) {
        m.material = skinnedMat('mueye|' + K.eye, () => new T.MeshBasicMaterial({ color: K.eye }));
        m.castShadow = false;
        eyes.push(m);
      } else if (name === 'mskin' || name.startsWith('bake')) {
        m.material = skinnedMat('mu|' + K.model, () => new T.MeshStandardMaterial({
          map: A.tex['mu_' + K.model + '_c'] || null, normalMap: A.tex['mu_' + K.model + '_n'] || null,
          roughnessMap: A.tex['mu_' + K.model + '_r'] || null, roughness: 1, metalness: 0, color: new T.Color(1.15, 1.15, 1.15),
        }));
      } else {
        const role = name.replace(/\.\d+$/, '');
        m.material = skinnedMat('murole|' + role, () => DL.roleMat(role).clone());
      }
    });
    const inner = n('inner');
    inner.scale.setScalar(scale);
    const body = n('bodyP');
    const legs = [['legFL', 'kneeFL', true], ['legFR', 'kneeFR', true], ['legBL', 'kneeBL', false], ['legBR', 'kneeBR', false]].map(([a, b, f]) => ({
      top: n(a), kn: n(b), front: f, base: 0,
    }));
    const tail = [n('tail1'), n('tail2')].filter(Boolean);
    return { root, inner, body, head: n('head'), jaw: n('jaw'), legs, eyes, scale, bodyY: ready.bodyY, skinned: true, tail };
  }
  DL.gfx.mutant = function (kind, scale) {
    const sk = skinnedMutant(kind, scale);
    if (sk) return sk;
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
