/**
 * audio.js — 100% procedural audio via the Web Audio API.
 *
 * No sound files ship with the game: ambience (waves, wind, rain, forest,
 * campfire, café murmur) is synthesised from filtered noise, and UI / footstep
 * / pickup sounds are short synth blips. That keeps the download tiny and side-
 * steps every audio licensing question.
 *
 * Browsers block audio until a user gesture, so `resume()` is called from the
 * first click/keypress.
 */

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.enabled = true;
    this.volumes = { master: 0.8, music: 0.5, sfx: 0.85 };
    this.beds = {};
    this.noiseBuffer = null;
    this._musicTimer = 0;
    this._musicStep = 0;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch { return; }

    this.master = this.ctx.createGain();
    this.master.gain.value = this.volumes.master;
    this.master.connect(this.ctx.destination);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = this.volumes.sfx;
    this.sfxBus.connect(this.master);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.volumes.music;
    this.musicBus.connect(this.master);

    this.ambBus = this.ctx.createGain();
    this.ambBus.gain.value = 1;
    this.ambBus.connect(this.master);

    // 3 seconds of white noise, reused by every ambience bed
    const len = this.ctx.sampleRate * 3;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;

    this._bed('waves', { type: 'lowpass', freq: 520, q: 0.7, gain: 0, lfo: { rate: 0.14, depth: 0.55 } });
    this._bed('wind', { type: 'bandpass', freq: 720, q: 0.6, gain: 0, lfo: { rate: 0.09, depth: 0.4 } });
    this._bed('rain', { type: 'highpass', freq: 1400, q: 0.4, gain: 0 });
    this._bed('forest', { type: 'bandpass', freq: 2600, q: 1.4, gain: 0, lfo: { rate: 0.22, depth: 0.3 } });
    this._bed('fire', { type: 'bandpass', freq: 380, q: 0.8, gain: 0, lfo: { rate: 3.1, depth: 0.6 } });
    this._bed('cafe', { type: 'bandpass', freq: 460, q: 0.9, gain: 0, lfo: { rate: 0.5, depth: 0.25 } });
    this._bed('water', { type: 'bandpass', freq: 1100, q: 0.8, gain: 0, lfo: { rate: 0.7, depth: 0.35 } });

    this.ready = true;
  }

  _bed(name, o) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = o.type;
    filt.frequency.value = o.freq;
    filt.Q.value = o.q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filt).connect(gain).connect(this.ambBus);
    src.start();
    if (o.lfo) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = o.lfo.rate;
      const lg = ctx.createGain();
      lg.gain.value = o.lfo.depth;
      const mod = ctx.createGain();
      lfo.connect(lg).connect(mod.gain);
      // amplitude wobble
      gain.disconnect();
      gain.connect(mod).connect(this.ambBus);
      mod.gain.value = 1;
      lfo.start();
    }
    this.beds[name] = { gain, filt, target: 0 };
  }

  resume() {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(kind, v) {
    this.volumes[kind] = clamp01(v);
    if (!this.ready) return;
    if (kind === 'master') this.master.gain.value = this.volumes.master;
    if (kind === 'sfx') this.sfxBus.gain.value = this.volumes.sfx;
    if (kind === 'music') this.musicBus.gain.value = this.volumes.music;
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.ready) this.master.gain.value = on ? this.volumes.master : 0;
  }

  /** Smoothly set an ambience bed level (0..1). */
  amb(name, level) {
    const b = this.beds[name];
    if (!b || !this.ready) return;
    b.target = clamp01(level);
  }

  updateBeds(dt) {
    if (!this.ready) return;
    for (const b of Object.values(this.beds)) {
      const cur = b.gain.gain.value;
      const next = cur + (b.target - cur) * Math.min(1, dt * 1.6);
      b.gain.gain.value = next;
    }
  }

  /* --------------------------------------------------------- one-shots */

  _env(node, t0, attack, decay, peak) {
    const g = node.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + attack);
    g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  tone(freq, { type = 'sine', dur = 0.18, gain = 0.22, slide = 0, delay = 0, bus = null } = {}) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
    osc.connect(g).connect(bus || this.sfxBus);
    this._env(g, t0, 0.012, dur, gain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.08);
  }

  noise({ dur = 0.12, gain = 0.2, type = 'bandpass', freq = 900, q = 1, delay = 0 } = {}) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    src.connect(f).connect(g).connect(this.sfxBus);
    this._env(g, t0, 0.006, dur, gain);
    src.start(t0);
    src.stop(t0 + dur + 0.06);
  }

  /* ------------------------------------------------------------ events */

  footstep(surface = 'grass') {
    const map = {
      grass: { freq: 1500, q: 1.2, gain: 0.085, dur: 0.08 },
      sand: { freq: 900, q: 0.8, gain: 0.10, dur: 0.11 },
      rock: { freq: 2400, q: 2.0, gain: 0.075, dur: 0.06 },
      wood: { freq: 520, q: 3.0, gain: 0.11, dur: 0.09 },
      water: { freq: 1900, q: 0.7, gain: 0.13, dur: 0.15 },
    };
    const o = map[surface] || map.grass;
    this.noise({ ...o, freq: o.freq * (0.85 + Math.random() * 0.3) });
  }

  pickup(kind = 'coin') {
    if (kind === 'star') {
      [660, 880, 1320].forEach((f, i) => this.tone(f, { type: 'triangle', dur: 0.3, gain: 0.16, delay: i * 0.07 }));
    } else if (kind === 'heart') {
      this.tone(560, { type: 'sine', dur: 0.16, gain: 0.16 });
      this.tone(840, { type: 'sine', dur: 0.22, gain: 0.13, delay: 0.08 });
    } else {
      this.tone(880, { type: 'square', dur: 0.07, gain: 0.10 });
      this.tone(1320, { type: 'square', dur: 0.09, gain: 0.08, delay: 0.05 });
    }
  }

  ui(kind = 'click') {
    if (kind === 'click') this.tone(520, { type: 'sine', dur: 0.05, gain: 0.10 });
    else if (kind === 'open') this.tone(380, { type: 'triangle', dur: 0.14, gain: 0.10, slide: 180 });
    else if (kind === 'close') this.tone(420, { type: 'triangle', dur: 0.12, gain: 0.09, slide: -160 });
    else if (kind === 'error') this.tone(180, { type: 'sawtooth', dur: 0.16, gain: 0.10 });
    else if (kind === 'quest') [523, 659, 784, 1046].forEach((f, i) =>
      this.tone(f, { type: 'triangle', dur: 0.34, gain: 0.13, delay: i * 0.10 }));
    else if (kind === 'discover') [392, 523, 659].forEach((f, i) =>
      this.tone(f, { type: 'sine', dur: 0.5, gain: 0.12, delay: i * 0.12 }));
    else if (kind === 'level') [523, 659, 784, 1046, 1318].forEach((f, i) =>
      this.tone(f, { type: 'sine', dur: 0.4, gain: 0.14, delay: i * 0.08 }));
  }

  splash() { this.noise({ dur: 0.35, gain: 0.18, type: 'lowpass', freq: 1400, q: 0.5 }); }
  camera() { this.noise({ dur: 0.05, gain: 0.2, type: 'bandpass', freq: 3200, q: 3 }); }
  jump() { this.tone(300, { type: 'sine', dur: 0.12, gain: 0.08, slide: 120 }); }
  land() { this.noise({ dur: 0.1, gain: 0.12, type: 'lowpass', freq: 600, q: 1 }); }

  /**
   * A slow ambient arpeggio. Gentle enough to loop for a long time — this is
   * the "music" layer and can be muted independently.
   */
  updateMusic(dt, night) {
    if (!this.ready || !this.enabled || this.volumes.music <= 0.001) return;
    this._musicTimer -= dt;
    if (this._musicTimer > 0) return;
    this._musicTimer = 2.4 + Math.random() * 1.6;
    const scaleDay = [392.00, 440.00, 523.25, 587.33, 659.25, 783.99];
    const scaleNight = [261.63, 311.13, 349.23, 392.00, 466.16, 523.25];
    const scale = night ? scaleNight : scaleDay;
    const n = scale[(this._musicStep * 3 + Math.floor(Math.random() * 3)) % scale.length];
    this._musicStep++;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    for (const [mult, gain, delay] of [[1, 0.07, 0], [2, 0.028, 0.28], [1.5, 0.022, 0.62]]) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = n * mult;
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 1800;
      osc.connect(filt).connect(g).connect(this.musicBus);
      const st = t0 + delay;
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(gain, st + 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 2.6);
      osc.start(st);
      osc.stop(st + 2.8);
    }
  }
}
