/**
 * vegetation.js — instanced trees, bushes, grass, flowers and rocks.
 *
 * Everything is drawn with InstancedMesh, bucketed into spatial cells so
 * frustum culling still works (one giant instanced mesh would always be
 * "visible" and would defeat culling entirely).
 *
 * Foliage and grass sway with a shared wind uniform injected into the standard
 * material shader.
 */

import * as THREE from 'three';
import { materials } from './materials.js';
import * as TEX from './textures.js';
import { mergeGeometries } from './batching.js';
import { makeRng, fbm } from './noise.js';

const CELL = 250;
const M = () => materials();

/* --------------------------------------------------------- wind shader */

export const windUniforms = { uTime: { value: 0 }, uWind: { value: 0.6 } };

function applyWind(mat, amount = 1, anchorBottom = true) {
  const m = mat.clone();
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWind = windUniforms.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform float uWind;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float h = ${anchorBottom ? 'max(transformed.y, 0.0)' : '1.0'};
          float ph = wp.x * 0.17 + wp.z * 0.13;
          float s = sin(uTime * 1.6 + ph) * 0.5 + sin(uTime * 2.7 + ph * 1.7) * 0.5;
          transformed.x += s * uWind * ${amount.toFixed(3)} * h * 0.06;
          transformed.z += cos(uTime * 1.3 + ph) * uWind * ${amount.toFixed(3)} * h * 0.045;
        }`);
  };
  m.customProgramCacheKey = () => 'wind' + amount + anchorBottom;
  return m;
}

/* -------------------------------------------------------- tree models */

function mergeParts(parts) {
  // parts: [{geo, matrix}] -> single geometry
  const geos = parts.map(p => {
    const g = (p.geo.index ? p.geo.toNonIndexed() : p.geo.clone());
    g.applyMatrix4(p.matrix);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    return g;
  });
  const out = mergeGeometries(geos);
  geos.forEach(g => g.dispose());
  return out;
}

/** Break up a primitive's silhouette so foliage does not read as a polyhedron. */
function roughen(geo, amount = 0.22, seed = 1) {
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = fbm(v.x * 0.9 + seed * 13, v.z * 0.9 - v.y * 0.7 + seed * 7, 3, seed);
    const f = 1 + n * amount;
    pos.setXYZ(i, v.x * f, v.y * (1 + n * amount * 0.6), v.z * f);
  }
  geo.computeVertexNormals();
  return geo;
}

const mat4 = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz));

/** Build {trunk, foliage} geometries for a tree type. */
function treeModel(type) {
  const rng = makeRng(type.length * 131 + 7);
  const trunk = [], leaf = [];

  if (type === 'pine') {
    trunk.push({ geo: new THREE.CylinderGeometry(0.34, 0.16, 7.5, 7), matrix: mat4(0, 3.75, 0) });
    for (let i = 0; i < 5; i++) {
      const y = 3.0 + i * 1.25;
      const r = 2.5 - i * 0.42;
      leaf.push({ geo: roughen(new THREE.ConeGeometry(r, 2.1, 9, 2), 0.13, i + 1), matrix: mat4(0, y, 0) });
    }
  } else if (type === 'oak') {
    trunk.push({ geo: new THREE.CylinderGeometry(0.48, 0.62, 4.2, 8), matrix: mat4(0, 2.1, 0) });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4;
      trunk.push({
        geo: new THREE.CylinderGeometry(0.16, 0.26, 2.4, 6),
        matrix: mat4(Math.cos(a) * 0.7, 4.1, Math.sin(a) * 0.7, Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5),
      });
    }
    const blobs = [[0, 5.6, 0, 2.5], [1.5, 5.1, 0.6, 1.7], [-1.4, 5.3, -0.7, 1.8], [0.3, 6.5, -1.2, 1.6], [-0.5, 6.3, 1.3, 1.5]];
    blobs.forEach(([x, y, z, r], i) => leaf.push({ geo: roughen(new THREE.IcosahedronGeometry(r, 1), 0.26, i + 3), matrix: mat4(x, y, z) }));
  } else if (type === 'palm') {
    let x = 0, y = 0, ang = 0;
    for (let i = 0; i < 8; i++) {
      ang += 0.055;
      const seg = new THREE.CylinderGeometry(0.3 - i * 0.02, 0.34 - i * 0.02, 1.1, 7);
      trunk.push({ geo: seg, matrix: mat4(x, y + 0.55, 0, 0, 0, -ang) });
      x += Math.sin(ang) * 1.05;
      y += Math.cos(ang) * 1.05;
    }
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const frond = new THREE.BoxGeometry(3.4, 0.07, 0.62);
      frond.translate(1.7, 0, 0);
      leaf.push({ geo: frond, matrix: mat4(x, y, 0, 0, a, -0.42 - rng() * 0.2) });
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      leaf.push({ geo: new THREE.SphereGeometry(0.2, 6, 5), matrix: mat4(x + Math.cos(a) * 0.35, y - 0.35, Math.sin(a) * 0.35) });
    }
  } else { // tropical
    trunk.push({ geo: new THREE.CylinderGeometry(0.3, 0.42, 5.2, 7), matrix: mat4(0, 2.6, 0) });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + rng();
      const leafGeo = new THREE.BoxGeometry(2.6, 0.1, 1.1);
      leafGeo.translate(1.3, 0, 0);
      leaf.push({ geo: leafGeo, matrix: mat4(0, 5.0 + rng() * 0.6, 0, 0, a, -0.25 - rng() * 0.3) });
    }
    leaf.push({ geo: roughen(new THREE.IcosahedronGeometry(1.5, 1), 0.24, 9), matrix: mat4(0, 5.4, 0) });
  }

  return { trunk: mergeParts(trunk), foliage: mergeParts(leaf) };
}

/**
 * A flower is two geometries, not one: merging the stem into the petals would
 * force both through a single material and turn every bloom into a pink
 * mushroom.
 */
function flowerModel() {
  const stem = mergeParts([
    { geo: new THREE.CylinderGeometry(0.012, 0.018, 0.34, 4), matrix: mat4(0, 0.17, 0) },
    { geo: new THREE.BoxGeometry(0.10, 0.012, 0.05), matrix: mat4(0.05, 0.14, 0, 0, 0.7, 0.3) },
    { geo: new THREE.BoxGeometry(0.09, 0.012, 0.05), matrix: mat4(-0.045, 0.21, 0.02, 0, -0.6, -0.3) },
  ]);
  const petalParts = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const p = new THREE.SphereGeometry(0.045, 5, 4);
    petalParts.push({
      geo: p,
      matrix: mat4(Math.cos(a) * 0.05, 0.35 + 0.012, Math.sin(a) * 0.05, 0.22, a, 0, 1.5, 0.45, 1),
    });
  }
  petalParts.push({ geo: new THREE.SphereGeometry(0.028, 5, 4), matrix: mat4(0, 0.36, 0) });
  return { stem, petals: mergeParts(petalParts) };
}

/**
 * Boulders. Per-vertex random noise produced spiky shards, so the shape comes
 * from coherent noise instead — bumpy but convex, which is what a rock looks
 * like.
 */
function rockModel(seed) {
  const geo = roughen(new THREE.IcosahedronGeometry(1, 1), 0.30, seed * 5 + 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i, pos.getX(i) * 1.15, pos.getY(i) * 0.78, pos.getZ(i) * (1 + (seed % 3) * 0.08));
  }
  geo.computeVertexNormals();
  return geo;
}

/* ------------------------------------------------------------ system */

/** Op and kind tables — the recording stores indices into these. */
const VEG_OPS = ['addTree', 'addBush', 'addFlower', 'addGrass', 'addReeds', 'addRock'];
const VEG_KINDS = ['', 'palm', 'pine', 'oak', 'tropical', 'rose', 'white', 'gold'];

export class Vegetation {
  constructor(scene, quality) {
    this.scene = scene;
    this.quality = quality;
    this.root = new THREE.Group();
    this.root.name = 'vegetation';
    scene.add(this.root);

    const m = M();
    this.models = {};
    for (const t of ['pine', 'oak', 'palm', 'tropical']) this.models[t] = treeModel(t);

    this.trunkMat = m.bark;
    this.foliageMats = {
      pine: applyWind(m.foliagePine, 0.5),
      oak: applyWind(m.foliageOak, 0.7),
      palm: applyWind(m.foliagePalm, 1.1),
      tropical: applyWind(m.foliageTrop, 0.9),
    };
    this.bushMat = applyWind(m.bush, 0.8);
    this.flowerMats = {
      rose: applyWind(m.petalRose, 1.4),
      white: applyWind(m.petalWhite, 1.4),
      gold: applyWind(m.petalGold, 1.4),
    };
    this.flowerModel = flowerModel();
    this.stemMat = applyWind(m.stem, 1.4);
    this.bushGeo = roughen(new THREE.IcosahedronGeometry(1, 1), 0.3, 17);
    this.rockGeos = [rockModel(1), rockModel(2), rockModel(3)];
    this.rockMat = M().rockFacet;
    this.grassGeo = this._grassGeo();
    this.grassMat = applyWind(new THREE.MeshStandardMaterial({
      map: TEX.grassBladeTexture(), transparent: true, alphaTest: 0.42,
      side: THREE.DoubleSide, roughness: 1.0, depthWrite: true,
    }), 2.4);
    this.reedMat = applyWind(new THREE.MeshStandardMaterial({ color: 0x7d9a53, roughness: 1 }), 2.0);
    this.reedGeo = (() => {
      const parts = [];
      const rng = makeRng(64);
      for (let i = 0; i < 7; i++) {
        const g = new THREE.CylinderGeometry(0.012, 0.035, 1.1 + rng() * 0.7, 4);
        const a = rng() * Math.PI * 2, r = rng() * 0.22;
        parts.push({ geo: g, matrix: mat4(Math.cos(a) * r, 0.55, Math.sin(a) * r,
          (rng() - 0.5) * 0.22, a, (rng() - 0.5) * 0.22) });
      }
      return mergeParts(parts);
    })();

    this._rng = makeRng(31337);
    /** buckets: key -> {geo, mat, matrices[], colors[], shadow} */
    this.buckets = new Map();
    this.stats = { trees: 0, bushes: 0, flowers: 0, grass: 0, rocks: 0 };
    this.colliders = [];
  }

  _grassGeo() {
    const a = new THREE.PlaneGeometry(0.8, 0.7);
    a.translate(0, 0.35, 0);
    const b = a.clone();
    b.rotateY(Math.PI / 2);
    const c = a.clone();
    c.rotateY(Math.PI / 4);
    return mergeGeometries([a, b, c].map(g => g.index ? g.toNonIndexed() : g));
  }

  _push(kind, geo, mat, matrix, x, z, shadow = true, tint = null) {
    if (this.mute) return;              // replaying a recording instead
    const key = `${kind}|${Math.floor(x / CELL)}|${Math.floor(z / CELL)}`;
    let b = this.buckets.get(key);
    if (!b) this.buckets.set(key, (b = { geo, mat, matrices: [], colors: [], shadow, tinted: false }));
    b.matrices.push(matrix);
    b.colors.push(tint);
    if (tint) b.tinted = true;
  }

  /**
   * Per-instance multiplier around white: a little lighter/darker and a little
   * warmer/cooler than its neighbour. The cheapest realism win there is — it
   * stops a forest from looking like one colour swatch repeated 900 times.
   */
  _tint(rng, spread = 0.18, warm = 0.06) {
    const b = 1 + (rng() - 0.5) * spread * 2;
    const w = (rng() - 0.5) * warm * 2;
    return new THREE.Color(
      Math.max(0.25, b * (1 + w)),
      Math.max(0.25, b * (1 + w * 0.25)),
      Math.max(0.25, b * (1 - w))
    );
  }

  addTree(type, x, y, z, scale = 1, ry = 0, tilt = 0) {
    this._note('addTree', type, x, y, z, scale, ry, tilt);
    const mdl = this.models[type] || this.models.oak;
    const mtx = mat4(x, y, z, tilt * 0.3, ry, tilt, scale, scale, scale);
    this._push('trunk:' + type, mdl.trunk, this.trunkMat, mtx, x, z, true,
      this._tint(this._rng, 0.14, 0.05));
    this._push('leaf:' + type, mdl.foliage, this.foliageMats[type] || this.foliageMats.oak, mtx, x, z, true,
      this._tint(this._rng, 0.22, 0.08));
    this.stats.trees++;
    const r = type === 'palm' ? 0.42 : type === 'pine' ? 0.42 : 0.62;
    this.colliders.push({ x, z, r: r * scale });
  }

  addBush(x, y, z, scale = 1, ry = 0) {
    this._note('addBush', '', x, y, z, scale, ry, 0);
    this._push('bush', this.bushGeo, this.bushMat,
      mat4(x, y + 0.26 * scale, z, 0, ry, 0, scale * 0.55, scale * 0.42, scale * 0.55), x, z, true,
      this._tint(this._rng, 0.22, 0.07));
    this.stats.bushes++;
  }

  addFlower(x, y, z, kind = 'rose', scale = 1, ry = 0) {
    this._note('addFlower', kind, x, y, z, scale, ry, 0);
    const m = mat4(x, y, z, 0, ry, 0, scale, scale, scale);
    this._push('stem', this.flowerModel.stem, this.stemMat, m, x, z, false,
      this._tint(this._rng, 0.16, 0.05));
    this._push('petal:' + kind, this.flowerModel.petals, this.flowerMats[kind], m, x, z, false,
      this._tint(this._rng, 0.2, 0.07));
    this.stats.flowers++;
  }

  addGrass(x, y, z, scale = 1, ry = 0) {
    this._note('addGrass', '', x, y, z, scale, ry, 0);
    this._push('grass', this.grassGeo, this.grassMat,
      mat4(x, y, z, 0, ry, 0, scale, scale * (0.8 + scale * 0.3), scale), x, z, false,
      this._tint(this._rng, 0.24, 0.08));
    this.stats.grass++;
  }

  addReeds(x, y, z, scale = 1, ry = 0) {
    this._note('addReeds', '', x, y, z, scale, ry, 0);
    this._push('reed', this.reedGeo, this.reedMat,
      mat4(x, y - 0.15 * scale, z, 0, ry, 0, scale, scale, scale), x, z, false,
      this._tint(this._rng, 0.2, 0.08));
  }

  addRock(x, y, z, scale = 1, ry = 0, variant = 0) {
    this._note('addRock', '', x, y, z, scale, ry, variant);
    const geo = this.rockGeos[variant % this.rockGeos.length];
    this._push('rock' + (variant % 3), geo, this.rockMat,
      mat4(x, y + scale * 0.16, z, 0, ry, 0, scale, scale * 0.8, scale), x, z, true,
      this._tint(this._rng, 0.18, 0.04));
    this.stats.rocks++;
    if (scale > 0.9) this.colliders.push({ x, z, r: scale * 0.85 });
  }

  /* ------------------------------------------------------------ replay */

  /**
   * Scattering vegetation is expensive because of what it rejects, not what it
   * places: every candidate costs a slope lookup, a path distance and a physics
   * probe, and most candidates are thrown away. The placements that survive are
   * a pure function of the island, so record them once and replay them on later
   * visits — same trees, same everything, without the search.
   */
  record() {
    this._log = { ops: [], args: [], kinds: [] };
  }

  /** Pack the recording into typed arrays for storage. */
  snapshot() {
    const l = this._log;
    if (!l || !l.ops.length) return null;
    const n = l.ops.length;
    const args = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) args.set(l.args[i], i * 6);
    return {
      ops: Uint8Array.from(l.ops),
      kinds: Uint8Array.from(l.kinds),
      args,
      table: VEG_KINDS,
    };
  }

  /** Re-run a recording. Returns false if it does not match this build. */
  replay(snap) {
    if (!snap?.ops?.length || snap.args?.length !== snap.ops.length * 6) return false;
    if ((snap.table || []).join(',') !== VEG_KINDS.join(',')) return false;
    // The muted build already counted everything it tried to place; the replay
    // is the real placement, so start the tally again.
    this.stats = { trees: 0, bushes: 0, flowers: 0, grass: 0, rocks: 0 };
    this.colliders.length = 0;
    const { ops, kinds, args } = snap;
    for (let i = 0; i < ops.length; i++) {
      const o = i * 6;
      const k = VEG_KINDS[kinds[i]];
      switch (VEG_OPS[ops[i]]) {
        case 'addTree': this.addTree(k, args[o], args[o + 1], args[o + 2], args[o + 3], args[o + 4], args[o + 5]); break;
        case 'addBush': this.addBush(args[o], args[o + 1], args[o + 2], args[o + 3], args[o + 4]); break;
        case 'addFlower': this.addFlower(args[o], args[o + 1], args[o + 2], k, args[o + 3], args[o + 4]); break;
        case 'addGrass': this.addGrass(args[o], args[o + 1], args[o + 2], args[o + 3], args[o + 4]); break;
        case 'addReeds': this.addReeds(args[o], args[o + 1], args[o + 2], args[o + 3], args[o + 4]); break;
        case 'addRock': this.addRock(args[o], args[o + 1], args[o + 2], args[o + 3], args[o + 4], args[o + 5]); break;
        default: return false;
      }
    }
    return true;
  }

  _note(op, kind, a, b, c, d, e, f) {
    const l = this._log;
    if (!l) return;
    l.ops.push(VEG_OPS.indexOf(op));
    let ki = VEG_KINDS.indexOf(kind);
    if (ki < 0) ki = 0;
    l.kinds.push(ki);
    l.args.push([a || 0, b || 0, c || 0, d || 0, e || 0, f || 0]);
  }

  /** Turn the accumulated matrices into InstancedMeshes. */
  finalize() {
    for (const [key, b] of this.buckets) {
      if (!b.matrices.length) continue;
      const inst = new THREE.InstancedMesh(b.geo, b.mat, b.matrices.length);
      for (let i = 0; i < b.matrices.length; i++) inst.setMatrixAt(i, b.matrices[i]);
      inst.instanceMatrix.needsUpdate = true;
      if (b.tinted) {
        for (let i = 0; i < b.colors.length; i++) {
          if (b.colors[i]) inst.setColorAt(i, b.colors[i]);
        }
        if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      }
      inst.castShadow = b.shadow;
      inst.receiveShadow = true;
      inst.name = key;
      inst.frustumCulled = true;
      inst.computeBoundingSphere?.();
      this.root.add(inst);
    }
    this.buckets.clear();
    return this.stats;
  }

  setWind(v) { windUniforms.uWind.value = v; }
  update(dt) { windUniforms.uTime.value += dt; }

  dispose() {
    this.root.traverse(o => { if (o.isInstancedMesh) o.dispose(); });
    this.scene.remove(this.root);
  }
}
