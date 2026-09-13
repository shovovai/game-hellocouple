/**
 * animals.js — ambient wildlife: birds, butterflies and fish.
 *
 * Nothing here has real AI; they follow cheap analytic paths and are drawn with
 * instanced meshes, which is exactly enough to make the island feel alive.
 */

import * as THREE from 'three';
import { makeRng } from './noise.js';

function birdGeometry() {
  const body = new THREE.ConeGeometry(0.09, 0.46, 5);
  body.rotateX(Math.PI / 2);
  return body;
}

function wingGeometry() {
  const g = new THREE.PlaneGeometry(0.55, 0.2);
  g.rotateX(-Math.PI / 2);
  return g;
}

export class Wildlife {
  constructor(scene, terrain, quality) {
    this.scene = scene;
    this.terrain = terrain;
    this.quality = quality;
    this.group = new THREE.Group();
    this.group.name = 'wildlife';
    this.group.userData.dynamic = true;
    scene.add(this.group);
    this.rng = makeRng(777);
    this.time = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);

    const scale = quality.particles;

    /* ---- birds: lazy circles over the island ---- */
    this.birdCount = Math.max(6, Math.floor(26 * scale));
    this.birds = [];
    const birdMat = new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.8 });
    this.birdMesh = new THREE.InstancedMesh(birdGeometry(), birdMat, this.birdCount);
    this.wingMesh = new THREE.InstancedMesh(wingGeometry(), new THREE.MeshStandardMaterial({
      color: 0x4a5160, roughness: 0.85, side: THREE.DoubleSide,
    }), this.birdCount * 2);
    this.birdMesh.frustumCulled = false;
    this.wingMesh.frustumCulled = false;
    this.group.add(this.birdMesh, this.wingMesh);
    for (let i = 0; i < this.birdCount; i++) {
      this.birds.push({
        cx: (this.rng() - 0.5) * 420, cz: (this.rng() - 0.5) * 420,
        r: 16 + this.rng() * 46, y: 26 + this.rng() * 34,
        sp: 0.16 + this.rng() * 0.2, ph: this.rng() * 6.28, flap: this.rng() * 6.28,
      });
    }

    /* ---- butterflies ---- */
    this.flyCount = Math.max(0, Math.floor(40 * scale));
    this.flies = [];
    const flyGeo = new THREE.PlaneGeometry(0.22, 0.16);
    this.flyMesh = new THREE.InstancedMesh(flyGeo, new THREE.MeshStandardMaterial({
      color: 0xffd0e4, emissive: 0xff9ec8, emissiveIntensity: 0.25,
      roughness: 0.7, side: THREE.DoubleSide, transparent: true, opacity: 0.95,
    }), Math.max(1, this.flyCount));
    this.flyMesh.frustumCulled = false;
    this.group.add(this.flyMesh);

    /* ---- fish (visible under shallow water) ---- */
    this.fishCount = Math.max(0, Math.floor(34 * scale));
    this.fishes = [];
    const fishGeo = new THREE.ConeGeometry(0.14, 0.6, 5);
    fishGeo.rotateX(Math.PI / 2);
    this.fishMesh = new THREE.InstancedMesh(fishGeo, new THREE.MeshStandardMaterial({
      color: 0x9fd8d0, roughness: 0.35, metalness: 0.25,
    }), Math.max(1, this.fishCount));
    this.fishMesh.frustumCulled = false;
    this.group.add(this.fishMesh);
  }

  /** Butterflies sit near flower beds, fish near water. */
  seed(flowerSpots, waterSpots) {
    for (let i = 0; i < this.flyCount; i++) {
      const s = flowerSpots[(this.rng() * flowerSpots.length) | 0] || { x: 0, z: 0 };
      this.flies.push({
        cx: s.x + (this.rng() - 0.5) * 12, cz: s.z + (this.rng() - 0.5) * 12,
        r: 0.8 + this.rng() * 3, sp: 0.5 + this.rng() * 0.9, ph: this.rng() * 6.28,
        h: 0.6 + this.rng() * 1.4,
      });
    }
    for (let i = 0; i < this.fishCount; i++) {
      const s = waterSpots[(this.rng() * waterSpots.length) | 0] || { x: 0, z: 0, y: 0 };
      this.fishes.push({
        cx: s.x + (this.rng() - 0.5) * 14, cz: s.z + (this.rng() - 0.5) * 14,
        y: s.y - 0.5 - this.rng() * 1.2,
        r: 2 + this.rng() * 7, sp: 0.25 + this.rng() * 0.5, ph: this.rng() * 6.28,
      });
    }
  }

  update(dt, focus) {
    this.time += dt;
    const t = this.time;

    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i];
      const a = t * b.sp + b.ph;
      const x = b.cx + Math.cos(a) * b.r;
      const z = b.cz + Math.sin(a) * b.r;
      const y = b.y + Math.sin(a * 2.3) * 2.2;
      const heading = a + Math.PI / 2;
      this._e.set(0, heading, 0);
      this._q.setFromEuler(this._e);
      this._m.compose(this._p.set(x, y, z), this._q, this._s.set(1, 1, 1));
      this.birdMesh.setMatrixAt(i, this._m);
      const flap = Math.sin(t * 11 + b.flap) * 0.85;
      for (const side of [0, 1]) {
        const sx = side ? 1 : -1;
        this._e.set(0, heading, flap * sx);
        this._q.setFromEuler(this._e);
        this._m.compose(
          this._p.set(x + Math.cos(heading) * 0.22 * sx, y + Math.abs(flap) * 0.08, z - Math.sin(heading) * 0.22 * sx),
          this._q, this._s.set(1, 1, 1));
        this.wingMesh.setMatrixAt(i * 2 + side, this._m);
      }
    }
    this.birdMesh.instanceMatrix.needsUpdate = true;
    this.wingMesh.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < this.flies.length; i++) {
      const f = this.flies[i];
      const a = t * f.sp + f.ph;
      const x = f.cx + Math.cos(a) * f.r + Math.sin(a * 3.1) * 0.4;
      const z = f.cz + Math.sin(a * 1.3) * f.r;
      const gy = this.terrain.height(x, z);
      const y = gy + f.h + Math.sin(a * 4.2) * 0.28;
      const near = (x - focus.x) ** 2 + (z - focus.z) ** 2 < 6400;
      this._e.set(Math.sin(t * 16 + f.ph) * 0.9, a, 0);
      this._q.setFromEuler(this._e);
      this._m.compose(this._p.set(x, y, z), this._q, this._s.setScalar(near ? 1 : 0.0001));
      this.flyMesh.setMatrixAt(i, this._m);
    }
    if (this.flies.length) this.flyMesh.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < this.fishes.length; i++) {
      const f = this.fishes[i];
      const a = t * f.sp + f.ph;
      const x = f.cx + Math.cos(a) * f.r;
      const z = f.cz + Math.sin(a * 1.2) * f.r;
      this._e.set(0, a + Math.PI / 2, Math.sin(t * 4 + f.ph) * 0.2);
      this._q.setFromEuler(this._e);
      const near = (x - focus.x) ** 2 + (z - focus.z) ** 2 < 3600;
      this._m.compose(this._p.set(x, f.y + Math.sin(a * 2) * 0.2, z), this._q, this._s.setScalar(near ? 1 : 0.0001));
      this.fishMesh.setMatrixAt(i, this._m);
    }
    if (this.fishes.length) this.fishMesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.group.traverse(o => { if (o.isInstancedMesh) { o.geometry.dispose(); o.material.dispose(); } });
    this.scene.remove(this.group);
  }
}
