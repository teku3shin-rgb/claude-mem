'use strict';
// HUD・字幕・モーダル（選択肢・メモ・商店・手帳）・章カード
(function () {
  const DL = window.DL;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  class UI {
    constructor(G) {
      this.G = G;
      this.el = {
        hud: $('hud'), prompt: $('prompt'), promptText: document.querySelector('#prompt span'),
        subs: $('subs'), who: document.querySelector('#subs .who'), line: document.querySelector('#subs .line'),
        bark: $('bark'), obj: $('objective'), objText: document.querySelector('#objective p'), toasts: $('toasts'),
        hit: $('hit'), dmg: $('fx-dmg'), gas: $('fx-gas'), flash: $('fx-flash'), mask: $('mask'), maskFog: document.querySelector('#mask .fog'),
        cracks: [document.querySelector('#mask .c1'), document.querySelector('#mask .c2'), document.querySelector('#mask .c3')],
        led: document.querySelector('#watch .led'), time: document.querySelector('#watch .time'), spare: document.querySelector('#watch .spare'),
        batt: document.querySelector('#watch .batt'), battCells: Array.from(document.querySelectorAll('#watch .batt i')),
        wname: document.querySelector('#ammo .wname'), mag: document.querySelector('#ammo .mag'), res: document.querySelector('#ammo .res'), milb: document.querySelector('#ammo .milb'),
        iMed: document.querySelector('.i-med'), iFil: document.querySelector('.i-fil'), iBomb: document.querySelector('.i-bomb'), iMil: document.querySelector('.i-mil'),
        choice: $('choice'), note: $('notecard'), shop: $('shop'), journal: $('journal'), fade: $('fade'), card: $('card'), gl: $('gl'),
      };
      this.modal = null;
      this.subToken = 0;
      this.barkT = 0;
      this.dmgA = 0;
      this.hitT = 0;
      this.objT = 0;
      this.maskV = 0;
      this.maskTarget = 0;
      this.flashA = 0;
      this.objectiveText = '';
      this.lastHud = {};
      this.choiceRes = null;
      this.initGrain();
    }
    showHUD(on) {
      this.el.hud.hidden = !on;
    }
    // ---------- 字幕 ----------
    sub(name, text) {
      const t = ++this.subToken;
      this.el.who.textContent = name ? name : '';
      this.el.line.textContent = text;
      this.el.subs.style.opacity = 1;
      return t;
    }
    clearSub(t) {
      if (t !== undefined && t !== this.subToken) return;
      this.el.subs.style.opacity = 0;
    }
    bark(name, text) {
      this.el.bark.innerHTML = `<span class="who">${esc(name)}</span>${esc(text)}`;
      this.el.bark.style.opacity = 1;
      this.barkT = 2.6;
    }
    objective(text) {
      this.objectiveText = text;
      this.el.objText.textContent = text;
      this.el.obj.classList.add('show');
      this.objT = 7;
      this.G.audio.ui(520);
    }
    toast(text) {
      const d = document.createElement('div');
      d.className = 'toast';
      d.textContent = text;
      this.el.toasts.appendChild(d);
      while (this.el.toasts.children.length > 5) this.el.toasts.firstChild.remove();
      setTimeout(() => d.remove(), 3500);
    }
    prompt(text) {
      if (this.lastPrompt === text) return;
      this.lastPrompt = text;
      if (text) {
        this.el.promptText.textContent = text;
        this.el.prompt.style.opacity = 1;
      } else this.el.prompt.style.opacity = 0;
    }
    hitmarker(head) {
      this.el.hit.classList.toggle('head', !!head);
      this.hitT = 0.12;
    }
    damage(amount) {
      this.dmgA = Math.min(1, this.dmgA + amount / 35);
    }
    whiteFlash(a) {
      this.flashA = Math.max(this.flashA, a);
    }
    maskAnim(on) {
      this.maskTarget = on ? 1 : 0;
    }
    // ---------- 毎フレーム ----------
    update(dt) {
      const G = this.G, P = G.player, E = this.el;
      if (this.barkT > 0) {
        this.barkT -= dt;
        if (this.barkT <= 0) E.bark.style.opacity = 0;
      }
      if (this.objT > 0) {
        this.objT -= dt;
        if (this.objT <= 0) E.obj.classList.remove('show');
      }
      if (this.hitT > 0) {
        this.hitT -= dt;
        E.hit.style.opacity = this.hitT > 0 ? 1 : 0;
      }
      this.dmgA = Math.max(0, this.dmgA - dt * 0.9);
      const lowHp = P.alive ? DL.clamp((45 - P.hp) / 45, 0, 1) : 1;
      E.dmg.style.opacity = Math.min(1, this.dmgA + lowHp * 0.45 * (0.8 + Math.sin(G.time * 5) * 0.2)).toFixed(3);
      E.gas.style.opacity = (P.gasExposure * 0.9).toFixed(3);
      this.flashA = Math.max(0, this.flashA - dt * 1.5);
      E.flash.style.opacity = this.flashA.toFixed(3);
      const sat = 1 - lowHp * 0.7;
      const blur = P.gasExposure > 0.3 ? ((P.gasExposure - 0.3) * 2.2).toFixed(2) : 0;
      const f = `saturate(${sat.toFixed(2)})${blur ? ` blur(${blur}px)` : ''}`;
      if (f !== this.lastFilter) {
        E.gl.style.filter = f;
        this.lastFilter = f;
      }
      // ガスマスク
      this.maskTarget = P.mask.on ? 1 : 0;
      this.maskV = DL.damp(this.maskV, this.maskTarget, 10, dt);
      E.mask.style.opacity = this.maskV.toFixed(3);
      E.mask.style.transform = `translateY(${((1 - this.maskV) * 18).toFixed(1)}%)`;
      if (P.mask.on) {
        const ig = P.mask.integ;
        E.cracks[0].style.opacity = ig < 75 ? 1 : 0;
        E.cracks[1].style.opacity = ig < 50 ? 1 : 0;
        E.cracks[2].style.opacity = ig < 25 ? 1 : 0;
        const low = P.filterTime < 20 ? 1 - P.filterTime / 20 : 0;
        const breath = 0.5 + Math.sin(G.time * 2.2) * 0.5;
        E.maskFog.style.opacity = (0.08 + low * 0.6 * breath + (P.sprinting ? 0.1 : 0)).toFixed(3);
      }
      // 腕時計
      const ft = Math.max(0, P.filterTime);
      const mm = Math.floor(ft / 60), ss = Math.floor(ft % 60);
      const timeTxt = `${mm}:${String(ss).padStart(2, '0')}`;
      this.set('time', timeTxt, () => (E.time.textContent = timeTxt));
      const lowF = P.mask.on && ft < 20;
      this.set('timeLow', lowF, () => E.time.classList.toggle('low', lowF));
      this.set('timeDim', P.mask.on, () => (E.time.style.opacity = P.mask.on ? 1 : 0.45));
      this.set('spare', P.inv.filter, () => (E.spare.textContent = `×${P.inv.filter}`));
      const lit = P.lit > 0.33;
      this.set('led', lit, () => E.led.classList.toggle('on', lit));
      const cells = Math.ceil(P.flash.battery / 10);
      this.set('batt', cells, () => {
        E.battCells.forEach((c, i) => c.classList.toggle('on', i < cells));
        E.batt.classList.toggle('low', cells <= 2);
      });
      // 弾薬
      const W = DL.WEAP[P.cur];
      this.set('wname', W.short, () => (E.wname.textContent = W.short));
      this.set('mag', P.mag[P.cur], () => (E.mag.textContent = P.mag[P.cur]));
      const useMil = P.milMode && W.mil;
      const res = useMil ? P.inv.mil : P.inv.ammo[W.ammo];
      this.set('res', res, () => (E.res.textContent = res));
      const milTxt = P.magMil[P.cur] ? '軍用' : useMil ? '次:軍用' : '';
      this.set('milb', milTxt, () => {
        E.milb.innerHTML = milTxt ? `<span class="mil">${milTxt}</span>` : '';
      });
      this.set('med', P.inv.medkit, () => (E.iMed.textContent = P.inv.medkit));
      this.set('fil', P.inv.filter, () => (E.iFil.textContent = P.inv.filter));
      this.set('bomb', P.inv.bomb, () => (E.iBomb.textContent = P.inv.bomb));
      this.set('mil', P.inv.mil, () => (E.iMil.textContent = P.inv.mil));
      this.drawGrain();
    }
    set(k, v, fn) {
      if (this.lastHud[k] === v) return;
      this.lastHud[k] = v;
      fn();
    }
    resetHudCache() {
      this.lastHud = {};
      this.lastPrompt = undefined;
    }
    // ---------- フィルムグレイン ----------
    initGrain() {
      const c = $('grain');
      c.width = 480;
      c.height = 270;
      this.grainCtx = c.getContext('2d');
      this.grainImg = this.grainCtx.createImageData(480, 270);
      this.grainT = 0;
    }
    drawGrain() {
      this.grainT++;
      if (this.grainT % 2) return;
      const d = this.grainImg.data;
      if (!this.grainBuf) {
        // 乱数を毎回生成せず、事前に作ったノイズをずらして使う
        this.grainBuf = new Uint8Array(d.length / 4 + 4096);
        for (let i = 0; i < this.grainBuf.length; i++) this.grainBuf[i] = (Math.random() * 255) | 0;
      }
      const off = (Math.random() * 4096) | 0, gb = this.grainBuf;
      for (let i = 0, j = off; i < d.length; i += 4, j++) {
        const v = gb[j];
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = 255;
      }
      this.grainCtx.putImageData(this.grainImg, 0, 0);
    }
    // ---------- モーダル ----------
    openChoice(q, opts) {
      this.modal = 'choice';
      this.choiceRes = null;
      this.choiceN = opts.length;
      const E = this.el.choice;
      E.innerHTML = `<div class="q">${esc(q)}</div>` + opts.map((o, i) => `<div class="opt" data-i="${i}"><kbd>${i + 1}</kbd><span>${esc(o)}</span></div>`).join('');
      E.querySelectorAll('.opt').forEach((d) => d.addEventListener('click', () => this.pickChoice(+d.dataset.i)));
      E.hidden = false;
      this.G.audio.ui(660);
    }
    pickChoice(i) {
      if (this.modal !== 'choice') return;
      this.choiceRes = i;
      this.el.choice.hidden = true;
      this.modal = null;
      this.G.audio.ui(880);
    }
    openNote(title, body) {
      this.modal = 'note';
      const E = this.el.note;
      E.innerHTML = `<h2>${esc(title)}</h2><div class="body">${esc(body)}</div><div class="hint"><kbd>E</kbd> 閉じる</div>`;
      E.hidden = false;
      this.G.audio.ui(400);
    }
    openShop(title, items) {
      this.modal = 'shop';
      this.shopItems = items;
      this.shopTitle = title;
      this.renderShop();
      this.el.shop.hidden = false;
    }
    renderShop() {
      const P = this.G.player, E = this.el.shop;
      E.innerHTML = `<h2>${esc(this.shopTitle)}</h2><div class="sub">TRADE · 軍用弾で支払う</div><div class="rows">` +
        this.shopItems.map((it, i) => `<div class="row ${P.inv.mil < it.price ? 'no' : ''}" data-i="${i}"><kbd>${i + 1}</kbd><span>${esc(it.name)}<br><small style="color:var(--ash)">${esc(it.desc)}</small></span><span class="price">${it.price} 発</span></div>`).join('') +
        `</div><div class="meta"><span>所持している軍用弾: <b style="color:#d8b050">${P.inv.mil}</b> 発</span><span><kbd>E</kbd> 店を出る</span></div>`;
      E.querySelectorAll('.row').forEach((d) => d.addEventListener('click', () => this.buy(+d.dataset.i)));
    }
    buy(i) {
      const it = this.shopItems[i];
      const G = this.G, P = G.player;
      if (!it) return;
      if (P.inv.mil < it.price) {
        G.ui.toast('軍用弾が足りない');
        G.audio.ui(200);
        return;
      }
      if (!it.give()) {
        G.ui.toast('これ以上は持てない');
        G.audio.ui(200);
        return;
      }
      P.inv.mil -= it.price;
      G.audio.pickup();
      this.renderShop();
    }
    openJournal() {
      const G = this.G;
      this.modal = 'journal';
      const notes = G.notes.length ? G.notes.map((n) => `<div>${esc(n.title)}</div>`).join('') : '<div style="color:var(--ash)">まだ何も拾っていない。</div>';
      const L = G.level;
      this.el.journal.innerHTML = `<h2>手帳</h2><div class="sub">${esc(L ? L.num + '　' + L.title : '')}</div>` +
        `<h3>目標</h3><div class="obj">${esc(this.objectiveText || '―')}</div>` +
        `<h3>拾ったメモ</h3><div class="notes">${notes}</div>` +
        `<div class="meta"><span>体力 ${Math.ceil(G.player.hp)} / 100　ガスマスク耐久 ${Math.ceil(G.player.mask.integ)}%</span><span><kbd>Tab</kbd> 閉じる</span></div>`;
      this.el.journal.hidden = false;
      G.audio.ui(400);
    }
    closeModal() {
      if (!this.modal) return;
      if (this.modal === 'choice') return; // 選択肢は必ず選ぶ
      this.el[this.modal === 'note' ? 'note' : this.modal].hidden = true;
      this.modal = null;
      this.G.audio.ui(500);
    }
    forceCloseAll() {
      this.el.note.hidden = this.el.shop.hidden = this.el.journal.hidden = true;
      if (this.modal !== 'choice') this.modal = null;
    }
    onKey(code) {
      if (!this.modal) return false;
      if (this.modal === 'choice') {
        const n = parseInt(code.replace('Digit', '').replace('Numpad', ''), 10);
        if (n >= 1 && n <= this.choiceN) this.pickChoice(n - 1);
        return true;
      }
      if (this.modal === 'shop') {
        const n = parseInt(code.replace('Digit', '').replace('Numpad', ''), 10);
        if (n >= 1 && n <= this.shopItems.length) this.buy(n - 1);
        else if (code === 'KeyE' || code === 'Tab') this.closeModal();
        return true;
      }
      if (this.modal === 'note' && (code === 'KeyE' || code === 'Space' || code === 'Enter')) {
        this.closeModal();
        return true;
      }
      if (this.modal === 'journal' && (code === 'Tab' || code === 'KeyE')) {
        this.closeModal();
        return true;
      }
      return true;
    }
    // ---------- 画面遷移 ----------
    fadeTo(a, ms = 600) {
      const f = this.el.fade;
      f.style.transition = `opacity ${ms}ms`;
      f.style.opacity = a;
      return new Promise((r) => setTimeout(r, ms));
    }
    card(o) {
      // o: { num, title, lines, list, buttons }
      const E = this.el.card;
      E.innerHTML = `<div class="num">${esc(o.num || '')}</div><h1>${esc(o.title)}</h1><div class="story">${(o.lines || []).map((l) => `<p>${esc(l)}</p>`).join('')}${o.list ? `<ul>${o.list.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}</div>` +
        (o.buttons ? `<div class="btns">${o.buttons.map((b, i) => `<button class="btn box" type="button" data-b="${i}">${esc(b)}</button>`).join('')}</div>` : '') +
        `<div class="go">${o.buttons ? '' : '<kbd>Space</kbd> クリックで続ける'}</div>`;
      E.hidden = false;
      const ps = Array.from(E.querySelectorAll('.story p'));
      let i = 0;
      let done = false;
      return new Promise((resolve) => {
        const reveal = () => {
          if (i < ps.length) {
            ps[i++].classList.add('on');
            this.cardTimer = setTimeout(reveal, 1700);
          } else {
            done = true;
            E.querySelector('.go').classList.add('on');
          }
        };
        this.cardTimer = setTimeout(reveal, 500);
        const finish = (val) => {
          clearTimeout(this.cardTimer);
          window.removeEventListener('keydown', onKey, true);
          E.removeEventListener('click', onClick);
          resolve(val);
        };
        const advance = () => {
          if (!done) {
            clearTimeout(this.cardTimer);
            ps.forEach((p) => p.classList.add('on'));
            done = true;
            E.querySelector('.go').classList.add('on');
            return;
          }
          if (!o.buttons) finish(0);
        };
        const onKey = (e) => {
          if (e.code === 'Space' || e.code === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            advance();
          }
        };
        const onClick = (e) => {
          const b = e.target.closest('[data-b]');
          if (b) {
            finish(+b.dataset.b);
            return;
          }
          advance();
        };
        window.addEventListener('keydown', onKey, true);
        E.addEventListener('click', onClick);
      });
    }
    hideCard() {
      this.el.card.hidden = true;
    }
  }
  DL.UI = UI;
})();
