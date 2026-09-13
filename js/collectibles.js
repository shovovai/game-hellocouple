/**
 * collectibles.js — pickups scattered across the island.
 *
 * One InstancedMesh per type keeps hundreds of spinning pickups at five draw
 * calls. Collected items are scaled to zero rather than rebuilt, so picking
 * something up never allocates.
 */

import * as THREE from 'three';
import { COLLECTIBLES } from './config.js';
import * as TEX from './textures.js';

function heartGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, -0.42);
  s.bezierCurveTo(0.62, 0.14, 0.38, 0.62, 0, 0.32);
  s.bezierCurveTo(-0.38, 0.62, -0.62, 0.14, 0, -0.42);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.22, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.05, bevelSegments: 2, curveSegments: 8 });
  g.center();
  g.scale(0.55, 0.55, 0.55);
  return g;
}

function starGeometry() {
  const s = new THREE.Shape();
  const outer = 0.5, inner = 0.21;
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 1 });
  g.center();
  g.scale(0.8, 0.8, 0.8);
  return g;
}

function shellGeometry() {
  const g = new THREE.SphereGeometry(0.24, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.55);
  g.scale(1, 0.75, 1);
  g.rotateX(Math.PI);
  return g;
}

function flowerGeometry() {
  const parts = [];
  const petal = new THREE.SphereGeometry(0.13, 7, 5);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const p = petal.clone();
    p.scale(1, 0.5, 1);
    p.translate(Math.cos(a) * 0.14, 0, Math.sin(a) * 0.14);
    parts.push(p);
  }
  const mid = new THREE.SphereGeometry(0.085, 7, 6);
  parts.push(mid);
  const merged = mergeSimple(parts);
  parts.forEach(p => p.dispose());
  return merged;
}

function mergeSimple(geos) {
  let total = 0;
  const list = geos.map(g => (g.index ? g.toNonIndexed() : g));
  for (const g of list) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3), uv = new Float32Array(total * 2);
  let o = 0;
  for (const g of list) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array.subarray(0, c * 3), o * 3);
    if (g.attributes.normal) nrm.set(g.attributes.normal.array.subarray(0, c * 3), o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array.subarray(0, c * 2), o * 2);
    o += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

function coinGeometry() {
  const g = new THREE.CylinderGeometry(0.26, 0.26, 0.07, 14);
  g.rotateX(Math.PI / 2);
  return g;
}

const GEOS = {
  heart: heartGeometry,
  star: starGeometry,
  shell: shellGeometry,
  flower: flowerGeometry,
  coin: coinGeometry,
};

export class CollectibleField {
  constructor(scene, save) {
    this.scene = scene;
    this.save = save;
    this.group = new THREE.Group();
    this.group.name = 'collectibles';
    this.group.userData.dynamic = true;
    scene.add(this.group);
    this.items = [];
    this.byType = new Map();
    this.onCollect = null;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._zero = new THREE.Vector3(0, 0, 0);
    this.sparkles = null;
  }

  build(spots) {
    const byType = new Map();
    spots.forEach((s, i) => {
      const id = 'c' + i;
      const item = {
        id, index: i, type: s.type, x: s.x, y: s.y + (s.type === 'shell' ? 0.22 : 0.85),
        z: s.z, hidden: !!s.hidden, taken: this.save.isCollected(id), phase: (i * 1.7) % 6.28,
      };
      this.items.push(item);
      if (!byType.has(s.type)) byType.set(s.type, []);
      byType.get(s.type).push(item);
    });

    for (const [type, list] of byType) {
      const def = COLLECTIBLES[type] || COLLECTIBLES.coin;
      const geo = (GEOS[type] || GEOS.coin)();
      const mat = new THREE.MeshStandardMaterial({
        color: def.color,
        emissive: def.color,
        emissiveIntensity: type === 'star' ? 0.75 : 0.32,
        roughness: type === 'coin' ? 0.28 : 0.55,
        metalness: type === 'coin' ? 0.85 : 0.1,
      });
      const inst = new THREE.InstancedMesh(geo, mat, list.length);
      inst.castShadow = false;
      inst.receiveShadow = false;
      inst.frustumCulled = false;
      inst.userData.dynamic = true;
      this.group.add(inst);
      list.forEach((it, k) => { it.slot = k; it.mesh = inst; });
      this.byType.set(type, { inst, list, mat });
    }

    // soft glow sprite on every uncollected item
    const glowMat = new THREE.SpriteMaterial({
      map: TEX.glowTexture('pickup', 'rgba(255,240,210,0.85)', 'rgba(255,200,160,0)'),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5,
    });
    this.glowMat = glowMat;
    this.refresh();
  }

  /** Rewrite every instance matrix (after load / reset). */
  refresh() {
    for (const { inst, list } of this.byType.values()) {
      for (const it of list) this._write(it, 0);
      inst.instanceMatrix.needsUpdate = true;
    }
  }

  _write(it, time) {
    const taken = it.taken;
    if (taken) {
      this._m.compose(this._p.set(it.x, -9999, it.z), this._q.identity(), this._zero);
    } else {
      const bob = Math.sin(time * 1.8 + it.phase) * 0.13;
      this._q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), time * 1.1 + it.phase);
      const sc = it.type === 'star' ? 1.25 : 1;
      this._m.compose(this._p.set(it.x, it.y + bob, it.z), this._q, this._s.set(sc, sc, sc));
    }
    it.mesh.setMatrixAt(it.slot, this._m);
  }

  update(dt, time, playerPos, radius = 1.7) {
    let collected = null;
    for (const { inst, list } of this.byType.values()) {
      let dirty = false;
      for (const it of list) {
        if (it.taken) continue;
        const dx = it.x - playerPos.x, dz = it.z - playerPos.z, dy = it.y - playerPos.y;
        const d2 = dx * dx + dz * dz;
        if (d2 < radius * radius && Math.abs(dy) < 3.0) {
          it.taken = true;
          collected = it;
          this.save.collect(it.id);
        }
        if (d2 < 6400) { this._write(it, time); dirty = true; }
      }
      if (dirty) inst.instanceMatrix.needsUpdate = true;
    }
    if (collected && this.onCollect) this.onCollect(collected);
    return collected;
  }

  /** How many of each type remain uncollected (for the collection screen). */
  remaining() {
    const out = {};
    for (const it of this.items) if (!it.taken) out[it.type] = (out[it.type] || 0) + 1;
    return out;
  }

  total() {
    const out = {};
    for (const it of this.items) out[it.type] = (out[it.type] || 0) + 1;
    return out;
  }

  resetAll() {
    for (const it of this.items) it.taken = false;
    this.refresh();
  }

  dispose() {
    for (const { inst, mat } of this.byType.values()) { inst.geometry.dispose(); mat.dispose(); }
    this.scene.remove(this.group);
  }
}
