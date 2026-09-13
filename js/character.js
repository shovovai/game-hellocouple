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
import * as TEX from './textures.js';
import { mergeGeometries } from './batching.js';

/**
 * Every character is built from the same ~70 primitives. Merging the ones that
 * sit under the same joint and use the same material turns that into ~30 draws
 * without changing the silhouette — and because the layout is identical for
 * everyone, the merged geometry is built once and shared.
 */
const MERGED = new Map();

const CAPS = new Map();
function shared(key, make) {
  if (!CAPS.has(key)) {
    const g = make();
    g.userData.shared = true;              // reused by every character, ever
    CAPS.set(key, g);
  }
  return CAPS.get(key);
}
function capsule(r, len, seg = 8) {
  return shared('c' + r.toFixed(3) + ':' + len.toFixed(3) + ':' + seg,
    () => new THREE.CapsuleGeometry(r, Math.max(0.01, len), 3, seg));
}
function ball(r, seg = 10) {
  return shared('s' + r.toFixed(3) + ':' + seg,
    () => new THREE.SphereGeometry(r, seg, Math.max(4, seg - 2)));
}
function box(w, h, d, bevel = 0) {
  return shared('b' + [w, h, d, bevel].map(v => v.toFixed(3)).join(':'),
    () => bevel > 0
      ? new THREE.CapsuleGeometry(bevel, 0.001, 2, 8).scale(w / bevel / 2, h / bevel / 2, d / bevel / 2)
      : new THREE.BoxGeometry(w, h, d));
}
function tube(rt, rb, h, seg = 12, open = false) {
  return shared('t' + [rt, rb, h, seg].map(v => v.toFixed(3)).join(':') + open,
    () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open));
}

/**
 * Skin, cloth and hair all get a tiling detail + normal map so that surfaces
 * respond to the moving sun instead of reading as flat blocks of colour. The
 * maps are greyscale and shared across every character; only the material
 * colour changes per person.
 */
/** One shared, soft, round shadow — every character and vehicle uses it. */
let CONTACT_MAT = null;
export function contactShadowMaterial() {
  if (!CONTACT_MAT) {
    CONTACT_MAT = new THREE.MeshBasicMaterial({
      map: TEX.glowTexture('contact', 'rgba(0,0,0,0.5)', 'rgba(0,0,0,0)'),
      transparent: true, depthWrite: false, opacity: 0.6,
      blending: THREE.NormalBlending,
    });
  }
  return CONTACT_MAT;
}

