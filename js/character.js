/**
 * character.js — procedural humanoid with blended procedural animation.
 *
 * The body is a real bone hierarchy of simple capsule meshes, so poses are just
 * joint rotations. Locomotion blends idle → walk → run by speed, air poses take
 * over when off the ground, and emotes overlay the upper body. Every joint is
 * damped toward its target each frame, which is what gives the blending its
 * smoothness without any animation clips.
 */

import * as THREE from 'three';
import { damp, clamp, lerp } from './noise.js';

const CAPS = new Map();
function capsule(r, len, seg = 6) {
  const key = r.toFixed(3) + ':' + len.toFixed(3) + ':' + seg;
  if (!CAPS.has(key)) {
    const g = new THREE.CapsuleGeometry(r, Math.max(0.01, len), 2, seg);
    g.userData.shared = true;              // reused by every character, ever
    CAPS.set(key, g);
  }
  return CAPS.get(key);
}

const JOINTS = ['hips', 'spine', 'chest', 'neck', 'head',
  'armLU', 'armLL', 'armRU', 'armRL',
  'legLU', 'legLL', 'legRU', 'legRL', 'footL', 'footR'];

export const DEFAULT_LOOK = {
  skin: '#e8bc9a',
  hair: '#2b2119',
  hairStyle: 'short',
  shirt: '#ff7a9c',
  pants: '#3c5a80',
  shoes: '#f2f2f2',
  hat: null,
  height: 1.0,
};

export class Character {
  constructor(look = {}, opts = {}) {
    this.look = { ...DEFAULT_LOOK, ...look };
    this.scaleY = this.look.height || 1;
    this.root = new THREE.Group();
    this.root.name = opts.name || 'character';
    this.root.userData.dynamic = true;

    this.mats = {
      skin: new THREE.MeshStandardMaterial({ color: this.look.skin, roughness: 0.72 }),
      hair: new THREE.MeshStandardMaterial({ color: this.look.hair, roughness: 0.66 }),
      shirt: new THREE.MeshStandardMaterial({ color: this.look.shirt, roughness: 0.86 }),
      pants: new THREE.MeshStandardMaterial({ color: this.look.pants, roughness: 0.9 }),
      shoes: new THREE.MeshStandardMaterial({ color: this.look.shoes, roughness: 0.7 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x241c19, roughness: 0.5 }),
      hat: new THREE.MeshStandardMaterial({ color: this.look.hat || '#e3c98a', roughness: 0.8 }),
    };

    this.j = {};
    this._build();

    this.target = {};
    this.curr = {};
    for (const n of JOINTS) {
      this.target[n] = { x: 0, y: 0, z: 0 };
      this.curr[n] = { x: 0, y: 0, z: 0 };
    }
    this.rootOffset = { y: 0, pitch: 0, roll: 0 };
    this.currOffset = { y: 0, pitch: 0, roll: 0 };

    this.phase = 0;
    this.emote = null;
    this.emoteTime = 0;
    this.blink = 0;
    this.state = { speed: 0, grounded: true, sitting: false, vy: 0, swimming: false };
  }

