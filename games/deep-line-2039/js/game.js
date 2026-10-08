'use strict';
// メインループ・入力・章の読み込み・スクリプトAPI・保存
(function () {
  const DL = window.DL;
  const T = window.THREE;
  const $ = (id) => document.getElementById(id);

  // ================= 入力 =================
  class Input {
    constructor() {
      this.keys = new Set();
      this.pressedSet = new Set();
      this.mouse = [false, false, false];
      this.mousePressedSet = new Set();
      this.lookX = 0;
      this.lookY = 0;
      this.wheel = 0;
      this.locked = false;
    }
    down(...codes) {
      for (const c of codes) if (this.keys.has(c)) return true;
      return false;
    }
    pressed(c) {
      return this.pressedSet.has(c);
    }
    mouseDown(b) {
      return this.mouse[b];
    }
    mousePressed(b) {
      return this.mousePressedSet.has(b);
    }
    press(c) {
      if (!this.keys.has(c)) this.pressedSet.add(c);
      this.keys.add(c);
    }
    release(c) {
      this.keys.delete(c);
    }
    clear() {
      this.keys.clear();
      this.mouse = [false, false, false];
    }
    endFrame() {
      this.pressedSet.clear();
      this.mousePressedSet.clear();
      this.lookX = 0;
      this.lookY = 0;
      this.wheel = 0;
    }
  }

  const DEFAULT_SETTINGS = { sens: 1, vol: 0.8, fov: 75, diff: 1, shadows: true, invert: false };

  // ================= ゲーム =================
  class Game {
    constructor() {
      DL.game = this;
      this.canvas = $('gl');
      const R = (this.renderer = new T.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' }));
      R.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      R.setSize(window.innerWidth, window.innerHeight, false);
      R.outputEncoding = T.sRGBEncoding;
      R.toneMapping = T.ACESFilmicToneMapping;
      R.toneMappingExposure = 1.15;
      R.shadowMap.enabled = true;
      R.shadowMap.type = T.PCFSoftShadowMap;
      R.autoClear = false;
      this.camera = new T.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 300);
      this.camera.rotation.order = 'YXZ';
      this.vmScene = new T.Scene();
      this.vmCam = new T.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.01, 10);
      this.flashlight = new T.SpotLight(0xffeed4, 0, 28, 0.44, 0.65, 2);
      this.flashlight.position.set(0.18, -0.12, 0.1);
      this.flashlight.target.position.set(0.05, -0.1, -6);
      this.flashlight.shadow.mapSize.set(1024, 1024);
      this.flashlight.shadow.camera.near = 0.3;
      this.flashlight.shadow.camera.far = 34;
      this.flashlight.shadow.bias = -0.0004;
      this.camera.add(this.flashlight);
      this.camera.add(this.flashlight.target);
      this.hemi = new T.HemisphereLight(0x8a9098, 0x1a1816, 0.1);
      this.sun = new T.DirectionalLight(0xc8c4b8, 0);
      this.sun.position.set(30, 60, 20);
      this.input = new Input();
      this.audio = new DL.AudioEngine();
      this.ui = new DL.UI(this);
      this.settings = Object.assign({}, DEFAULT_SETTINGS, DL.store.get('settings', {}));
      this.settings.diffMul = +this.settings.diff;
      this.applySettings();
      this.time = 0;
      this.dt = 0;
      this.state = 'boot';
      this.token = 0;
      this.waiters = [];
      this.entities = [];
      this.lamps = [];
      this.interacts = [];
      this.zones = [];
      this.flags = {};
      this.notes = [];
      this.env = {};
      this.level = null;
      this.chapter = 0;
      this.stage = 0;
      this.flowT = 0;
      this.litT = 0;
      this.newScene();
      this.player = new DL.Player(this);
      this.bindEvents();
      this.bindMenus();
      this.last = performance.now();
      this.frame = this.frame.bind(this);
      requestAnimationFrame(this.frame);
    }
    newScene() {
      this.scene = new T.Scene();
      this.scene.add(this.camera);
      this.scene.add(this.hemi);
      this.scene.add(this.sun);
      this.lightPool = new DL.LightPool(this.scene, 8);
      this.fx = new DL.FX(this);
    }
    applySettings() {
      const s = this.settings;
      s.diffMul = +s.diff;
      this.audio.setVolume(s.vol);
      this.flashlight.castShadow = !!s.shadows;
      DL.store.set('settings', { sens: s.sens, vol: s.vol, fov: s.fov, diff: s.diff, shadows: s.shadows, invert: s.invert });
    }

    // ---------- イベント ----------
    bindEvents() {
      window.addEventListener('resize', () => {
        const w = window.innerWidth, h = window.innerHeight;
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.vmCam.aspect = w / h;
        this.vmCam.updateProjectionMatrix();
      });
      window.addEventListener('keydown', (e) => this.onKeyDown(e));
      window.addEventListener('keyup', (e) => this.input.release(e.code));
      window.addEventListener('blur', () => this.input.clear());
      window.addEventListener('mousemove', (e) => {
        if (this.state !== 'play') return;
        // ポインタロックが使えない環境では、ボタンを押さずにマウスを動かすだけで視点が回る
        if (this.input.locked || this.noLock) {
          this.input.lookX += DL.clamp(e.movementX || 0, -250, 250);
          this.input.lookY += DL.clamp(e.movementY || 0, -250, 250);
        }
      });
      this.canvas.addEventListener('mousedown', (e) => {
        if (this.state !== 'play') return;
        if (!this.input.locked && !this.noLock) {
          this.requestLock();
          if (this.lockTried) return;
        }
        this.input.mouse[e.button] = true;
        this.input.mousePressedSet.add(e.button);
      });
      window.addEventListener('mouseup', (e) => {
        this.input.mouse[e.button] = false;
      });
      window.addEventListener('contextmenu', (e) => {
        if (this.state === 'play') e.preventDefault();
      });
      window.addEventListener('wheel', (e) => {
        if (this.state === 'play') this.input.wheel += Math.sign(e.deltaY);
      }, { passive: true });
      document.addEventListener('pointerlockchange', () => {
        const locked = document.pointerLockElement === this.canvas;
        this.input.locked = locked;
        if (locked) this.hadLock = true;
        else if (this.state === 'play' && this.hadLock) this.pause();
      });
      document.addEventListener('pointerlockerror', () => {
        this.noLock = true;
      });
      document.addEventListener('visibilitychange', () => {
        if (document.hidden && this.state === 'play') this.pause();
      });
    }
    requestLock() {
      this.lockTried = false;
      if (this.noLock) return;
      try {
        const r = this.canvas.requestPointerLock();
        this.lockTried = true;
        if (r && r.catch) {
          r.catch(() => {
            this.noLock = true;
            this.lockTried = false;
          });
        }
      } catch (e) {
        this.noLock = true;
      }
    }
    onKeyDown(e) {
      const c = e.code;
      if (this.state === 'play') {
        if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Quote', 'Slash'].includes(c)) e.preventDefault();
        if (e.repeat) return;
        if (this.ui.modal) {
          if (this.ui.onKey(c)) return;
        }
        if (c === 'Tab') {
          this.ui.openJournal();
          return;
        }
        if (c === 'Escape' || c === 'KeyP') {
          if (!this.input.locked) this.pause();
          else document.exitPointerLock();
          return;
        }
        if (this.debug && c === 'F9') this.player.hp = 100;
        this.input.press(c);
      } else if (this.state === 'pause') {
        if ((c === 'Escape' || c === 'KeyP') && !e.repeat) this.resume();
      } else if (this.state === 'dead') {
        if (c === 'KeyR') this.retry();
      }
    }

    // ---------- メニュー ----------
    bindMenus() {
      const screens = ['menu', 'chapters', 'settings', 'controls', 'pause', 'death'];
      this.showScreen = (id) => {
        for (const s of screens) $(s).hidden = s !== id;
        this.screen = id;
      };
      $('splash').addEventListener('click', () => this.leaveSplash());
      $('btn-new').addEventListener('click', () => this.newGame());
      $('btn-continue').addEventListener('click', () => this.continueGame());
      $('btn-chapters').addEventListener('click', () => {
        this.renderChapters();
        this.backTo = 'menu';
        this.showScreen('chapters');
      });
      $('btn-settings').addEventListener('click', () => {
        this.backTo = 'menu';
        this.openSettings();
      });
      $('btn-controls').addEventListener('click', () => {
        this.backTo = 'menu';
        this.showScreen('controls');
      });
      $('btn-resume').addEventListener('click', () => this.resume());
      $('btn-pause-settings').addEventListener('click', () => {
        this.backTo = 'pause';
        this.openSettings();
      });
      $('btn-pause-controls').addEventListener('click', () => {
        this.backTo = 'pause';
        this.showScreen('controls');
      });
      $('btn-pause-retry').addEventListener('click', () => this.retry());
      $('btn-pause-title').addEventListener('click', () => this.toTitle());
      $('btn-retry').addEventListener('click', () => this.retry());
      $('btn-death-title').addEventListener('click', () => this.toTitle());
      document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => {
        this.audio.ui(500);
        this.showScreen(this.backTo || 'menu');
      }));
      document.querySelectorAll('.btn').forEach((b) => b.addEventListener('mouseenter', () => this.audio.ui(980)));
      const bindRange = (id, key, fmt) => {
        const el = $(id), out = $('out-' + id.split('-')[1]);
        el.addEventListener('input', () => {
          this.settings[key] = +el.value;
          if (out) out.textContent = fmt(+el.value);
          this.applySettings();
        });
      };
      bindRange('set-sens', 'sens', (v) => v.toFixed(2));
      bindRange('set-vol', 'vol', (v) => Math.round(v * 100) + '%');
      bindRange('set-fov', 'fov', (v) => v + '°');
      $('set-diff').addEventListener('change', (e) => {
        this.settings.diff = +e.target.value;
        this.applySettings();
      });
      $('set-shadow').addEventListener('change', (e) => {
        this.settings.shadows = e.target.checked;
        this.applySettings();
        this.renderer.shadowMap.needsUpdate = true;
        this.scene.traverse((o) => {
          if (o.material) o.material.needsUpdate = true;
        });
      });
      $('set-invert').addEventListener('change', (e) => {
        this.settings.invert = e.target.checked;
        this.applySettings();
      });
      if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(pointer: fine)').matches) $('touchwarn').hidden = false;
    }
    openSettings() {
      const s = this.settings;
      $('set-sens').value = s.sens;
      $('out-sens').textContent = (+s.sens).toFixed(2);
      $('set-vol').value = s.vol;
      $('out-vol').textContent = Math.round(s.vol * 100) + '%';
      $('set-fov').value = s.fov;
      $('out-fov').textContent = s.fov + '°';
      $('set-diff').value = String(s.diff);
      $('set-shadow').checked = !!s.shadows;
      $('set-invert').checked = !!s.invert;
      this.showScreen('settings');
    }
    renderChapters() {
      const unlocked = DL.store.get('unlocked', 0);
      const list = $('chapter-list');
      list.innerHTML = '';
      DL.CHAPTERS.forEach((c, i) => {
        const b = document.createElement('button');
        b.className = 'chap';
        b.type = 'button';
        b.disabled = i > unlocked && !this.debug;
        b.innerHTML = `<span class="n">${c.num}</span><span class="t">${i > unlocked && !this.debug ? '未到達' : c.title}</span><span class="p">${i > unlocked && !this.debug ? '―' : c.place}</span>`;
        b.addEventListener('click', () => this.startChapter(i));
        list.appendChild(b);
      });
    }
    leaveSplash() {
      if (this.state !== 'boot' || !this.ready) return;
      this.audio.init();
      this.audio.setVolume(this.settings.vol);
      $('splash').hidden = true;
      this.toTitle();
    }
    toTitle() {
      this.token++;
      this.waiters = [];
      if (document.pointerLockElement) document.exitPointerLock();
      this.ui.hideCard();
      this.ui.showHUD(false);
      this.ui.forceCloseAll();
      this.ui.el.choice.hidden = true;
      this.ui.modal = null;
      this.ui.clearSub();
      this.ui.fadeTo(0, 10);
      if (this.audio.ctx && this.audio.ctx.state === 'suspended') this.audio.ctx.resume();
      this.audio.stopLoops();
      this.buildMenuScene();
      this.state = 'menu';
      this.showScreen('menu');
      $('btn-continue').disabled = !DL.store.get('save', null);
      this.audio.startGuitar(null, 0.32);
      this.audio.setAmbience('tunnel');
    }
    buildMenuScene() {
      this.clearLevel();
      this.newScene();
      const W = (this.world = new DL.World(12, 40));
      W.carve(4, 0, 5, 39, { f: 0, c: 4.4, fm: 'gravel', wm: 'concrete' });
      W.carve(6, 14, 7, 17, { f: 0, c: 3, fm: 'concrete', wm: 'brick' });
      const L = new DL.LevelCtx(this, { env: {} });
      L.track(10, 0, 10, 80);
      L.tunnelDecor(8, 0, 12, 80, 'z');
      L.lamp('cage', 8.15, 3.0, 22, { yaw: -Math.PI / 2, intensity: 1.2, range: 12, flicker: 0.35 });
      L.lamp('cage', 11.85, 3.0, 46, { yaw: Math.PI / 2, intensity: 1.0, range: 12 });
      L.lamp('cage', 8.15, 3.0, 70, { yaw: -Math.PI / 2, intensity: 0.8, range: 10, color: 0xff6040 });
      L.prop('barrel', 9, 30, {});
      L.prop('crates', 11, 52, { seed: 4 });
      L.prop('corpse', 9.3, 40, { rot: 1.2, mask: true });
      L.prop('rubble', 10, 76, { w: 3.6, d: 3, h: 2, seed: 3 });
      W.build();
      this.scene.add(W.group);
      this.applyEnv({ fog: 0x050607, density: 0.07, hemi: 0.06, amb: 'tunnel', exposure: 1.2 });
      this.menuT = 0;
      this.player.flash.on = true;
    }
    updateMenu(dt) {
      this.time += dt;
      this.menuT += dt;
      const z = 8 + (this.menuT * 0.6) % 50;
      const cam = this.camera;
      cam.position.set(10.4 + Math.sin(this.menuT * 0.3) * 0.2, 1.55 + Math.sin(this.menuT * 1.4) * 0.02, z);
      cam.rotation.set(-0.04, Math.PI + Math.sin(this.menuT * 0.17) * 0.12, 0);
      if (cam.fov !== 70) {
        cam.fov = 70;
        cam.updateProjectionMatrix();
      }
      this.flashlight.intensity = 1.0;
      this.updateLamps(dt);
      this.lightPool.update(this.lamps, cam.position);
      this.fx.update(dt, cam.position);
      this.audio.setListener(cam.position.x, cam.position.y, cam.position.z, cam.rotation.y);
      this.audio.update(dt, null);
      this.ui.drawGrain();
    }

    // ---------- ゲーム開始 ----------
    newGame() {
      this.flags = {};
      this.notes = [];
      this.player.reset();
      this.loadChapter(0, 0, null, false);
    }
    continueGame() {
      const s = DL.store.get('save', null);
      if (!s) return;
      this.flags = Object.assign({}, s.flags || {});
      this.notes = (s.notes || []).slice();
      this.loadChapter(s.ch, s.stage, s.snap, s.stage > 0);
    }
    startChapter(i) {
      const snaps = DL.store.get('chsnap', {});
      const fl = DL.store.get('chflags', {});
      const c = DL.CHAPTERS[i];
      this.flags = Object.assign({}, fl[i] || {});
      this.notes = [];
      this.loadChapter(i, 0, snaps[i] || c.kit || null, false);
    }
    retry() {
      const s = this.cp;
      if (!s) return;
      $('death').hidden = true;
      $('pause').hidden = true;
      this.flags = Object.assign({}, s.flags);
      this.notes = s.notes.slice();
      this.loadChapter(s.ch, s.stage, s.snap, true);
    }
    clearLevel() {
      this.token++;
      this.waiters = [];
      for (const e of this.entities) e.remove();
      this.entities = [];
      this.lamps = [];
      this.interacts = [];
      this.zones = [];
      this.audio.stopLoops();
      this.audio.stopGuitar();
      if (this.world) {
        for (const m of this.world.meshes) m.geometry.dispose();
      }
      if (this.scene) {
        this.scene.traverse((o) => {
          if (o.isMesh && o.geometry && !DL.isSharedGeo(o.geometry)) o.geometry.dispose();
        });
      }
      this.L = null;
    }
    async loadChapter(ch, stage, snap, quick) {
      const def = DL.CHAPTERS[ch];
      if (!def) return;
      this.state = 'loading';
      if (document.pointerLockElement) document.exitPointerLock();
      $('pause').hidden = true;
      $('death').hidden = true;
      this.showScreen(null);
      this.ui.showHUD(false);
      this.ui.forceCloseAll();
      this.ui.el.choice.hidden = true;
      this.ui.modal = null;
      this.ui.clearSub();
      this.audio.stopGuitar();
      if (this.audio.ctx && this.audio.ctx.state === 'suspended') this.audio.ctx.resume();
      let cardP = null;
      if (!quick) {
        cardP = this.ui.card({ num: def.num, title: def.title, lines: def.intro });
        this.audio.setAmbience(null);
      } else await this.ui.fadeTo(1, 250);
      await new Promise((r) => setTimeout(r, 60));
      this.buildLevel(ch, stage, snap);
      if (cardP) await cardP;
      this.ui.hideCard();
      this.ui.el.fade.style.transition = 'none';
      this.ui.el.fade.style.opacity = 1;
      this.ui.showHUD(true);
      this.ui.resetHudCache();
      this.state = 'play';
      this.requestLock();
      this.ui.fadeTo(0, 1200);
      this.runStages(stage);
    }
    buildLevel(ch, stage, snap) {
      const def = DL.CHAPTERS[ch];
      this.clearLevel();
      this.newScene();
      this.chapter = ch;
      this.stage = stage;
      this.level = def;
      this.time = 0;
      this.player.restore(snap || def.kit || null);
      this.player.alive = true;
      this.player.hp = 100;
      this.player.lastHurt = -99;
      const W = (this.world = new DL.World(def.w, def.h));
      const L = (this.L = new DL.LevelCtx(this, def));
      def.build(L);
      W.build();
      this.scene.add(W.group);
      this.applyEnv(def.env);
      for (let i = 0; i < stage; i++) if (def.stages[i].skip) def.stages[i].skip(L);
      const st = def.stages[stage];
      const s = st.start || def.stages[0].start;
      this.player.place(s[0], W.floorAt(s[0], s[1]), s[1], s[2] || 0);
      if (s[3] !== undefined) this.player.flash.on = s[3];
      if (def.flash !== undefined && stage === 0) this.player.flash.on = def.flash;
      this.camera.position.set(s[0], this.player.camY, s[1]);
      // 最初の数フレームで影・シェーダーを準備
      this.renderer.compile(this.scene, this.camera);
    }
    async runStages(from) {
      const def = this.level, L = this.L, tok = this.token;
      for (let s = from; s < def.stages.length; s++) {
        if (tok !== this.token) return;
        this.stage = s;
        this.checkpoint(s);
        try {
          await def.stages[s].run(L);
        } catch (err) {
          console.error('stage error', err);
          return;
        }
      }
    }
    checkpoint(stage) {
      const snap = this.player.snapshot();
      this.cp = { ch: this.chapter, stage, snap, flags: Object.assign({}, this.flags), notes: this.notes.slice() };
      DL.store.set('save', this.cp);
      if (stage === 0) {
        const snaps = DL.store.get('chsnap', {});
        snaps[this.chapter] = snap;
        DL.store.set('chsnap', snaps);
        const fl = DL.store.get('chflags', {});
        fl[this.chapter] = Object.assign({}, this.flags);
        DL.store.set('chflags', fl);
        DL.store.set('unlocked', Math.max(DL.store.get('unlocked', 0), this.chapter));
      } else this.ui.toast('記録した');
    }
    async nextChapter() {
      const n = this.chapter + 1;
      this.state = 'loading';
      await this.ui.fadeTo(1, 1200);
      DL.store.set('unlocked', Math.max(DL.store.get('unlocked', 0), n));
      const snap = this.player.snapshot();
      this.ui.fadeTo(0, 10);
      this.loadChapter(n, 0, snap, false);
    }
    pause() {
      if (this.state !== 'play') return;
      this.state = 'pause';
      this.input.clear();
      this.ui.forceCloseAll();
      this.backTo = 'pause';
      this.showScreen('pause');
      if (this.audio.ctx) this.audio.ctx.suspend();
    }
    resume() {
      if (this.state !== 'pause') return;
      this.showScreen(null);
      this.state = 'play';
      if (this.audio.ctx) this.audio.ctx.resume();
      this.requestLock();
    }
    onPlayerDeath() {
      this.state = 'dying';
      this.ui.clearSub();
      setTimeout(() => {
        if (this.state !== 'dying') return;
        this.state = 'dead';
        if (document.pointerLockElement) document.exitPointerLock();
        this.ui.showHUD(false);
        this.showScreen('death');
      }, 1900);
    }
    onEntityDeath(e) {
      if (this.L && this.L.onDeath) this.L.onDeath(e);
    }

    // ---------- 環境 ----------
    applyEnv(env) {
      this.env = env;
      this.scene.fog = new T.FogExp2(env.fog !== undefined ? env.fog : 0x050607, env.density || 0.06);
      this.scene.background = new T.Color(env.bg !== undefined ? env.bg : env.fog !== undefined ? env.fog : 0x050607);
      this.hemi.color.setHex(env.hemiSky || 0x8a9098);
      this.hemi.groundColor.setHex(env.hemiGround || 0x1a1816);
      this.hemi.intensity = env.hemi !== undefined ? env.hemi : 0.08;
      this.sun.intensity = env.sun || 0;
      this.renderer.toneMappingExposure = env.exposure || 1.15;
      this.audio.setAmbience(env.amb || 'tunnel');
      this.audio.setReverb(env.reverb !== undefined ? env.reverb : 0.6);
      this.fx.setMotes(!env.outdoor);
      this.fx.setAsh(!!env.ash);
      this.baseFog = new T.Color(env.fog !== undefined ? env.fog : 0x050607);
      this.baseDensity = env.density || 0.06;
    }
    toxicAt(p) {
      let t = 0;
      for (const z of this.zones) {
        if (p.x >= z.x0 && p.x <= z.x1 && p.z >= z.z0 && p.z <= z.z1 && p.y <= (z.y1 !== undefined ? z.y1 : 999)) t = Math.max(t, z.s);
      }
      if (this.env.rad && this.world.skyAt(p.x, p.z)) t = Math.max(t, this.env.rad);
      return t;
    }

    // ---------- エンティティ ----------
    addEntity(e) {
      this.entities.push(e);
      return e;
    }
    spawnPickup(type, amount, x, z, y) {
      const yy = y !== undefined ? y : this.world.groundAt(x, z, 0.1, 50, 0.1);
      return this.addEntity(new DL.Pickup(this, type, amount, x, yy, z));
    }
    addInteract(it) {
      this.interacts.push(it);
      return it;
    }
    removeInteract(it) {
      const i = this.interacts.indexOf(it);
      if (i >= 0) this.interacts.splice(i, 1);
    }
    noiseAt(pos, radius, kind, src) {
      const r2 = radius * radius;
      for (const e of this.entities) {
        if (e === src || !e.alive || !e.hear) continue;
        const dx = e.pos.x - pos.x, dz = e.pos.z - pos.z;
        if (dx * dx + dz * dz < r2) e.hear(pos, kind);
      }
    }
    hitscan(ox, oy, oz, dx, dy, dz, dmg, src, pellet) {
      const W = this.world;
      const wr = W.raycast(ox, oy, oz, dx, dy, dz, 140);
      let best = wr.hit ? wr.t : 140;
      const wx = wr.x, wy = wr.y, wz = wr.z, wnx = wr.nx, wny = wr.ny, wnz = wr.nz, wcol = wr.collider;
      let hitE = null, part = null;
      for (const e of this.entities) {
        if (!e.alive || !e.shootable) continue;
        const h = e.rayHit(ox, oy, oz, dx, dy, dz, best);
        if (h) {
          best = h.t;
          hitE = e;
          part = h.part;
        }
      }
      let hitLamp = null;
      for (const L of this.lamps) {
        if (!L.shootable || L.broken) continue;
        const t = DL.raySphere(ox, oy, oz, dx, dy, dz, L.x, L.y, L.z, 0.24);
        if (t >= 0 && t < best) {
          best = t;
          hitLamp = L;
          hitE = null;
        }
      }
      const px = ox + dx * best, py = oy + dy * best, pz = oz + dz * best;
      if (hitE) {
        hitE.hurt(dmg, part, { x: ox, y: oy, z: oz }, src);
        this.fx.blood(px, py, pz, pellet ? 3 : 7);
        if (!pellet || Math.random() < 0.3) this.audio.impact({ x: px, y: py, z: pz }, 'flesh');
        if (src === 'player') this.ui.hitmarker(part === 'head');
        // 背後の壁に血しぶき
        if (Math.random() < 0.3) {
          const r2 = W.raycast(px, py, pz, dx, dy, dz, 3);
          if (r2.hit) this.fx.decalBlood(r2.x, r2.y, r2.z, r2.nx, r2.ny, r2.nz, 0.5);
        }
      } else if (hitLamp) {
        this.breakLamp(hitLamp);
      } else if (wr.hit) {
        this.fx.sparks(wx, wy, wz, wnx, wny, wnz, pellet ? 2 : 6);
        this.fx.decalHole(wx, wy, wz, wnx, wny, wnz);
        if (!pellet || Math.random() < 0.3) this.audio.impact({ x: wx, y: wy, z: wz }, wcol && wcol.mat === 'metal' ? 'metal' : 'wall');
      }
      return best;
    }
    breakLamp(L) {
      L.broken = true;
      L.on = false;
      this.audio.glass(L);
      this.fx.sparks(L.x, L.y, L.z, 0, -1, 0, 10);
      if (L.bulb) L.bulb.visible = false;
      if (L.glow) L.glow.visible = false;
      this.noiseAt(L, 8, 'step');
    }
    updateLamps(dt) {
      const t = this.time;
      for (const L of this.lamps) {
        if (L.transient) continue;
        let f = 1;
        if (!L.on || L.broken) f = 0;
        else if (L.kind === 'fire') f = 0.82 + Math.sin(t * 11 + L.ph) * 0.1 + Math.sin(t * 23.7 + L.ph * 3) * 0.08;
        else if (L.flicker) {
          const n = Math.sin(t * L.fs + L.ph) * Math.sin(t * L.fs * 2.31 + L.ph * 1.7) + Math.sin(t * 0.7 + L.ph) * 0.3;
          if (n > 1.05 - L.flicker) f = 0.12 + Math.random() * 0.2;
          else f = 0.93 + Math.random() * 0.07;
        }
        if (L.follow) {
          const e = L.follow;
          L.x = e.pos.x;
          L.y = e.pos.y + 1.0;
          L.z = e.pos.z;
          if (!e.alive) L.on = false;
        }
        f *= L.dim !== undefined ? L.dim : 1;
        L._f = f;
        if (L.bulb && L.bulbColor) L.bulb.material.color.copy(L.bulbColor).multiplyScalar(0.12 + 0.88 * Math.min(1, f));
        if (L.glow) L.glow.material.opacity = 0.55 * Math.min(1, f) * (L.glowA || 1);
      }
    }
    computeLit() {
      const P = this.player, p = P.pos, ey = p.y + 1.1, W = this.world;
      let lit = 0;
      for (const L of this.lamps) {
        if (!L.on || L.broken || L._f < 0.05) continue;
        const dx = L.x - p.x, dy = L.y - ey, dz = L.z - p.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > L.range * L.range) continue;
        const d = Math.sqrt(d2);
        const c = L.intensity * L._f * Math.pow(1 - d / L.range, 2) * 1.3;
        if (c < 0.03) continue;
        if (!W.los(L.x, L.y - 0.2, L.z, p.x, ey, p.z)) continue;
        lit += c;
      }
      if (P.flash.on && P.flashPower() > 0) lit += 0.5;
      if (this.env.outdoor) lit += 0.7;
      P.lit = DL.clamp(lit, 0, 1);
    }

    // ---------- スクリプトAPI ----------
    wait(s) {
      return new Promise((res) => this.waiters.push({ until: this.time + s, res, tok: this.token }));
    }
    until(fn) {
      return new Promise((res) => this.waiters.push({ pred: fn, res, tok: this.token }));
    }
    tickWaiters() {
      const ws = this.waiters;
      for (let i = ws.length - 1; i >= 0; i--) {
        const w = ws[i];
        if (w.tok !== this.token) {
          ws.splice(i, 1);
          continue;
        }
        let ok = false;
        try {
          ok = w.pred ? w.pred() : this.time >= w.until;
        } catch (e) {
          console.error(e);
          ws.splice(i, 1);
          continue;
        }
        if (ok) {
          ws.splice(i, 1);
          w.res();
        }
      }
    }
    async say(name, text, dur) {
      const d = dur || Math.max(2.2, text.length * 0.12 + 1.0);
      const t = this.ui.sub(name, text);
      await this.wait(d);
      this.ui.clearSub(t);
    }
    async choose(q, opts) {
      this.ui.openChoice(q, opts);
      await this.until(() => this.ui.choiceRes !== null);
      return this.ui.choiceRes;
    }
    moralScore() {
      const f = this.flags;
      let s = 0;
      for (const k of ['yuki', 'sota', 'traveler', 'mother', 'prisoner', 'spared']) if (f[k] === true) s++;
      if (f.executed) s--;
      if (f.killedMother) s--;
      return s;
    }
    async showEnding(kind) {
      this.state = 'ending';
      this.token++;
      if (document.pointerLockElement) document.exitPointerLock();
      await this.ui.fadeTo(1, 2000);
      this.ui.showHUD(false);
      this.clearLevel();
      const E = DL.ENDINGS[kind];
      const f = this.flags;
      const list = [];
      if (f.yuki) list.push('月島で、ユキに軍用弾を一発あげた。');
      if (f.sota) list.push('ソウタの歌を最後まで聴いた。');
      if (f.traveler) list.push('トンネルで、傷ついた旅人に医療キットを渡した。');
      if (f.mother) list.push('銀座で、子を守る母獣を撃たずに通り過ぎた。');
      if (f.killedMother) list.push('銀座で、母獣とその仔を撃った。');
      if (f.prisoner) list.push('赤環の檻から、行商人ヤマダを逃がした。');
      if (f.spared) list.push('降伏した赤環の兵を見逃した。');
      if (f.executed) list.push('降伏した赤環の兵を撃った。');
      if (!list.length) list.push('あなたは、ただ前だけを見て進んだ。');
      DL.store.set('cleared', true);
      DL.store.del('save');
      this.ui.fadeTo(0, 10);
      this.audio.startGuitar(null, 0.4);
      const r = await this.ui.card({ num: E.num, title: E.title, lines: E.lines, list: ['― あなたの旅 ―'].concat(list), buttons: ['タイトルへ戻る'] });
      void r;
      this.ui.hideCard();
      this.toTitle();
    }

    // ---------- インタラクト ----------
    findInteract() {
      const cam = this.camera.position;
      const fwd = this.tmpF || (this.tmpF = new T.Vector3());
      fwd.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
      let best = null, bs = 1e9;
      for (const it of this.interacts) {
        if (it.enabled && !it.enabled()) continue;
        let x, y, z;
        if (it.entity) {
          const e = it.entity;
          x = e.pos.x;
          z = e.pos.z;
          y = e.pos.y + (e.pose === 'stand' ? 1.35 : 0.9);
        } else {
          x = it.pos.x;
          y = it.pos.y;
          z = it.pos.z;
        }
        const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > (it.r || 2.2)) continue;
        const dot = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / (d || 1);
        if (dot < 0.72 && d > 1.1) continue;
        const sc = (1 - dot) * 12 + d * 0.35 - (it.entity ? 0.15 : 0);
        if (sc < bs) {
          if (!this.world.los(cam.x, cam.y, cam.z, x, y, z) && d > 1.2) continue;
          bs = sc;
          best = it;
        }
      }
      return best;
    }

    // ---------- ループ ----------
    frame(now) {
      requestAnimationFrame(this.frame);
      let dt = (now - this.last) / 1000;
      this.last = now;
      if (!(dt > 0)) dt = 0.016;
      dt = Math.min(dt, 0.05);
      try {
        if (this.state === 'play' || this.state === 'dying') {
          const n = this.debug && this.steps ? this.steps : 1;
          for (let i = 0; i < n && (this.state === 'play' || this.state === 'dying'); i++) {
            this.update(dt);
            if (i < n - 1) this.input.endFrame();
          }
        }
        else if (this.state === 'menu') this.updateMenu(dt);
        else if (this.state === 'pause' || this.state === 'dead' || this.state === 'loading' || this.state === 'ending') this.ui.drawGrain();
      } catch (e) {
        console.error(e);
      }
      this.render();
      this.input.endFrame();
    }
    update(dt) {
      this.time += dt;
      this.dt = dt;
      const P = this.player, I = this.input;
      if (this.state === 'play' && !this.ui.modal && I.pressed('KeyE')) {
        const it = this.findInteract();
        if (it) it.onUse();
      }
      P.update(dt);
      this.flowT -= dt;
      if (this.flowT <= 0) {
        this.flowT = 0.33;
        this.world.computeFlow(this.world.flowM, P.pos.x, P.pos.z, 1.15, 70);
        this.world.computeFlow(this.world.flowH, P.pos.x, P.pos.z, 0.6, 70);
      }
      const ents = this.entities;
      for (let i = 0; i < ents.length; i++) {
        const e = ents[i];
        if (!e.removed) e.update(dt);
      }
      for (let i = ents.length - 1; i >= 0; i--) if (ents[i].removed) ents.splice(i, 1);
      this.updateLamps(dt);
      this.litT -= dt;
      if (this.litT <= 0) {
        this.litT = 0.15;
        this.computeLit();
      }
      const fp = P.flash.on ? P.flashPower() : 0;
      this.flashlight.intensity = fp * 1.25;
      this.lightPool.update(this.lamps, this.camera.position);
      this.fx.update(dt, this.camera.position);
      this.tickWaiters();
      if (this.L && this.L.tick) this.L.tick(dt);
      // ガス区域ではフォグを緑に寄せる
      const tox = this.toxicAt(P.pos);
      const fogTarget = this.env.gasFog && tox > 0 && !this.env.outdoor ? this.env.gasFog : null;
      if (this.scene.fog && this.baseFog) {
        const fc = this.scene.fog.color;
        const tgt = fogTarget ? (this.tmpC || (this.tmpC = new T.Color())).setHex(fogTarget) : this.baseFog;
        fc.lerp(tgt, 1 - Math.exp(-2 * dt));
        this.scene.background.copy(fc);
      }
      const it = this.state === 'play' && !this.ui.modal ? this.findInteract() : null;
      this.ui.prompt(it ? (it.name ? `${it.label}　${it.name}` : it.label) : null);
      const cam = this.camera;
      this.audio.setListener(cam.position.x, cam.position.y, cam.position.z, P.yaw);
      this.audio.update(dt, { ambient: this.env.amb, rad: this.env.rad && this.world.skyAt(P.pos.x, P.pos.z) ? this.env.rad : 0, mask: P.mask.on && P.alive, filterLow: P.filterTime < 20, breathRate: P.sprinting ? 1.8 : 1, hp: P.alive ? P.hp : 100 });
      this.ui.update(dt);
    }
    render() {
      const R = this.renderer;
      R.clear();
      R.render(this.scene, this.camera);
      if (this.state === 'play' || this.state === 'dying' || this.state === 'pause') {
        R.clearDepth();
        R.render(this.vmScene, this.vmCam);
      }
    }
  }
  DL.Game = Game;

  const shared = new Set();
  DL.isSharedGeo = (g) => {
    if (!shared.size) for (const k in DL.GEO) shared.add(DL.GEO[k]);
    return shared.has(g);
  };

  // ================= 起動 =================
  function boot(data) {
    if (data && data.save && !DL.store.get('save', null)) DL.store.set('save', data.save);
    let G;
    try {
      G = new Game();
    } catch (e) {
      console.error(e);
      $('loading').textContent = 'WebGL を初期化できませんでした。別のブラウザでお試しください。';
      return;
    }
    const params = new URLSearchParams(location.search);
    if (params.has('debug')) G.debug = true;
    const ready = () => {
      // テクスチャを先に生成しておく
      DL.getMaterials();
      G.ready = true;
      $('loading').textContent = '';
      if (params.has('ch') && G.debug) {
        G.audio.init();
        $('splash').hidden = true;
        G.startChapter(+params.get('ch'));
      }
    };
    const fontsReady = document.fonts && document.fonts.ready ? Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2500))]) : Promise.resolve();
    fontsReady.then(ready, ready);
    const hot = window.claude && window.claude.hot;
    if (hot && hot.snapshot) {
      try {
        hot.snapshot(() => ({ save: DL.store.get('save', null) }));
      } catch (e) { /* 任意 */ }
    }
  }
  // 公開ページのビューアが更新を配信するときは、その時点の進行状況を引き継ぐ
  function start() {
    const hot = window.claude && window.claude.hot;
    if (hot && hot.ready) {
      try {
        hot.ready((d) => boot(d || {}));
        return;
      } catch (e) { /* 通常起動へ */ }
    }
    boot((hot && hot.data) || {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
