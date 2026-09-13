/**
 * controls.js — keyboard + mouse + touch input.
 *
 * Desktop uses pointer lock when the browser grants it and silently falls back
 * to drag-to-look (which matters inside an iframe, where pointer lock is often
 * unavailable). Touch devices get a virtual joystick, swipe look and buttons.
 */

import { clamp } from './noise.js';

export function isTouchDevice() {
  return (('ontouchstart' in window) || navigator.maxTouchPoints > 0)
    && window.matchMedia('(pointer: coarse)').matches;
}

export class Controls {
  constructor(canvas) {
    this.canvas = canvas;
    this.enabled = true;
    this.keys = new Set();
    this.move = { x: 0, y: 0 };        // analog, -1..1
    this.look = { x: 0, y: 0 };        // consumed deltas
    this.zoomDelta = 0;
    this.sprint = false;
    this.jumpQueued = false;
    this.interactQueued = false;
    this.holdQueued = false;
    this.talkHeld = false;
    this.talkChanged = false;
    /** Held (not queued) — doubles as the brake pedal while driving. */
    this.brakeHeld = false;
    this.pointerLocked = false;
    this.touch = isTouchDevice();
    this.sensitivity = 1.0;
    this.invertY = false;
    this.onKey = null;                 // (code) => void, for menu shortcuts

    this._dragging = false;
    this._lastPointer = { x: 0, y: 0 };
    this._joyId = null;
    this._lookId = null;
    this._joyOrigin = { x: 0, y: 0 };

    this._bindKeyboard();
    this._bindMouse();
    this._bindTouch();
  }

  /* ------------------------------------------------------------ keys */