  _add(parent, geo, mat, x, y, z) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  _node(parent, x, y, z, name) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    if (name) this.j[name] = g;
    return g;
  }

  _build() {
    const m = this.mats;
    const body = new THREE.Group();
    body.scale.setScalar(this.scaleY);
    this.root.add(body);
    this.body = body;

    // ---- spine chain ----
    const hips = this._node(body, 0, 0.92, 0, 'hips');
    this._add(hips, capsule(0.145, 0.12), m.pants, 0, -0.02, 0);
    const spine = this._node(hips, 0, 0.12, 0, 'spine');
    this._add(spine, capsule(0.15, 0.16), m.shirt, 0, 0.08, 0);
    const chest = this._node(spine, 0, 0.2, 0, 'chest');
    this._add(chest, capsule(0.165, 0.16), m.shirt, 0, 0.04, 0.005);
    // collar
    this._add(chest, new THREE.CylinderGeometry(0.10, 0.115, 0.05, 10), m.shirt, 0, 0.17, 0);
    const neck = this._node(chest, 0, 0.19, 0, 'neck');
    this._add(neck, capsule(0.048, 0.06), m.skin, 0, 0.02, 0);
    const head = this._node(neck, 0, 0.10, 0, 'head');

    // ---- head ----
    const skull = this._add(head, new THREE.SphereGeometry(0.115, 16, 14), m.skin, 0, 0.055, 0);
    skull.scale.set(1, 1.12, 1.03);
    this._add(head, new THREE.SphereGeometry(0.082, 12, 10), m.skin, 0, -0.01, 0.035).scale.set(1, 0.9, 1);
    for (const sx of [-1, 1]) {
      this._add(head, new THREE.SphereGeometry(0.017, 8, 6), m.dark, sx * 0.042, 0.055, 0.098);
      this._add(head, new THREE.SphereGeometry(0.022, 6, 5), m.skin, sx * 0.115, 0.045, 0);
    }
    // eyebrows + mouth give the face a readable expression at distance
    for (const sx of [-1, 1]) {
      const brow = this._add(head, new THREE.BoxGeometry(0.032, 0.007, 0.012), m.hair, sx * 0.042, 0.085, 0.10);
      brow.rotation.z = sx * 0.1;
    }
    this._add(head, new THREE.BoxGeometry(0.04, 0.008, 0.01), m.dark, 0, -0.005, 0.104);

    // ---- hair ----
    this.hairGroup = new THREE.Group();
    head.add(this.hairGroup);
    this._buildHair(this.look.hairStyle);

    if (this.look.hat) this._buildHat();

    // ---- arms ----
    for (const side of [-1, 1]) {
      const tag = side < 0 ? 'L' : 'R';
      const sh = this._node(chest, side * 0.175, 0.12, 0, 'arm' + tag + 'U');
      const up = this._add(sh, capsule(0.052, 0.2), m.shirt, 0, -0.13, 0);
      up.name = 'sleeve' + tag;
      const el = this._node(sh, 0, -0.26, 0, 'arm' + tag + 'L');
      this._add(el, capsule(0.045, 0.19), m.skin, 0, -0.12, 0);
      this._add(el, new THREE.SphereGeometry(0.052, 8, 7), m.skin, 0, -0.25, 0).scale.set(0.9, 1.1, 0.7);
    }

    // ---- legs ----
    for (const side of [-1, 1]) {
      const tag = side < 0 ? 'L' : 'R';
      const hip = this._node(hips, side * 0.085, -0.06, 0, 'leg' + tag + 'U');
      this._add(hip, capsule(0.072, 0.26), m.pants, 0, -0.18, 0);
      const knee = this._node(hip, 0, -0.38, 0, 'leg' + tag + 'L');
      this._add(knee, capsule(0.058, 0.24), m.pants, 0, -0.16, 0);
      const foot = this._node(knee, 0, -0.32, 0, 'foot' + tag);
      const shoe = this._add(foot, new THREE.BoxGeometry(0.1, 0.07, 0.22), m.shoes, 0, -0.03, 0.04);
      shoe.geometry = new THREE.BoxGeometry(0.1, 0.07, 0.22);
      this._add(foot, new THREE.SphereGeometry(0.05, 8, 6), m.shoes, 0, -0.03, 0.12).scale.set(1, 0.7, 1);
    }
  }

  _buildHair(style) {
    const m = this.mats;
    this.hairGroup.clear();
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.125, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), m.hair);
    cap.position.set(0, 0.055, 0);
    cap.scale.set(1, 1.12, 1.04);
    cap.castShadow = true;
    this.hairGroup.add(cap);

    if (style === 'long') {
      const back = new THREE.Mesh(capsule(0.085, 0.24), m.hair);
      back.position.set(0, -0.03, -0.055);
      back.scale.set(1.35, 1, 0.75);
      back.castShadow = true;
      this.hairGroup.add(back);
      for (const sx of [-1, 1]) {
        const s = new THREE.Mesh(capsule(0.036, 0.2), m.hair);
        s.position.set(sx * 0.105, -0.02, 0.01);
        s.castShadow = true;
        this.hairGroup.add(s);
      }
    } else if (style === 'bun') {
      const bun = new THREE.Mesh(new THREE.SphereGeometry(0.062, 10, 8), m.hair);
      bun.position.set(0, 0.13, -0.085);
      bun.castShadow = true;
      this.hairGroup.add(bun);
    } else {
      const fringe = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.05, 0.04), m.hair);
      fringe.position.set(0, 0.115, 0.085);
      this.hairGroup.add(fringe);
    }
  }

  _buildHat() {
    const m = this.mats;
    if (this.hatGroup) { this.hatGroup.removeFromParent(); }
    this.hatGroup = new THREE.Group();
    this.j.head.add(this.hatGroup);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.125, 0.10, 14), m.hat);
    crown.position.y = 0.17;
    crown.castShadow = true;
    this.hatGroup.add(crown);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.018, 18), m.hat);
    brim.position.y = 0.125;
    brim.castShadow = true;
    this.hatGroup.add(brim);
  }

  setLook(look) {
    Object.assign(this.look, look);
    this.mats.skin.color.set(this.look.skin);
    this.mats.hair.color.set(this.look.hair);
    this.mats.shirt.color.set(this.look.shirt);
    this.mats.pants.color.set(this.look.pants);
    this.mats.shoes.color.set(this.look.shoes);
    this._buildHair(this.look.hairStyle);
    if (this.look.hat) {
      this.mats.hat.color.set(this.look.hat);
      this._buildHat();
    } else if (this.hatGroup) {
      this.hatGroup.removeFromParent();
      this.hatGroup = null;
    }
  }

  playEmote(id, duration = 2.6) {
    this.emote = id;
    this.emoteTime = duration;
  }

  /* ------------------------------------------------------------ poses */

  _zero(t) {
    for (const n of JOINTS) { t[n].x = 0; t[n].y = 0; t[n].z = 0; }
    t.__y = 0; t.__pitch = 0; t.__roll = 0;
  }

  _blendInto(t, pose, w) {
    for (const n of JOINTS) {
      const p = pose[n];
      if (!p) continue;
      t[n].x += (p[0] || 0) * w;
      t[n].y += (p[1] || 0) * w;
      t[n].z += (p[2] || 0) * w;
    }
    t.__y += (pose.__y || 0) * w;
    t.__pitch += (pose.__pitch || 0) * w;
    t.__roll += (pose.__roll || 0) * w;
  }

  _poseIdle(p) {
    const b = Math.sin(p * 1.4);
    const s = Math.sin(p * 0.55);
    return {
      __y: b * 0.006,
      chest: [b * 0.025, s * 0.05, 0],
      spine: [0, s * 0.03, 0],
      head: [b * 0.02 - 0.02, s * 0.10, 0],
      armLU: [b * 0.03, 0, 0.10 + s * 0.02],
      armRU: [-b * 0.03, 0, -0.10 - s * 0.02],
      armLL: [-0.14, 0, 0.04],
      armRL: [-0.14, 0, -0.04],
      legLU: [0, 0, 0.02],
      legRU: [0, 0, -0.02],
    };
  }

  _poseWalk(p) {
    const s = Math.sin(p), c = Math.cos(p);
    return {
      __y: Math.abs(c) * 0.035 - 0.02,
      __roll: s * 0.028,
      hips: [0, -s * 0.09, 0],
      spine: [0.04, s * 0.06, 0],
      chest: [0.02, -s * 0.05, 0],
      head: [-0.02, -s * 0.04, 0],
      armLU: [s * 0.62, 0, 0.13],
      armRU: [-s * 0.62, 0, -0.13],
      armLL: [-0.34 + Math.max(0, -s) * 0.35, 0, 0],
      armRL: [-0.34 + Math.max(0, s) * 0.35, 0, 0],
      legLU: [-s * 0.62, 0, 0.02],
      legRU: [s * 0.62, 0, -0.02],
      legLL: [Math.max(0, s) * 0.95, 0, 0],
      legRL: [Math.max(0, -s) * 0.95, 0, 0],
      footL: [-Math.max(0, s) * 0.35 + 0.08, 0, 0],
      footR: [-Math.max(0, -s) * 0.35 + 0.08, 0, 0],
    };
  }

  _poseRun(p) {
    const s = Math.sin(p), c = Math.cos(p);
    return {
      __y: Math.abs(c) * 0.07 - 0.03,
      __pitch: 0.16,
      __roll: s * 0.05,
      hips: [0.05, -s * 0.16, 0],
      spine: [0.1, s * 0.12, 0],
      chest: [0.06, -s * 0.1, 0],
      head: [-0.14, -s * 0.05, 0],
      armLU: [s * 1.15, 0, 0.2],
      armRU: [-s * 1.15, 0, -0.2],
      armLL: [-1.25, 0, 0],
      armRL: [-1.25, 0, 0],
      legLU: [-s * 1.0, 0, 0.03],
      legRU: [s * 1.0, 0, -0.03],
      legLL: [Math.max(0, s) * 1.7, 0, 0],
      legRL: [Math.max(0, -s) * 1.7, 0, 0],
      footL: [-Math.max(0, s) * 0.4 + 0.12, 0, 0],
      footR: [-Math.max(0, -s) * 0.4 + 0.12, 0, 0],
    };
  }

  _poseJump() {
    return {
      __pitch: -0.1,
      spine: [-0.1, 0, 0],
      armLU: [-2.1, 0, 0.5], armRU: [-2.1, 0, -0.5],
      armLL: [-0.5, 0, 0], armRL: [-0.5, 0, 0],
      legLU: [-0.5, 0, 0.06], legRU: [-0.2, 0, -0.06],
      legLL: [0.85, 0, 0], legRL: [0.5, 0, 0],
      footL: [0.3, 0, 0], footR: [0.2, 0, 0],
    };
  }

  _poseFall() {
    return {
      __pitch: 0.08,
      armLU: [-1.5, 0, 0.85], armRU: [-1.5, 0, -0.85],
      armLL: [-0.7, 0, 0], armRL: [-0.7, 0, 0],
      legLU: [0.25, 0, 0.1], legRU: [-0.3, 0, -0.1],
      legLL: [0.5, 0, 0], legRL: [0.25, 0, 0],
    };
  }

  _poseSit() {
    return {
      __y: -0.42,
      hips: [0.02, 0, 0],
      spine: [0.04, 0, 0],
      chest: [0.03, 0, 0],
      head: [-0.05, 0, 0],
      armLU: [0.3, 0, 0.16], armRU: [0.3, 0, -0.16],
      armLL: [-0.75, 0, 0], armRL: [-0.75, 0, 0],
      legLU: [-1.5, 0, 0.08], legRU: [-1.5, 0, -0.08],
      legLL: [1.5, 0, 0], legRL: [1.5, 0, 0],
      footL: [0.1, 0, 0], footR: [0.1, 0, 0],
    };
  }

  _poseEmote(id, t) {
    const s = Math.sin(t * 7);
    switch (id) {
      case 'wave':
        return { armRU: [-2.35, 0, -0.5 + s * 0.28], armRL: [-0.35, 0, s * 0.32], head: [0, -0.18, 0], chest: [0, -0.08, 0] };
      case 'point':
        return { armRU: [-1.55, -0.35, -0.15], armRL: [-0.06, 0, 0], head: [0, -0.3, 0], chest: [0, -0.2, 0] };
      case 'cheer':
        return {
          __y: Math.abs(Math.sin(t * 5)) * 0.1,
          armLU: [-2.7, 0, 0.5 + s * 0.15], armRU: [-2.7, 0, -0.5 - s * 0.15],
          armLL: [-0.3, 0, 0], armRL: [-0.3, 0, 0], head: [-0.18, 0, 0],
        };
      case 'heart':
        return {
          armLU: [-1.75, -0.5, 0.28], armRU: [-1.75, 0.5, -0.28],
          armLL: [-0.95, 0, 0.5], armRL: [-0.95, 0, -0.5],
          head: [0.08, 0, 0], chest: [0.05, 0, 0],
          __y: Math.sin(t * 3) * 0.012,
        };
      case 'dance': {
        const a = Math.sin(t * 5.2), b = Math.cos(t * 2.6);
        return {
          __y: Math.abs(a) * 0.06, __roll: a * 0.12,
          hips: [0, b * 0.3, a * 0.06],
          spine: [0, -b * 0.2, 0], chest: [a * 0.06, b * 0.22, 0],
          head: [0, b * 0.3, a * 0.1],
          armLU: [-1.7 + a * 0.6, 0, 0.7 + a * 0.3], armRU: [-1.7 - a * 0.6, 0, -0.7 + a * 0.3],
          armLL: [-0.8, 0, 0], armRL: [-0.8, 0, 0],
          legLU: [Math.max(0, a) * 0.4, 0, 0.05], legRU: [Math.max(0, -a) * 0.4, 0, -0.05],
          legLL: [Math.max(0, a) * 0.6, 0, 0], legRL: [Math.max(0, -a) * 0.6, 0, 0],
        };
      }
      case 'interact':
        return { armRU: [-1.25, -0.2, -0.12], armRL: [-0.5, 0, 0], chest: [0.06, -0.12, 0], head: [0.12, -0.1, 0] };
      case 'fish':
        return {
          armLU: [-1.15, -0.15, 0.3], armRU: [-1.0, -0.3, -0.22],
          armLL: [-0.55, 0, 0], armRL: [-0.7, 0, 0], chest: [0.03, -0.12, 0],
        };
      case 'drink':
        return { armRU: [-1.5, -0.1, -0.05], armRL: [-1.5, 0, 0], head: [0.14, 0, 0] };
      default:
        return null;
    }
  }

  /* ----------------------------------------------------------- update */

  update(dt, state = {}) {
    Object.assign(this.state, state);
    const st = this.state;
    const speed = st.speed || 0;

    // locomotion cycle speed follows movement speed
    const cadence = speed < 0.1 ? 1.6 : lerp(4.2, 8.2, clamp((speed - 1.2) / 5.2, 0, 1));
    this.phase += dt * cadence;

    const t = this.target;
    this._zero(t);

    if (st.sitting) {
      this._blendInto(t, this._poseSit(), 1);
    } else if (!st.grounded) {
      const up = clamp((st.vy || 0) / 6, 0, 1);
      this._blendInto(t, this._poseJump(), up);
      this._blendInto(t, this._poseFall(), 1 - up);
    } else {
      const wWalk = clamp((speed - 0.15) / 2.4, 0, 1);
      const wRun = clamp((speed - 3.2) / 3.0, 0, 1);
      const wIdle = 1 - wWalk;
      if (wIdle > 0.001) this._blendInto(t, this._poseIdle(this.phase), wIdle);
      if (wWalk > 0.001) this._blendInto(t, this._poseWalk(this.phase), wWalk * (1 - wRun));
      if (wRun > 0.001) this._blendInto(t, this._poseRun(this.phase), wWalk * wRun);
    }

    // emote overlay
    if (this.emote) {
      this.emoteTime -= dt;
      const pose = this._poseEmote(this.emote, this.emoteTime);
      if (pose) {
        const fade = clamp(this.emoteTime * 2.2, 0, 1);
        // full-body emotes replace the pose, upper-body ones blend on top
        const full = this.emote === 'dance';
        if (full) for (const n of JOINTS) { t[n].x *= 1 - fade; t[n].y *= 1 - fade; t[n].z *= 1 - fade; }
        else for (const n of ['armLU', 'armRU', 'armLL', 'armRL', 'head', 'chest']) {
          if (pose[n]) { t[n].x *= 1 - fade; t[n].y *= 1 - fade; t[n].z *= 1 - fade; }
        }
        this._blendInto(t, pose, fade);
      }
      if (this.emoteTime <= 0) this.emote = null;
    }

    // damp toward the target — this is the animation blending
    const k = st.snap ? 1 : 1 - Math.exp(-dt * 13);
    for (const n of JOINTS) {
      const c = this.curr[n], tg = t[n], node = this.j[n];
      c.x += (tg.x - c.x) * k;
      c.y += (tg.y - c.y) * k;
      c.z += (tg.z - c.z) * k;
      if (node) node.rotation.set(c.x, c.y, c.z);
    }
    const o = this.currOffset;
    o.y += ((t.__y || 0) - o.y) * k;
    o.pitch += ((t.__pitch || 0) - o.pitch) * k;
    o.roll += ((t.__roll || 0) - o.roll) * k;
    this.body.position.y = o.y * this.scaleY;
    this.body.rotation.x = o.pitch;
    this.body.rotation.z = o.roll;

    // blink
    this.blink -= dt;
    if (this.blink < 0) this.blink = 2.5 + Math.random() * 4;
  }

  dispose() {
    // Capsule geometries are shared between every character, so only the
    // per-character materials are ours to release.
    this.root.removeFromParent();
    Object.values(this.mats).forEach(m => m.dispose());
  }
}
