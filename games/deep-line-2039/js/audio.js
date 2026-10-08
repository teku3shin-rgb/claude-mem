'use strict';
// WebAudio による手続き型サウンド（素材ファイルなし）
(function () {
  const DL = window.DL;

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.enabled = false;
      this.vol = 0.8;
      this.L = { x: 0, y: 0, z: 0, yaw: 0 };
      this.amb = null;
      this.ambKind = null;
      this.evt = { drip: 3, clank: 12, howl: 25 };
      this.guitar = null;
      this.loops = new Set();
      this.breathT = 0;
      this.breathIn = true;
      this.geigerAcc = 0;
      this.heartT = 0;
    }
    init() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      let ctx;
      try {
        ctx = this.ctx = new AC();
      } catch (e) {
        return;
      }
      this.master = ctx.createGain();
      this.master.gain.value = this.vol;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.ratio.value = 4;
      comp.attack.value = 0.003;
      comp.release.value = 0.25;
      this.master.connect(comp);
      comp.connect(ctx.destination);
      this.sfx = ctx.createGain();
      this.sfx.connect(this.master);
      this.ambBus = ctx.createGain();
      this.ambBus.gain.value = 0.7;
      this.ambBus.connect(this.master);
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = 0.55;
      this.musicBus.connect(this.master);
      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this.makeIR(2.6, 2.4);
      this.revGain = ctx.createGain();
      this.revGain.gain.value = 0.6;
      this.reverb.connect(this.revGain);
      this.revGain.connect(this.master);
      this.noiseBuf = this.makeNoise(2, 'white');
      this.brownBuf = this.makeNoise(4, 'brown');
      this.ksCache = {};
      this.enabled = true;
    }
    setVolume(v) {
      this.vol = v;
      if (this.master) this.master.gain.value = v;
    }
    setReverb(v) {
      if (this.revGain) this.revGain.gain.value = v;
    }
    makeIR(dur, decay) {
      const ctx = this.ctx, sr = ctx.sampleRate, len = Math.floor(sr * dur);
      const buf = ctx.createBuffer(2, len, sr);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay) * (i < 200 ? i / 200 : 1);
      }
      return buf;
    }
    makeNoise(dur, kind) {
      const ctx = this.ctx, sr = ctx.sampleRate, len = Math.floor(sr * dur);
      const buf = ctx.createBuffer(1, len, sr);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'brown') {
          last = (last + 0.02 * w) / 1.02;
          d[i] = last * 3.5;
        } else d[i] = w;
      }
      return buf;
    }
    // ---------- 空間化 ----------
    setListener(x, y, z, yaw) {
      this.L.x = x; this.L.y = y; this.L.z = z; this.L.yaw = yaw;
    }
    spatial(pos, ref = 6) {
      if (!pos) return { g: 1, pan: 0, wet: 0.18, d: 0 };
      const dx = pos.x - this.L.x, dy = pos.y - this.L.y, dz = pos.z - this.L.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const g = 1 / (1 + Math.pow(d / ref, 1.35));
      const rx = Math.cos(this.L.yaw), rz = -Math.sin(this.L.yaw);
      const pan = d > 0.01 ? DL.clamp(((dx * rx + dz * rz) / d) * 0.85, -0.9, 0.9) : 0;
      const wet = Math.min(0.95, 0.2 + d / 28);
      return { g, pan, wet, d };
    }
    out(pos, mul = 1, ref) {
      const ctx = this.ctx;
      const s = this.spatial(pos, ref);
      const g = ctx.createGain();
      g.gain.value = s.g * mul;
      if (ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = s.pan;
        g.connect(p);
        p.connect(this.sfx);
      } else g.connect(this.sfx);
      const w = ctx.createGain();
      w.gain.value = s.wet * mul * Math.max(0.25, s.g);
      g.connect(w);
      w.connect(this.reverb);
      return g;
    }
    noise(t, buf, offset) {
      const s = this.ctx.createBufferSource();
      s.buffer = buf || this.noiseBuf;
      s.loop = true;
      s.start(t, offset !== undefined ? offset : Math.random() * 1.5);
      return s;
    }
    filt(type, freq, Q) {
      const f = this.ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      if (Q !== undefined) f.Q.value = Q;
      return f;
    }
    envGain(t, a, peak, d, curve) {
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
      if (curve === 'lin') g.gain.linearRampToValueAtTime(0.0001, t + a + d);
      else g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
      return g;
    }
    osc(type, f, t, dur) {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f, t);
      o.start(t);
      o.stop(t + dur);
      return o;
    }
    burst(dest, t, { lp = 3000, hp = 0, bp = 0, Q = 1, a = 0.002, peak = 1, d = 0.2, sweepTo = 0, buf } = {}) {
      const n = this.noise(t, buf);
      let node = n;
      if (hp) {
        const f = this.filt('highpass', hp);
        node.connect(f);
        node = f;
      }
      if (bp) {
        const f = this.filt('bandpass', bp, Q);
        node.connect(f);
        node = f;
      }
      const f = this.filt('lowpass', lp);
      if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + a + d);
      node.connect(f);
      const g = this.envGain(t, a, peak, d);
      f.connect(g);
      g.connect(dest);
      n.stop(t + a + d + 0.05);
      return g;
    }

    // ---------- 効果音 ----------
    shot(kind, pos) {
      if (!this.enabled) return;
      const t = this.ctx.currentTime;
      const C = {
        revolver: { lp: 3600, d: 0.42, th: 62, tg: 1.3, m: 1.05 },
        smg: { lp: 5200, d: 0.16, th: 115, tg: 0.65, m: 0.7 },
        shotgun: { lp: 2600, d: 0.6, th: 48, tg: 1.6, m: 1.25 },
        enemy: { lp: 4200, d: 0.2, th: 100, tg: 0.7, m: 0.8 },
      }[kind] || { lp: 4000, d: 0.2, th: 100, tg: 0.7, m: 0.8 };
      const out = this.out(pos, C.m, 10);
      this.burst(out, t, { lp: C.lp, a: 0.0015, peak: 1, d: C.d, sweepTo: 300 });
      this.burst(out, t, { hp: 2500, lp: 9000, a: 0.001, peak: 0.5, d: 0.04 });
      const o = this.osc('sine', C.th * 2.2, t, 0.3);
      o.frequency.exponentialRampToValueAtTime(C.th * 0.5, t + 0.18);
      const og = this.envGain(t, 0.002, C.tg, 0.22);
      o.connect(og);
      og.connect(out);
    }
    dryFire() {
      if (!this.enabled) return;
      const t = this.ctx.currentTime;
      this.burst(this.out(null, 0.5), t, { hp: 1500, lp: 6000, peak: 0.6, d: 0.03 });
    }
    click(vol = 0.4, f = 2500) {
      if (!this.enabled) return;
      const t = this.ctx.currentTime;
      this.burst(this.out(null, vol), t, { bp: f, Q: 3, lp: 9000, peak: 1, d: 0.04 });
    }
    reload(kind, phase) {
      if (!this.enabled) return;
      const t = this.ctx.currentTime;
      const o = this.out(null, 0.45);
      if (phase === 0) this.burst(o, t, { bp: 1400, Q: 2, lp: 7000, peak: 0.8, d: 0.08 });
      else if (phase === 1) {
        for (let i = 0; i < (kind === 'revolver' ? 3 : 1); i++) this.burst(o, t + i * 0.12, { bp: 3200, Q: 4, lp: 9000, peak: 0.7, d: 0.03 });
      } else {
        this.burst(o, t, { bp: 900, Q: 3, lp: 5000, peak: 1, d: 0.06 });
        this.burst(o, t + 0.07, { bp: 2400, Q: 3, lp: 8000, peak: 0.7, d: 0.04 });
      }
    }
    step(surface, vol, pos) {
      if (!this.enabled) return;
      const t = this.ctx.currentTime;
      const o = this.out(pos || null, vol, 5);
      switch (surface) {
        case 'gravel':
          for (let i = 0; i < 3; i++) this.burst(o, t + i * 0.012, { bp: 2400 + Math.random() * 1200, Q: 1.2, lp: 8000, peak: 0.5, d: 0.05 });
          break;
        case 'metal':
          this.burst(o, t, { bp: 700, Q: 6, lp: 4000, peak: 0.9, d: 0.12 });
          break;
        case 'wood':
          this.burst(o, t, { bp: 420, Q: 3, lp: 2500, peak: 1, d: 0.08 });
          break;
        case 'water':
          this.burst(o, t, { bp: 1200, Q: 0.8, lp: 5000, peak: 0.7, d: 0.15 });
          break;
        default:
          this.burst(o, t, { bp: 900 + Math.random() * 300, Q: 1.4, lp: 4500, peak: 0.8, d: 0.06 });
      }
    }
    land(vol) {
      if (!this.enabled) return;
      const t = this.ctx.currentTime;
      this.burst(this.out(null, vol), t, { lp: 900, peak: 1, d: 0.15 });
    }
    impact(pos, kind) {
      if (!this.enabled) return;
      const t = this.ctx.currentTime;
      const o = this.out(pos, 0.55, 6);
      if (kind === 'flesh') {
        this.burst(o, t, { lp: 500, peak: 1, d: 0.1 });
      } else if (kind === 'metal') {
        const freqs = [1250, 2730, 3910];
        freqs.forEach((f) => {
          const os = this.osc('sine', f * (0.95 + Math.random() * 0.1), t, 0.5);
          const g = this.envGain(t, 0.001, 0.12, 0.4);
          os.connect(g);
          g.connect(o);
        });
      } else {
        this.burst(o, t, { hp: 1200, lp: 7000, peak: 0.6, d: 0.05 });
        if (Math.random() < 0.25) {
          const os = this.osc('sine', 3200 + Math.random() * 1500, t, 0.35);
          os.frequency.exponentialRampToValueAtTime(900, t + 0.3);
          const g = this.envGain(t, 0.005, 0.07, 0.3);
          os.connect(g);
          g.connect(o);
        }
      }
    }
    glass(pos) {
      if (!this.enabled) return;
      const t = this.ctx.currentTime;
      const o = this.out(pos, 0.6);
      this.burst(o, t, { hp: 3000, lp: 12000, peak: 0.8, d: 0.08 });
      for (let i = 0; i < 6; i++) {
        const os = this.osc('sine', 3000 + Math.random() * 5000, t + i * 0.03, 0.2);
        const g = this.envGain(t + i * 0.03, 0.001, 0.08, 0.15);
        os.connect(g);
        g.connect(o);
      }
    }
    mutant(kind, pos, type) {
      if (!this.enabled) return;
      const t = this.ctx.currentTime;
      const big = kind === 'nushi' || kind === 'haha';
      const dog = kind === 'hagure';
      const o = this.out(pos, big ? 1.4 : 0.9, 8);
      const base = big ? 0.45 : dog ? 1.4 : 1;
      if (type === 'growl') {
        const s = this.osc('sawtooth', 75 * base, t, 1.0);
        const lfo = this.osc('sine', 22, t, 1.0);
        const lg = this.ctx.createGain();
        lg.gain.value = 30 * base;
        lfo.connect(lg);
        lg.connect(s.frequency);
        const f = this.filt('lowpass', 700 * base);
        const g = this.envGain(t, 0.08, 0.5, 0.8);
        s.connect(f);
        f.connect(g);
        g.connect(o);
        this.burst(o, t, { bp: 400 * base, Q: 2, lp: 1500, a: 0.1, peak: 0.3, d: 0.7 });
      } else if (type === 'screech') {
        for (let i = 0; i < 2; i++) {
          const s = this.osc('sawtooth', (dog ? 900 : 640) * base * (1 + i * 0.07), t, 0.8);
          s.frequency.linearRampToValueAtTime((dog ? 1300 : 1100) * base, t + 0.15);
          s.frequency.linearRampToValueAtTime(500 * base, t + 0.7);
          const lfo = this.osc('sine', 28 + i * 5, t, 0.8);
          const lg = this.ctx.createGain();
          lg.gain.value = 140 * base;
          lfo.connect(lg);
          lg.connect(s.frequency);
          const f = this.filt('bandpass', 1500 * base, 3);
          const g = this.envGain(t, 0.03, 0.35, 0.65);
          s.connect(f);
          f.connect(g);
          g.connect(o);
        }
      } else if (type === 'attack') {
        const s = this.osc('sawtooth', 300 * base, t, 0.35);
        s.frequency.exponentialRampToValueAtTime(120 * base, t + 0.3);
        const f = this.filt('bandpass', 900 * base, 2);
        const g = this.envGain(t, 0.01, 0.6, 0.3);
        s.connect(f);
        f.connect(g);
        g.connect(o);
        this.burst(o, t, { lp: 2500, peak: 0.5, d: 0.2 });
      } else if (type === 'hurt') {
        const s = this.osc('sawtooth', 500 * base, t, 0.3);
        s.frequency.exponentialRampToValueAtTime(250 * base, t + 0.25);
        const f = this.filt('bandpass', 1200 * base, 2);
        const g = this.envGain(t, 0.005, 0.5, 0.25);
        s.connect(f);
        f.connect(g);
        g.connect(o);
      } else if (type === 'die') {
        const s = this.osc('sawtooth', 800 * base, t, 1.1);
        s.frequency.exponentialRampToValueAtTime(110 * base, t + 1.0);
        const lfo = this.osc('sine', 14, t, 1.1);
        const lg = this.ctx.createGain();
        lg.gain.value = 60 * base;
        lfo.connect(lg);
        lg.connect(s.frequency);
        const f = this.filt('bandpass', 1000 * base, 1.5);
        const g = this.envGain(t, 0.02, 0.5, 1.0);
        s.connect(f);
        f.connect(g);
        g.connect(o);
      } else if (type === 'roar') {
        const s = this.osc('sawtooth', 60, t, 2.2);
        s.frequency.linearRampToValueAtTime(95, t + 0.6);
        s.frequency.linearRampToValueAtTime(50, t + 2.0);
        const lfo = this.osc('sine', 16, t, 2.2);
        const lg = this.ctx.createGain();
        lg.gain.value = 25;
        lfo.connect(lg);
        lg.connect(s.frequency);
        const f = this.filt('lowpass', 900);
        const g = this.envGain(t, 0.2, 1.0, 1.9);
        s.connect(f);
        f.connect(g);
        g.connect(o);
        this.burst(o, t, { bp: 300, Q: 1, lp: 1200, a: 0.3, peak: 0.8, d: 1.6 });
      }
    }
    voice(pos, type, pitch = 1) {
      // 人間のうめき声・叫び（フォルマント風）
      if (!this.enabled) return;
      const t = this.ctx.currentTime;
      const o = this.out(pos, 0.7, 6);
      const dur = type === 'die' ? 0.7 : type === 'shout' ? 0.45 : 0.22;
      const s = this.osc('sawtooth', 150 * pitch, t, dur + 0.05);
      s.frequency.linearRampToValueAtTime((type === 'shout' ? 190 : 95) * pitch, t + dur);
      const f1 = this.filt('bandpass', 700 * pitch, 4), f2 = this.filt('bandpass', 1150 * pitch, 5);
      const g = this.envGain(t, 0.02, type === 'shout' ? 0.6 : 0.45, dur);
      s.connect(f1);
      s.connect(f2);
      f1.connect(g);
      f2.connect(g);
      g.connect(o);
    }
    hurtPlayer() {
      if (!this.enabled) return;
      const t = this.ctx.currentTime;
      const o = this.out(null, 0.5);
      const s = this.osc('sawtooth', 130, t, 0.25);
      s.frequency.linearRampToValueAtTime(90, t + 0.2);
      const f = this.filt('bandpass', 650, 4);
      const g = this.envGain(t, 0.01, 0.6, 0.2);
      s.connect(f);
      f.connect(g);
      g.connect(o);
      this.burst(o, t, { lp: 400, peak: 0.8, d: 0.1 });
    }
    cough() {
      if (!this.enabled) return;
      const t = this.ctx.currentTime;
      const o = this.out(null, 0.5);
      for (let i = 0; i < 2; i++) this.burst(o, t + i * 0.22, { bp: 700, Q: 1.5, lp: 3000, a: 0.01, peak: 1, d: 0.14 });
    }
    explosion(pos) {
      if (!this.enabled) return;
      const t = this.ctx.currentTime;
      const o = this.out(pos, 1.8, 14);
      this.burst(o, t, { lp: 2400, a: 0.003, peak: 1, d: 1.6, sweepTo: 60, buf: this.brownBuf });
      this.burst(o, t, { lp: 6000, a: 0.002, peak: 0.6, d: 0.3, sweepTo: 400 });
      const s = this.osc('sine', 70, t, 1.2);
      s.frequency.exponentialRampToValueAtTime(28, t + 1.0);
      const g = this.envGain(t, 0.005, 1.5, 1.0);
      s.connect(g);
      g.connect(o);
    }
    rumble(dur = 3, vol = 1) {
      if (!this.enabled) return;
      const t = this.ctx.currentTime;
      const o = this.out(null, vol);
      const n = this.noise(t, this.brownBuf);
      const f = this.filt('lowpass', 180);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(1.2, t + dur * 0.25);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      n.connect(f);
      f.connect(g);
      g.connect(o);
      n.stop(t + dur + 0.1);
      for (let i = 0; i < 18; i++) {
        const tt = t + Math.random() * dur * 0.8;
        this.burst(o, tt, { bp: 300 + Math.random() * 1500, Q: 2, lp: 5000, peak: 0.3 + Math.random() * 0.4, d: 0.08 });
      }
    }
    drip(pos) {
      if (!this.enabled) return;
      const t = this.ctx.currentTime;
      const o = this.out(pos, 0.35, 4);
      const s = this.osc('sine', 1400 + Math.random() * 900, t, 0.12);
      s.frequency.exponentialRampToValueAtTime(500, t + 0.08);
      const g = this.envGain(t, 0.002, 0.4, 0.09);
      s.connect(g);
      g.connect(o);
    }
    clank(pos, vol = 0.6) {
      if (!this.enabled) return;
      const t = this.ctx.currentTime;
      const o = this.out(pos, vol, 8);
      [310, 787, 1243, 1789, 2410].forEach((f, i) => {
        const s = this.osc('sine', f * (0.97 + Math.random() * 0.06), t, 1.4);
        const g = this.envGain(t, 0.002, 0.25 / (i + 1), 1.2 / (1 + i * 0.4));
        s.connect(g);
        g.connect(o);
      });
      this.burst(o, t, { bp: 1500, Q: 1, lp: 6000, peak: 0.4, d: 0.05 });
    }
    whisper(dur = 4, vol = 0.5) {
      if (!this.enabled) return;
      const t = this.ctx.currentTime;
      for (let k = 0; k < 3; k++) {
        const o = this.out({ x: this.L.x + (Math.random() - 0.5) * 10, y: this.L.y, z: this.L.z + (Math.random() - 0.5) * 10 }, vol, 4);
        const n = this.noise(t + k * 0.3);
        const bank = [700 + Math.random() * 200, 1200 + Math.random() * 300, 2600 + Math.random() * 400];
        const g = this.ctx.createGain();
        g.gain.value = 0;
        bank.forEach((f) => {
          const bp = this.filt('bandpass', f, 9);
          n.connect(bp);
          bp.connect(g);
        });
        const st = t + k * 0.3;
        for (let i = 0; i < dur * 6; i++) {
          g.gain.setValueAtTime(Math.random() < 0.6 ? Math.random() * 0.9 : 0, st + i / 6);
        }
        g.gain.setValueAtTime(0, st + dur);
        g.connect(o);
        n.stop(st + dur + 0.1);
      }
    }
    ghostTrain(dur = 5) {
      if (!this.enabled) return;
      const t = this.ctx.currentTime;
      const o = this.out(null, 1.0);
      const n = this.noise(t, this.brownBuf);
      const f = this.filt('lowpass', 300);
      f.frequency.linearRampToValueAtTime(900, t + dur * 0.6);
      f.frequency.linearRampToValueAtTime(200, t + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(1.4, t + dur * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      n.connect(f);
      f.connect(g);
      g.connect(o);
      n.stop(t + dur + 0.1);
      [220, 277].forEach((fr) => {
        const s = this.osc('sawtooth', fr, t + dur * 0.35, dur * 0.6);
        s.frequency.setValueAtTime(fr, t + dur * 0.55);
        s.frequency.linearRampToValueAtTime(fr * 0.8, t + dur * 0.75);
        const lp = this.filt('lowpass', 1800);
        const gg = this.envGain(t + dur * 0.35, 0.3, 0.25, dur * 0.5, 'lin');
        s.connect(lp);
        lp.connect(gg);
        gg.connect(o);
      });
    }
    signal(dur = 5, vol = 0.6, pos) {
      // 「鳴子」の信号音
      if (!this.enabled) return;
      const t = this.ctx.currentTime;
      const o = this.out(pos || null, vol, 10);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.8, t + 0.8);
      g.gain.setValueAtTime(0.8, t + dur - 0.8);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      g.connect(o);
      [[55, 'sine', 0.5], [55.7, 'sine', 0.5], [110.3, 'triangle', 0.25], [331, 'sine', 0.07]].forEach(([f, ty, a]) => {
        const s = this.osc(ty, f, t, dur);
        const gg = this.ctx.createGain();
        gg.gain.value = a;
        s.connect(gg);
        gg.connect(g);
      });
      const lfo = this.osc('sine', 2.3, t, dur);
      const lg = this.ctx.createGain();
      lg.gain.value = 0.3;
      lfo.connect(lg);
      lg.connect(g.gain);
    }
    radio(dur = 2, vol = 0.35) {
      if (!this.enabled) return;
      const t = this.ctx.currentTime;
      const o = this.out(null, vol);
      this.burst(o, t, { bp: 1800, Q: 0.7, lp: 6000, a: 0.02, peak: 0.6, d: dur });
      for (let i = 0; i < dur * 8; i++) this.burst(o, t + Math.random() * dur, { hp: 2000, lp: 9000, peak: 0.5, d: 0.02 });
    }
    alarm(dur = 6) {
      if (!this.enabled) return;
      const t = this.ctx.currentTime;
      const o = this.out(null, 0.35);
      const s = this.osc('sawtooth', 600, t, dur);
      for (let i = 0; i < dur / 1.2; i++) {
        s.frequency.setValueAtTime(560, t + i * 1.2);
        s.frequency.linearRampToValueAtTime(880, t + i * 1.2 + 0.6);
        s.frequency.linearRampToValueAtTime(560, t + i * 1.2 + 1.2);
      }
      const f = this.filt('lowpass', 2000);
      const g = this.envGain(t, 0.05, 0.5, dur, 'lin');
      s.connect(f);
      f.connect(g);
      g.connect(o);
      g.connect(this.reverb);
    }
    pickup() {
      if (!this.enabled) return;
      const t = this.ctx.currentTime;
      const o = this.out(null, 0.35);
      [1200, 1800].forEach((f, i) => {
        const s = this.osc('triangle', f, t + i * 0.06, 0.12);
        const g = this.envGain(t + i * 0.06, 0.003, 0.4, 0.1);
        s.connect(g);
        g.connect(o);
      });
      this.burst(o, t, { bp: 3000, Q: 2, lp: 8000, peak: 0.3, d: 0.05 });
    }
    ui(f = 740) {
      if (!this.enabled) return;
      const t = this.ctx.currentTime;
      const s = this.osc('triangle', f, t, 0.08);
      const g = this.envGain(t, 0.002, 0.15, 0.07);
      s.connect(g);
      g.connect(this.master);
    }
    crank() {
      if (!this.enabled) return;
      const t = this.ctx.currentTime;
      const o = this.out(null, 0.4);
      for (let i = 0; i < 4; i++) this.burst(o, t + i * 0.05, { bp: 2600, Q: 6, lp: 9000, peak: 0.5, d: 0.02 });
      const s = this.osc('sawtooth', 180 + Math.random() * 30, t, 0.22);
      const f = this.filt('bandpass', 600, 4);
      const g = this.envGain(t, 0.01, 0.12, 0.2);
      s.connect(f);
      f.connect(g);
      g.connect(o);
    }
    knife(hit) {
      if (!this.enabled) return;
      const t = this.ctx.currentTime;
      const o = this.out(null, 0.5);
      const g = this.burst(o, t, { bp: 1800, Q: 1.5, lp: 7000, a: 0.03, peak: 0.6, d: 0.12 });
      void g;
      if (hit) this.burst(o, t + 0.08, { lp: 600, peak: 1, d: 0.12 });
    }
    breath(inhale, intensity) {
      if (!this.enabled) return;
      const t = this.ctx.currentTime;
      const o = this.out(null, 0.32 * intensity);
      const dur = inhale ? 0.7 : 0.8;
      const n = this.noise(t);
      const f = this.filt('bandpass', inhale ? 950 : 620, 0.9);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(inhale ? 0.7 : 0.9, t + dur * 0.4);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      n.connect(f);
      f.connect(g);
      g.connect(o);
      n.stop(t + dur + 0.05);
      if (!inhale) this.burst(o, t + 0.02, { bp: 2200, Q: 5, lp: 7000, peak: 0.25, d: 0.03 });
    }
    geiger() {
      if (!this.enabled) return;
      const t = this.ctx.currentTime;
      this.burst(this.out(null, 0.25), t, { hp: 2500, lp: 10000, a: 0.0005, peak: 1, d: 0.004 });
    }
    heartbeat(vol) {
      if (!this.enabled) return;
      const t = this.ctx.currentTime;
      const o = this.out(null, vol);
      [0, 0.18].forEach((dt, i) => {
        const s = this.osc('sine', 58, t + dt, 0.15);
        s.frequency.exponentialRampToValueAtTime(40, t + dt + 0.12);
        const g = this.envGain(t + dt, 0.005, i ? 0.6 : 0.9, 0.12);
        s.connect(g);
        g.connect(o);
      });
    }
    engine(pos) {
      // 発電機のループ。戻り値で停止
      if (!this.enabled) return { stop() {} };
      const ctx = this.ctx, t = ctx.currentTime;
      const o = this.out(pos, 0.7, 8);
      const s = this.osc('sawtooth', 42, t, 9999);
      const f = this.filt('lowpass', 300);
      const g = ctx.createGain();
      g.gain.value = 0.0001;
      g.gain.exponentialRampToValueAtTime(0.5, t + 1.5);
      const lfo = this.osc('square', 11, t, 9999);
      const lg = ctx.createGain();
      lg.gain.value = 0.2;
      lfo.connect(lg);
      lg.connect(g.gain);
      s.connect(f);
      f.connect(g);
      g.connect(o);
      const h = {
        stop: () => {
          const tt = ctx.currentTime;
          g.gain.cancelScheduledValues(tt);
          g.gain.setValueAtTime(g.gain.value, tt);
          g.gain.linearRampToValueAtTime(0, tt + 0.5);
          s.stop(tt + 0.6);
          lfo.stop(tt + 0.6);
          this.loops.delete(h);
        },
      };
      this.loops.add(h);
      return h;
    }
    machine(pos) {
      // 鳴子装置の唸り（ループ）
      if (!this.enabled) return { stop() {}, wind() {} };
      const ctx = this.ctx, t = ctx.currentTime;
      const o = this.out(pos, 0.8, 10);
      const g = ctx.createGain();
      g.gain.value = 0.6;
      g.connect(o);
      const oscs = [[55, 'sine', 0.5], [55.7, 'sine', 0.5], [110.3, 'triangle', 0.2], [220.6, 'sine', 0.06]].map(([f, ty, a]) => {
        const s = this.osc(ty, f, t, 9999);
        const gg = ctx.createGain();
        gg.gain.value = a;
        s.connect(gg);
        gg.connect(g);
        return s;
      });
      const h = {
        stop: () => {
          oscs.forEach((s) => s.stop());
          this.loops.delete(h);
        },
        wind: (dur = 4) => {
          const tt = ctx.currentTime;
          oscs.forEach((s) => s.frequency.exponentialRampToValueAtTime(s.frequency.value * 0.25, tt + dur));
          g.gain.setValueAtTime(g.gain.value, tt);
          g.gain.linearRampToValueAtTime(0, tt + dur);
          setTimeout(() => h.stop(), dur * 1000 + 200);
        },
      };
      this.loops.add(h);
      return h;
    }
    stopLoops() {
      for (const h of Array.from(this.loops)) h.stop();
    }

    // ---------- ギター（カープラス・ストロング） ----------
    ks(midi) {
      if (this.ksCache[midi]) return this.ksCache[midi];
      const ctx = this.ctx, sr = ctx.sampleRate;
      const freq = 440 * Math.pow(2, (midi - 69) / 12);
      const N = Math.max(2, Math.round(sr / freq));
      const len = Math.floor(sr * 2.4);
      const buf = ctx.createBuffer(1, len, sr);
      const d = buf.getChannelData(0);
      const ring = new Float32Array(N);
      for (let i = 0; i < N; i++) ring[i] = Math.random() * 2 - 1;
      for (let i = 1; i < N; i++) ring[i] = (ring[i] + ring[i - 1]) * 0.5;
      let idx = 0;
      const decay = 0.9965 - Math.max(0, (midi - 55) * 0.00012);
      for (let i = 0; i < len; i++) {
        const a = ring[idx], b = ring[(idx + 1) % N];
        ring[idx] = (a + b) * 0.5 * decay;
        d[i] = a * 0.6 * (i > len - 2000 ? (len - i) / 2000 : 1);
        idx = (idx + 1) % N;
      }
      this.ksCache[midi] = buf;
      return buf;
    }
    startGuitar(pos, vol = 0.7) {
      if (!this.enabled) return;
      if (!this.gBus) {
        this.gBus = this.ctx.createGain();
        const lp = this.filt('lowpass', 3200);
        const pk = this.ctx.createBiquadFilter();
        pk.type = 'peaking';
        pk.frequency.value = 220;
        pk.gain.value = 4;
        this.gBus.connect(pk);
        pk.connect(lp);
        lp.connect(this.musicBus);
      }
      const prog = [
        [45, 52, 57, 60, 64], [41, 48, 53, 57, 60], [48, 52, 55, 60, 64], [40, 47, 52, 56, 59],
        [45, 52, 57, 60, 64], [50, 57, 62, 65, 69], [40, 47, 52, 56, 59], [45, 52, 57, 60, 64],
      ];
      this.guitar = { pos, vol, prog, step: 0, next: this.ctx.currentTime + 0.3 };
    }
    stopGuitar() {
      this.guitar = null;
    }
    tickGuitar() {
      const G = this.guitar;
      if (!G) return;
      const ctx = this.ctx;
      const pattern = [0, 2, 3, 4, 3, 2];
      while (G.next < ctx.currentTime + 0.25) {
        const bar = Math.floor(G.step / 6) % G.prog.length;
        const k = G.step % 6;
        const chord = G.prog[bar];
        const notes = k === 0 ? [chord[0], chord[4]] : [chord[pattern[k]]];
        const sp = this.spatial(G.pos, 5);
        if (sp.g > 0.01) {
          for (const m of notes) {
            const src = ctx.createBufferSource();
            src.buffer = this.ks(m);
            const g = ctx.createGain();
            g.gain.value = G.vol * sp.g * (k === 0 ? 0.9 : 0.6) * (0.85 + Math.random() * 0.3);
            let node = g;
            if (ctx.createStereoPanner && G.pos) {
              const p = ctx.createStereoPanner();
              p.pan.value = sp.pan;
              g.connect(p);
              node = p;
            }
            src.connect(g);
            node.connect(this.gBus);
            if (G.pos) {
              const w = ctx.createGain();
              w.gain.value = 0.25;
              g.connect(w);
              w.connect(this.reverb);
            }
            src.start(G.next + (k === 0 && m !== notes[0] ? 0.03 : 0));
          }
        }
        G.step++;
        G.next += 0.32 + (k === 5 ? 0.06 : 0);
      }
    }

    // ---------- 環境音 ----------
    setAmbience(kind) {
      if (!this.enabled) return;
      if (this.ambKind === kind) return;
      this.ambKind = kind;
      const ctx = this.ctx, t = ctx.currentTime;
      if (this.amb) {
        const old = this.amb;
        old.g.gain.cancelScheduledValues(t);
        old.g.gain.setValueAtTime(old.g.gain.value, t);
        old.g.gain.linearRampToValueAtTime(0, t + 1.5);
        setTimeout(() => old.nodes.forEach((n) => { try { n.stop(); } catch (e) { /* 停止済み */ } }), 1700);
        this.amb = null;
      }
      if (!kind) return;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + 2);
      g.connect(this.ambBus);
      const nodes = [];
      const layer = (buf, type, f, Q, gain, lfoRate, lfoDepth) => {
        const n = this.noise(t, buf);
        const fl = this.filt(type, f, Q);
        const gg = ctx.createGain();
        gg.gain.value = gain;
        n.connect(fl);
        fl.connect(gg);
        gg.connect(g);
        nodes.push(n);
        if (lfoRate) {
          const l = this.osc('sine', lfoRate, t, 99999);
          const lg = ctx.createGain();
          lg.gain.value = lfoDepth;
          l.connect(lg);
          lg.connect(gg.gain);
          nodes.push(l);
        }
      };
      if (kind === 'tunnel') {
        layer(this.brownBuf, 'lowpass', 160, 0.7, 0.55, 0.06, 0.25);
        layer(this.noiseBuf, 'bandpass', 420, 12, 0.05, 0.11, 0.04);
      } else if (kind === 'station') {
        layer(this.brownBuf, 'lowpass', 220, 0.7, 0.35, 0.05, 0.1);
        const h = this.osc('sine', 50, t, 99999);
        const hg = ctx.createGain();
        hg.gain.value = 0.03;
        h.connect(hg);
        hg.connect(g);
        nodes.push(h);
        layer(this.noiseBuf, 'bandpass', 500, 1.5, 0.04, 0.3, 0.03);
      } else if (kind === 'surface') {
        layer(this.noiseBuf, 'bandpass', 520, 0.6, 0.18, 0.09, 0.14);
        layer(this.brownBuf, 'lowpass', 120, 0.7, 0.4, 0.04, 0.15);
        layer(this.noiseBuf, 'bandpass', 1600, 8, 0.02, 0.17, 0.02);
      } else if (kind === 'hall') {
        layer(this.brownBuf, 'lowpass', 260, 0.7, 0.3, 0.05, 0.08);
        const h = this.osc('sine', 60, t, 99999);
        const hg = ctx.createGain();
        hg.gain.value = 0.02;
        h.connect(hg);
        hg.connect(g);
        nodes.push(h);
      }
      this.amb = { g, nodes };
    }
    update(dt, st) {
      if (!this.enabled) return;
      this.tickGuitar();
      if (!st) return;
      // ランダムな環境イベント
      const e = this.evt;
      if (st.ambient === 'tunnel' || st.ambient === 'station') {
        e.drip -= dt;
        if (e.drip <= 0) {
          e.drip = 1.5 + Math.random() * 5;
          this.drip({ x: this.L.x + (Math.random() - 0.5) * 14, y: this.L.y + 2, z: this.L.z + (Math.random() - 0.5) * 14 });
        }
        e.clank -= dt;
        if (e.clank <= 0) {
          e.clank = 10 + Math.random() * 20;
          const a = Math.random() * 6.28;
          this.clank({ x: this.L.x + Math.cos(a) * 30, y: this.L.y, z: this.L.z + Math.sin(a) * 30 }, 0.5);
        }
      }
      if (st.ambient === 'tunnel' || st.ambient === 'surface') {
        e.howl -= dt;
        if (e.howl <= 0) {
          e.howl = 25 + Math.random() * 40;
          const a = Math.random() * 6.28;
          this.mutant(st.ambient === 'surface' ? 'hagure' : 'mukuro', { x: this.L.x + Math.cos(a) * 60, y: this.L.y, z: this.L.z + Math.sin(a) * 60 }, 'screech');
        }
      }
      // ガイガーカウンター
      if (st.rad > 0) {
        this.geigerAcc += dt * st.rad * 22 * (0.5 + Math.random());
        while (this.geigerAcc > 1) {
          this.geigerAcc -= 1;
          this.geiger();
        }
      }
      // ガスマスクの呼吸
      if (st.mask) {
        this.breathT -= dt;
        if (this.breathT <= 0) {
          const rate = st.breathRate || 1;
          this.breath(this.breathIn, st.filterLow ? 1.3 : 1);
          this.breathT = (this.breathIn ? 1.0 : 1.5) / rate;
          this.breathIn = !this.breathIn;
        }
      }
      // 心音
      if (st.hp < 35) {
        this.heartT -= dt;
        if (this.heartT <= 0) {
          this.heartT = 0.55 + st.hp / 60;
          this.heartbeat(0.6 * (1 - st.hp / 35) + 0.25);
        }
      }
    }
  }
  DL.AudioEngine = AudioEngine;
})();
