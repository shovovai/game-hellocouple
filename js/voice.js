/**
 * voice.js — talking, out loud, in two different senses.
 *
 *   LocalVoice   push-to-talk into the browser's speech recogniser; your
 *                partner character and NPCs answer through speech synthesis.
 *                No server, no network, works in a plain static deployment.
 *
 *   VoiceChat    real-time microphone audio to the other people in your room
 *                over WebRTC, positioned in 3D so a partner across the plaza
 *                sounds like they are across the plaza. Needs the signalling
 *                server in `server/` to introduce the peers; after that the
 *                audio is peer-to-peer and never touches the server.
 *
 * Both degrade quietly: if the browser has no SpeechRecognition, or no
 * signalling server is configured, the feature reports itself unavailable and
 * the rest of the game is untouched.
 */

/* ------------------------------------------------------------- local voice */

const SR = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;

/** Canned replies. Each entry: [test, reply(ctx)]. First match wins. */
const REPLIES = [
  [/\b(hi|hello|hey|good morning|good evening)\b/, (c) => `Hey ${c.playerName}. ${c.timeGreeting}`],
  [/\bhow are you|you ok|you okay\b/, () => `Happy. Walking around with you is the best part of my day.`],
  [/\blove you\b/, (c) => `I love you too, ${c.playerName}.`],
  [/\bwhere are we|what place|which area\b/, (c) => `We're at ${c.area}.`],
  [/\bwhat time|what's the time\b/, (c) => `It's about ${c.clock}.`],
  [/\bweather|raining|sunny\b/, (c) => `Looks ${c.weather} out here.`],
  [/\b(quest|task|to do|next)\b/, (c) => c.quest ? `You still have "${c.quest}" to finish.` : `Nothing pending. Let's just wander.`],
  [/\b(hold my hand|hold hands|take my hand)\b/, () => { return { say: `Always.`, act: 'hold' }; }],
  [/\b(let's drive|drive|car)\b/, () => `Find us a car downtown and I'll ride shotgun.`],
  [/\b(beach|sea|swim)\b/, () => `The beach is south. The sunset from the west point is better though.`],
  [/\b(coffee|cafe|café|drink)\b/, () => `The café does a good one. Let's go.`],
  [/\b(photo|picture|selfie)\b/, () => { return { say: `Get in the shot with me.`, act: 'photo' }; }],
  [/\b(dance|dancing)\b/, () => { return { say: `Only if you dance too.`, act: 'dance' }; }],
  [/\b(wave|hi there)\b/, () => { return { say: `Hey!`, act: 'wave' }; }],
  [/\b(follow me|come on|let's go)\b/, () => `Right behind you.`],
  [/\b(stop|wait|hold on)\b/, () => `Waiting here.`],
  [/\b(beautiful|pretty|nice)\b/, () => `It is. So are you.`],
  [/\b(thank you|thanks)\b/, () => `Any time.`],
];

export class LocalVoice {
  /**
   * @param {object} hooks {onHeard, onReply, onState, context}
   */
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.listening = false;
    this.available = !!SR;
    this.speaking = false;
    this.voice = null;
    this.enabled = true;
    this.rec = null;
    this._lastHeard = '';
    if (!this.available) return;

    this.rec = new SR();
    this.rec.continuous = false;
    this.rec.interimResults = true;
    this.rec.lang = (navigator.language || 'en-US');

    this.rec.onresult = (e) => {
      let text = '';
      let isFinal = false;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
        if (e.results[i].isFinal) isFinal = true;
      }
      this._lastHeard = text.trim();
      this.hooks.onHeard?.(this._lastHeard, isFinal);
      if (isFinal) this._answer(this._lastHeard);
    };
    this.rec.onerror = (e) => {
      this.listening = false;
      this.hooks.onState?.('error', e.error);
    };
    this.rec.onend = () => {
      if (this.listening) {
        // the recogniser stops itself after a pause; restart while held
        try { this.rec.start(); } catch { this.listening = false; }
      } else {
        this.hooks.onState?.('idle');
        // nothing final arrived (short utterance) — answer what we did hear
        if (this._lastHeard) { const t = this._lastHeard; this._lastHeard = ''; this._answer(t); }
      }
    };
  }

  start() {
    if (!this.available || this.listening || !this.enabled) return false;
    try { this.rec.start(); } catch { return false; }
    this.listening = true;
    this._lastHeard = '';
    this.hooks.onState?.('listening');
    return true;
  }

  stop() {
    if (!this.listening) return;
    this.listening = false;
    try { this.rec.stop(); } catch { /* already stopped */ }
  }

  _answer(text) {
    if (!text) return;
    const ctx = this.hooks.context?.() || {};
    const lower = text.toLowerCase();
    let out = null;
    for (const [test, make] of REPLIES) {
      if (test.test(lower)) { out = make(ctx); break; }
    }
    if (!out) out = this._fallback(lower, ctx);
    const say = typeof out === 'string' ? out : out.say;
    const act = typeof out === 'string' ? null : out.act;
    this.hooks.onReply?.(say, act, text);
    this.speak(say);
  }

  /** Nothing matched: answer something that still fits the conversation. */
  _fallback(lower, ctx) {
    if (lower.endsWith('?') || /^(what|why|how|when|who|where|do you|can you|are you)\b/.test(lower)) {
      return `I'm not sure. Ask me about this place, the time, the weather, or what we should do next.`;
    }
    const idle = [
      `Mm. Keep talking, I like your voice.`,
      `I heard you. Let's keep walking.`,
      `Say that again when we get to ${ctx.area || 'the next spot'}.`,
    ];
    return idle[(Math.random() * idle.length) | 0];
  }

  /** Say a line in the companion's voice. */
  speak(text, opts = {}) {
    if (!text || typeof speechSynthesis === 'undefined' || !this.enabled) return;
    try { speechSynthesis.cancel(); } catch { /* nothing queued */ }
    const u = new SpeechSynthesisUtterance(text);
    u.rate = opts.rate ?? 1.0;
    u.pitch = opts.pitch ?? 1.15;
    u.volume = opts.volume ?? 1.0;
    const v = this._pickVoice();
    if (v) u.voice = v;
    u.onstart = () => { this.speaking = true; this.hooks.onState?.('speaking'); };
    u.onend = () => { this.speaking = false; this.hooks.onState?.('idle'); };
    speechSynthesis.speak(u);
  }

  _pickVoice() {
    if (this.voice) return this.voice;
    if (typeof speechSynthesis === 'undefined') return null;
    const all = speechSynthesis.getVoices();
    if (!all.length) return null;                       // not loaded yet; try later
    const lang = (navigator.language || 'en-US').slice(0, 2);
    const local = all.filter(v => v.lang.slice(0, 2) === lang);
    const pool = local.length ? local : all;
    this.voice = pool.find(v => /female|samantha|karen|zira|google uk english female/i.test(v.name)) || pool[0];
    return this.voice;
  }

  setVoiceName(name) {
    if (typeof speechSynthesis === 'undefined') return;
    this.voice = speechSynthesis.getVoices().find(v => v.name === name) || null;
  }

  dispose() {
    this.stop();
    try { speechSynthesis.cancel(); } catch { /* nothing queued */ }
  }
}

/* -------------------------------------------------------- networked voice */

/**
 * WebRTC voice + state for a small room (designed for two, works for a handful).
 *
 * Signalling is a plain JSON WebSocket: `{t:'join',room,id}` in,
 * `{t:'peers'|'joined'|'left'|'signal'}` back. Everything after the handshake —
 * microphone audio and the 10 Hz position snapshots — is peer-to-peer.
 */
const ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
];

export class VoiceChat {
  /**
   * @param {object} o {url, ctx (AudioContext), onPeer, onPeerLeft, onState}
   */
  constructor(o = {}) {
    this.url = o.url || '';
    this.ctx = o.ctx || null;                     // the game's AudioContext
    this.hooks = o;
    this.connected = false;
    this.room = '';
    this.id = 'p' + Math.random().toString(36).slice(2, 9);
    this.peers = new Map();          // id -> {pc, dc, audio, el}
    this.stream = null;
    this.muted = false;
    this.ws = null;
    this._peerCb = null;
    this._leftCb = null;
    this._retry = 0;
  }

  /** NetworkAdapter surface, so RemotePlayers can drive this unchanged. */
  onPeer(cb) { this._peerCb = cb; }
  onPeerLeft(cb) { this._leftCb = cb; }

  get available() {
    return !!(this.url && typeof RTCPeerConnection !== 'undefined'
      && navigator.mediaDevices?.getUserMedia);
  }

  async connect(room, profile = {}) {
    if (!this.available) throw new Error('Voice chat is not configured for this build');
    this.room = String(room || '').trim().toUpperCase();
    if (!this.room) throw new Error('Enter a room code first');
    this.profile = profile;

    this.hooks.onState?.('mic');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    this.setMuted(this.muted);

    this.hooks.onState?.('connecting');
    await this._openSocket();
    this.connected = true;
    this.hooks.onState?.('connected');
  }

  _openSocket() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({ t: 'join', room: this.room, id: this.id, profile: this.profile }));
        settled = true;
        resolve();
      };
      ws.onerror = () => {
        if (!settled) { settled = true; reject(new Error('Could not reach the voice server')); }
      };
      ws.onclose = () => {
        this.connected = false;
        this.hooks.onState?.('closed');
        for (const id of [...this.peers.keys()]) this._dropPeer(id);
      };
      ws.onmessage = (e) => this._onSignal(JSON.parse(e.data));
    });
  }

  async _onSignal(msg) {
    if (msg.t === 'peers') {
      // we joined an existing room: we make the offers
      for (const id of msg.ids) if (id !== this.id) await this._dial(id, true);
    } else if (msg.t === 'joined') {
      if (msg.id !== this.id) this.hooks.onState?.('peer-joined', msg.id);
    } else if (msg.t === 'left') {
      this._dropPeer(msg.id);
    } else if (msg.t === 'signal') {
      const p = this.peers.get(msg.from) || await this._dial(msg.from, false);
      if (msg.sdp) {
        await p.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        if (msg.sdp.type === 'offer') {
          const answer = await p.pc.createAnswer();
          await p.pc.setLocalDescription(answer);
          this._send({ t: 'signal', to: msg.from, from: this.id, sdp: p.pc.localDescription });
        }
      } else if (msg.ice) {
        try { await p.pc.addIceCandidate(new RTCIceCandidate(msg.ice)); } catch { /* stale candidate */ }
      }
    }
  }

  _send(o) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(o));
  }

  async _dial(id, initiator) {
    if (this.peers.has(id)) return this.peers.get(id);
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const peer = { pc, dc: null, el: null, audio: null, id };
    this.peers.set(id, peer);

    for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream);

    pc.onicecandidate = (e) => {
      if (e.candidate) this._send({ t: 'signal', to: id, from: this.id, ice: e.candidate });
    };
    pc.ontrack = (e) => this._attachAudio(peer, e.streams[0]);
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) this._dropPeer(id);
    };

    if (initiator) {
      const dc = pc.createDataChannel('state', { ordered: false, maxRetransmits: 0 });
      this._wireChannel(peer, dc);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this._send({ t: 'signal', to: id, from: this.id, sdp: pc.localDescription });
    } else {
      pc.ondatachannel = (e) => this._wireChannel(peer, e.channel);
    }
    return peer;
  }

  _wireChannel(peer, dc) {
    peer.dc = dc;
    dc.onmessage = (e) => {
      try { this._peerCb?.(peer.id, JSON.parse(e.data)); } catch { /* malformed frame */ }
    };
  }

  /**
   * Route a peer's microphone through a PannerNode on the game's own audio
   * context, so their voice comes from wherever their character is standing.
   * Without a context we just play the element flat.
   *
   * The muted <audio> element is not redundant: several browsers will not pull
   * frames from a remote track unless it is attached to a media element, even
   * when Web Audio is doing the actual playback.
   */
  _attachAudio(peer, stream) {
    const el = new Audio();
    el.srcObject = stream;
    el.autoplay = true;
    el.muted = !!this.ctx;
    el.play?.().catch(() => { /* autoplay blocked until a gesture */ });
    peer.el = el;
    peer.stream = stream;

    if (this.ctx) {
      try {
        const src = this.ctx.createMediaStreamSource(stream);
        const panner = this.ctx.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance = 4;
        panner.maxDistance = 90;
        panner.rolloffFactor = 1.4;
        const gain = this.ctx.createGain();
        gain.gain.value = 1.35;
        src.connect(panner).connect(gain).connect(this.ctx.destination);
        peer.panner = panner;
        peer.src = src;
      } catch {
        el.muted = false;            // Web Audio refused the stream; play it flat
      }
    }
    this.hooks.onPeerAudio?.(peer.id, stream);
  }

  /** Move a peer's voice to where their character is. */
  setPeerPosition(id, x, y, z) {
    const p = this.peers.get(id);
    if (!p?.panner) return;
    if (p.panner.positionX) {
      p.panner.positionX.value = x; p.panner.positionY.value = y; p.panner.positionZ.value = z;
    } else {
      p.panner.setPosition(x, y, z);
    }
  }

  /** Keep the listener on the camera so the panning matches what you see. */
  setListener(pos, forward) {
    const L = this.ctx?.listener;
    if (!L) return;
    if (L.positionX) {
      L.positionX.value = pos.x; L.positionY.value = pos.y; L.positionZ.value = pos.z;
      L.forwardX.value = forward.x; L.forwardY.value = forward.y; L.forwardZ.value = forward.z;
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else {
      L.setPosition(pos.x, pos.y, pos.z);
      L.setOrientation(forward.x, forward.y, forward.z, 0, 1, 0);
    }
  }

  /** Broadcast the local snapshot over every data channel. */
  send(snapshot) {
    const data = JSON.stringify(snapshot);
    for (const p of this.peers.values()) {
      if (p.dc?.readyState === 'open') {
        try { p.dc.send(data); } catch { /* channel closing */ }
      }
    }
  }

  setMuted(on) {
    this.muted = on;
    for (const t of this.stream?.getAudioTracks() || []) t.enabled = !on;
  }

  _dropPeer(id) {
    const p = this.peers.get(id);
    if (!p) return;
    try { p.pc.close(); } catch { /* already closed */ }
    try { p.src?.disconnect(); p.panner?.disconnect(); } catch { /* already detached */ }
    if (p.el) { p.el.srcObject = null; }
    this.peers.delete(id);
    this._leftCb?.(id);
    this.hooks.onState?.('peer-left', id);
  }

  disconnect() {
    for (const id of [...this.peers.keys()]) this._dropPeer(id);
    try { this.ws?.close(); } catch { /* already closed */ }
    for (const t of this.stream?.getTracks() || []) t.stop();
    this.stream = null;
    this.ws = null;
    this.connected = false;
    this.hooks.onState?.('idle');
  }
}