  _bindKeyboard() {
    const prevent = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);
    window.addEventListener('keydown', (e) => {
      if (e.repeat) { if (prevent.has(e.code)) e.preventDefault(); return; }
      this.keys.add(e.code);
      if (prevent.has(e.code)) e.preventDefault();
      if (e.code === 'Space') { this.jumpQueued = true; this.brakeHeld = true; }
      if (e.code === 'KeyE') this.interactQueued = true;
      if (e.code === 'KeyV' && !this.talkHeld) { this.talkHeld = true; this.talkChanged = true; }
      if (this.onKey) this.onKey(e.code, e);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Space') this.brakeHeld = false;
      if (e.code === 'KeyV' && this.talkHeld) { this.talkHeld = false; this.talkChanged = true; }
    });
    window.addEventListener('blur', () => {
      this.keys.clear(); this.sprint = false; this.brakeHeld = false;
      if (this.talkHeld) { this.talkHeld = false; this.talkChanged = true; }
    });
  }

  /* ----------------------------------------------------------- mouse */

  _bindMouse() {
    const c = this.canvas;
    c.addEventListener('mousedown', (e) => {
      if (this.touch) return;
      this._dragging = true;
      this._lastPointer.x = e.clientX;
      this._lastPointer.y = e.clientY;
      if (this.wantLock && !this.pointerLocked && c.requestPointerLock) {
        const p = c.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      }
    });
    window.addEventListener('mouseup', () => { this._dragging = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.pointerLocked) {
        this.look.x += e.movementX * 0.0022 * this.sensitivity;
        this.look.y += e.movementY * 0.0022 * this.sensitivity * (this.invertY ? -1 : 1);
      } else if (this._dragging) {
        this.look.x += (e.clientX - this._lastPointer.x) * 0.004 * this.sensitivity;
        this.look.y += (e.clientY - this._lastPointer.y) * 0.004 * this.sensitivity * (this.invertY ? -1 : 1);
        this._lastPointer.x = e.clientX;
        this._lastPointer.y = e.clientY;
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });
    c.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.zoomDelta += Math.sign(e.deltaY) * 0.6;
    }, { passive: false });
    c.addEventListener('contextmenu', e => e.preventDefault());
  }

  /** Request pointer lock on the next click (called when gameplay starts). */
  enablePointerLock(on) { this.wantLock = on; }
  releasePointerLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /* ----------------------------------------------------------- touch */

  _bindTouch() {
    const zone = document.getElementById('joystick-zone');
    const base = document.getElementById('joystick-base');
    const knob = document.getElementById('joystick-knob');
    this._knob = knob;
    this._base = base;
    const R = 52;

    const startJoy = (t) => {
      this._joyId = t.identifier;
      const r = zone.getBoundingClientRect();
      this._joyOrigin.x = clamp(t.clientX - r.left, 70, r.width - 70);
      this._joyOrigin.y = clamp(t.clientY - r.top, 70, r.height - 70);
      base.style.left = this._joyOrigin.x + 'px';
      base.style.bottom = (r.height - this._joyOrigin.y) + 'px';
      base.classList.add('active');
    };

    if (zone) {
      zone.addEventListener('touchstart', (e) => {
        for (const t of e.changedTouches) if (this._joyId === null) startJoy(t);
        e.preventDefault();
      }, { passive: false });
      zone.addEventListener('touchmove', (e) => {
        const r = zone.getBoundingClientRect();
        for (const t of e.changedTouches) {
          if (t.identifier !== this._joyId) continue;
          const dx = (t.clientX - r.left) - this._joyOrigin.x;
          const dy = (t.clientY - r.top) - this._joyOrigin.y;
          const len = Math.hypot(dx, dy) || 1;
          const cl = Math.min(len, R);
          const nx = (dx / len) * cl, ny = (dy / len) * cl;
          knob.style.transform = `translate(${nx}px, ${ny}px)`;
          this.move.x = nx / R;
          this.move.y = -ny / R;
          this.sprint = len > R * 0.86;
        }
        e.preventDefault();
      }, { passive: false });
      const endJoy = (e) => {
        for (const t of e.changedTouches) {
          if (t.identifier !== this._joyId) continue;
          this._joyId = null;
          this.move.x = this.move.y = 0;
          this.sprint = false;
          knob.style.transform = '';
          base.classList.remove('active');
        }
      };
      zone.addEventListener('touchend', endJoy);
      zone.addEventListener('touchcancel', endJoy);
    }

    // swipe anywhere on the right half to look
    this.canvas.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        if (t.clientX > window.innerWidth * 0.42 && this._lookId === null) {
          this._lookId = t.identifier;
          this._lastPointer.x = t.clientX;
          this._lastPointer.y = t.clientY;
        }
      }
    }, { passive: true });
    this.canvas.addEventListener('touchmove', (e) => {
      if (!this.enabled) return;
      for (const t of e.changedTouches) {
        if (t.identifier !== this._lookId) continue;
        this.look.x += (t.clientX - this._lastPointer.x) * 0.006 * this.sensitivity;
        this.look.y += (t.clientY - this._lastPointer.y) * 0.006 * this.sensitivity * (this.invertY ? -1 : 1);
        this._lastPointer.x = t.clientX;
        this._lastPointer.y = t.clientY;
      }
      e.preventDefault();
    }, { passive: false });
    const endLook = (e) => {
      for (const t of e.changedTouches) if (t.identifier === this._lookId) this._lookId = null;
    };
    this.canvas.addEventListener('touchend', endLook);
    this.canvas.addEventListener('touchcancel', endLook);

    // pinch zoom
    let pinchStart = null;
    this.canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        const d = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY);
        if (pinchStart !== null) this.zoomDelta += (pinchStart - d) * 0.02;
        pinchStart = d;
      } else pinchStart = null;
    }, { passive: true });

    // buttons
    const btn = (id, onDown, onUp) => {
      const el = document.getElementById(id);
      if (!el) return;
      const down = (e) => { e.preventDefault(); onDown && onDown(); };
      const up = (e) => { e.preventDefault(); onUp && onUp(); };
      el.addEventListener('touchstart', down, { passive: false });
      el.addEventListener('touchend', up, { passive: false });
      el.addEventListener('mousedown', down);
      el.addEventListener('mouseup', up);
    };
    btn('tbtn-jump', () => { this.jumpQueued = true; this.brakeHeld = true; }, () => { this.brakeHeld = false; });
    btn('tbtn-interact', () => { this.interactQueued = true; });
    btn('tbtn-hold', () => { this.holdQueued = true; });
    const talk = document.getElementById('tbtn-talk');
    if (talk) {
      const set = (on) => { if (this.talkHeld !== on) { this.talkHeld = on; this.talkChanged = true; } };
      const down = (e) => { e.preventDefault(); set(true); };
      const up = (e) => { e.preventDefault(); set(false); };
      talk.addEventListener('pointerdown', down);
      talk.addEventListener('pointerup', up);
      talk.addEventListener('pointercancel', up);
      talk.addEventListener('pointerleave', up);
    }
    btn('tbtn-sprint', () => { this._sprintToggle = !this._sprintToggle; });
    btn('tbtn-map', () => { this.onKey && this.onKey('KeyM'); });
    btn('tbtn-menu', () => { this.onKey && this.onKey('Escape'); });
    btn('tbtn-exitcar', () => { this.interactQueued = true; });
  }

  /* ---------------------------------------------------------- polling */

  /** Merged analog movement vector from keys or joystick. */
  getMove() {
    let x = this.move.x, y = this.move.y;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y, len: Math.min(1, len) };
  }

  isSprinting() {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.sprint || !!this._sprintToggle;
  }

  consumeLook() {
    const l = { x: this.look.x, y: this.look.y };
    this.look.x = 0; this.look.y = 0;
    return l;
  }

  consumeZoom() {
    const z = this.zoomDelta;
    this.zoomDelta = 0;
    return z;
  }

  consumeJump() { const j = this.jumpQueued; this.jumpQueued = false; return j; }
  consumeInteract() { const i = this.interactQueued; this.interactQueued = false; return i; }
  consumeHold() { const h = this.holdQueued; this.holdQueued = false; return h; }
  consumeTalk() { const c = this.talkChanged; this.talkChanged = false; return c ? this.talkHeld : null; }

  reset() {
    this.keys.clear();
    this.move.x = this.move.y = 0;
    this.look.x = this.look.y = 0;
    this.jumpQueued = this.interactQueued = this.holdQueued = false;
    if (this.talkHeld) { this.talkHeld = false; this.talkChanged = true; }
    this.brakeHeld = false;
    this.sprint = false;
  }
}
