'use strict';
// エンティティ：変異体・人間・拾得物・パイプ爆弾・エフェクト
(function () {
  const DL = window.DL;
  const T = window.THREE;
  const tmpV = new T.Vector3();
  const nav = { x: 0, z: 0 };

  function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
    const lx = cx - ox, ly = cy - oy, lz = cz - oz;
    const tca = lx * dx + ly * dy + lz * dz;
    if (tca < 0) return -1;
    const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
    if (d2 > r * r) return -1;
    return tca - Math.sqrt(r * r - d2);
  }
  DL.raySphere = raySphere;

  // ================= 基底 =================
  class Entity {
    constructor(G) {
      this.G = G;
      this.pos = new T.Vector3();
      this.yaw = 0;
      this.vy = 0;
      this.onGround = true;
      this.alive = true;
      this.removed = false;
      this.r = 0.35;
      this.h = 1.7;
      this.step = 0.55;
      this.shootable = false;
      this.hostile = false;
      this.mesh = null;
      this.lastMove = 0;
    }
    physics(dt, vx, vz) {
      const W = this.G.world, p = this.pos;
      const ox = p.x, oz = p.z;
      p.x += vx * dt;
      p.z += vz * dt;
      W.collide(p, this.r, this.h, this.step);
      this.lastMove = Math.hypot(p.x - ox, p.z - oz) / Math.max(dt, 1e-4);
      const g = W.groundAt(p.x, p.z, this.r, p.y, this.step);
      if (this.vy > 0 || p.y > g + this.step + 0.05 || !this.onGround) {
        this.vy -= 18 * dt;
        p.y += this.vy * dt;
        if (p.y <= g) {
          p.y = g;
          this.vy = 0;
          this.onGround = true;
        } else this.onGround = false;
      } else {
        p.y = g;
        this.vy = 0;
        this.onGround = true;
      }
    }
    turnTo(yaw, rate, dt) {
      const d = DL.wrapAngle(yaw - this.yaw);
      const m = rate * dt;
      this.yaw += Math.abs(d) < m ? d : Math.sign(d) * m;
    }
    distToPlayer() {
      const P = this.G.player.pos;
      return Math.hypot(P.x - this.pos.x, P.z - this.pos.z);
    }
    remove() {
      this.removed = true;
      if (this.mesh && this.mesh.parent) this.mesh.parent.remove(this.mesh);
      if (this.interact) this.G.removeInteract(this.interact);
    }
  }
  DL.Entity = Entity;

  // ================= 変異体 =================
  const MUT = {
    mukuro: { hp: 80, speed: 6.0, walk: 1.5, dmg: 11, reach: 1.7, windup: 0.34, r: 0.42, h: 1.25, climb: 1.15, sense: 15, leap: true, name: 'ムクロ' },
    hagure: { hp: 48, speed: 7.6, walk: 2.0, dmg: 8, reach: 1.5, windup: 0.24, r: 0.38, h: 1.0, climb: 0.7, sense: 22, leap: true, name: 'ハグレ' },
    nushi: { hp: 760, speed: 4.4, walk: 1.4, dmg: 24, reach: 2.9, windup: 0.6, r: 0.95, h: 2.3, climb: 1.15, sense: 40, charge: true, name: 'ヌシ' },
    haha: { hp: 280, speed: 6.4, walk: 1.2, dmg: 19, reach: 2.3, windup: 0.45, r: 0.62, h: 1.7, climb: 1.15, sense: 14, passive: true, name: '母獣' },
    pup: { hp: 22, speed: 3.0, walk: 0.8, dmg: 0, reach: 0, windup: 0, r: 0.22, h: 0.5, climb: 0.6, sense: 0, passive: true, harmless: true, name: '仔' },
  };
  DL.MUT = MUT;

  class Mutant extends Entity {
    constructor(G, kind, x, z, o = {}) {
      super(G);
      const K = (this.K = MUT[kind]);
      this.kind = kind;
      this.hp = this.maxHp = K.hp * (o.hpMul || 1);
      this.r = K.r;
      this.h = K.h;
      this.step = 0.62;
      this.shootable = true;
      this.hostile = !K.passive;
      this.faction = 'mutant';
      this.model = DL.Models.mutant(kind);
      this.mesh = this.model.root;
      this.mesh.traverse((m) => {
        if (m.isMesh) m.castShadow = true;
      });
      G.scene.add(this.mesh);
      const y = o.y !== undefined ? o.y : G.world.floorAt(x, z);
      this.pos.set(x, y, z);
      this.home = this.pos.clone();
      this.state = o.state || (K.passive ? 'passive' : 'idle');
      this.yaw = o.yaw !== undefined ? o.yaw : Math.random() * 6.28;
      this.stateT = 0;
      this.cd = 1 + Math.random();
      this.senseT = Math.random() * 0.2;
      this.gait = Math.random() * 6;
      this.wander = this.pos.clone();
      this.circle = Math.random() < 0.5 ? 1 : -1;
      this.losP = false;
      this.leapV = new T.Vector3();
      this.chargeDir = new T.Vector3();
      this.growlT = 1 + Math.random() * 3;
      this.deadT = 0;
      this.onDeath = o.onDeath || null;
      this.provoked = false;
      this.spd = 0;
      this.speedMul = 0.9 + Math.random() * 0.2;
      if (o.hunt) this.alert(true);
      this.sync();
    }
    alert(silent) {
      if (!this.alive) return;
      if (this.K.harmless) {
        this.state = 'flee';
        this.stateT = 4;
        return;
      }
      if (this.state === 'hunt' || this.state === 'windup' || this.state === 'recover' || this.state === 'leap' || this.state === 'charge' || this.state === 'stun') return;
      this.state = 'hunt';
      this.hostile = true;
      if (!silent) this.G.audio.mutant(this.kind, this.pos, this.kind === 'nushi' ? 'roar' : 'screech');
      // 群れに伝播
      for (const e of this.G.entities) {
        if (e !== this && e instanceof Mutant && e.alive && !e.K.passive && (e.state === 'idle' || e.state === 'sleep')) {
          if (e.pos.distanceToSquared(this.pos) < 15 * 15) {
            e.state = 'hunt';
          }
        }
      }
    }
    hear(pos, kind) {
      if (!this.alive) return;
      if (this.K.passive) {
        if (kind === 'gun' && pos.distanceTo(this.pos) < 12 && this.kind === 'haha') this.provoke();
        return;
      }
      if (this.state === 'idle' || this.state === 'sleep') this.alert();
    }
    provoke() {
      if (this.provoked || !this.alive) return;
      this.provoked = true;
      if (this.kind === 'haha') {
        this.K = Object.assign({}, this.K, { passive: false });
        this.hostile = true;
        this.state = 'hunt';
        this.G.audio.mutant('haha', this.pos, 'roar');
      }
    }
    sense(P, dist) {
      if (!P.alive) {
        this.losP = false;
        return;
      }
      const W = this.G.world;
      const eyeY = this.pos.y + this.h * 0.8;
      this.losP = dist < 40 && W.los(this.pos.x, eyeY, this.pos.z, P.pos.x, P.pos.y + P.h * 0.8, P.pos.z);
      if (this.state === 'idle' || this.state === 'sleep') {
        const range = this.state === 'sleep' ? 4 : this.K.sense * (P.flash.on ? 1.35 : 1) * (P.crouch ? 0.6 : 1);
        if (dist < 2.5 || (this.losP && dist < range) || (P.sprinting && dist < 10 && this.state !== 'sleep')) this.alert();
      }
    }
    hitSpheres() {
      const s = this.model.scale, p = this.pos, c = Math.cos(this.yaw), sn = Math.sin(this.yaw);
      const fx = -sn, fz = -c;
      const by = p.y + this.model.body.position.y * s;
      return [
        { x: p.x + fx * 0.75 * s, y: by + 0.12 * s, z: p.z + fz * 0.75 * s, r: 0.2 * s, part: 'head' },
        { x: p.x + fx * 0.15 * s, y: by, z: p.z + fz * 0.15 * s, r: 0.36 * s, part: 'body' },
        { x: p.x - fx * 0.3 * s, y: by - 0.05 * s, z: p.z - fz * 0.3 * s, r: 0.32 * s, part: 'body' },
        { x: p.x + fx * 0.1 * s, y: p.y + 0.35 * s, z: p.z + fz * 0.1 * s, r: 0.3 * s, part: 'leg' },
      ];
    }
    rayHit(ox, oy, oz, dx, dy, dz, maxT) {
      let best = maxT, part = null;
      for (const sp of this.hitSpheres()) {
        const t = raySphere(ox, oy, oz, dx, dy, dz, sp.x, sp.y, sp.z, sp.r);
        if (t >= 0 && t < best) {
          best = t;
          part = sp.part;
        }
      }
      return part ? { t: best, part } : null;
    }
    hurt(amount, part, from, src) {
      if (!this.alive) return;
      let m = part === 'head' ? 1.8 : part === 'leg' ? 0.75 : 1;
      if (this.state === 'stun') m *= 1.6;
      this.hp -= amount * m;
      this.G.audio.mutant(this.kind, this.pos, 'hurt');
      if (this.K.passive && !this.K.harmless) this.provoke();
      if (src === 'player' && this.K.passive) this.G.flags.hurtPassive = true;
      if (this.hp <= 0) {
        this.die();
        return;
      }
      if (this.K.harmless) {
        this.state = 'flee';
        this.stateT = 4;
        return;
      }
      if (this.state === 'idle' || this.state === 'sleep' || this.state === 'passive') this.alert();
      if (amount * m > 28 && this.kind !== 'nushi' && this.state !== 'leap') {
        this.state = 'stagger';
        this.stateT = 0.28;
      } else if (this.kind === 'mukuro' && Math.random() < 0.18 && this.state === 'hunt') {
        this.state = 'recover';
        this.stateT = 0.8;
        this.circle = -this.circle;
      }
    }
    die() {
      this.alive = false;
      this.shootable = false;
      this.G.audio.mutant(this.kind, this.pos, 'die');
      this.deadT = 0;
      this.G.fx.decalBlood(this.pos.x, this.pos.y + 0.02, this.pos.z, 0, 1, 0, 1.2 * this.model.scale);
      if (this.onDeath) this.onDeath(this);
      this.G.onEntityDeath(this);
    }
    update(dt) {
      const m = this.model;
      if (!this.alive) {
        this.deadT += dt;
        const k = Math.min(1, this.deadT / 0.4);
        m.inner.rotation.z = DL.smooth(k) * 1.5;
        m.body.position.y = DL.lerp(m.bodyY, m.bodyY * 0.45, k);
        m.inner.position.y = 0;
        for (const L of m.legs) L.top.rotation.x = DL.lerp(L.top.rotation.x, 0.6, k);
        this.sync();
        return;
      }
      const G = this.G, P = G.player, K = this.K;
      const dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z;
      const dist = Math.hypot(dx, dz), dy = P.pos.y - this.pos.y;
      const yawP = DL.yawTo(dx, dz);
      this.cd -= dt;
      this.stateT -= dt;
      this.senseT -= dt;
      if (this.senseT <= 0) {
        this.senseT = 0.2;
        this.sense(P, dist);
      }
      let vx = 0, vz = 0, want = 0;
      const W = G.world;
      const moveTo = (tx, tz, spd) => {
        const ddx = tx - this.pos.x, ddz = tz - this.pos.z;
        const d = Math.hypot(ddx, ddz);
        if (d < 0.05) return;
        vx = (ddx / d) * spd;
        vz = (ddz / d) * spd;
        this.turnTo(DL.yawTo(ddx, ddz), 8, dt);
        want = spd;
      };
      const chase = (spd) => {
        if (this.losP && dist < 14 && Math.abs(dy) < 1.0) moveTo(P.pos.x, P.pos.z, spd);
        else if (W.navTarget(W.flowM, this.pos.x, this.pos.z, nav)) moveTo(nav.x, nav.z, spd);
        else moveTo(P.pos.x, P.pos.z, spd);
      };
      switch (this.state) {
        case 'sleep':
          break;
        case 'idle': {
          if (this.stateT <= 0) {
            this.stateT = 2 + Math.random() * 4;
            const a = Math.random() * 6.28, r = Math.random() * 4;
            const tx = this.home.x + Math.cos(a) * r, tz = this.home.z + Math.sin(a) * r;
            if (W.isOpen(Math.floor(tx / 2), Math.floor(tz / 2))) this.wander.set(tx, 0, tz);
          }
          if (Math.hypot(this.wander.x - this.pos.x, this.wander.z - this.pos.z) > 0.4) moveTo(this.wander.x, this.wander.z, K.walk);
          this.growlT -= dt;
          if (this.growlT <= 0) {
            this.growlT = 4 + Math.random() * 6;
            if (dist < 30) G.audio.mutant(this.kind, this.pos, 'growl');
          }
          break;
        }
        case 'passive': {
          if (dist < 16) this.turnTo(yawP, 2, dt);
          this.growlT -= dt;
          if (this.kind === 'haha' && dist < 11 && this.growlT <= 0) {
            this.growlT = 2.5;
            G.audio.mutant('haha', this.pos, 'growl');
          }
          if (this.kind === 'haha' && dist < 4.0 && P.alive) this.provoke();
          if (this.kind === 'pup') {
            this.gait += dt;
            if (this.stateT <= 0) {
              this.stateT = 1 + Math.random() * 3;
              const a = Math.random() * 6.28;
              this.wander.set(this.home.x + Math.cos(a) * 1.2, 0, this.home.z + Math.sin(a) * 1.2);
            }
            if (Math.hypot(this.wander.x - this.pos.x, this.wander.z - this.pos.z) > 0.3) moveTo(this.wander.x, this.wander.z, K.walk);
          }
          break;
        }
        case 'flee': {
          moveTo(this.pos.x - dx, this.pos.z - dz, K.speed);
          if (this.stateT <= 0) this.state = 'passive';
          break;
        }
        case 'hunt': {
          if (!P.alive) {
            this.state = 'idle';
            this.home.copy(this.pos);
            break;
          }
          chase(K.speed * this.speedMul);
          if (dist < K.reach && Math.abs(dy) < 1.5) {
            this.state = 'windup';
            this.stateT = K.windup;
            G.audio.mutant(this.kind, this.pos, 'attack');
          } else if (K.leap && this.cd <= 0 && dist > 3.5 && dist < 7.5 && this.losP && Math.abs(dy) < 0.8 && Math.random() < dt * 1.2) {
            this.state = 'leap';
            this.stateT = 0.9;
            this.vy = 5.2;
            this.onGround = false;
            this.leapV.set(dx / dist, 0, dz / dist).multiplyScalar(Math.min(9.5, dist * 1.35));
            this.cd = 2.5 + Math.random() * 2;
            G.audio.mutant(this.kind, this.pos, 'screech');
          } else if (K.charge && this.cd <= 0 && dist > 5 && dist < 18 && this.losP) {
            this.state = 'charge';
            this.stateT = 1.8;
            this.chargeDir.set(dx / dist, 0, dz / dist);
            this.cd = 5;
            G.audio.mutant(this.kind, this.pos, 'roar');
          }
          break;
        }
        case 'windup': {
          this.turnTo(yawP, 6, dt);
          if (this.stateT <= 0) {
            if (dist < K.reach + 0.7 && Math.abs(dy) < 1.7 && P.alive) {
              P.damage(K.dmg, this.pos, 'melee');
              G.audio.impact(P.pos, 'flesh');
            }
            this.state = 'recover';
            this.stateT = 0.45 + Math.random() * 0.4;
            if (Math.random() < 0.5) this.circle = -this.circle;
          }
          break;
        }
        case 'recover': {
          // 横に回り込みながら少し下がる
          const sx = -dz / (dist || 1), sz = dx / (dist || 1);
          const back = dist < 2.5 ? -0.6 : 0.2;
          const spd = K.speed * 0.55;
          vx = (sx * this.circle + (dx / (dist || 1)) * back) * spd;
          vz = (sz * this.circle + (dz / (dist || 1)) * back) * spd;
          want = spd;
          this.turnTo(yawP, 6, dt);
          if (this.stateT <= 0) this.state = 'hunt';
          break;
        }
        case 'stagger':
          if (this.stateT <= 0) this.state = 'hunt';
          break;
        case 'leap': {
          vx = this.leapV.x;
          vz = this.leapV.z;
          want = 8;
          this.turnTo(yawP, 6, dt);
          if (this.onGround && this.stateT < 0.7) {
            if (dist < K.reach + 0.6 && Math.abs(dy) < 1.6 && P.alive) {
              P.damage(K.dmg * 1.2, this.pos, 'melee');
              G.audio.impact(P.pos, 'flesh');
            }
            this.state = 'recover';
            this.stateT = 0.6;
          }
          break;
        }
        case 'charge': {
          const spd = 11.5;
          vx = this.chargeDir.x * spd;
          vz = this.chargeDir.z * spd;
          want = spd;
          this.turnTo(DL.yawTo(this.chargeDir.x, this.chargeDir.z), 4, dt);
          if (dist < 2.4 && Math.abs(dy) < 2) {
            P.damage(32, this.pos, 'melee');
            P.knock(this.chargeDir.x * 9, this.chargeDir.z * 9);
            G.audio.impact(P.pos, 'flesh');
            this.state = 'recover';
            this.stateT = 1.0;
          } else if (this.stateT < 1.55 && this.lastMove < spd * 0.35) {
            this.state = 'stun';
            this.stateT = 2.2;
            G.audio.clank(this.pos, 0.8);
            G.player.shake(0.5);
            G.fx.dust(this.pos.x + this.chargeDir.x * 1.5, this.pos.y + 1.2, this.pos.z + this.chargeDir.z * 1.5, 14);
          } else if (this.stateT <= 0) this.state = 'hunt';
          break;
        }
        case 'stun':
          if (this.stateT <= 0) this.state = 'hunt';
          break;
      }
      // 群れ同士で重ならない
      if (this.state !== 'leap') {
        for (const e of G.entities) {
          if (e === this || !e.alive || !(e instanceof Mutant)) continue;
          const ex = this.pos.x - e.pos.x, ez = this.pos.z - e.pos.z;
          const d2 = ex * ex + ez * ez, rr = this.r + e.r;
          if (d2 < rr * rr && d2 > 1e-6) {
            const d = Math.sqrt(d2);
            vx += (ex / d) * 2.5;
            vz += (ez / d) * 2.5;
          }
        }
        // プレイヤーに重ならない
        const pr = this.r + 0.35;
        if (dist < pr && dist > 1e-4) {
          vx -= (dx / dist) * 3;
          vz -= (dz / dist) * 3;
        }
      }
      this.physics(dt, vx, vz);
      this.spd = DL.damp(this.spd, Math.min(want, this.lastMove), 10, dt);
      this.animate(dt);
      this.sync();
    }
    animate(dt) {
      const m = this.model, s = this.spd;
      this.gait += dt * (1.5 + s * 1.9);
      const amp = DL.clamp(s / 4, 0.08, 1) * 0.75;
      const a = Math.sin(this.gait), b = Math.sin(this.gait + Math.PI);
      m.legs[0].top.rotation.x = a * amp;
      m.legs[1].top.rotation.x = Math.sin(this.gait + 0.4) * amp;
      m.legs[2].top.rotation.x = b * amp;
      m.legs[3].top.rotation.x = Math.sin(this.gait + Math.PI + 0.4) * amp;
      for (const L of m.legs) L.kn.rotation.x = L.base + (L.front ? -1 : 1) * Math.max(0, Math.sin(this.gait + (L.front ? 0 : Math.PI))) * amp * 0.6;
      const wind = this.state === 'windup' ? 1 : 0;
      m.body.rotation.x = DL.damp(m.body.rotation.x, wind ? -0.4 : this.state === 'stun' ? 0.3 : 0, 10, dt);
      m.body.position.y = m.bodyY + Math.abs(Math.cos(this.gait)) * 0.05 * amp + wind * 0.15;
      m.jaw.rotation.x = DL.damp(m.jaw.rotation.x, wind || this.state === 'charge' || this.state === 'leap' ? 0.7 : 0.12 + Math.sin(this.gait * 0.5) * 0.06, 12, dt);
      m.head.rotation.y = this.state === 'idle' ? Math.sin(this.gait * 0.3) * 0.4 : 0;
      // 尾を左右に振る（Blender 製のモデルのみ）
      if (m.tail) m.tail.forEach((t, i) => { t.rotation.y = Math.sin(this.gait * 0.5 - i * 0.8) * (0.25 + amp * 0.3); });
    }
    sync() {
      this.mesh.position.copy(this.pos);
      this.mesh.rotation.y = this.yaw;
    }
  }
  DL.Mutant = Mutant;

  // ================= 人間 =================
  class Human extends Entity {
    constructor(G, o) {
      super(G);
      this.o = o;
      this.role = o.role || 'npc';
      this.name = o.name || '';
      this.faction = this.role === 'enemy' ? 'enemy' : 'friend';
      this.hp = this.maxHp = o.hp || (this.role === 'enemy' ? 100 : 200);
      this.r = 0.33;
      this.h = 1.8;
      this.step = 0.55;
      this.shootable = this.role === 'enemy';
      this.hostile = this.role === 'enemy';
      const look = Object.assign({}, o.look || {});
      if ((this.role === 'enemy' || this.role === 'ally') && look.gun === undefined) look.gun = true;
      if (this.role === 'ghost') look.glow = 0xbfd8ff;
      this.model = DL.Models.humanoid(look);
      this.mesh = this.model.root;
      G.scene.add(this.mesh);
      const y = o.y !== undefined ? o.y : G.world.floorAt(o.x, o.z);
      this.pos.set(o.x, y, o.z);
      this.home = this.pos.clone();
      this.yaw = o.yaw || 0;
      this.homeYaw = this.yaw;
      this.pose = o.pose || 'stand';
      DL.poseHuman(this.model, this.pose === 'stand' && o.armsPose === 'arms' ? 'arms' : this.pose);
      this.state = o.state || (this.role === 'enemy' ? (o.patrol ? 'patrol' : o.sleep ? 'sleep' : 'idle') : 'idle');
      this.patrol = o.patrol || null;
      this.patrolI = 0;
      this.path = null;
      this.pathI = 0;
      this.onArrive = null;
      this.aware = 0;
      this.lastKnown = new T.Vector3();
      this.canSee = false;
      this.senseT = Math.random() * 0.2;
      this.fireT = 0.5 + Math.random();
      this.burst = 0;
      this.strafe = Math.random() < 0.5 ? 1 : -1;
      this.strafeT = 0;
      this.lostT = 0;
      this.stateT = 0;
      this.gait = Math.random() * 6;
      this.spd = 0;
      this.deadT = 0;
      this.acc = o.acc || 1;
      this.dmg = o.dmg || 7;
      this.canSurrender = !!o.canSurrender;
      this.surrendered = false;
      this.target = null;
      this.targetT = 0;
      this.waitFor = o.waitFor || 0;
      this.speed = o.speed || 3.0;
      this.onDeath = o.onDeath || null;
      this.barkT = 0;
      this.ghostA = 0;
      this.followPlayer = false;
      this.lookAtPlayer = o.lookAtPlayer !== false;
      if (o.talk) {
        this.interact = G.addInteract({
          entity: this,
          r: o.talkR || 2.4,
          label: o.talkLabel || '話す',
          name: this.name,
          enabled: () => this.alive && !this.busy && this.role !== 'enemy',
          onUse: () => o.talk(this),
        });
      }
      this.sync();
    }
    eye() {
      return tmpV.set(this.pos.x, this.pos.y + (this.pose === 'stand' || this.pose === 'aim' ? 1.72 : 1.25), this.pos.z);
    }
    setPose(p) {
      this.pose = p;
      DL.poseHuman(this.model, p);
    }
    hitSpheres() {
      const p = this.pos;
      const low = this.pose === 'kneel' || this.pose === 'sit' || this.pose === 'guitar' ? 0.44 : 0;
      const c = this.crouchT || 0;
      return [
        { x: p.x, y: p.y + 1.76 - low - c, z: p.z, r: 0.16, part: 'head' },
        { x: p.x, y: p.y + 1.3 - low - c, z: p.z, r: 0.3, part: 'body' },
        { x: p.x, y: p.y + 0.95 - low, z: p.z, r: 0.26, part: 'body' },
        { x: p.x, y: p.y + 0.45, z: p.z, r: 0.22, part: 'leg' },
      ];
    }
    rayHit(ox, oy, oz, dx, dy, dz, maxT) {
      let best = maxT, part = null;
      for (const sp of this.hitSpheres()) {
        const t = raySphere(ox, oy, oz, dx, dy, dz, sp.x, sp.y, sp.z, sp.r);
        if (t >= 0 && t < best) {
          best = t;
          part = sp.part;
        }
      }
      return part ? { t: best, part } : null;
    }
    hurt(amount, part, from, src) {
      if (!this.alive) return;
      const m = part === 'head' ? 3 : part === 'leg' ? 0.7 : 1;
      this.hp -= amount * m;
      this.G.audio.voice(this.pos, 'hurt', this.o.pitch || 1);
      if (this.surrendered) {
        this.G.flags.executed = true;
        this.die();
        return;
      }
      if (this.hp <= 0) {
        this.die();
        return;
      }
      if (this.role === 'enemy') {
        if (from) this.lastKnown.set(from.x, from.y, from.z);
        if (this.state !== 'combat') this.enterCombat();
        this.aware = 1.2;
      }
    }
    die(how) {
      if (!this.alive) return;
      this.alive = false;
      this.shootable = false;
      this.deadT = 0;
      if (how !== 'stealth') this.G.audio.voice(this.pos, 'die', this.o.pitch || 1);
      if (this.model.gun) this.model.gun.visible = false;
      this.G.fx.decalBlood(this.pos.x, this.pos.y + 0.02, this.pos.z, 0, 1, 0, 1.1);
      if (this.lamp) this.lamp.on = false;
      if (this.role === 'enemy' && !this.o.noDrop) {
        const G = this.G;
        G.spawnPickup('ammo_r', DL.randi(6, 14), this.pos.x + 0.4, this.pos.z + 0.2);
        if (Math.random() < 0.35) G.spawnPickup('mil', DL.randi(1, 3), this.pos.x - 0.3, this.pos.z + 0.4);
        if (Math.random() < 0.2) G.spawnPickup(DL.pick(['medkit', 'filter', 'ammo_p']), 1, this.pos.x, this.pos.z - 0.4);
      }
      if (this.onDeath) this.onDeath(this, how);
      this.G.onEntityDeath(this);
    }
    hear(pos, kind) {
      if (this.role !== 'enemy' || !this.alive || this.surrendered) return;
      this.lastKnown.copy(pos);
      if (kind === 'gun' || kind === 'boom') {
        if (this.state !== 'combat') {
          this.aware = Math.max(this.aware, 0.8);
          this.state = 'suspicious';
          this.stateT = 12;
          this.bark(DL.pick(['銃声だ!', '何の音だ!?', 'おい、今の聞いたか!']));
          if (this.pose === 'sleep' || this.pose === 'sit') this.setPose('stand');
        }
      } else if (this.state === 'idle' || this.state === 'patrol' || this.state === 'sleep') {
        this.aware = Math.max(this.aware, 0.45);
        this.state = 'suspicious';
        this.stateT = 8;
        if (this.pose === 'sleep' || this.pose === 'sit') this.setPose('stand');
        this.bark(DL.pick(['ん? 誰だ?', '…足音か?', '今、何か動いたぞ']));
      }
    }
    bark(text) {
      if (this.barkT > 0 || !this.alive) return;
      this.barkT = 3;
      this.G.ui.bark(this.name || '赤環の兵', text, this.pos);
    }
    enterCombat() {
      this.state = 'combat';
      this.aware = 1.2;
      if (this.pose !== 'stand' && this.pose !== 'aim') this.setPose('stand');
      this.bark(DL.pick(['いたぞ! 撃て!', 'そこだ!', '侵入者だ!', '逃がすな!']));
      for (const e of this.G.entities) {
        if (e !== this && e instanceof Human && e.role === 'enemy' && e.alive && !e.surrendered && e.state !== 'combat' && e.pos.distanceToSquared(this.pos) < 22 * 22) {
          e.lastKnown.copy(this.lastKnown);
          e.state = 'combat';
          e.aware = 1.2;
          if (e.pose !== 'stand') e.setPose('stand');
        }
      }
    }
    // スクリプト用：指定経路を歩く
    walk(points, opts = {}) {
      this.path = points.map((p) => ({ x: p[0], z: p[1] }));
      this.pathI = 0;
      this.waitFor = opts.waitFor || 0;
      this.speed = opts.speed || this.speed;
      if (this.pose !== 'stand') this.setPose('stand');
      return new Promise((res) => {
        this.onArrive = res;
      });
    }
    teleport(x, z, yaw) {
      this.pos.set(x, this.G.world.floorAt(x, z), z);
      if (yaw !== undefined) this.yaw = yaw;
      this.path = null;
      this.sync();
    }
    seeCheck(P, dist) {
      if (!P.alive) return false;
      if (dist > 32) return false;
      const e = this.eye();
      const ex = e.x, ey = e.y, ez = e.z;
      const dx = P.pos.x - ex, dz = P.pos.z - ez;
      const fwdX = -Math.sin(this.yaw), fwdZ = -Math.cos(this.yaw);
      const dot = (dx * fwdX + dz * fwdZ) / (dist || 1);
      const fov = this.state === 'combat' ? -0.2 : 0.35;
      if (dot < fov && dist > 2.2) return false;
      return this.G.world.los(ex, ey, ez, P.pos.x, P.pos.y + P.h * 0.75, P.pos.z);
    }
    update(dt) {
      const G = this.G, m = this.model;
      this.barkT -= dt;
      if (!this.alive) {
        this.deadT += dt;
        const k = Math.min(1, this.deadT / 0.5);
        m.root.rotation.x = DL.smooth(k) * (Math.PI / 2 - 0.05);
        m.root.position.y = this.pos.y + 0.12 * k;
        // 倒れながら手足の力が抜ける
        const s = DL.smooth(k);
        m.legL.hip.rotation.x = 0.35 * s;
        m.legL.kn.rotation.x = -0.6 * s;
        m.legR.kn.rotation.x = -0.25 * s;
        m.armL.sh.rotation.set(0.2 * s, 0, -0.9 * s);
        m.armR.sh.rotation.set(0.4 * s, 0, 0.7 * s);
        m.armL.el.rotation.x = 0.5 * s;
        m.head.rotation.x = -0.35 * s;
        return;
      }
      if (this.role === 'ghost') {
        this.updateGhost(dt);
        return;
      }
      let vx = 0, vz = 0, want = 0;
      const P = G.player;
      const dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z;
      const dist = Math.hypot(dx, dz);
      const moveTo = (tx, tz, spd) => {
        const ddx = tx - this.pos.x, ddz = tz - this.pos.z;
        const d = Math.hypot(ddx, ddz);
        if (d < 0.05) return d;
        vx = (ddx / d) * spd;
        vz = (ddz / d) * spd;
        this.turnTo(DL.yawTo(ddx, ddz), 7, dt);
        want = spd;
        return d;
      };
      let aiming = false;
      // ---- 経路歩行（スクリプト） ----
      if (this.path) {
        const wp = this.path[this.pathI];
        // プレイヤーが後ろにいるときだけ待つ（先に行かれたら追いかける）
        const hx = wp.x - this.pos.x, hz = wp.z - this.pos.z;
        const behind = dx * hx + dz * hz < 0;
        const waiting = this.waitFor && dist > this.waitFor && behind;
        if (waiting && !this.combatTarget()) {
          this.turnTo(DL.yawTo(dx, dz), 4, dt);
        } else if (!this.combatTarget() || this.role !== 'ally') {
          const d = moveTo(wp.x, wp.z, this.speed);
          // 引っかかって進めないときは次の地点へ移す（台本が止まらないように）
          this.stuckT = this.lastMove < 0.3 && d > 0.5 ? (this.stuckT || 0) + dt : 0;
          if (this.stuckT > 3) {
            this.stuckT = 0;
            this.pos.set(wp.x, this.G.world.floorAt(wp.x, wp.z), wp.z);
          }
          if (d < 0.5) {
            this.pathI++;
            if (this.pathI >= this.path.length) {
              this.path = null;
              const cb = this.onArrive;
              this.onArrive = null;
              if (cb) cb();
            }
          }
        }
      }
      if (this.role === 'enemy') {
        const r = this.enemyThink(dt, dist, dx, dz, moveTo);
        if (r) {
          vx = r.vx; vz = r.vz; want = r.want; aiming = r.aiming;
        }
      } else if (this.role === 'ally') {
        if (this.allyThink(dt)) aiming = true;
      }
      if (!this.path && this.role !== 'enemy' && !aiming) {
        // 待機：プレイヤーを見る
        if (this.lookAtPlayer && dist < 5 && P.alive) {
          const local = DL.wrapAngle(DL.yawTo(dx, dz) - this.yaw);
          m.head.rotation.y = DL.damp(m.head.rotation.y, DL.clamp(local, -1.0, 1.0), 4, dt);
          if (this.pose === 'stand' && Math.abs(local) > 1.2 && this.o.turn !== false) this.turnTo(DL.yawTo(dx, dz), 1.5, dt);
        } else m.head.rotation.y = DL.damp(m.head.rotation.y, 0, 2, dt);
      }
      // 押し合い
      const pr = this.r + 0.33;
      if (dist < pr && dist > 1e-4 && this.pose === 'stand') {
        vx -= (dx / dist) * 2;
        vz -= (dz / dist) * 2;
      }
      if (this.pose === 'stand' || this.pose === 'aim') this.physics(dt, vx, vz);
      this.spd = DL.damp(this.spd, Math.min(want, this.lastMove), 10, dt);
      this.animate(dt, aiming);
      this.sync();
    }
    combatTarget() {
      return this.role === 'ally' && this.target && this.target.alive;
    }
    allyThink(dt) {
      const G = this.G;
      this.targetT -= dt;
      if (this.targetT <= 0) {
        this.targetT = 0.35;
        let best = null, bd = 28;
        const e0 = this.eye();
        const ex = e0.x, ey = e0.y, ez = e0.z;
        for (const e of G.entities) {
          if (!e.alive || !e.hostile || e === this || e.surrendered) continue;
          if (e instanceof Mutant && e.K.passive) continue;
          const d = Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z);
          if (d < bd && G.world.los(ex, ey, ez, e.pos.x, e.pos.y + e.h * 0.6, e.pos.z)) {
            bd = d;
            best = e;
          }
        }
        this.target = best;
      }
      const t = this.target;
      if (!t || !t.alive) return false;
      const dx = t.pos.x - this.pos.x, dz = t.pos.z - this.pos.z;
      this.turnTo(DL.yawTo(dx, dz), 8, dt);
      this.fireT -= dt;
      if (this.fireT <= 0) {
        if (this.burst <= 0) {
          this.burst = DL.randi(2, 4);
          this.fireT = 0.5 + Math.random() * 0.6;
        } else {
          this.burst--;
          this.fireT = 0.13;
          const mz = this.muzzle();
          G.audio.shot('enemy', this.pos);
          G.fx.muzzle(mz.x, mz.y, mz.z);
          const d = Math.hypot(dx, dz);
          const hit = Math.random() < DL.clamp(0.7 - d * 0.015, 0.3, 0.7);
          const ty = t.pos.y + t.h * 0.55;
          G.fx.tracer(mz.x, mz.y, mz.z, t.pos.x + (hit ? 0 : DL.rand(-0.8, 0.8)), ty + (hit ? 0 : DL.rand(-0.5, 0.5)), t.pos.z + (hit ? 0 : DL.rand(-0.8, 0.8)));
          if (hit) {
            t.hurt(this.o.allyDmg || 15, 'body', this.pos, 'ally');
            G.fx.blood(t.pos.x, ty, t.pos.z, 5);
          }
        }
      }
      return true;
    }
    muzzle() {
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
      return tmpV.set(this.pos.x + fx * 0.75 + rx * 0.2, this.pos.y + 1.38, this.pos.z + fz * 0.75 + rz * 0.2);
    }
    enemyThink(dt, dist, dx, dz, moveTo) {
      const G = this.G, P = G.player, W = G.world;
      let vx = 0, vz = 0, want = 0, aiming = false;
      const done = () => ({ vx, vz, want, aiming });
      const mv = (tx, tz, spd) => {
        const ddx = tx - this.pos.x, ddz = tz - this.pos.z;
        const d = Math.hypot(ddx, ddz);
        if (d < 0.05) return d;
        vx = (ddx / d) * spd;
        vz = (ddz / d) * spd;
        want = spd;
        return d;
      };
      void moveTo;
      if (this.surrendered) {
        this.turnTo(DL.yawTo(dx, dz), 3, dt);
        return done();
      }
      this.senseT -= dt;
      if (this.senseT <= 0) {
        this.senseT = 0.15;
        this.canSee = this.state === 'sleep' ? false : this.seeCheck(P, dist);
      }
      if (this.canSee && P.alive) {
        const vis = dist < 4 ? 1 : DL.clamp(P.lit * 1.25 + 0.12, 0.12, 1);
        const rate = vis * (dist < 7 ? 2.6 : dist < 15 ? 1.1 : 0.5) * (P.crouch ? 0.55 : 1) * (P.moving ? 1.3 : 1);
        this.aware = Math.min(1.2, this.aware + rate * dt * (this.state === 'combat' ? 4 : 1));
        this.lastKnown.copy(P.pos);
      } else if (this.state !== 'combat') this.aware = Math.max(0, this.aware - dt * 0.07);
      if (this.state !== 'combat' && this.aware >= 1) this.enterCombat();
      else if ((this.state === 'idle' || this.state === 'patrol' || this.state === 'sleep') && this.aware >= 0.35) {
        this.state = 'suspicious';
        this.stateT = 9;
        if (this.pose !== 'stand') this.setPose('stand');
        this.bark(DL.pick(['ん…? 誰かいるのか?', '今、影が動いたような…', '…気のせいか?']));
      }
      // 降伏判定
      if (this.canSurrender && this.state === 'combat' && dist < 12) {
        let others = 0;
        for (const e of G.entities) if (e !== this && e instanceof Human && e.role === 'enemy' && e.alive && !e.surrendered && e.pos.distanceToSquared(this.pos) < 30 * 30) others++;
        if (others === 0 || this.hp < this.maxHp * 0.5) {
          this.surrendered = true;
          this.state = 'surrender';
          this.setPose('kneel');
          if (this.model.gun) this.model.gun.visible = false;
          this.barkT = 0;
          this.bark('ま、待て! 撃つな! 降参だ…頼む!');
          G.flags.surrendered = true;
          return done();
        }
      }
      switch (this.state) {
        case 'sleep':
          break;
        case 'idle':
          this.stateT -= dt;
          if (this.stateT <= 0) {
            this.stateT = 3 + Math.random() * 4;
            this.lookYaw = this.homeYaw + (Math.random() - 0.5) * 1.6;
          }
          if (this.lookYaw !== undefined) this.turnTo(this.lookYaw, 1.2, dt);
          if (Math.hypot(this.home.x - this.pos.x, this.home.z - this.pos.z) > 0.6) {
            mv(this.home.x, this.home.z, 1.4);
            this.turnTo(DL.yawTo(this.home.x - this.pos.x, this.home.z - this.pos.z), 5, dt);
          }
          break;
        case 'patrol': {
          const wp = this.patrol[this.patrolI];
          this.stateT -= dt;
          if (this.stateT > 0) break;
          const d = mv(wp[0], wp[1], 1.4);
          this.turnTo(DL.yawTo(wp[0] - this.pos.x, wp[1] - this.pos.z), 4, dt);
          if (d < 0.5) {
            this.patrolI = (this.patrolI + 1) % this.patrol.length;
            this.stateT = 1.5 + Math.random() * 2;
          }
          break;
        }
        case 'suspicious': {
          this.stateT -= dt;
          const lx = this.lastKnown.x - this.pos.x, lz = this.lastKnown.z - this.pos.z;
          this.turnTo(DL.yawTo(lx, lz), 3, dt);
          if (this.stateT < 6 && Math.hypot(lx, lz) > 1.5) {
            if (W.navTarget(W.flowH, this.pos.x, this.pos.z, nav) && Math.hypot(lx, lz) < 25) mv(nav.x, nav.z, 1.6);
            else mv(this.lastKnown.x, this.lastKnown.z, 1.6);
          }
          if (this.stateT <= 0 && this.aware < 0.5) {
            this.state = this.patrol ? 'patrol' : 'idle';
            this.aware = 0.2;
            this.bark(DL.pick(['…気のせいか。', 'ネズミだろ。', 'ちっ、驚かせやがって。']));
          }
          break;
        }
        case 'combat': {
          if (!P.alive) {
            this.state = 'idle';
            break;
          }
          if (this.canSee) {
            this.lostT = 0;
            aiming = true;
            this.turnTo(DL.yawTo(dx, dz), 7, dt);
            this.strafeT -= dt;
            if (this.strafeT <= 0) {
              this.strafeT = 1 + Math.random() * 1.5;
              this.strafe = Math.random() < 0.5 ? 1 : -1;
            }
            const nx = dx / (dist || 1), nz = dz / (dist || 1);
            let fwd = dist > 16 ? 1 : dist < 5 ? -0.8 : 0;
            const sp = 1.6;
            vx = (nx * fwd + -nz * this.strafe * 0.7) * sp;
            vz = (nz * fwd + nx * this.strafe * 0.7) * sp;
            want = sp;
            this.shoot(dt, dist);
          } else {
            this.lostT += dt;
            if (W.navTarget(W.flowH, this.pos.x, this.pos.z, nav)) {
              mv(nav.x, nav.z, 3.2);
              this.turnTo(DL.yawTo(nav.x - this.pos.x, nav.z - this.pos.z), 6, dt);
            } else {
              mv(this.lastKnown.x, this.lastKnown.z, 3.2);
              this.turnTo(DL.yawTo(this.lastKnown.x - this.pos.x, this.lastKnown.z - this.pos.z), 6, dt);
            }
            if (this.lostT > 12) {
              this.state = 'search';
              this.stateT = 12;
              this.aware = 0.6;
              this.bark('どこへ行った…探せ!');
            }
          }
          break;
        }
        case 'search': {
          this.stateT -= dt;
          if (this.stateT <= 0) {
            this.state = this.patrol ? 'patrol' : 'idle';
            this.aware = 0.3;
          }
          const lx = this.lastKnown.x - this.pos.x, lz = this.lastKnown.z - this.pos.z;
          if (Math.hypot(lx, lz) > 1) {
            mv(this.lastKnown.x, this.lastKnown.z, 1.5);
            this.turnTo(DL.yawTo(lx, lz), 3, dt);
          } else this.turnTo(this.yaw + 1, 1, dt);
          break;
        }
      }
      return done();
    }
    shoot(dt, dist) {
      const G = this.G, P = G.player;
      this.fireT -= dt;
      if (this.fireT > 0) return;
      if (this.burst <= 0) {
        this.burst = DL.randi(3, 6);
        this.fireT = 0.6 + Math.random() * 0.9;
        return;
      }
      this.burst--;
      this.fireT = 0.12;
      const mz = this.muzzle();
      const mx = mz.x, my = mz.y, mzz = mz.z;
      G.audio.shot('enemy', this.pos);
      G.fx.muzzle(mx, my, mzz);
      G.noiseAt(this.pos, 28, 'gun', this);
      let chance = DL.clamp(0.6 - dist * 0.017, 0.1, 0.6) * this.acc;
      if (P.moving) chance *= 0.75;
      if (P.crouch) chance *= 0.85;
      if (P.lit < 0.25 && dist > 9) chance *= 0.6;
      const ey = P.pos.y + P.h * 0.7;
      if (Math.random() < chance) {
        P.damage(this.dmg, this.pos, 'bullet');
        G.fx.tracer(mx, my, mzz, P.pos.x, ey - 0.2, P.pos.z);
      } else {
        const tx = P.pos.x + DL.rand(-1.2, 1.2), ty = ey + DL.rand(-0.6, 0.8), tz = P.pos.z + DL.rand(-1.2, 1.2);
        const ddx = tx - mx, ddy = ty - my, ddz = tz - mzz;
        const d = Math.hypot(ddx, ddy, ddz);
        const r = G.world.raycast(mx, my, mzz, ddx / d, ddy / d, ddz / d, d + 20);
        G.fx.tracer(mx, my, mzz, r.x, r.y, r.z);
        // 弾が耳元をかすめた（着弾点がプレイヤーより奥）
        if (r.t > d - 1.5 && G.audio.whiz) G.audio.whiz({ x: tx, y: ty, z: tz });
        if (r.hit) {
          G.fx.sparks(r.x, r.y, r.z, r.nx, r.ny, r.nz, 4);
          if (r.t < 25) G.audio.impact(tmpV.set(r.x, r.y, r.z), 'wall');
        }
      }
    }
    updateGhost(dt) {
      const m = this.model;
      const gm = m.root.userData.glowMat;
      this.ghostA = DL.damp(this.ghostA, this.fadeOut ? 0 : 0.22 + Math.sin(this.G.time * 3 + this.pos.x) * 0.05, 2, dt);
      if (gm) gm.opacity = this.ghostA;
      if (this.path) {
        const wp = this.path[this.pathI];
        const ddx = wp.x - this.pos.x, ddz = wp.z - this.pos.z;
        const d = Math.hypot(ddx, ddz);
        if (d > 0.1) {
          this.pos.x += (ddx / d) * this.speed * dt;
          this.pos.z += (ddz / d) * this.speed * dt;
          this.yaw = DL.yawTo(ddx, ddz);
          this.spd = this.speed;
        } else {
          this.pathI++;
          if (this.pathI >= this.path.length) this.path = null;
        }
      } else this.spd = 0;
      this.animate(dt, false);
      this.sync();
    }
    animate(dt, aiming) {
      const m = this.model, s = this.spd;
      if (this.pose !== 'stand' && this.pose !== 'aim') {
        // 呼吸
        m.torso.position.y = Math.sin(this.G.time * 1.6 + this.pos.x) * 0.006;
        if (this.pose === 'guitar') {
          m.armR.el.rotation.x = 1.2 + Math.sin(this.G.time * 9) * 0.12;
        }
        return;
      }
      this.gait += dt * (s * 2.4);
      const amp = DL.clamp(s / 3, 0, 1);
      const a = Math.sin(this.gait);
      m.legL.hip.rotation.x = a * 0.6 * amp;
      m.legR.hip.rotation.x = -a * 0.6 * amp;
      m.legL.kn.rotation.x = -Math.max(0, -a) * 0.9 * amp;
      m.legR.kn.rotation.x = -Math.max(0, a) * 0.9 * amp;
      m.hips.position.y = 0.92 + Math.abs(Math.cos(this.gait)) * 0.03 * amp;
      if (aiming || (this.role === 'enemy' && this.state === 'combat')) {
        m.armR.sh.rotation.x = DL.damp(m.armR.sh.rotation.x, 1.35, 10, dt);
        m.armL.sh.rotation.x = DL.damp(m.armL.sh.rotation.x, 1.45, 10, dt);
        m.armL.sh.rotation.z = -0.45;
        m.armR.el.rotation.x = 0.15;
        m.armL.el.rotation.x = 0.3;
      } else if (this.model.gun && this.model.gun.visible) {
        m.armR.sh.rotation.x = DL.damp(m.armR.sh.rotation.x, 0.5 - a * 0.1 * amp, 6, dt);
        m.armR.el.rotation.x = 0.9;
        m.armL.sh.rotation.x = DL.damp(m.armL.sh.rotation.x, 0.7 + a * 0.1 * amp, 6, dt);
        m.armL.sh.rotation.z = -0.3;
        m.armL.el.rotation.x = 0.9;
      } else if (this.o.armsPose !== 'arms' || s > 0.3) {
        m.armL.sh.rotation.x = -a * 0.5 * amp;
        m.armR.sh.rotation.x = a * 0.5 * amp;
        m.armL.sh.rotation.z = 0;
        m.armL.el.rotation.set(0, 0, 0);
        m.armR.el.rotation.set(0, 0, 0);
      }
      m.torso.position.y = Math.sin(this.G.time * 1.6 + this.pos.x) * 0.004;
    }
    sync() {
      this.mesh.position.copy(this.pos);
      this.mesh.rotation.y = this.yaw;
      if (this.pose === 'sleep') this.mesh.position.y = this.pos.y + 0.14;
    }
  }
  DL.Human = Human;

  // ================= 拾得物 =================
  const PICK = {
    ammo_p: { name: '拳銃弾', col: 0xb08a40 },
    ammo_r: { name: '小銃弾', col: 0x5a6040 },
    ammo_s: { name: '散弾', col: 0x8a2a1e },
    mil: { name: '軍用弾', col: 0xd8b050 },
    medkit: { name: '医療キット', col: 0xd8d4c8 },
    filter: { name: 'フィルター', col: 0x6a6e66 },
    bomb: { name: 'パイプ爆弾', col: 0x3a3a38 },
    mask: { name: 'ガスマスク', col: 0x2a2a28 },
    shotgun: { name: '二連散弾銃「鴉」', col: 0x3a2a1a },
  };
  DL.PICK = PICK;
  class Pickup extends Entity {
    constructor(G, type, amount, x, y, z) {
      super(G);
      this.type = type;
      this.amount = amount;
      this.pos.set(x, y, z);
      const g = new T.Group();
      const C = DL.cmat;
      const def = PICK[type];
      if (type === 'medkit') {
        DL.box(0.3, 0.14, 0.2, C(0xd8d4c8, 0.7), 0, 0.07, 0, g);
        DL.box(0.12, 0.145, 0.04, C(0xa02020, 0.6), 0, 0.072, -0.085, g);
        DL.box(0.04, 0.145, 0.12, C(0xa02020, 0.6), 0, 0.072, -0.05, g).position.z = 0;
      } else if (type === 'filter') {
        DL.cyl(0.07, 0.12, C(0x6a6e66, 0.5, 0.6), 0, 0.06, 0, g);
        DL.cyl(0.035, 0.03, C(0x2a2a28, 0.5, 0.6), 0, 0.135, 0, g);
      } else if (type === 'mil') {
        for (let i = 0; i < 5; i++) DL.cyl(0.012, 0.06, C(0xd8b050, 0.3, 0.9), -0.05 + i * 0.025, 0.03, 0, g);
      } else if (type === 'bomb') {
        const c = DL.cyl(0.03, 0.16, C(0x3a3a38, 0.5, 0.7), 0, 0.03, 0, g);
        c.rotation.z = Math.PI / 2;
      } else if (type === 'mask') {
        DL.sph(0.2, 0.22, 0.16, C(0x262624, 0.6), 0, 0.1, 0, g);
        const f = DL.cyl(0.05, 0.08, C(0x5a5a56, 0.5, 0.5), 0, 0.07, -0.1, g);
        f.rotation.x = Math.PI / 2;
      } else if (type === 'shotgun') {
        DL.box(0.06, 0.08, 1.0, C(0x3a2a1a, 0.6), 0, 0.05, 0, g);
        DL.box(0.07, 0.04, 0.5, C(0x2a2a2a, 0.4, 0.8), 0, 0.1, -0.3, g);
        g.rotation.y = 0.6;
      } else {
        DL.box(0.22, 0.1, 0.14, C(def.col, 0.7, 0.2), 0, 0.05, 0, g);
        DL.box(0.23, 0.02, 0.06, C(0xc8c0a0, 0.8), 0, 0.08, 0, g);
      }
      const glint = new T.Sprite(new T.SpriteMaterial({ map: DL.tex('glow'), color: 0xffe0a0, transparent: true, opacity: 0.5, blending: T.AdditiveBlending, depthWrite: false }));
      glint.scale.set(0.35, 0.35, 0.35);
      glint.position.y = 0.15;
      g.add(glint);
      this.glint = glint;
      this.mesh = g;
      g.position.copy(this.pos);
      g.rotation.y = Math.random() * 6;
      G.scene.add(g);
      this.t = Math.random() * 6;
      this.delay = 0.6;
    }
    update(dt) {
      this.t += dt;
      this.delay -= dt;
      this.glint.material.opacity = 0.25 + Math.sin(this.t * 3) * 0.2;
      const P = this.G.player;
      if (this.delay > 0 || !P.alive) return;
      const dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z, dy = P.pos.y - this.pos.y;
      if (dx * dx + dz * dz < 1.35 * 1.35 && Math.abs(dy) < 1.6) {
        if (P.give(this.type, this.amount)) this.remove();
      }
    }
  }
  DL.Pickup = Pickup;

  // ================= パイプ爆弾 =================
  class Bomb extends Entity {
    constructor(G, x, y, z, vx, vy, vz) {
      super(G);
      this.pos.set(x, y, z);
      this.v = new T.Vector3(vx, vy, vz);
      this.fuse = 2.4;
      const g = new T.Group();
      const c = DL.cyl(0.03, 0.16, DL.cmat(0x3a3a38, 0.5, 0.7), 0, 0, 0, g);
      c.rotation.z = Math.PI / 2;
      const spark = new T.Sprite(new T.SpriteMaterial({ map: DL.tex('glow'), color: 0xffa040, blending: T.AdditiveBlending, depthWrite: false, transparent: true }));
      spark.scale.set(0.25, 0.25, 0.25);
      spark.position.x = 0.09;
      g.add(spark);
      this.spark = spark;
      this.mesh = g;
      G.scene.add(g);
      this.spin = new T.Vector3(Math.random() * 10, Math.random() * 10, 0);
    }
    update(dt) {
      const G = this.G, W = G.world;
      this.fuse -= dt;
      this.spark.material.opacity = 0.6 + Math.random() * 0.4;
      if (this.fuse <= 0) {
        this.explode();
        return;
      }
      this.v.y -= 16 * dt;
      const sp = this.v.length();
      if (sp > 0.01) {
        const d = sp * dt;
        const r = W.raycast(this.pos.x, this.pos.y, this.pos.z, this.v.x / sp, this.v.y / sp, this.v.z / sp, d + 0.05);
        if (r.hit) {
          this.pos.set(r.x + r.nx * 0.05, r.y + r.ny * 0.05, r.z + r.nz * 0.05);
          const vn = this.v.x * r.nx + this.v.y * r.ny + this.v.z * r.nz;
          this.v.x -= 2 * vn * r.nx;
          this.v.y -= 2 * vn * r.ny;
          this.v.z -= 2 * vn * r.nz;
          this.v.multiplyScalar(0.4);
          if (sp > 2) G.audio.clank(this.pos, 0.25);
          if (r.ny > 0.5 && Math.abs(this.v.y) < 1) {
            this.v.y = 0;
            this.v.x *= 0.6;
            this.v.z *= 0.6;
          }
        } else this.pos.addScaledVector(this.v, dt);
      }
      this.mesh.position.copy(this.pos);
      this.mesh.rotation.x += this.spin.x * dt * Math.min(1, sp);
      this.mesh.rotation.y += this.spin.y * dt * Math.min(1, sp);
    }
    explode() {
      const G = this.G, p = this.pos;
      G.audio.explosion(p);
      G.fx.explosion(p.x, p.y, p.z);
      G.noiseAt(p, 50, 'boom');
      const R = 7.5;
      for (const e of G.entities) {
        if (!e.alive || !e.shootable) continue;
        const d = e.pos.distanceTo(p);
        if (d < R && G.world.los(p.x, p.y + 0.3, p.z, e.pos.x, e.pos.y + e.h * 0.5, e.pos.z)) e.hurt(200 * (1 - d / R) + 20, 'body', p, 'player');
      }
      const P = G.player;
      const d = P.pos.distanceTo(p);
      const PR = 6;
      if (d < PR && G.world.los(p.x, p.y + 0.3, p.z, P.pos.x, P.pos.y + 1, P.pos.z)) P.damage(55 * (1 - d / PR), p, 'boom');
      P.shake(DL.clamp(1.4 - d / 15, 0, 1.2));
      this.remove();
    }
  }
  DL.Bomb = Bomb;

  // ================= エフェクト =================
  class PPool {
    constructor(scene, n, o) {
      this.n = n;
      this.p = new Float32Array(n * 3);
      this.c = new Float32Array(n * 3);
      this.v = new Float32Array(n * 3);
      this.b = new Float32Array(n * 3);
      this.life = new Float32Array(n);
      this.max = new Float32Array(n);
      this.count = 0;
      this.grav = o.grav || 0;
      this.drag = o.drag || 0;
      this.fade = o.additive;
      const g = new T.BufferGeometry();
      this.pa = new T.BufferAttribute(this.p, 3);
      this.ca = new T.BufferAttribute(this.c, 3);
      this.pa.setUsage(T.DynamicDrawUsage);
      this.ca.setUsage(T.DynamicDrawUsage);
      g.setAttribute('position', this.pa);
      g.setAttribute('color', this.ca);
      g.setDrawRange(0, 0);
      this.geo = g;
      this.mat = new T.PointsMaterial({ size: o.size, map: DL.tex(o.map || 'dot'), vertexColors: true, transparent: true, depthWrite: false, blending: o.additive ? T.AdditiveBlending : T.NormalBlending, opacity: o.opacity || 1, sizeAttenuation: true });
      this.pts = new T.Points(g, this.mat);
      this.pts.frustumCulled = false;
      scene.add(this.pts);
    }
    emit(x, y, z, vx, vy, vz, life, r, g, b) {
      if (this.count >= this.n) return;
      const i = this.count++, k = i * 3;
      this.p[k] = x; this.p[k + 1] = y; this.p[k + 2] = z;
      this.v[k] = vx; this.v[k + 1] = vy; this.v[k + 2] = vz;
      this.b[k] = r; this.b[k + 1] = g; this.b[k + 2] = b;
      this.c[k] = r; this.c[k + 1] = g; this.c[k + 2] = b;
      this.life[i] = this.max[i] = life;
    }
    update(dt) {
      let i = 0;
      const dr = Math.max(0, 1 - this.drag * dt);
      while (i < this.count) {
        this.life[i] -= dt;
        if (this.life[i] <= 0) {
          const last = --this.count;
          if (i !== last) {
            const a = i * 3, b = last * 3;
            for (let j = 0; j < 3; j++) {
              this.p[a + j] = this.p[b + j];
              this.v[a + j] = this.v[b + j];
              this.b[a + j] = this.b[b + j];
            }
            this.life[i] = this.life[last];
            this.max[i] = this.max[last];
          }
          continue;
        }
        const k = i * 3;
        this.v[k + 1] -= this.grav * dt;
        this.v[k] *= dr; this.v[k + 1] *= dr; this.v[k + 2] *= dr;
        this.p[k] += this.v[k] * dt;
        this.p[k + 1] += this.v[k + 1] * dt;
        this.p[k + 2] += this.v[k + 2] * dt;
        const f = this.fade ? this.life[i] / this.max[i] : 1;
        this.c[k] = this.b[k] * f; this.c[k + 1] = this.b[k + 1] * f; this.c[k + 2] = this.b[k + 2] * f;
        i++;
      }
      this.geo.setDrawRange(0, this.count);
      this.pa.needsUpdate = true;
      this.ca.needsUpdate = true;
    }
  }

  class FX {
    constructor(G) {
      this.G = G;
      const S = G.scene;
      this.sparkP = new PPool(S, 400, { size: 0.06, additive: true, grav: 9, drag: 1 });
      this.emberP = new PPool(S, 200, { size: 0.05, additive: true, grav: -0.6, drag: 0.5 });
      this.bloodP = new PPool(S, 300, { size: 0.08, additive: false, grav: 9, drag: 1.5 });
      this.dustP = new PPool(S, 300, { size: 0.35, additive: false, grav: -0.1, drag: 2, map: 'smoke', opacity: 0.35 });
      this.holes = [];
      this.holeI = 0;
      this.bloods = [];
      this.bloodI = 0;
      const pg = new T.PlaneGeometry(1, 1);
      this.holeMat = new T.MeshStandardMaterial({ map: DL.tex('hole'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 1 });
      this.bloodMat = new T.MeshStandardMaterial({ map: DL.tex('blood'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, roughness: 0.4 });
      for (let i = 0; i < 70; i++) {
        const m = new T.Mesh(pg, this.holeMat);
        m.visible = false;
        m.scale.setScalar(0.1);
        S.add(m);
        this.holes.push(m);
      }
      for (let i = 0; i < 24; i++) {
        const m = new T.Mesh(pg, this.bloodMat);
        m.visible = false;
        S.add(m);
        this.bloods.push(m);
      }
      this.tracers = [];
      const tm = new T.LineBasicMaterial({ color: 0xffd080, transparent: true, opacity: 0.7, blending: T.AdditiveBlending, depthWrite: false });
      for (let i = 0; i < 16; i++) {
        const g = new T.BufferGeometry();
        g.setAttribute('position', new T.Float32BufferAttribute([0, 0, 0, 0, 0, 1], 3));
        const l = new T.Line(g, tm);
        l.visible = false;
        l.frustumCulled = false;
        l.userData.t = 0;
        S.add(l);
        this.tracers.push(l);
      }
      this.tracerI = 0;
      this.flashes = [];
      for (let i = 0; i < 8; i++) {
        const s = new T.Sprite(new T.SpriteMaterial({ map: DL.tex('flash'), color: 0xffd8a0, transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
        s.visible = false;
        s.userData.t = 0;
        S.add(s);
        this.flashes.push(s);
      }
      this.flashI = 0;
      this.smokes = [];
      for (let i = 0; i < 40; i++) {
        const s = new T.Sprite(new T.SpriteMaterial({ map: DL.tex('smoke'), color: 0x8a8680, transparent: true, depthWrite: false, opacity: 0 }));
        s.visible = false;
        s.userData = { t: 0, life: 1, v: new T.Vector3(), grow: 1, a: 0.5 };
        S.add(s);
        this.smokes.push(s);
      }
      this.smokeI = 0;
      this.fires = [];
      this.transient = [];
      this.motes = null;
      this.ash = null;
      this.gas = [];
    }
    sparks(x, y, z, nx, ny, nz, n = 6) {
      for (let i = 0; i < n; i++) {
        const s = 1.5 + Math.random() * 3;
        this.sparkP.emit(x, y, z, (nx + DL.rand(-0.7, 0.7)) * s, (ny + DL.rand(-0.3, 0.9)) * s, (nz + DL.rand(-0.7, 0.7)) * s, 0.2 + Math.random() * 0.35, 1, 0.75, 0.35);
      }
      for (let i = 0; i < 3; i++) this.dustP.emit(x + nx * 0.05, y + ny * 0.05, z + nz * 0.05, nx * 0.6 + DL.rand(-0.2, 0.2), ny * 0.6 + 0.2, nz * 0.6 + DL.rand(-0.2, 0.2), 0.8, 0.45, 0.43, 0.4);
    }
    blood(x, y, z, n = 8) {
      for (let i = 0; i < n; i++) this.bloodP.emit(x, y, z, DL.rand(-1.5, 1.5), DL.rand(0, 2.5), DL.rand(-1.5, 1.5), 0.4 + Math.random() * 0.3, 0.35, 0.03, 0.02);
    }
    dust(x, y, z, n = 10, spread = 1) {
      for (let i = 0; i < n; i++) this.dustP.emit(x + DL.rand(-spread, spread), y + DL.rand(-0.3, 0.3), z + DL.rand(-spread, spread), DL.rand(-0.5, 0.5), DL.rand(-0.2, 0.4), DL.rand(-0.5, 0.5), 1.5 + Math.random(), 0.42, 0.4, 0.37);
    }
    decalHole(x, y, z, nx, ny, nz) {
      const m = this.holes[this.holeI++ % this.holes.length];
      m.visible = true;
      m.position.set(x + nx * 0.012, y + ny * 0.012, z + nz * 0.012);
      m.lookAt(x + nx, y + ny, z + nz);
      m.rotateZ(Math.random() * 6);
      m.scale.setScalar(0.08 + Math.random() * 0.05);
    }
    decalBlood(x, y, z, nx, ny, nz, size = 1) {
      const m = this.bloods[this.bloodI++ % this.bloods.length];
      m.visible = true;
      m.position.set(x + nx * 0.015, y + ny * 0.015, z + nz * 0.015);
      m.lookAt(x + nx, y + ny, z + nz);
      m.rotateZ(Math.random() * 6);
      m.scale.setScalar(size * (0.8 + Math.random() * 0.5));
    }
    tracer(x0, y0, z0, x1, y1, z1) {
      const l = this.tracers[this.tracerI++ % this.tracers.length];
      const a = l.geometry.attributes.position;
      // 弾道の一部だけを光らせる
      const k = 0.35 + Math.random() * 0.3;
      a.setXYZ(0, DL.lerp(x0, x1, k - 0.25), DL.lerp(y0, y1, k - 0.25), DL.lerp(z0, z1, k - 0.25));
      a.setXYZ(1, DL.lerp(x0, x1, k), DL.lerp(y0, y1, k), DL.lerp(z0, z1, k));
      a.needsUpdate = true;
      l.visible = true;
      l.userData.t = 0.05;
    }
    muzzle(x, y, z) {
      const s = this.flashes[this.flashI++ % this.flashes.length];
      s.position.set(x, y, z);
      s.visible = true;
      s.userData.t = 0.05;
      const sc = 0.4 + Math.random() * 0.3;
      s.scale.set(sc, sc, sc);
      s.material.rotation = Math.random() * 6;
      s.material.color.setHex(0xffd8a0).multiplyScalar(this.G.post && this.G.post.on ? 4 : 1);
      this.flashLamp(x, y, z, 0xffb060, 2.2, 9, 0.06);
    }
    flashLamp(x, y, z, color, intensity, range, dur) {
      const L = { x, y, z, color, intensity, range, on: true, broken: false, _f: 1, priority: 20, life: dur, max: dur, transient: true };
      this.transient.push(L);
      this.G.lamps.push(L);
      return L;
    }
    smoke(x, y, z, o = {}) {
      const s = this.smokes[this.smokeI++ % this.smokes.length];
      s.visible = true;
      s.position.set(x, y, z);
      const u = s.userData;
      u.t = 0;
      u.life = o.life || 2.5;
      u.v.set(DL.rand(-0.3, 0.3), o.rise !== undefined ? o.rise : 0.4, DL.rand(-0.3, 0.3));
      u.grow = o.grow || 1.2;
      u.a = o.a || 0.45;
      u.s0 = o.size || 1;
      s.material.color.setHex(o.color || 0x8a8680);
      s.material.rotation = Math.random() * 6;
      s.scale.setScalar(u.s0);
    }
    explosion(x, y, z) {
      this.flashLamp(x, y + 0.5, z, 0xffa050, 6, 16, 0.35);
      for (let i = 0; i < 40; i++) {
        const s = 3 + Math.random() * 7;
        const a = Math.random() * 6.28, b = Math.random() * 1.4;
        this.sparkP.emit(x, y + 0.3, z, Math.cos(a) * Math.cos(b) * s, Math.sin(b) * s, Math.sin(a) * Math.cos(b) * s, 0.4 + Math.random() * 0.6, 1, 0.6, 0.2);
      }
      for (let i = 0; i < 8; i++) this.smoke(x + DL.rand(-1, 1), y + DL.rand(0.3, 1.5), z + DL.rand(-1, 1), { life: 3 + Math.random() * 2, size: 1.5, grow: 2.2, a: 0.6, color: 0x5a5650, rise: 0.6 });
      const s = this.flashes[this.flashI++ % this.flashes.length];
      s.position.set(x, y + 0.6, z);
      s.visible = true;
      s.userData.t = 0.12;
      s.scale.set(4, 4, 4);
    }
    addFire(x, y, z, scale = 1) {
      const g = new T.Group();
      g.position.set(x, y, z);
      const sprites = [];
      for (let i = 0; i < 3; i++) {
        const s = new T.Sprite(new T.SpriteMaterial({ map: DL.tex('fire'), color: 0xffffff, transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
        s.position.set(DL.rand(-0.1, 0.1) * scale, (0.2 + i * 0.18) * scale, DL.rand(-0.1, 0.1) * scale);
        g.add(s);
        sprites.push(s);
      }
      this.G.scene.add(g);
      const f = { g, sprites, scale, x, y, z, t: Math.random() * 10, emberT: 0 };
      this.fires.push(f);
      return f;
    }
    setMotes(on) {
      if (this.motes) {
        this.G.scene.remove(this.motes.pts);
        this.motes = null;
      }
      if (!on) return;
      const n = 350, p = new Float32Array(n * 3);
      for (let i = 0; i < n * 3; i++) p[i] = DL.rand(-10, 10);
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(p, 3));
      const m = new T.PointsMaterial({ size: 0.022, map: DL.tex('dot'), color: 0xb8b0a0, transparent: true, opacity: 0.5, depthWrite: false, blending: T.AdditiveBlending });
      const pts = new T.Points(g, m);
      pts.frustumCulled = false;
      this.G.scene.add(pts);
      this.motes = { pts, p, n, attr: g.attributes.position };
    }
    setAsh(on) {
      if (this.ash) {
        this.G.scene.remove(this.ash.pts);
        this.ash = null;
      }
      if (!on) return;
      const n = 1800, p = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        p[i * 3] = DL.rand(-25, 25);
        p[i * 3 + 1] = DL.rand(-2, 22);
        p[i * 3 + 2] = DL.rand(-25, 25);
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(p, 3));
      const m = new T.PointsMaterial({ size: 0.06, map: DL.tex('dot'), color: 0xc8c4bc, transparent: true, opacity: 0.8, depthWrite: false });
      const pts = new T.Points(g, m);
      pts.frustumCulled = false;
      this.G.scene.add(pts);
      this.ash = { pts, p, n, attr: g.attributes.position };
    }
    addGas(x0, z0, x1, z1, y0, color) {
      const area = (x1 - x0) * (z1 - z0);
      const n = Math.min(70, Math.max(6, Math.round(area / 10)));
      for (let i = 0; i < n; i++) {
        const s = new T.Sprite(new T.SpriteMaterial({ map: DL.tex('smoke'), color: color || 0x9aaa60, transparent: true, depthWrite: false, opacity: 0.1 + Math.random() * 0.06 }));
        const x = DL.rand(x0, x1), z = DL.rand(z0, z1);
        const y = this.G.world.floorAt(x, z) + DL.rand(0.4, 2.2);
        s.position.set(x, y, z);
        const sc = DL.rand(3, 6);
        s.scale.set(sc, sc * 0.7, sc);
        s.material.rotation = Math.random() * 6;
        s.userData = { bx: x, by: y, bz: z, ph: Math.random() * 6, rs: DL.rand(-0.1, 0.1) };
        this.G.scene.add(s);
        this.gas.push(s);
      }
    }
    update(dt, cam) {
      this.sparkP.update(dt);
      this.emberP.update(dt);
      this.bloodP.update(dt);
      this.dustP.update(dt);
      for (const l of this.tracers) {
        if (!l.visible) continue;
        l.userData.t -= dt;
        if (l.userData.t <= 0) l.visible = false;
      }
      for (const s of this.flashes) {
        if (!s.visible) continue;
        s.userData.t -= dt;
        if (s.userData.t <= 0) s.visible = false;
      }
      for (const s of this.smokes) {
        if (!s.visible) continue;
        const u = s.userData;
        u.t += dt;
        const k = u.t / u.life;
        if (k >= 1) {
          s.visible = false;
          continue;
        }
        s.position.addScaledVector(u.v, dt);
        s.scale.setScalar(u.s0 * (1 + k * u.grow));
        s.material.opacity = u.a * Math.sin(k * Math.PI);
        s.material.rotation += dt * 0.2;
      }
      for (let i = this.transient.length - 1; i >= 0; i--) {
        const L = this.transient[i];
        L.life -= dt;
        L._f = Math.max(0, L.life / L.max);
        if (L.life <= 0) {
          this.transient.splice(i, 1);
          const j = this.G.lamps.indexOf(L);
          if (j >= 0) this.G.lamps.splice(j, 1);
        }
      }
      for (const f of this.fires) {
        f.t += dt;
        f.sprites.forEach((s, i) => {
          const k = 0.75 + Math.sin(f.t * (9 + i * 3) + i) * 0.15 + Math.random() * 0.1;
          const sc = f.scale * (0.9 - i * 0.2) * k;
          s.scale.set(sc, sc * 1.4, sc);
          s.position.y = (0.25 + i * 0.22) * f.scale + Math.sin(f.t * 5 + i) * 0.03;
          s.material.rotation = Math.sin(f.t * 2 + i) * 0.3;
        });
        f.emberT -= dt;
        if (f.emberT <= 0) {
          f.emberT = 0.1 + Math.random() * 0.25;
          this.emberP.emit(f.x + DL.rand(-0.2, 0.2) * f.scale, f.y + 0.4 * f.scale, f.z + DL.rand(-0.2, 0.2) * f.scale, DL.rand(-0.2, 0.2), DL.rand(0.8, 1.6), DL.rand(-0.2, 0.2), 1.2 + Math.random(), 1, 0.5, 0.15);
        }
      }
      if (this.motes) {
        const M = this.motes, p = M.p, t = this.G.time;
        for (let i = 0; i < M.n; i++) {
          const k = i * 3;
          p[k] += Math.sin(t * 0.3 + i) * 0.002;
          p[k + 1] += Math.cos(t * 0.2 + i * 1.3) * 0.0015 - 0.0008;
          // カメラ周囲でループ
          for (let a = 0; a < 3; a++) {
            const c = a === 0 ? cam.x : a === 1 ? cam.y : cam.z;
            const r = a === 1 ? 4 : 10;
            if (p[k + a] < c - r) p[k + a] += r * 2;
            else if (p[k + a] > c + r) p[k + a] -= r * 2;
          }
        }
        M.attr.needsUpdate = true;
      }
      if (this.ash) {
        const A = this.ash, p = A.p, t = this.G.time;
        const wx = Math.sin(t * 0.2) * 0.9 + 0.6, wz = Math.cos(t * 0.13) * 0.5;
        for (let i = 0; i < A.n; i++) {
          const k = i * 3;
          p[k] += (wx + Math.sin(t + i) * 0.3) * dt;
          p[k + 1] -= (0.7 + (i % 5) * 0.12) * dt;
          p[k + 2] += (wz + Math.cos(t * 1.3 + i) * 0.3) * dt;
          if (p[k] < cam.x - 25) p[k] += 50; else if (p[k] > cam.x + 25) p[k] -= 50;
          if (p[k + 2] < cam.z - 25) p[k + 2] += 50; else if (p[k + 2] > cam.z + 25) p[k + 2] -= 50;
          if (p[k + 1] < cam.y - 3) p[k + 1] += 24; else if (p[k + 1] > cam.y + 21) p[k + 1] -= 24;
        }
        A.attr.needsUpdate = true;
      }
      for (const s of this.gas) {
        const u = s.userData, t = this.G.time;
        s.position.set(u.bx + Math.sin(t * 0.2 + u.ph) * 0.8, u.by + Math.sin(t * 0.3 + u.ph * 2) * 0.2, u.bz + Math.cos(t * 0.17 + u.ph) * 0.8);
        s.material.rotation += u.rs * dt;
      }
    }
  }
  DL.FX = FX;
})();
