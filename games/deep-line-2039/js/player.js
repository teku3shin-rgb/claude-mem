'use strict';
// プレイヤー：移動・武器・ガスマスク・ライト・一人称モデル
(function () {
  const DL = window.DL;
  const T = window.THREE;

  const WEAP = {
    revolver: { name: 'リボルバー「六連」', short: '六連', mag: 6, ammo: 'p', dmg: 60, pellets: 1, rate: 0.42, spread: 0.012, aimSpread: 0.003, reload: 2.3, recoil: 0.045, auto: false, snd: 'revolver', noise: 45, key: 1, zoom: 20 },
    smg: { name: '短機関銃「継ぎ接ぎ」', short: '継ぎ接ぎ', mag: 30, ammo: 'r', dmg: 17, pellets: 1, rate: 0.088, spread: 0.036, aimSpread: 0.016, reload: 2.5, recoil: 0.016, auto: true, snd: 'smg', noise: 38, key: 2, mil: true, zoom: 14 },
    shotgun: { name: '二連散弾銃「鴉」', short: '鴉', mag: 2, ammo: 's', dmg: 15, pellets: 9, rate: 0.28, spread: 0.075, aimSpread: 0.055, reload: 2.1, recoil: 0.1, auto: false, snd: 'shotgun', noise: 48, key: 3, zoom: 10 },
  };
  DL.WEAP = WEAP;
  DL.AMMO_NAME = { p: '拳銃弾', r: '小銃弾', s: '散弾' };
  const FILTER_TIME = 100;
  DL.FILTER_TIME = FILTER_TIME;
  const MAX = { medkit: 5, filter: 6, bomb: 5, p: 60, r: 240, s: 40, mil: 999 };
  DL.MAXINV = MAX;

  class Player {
    constructor(G) {
      this.G = G;
      this.pos = new T.Vector3();
      this.vel = new T.Vector3();
      this.kv = new T.Vector3();
      this.yaw = 0;
      this.pitch = 0;
      this.vy = 0;
      this.onGround = true;
      this.r = 0.33;
      this.h = 1.75;
      this.camY = 0;
      this.crouch = false;
      this.trauma = 0;
      this.kick = 0;
      this.roll = 0;
      this.fov = 75;
      this.bobT = 0;
      this.bobA = 0;
      this.stepAcc = 0;
      this.lit = 0;
      this.moving = false;
      this.sprinting = false;
      this.aimT = 0;
      this.deadT = 0;
      this.coughT = 0;
      this.gasExposure = 0;
      this.swayX = 0;
      this.swayY = 0;
      this.fallV = 0;
      this.reset();
      this.initView();
    }
    reset() {
      this.hp = 100;
      this.alive = true;
      this.lastHurt = -99;
      this.inv = { medkit: 2, filter: 1, bomb: 2, mil: 15, ammo: { p: 18, r: 60, s: 0 } };
      this.weapons = ['revolver', 'smg'];
      this.mag = { revolver: 6, smg: 30, shotgun: 2 };
      this.magMil = { revolver: false, smg: false, shotgun: false };
      this.cur = 'revolver';
      this.mask = { on: false, integ: 100 };
      this.filterTime = FILTER_TIME;
      this.flash = { on: false, battery: 100 };
      this.milMode = false;
      this.act = null; // 'reload' | 'switch' | 'melee' | 'throw' | 'charge' | 'mask' | 'heal'
      this.actT = 0;
      this.fireCd = 0;
      this.nextWeapon = null;
      this.vmLower = 0;
      this.deadT = 0;
      this.trauma = 0;
      this.kick = 0;
    }
    snapshot() {
      return JSON.parse(JSON.stringify({
        inv: this.inv, weapons: this.weapons, mag: this.mag, magMil: this.magMil, cur: this.cur,
        mask: this.mask, filterTime: this.filterTime, battery: this.flash.battery, milMode: this.milMode,
      }));
    }
    restore(s) {
      this.reset();
      if (!s) return;
      this.inv = s.inv;
      this.weapons = s.weapons;
      this.mag = s.mag;
      this.magMil = s.magMil || { revolver: false, smg: false, shotgun: false };
      this.cur = s.cur;
      this.mask = { on: false, integ: s.mask ? s.mask.integ : 100 };
      this.filterTime = s.filterTime;
      this.flash.battery = s.battery;
      this.milMode = !!s.milMode;
      this.showWeapon();
    }
    place(x, y, z, yaw) {
      this.pos.set(x, y, z);
      this.yaw = yaw || 0;
      this.pitch = 0;
      this.vel.set(0, 0, 0);
      this.kv.set(0, 0, 0);
      this.vy = 0;
      this.camY = y + 1.62;
      this.crouch = false;
      this.h = 1.75;
    }
    eye() {
      return this.G.camera.position;
    }

    // ---------- 一人称モデル ----------
    initView() {
      const G = this.G;
      const S = G.vmScene;
      this.vmAmb = new T.AmbientLight(0xd8d0c0, 0.3);
      S.add(this.vmAmb);
      this.vmKey = new T.DirectionalLight(0xfff0e0, 0.4);
      this.vmKey.position.set(-0.5, 1, 0.6);
      S.add(this.vmKey);
      this.vmFlash = new T.PointLight(0xfff0d8, 0, 2.5, 2);
      this.vmFlash.position.set(0.05, 0.3, -0.75);
      S.add(this.vmFlash);
      this.vmMuzzleL = new T.PointLight(0xffa050, 0, 3, 2);
      S.add(this.vmMuzzleL);
      this.vmRoot = new T.Group();
      S.add(this.vmRoot);
      this.buildViewModels();
    }
    // アセット読み込み後にも呼び直して、Blender 製の武器に差し替える
    buildViewModels() {
      const S = this.G.vmScene;
      if (this.models) {
        for (const k in this.models) this.vmRoot.remove(this.models[k].group);
        S.remove(this.knife.group, this.charger.group, this.bombVm.group);
      }
      this.models = {};
      for (const k of ['revolver', 'smg', 'shotgun']) {
        const w = DL.Models.viewWeapon(k);
        w.group.visible = false;
        w.group.scale.setScalar(0.85);
        this.vmRoot.add(w.group);
        const fl = new T.Sprite(new T.SpriteMaterial({ map: DL.tex('flash'), transparent: true, blending: T.AdditiveBlending, depthWrite: false, depthTest: false }));
        fl.position.copy(w.parts.muzzle);
        fl.visible = false;
        fl.scale.setScalar(0.22);
        w.group.add(fl);
        w.flash = fl;
        this.models[k] = w;
      }
      this.knife = DL.Models.viewWeapon('knife');
      this.knife.group.visible = false;
      S.add(this.knife.group);
      this.charger = DL.Models.viewWeapon('charger');
      this.charger.group.visible = false;
      S.add(this.charger.group);
      this.bombVm = DL.Models.viewWeapon('bomb');
      this.bombVm.group.visible = false;
      S.add(this.bombVm.group);
      this.showWeapon();
    }
    showWeapon() {
      if (!this.models) return;
      for (const k in this.models) this.models[k].group.visible = k === this.cur;
    }

    // ---------- インベントリ ----------
    give(type, n) {
      const G = this.G, I = this.inv;
      let msg = '';
      switch (type) {
        case 'ammo_p':
        case 'ammo_r':
        case 'ammo_s': {
          const k = type.slice(5);
          if (I.ammo[k] >= MAX[k]) return false;
          I.ammo[k] = Math.min(MAX[k], I.ammo[k] + n);
          msg = `${DL.AMMO_NAME[k]} +${n}`;
          break;
        }
        case 'mil':
          I.mil += n;
          msg = `軍用弾 +${n}`;
          break;
        case 'medkit':
        case 'filter':
        case 'bomb':
          if (I[type] >= MAX[type]) return false;
          I[type] = Math.min(MAX[type], I[type] + n);
          msg = `${DL.PICK[type].name} +${n}`;
          break;
        case 'mask':
          if (this.mask.integ >= 99) return false;
          this.mask.integ = 100;
          msg = 'ガスマスクを交換した';
          break;
        case 'shotgun':
          if (this.weapons.includes('shotgun')) {
            I.ammo.s = Math.min(MAX.s, I.ammo.s + 6);
            msg = '散弾 +6';
          } else {
            this.weapons.push('shotgun');
            this.mag.shotgun = 2;
            I.ammo.s = Math.min(MAX.s, I.ammo.s + 8);
            msg = '二連散弾銃「鴉」を手に入れた [3]';
            this.switchTo('shotgun');
          }
          break;
        default:
          return false;
      }
      G.ui.toast(msg);
      G.audio.pickup();
      return true;
    }

    // ---------- ダメージ ----------
    damage(amount, from, kind) {
      const G = this.G;
      if (!this.alive || G.god) return;
      if (kind !== 'gas') amount *= G.settings.diffMul;
      this.hp -= amount;
      this.lastHurt = G.time;
      if (kind !== 'gas') {
        if (this.mask.on && this.mask.integ > 0) {
          const before = this.mask.integ;
          this.mask.integ = Math.max(0, this.mask.integ - amount * 0.35);
          if (before > 0 && this.mask.integ <= 0) {
            G.ui.toast('ガスマスクが割れた!');
            G.audio.glass(null);
            this.mask.on = false;
          }
        }
        this.shake(Math.min(0.6, 0.15 + amount / 40));
        G.ui.damage(amount, from);
        if (!this._hurtSnd || G.time - this._hurtSnd > 0.35) {
          this._hurtSnd = G.time;
          G.audio.hurtPlayer();
        }
      } else G.ui.damage(amount * 0.3, null);
      if (this.hp <= 0) this.die();
    }
    die() {
      this.hp = 0;
      this.alive = false;
      this.deadT = 0;
      this.act = null;
      this.G.onPlayerDeath();
    }
    knock(vx, vz) {
      this.kv.x += vx;
      this.kv.z += vz;
    }
    shake(a) {
      this.trauma = Math.min(1.2, this.trauma + a);
    }

    // ---------- 更新 ----------
    update(dt) {
      const G = this.G, I = G.input, W = G.world;
      if (!this.alive) {
        this.deadT += dt;
        const k = Math.min(1, this.deadT / 1.2);
        const cam = G.camera;
        cam.position.y = DL.lerp(this.camY, this.pos.y + 0.3, DL.smooth(k));
        cam.rotation.z = DL.smooth(k) * 0.9;
        cam.rotation.x = this.pitch * (1 - k) - 0.3 * k;
        this.vmRoot.position.y = -k;
        return;
      }
      const busy = G.ui.modal;
      // ---- 視点 ----
      const sens = G.settings.sens * 0.0019 * (this.aimT > 0.5 ? 0.6 : 1);
      this.yaw -= I.lookX * sens;
      this.pitch -= I.lookY * sens * (G.settings.invert ? -1 : 1);
      if (I.down('ArrowLeft')) this.yaw += 2.2 * dt;
      if (I.down('ArrowRight')) this.yaw -= 2.2 * dt;
      if (I.down('ArrowUp')) this.pitch += 1.6 * dt;
      if (I.down('ArrowDown')) this.pitch -= 1.6 * dt;
      this.pitch = DL.clamp(this.pitch, -1.5, 1.5);
      this.swayX = DL.damp(this.swayX, DL.clamp(I.lookX * 0.0015, -0.04, 0.04), 8, dt);
      this.swayY = DL.damp(this.swayY, DL.clamp(I.lookY * 0.0015, -0.04, 0.04), 8, dt);

      // ---- 操作 ----
      if (!busy) this.handleActions(dt, I);

      // ---- 移動 ----
      let fwd = 0, str = 0;
      if (!busy) {
        fwd = (I.down('KeyW') ? 1 : 0) - (I.down('KeyS') ? 1 : 0);
        str = (I.down('KeyD') ? 1 : 0) - (I.down('KeyA') ? 1 : 0);
      }
      const aiming = this.aimT > 0.3;
      this.sprinting = !busy && I.down('ShiftLeft', 'ShiftRight') && fwd > 0 && !this.crouch && !aiming && this.act !== 'charge';
      let spd = this.crouch ? 1.9 : this.sprinting ? 6.0 : 3.6;
      if (aiming) spd = Math.min(spd, 2.4);
      if (this.act === 'charge') spd = Math.min(spd, 1.8);
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      let wx = -sy * fwd + cy * str, wz = -cy * fwd - sy * str;
      const wl = Math.hypot(wx, wz);
      if (wl > 1) {
        wx /= wl;
        wz /= wl;
      }
      const acc = this.onGround ? 11 : 2.5;
      this.vel.x = DL.damp(this.vel.x, wx * spd, acc, dt);
      this.vel.z = DL.damp(this.vel.z, wz * spd, acc, dt);
      this.kv.multiplyScalar(Math.max(0, 1 - 5 * dt));
      if (!busy && I.pressed('Space') && this.onGround && !this.crouch) {
        this.vy = 5.1;
        this.onGround = false;
      }
      const p = this.pos;
      const ox = p.x, oz = p.z;
      p.x += (this.vel.x + this.kv.x) * dt;
      p.z += (this.vel.z + this.kv.z) * dt;
      W.collide(p, this.r, this.h, 0.55);
      const moved = Math.hypot(p.x - ox, p.z - oz);
      const hs = moved / Math.max(dt, 1e-4);
      this.moving = hs > 0.6;
      const g = W.groundAt(p.x, p.z, this.r, p.y, 0.55);
      if (this.vy > 0 || p.y > g + 0.6 || !this.onGround) {
        this.vy -= 18 * dt;
        this.fallV = this.vy;
        p.y += this.vy * dt;
        if (p.y <= g) {
          p.y = g;
          if (!this.onGround) this.onLand(this.fallV);
          this.vy = 0;
          this.onGround = true;
        } else this.onGround = false;
      } else {
        p.y = g;
        this.vy = 0;
        this.onGround = true;
      }
      const cl = W.ceilAt(p.x, p.z, this.r, p.y);
      if (p.y + this.h > cl) {
        if (this.vy > 0) this.vy = 0;
        if (cl - p.y >= 1.15) p.y = Math.min(p.y, cl - this.h);
      }
      // しゃがみ/立ち上がり
      const wantH = this.crouch ? 1.15 : 1.75;
      if (!this.crouch && this.h < 1.75 && cl - p.y < 1.76) {
        // 頭上がつかえて立てない
      } else this.h = DL.approach(this.h, wantH, dt * 4);

      // ---- 足音 ----
      if (this.onGround && this.moving) {
        this.stepAcc += moved;
        const stride = this.sprinting ? 2.3 : this.crouch ? 1.2 : 1.75;
        if (this.stepAcc > stride) {
          this.stepAcc = 0;
          const surf = this.surface();
          G.audio.step(surf, this.sprinting ? 0.55 : this.crouch ? 0.12 : 0.3);
          G.noiseAt(p, this.sprinting ? 11 : this.crouch ? 1.5 : 4.5, 'step');
        }
      }

      // ---- カメラ ----
      const eyeH = this.h - 0.13;
      const targetY = p.y + eyeH;
      if (Math.abs(this.camY - targetY) > 1.5) this.camY = targetY;
      else this.camY = DL.damp(this.camY, targetY, 16, dt);
      const bobOn = this.onGround && this.moving ? Math.min(1, hs / 4) : 0;
      this.bobA = DL.damp(this.bobA, bobOn, 6, dt);
      this.bobT += dt * (this.sprinting ? 12.5 : this.crouch ? 6 : 9);
      const bobY = Math.sin(this.bobT) * 0.045 * this.bobA, bobX = Math.cos(this.bobT * 0.5) * 0.03 * this.bobA;
      this.trauma = Math.max(0, this.trauma - dt * 1.2);
      const tr = this.trauma * this.trauma;
      const t = G.time;
      const shY = (Math.sin(t * 37) + Math.sin(t * 23.3)) * 0.04 * tr;
      const shP = (Math.sin(t * 41.7) + Math.sin(t * 29.1)) * 0.04 * tr;
      const shR = Math.sin(t * 33.3) * 0.05 * tr;
      this.kick = DL.damp(this.kick, 0, 9, dt);
      this.roll = DL.damp(this.roll, -str * 0.012, 6, dt);
      const cam = G.camera;
      cam.position.set(p.x + cy * bobX, this.camY + bobY, p.z - sy * bobX);
      cam.rotation.order = 'YXZ';
      cam.rotation.y = this.yaw + shY;
      cam.rotation.x = DL.clamp(this.pitch + this.kick + shP, -1.55, 1.55);
      cam.rotation.z = this.roll + shR;
      this.aimT = DL.damp(this.aimT, !busy && I.mouseDown(2) && !this.act ? 1 : 0, 12, dt);
      const fovT = G.settings.fov - this.aimT * WEAP[this.cur].zoom + (this.sprinting ? 6 : 0);
      this.fov = DL.damp(this.fov, fovT, 10, dt);
      if (Math.abs(cam.fov - this.fov) > 0.01) {
        cam.fov = this.fov;
        cam.updateProjectionMatrix();
      }

      this.updateWeapon(dt, I, busy);
      this.updateView(dt, hs);
      this.updateSurvival(dt);
    }
    surface() {
      const G = this.G, W = G.world;
      const m = DL.MATS[W.matAt(this.pos.x, this.pos.z)];
      const fl = W.floorAt(this.pos.x, this.pos.z);
      if (this.pos.y > fl + 0.3) return 'metal';
      if (m === 'gravel' || m === 'rubble') return 'gravel';
      if (m === 'metal') return 'metal';
      if (m === 'wood') return 'wood';
      return 'concrete';
    }
    onLand(v) {
      const G = this.G;
      if (v < -4) {
        G.audio.land(Math.min(1, -v / 10));
        this.shake(Math.min(0.4, -v / 30));
      }
      if (v < -11.5) this.damage((-v - 11.5) * 9, null, 'fall');
    }
    handleActions(dt, I) {
      const G = this.G;
      if (I.pressed('KeyC')) this.crouch = !this.crouch;
      if (I.pressed('KeyF') && !this.flashLock) {
        this.flash.on = !this.flash.on;
        G.audio.click(0.35, 3000);
      }
      if (I.pressed('KeyG')) this.toggleMask();
      if (I.pressed('KeyH')) this.heal();
      if (I.pressed('KeyB')) {
        if (this.cur === 'smg' || this.weapons.includes('smg')) {
          this.milMode = !this.milMode;
          G.ui.toast(this.milMode ? '継ぎ接ぎに軍用弾を装填する (次のリロードから)' : '通常の小銃弾に戻す');
          G.audio.click(0.4, 1800);
        }
      }
      if (!this.act) {
        if (I.pressed('KeyR')) this.reload();
        for (const k of this.weapons) {
          if (I.pressed('Digit' + WEAP[k].key) && k !== this.cur) this.switchTo(k);
        }
        if (I.wheel) {
          const i = this.weapons.indexOf(this.cur);
          const n = this.weapons.length;
          const j = (i + (I.wheel > 0 ? 1 : -1) + n) % n;
          if (this.weapons[j] !== this.cur) this.switchTo(this.weapons[j]);
        }
        if (I.pressed('KeyV')) this.melee();
        if (I.pressed('KeyQ')) this.throwBomb();
      }
      if (I.down('KeyT') && (!this.act || this.act === 'charge')) {
        if (this.act !== 'charge') {
          this.act = 'charge';
          this.actT = 0;
        }
      } else if (this.act === 'charge') this.act = null;
    }
    toggleMask() {
      const G = this.G;
      if (this.act && this.act !== 'charge') return;
      if (!this.mask.on && this.mask.integ <= 0) {
        G.ui.toast('ガスマスクが壊れている');
        return;
      }
      this.act = 'mask';
      this.actT = 0;
      this.maskTarget = !this.mask.on;
      G.audio.click(0.4, 600);
    }
    heal() {
      const G = this.G;
      if (this.act) return;
      if (this.inv.medkit <= 0) {
        G.ui.toast('医療キットがない');
        return;
      }
      if (this.hp >= 100) {
        G.ui.toast('今は必要ない');
        return;
      }
      this.inv.medkit--;
      this.act = 'heal';
      this.actT = 0;
      G.audio.burst && G.audio.enabled && G.audio.burst(G.audio.out(null, 0.4), G.audio.ctx.currentTime, { bp: 1200, Q: 1, lp: 6000, peak: 0.8, d: 0.25 });
    }
    reload() {
      const W = WEAP[this.cur];
      if (this.milMode && W.mil && this.inv.mil <= 0) {
        this.milMode = false;
        this.G.ui.toast('軍用弾が尽きた。通常の小銃弾に戻す');
      }
      const useMil = this.milMode && W.mil;
      const reserve = useMil ? this.inv.mil : this.inv.ammo[W.ammo];
      if (this.mag[this.cur] >= W.mag && this.magMil[this.cur] === useMil) return;
      if (reserve <= 0) {
        this.G.ui.toast(useMil ? '軍用弾がない' : `${DL.AMMO_NAME[W.ammo]}がない`);
        return;
      }
      this.act = 'reload';
      this.actT = 0;
      this.reloadPhase = 0;
      this.G.audio.reload(this.cur, 0);
    }
    finishReload() {
      const W = WEAP[this.cur];
      const useMil = this.milMode && W.mil;
      let cur = this.mag[this.cur];
      // 弾種を変える場合は残弾を戻す
      if (this.magMil[this.cur] !== useMil && cur > 0) {
        if (this.magMil[this.cur]) this.inv.mil += cur;
        else this.inv.ammo[W.ammo] += cur;
        cur = 0;
      }
      const need = W.mag - cur;
      const take = Math.min(need, useMil ? this.inv.mil : this.inv.ammo[W.ammo]);
      if (useMil) this.inv.mil -= take;
      else this.inv.ammo[W.ammo] -= take;
      this.mag[this.cur] = cur + take;
      this.magMil[this.cur] = useMil;
    }
    switchTo(k) {
      if (this.act === 'reload') this.act = null;
      this.act = 'switch';
      this.actT = 0;
      this.nextWeapon = k;
      this.G.audio.click(0.25, 900);
    }
    melee() {
      this.act = 'melee';
      this.actT = 0;
      this.meleeDone = false;
      this.G.audio.knife(false);
    }
    throwBomb() {
      if (this.inv.bomb <= 0) {
        this.G.ui.toast('パイプ爆弾がない');
        return;
      }
      this.act = 'throw';
      this.actT = 0;
      this.thrown = false;
    }
    doMelee() {
      const G = this.G;
      const cam = G.camera;
      const dir = new T.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      let best = null, bd = 2.1;
      for (const e of G.entities) {
        if (!e.alive || !e.shootable) continue;
        const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > bd + e.r) continue;
        const dot = (dx * dir.x + dz * dir.z) / (d || 1) / Math.hypot(dir.x, dir.z);
        if (dot < 0.55) continue;
        best = e;
        bd = d;
      }
      if (!best) return;
      G.audio.knife(true);
      if (best instanceof DL.Human && best.state !== 'combat' && !best.surrendered) {
        // 背後からの無音テイクダウン
        const fx = -Math.sin(best.yaw), fz = -Math.cos(best.yaw);
        const tx = this.pos.x - best.pos.x, tz = this.pos.z - best.pos.z;
        const behind = (fx * tx + fz * tz) / (Math.hypot(tx, tz) || 1) < 0.2;
        if (behind || best.state === 'sleep' || best.pose === 'sleep') {
          best.die('stealth');
          G.ui.toast('静かに倒した');
          G.fx.blood(best.pos.x, best.pos.y + 1.4, best.pos.z, 6);
          return;
        }
      }
      best.hurt(45, 'body', this.pos, 'player');
      G.fx.blood(best.pos.x, best.pos.y + best.h * 0.6, best.pos.z, 8);
      G.ui.hitmarker(false);
    }
    fire() {
      const G = this.G, W = WEAP[this.cur];
      if (this.mag[this.cur] <= 0) {
        G.audio.dryFire();
        this.fireCd = 0.3;
        const useMil = this.milMode && W.mil;
        if ((useMil ? this.inv.mil : this.inv.ammo[W.ammo]) > 0) this.reload();
        return;
      }
      this.mag[this.cur]--;
      this.fireCd = W.rate;
      const mil = this.magMil[this.cur];
      const cam = G.camera;
      const o = cam.position;
      const base = new T.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      const right = new T.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
      const up = new T.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
      let spread = DL.lerp(W.spread, W.aimSpread, this.aimT);
      if (this.moving) spread *= 1.5;
      if (this.crouch) spread *= 0.8;
      if (!this.onGround) spread *= 2;
      for (let i = 0; i < W.pellets; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
        const d = base.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
        G.hitscan(o.x, o.y, o.z, d.x, d.y, d.z, W.dmg * (mil ? 1.5 : 1), 'player', W.pellets > 1);
      }
      this.kick += W.recoil * (this.aimT > 0.5 ? 0.6 : 1);
      this.pitch += W.recoil * 0.25;
      this.yaw += (Math.random() - 0.5) * W.recoil * 0.3;
      this.recoilZ = 1;
      G.audio.shot(W.snd, null);
      G.noiseAt(this.pos, W.noise, 'gun');
      const fwd = base;
      G.fx.flashLamp(o.x + fwd.x * 0.8, o.y + fwd.y * 0.8, o.z + fwd.z * 0.8, 0xffb060, 2.6, 11, 0.06);
      const m = this.models[this.cur];
      m.flash.visible = true;
      m.flash.material.rotation = Math.random() * 6;
      m.flash.scale.setScalar(this.cur === 'shotgun' ? 0.35 : 0.2 + Math.random() * 0.08);
      this.flashT = 0.05;
      this.vmMuzzleL.intensity = 3;
      if (this.cur === 'revolver' && m.parts.drum) m.parts.drum.rotation.z += Math.PI / 3;
    }
    updateWeapon(dt, I, busy) {
      const G = this.G, W = WEAP[this.cur];
      this.fireCd -= dt;
      if (this.flashT > 0) {
        this.flashT -= dt;
        if (this.flashT <= 0) {
          this.models[this.cur].flash.visible = false;
          this.vmMuzzleL.intensity = 0;
        }
      }
      if (this.act) {
        this.actT += dt;
        switch (this.act) {
          case 'reload': {
            const k = this.actT / W.reload;
            if (this.reloadPhase === 0 && k > 0.45) {
              this.reloadPhase = 1;
              G.audio.reload(this.cur, 1);
            }
            if (this.reloadPhase === 1 && k > 0.85) {
              this.reloadPhase = 2;
              G.audio.reload(this.cur, 2);
            }
            if (k >= 1) {
              this.finishReload();
              this.act = null;
            }
            break;
          }
          case 'switch':
            if (this.actT > 0.25 && this.nextWeapon) {
              this.cur = this.nextWeapon;
              this.nextWeapon = null;
              this.showWeapon();
            }
            if (this.actT > 0.5) this.act = null;
            break;
          case 'melee':
            if (!this.meleeDone && this.actT > 0.16) {
              this.meleeDone = true;
              this.doMelee();
            }
            if (this.actT > 0.5) this.act = null;
            break;
          case 'throw':
            if (!this.thrown && this.actT > 0.3) {
              this.thrown = true;
              this.inv.bomb--;
              const cam = G.camera;
              const d = new T.Vector3(0, 0.18, -1).applyQuaternion(cam.quaternion).normalize();
              const o = cam.position;
              G.addEntity(new DL.Bomb(G, o.x + d.x * 0.5, o.y + d.y * 0.5 - 0.1, o.z + d.z * 0.5, d.x * 13 + this.vel.x, d.y * 13 + 2, d.z * 13 + this.vel.z));
              G.audio.knife(false);
            }
            if (this.actT > 0.65) this.act = null;
            break;
          case 'charge': {
            this.flash.battery = Math.min(100, this.flash.battery + dt * 14);
            this.crankT = (this.crankT || 0) - dt;
            if (this.crankT <= 0) {
              this.crankT = 0.22;
              G.audio.crank();
            }
            break;
          }
          case 'mask':
            if (this.actT > 0.45 && this.mask.on !== this.maskTarget) {
              this.mask.on = this.maskTarget;
              G.audio.breath(true, 1.2);
              G.ui.maskAnim(this.mask.on);
            }
            if (this.actT > 0.8) this.act = null;
            break;
          case 'heal':
            if (this.actT > 0.5 && !this.healed) {
              this.healed = true;
              this.hp = Math.min(100, this.hp + 55);
              G.ui.toast('医療キットを使った');
            }
            if (this.actT > 0.9) {
              this.act = null;
              this.healed = false;
            }
            break;
        }
        return;
      }
      if (busy) return;
      const want = W.auto ? I.mouseDown(0) : I.mousePressed(0);
      if (want && this.fireCd <= 0) this.fire();
    }
    updateView(dt, hs) {
      const G = this.G, W = WEAP[this.cur];
      const m = this.models[this.cur];
      const g = m.group;
      const rest = m.parts.rest, aim = m.parts.aim;
      let lower = 0;
      const a = this.act, k = this.actT;
      if (a === 'switch') lower = k < 0.25 ? k / 0.25 : 1 - (k - 0.25) / 0.25;
      else if (a === 'charge' || a === 'throw' || a === 'heal') lower = 1;
      else if (a === 'melee') lower = 0.6;
      else if (a === 'mask') lower = Math.sin(Math.min(1, k / 0.8) * Math.PI);
      this.vmLower = DL.damp(this.vmLower, lower, 14, dt);
      const at = this.aimT;
      const bob = this.bobA;
      const bx = Math.cos(this.bobT * 0.5) * 0.012 * bob, by = Math.abs(Math.sin(this.bobT * 0.5)) * 0.012 * bob;
      const spr = this.sprinting ? 1 : 0;
      this.sprT = DL.damp(this.sprT || 0, spr, 8, dt);
      this.recoilZ = DL.damp(this.recoilZ || 0, 0, 14, dt);
      g.position.set(
        DL.lerp(rest.x, aim.x, at) + bx - this.swayX + this.sprT * 0.04,
        DL.lerp(rest.y, aim.y, at) - by + this.swayY - this.vmLower * 0.35 - this.sprT * 0.04,
        DL.lerp(rest.z, aim.z, at) + this.recoilZ * W.recoil * 1.4
      );
      g.rotation.set(this.recoilZ * W.recoil * 4 - this.vmLower * 0.6, this.sprT * 0.5, this.sprT * 0.2);
      if (a === 'reload') {
        const r = Math.sin(Math.min(1, k / W.reload) * Math.PI);
        g.rotation.x -= r * 0.35;
        g.rotation.z += r * 0.6;
        g.position.y -= r * 0.08;
        if (m.parts.drum) m.parts.drum.position.x = -r * 0.03;
        if (m.parts.mag) m.parts.mag.position.y = -0.09 - r * 0.25;
      } else {
        if (m.parts.drum) m.parts.drum.position.x = 0;
        if (m.parts.mag) m.parts.mag.position.y = -0.09;
      }
      // ナイフ
      const kn = this.knife.group;
      kn.visible = a === 'melee';
      if (kn.visible) {
        const t = Math.min(1, k / 0.45);
        const s = Math.sin(t * Math.PI);
        kn.position.set(DL.lerp(0.25, -0.15, t), -0.2 + s * 0.08, -0.35 - s * 0.15);
        kn.rotation.set(-0.2, 0.6 - t * 1.2, -0.8 + t * 1.4);
      }
      const ch = this.charger.group;
      ch.visible = a === 'charge';
      if (ch.visible) {
        ch.position.set(-0.12, -0.2 + Math.sin(G.time * 20) * 0.004, -0.32);
        ch.rotation.set(0.3, 0.3, 0);
        this.charger.parts.crank.rotation.x += dt * 18;
      }
      const bm = this.bombVm.group;
      bm.visible = a === 'throw' && !this.thrown;
      if (bm.visible) {
        const t = Math.min(1, k / 0.3);
        bm.position.set(0.18, -0.2 + t * 0.15, -0.3 + t * 0.1);
        bm.rotation.set(-t * 1.2, 0, 0.3);
      }
      // 一人称モデルの明るさを周囲に合わせる
      const amb = 0.05 + this.lit * 0.42;
      this.vmAmb.intensity = DL.damp(this.vmAmb.intensity, amb, 4, dt);
      this.vmKey.intensity = DL.damp(this.vmKey.intensity, 0.04 + this.lit * 0.3 + (G.env && G.env.outdoor ? 0.25 : 0), 4, dt);
      this.vmFlash.intensity = this.flash.on ? 0.3 * this.flashPower() : 0;
      this.vmMuzzleL.position.copy(m.parts.muzzle).applyMatrix4(g.matrix);
      void hs;
    }
    flashPower() {
      const b = this.flash.battery;
      if (b <= 0) return 0;
      if (b < 20) {
        const f = b / 20;
        return f * (Math.random() < 0.06 * (1 - f) ? 0.2 : 1);
      }
      return 1;
    }
    updateSurvival(dt) {
      const G = this.G;
      if (this.flash.on) {
        this.flash.battery = Math.max(0, this.flash.battery - dt * 0.45);
      }
      const tox = G.toxicAt(this.pos);
      const maskOk = this.mask.on && this.mask.integ > 0;
      if (maskOk) {
        this.filterTime -= dt * (this.mask.integ < 35 ? 1.8 : 1);
        if (this.filterTime <= 0) {
          if (this.inv.filter > 0) {
            this.inv.filter--;
            this.filterTime = FILTER_TIME;
            G.ui.toast('フィルターを交換した');
            G.audio.click(0.6, 1200);
          } else this.filterTime = 0;
        }
      }
      const safe = maskOk && this.filterTime > 0;
      if (tox > 0 && !safe) {
        this.gasExposure = Math.min(1, this.gasExposure + dt * 0.8);
        this.damage(tox * 6.5 * dt, null, 'gas');
        this.coughT -= dt;
        if (this.coughT <= 0) {
          this.coughT = 1.4 + Math.random();
          if (maskOk) G.audio.breath(true, 1.6);
          else G.audio.cough();
        }
        if (!this.gasWarned || G.time - this.gasWarned > 12) {
          this.gasWarned = G.time;
          G.ui.toast(maskOk ? 'フィルターが切れている!' : '空気が汚染されている  [G] ガスマスク');
        }
      } else this.gasExposure = Math.max(0, this.gasExposure - dt * 0.4);
      if (this.alive && G.time - this.lastHurt > 6 && this.hp < 100 && !(tox > 0 && !safe)) this.hp = Math.min(100, this.hp + dt * 4);
    }
  }
  DL.Player = Player;
})();