const SURFACE_REPEAT = { knit: [12, 15], denim: [12, 15], leather: [6, 6], skin: [4, 4], hair: [3, 4] };
function surfMaps(kind) {
  const map = TEX.surfaceDetail(kind);
  const normalMap = TEX.surfaceNormal(kind);
  const [rx, ry] = SURFACE_REPEAT[kind] || [3, 3];
  map.repeat.set(rx, ry);
  normalMap.repeat.set(rx, ry);
  return { map, normalMap };
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
  eyes: '#4a3324',
  outfit: 'tee',          // tee | shirt | jacket | hoodie | coat | dress
  bottom: 'trousers',     // trousers | shorts | skirt
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

    const nrm = (s) => new THREE.Vector2(s, s);
    this.mats = {
      // Skin keeps a little sheen so cheeks and forearms catch a highlight.
      skin: new THREE.MeshStandardMaterial({
        color: this.look.skin, roughness: 0.56, ...surfMaps('skin'), normalScale: nrm(0.16),
      }),
      hair: new THREE.MeshStandardMaterial({
        color: this.look.hair, roughness: 0.42, ...surfMaps('hair'), normalScale: nrm(0.5),
      }),
      shirt: new THREE.MeshStandardMaterial({
        color: this.look.shirt, roughness: 0.82, ...surfMaps('knit'), normalScale: nrm(0.2),
      }),
      pants: new THREE.MeshStandardMaterial({
        color: this.look.pants, roughness: 0.88, ...surfMaps('denim'), normalScale: nrm(0.24),
      }),
      shoes: new THREE.MeshStandardMaterial({
        color: this.look.shoes, roughness: 0.52, ...surfMaps('leather'), normalScale: nrm(0.34),
      }),
      // trim = quiet shades used for cuffs, collar (shirt) and the waistband
      trim: new THREE.MeshStandardMaterial({ color: this.look.shirt, roughness: 0.8 }),
      waist: new THREE.MeshStandardMaterial({ color: this.look.pants, roughness: 0.75 }),
      // the layer worn under an open jacket or coat
      under: new THREE.MeshStandardMaterial({
        color: 0xf2efe9, roughness: 0.86, ...surfMaps('knit'), normalScale: new THREE.Vector2(0.2, 0.2),
      }),
      sole: new THREE.MeshStandardMaterial({ color: 0x2f2b28, roughness: 0.85 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x241c19, roughness: 0.5 }),
      lip: new THREE.MeshStandardMaterial({ color: 0xb9705f, roughness: 0.42 }),
      eye: new THREE.MeshStandardMaterial({
        map: TEX.irisTexture(this.look.eyes || '#4a3324'), roughness: 0.16, metalness: 0,
      }),
      hat: new THREE.MeshStandardMaterial({ color: this.look.hat || '#e3c98a', roughness: 0.8 }),
    };
    this._shadeTrim();

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
    this.gaze = { yaw: 0, pitch: 0 };        // head turn, in head-local radians
    this.gazeCurr = { yaw: 0, pitch: 0 };
    this.mood = 0;                            // -1 sad .. 0 neutral .. 1 happy
    this.state = { speed: 0, grounded: true, sitting: false, vy: 0, swimming: false, hold: 0 };
  }

  /**
   * Merge the direct mesh children of `node` that share a material into one
   * mesh. Anything flagged `userData.noMerge` (the eyelids) is left alone so it
   * can still be animated on its own.
   */
  _flush(node, key) {
    if (!this._roleOf) this._roleOf = new Map(Object.entries(this.mats).map(([k, v]) => [v, k]));
    const groups = new Map();
    for (const child of node.children) {
      if (!child.isMesh || child.userData.noMerge) continue;
      const role = this._roleOf.get(child.material);
      if (!role) continue;
      if (!groups.has(role)) groups.set(role, []);
      groups.get(role).push(child);
    }
    for (const [role, meshes] of groups) {
      if (meshes.length < 2) continue;
      const ck = key + ':' + role;
      let geo = MERGED.get(ck);
      if (!geo) {
        const parts = meshes.map(mm => {
          mm.updateMatrix();
          const g = mm.geometry.index ? mm.geometry.toNonIndexed() : mm.geometry.clone();
          g.applyMatrix4(mm.matrix);
          return g;
        });
        geo = mergeGeometries(parts);
        parts.forEach(g => g.dispose());
        geo.userData.shared = true;
        MERGED.set(ck, geo);
      }
      const merged = new THREE.Mesh(geo, meshes[0].material);
      merged.castShadow = meshes.some(mm => mm.castShadow);
      merged.receiveShadow = true;
      for (const mm of meshes) node.remove(mm);
      node.add(merged);
    }
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

  /** Darken/lighten a colour — used for cuffs, waistbands and soles. */
  _shadeTrim() {
    const hsl = {};
    const c = new THREE.Color(this.look.shirt);
    c.getHSL(hsl);
    c.setHSL(hsl.h, hsl.s * 0.5, clamp(hsl.l * 0.8, 0.05, 0.92));
    this.mats.trim.color.copy(c);
    const w = new THREE.Color(this.look.pants);
    w.getHSL(hsl);
    w.setHSL(hsl.h, hsl.s * 0.8, clamp(hsl.l * 0.72, 0.04, 0.9));
    this.mats.waist.color.copy(w);
  }

  _build() {
    const m = this.mats;
    const body = new THREE.Group();
    body.scale.setScalar(this.scaleY);
    this.root.add(body);
    this.body = body;

    // Contact shadow. A cast shadow is switched off on the lower tiers and is
    // too soft to ground a figure anyway; this soft blob under the feet is what
    // stops characters looking like they are hovering.
    const blob = new THREE.Mesh(
      shared('blob', () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)),
      contactShadowMaterial());
    blob.position.y = 0.02;
    blob.scale.set(0.92, 1, 1.05);
    blob.renderOrder = -1;
    this.root.add(blob);
    this.blob = blob;

    // ---- spine chain ----
    // The torso is built from capsules squashed on Z so the silhouette is
    // wide-and-flat like a chest rather than a round sausage.
    const hips = this._node(body, 0, 0.92, 0, 'hips');
    const pelvis = this._add(hips, capsule(0.135, 0.13), m.pants, 0, -0.025, 0);
    pelvis.scale.set(1.16, 1, 0.82);
    // waistband
    this._add(hips, tube(0.137, 0.133, 0.03, 14), m.waist, 0, 0.055, 0).scale.set(1.17, 1, 0.84);

    const spine = this._node(hips, 0, 0.12, 0, 'spine');
    this._add(spine, capsule(0.134, 0.17), m.shirt, 0, 0.08, 0).scale.set(1.04, 1, 0.78);

    const chest = this._node(spine, 0, 0.2, 0, 'chest');
    const rib = this._add(chest, capsule(0.15, 0.17), m.shirt, 0, 0.012, 0.004);
    rib.scale.set(1.17, 0.9, 0.76);
    // trapezius wedge fills the hollow between neck and shoulders
    this._add(chest, ball(0.086, 10), m.shirt, 0, 0.138, -0.012).scale.set(1.3, 0.46, 0.8);
    // (chest is flushed after the arms are attached)
    // collar
    const collar = this._add(chest, tube(0.082, 0.108, 0.05, 14, true), m.trim, 0, 0.165, 0.005);
    collar.scale.set(1.06, 1, 0.92);
    collar.material.side = THREE.DoubleSide;

    const neck = this._node(chest, 0, 0.19, 0, 'neck');
    this._add(neck, capsule(0.058, 0.08), m.skin, 0, 0.028, -0.004).scale.set(1, 1, 0.9);
    // throat fills the hollow under the jaw
    this._add(neck, ball(0.045, 10), m.skin, 0, 0.072, 0.016).scale.set(1, 0.9, 0.95);
    const head = this._node(neck, 0, 0.14, 0, 'head');

    this._buildHead(head);
    this._flush(head, 'head');

    // ---- hair ----
    this.hairGroup = new THREE.Group();
    head.add(this.hairGroup);
    this._buildHair(this.look.hairStyle);

    if (this.look.hat) this._buildHat();

    // ---- arms ----
    for (const side of [-1, 1]) {
      const tag = side < 0 ? 'L' : 'R';
      const sh = this._node(chest, side * 0.168, 0.12, 0, 'arm' + tag + 'U');
      // deltoid: without this the arm reads as a stick floating beside the body
      this._add(sh, ball(0.057, 10), m.shirt, 0, 0.008, 0).scale.set(1.02, 0.96, 0.94);
      const up = this._add(sh, capsule(0.054, 0.2), m.shirt, 0, -0.125, 0);
      up.name = 'sleeve' + tag;
      up.scale.set(1, 1, 0.94);
      // sleeve cuff marks where fabric ends and skin begins
      this._add(sh, tube(0.049, 0.052, 0.03, 12), m.trim, 0, -0.222, 0);

      const el = this._node(sh, 0, -0.26, 0, 'arm' + tag + 'L');
      this._add(el, ball(0.05, 9), m.skin, 0, 0.005, 0);
      this._add(el, capsule(0.042, 0.18), m.skin, 0, -0.115, 0).scale.set(1, 1, 0.95);
      const hand = this._buildHand(el, side);
      this._flush(hand, 'hand');
      this._flush(sh, 'shoulder');
      this._flush(el, 'elbow');
    }

    // ---- legs ----
    // `bottom` decides how far the cloth goes: full trousers, shorts to the
    // knee, or bare legs under a skirt.
    const bottom = this.look.bottom || 'trousers';
    const bare = bottom === 'skirt' || this.look.outfit === 'dress';
    const thighMat = bare ? m.skin : m.pants;
    const shinMat = (bare || bottom === 'shorts') ? m.skin : m.pants;
    const legKey = thighMat === m.skin ? 'bare' : 'clad';
    for (const side of [-1, 1]) {
      const tag = side < 0 ? 'L' : 'R';
      const hip = this._node(hips, side * 0.085, -0.06, 0, 'leg' + tag + 'U');
      this._add(hip, ball(0.082, 10), thighMat, 0, 0.015, 0).scale.set(1, 0.95, 0.95);
      this._add(hip, capsule(0.073, 0.26), thighMat, 0, -0.18, 0).scale.set(1, 1, 0.96);
      if (bottom === 'shorts' && !bare) {
        // short leg opening, wider than the thigh
        this._add(hip, tube(0.082, 0.074, 0.07, 12), m.pants, 0, -0.3, 0);
      }

      const knee = this._node(hip, 0, -0.38, 0, 'leg' + tag + 'L');
      this._add(knee, ball(0.063, 9), shinMat, 0, 0.005, 0.006).scale.set(1, 0.9, 1);
      this._add(knee, capsule(0.055, 0.22), shinMat, 0, -0.15, 0).scale.set(1, 1, 0.94);
      if (shinMat === m.pants) this._add(knee, tube(0.053, 0.057, 0.05, 12), m.pants, 0, -0.287, 0.004);
      else this._add(knee, ball(0.05, 9), m.skin, 0, -0.285, 0.004).scale.set(1, 0.85, 0.9);

      const foot = this._node(knee, 0, -0.32, 0, 'foot' + tag);
      this._buildShoe(foot);
      this._flush(hip, 'thigh:' + legKey);
      this._flush(knee, 'shin:' + (shinMat === m.skin ? 'bare' : 'clad'));
      this._flush(foot, 'shoe');
    }

    this._buildOutfit(chest, hips);
    this._flush(chest, 'chest:' + (this.look.outfit || 'tee'));
  }

  /**
   * Clothing worn over the base body: collars, lapels, hoods, plackets and
   * skirts. Everything hangs off the chest or hips joints, so it animates with
   * the body for free.
   */
  _buildOutfit(chest, hips) {
    const m = this.mats;
    const outfit = this.look.outfit || 'tee';
    const bottom = this.look.bottom || 'trousers';
    const CW = 0.15 * 1.17;                          // chest half-width

    // Long sleeves down the forearm for anything but a tee.
    if (outfit !== 'tee' && outfit !== 'dress') {
      for (const side of [-1, 1]) {
        const el = this.j['arm' + (side < 0 ? 'L' : 'R') + 'L'];
        this._add(el, capsule(0.05, 0.15), m.shirt, 0, -0.1, 0).scale.set(1, 1, 0.96);
        this._add(el, tube(0.047, 0.052, 0.035, 12), m.trim, 0, -0.185, 0);
        this._flush(el, 'elbow:sleeve');
      }
    }

    if (outfit === 'shirt') {
      // button placket and a fold-down collar
      this._add(chest, box(0.05, 0.3, 0.02), m.trim, 0, 0.03, CW * 0.62 + 0.04);
      for (let i = 0; i < 3; i++) {
        this._add(chest, ball(0.011, 6), m.trim, 0, 0.12 - i * 0.075, CW * 0.62 + 0.05);
      }
      for (const sx of [-1, 1]) {
        const c = this._add(chest, box(0.075, 0.055, 0.012), m.shirt, sx * 0.045, 0.15, 0.1);
        c.rotation.set(0.5, sx * 0.25, sx * 0.2);
      }
    } else if (outfit === 'jacket' || outfit === 'coat') {
      // open front: an under-layer strip with a lapel on each side
      this._add(chest, capsule(0.1, 0.16), m.under, 0, 0.04, 0.02).scale.set(0.62, 1, 0.8);
      for (const sx of [-1, 1]) {
        const lapel = this._add(chest, box(0.085, 0.24, 0.022), m.shirt, sx * 0.075, 0.05, 0.105);
        lapel.rotation.set(0, 0, sx * 0.22);
        const notch = this._add(chest, box(0.07, 0.05, 0.02), m.shirt, sx * 0.075, 0.155, 0.1);
        notch.rotation.set(0.4, 0, sx * 0.5);
      }
      this._add(chest, tube(0.078, 0.104, 0.055, 14, true), m.shirt, 0, 0.168, 0.005).scale.set(1.12, 1, 0.95);
      if (outfit === 'coat') {
        // a coat skirt that hangs past the hips
        const skirt = this._add(hips, tube(0.165, 0.205, 0.46, 16, true), m.shirt, 0, -0.24, 0);
        skirt.material.side = THREE.DoubleSide;
        skirt.scale.set(1.06, 1, 0.86);
      }
    } else if (outfit === 'hoodie') {
      // hood behind the neck, kangaroo pocket, drawstrings
      const hood = this._add(chest, shared('hood', () =>
        new THREE.SphereGeometry(0.125, 14, 10, 0, Math.PI * 2, Math.PI * 0.34, Math.PI * 0.5)),
        m.shirt, 0, 0.16, -0.075);
      hood.scale.set(1.05, 1.25, 1.1);
      this._add(chest, tube(0.085, 0.108, 0.06, 14, true), m.shirt, 0, 0.155, 0.01).scale.set(1.1, 1, 0.95);
      for (const sx of [-1, 1]) {
        this._add(chest, capsule(0.007, 0.09), m.trim, sx * 0.035, 0.09, 0.1);
      }
      const pocket = this._add(chest, box(0.17, 0.09, 0.03), m.shirt, 0, -0.09, CW * 0.6 + 0.02);
      pocket.rotation.x = 0.12;
    } else if (outfit === 'dress') {
      // straps over the shoulders and a flared skirt from the waist
      for (const sx of [-1, 1]) {
        const strap = this._add(chest, box(0.045, 0.2, 0.02), m.shirt, sx * 0.075, 0.08, 0.075);
        strap.rotation.set(0.1, 0, sx * 0.1);
      }
      const skirt = this._add(hips, tube(0.16, 0.245, 0.5, 20, true), m.shirt, 0, -0.24, 0);
      skirt.material.side = THREE.DoubleSide;
      skirt.scale.set(1.04, 1, 0.9);
      const hem = this._add(hips, shared('hem:dress', () =>
        new THREE.TorusGeometry(0.245, 0.014, 5, 20)), m.shirt, 0, -0.49, 0);
      hem.rotation.x = Math.PI / 2;
      hem.scale.set(1.04, 0.9, 1);
      this._add(hips, tube(0.152, 0.152, 0.03, 16), m.trim, 0, 0.01, 0).scale.set(1.1, 1, 0.86);
    }

    if (bottom === 'skirt' && outfit !== 'dress') {
      const skirt = this._add(hips, tube(0.16, 0.235, 0.42, 20, true), m.pants, 0, -0.19, 0);
      skirt.material.side = THREE.DoubleSide;
      skirt.scale.set(1.06, 1, 0.88);
      const hem = this._add(hips, shared('hem:skirt', () =>
        new THREE.TorusGeometry(0.235, 0.013, 5, 20)), m.pants, 0, -0.4, 0);
      hem.rotation.x = Math.PI / 2;
      hem.scale.set(1.06, 0.88, 1);
    }
  }

  /** Rebuild the body — needed when a change alters geometry, not just colour. */
  _rebuild() {
    if (this.body) this.body.removeFromParent();
    this.j = {};
    this.eyes = null;
    this.lids = null;
    this.hairGroup = null;
    this.hatGroup = null;
    this._build();
  }

  /** Head: skull, jaw, brow, nose, lips, ears, eyes with lids. */
  _buildHead(head) {
    const m = this.mats;
    const skull = this._add(head, ball(0.096, 16), m.skin, 0, 0.052, -0.004);
    skull.scale.set(0.98, 1.22, 1.1);
    // cheeks / jaw taper down to a chin instead of ending in a ball
    this._add(head, ball(0.073, 12), m.skin, 0, -0.014, 0.02).scale.set(0.93, 0.92, 1.0);
    this._add(head, ball(0.039, 10), m.skin, 0, -0.05, 0.04).scale.set(0.9, 0.74, 0.85);
    // brow ridge catches a shadow over the eyes
    this._add(head, ball(0.058, 10), m.skin, 0, 0.074, 0.048).scale.set(1.26, 0.42, 0.68);
    // nose: a bridge and a rounded tip
    this._add(head, capsule(0.012, 0.04), m.skin, 0, 0.028, 0.084).rotation.x = 0.42;
    this._add(head, ball(0.0115, 8), m.skin, 0, 0.005, 0.09).scale.set(1.25, 0.85, 0.95);
    // lips
    this._add(head, capsule(0.0078, 0.032), m.lip, 0, -0.026, 0.083).rotation.set(0, 0, Math.PI / 2);
    this._add(head, capsule(0.009, 0.028), m.lip, 0, -0.037, 0.08).rotation.set(0, 0, Math.PI / 2);

    this.eyes = [];
    this.lids = [];
    for (const sx of [-1, 1]) {
      // The eyeball is small and set back in the socket, with lids above and
      // below, so only an almond of white shows — a full sphere reads cartoon.
      const eye = this._add(head, ball(0.0148, 12), m.eye, sx * 0.035, 0.046, 0.077);
      eye.castShadow = false;
      eye.rotation.y = sx * 0.06;
      this.eyes.push(eye);
      const lid = this._add(head, shared('lid', () =>
        new THREE.SphereGeometry(0.0172, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55)),
        m.skin, sx * 0.035, 0.0485, 0.0765);
      lid.rotation.x = -0.42;
      lid.castShadow = false;
      lid.userData.noMerge = true;
      this.lids.push(lid);
      // lower lid keeps the sclera from bleeding into the cheek
      const low = this._add(head, capsule(0.005, 0.02), m.skin, sx * 0.035, 0.0338, 0.0825);
      low.rotation.set(0.2, 0, Math.PI / 2);
      low.castShadow = false;
      // eyebrow
      const brow = this._add(head, box(0.03, 0.007, 0.011), m.hair, sx * 0.0355, 0.0735, 0.0825);
      brow.rotation.set(-0.25, 0, sx * 0.12);
      // ear
      this._add(head, ball(0.02, 8), m.skin, sx * 0.092, 0.038, -0.004).scale.set(0.4, 1.15, 0.72);
    }
  }

  /** Hand: palm, four separate fingers and a thumb. */
  _buildHand(el, side) {
    const m = this.mats;
    const hand = new THREE.Group();
    hand.position.set(0, -0.235, 0);
    el.add(hand);
    const palm = this._add(hand, capsule(0.029, 0.038), m.skin, 0, -0.018, 0);
    palm.scale.set(1.02, 1, 0.6);
    // Four fingers with their own gaps: one block reads as a mitten at the
    // distance a player actually looks at their own hands.
    for (let i = 0; i < 4; i++) {
      const t = (i - 1.5) / 1.5;
      const len = 0.042 - Math.abs(t) * 0.008;
      const f = this._add(hand, capsule(0.0088, len), m.skin,
        t * 0.019, -0.058 - (0.004 - Math.abs(t) * 0.004), 0.002);
      f.rotation.z = t * 0.14;
      f.rotation.x = -0.12;
    }
    const thumb = this._add(hand, capsule(0.0125, 0.03), m.skin, -side * 0.031, -0.03, 0.014);
    thumb.rotation.set(-0.2, 0, -side * 0.62);
    return hand;
  }

  /** Shoe: sole slab, upper, toe cap and a heel. */
  _buildShoe(foot) {
    const m = this.mats;
    const upper = this._add(foot, capsule(0.048, 0.1), m.shoes, 0, -0.018, 0.035);
    upper.rotation.x = Math.PI / 2;
    upper.scale.set(1, 1, 0.78);
    const toe = this._add(foot, ball(0.045, 10), m.shoes, 0, -0.022, 0.108);
    toe.scale.set(1, 0.72, 0.95);
    const sole = this._add(foot, box(0.098, 0.025, 0.235), m.sole, 0, -0.05, 0.042);
    this._add(foot, box(0.09, 0.028, 0.06), m.sole, 0, -0.062, -0.02);
    // tongue / laces hint
    this._add(foot, box(0.05, 0.012, 0.07), m.trim, 0, 0.014, 0.035);
    return sole;
  }

  _buildHair(style) {
    const m = this.mats;
    this.hairGroup.clear();
    const put = (geo, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0) => {
      const mesh = new THREE.Mesh(geo, m.hair);
      mesh.position.set(x, y, z);
      mesh.scale.set(sx, sy, sz);
      mesh.rotation.x = rx;
      mesh.castShadow = true;
      this.hairGroup.add(mesh);
      return mesh;
    };

    // A skull cap tilted back on the head: the front edge rides above the brow
    // so the forehead and eyes stay clear, while the back still covers the nape.
    const capGeo = shared('haircap', () =>
      new THREE.SphereGeometry(0.105, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.46));
    put(capGeo, 0, 0.05, -0.004, 1.02, 1.2, 1.1, -0.25);
    // hairline volume at the back of the skull, below the cap's rear edge
    put(ball(0.078, 12), 0, 0.022, -0.05, 1.0, 1.05, 0.8);
    for (const sx of [-1, 1]) put(capsule(0.021, 0.045), sx * 0.087, 0.048, -0.024, 0.85, 1, 1.2);

    if (style === 'long') {
      // Three tapered lengths instead of one wide slab: the silhouette gets
      // an edge and the shoulders stay readable underneath.
      const back = put(capsule(0.062, 0.2), 0, -0.055, -0.062, 1.18, 1, 0.7);
      back.rotation.x = -0.08;
      put(capsule(0.045, 0.12), 0, -0.17, -0.05, 1.0, 1, 0.62);
      for (const sx of [-1, 1]) {
        const s = put(capsule(0.033, 0.17), sx * 0.098, -0.05, -0.006, 0.85, 1, 0.9);
        s.rotation.z = sx * 0.07;
      }
      // fringe swept to one side
      const fr = put(capsule(0.028, 0.08), -0.035, 0.108, 0.08, 2.2, 1, 0.55);
      fr.rotation.set(0.35, 0, 0.5);
    } else if (style === 'bun') {
      put(ball(0.058, 12), 0, 0.118, -0.09, 1, 0.95, 1);
      put(tube(0.026, 0.03, 0.05, 10), 0, 0.075, -0.075);
      for (const sx of [-1, 1]) put(capsule(0.026, 0.06), sx * 0.088, 0.04, 0.03, 0.9, 1, 0.8);
      const fr = put(capsule(0.026, 0.075), -0.03, 0.106, 0.078, 2.0, 1, 0.55);
      fr.rotation.set(0.3, 0, 0.45);
    } else if (style === 'ponytail') {
      const tail = put(capsule(0.042, 0.22), 0, -0.03, -0.115, 0.9, 1, 0.85);
      tail.rotation.x = -0.35;
      put(tube(0.03, 0.034, 0.04, 10), 0, 0.06, -0.095);
      const fr = put(capsule(0.026, 0.08), -0.03, 0.107, 0.078, 2.0, 1, 0.55);
      fr.rotation.set(0.3, 0, 0.45);
    } else {
      // short: a swept fringe with a bit of thickness at the temples
      const fr = put(capsule(0.026, 0.09), -0.02, 0.105, 0.082, 2.1, 1, 0.6);
      fr.rotation.set(0.32, 0, 0.38);
      for (const sx of [-1, 1]) put(capsule(0.02, 0.05), sx * 0.104, 0.062, 0.012, 0.8, 1, 1.1);
      put(capsule(0.03, 0.05), 0, -0.02, -0.072, 1.5, 1, 0.5);
    }
    this._flush(this.hairGroup, 'hair:' + style);
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
    const structural = ['outfit', 'bottom', 'height']
      .some(k => look[k] !== undefined && look[k] !== this.look[k]);
    Object.assign(this.look, look);
    this.scaleY = this.look.height || 1;
    this.mats.skin.color.set(this.look.skin);
    this.mats.hair.color.set(this.look.hair);
    this.mats.shirt.color.set(this.look.shirt);
    this.mats.pants.color.set(this.look.pants);
    this.mats.shoes.color.set(this.look.shoes);
    this._shadeTrim();
    if (this.mats.eye.map !== TEX.irisTexture(this.look.eyes)) {
      this.mats.eye.map = TEX.irisTexture(this.look.eyes);
      this.mats.eye.needsUpdate = true;
    }
    if (structural) { this._rebuild(); return; }
    this._buildHair(this.look.hairStyle);
    if (this.look.hat) {
      this.mats.hat.color.set(this.look.hat);
      this._buildHat();
    } else if (this.hatGroup) {
      this.hatGroup.removeFromParent();
      this.hatGroup = null;
    }
  }

  /**
   * Turn the head toward a point in the world. A character that never looks at
   * anything reads as a mannequin; this is the cheapest fix there is.
   * Pass null to look straight ahead again.
   */
  lookAt(target, bodyYaw = 0) {
    if (!target) { this.gaze.yaw = 0; this.gaze.pitch = 0; return; }
    const r = this.root.position;
    const dx = target.x - r.x, dz = target.z - r.z;
    const dy = (target.y ?? r.y + 1.5) - (r.y + 1.55 * this.scaleY);
    const dist = Math.hypot(dx, dz);
    // Relative to where the body is already facing, and only as far as a neck
    // actually turns — beyond that the character just faces forward.
    let yaw = Math.atan2(dx, dz) - bodyYaw;
    while (yaw > Math.PI) yaw -= Math.PI * 2;
    while (yaw < -Math.PI) yaw += Math.PI * 2;
    const reach = clamp(1 - (Math.abs(yaw) - 1.1) / 0.5, 0, 1);
    this.gaze.yaw = clamp(yaw, -1.0, 1.0) * reach;
    this.gaze.pitch = clamp(Math.atan2(dy, Math.max(0.4, dist)), -0.45, 0.45) * reach;
  }

  /** -1 .. 1. Lifts the brows and the corners of the mouth. */
  setMood(v) { this.mood = clamp(v, -1, 1); }

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

    // hand-holding overrides one arm entirely: the hand has to stay where the
    // other person's hand is, so the locomotion swing on that side is replaced.
    if (st.hold) {
      const tag = st.hold < 0 ? 'L' : 'R';
      const sway = Math.sin(this.phase) * 0.12 * clamp(speed / 2.6, 0, 1);
      t['arm' + tag + 'U'].x = -0.10 + sway;
      t['arm' + tag + 'U'].y = 0;
      t['arm' + tag + 'U'].z = st.hold * 0.30;
      t['arm' + tag + 'L'].x = -0.20;
      t['arm' + tag + 'L'].y = 0;
      t['arm' + tag + 'L'].z = st.hold * 0.06;
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
    // Gaze is layered on after the pose blend: it should survive whatever the
    // locomotion is doing, and split across neck and head like a real turn.
    const gk = 1 - Math.exp(-dt * 7);
    this.gazeCurr.yaw += (this.gaze.yaw - this.gazeCurr.yaw) * gk;
    this.gazeCurr.pitch += (this.gaze.pitch - this.gazeCurr.pitch) * gk;
    if (this.j.head && this.j.neck) {
      this.j.head.rotation.y += this.gazeCurr.yaw * 0.68;
      this.j.head.rotation.x += this.gazeCurr.pitch * 0.7;
      this.j.neck.rotation.y += this.gazeCurr.yaw * 0.32;
      this.j.neck.rotation.x += this.gazeCurr.pitch * 0.3;
    }

    const o = this.currOffset;
    o.y += ((t.__y || 0) - o.y) * k;
    o.pitch += ((t.__pitch || 0) - o.pitch) * k;
    o.roll += ((t.__roll || 0) - o.roll) * k;
    this.body.position.y = o.y * this.scaleY;
    this.body.rotation.x = o.pitch;
    this.body.rotation.z = o.roll;

    // blink — the lids are half-spheres that swing down over the eyeballs
    this.blink -= dt;
    if (this.blink < -0.13) this.blink = 2.2 + Math.random() * 4;
    if (this.lids) {
      const closing = this.blink < 0 ? 1 - Math.abs(this.blink + 0.065) / 0.065 : 0;
      const a = -0.25 + clamp(closing, 0, 1) * 2.5;
      for (const lid of this.lids) lid.rotation.x = a;
    }
  }

  dispose() {
    // Capsule geometries are shared between every character, so only the
    // per-character materials are ours to release.
    this.root.removeFromParent();
    Object.values(this.mats).forEach(m => m.dispose());
  }
}
