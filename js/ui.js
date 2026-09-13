/**
 * ui.js — every DOM surface: loading, menu, HUD, overlay panels, modals,
 * dialogue, the emote wheel and photo-mode chrome.
 *
 * The UI never touches the 3D scene. It reads the save state and calls back
 * into `game` for anything that changes the world.
 */

import {
  LOCATIONS, COLLECTIBLES, QUESTS, ACHIEVEMENTS, CUSTOMIZE, SHOP,
  TIPS, CONTROLS, DRINKS, EMOTES, QUALITY_PRESETS, xpBounds,
} from './config.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class UI {
  constructor(game) {
    this.game = game;
    this.el = {
      loading: $('loading-screen'), loadBar: $('loading-bar'), loadTip: $('loading-tip'), loadStatus: $('loading-status'),
      menu: $('main-menu'), hud: $('hud'), fade: $('fade'), fps: $('fps'),
      hearts: $('stat-hearts'), coins: $('stat-coins'), level: $('stat-level'), xp: $('stat-xp'),
      clock: $('stat-clock'), weather: $('stat-weather'),
      qt: $('quest-tracker'), qtTitle: $('qt-title'), qtDesc: $('qt-desc'), qtProg: $('qt-prog'),
      prompt: $('interact-prompt'), promptLabel: $('interact-label'),
      toasts: $('toast-stack'), banner: $('discovery-banner'), bannerTitle: $('db-title'), bannerSub: $('db-sub'),
      overlay: $('overlay'), ovBody: $('ov-body'), ovTabs: $('ov-tabs'),
      voiceStrip: $('voice-strip'), voiceHeard: $('voice-heard'), voiceReply: $('voice-reply'),
      modal: $('modal'), modalCard: $('modal-card'),
      dialogue: $('dialogue'), dlgName: $('dlg-name'), dlgText: $('dlg-text'), dlgChoices: $('dlg-choices'),
      touch: $('touch-controls'), photo: $('photo-ui'), wheel: $('emote-wheel'),
      minimap: $('minimap'), tutorial: $('tutorial-card'), tutorialList: $('tutorial-list'),
      speedo: $('speedo'), spKmh: $('sp-kmh'), spFill: $('sp-fill'), spName: $('sp-name'),
      tbtnExit: $('tbtn-exitcar'),
      continueBtn: $('btn-continue'), profileLine: $('menu-profile-line'),
    };
    this.overlayTab = 'map';
    this.overlayOpen = false;
    this.modalOpen = false;
    this.wheelOpen = false;
    this._tipTimer = null;
    this._fishingRaf = null;
    this._bind();
  }

  /* ------------------------------------------------------------- bind */

  _bind() {
    const g = this.game;
    this.el.menu.querySelectorAll('[data-menu]').forEach(btn => {
      btn.addEventListener('click', () => {
        const a = btn.dataset.menu;
        g.audio?.ui('click');
        if (a === 'play') g.startGame(false);
        else if (a === 'continue') g.startGame(true);
        else if (a === 'credits') this.showCredits();
        else g.startGame(true, a);
      });
    });

    this.el.ovTabs.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => { this.game.audio?.ui('click'); this.openOverlay(b.dataset.tab); });
    });
    $('ov-close').addEventListener('click', () => this.closeOverlay());
    $('ov-resume').addEventListener('click', () => this.closeOverlay());
    $('ov-save').addEventListener('click', () => this.game.saveGame(true));
    $('ov-mainmenu').addEventListener('click', () => this.game.toMainMenu());

    $('pm-shot').addEventListener('click', () => this.game.takePhoto());
    $('pm-exit').addEventListener('click', () => this.game.togglePhotoMode(false));

    this.el.modal.addEventListener('click', (e) => {
      if (e.target === this.el.modal && this._modalDismissable) this.closeModal();
    });
    this.el.wheel.addEventListener('click', (e) => {
      if (e.target === this.el.wheel) this.toggleEmoteWheel(false);
    });
  }

  /* ---------------------------------------------------------- loading */

  showLoading() {
    this.el.loading.classList.remove('hidden');
    this.setLoading(0, 'Loading world...');
    let i = Math.floor(Math.random() * TIPS.length);
    this.el.loadTip.textContent = TIPS[i];
    clearInterval(this._tipTimer);
    this._tipTimer = setInterval(() => {
      i = (i + 1) % TIPS.length;
      this.el.loadTip.style.opacity = '0';
      setTimeout(() => {
        this.el.loadTip.textContent = TIPS[i];
        this.el.loadTip.style.opacity = '1';
      }, 260);
    }, 3400);
  }

  setLoading(t, label) {
    this.el.loadBar.style.width = Math.round(t * 100) + '%';
    if (label) this.el.loadStatus.textContent = label;
  }

  hideLoading() {
    clearInterval(this._tipTimer);
    this.el.loading.classList.add('hidden');
  }

  /* ------------------------------------------------------------- menu */

  showMenu(hasSave) {
    this.el.menu.classList.remove('hidden');
    this.el.hud.classList.add('hidden');
    this.el.continueBtn.disabled = !hasSave;
    const s = this.game.save.state;
    this.el.profileLine.textContent = hasSave
      ? `Level ${s.level} · ${s.discovered.length}/${LOCATIONS.length} places found`
      : '';
  }

  hideMenu() { this.el.menu.classList.add('hidden'); }

  showHUD(touch) {
    this.el.hud.classList.remove('hidden');
    this.el.touch.classList.toggle('hidden', !touch);
    if (!touch) this.el.tutorial.classList.remove('hidden');
  }

  hideHUD() {
    this.el.hud.classList.add('hidden');
    this.el.touch.classList.add('hidden');
  }

  setTutorial(list) {
    this.el.tutorialList.innerHTML = list.map(([k, v]) => `<li><b>${esc(k)}</b><span>${esc(v)}</span></li>`).join('');
  }

  hideTutorial() { this.el.tutorial.classList.add('hidden'); }

  /* -------------------------------------------------------------- HUD */

  updateHUD() {
    const s = this.game.save.state;
    this.el.hearts.textContent = s.hearts;
    this.el.coins.textContent = s.coins;
    this.el.level.textContent = s.level;
    this.el.xp.style.width = (this.game.save.xpProgress().pct * 100).toFixed(1) + '%';
    this.updateQuestTracker();
  }

  setClock(hour, weatherIcon) {
    const h = Math.floor(hour) % 24;
    const m = Math.floor((hour % 1) * 60);
    this.el.clock.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    this.el.weather.textContent = weatherIcon;
  }

  updateQuestTracker() {
    const q = this.game.quests.tracked;
    if (!q) { this.el.qt.classList.add('hidden'); return; }
    const p = this.game.quests.progressOf(q);
    this.el.qt.classList.remove('hidden');
    this.el.qtTitle.textContent = q.name;
    this.el.qtDesc.textContent = q.desc;
    this.el.qtProg.textContent = `${p.value} / ${p.target}`;
  }

  /** Speedometer, shown only while driving. */
  setDriving(on, name = '') {
    this.el.speedo.classList.toggle('hidden', !on);
    this.el.tbtnExit?.classList.toggle('hidden', !on);
    if (on) this.el.spName.textContent = name;
  }

  setSpeed(kmh, frac) {
    this.el.spKmh.textContent = Math.round(kmh);
    this.el.spFill.style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
  }

  showPrompt(label) {
    this.el.promptLabel.textContent = label;
    this.el.prompt.classList.remove('hidden');
  }

  hidePrompt() { this.el.prompt.classList.add('hidden'); }

  toast(title, sub = '', kind = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.innerHTML = `<span>${esc(title)}</span>${sub ? `<span class="t-sub">${esc(sub)}</span>` : ''}`;
    this.el.toasts.appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 400);
    }, 3200);
    while (this.el.toasts.children.length > 5) this.el.toasts.firstChild.remove();
  }

  discovery(title, sub) {
    const b = this.el.banner;
    this.el.bannerTitle.textContent = title;
    this.el.bannerSub.textContent = sub;
    b.classList.remove('hidden');
    b.style.animation = 'none';
    void b.offsetWidth;
    b.style.animation = '';
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => b.classList.add('hidden'), 4400);
  }

  setFps(v, show) {
    this.el.fps.classList.toggle('hidden', !show);
    if (show) this.el.fps.textContent = v;
  }

  /* --------------------------------------------------------- dialogue */

  showDialogue(name, text, choices, onChoice) {
    this.el.dialogue.classList.remove('hidden');
    this.el.dlgName.textContent = name;
    this.el.dlgText.textContent = text;
    this.el.dlgChoices.innerHTML = '';
    choices.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'btn' + (i === 0 ? ' btn-primary' : '');
      b.textContent = c;
      b.addEventListener('click', () => { this.game.audio?.ui('click'); onChoice(i); });
      this.el.dlgChoices.appendChild(b);
    });
  }

  hideDialogue() { this.el.dialogue.classList.add('hidden'); }

  /* ---------------------------------------------------------- overlay */

  openOverlay(tab = 'map') {
    this.overlayTab = tab;
    this.overlayOpen = true;
    this.el.overlay.classList.remove('hidden');
    this.el.ovTabs.querySelectorAll('button').forEach(b =>
      b.classList.toggle('active', b.dataset.tab === tab));
    this.renderOverlay();
    this.game.onOverlayChange?.(true);
  }

  closeOverlay() {
    if (!this.overlayOpen) return;
    this.overlayOpen = false;
    this.el.overlay.classList.add('hidden');
    this.game.audio?.ui('close');
    this.game.onOverlayChange?.(false);
  }

  renderOverlay() {
    const body = this.el.ovBody;
    body.scrollTop = 0;
    const r = {
      map: () => this.renderMap(body),
      quests: () => this.renderQuests(body),
      collection: () => this.renderCollection(body),
      inventory: () => this.renderInventory(body),
      shop: () => this.renderShop(body),
      customize: () => this.renderCustomize(body),
      achievements: () => this.renderAchievements(body),
      voice: () => this.renderVoice(body),
      settings: () => this.renderSettings(body),
    }[this.overlayTab];
    r ? r() : (body.innerHTML = '');
  }

  /** Voice tab: push-to-talk settings and the room code for voice chat. */
  renderVoice(body) {
    const g = this.game;
    const lv = g.voice;
    const vc = g.voiceChat;
    const s = g.save.state.settings || (g.save.state.settings = {});
    const voices = (typeof speechSynthesis !== 'undefined' ? speechSynthesis.getVoices() : []) || [];
    const micNote = lv?.available
      ? 'Hold <b>V</b> (or the 🎙 button) and speak. Release to let them answer.'
      : 'This browser has no speech recognition. Chrome, Edge and Safari have it; Firefox does not.';
    const chatNote = vc?.available
      ? 'Share the code with your partner. Same code, same room — you will hear each other in 3D as you move.'
      : 'Live voice chat needs the signalling server from <code>server/</code> running, and its address in <code>VOICE.serverUrl</code>.';

    body.innerHTML = `
      <div class="section">
        <div class="section-title">Talk to ${g.companion?.name || 'your partner'}</div>
        <p class="hint">${micNote}</p>
        <div class="opt-row">
          <label>Voice replies<span class="hint">Spoken out loud</span></label>
          <div class="opt-ctl"><button class="btn btn-small ${lv?.enabled ? 'btn-primary' : ''}" id="v-enable">${lv?.enabled ? 'On' : 'Off'}</button></div>
        </div>
        ${voices.length ? `<div class="opt-row">
          <label>Their voice</label>
          <div class="opt-ctl"><select id="v-voice">${voices.map(v =>
            `<option value="${v.name}" ${lv?.voice?.name === v.name ? 'selected' : ''}>${v.name}</option>`).join('')}</select></div>
        </div>` : ''}
        <div class="opt-row">
          <label>Try saying<span class="hint">"where are we", "what time is it", "hold my hand", "let's take a photo", "I love you"</span></label>
          <div class="opt-ctl"></div>
        </div>
      </div>
      <div class="section">
        <div class="section-title">Voice chat with a real person</div>
        <p class="hint">${chatNote}</p>
        <div class="opt-row">
          <label>Room code</label>
          <div class="opt-ctl">
            <input id="v-room" class="voice-code" maxlength="12" value="${(s.voiceRoom || '').replace(/[^A-Za-z0-9]/g, '')}" placeholder="LOVE42">
          </div>
        </div>
        <div class="btn-row">
          <button class="btn ${vc?.connected ? '' : 'btn-primary'}" id="v-connect" ${vc?.available ? '' : 'disabled'}>
            ${vc?.connected ? 'Leave room' : 'Join room'}</button>
          <button class="btn btn-small" id="v-mute" ${vc?.connected ? '' : 'disabled'}>${vc?.muted ? 'Unmute mic' : 'Mute mic'}</button>
        </div>
        <p class="hint" id="v-status">${g.voiceStatus || (vc?.connected ? `Connected — ${vc.peers.size} other here` : 'Not connected')}</p>
      </div>`;

    const $i = (id) => body.querySelector('#' + id);
    $i('v-enable')?.addEventListener('click', () => {
      if (lv) { lv.enabled = !lv.enabled; this.renderOverlay(); }
    });
    $i('v-voice')?.addEventListener('change', (e) => lv?.setVoiceName(e.target.value));
    $i('v-room')?.addEventListener('input', (e) => {
      s.voiceRoom = e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      e.target.value = s.voiceRoom;
      g.save.touch();
    });
    $i('v-connect')?.addEventListener('click', () => g.toggleVoiceChat());
    $i('v-mute')?.addEventListener('click', () => {
      vc?.setMuted(!vc.muted);
      this.renderOverlay();
    });
  }

  /** Show which runtime tier the governor settled on, in Settings. */
  setTierLabel(label, auto) {
    this._tierLabel = label;
    this._tierAuto = auto;
    if (this.overlayOpen && this.overlayTab === 'settings') this.renderOverlay();
  }

  /** The strip above the HUD that shows what was heard and what was said back. */
  setVoiceState(state, heard = '', reply = '') {
    const el = this.el.voiceStrip;
    if (!el) return;
    el.classList.toggle('hidden', state === 'off');
    el.classList.toggle('listening', state === 'listening');
    el.classList.toggle('speaking', state === 'speaking');
    if (heard !== null) this.el.voiceHeard.textContent = heard;
    if (reply !== null) this.el.voiceReply.textContent = reply;
  }

  renderMap(body) {
    body.innerHTML = `
      <div class="section">
        <div class="section-title">Island Map</div>
        <div class="map-wrap"><canvas id="fullmap" width="760" height="760"></canvas></div>
        <div class="map-legend">
          <span><i style="background:#eee6d6"></i>Roads</span>
          <span><i style="background:#6ebecd"></i>Rivers</span>
          <span><i style="background:#ff7a9c"></i>Discovered</span>
          <span><i style="background:rgba(255,255,255,.3)"></i>Not found yet</span>
        </div>
      </div>
      <div class="section">
        <div class="section-title">Fast Travel</div>
        <div class="grid cols" id="travel-list"></div>
      </div>`;
    const cv = $('fullmap');
    const markers = this.game.map.drawFull(cv, this.game.player.pos);
    cv.addEventListener('click', (e) => {
      const rect = cv.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (cv.width / rect.width);
      const y = (e.clientY - rect.top) * (cv.height / rect.height);
      for (const mk of markers) {
        if (Math.hypot(x - mk.x, y - mk.y) < mk.r && mk.travel) this.game.fastTravel(mk.id);
      }
    });

    const list = $('travel-list');
    const targets = this.game.map.travelTargets();
    if (!targets.length) {
      list.innerHTML = `<p class="card">Discover a place first and you can travel back to it from here.</p>`;
      return;
    }
    list.innerHTML = targets.map(t => `
      <div class="card clickable" data-travel="${t.def.id}">
        <h4>${t.def.icon} ${esc(t.def.name)}</h4>
        <p>${esc(t.def.sub)}</p>
        <div class="meta">Travel here</div>
      </div>`).join('');
    list.querySelectorAll('[data-travel]').forEach(c =>
      c.addEventListener('click', () => this.game.fastTravel(c.dataset.travel)));
  }

  renderQuests(body) {
    const qs = this.game.quests;
    const cards = QUESTS.map(q => {
      const p = qs.progressOf(q);
      const locked = q.after && !qs.record(q.after).done && !p.done;
      const pct = Math.round((p.value / q.target) * 100);
      return `
        <div class="card ${p.done ? 'done' : ''} ${locked ? 'locked' : ''}">
          <h4>${esc(q.name)} ${p.done ? '<span class="tick">✓</span>' : ''}</h4>
          <p>${locked ? 'Complete the previous quest first.' : esc(q.desc)}</p>
          <div class="bar"><span style="width:${p.done ? 100 : pct}%"></span></div>
          <div class="meta">${p.value} / ${q.target} · ${esc(qs.rewardText(q))}</div>
        </div>`;
    }).join('');
    body.innerHTML = `
      <div class="section">
        <div class="section-title">Quests — ${qs.completedCount} / ${QUESTS.length} complete</div>
        <div class="grid cols">${cards}</div>
      </div>`;
  }

  renderCollection(body) {
    const s = this.game.save.state;
    const totals = this.game.collectibles?.total() || {};
    const boxes = Object.entries(COLLECTIBLES).map(([id, def]) => `
      <div class="stat-box">
        <span class="n">${s.counts[id] || 0}</span>
        <span class="l">${esc(def.label)}</span>
      </div>`).join('');
    const found = LOCATIONS.filter(l => this.game.save.isDiscovered(l.id));
    const xp = xpBounds(s.level);
    body.innerHTML = `
      <div class="section">
        <div class="section-title">Collection</div>
        <div class="stat-grid">${boxes}</div>
      </div>
      <div class="section">
        <div class="section-title">Profile</div>
        <div class="stat-grid">
          <div class="stat-box"><span class="n">${s.level}</span><span class="l">Level</span></div>
          <div class="stat-box"><span class="n">${s.xp}</span><span class="l">XP (next ${xp.hi})</span></div>
          <div class="stat-box"><span class="n">${s.hearts}</span><span class="l">Hearts</span></div>
          <div class="stat-box"><span class="n">${s.coins}</span><span class="l">Coins</span></div>
          <div class="stat-box"><span class="n">${s.stats.fishCaught || 0}</span><span class="l">Fish caught</span></div>
          <div class="stat-box"><span class="n">${s.stats.photos || 0}</span><span class="l">Photos</span></div>
          <div class="stat-box"><span class="n">${s.stats.dates || 0}</span><span class="l">Shared moments</span></div>
          <div class="stat-box"><span class="n">${Math.floor((s.stats.playTime || 0) / 60)}m</span><span class="l">Time played</span></div>
        </div>
      </div>
      <div class="section">
        <div class="section-title">Places found — ${found.length} / ${LOCATIONS.length}</div>
        <div class="grid cols">
          ${LOCATIONS.map(l => this.game.save.isDiscovered(l.id)
            ? `<div class="card done"><h4>${l.icon} ${esc(l.name)}</h4><p>${esc(l.sub)}</p></div>`
            : `<div class="card locked"><h4>? ? ?</h4><p>${l.secret ? 'A secret, somewhere.' : 'Not discovered yet.'}</p></div>`).join('')}
        </div>
      </div>`;
  }

  renderInventory(body) {
    const inv = this.game.inventory;
    const tile = (i) => `<div class="tile"><span class="em">${i.emoji}</span><span><span class="tn">${esc(i.name)}</span><span class="tq">×${i.qty}</span></span></div>`;
    const cos = inv.cosmetics();
    const quest = inv.questItems();
    body.innerHTML = `
      <div class="section">
        <div class="section-title">Collectibles</div>
        <div class="grid cols">${inv.collectibles().map(tile).join('')}</div>
      </div>
      <div class="section">
        <div class="section-title">Clothing &amp; accessories</div>
        ${cos.length ? `<div class="grid cols">${cos.map(tile).join('')}</div>`
          : '<p class="card">Nothing yet. Earn coins and visit the shop in town.</p>'}
      </div>
      <div class="section">
        <div class="section-title">Quest items</div>
        ${quest.length ? `<div class="grid cols">${quest.map(tile).join('')}</div>`
          : '<p class="card">Complete activities to fill your journal.</p>'}
      </div>`;
  }

  renderShop(body) {
    const shop = this.game.shop;
    const s = this.game.save.state;
    const groups = [...shop.categories()].map(([cat, items]) => `
      <div class="section">
        <div class="section-title">${esc(cat)}</div>
        <div class="grid cols">
          ${items.map(i => {
            const owned = shop.owns(i.id);
            const afford = shop.canAfford(i);
            return `<div class="card ${owned ? 'done' : afford ? 'clickable' : 'locked'}" data-shop="${i.id}">
              <h4>${i.emoji} ${esc(i.name)}</h4>
              <p>${owned ? 'Owned — tap to wear' : `${i.price} coins`}</p>
              <div class="meta">${owned ? 'Equip' : afford ? 'Buy' : 'Need more coins'}</div>
            </div>`;
          }).join('')}
        </div>
      </div>`).join('');
    body.innerHTML = `<div class="section"><div class="section-title">Shop — you have ${s.coins} coins</div></div>${groups}`;
    body.querySelectorAll('[data-shop]').forEach(c => c.addEventListener('click', () => {
      const id = c.dataset.shop;
      if (this.game.shop.owns(id)) {
        this.game.shop.equip(id);
        this.game.refreshLook();
        this.toast('Equipped', SHOP.find(i => i.id === id)?.name || '', 'rose');
      } else {
        const r = this.game.shop.buy(id);
        if (r.ok) {
          this.game.audio?.ui('quest');
          this.toast('Purchased', `${r.item.name} — tap again to wear`, 'gold');
        } else {
          this.game.audio?.ui('error');
          this.toast('Cannot buy', r.reason);
        }
      }
      this.updateHUD();
      this.renderOverlay();
    }));
  }

  renderCustomize(body) {
    const who = this._customTarget || 'look';
    const look = this.game.save.state[who];
    const row = (label, key, values, isStyle = false) => `
      <div class="opt-row">
        <label>${label}</label>
        <div class="swatches" data-part="${key}">
          ${values.map(v => isStyle
            ? `<button class="btn btn-small ${look[key] === v ? 'btn-primary' : ''}" data-val="${v}">${v}</button>`
            : `<span class="swatch ${look[key] === v ? 'active' : ''}" data-val="${v}" style="background:${v}"></span>`).join('')}
        </div>
      </div>`;
    body.innerHTML = `
      <div class="section">
        <div class="section-title">Customize</div>
        <div class="btn-row" style="margin-bottom:14px">
          <button class="btn btn-small ${who === 'look' ? 'btn-primary' : ''}" data-who="look">You</button>
          <button class="btn btn-small ${who === 'companionLook' ? 'btn-primary' : ''}" data-who="companionLook">Companion</button>
        </div>
        ${row('Skin tone', 'skin', CUSTOMIZE.skin)}
        ${row('Hair colour', 'hair', CUSTOMIZE.hair)}
        ${row('Hair style', 'hairStyle', CUSTOMIZE.styles, true)}
        ${row('Outfit', 'outfit', CUSTOMIZE.outfits, true)}
        ${row('Bottoms', 'bottom', CUSTOMIZE.bottoms, true)}
        ${row('Eye colour', 'eyes', CUSTOMIZE.eyes)}
        ${row('Shirt', 'shirt', CUSTOMIZE.shirt)}
        ${row('Trousers', 'pants', CUSTOMIZE.pants)}
        ${row('Shoes', 'shoes', CUSTOMIZE.shoes)}
        <div class="opt-row">
          <label>Hat<span class="hint">Buy hats in the town shop</span></label>
          <div class="opt-ctl"><button class="btn btn-small" id="cust-nohat">Remove hat</button></div>
        </div>
      </div>`;
    body.querySelectorAll('[data-who]').forEach(b => b.addEventListener('click', () => {
      this._customTarget = b.dataset.who;
      this.renderOverlay();
    }));
    body.querySelectorAll('[data-part]').forEach(grp => {
      grp.querySelectorAll('[data-val]').forEach(sw => sw.addEventListener('click', () => {
        this.game.save.state[who][grp.dataset.part] = sw.dataset.val;
        this.game.save.touch();
        this.game.refreshLook();
        this.game.audio?.ui('click');
        this.renderOverlay();
      }));
    });
    $('cust-nohat')?.addEventListener('click', () => {
      this.game.save.state[who].hat = null;
      this.game.save.touch();
      this.game.refreshLook();
      this.renderOverlay();
    });
  }

  renderAchievements(body) {
    const s = this.game.save.state;
    body.innerHTML = `
      <div class="section">
        <div class="section-title">Achievements — ${s.achievements.length} / ${ACHIEVEMENTS.length}</div>
        <div class="grid cols">
          ${ACHIEVEMENTS.map(a => {
            const got = s.achievements.includes(a.id);
            return `<div class="card ${got ? 'done' : 'locked'}">
              <h4>${got ? '🏅' : '🔒'} ${esc(a.name)} ${got ? '<span class="tick">✓</span>' : ''}</h4>
              <p>${esc(a.desc)}</p>
            </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  renderSettings(body) {
    const st = this.game.save.settings;
    const seg = (key, opts, cur) => `
      <div class="seg" data-setting="${key}">
        ${opts.map(o => `<button data-val="${o.v}" class="${cur === o.v ? 'active' : ''}">${o.l}</button>`).join('')}
      </div>`;
    body.innerHTML = `
      <div class="section">
        <div class="section-title">Graphics</div>
        <div class="opt-row">
          <label>Quality<span class="hint">Auto measures your frame rate and tunes itself${
            this._tierLabel ? ` — currently <b>${this._tierLabel}</b>` : ''}</span></label>
          <div class="opt-ctl">${seg('quality', [
            { v: 'auto', l: 'Auto' }, { v: 'low', l: 'Low' }, { v: 'medium', l: 'Medium' }, { v: 'high', l: 'High' },
          ], st.quality)}</div>
        </div>
        <div class="opt-row">
          <label>Shadows</label>
          <div class="opt-ctl">${seg('shadows', [{ v: 'on', l: 'On' }, { v: 'off', l: 'Off' }], st.shadows ? 'on' : 'off')}</div>
        </div>
        <div class="opt-row">
          <label>Show FPS</label>
          <div class="opt-ctl">${seg('showFps', [{ v: 'on', l: 'On' }, { v: 'off', l: 'Off' }], st.showFps ? 'on' : 'off')}</div>
        </div>
        <div class="opt-row">
          <label>Fullscreen</label>
          <div class="opt-ctl"><button class="btn btn-small" id="set-fullscreen">Toggle fullscreen</button></div>
        </div>
        <div class="opt-row">
          <label>Fast loading<span class="hint">Remember the generated island so it loads in seconds next time</span></label>
          <div class="opt-ctl">${seg('cacheWorld', [{ v: 'on', l: 'On' }, { v: 'off', l: 'Off' }],
            st.cacheWorld === false ? 'off' : 'on')}</div>
        </div>
        <div class="opt-row">
          <label>Stored island data</label>
          <div class="opt-ctl"><button class="btn btn-small" id="set-clearcache">Clear and rebuild</button></div>
        </div>
      </div>
      <div class="section">
        <div class="section-title">Audio</div>
        <div class="opt-row"><label>Master volume</label><div class="opt-ctl">
          <input type="range" min="0" max="1" step="0.05" value="${st.master}" data-vol="master"></div></div>
        <div class="opt-row"><label>Music volume</label><div class="opt-ctl">
          <input type="range" min="0" max="1" step="0.05" value="${st.music}" data-vol="music"></div></div>
        <div class="opt-row"><label>Effects volume</label><div class="opt-ctl">
          <input type="range" min="0" max="1" step="0.05" value="${st.sfx}" data-vol="sfx"></div></div>
      </div>
      <div class="section">
        <div class="section-title">Controls</div>
        <div class="opt-row"><label>Camera sensitivity</label><div class="opt-ctl">
          <input type="range" min="0.3" max="2.5" step="0.05" value="${st.sensitivity}" data-ctl="sensitivity"></div></div>
        <div class="opt-row">
          <label>Invert vertical look</label>
          <div class="opt-ctl">${seg('invertY', [{ v: 'on', l: 'On' }, { v: 'off', l: 'Off' }], st.invertY ? 'on' : 'off')}</div>
        </div>
        <div class="opt-row">
          <label>Mouse capture<span class="hint">Turn off if you prefer drag-to-look</span></label>
          <div class="opt-ctl">${seg('pointerLock', [{ v: 'on', l: 'On' }, { v: 'off', l: 'Off' }], st.pointerLock ? 'on' : 'off')}</div>
        </div>
      </div>
      <div class="section">
        <div class="section-title">Time of day</div>
        <div class="opt-row"><label>Set the clock</label><div class="opt-ctl">
          <input type="range" min="0" max="23.9" step="0.1" value="${this.game.dayNight?.time ?? 8}" data-time="1"></div></div>
        <div class="opt-row"><label>Weather</label><div class="opt-ctl">${seg('weather', [
          { v: 'auto', l: 'Auto' }, { v: 'sunny', l: 'Sunny' }, { v: 'cloudy', l: 'Cloudy' }, { v: 'rain', l: 'Rain' },
        ], this.game.weather?.auto ? 'auto' : this.game.weather?.next)}</div></div>
      </div>
      <div class="section">
        <div class="section-title">Progress</div>
        <div class="btn-row">
          <button class="btn btn-small" id="set-save">Save game</button>
          <button class="btn btn-small btn-ghost" id="set-reset">Reset progress</button>
        </div>
      </div>`;

    body.querySelectorAll('[data-setting]').forEach(grp => {
      grp.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        this.game.applySetting(grp.dataset.setting, b.dataset.val);
        this.renderOverlay();
      }));
    });
    body.querySelectorAll('[data-vol]').forEach(r => r.addEventListener('input', () => {
      this.game.applySetting(r.dataset.vol, r.value);
    }));
    body.querySelectorAll('[data-ctl]').forEach(r => r.addEventListener('input', () => {
      this.game.applySetting(r.dataset.ctl, r.value);
    }));
    body.querySelector('[data-time]')?.addEventListener('input', (e) => {
      this.game.dayNight.setTime(parseFloat(e.target.value));
    });
    $('set-fullscreen')?.addEventListener('click', () => this.game.toggleFullscreen());
    $('set-clearcache')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      e.target.textContent = 'Clearing…';
      const ok = await this.game.clearWorldCache();
      e.target.textContent = ok ? 'Cleared' : 'Nothing stored';
      this.toast('Island data', ok
        ? 'Cleared. The next visit rebuilds the island from scratch.'
        : 'Nothing was stored for this device.');
    });
    $('set-save')?.addEventListener('click', () => this.game.saveGame(true));
    $('set-reset')?.addEventListener('click', () => this.confirmReset());
  }

  confirmReset() {
    this.modal({
      emoji: '⚠️', title: 'Reset all progress?',
      text: 'Collectibles, quests, coins and customisation will be erased. This cannot be undone.',
      buttons: [
        { label: 'Reset everything', primary: true, action: () => { this.closeModal(); this.game.resetProgress(); } },
        { label: 'Keep my progress', action: () => this.closeModal() },
      ],
    });
  }

  showCredits() {
    this.modal({
      emoji: '🏝️', title: 'HelloCouple World',
      text: 'Built with Three.js and WebGL. Every model, texture and sound in this island is generated procedurally in your browser — no external assets, no tracking, no backend. Three.js is MIT licensed (© three.js authors).',
      buttons: [{ label: 'Back', primary: true, action: () => this.closeModal() }],
    });
  }

  /* ------------------------------------------------------------ modal */

  modal({ emoji = '', title = '', text = '', choices = null, buttons = [], dismissable = true, html = '' }) {
    this.modalOpen = true;
    this._modalDismissable = dismissable;
    this.el.modal.classList.remove('hidden');
    const card = this.el.modalCard;
    card.innerHTML = `
      ${emoji ? `<div class="modal-emoji">${emoji}</div>` : ''}
      ${title ? `<h3>${esc(title)}</h3>` : ''}
      ${text ? `<p>${esc(text)}</p>` : ''}
      ${html}
      ${choices ? `<div class="choice-grid">${choices.map((c, i) =>
        `<div class="choice" data-choice="${i}"><span class="ce">${c.emoji}</span><span class="cn">${esc(c.name)}</span></div>`).join('')}</div>` : ''}
      <div class="btn-row" style="justify-content:center">${buttons.map((b, i) =>
        `<button class="btn btn-small ${b.primary ? 'btn-primary' : b.ghost ? 'btn-ghost' : ''}" data-btn="${i}">${esc(b.label)}</button>`).join('')}</div>`;
    card.querySelectorAll('[data-choice]').forEach(el => el.addEventListener('click', () => {
      this.game.audio?.ui('click');
      choices[+el.dataset.choice].action?.();
    }));
    card.querySelectorAll('[data-btn]').forEach(el => el.addEventListener('click', () => {
      this.game.audio?.ui('click');
      buttons[+el.dataset.btn].action?.();
    }));
    this.game.onOverlayChange?.(true);
    return card;
  }

  closeModal() {
    if (!this.modalOpen) return;
    this.modalOpen = false;
    this.el.modal.classList.add('hidden');
    this.el.modalCard.innerHTML = '';
    if (this._fishingRaf) { cancelAnimationFrame(this._fishingRaf); this._fishingRaf = null; }
    this.game.onOverlayChange?.(this.overlayOpen);
  }

  /* --------------------------------------------------------- fishing */

  showFishing(game, onStrike, onClose) {
    const card = this.modal({
      emoji: '🎣', title: 'Fishing', text: 'Wait for the bite, then stop the marker in the green zone.',
      html: `<div class="fish-bar"><div class="fish-zone" id="fz"></div><div class="fish-cursor" id="fc"></div></div>
             <p id="fish-msg" style="min-height:1.3em">Casting...</p>`,
      buttons: [
        { label: 'Strike!', primary: true, action: onStrike },
        { label: 'Pack up', ghost: true, action: onClose },
      ],
      dismissable: false,
    });
    const zone = card.querySelector('#fz');
    const cur = card.querySelector('#fc');
    const msg = card.querySelector('#fish-msg');
    this._fish = { zone, cur, msg, card };
    return { zone, cur, msg };
  }

  updateFishing(fg) {
    if (!this._fish) return;
    const { zone, cur, msg } = this._fish;
    zone.style.left = (fg.zoneStart * 100) + '%';
    zone.style.width = (fg.zoneSize * 100) + '%';
    zone.style.opacity = fg.state === 'active' ? '1' : '0.25';
    cur.style.left = `calc(${(fg.cursor * 100).toFixed(1)}% - 2px)`;
    cur.style.opacity = fg.state === 'active' ? '1' : '0.3';
    if (fg.state === 'waiting') msg.textContent = 'Waiting for a bite...';
    else if (fg.state === 'active') msg.textContent = 'Now! Stop it in the green.';
  }

  setFishingMessage(t) { if (this._fish) this._fish.msg.textContent = t; }

  /* ------------------------------------------------------ emote wheel */

  toggleEmoteWheel(force) {
    const open = force !== undefined ? force : !this.wheelOpen;
    this.wheelOpen = open;
    this.el.wheel.classList.toggle('hidden', !open);
    if (!open) { this.game.onOverlayChange?.(this.overlayOpen); return; }
    const owned = this.game.shop.unlockedEmotes();
    const list = EMOTES.filter(e => e.free || owned.includes(e.id));
    const R = 42;
    this.el.wheel.innerHTML = `<div class="wheel">${list.map((e, i) => {
      const a = (i / list.length) * Math.PI * 2 - Math.PI / 2;
      const x = 50 + Math.cos(a) * R, y = 50 + Math.sin(a) * R;
      return `<div class="wheel-item" style="left:${x}%;top:${y}%" data-emote="${e.id}">
        <span class="we">${e.emoji}</span><span class="wn">${esc(e.name)}</span></div>`;
    }).join('')}</div>`;
    this.el.wheel.querySelectorAll('[data-emote]').forEach(el => el.addEventListener('click', () => {
      this.game.playEmote(el.dataset.emote);
      this.toggleEmoteWheel(false);
    }));
    this.game.onOverlayChange?.(true);
  }

  /* ------------------------------------------------------- photo mode */

  setPhotoMode(on) {
    this.el.photo.classList.toggle('hidden', !on);
    this.el.hud.classList.toggle('hidden', on);
    if (on) this.hidePrompt();
  }

  /* ------------------------------------------------------------- fade */

  fade(on, ms = 450) {
    this.el.fade.classList.toggle('on', on);
    return new Promise(r => setTimeout(r, ms));
  }

  get anyOverlayOpen() {
    return this.overlayOpen || this.modalOpen || this.wheelOpen
      || !this.el.dialogue.classList.contains('hidden');
  }
}
