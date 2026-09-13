/**
 * props.js — procedural prop library (furniture, lighting, vehicles, details).
 *
 * Every builder returns a THREE.Group positioned around its own origin with
 * Y = 0 at ground level. Collider descriptors are attached as
 * `group.userData.cols` in LOCAL space; world.js converts them to world space
 * and registers them with the physics grid:
 *   {k:'c', x, z, r, h?}                cylinder
 *   {k:'b', x, z, w, d, rot?, h?}       box
 *   {k:'p', x, z, w, d, y, rot?}        walkable platform
 */

import * as THREE from 'three';
import { materials } from './materials.js';
import * as TEX from './textures.js';
import { makeRng } from './noise.js';

/* --------------------------------------------------------- primitives */

const UNIT = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 14, 1),
  cyl8: new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1),
  cone: new THREE.ConeGeometry(0.5, 1, 12, 1),
  sph: new THREE.SphereGeometry(0.5, 14, 10),
  sphLow: new THREE.SphereGeometry(0.5, 8, 6),
  plane: new THREE.PlaneGeometry(1, 1),
  torus: new THREE.TorusGeometry(0.4, 0.1, 8, 18),
};
// These live for the whole session and are reused by every world build, so
// teardown must leave them alone.
Object.values(UNIT).forEach(g => { g.userData.shared = true; });

function tileUV(geo, sx, sy) {
  const uv = geo.attributes.uv;
  if (!uv) return geo;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy);
  uv.needsUpdate = true;
  return geo;
}

/** Box. Textured materials get world-scaled UVs so tiling stays consistent. */
export function B(mat, w, h, d, x = 0, y = 0, z = 0, ry = 0) {
  let geo = UNIT.box;
  if (mat.map) geo = tileUV(UNIT.box.clone(), Math.max(w, d) / 2.2, Math.max(h, d) / 2.2);
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** Cylinder (r1 bottom radius, r2 top radius). */
export function C(mat, r1, h, x = 0, y = 0, z = 0, r2 = r1, seg = 12) {
  const geo = new THREE.CylinderGeometry(r1, r2, h, seg, 1);
  if (mat.map) tileUV(geo, Math.max(1, r1 * 3), Math.max(1, h / 2));
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

export function S(mat, r, x = 0, y = 0, z = 0, low = false) {
  const m = new THREE.Mesh(low ? UNIT.sphLow : UNIT.sph, mat);
  m.scale.setScalar(r * 2);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

export function Cone(mat, r, h, x = 0, y = 0, z = 0, seg = 12) {
  const geo = new THREE.ConeGeometry(r, h, seg, 1);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

export function Plane(mat, w, h, x = 0, y = 0, z = 0, rx = -Math.PI / 2, ry = 0) {
  const m = new THREE.Mesh(UNIT.plane, mat);
  m.scale.set(w, h, 1);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, 0);
  m.receiveShadow = true;
  return m;
}

export function grp(x = 0, y = 0, z = 0, ry = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;
  g.userData.cols = [];
  return g;
}

const M = () => materials();

/* --------------------------------------------------------- seating */

export function makeBench(len = 2.0) {
  const m = M(), g = grp();
  g.add(B(m.plank, len, 0.09, 0.46, 0, 0.46, 0));
  g.add(B(m.plank, len, 0.42, 0.08, 0, 0.70, -0.20));
  g.add(B(m.plank, len, 0.06, 0.08, 0, 0.90, -0.22));
  for (const sx of [-1, 1]) {
    const x = sx * (len / 2 - 0.14);
    g.add(B(m.metal, 0.07, 0.46, 0.07, x, 0.23, 0.16));
    g.add(B(m.metal, 0.07, 0.46, 0.07, x, 0.23, -0.16));
    g.add(B(m.metal, 0.06, 0.5, 0.06, x, 0.70, -0.22));
  }
  g.userData.cols.push({ k: 'b', x: 0, z: 0, w: len, d: 0.5, h: 0.9 });
  g.userData.seat = { x: 0, y: 0.52, z: 0.06 };
  return g;
}

export function makeChair(matSeat = null) {
  const m = M(), g = grp();
  const s = matSeat || m.woodPale;
  g.add(B(s, 0.44, 0.06, 0.44, 0, 0.45, 0));
  g.add(B(s, 0.44, 0.5, 0.05, 0, 0.72, -0.20));
  for (const [dx, dz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]])
    g.add(B(m.woodDark, 0.05, 0.45, 0.05, dx, 0.225, dz));
  g.userData.cols.push({ k: 'c', x: 0, z: 0, r: 0.3 });
  g.userData.seat = { x: 0, y: 0.47, z: 0.02 };
  return g;
}

export function makeTable(w = 1.0, d = 1.0, h = 0.75, round = false) {
  const m = M(), g = grp();
  if (round) {
    g.add(C(m.woodPale, w / 2, 0.06, 0, h, 0));
    g.add(C(m.metal, 0.06, h, 0, h / 2, 0));
    g.add(C(m.metal, w / 3.2, 0.05, 0, 0.03, 0));
  } else {
    g.add(B(m.woodPale, w, 0.07, d, 0, h, 0));
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
      g.add(B(m.woodDark, 0.07, h, 0.07, dx * (w / 2 - 0.09), h / 2, dz * (d / 2 - 0.09)));
  }
  g.userData.cols.push({ k: 'c', x: 0, z: 0, r: Math.max(w, d) * 0.42 });
  return g;
}

export function makePicnicTable() {
  const m = M(), g = grp();
  g.add(B(m.plank, 1.9, 0.08, 0.9, 0, 0.76, 0));
  for (const sz of [-1, 1]) {
    g.add(B(m.plank, 1.9, 0.07, 0.32, 0, 0.46, sz * 0.78));
    for (const sx of [-1, 1]) {
      g.add(B(m.woodDark, 0.09, 0.78, 0.09, sx * 0.8, 0.39, sz * 0.36));
      g.add(B(m.woodDark, 0.07, 0.46, 0.07, sx * 0.8, 0.23, sz * 0.78));
    }
  }
  g.userData.cols.push({ k: 'b', x: 0, z: 0, w: 2.0, d: 1.9, h: 0.85 });
  g.userData.seat = { x: 0, y: 0.5, z: 0.78 };
  return g;
}

export function makeBeachChair(color = null) {
  const m = M(), g = grp();
  const fab = color || m.fabricSun;
  const seat = B(fab, 0.62, 0.05, 0.8, 0, 0.34, 0);
  seat.rotation.x = -0.14;
  g.add(seat);
  const back = B(fab, 0.62, 0.05, 0.76, 0, 0.62, -0.5);
  back.rotation.x = -0.95;
  g.add(back);
  for (const sx of [-1, 1]) {
    g.add(B(m.plankWorn, 0.05, 0.34, 0.05, sx * 0.28, 0.17, 0.3));
    g.add(B(m.plankWorn, 0.05, 0.28, 0.05, sx * 0.28, 0.14, -0.28));
  }
  g.userData.cols.push({ k: 'c', x: 0, z: 0, r: 0.42 });
  g.userData.seat = { x: 0, y: 0.42, z: -0.05 };
  return g;
}

export function makeSofa(w = 2.0) {
  const m = M(), g = grp();
  g.add(B(m.fabricBlue, w, 0.42, 0.9, 0, 0.24, 0));
  g.add(B(m.fabricBlue, w, 0.55, 0.22, 0, 0.66, -0.36));
  for (const sx of [-1, 1]) g.add(B(m.fabricBlue, 0.22, 0.5, 0.9, sx * (w / 2 - 0.11), 0.5, 0));
  for (const sx of [-1, 1]) g.add(B(m.fabricCream, w * 0.3, 0.28, 0.14, sx * w * 0.22, 0.62, -0.2));
  g.userData.cols.push({ k: 'b', x: 0, z: 0, w, d: 0.95, h: 0.8 });
  g.userData.seat = { x: 0, y: 0.48, z: 0.05 };
  return g;
}

export function makeBed() {
  const m = M(), g = grp();
  g.add(B(m.woodDark, 1.5, 0.3, 2.1, 0, 0.2, 0));
  g.add(B(m.fabricCream, 1.46, 0.22, 2.0, 0, 0.45, 0));
  g.add(B(m.fabricRose, 1.46, 0.1, 1.2, 0, 0.58, 0.4));
  g.add(B(m.white, 0.6, 0.14, 0.34, -0.36, 0.62, -0.8));
  g.add(B(m.white, 0.6, 0.14, 0.34, 0.36, 0.62, -0.8));
  g.add(B(m.woodDark, 1.5, 0.7, 0.08, 0, 0.55, -1.06));
  g.userData.cols.push({ k: 'b', x: 0, z: 0, w: 1.6, d: 2.2, h: 0.7 });
  return g;
}

/* --------------------------------------------------------- lighting */

export function makeStreetLamp(h = 4.4) {
  const m = M(), g = grp();
  g.add(C(m.metal, 0.16, 0.3, 0, 0.15, 0, 0.2, 10));
  g.add(C(m.metal, 0.08, h, 0, h / 2, 0, 0.065, 8));
  const head = grp(0, h, 0);
  head.add(C(m.metal, 0.26, 0.1, 0, 0.06, 0, 0.2, 10));
  const glass = C(m.lampGlass, 0.2, 0.34, 0, -0.13, 0, 0.24, 10);
  glass.castShadow = false;
  head.add(glass);
  head.add(C(m.metal, 0.1, 0.1, 0, 0.14, 0, 0.02, 8));
  g.add(head);
  g.userData.cols.push({ k: 'c', x: 0, z: 0, r: 0.2 });
  g.userData.light = { x: 0, y: h - 0.2, z: 0, color: 0xffc987, intensity: 1.5, distance: 16 };
  return g;
}

export function makeLantern(h = 2.4) {
  const m = M(), g = grp();
  g.add(C(m.woodDark, 0.07, h, 0, h / 2, 0, 0.06, 6));
  const box = B(m.lanternGlow, 0.22, 0.3, 0.22, 0, h - 0.2, 0);
  box.castShadow = false;
  g.add(box);
  g.add(B(m.metal, 0.26, 0.04, 0.26, 0, h - 0.03, 0));
  g.userData.cols.push({ k: 'c', x: 0, z: 0, r: 0.12 });
  g.userData.light = { x: 0, y: h - 0.2, z: 0, color: 0xffb457, intensity: 0.9, distance: 9 };
  return g;
}

export function makeIndoorLamp() {
  const m = M(), g = grp();
  g.add(C(m.woodDark, 0.14, 0.04, 0, 0.02, 0));
  g.add(C(m.metal, 0.03, 1.2, 0, 0.6, 0, 0.03, 6));
  const shade = C(m.lampGlass, 0.26, 0.3, 0, 1.32, 0, 0.16, 10);
  shade.castShadow = false;
  g.add(shade);
  g.userData.light = { x: 0, y: 1.3, z: 0, color: 0xffd9a0, intensity: 0.8, distance: 8 };
  return g;
}

export function makeCampfire() {
  const m = M(), g = grp();
  const rng = makeRng(12);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    g.add(S(m.stone, 0.16 + rng() * 0.08, Math.cos(a) * 0.62, 0.08, Math.sin(a) * 0.62, true));
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const log = C(m.woodDark, 0.07, 0.85, Math.cos(a) * 0.16, 0.3, Math.sin(a) * 0.16, 0.05, 6);
    log.rotation.set(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5);
    g.add(log);
  }
  // Flames are animated, so they are excluded from static batching.
  const flames = grp(0, 0.28, 0);
  flames.userData.dynamic = true;
  for (let i = 0; i < 5; i++) {
    const f = Cone(m.fire, 0.17 - i * 0.02, 0.5 + i * 0.1, (rng() - 0.5) * 0.16, 0.22 + i * 0.05, (rng() - 0.5) * 0.16, 7);
    f.castShadow = false;
    f.userData.phase = rng() * 6.28;
    flames.add(f);
  }
  g.add(flames);
  g.userData.flames = flames;
  g.userData.cols.push({ k: 'c', x: 0, z: 0, r: 0.75 });
  g.userData.light = { x: 0, y: 0.7, z: 0, color: 0xff8a3a, intensity: 2.6, distance: 15, fire: true };
  return g;
}

/* ----------------------------------------------------------- details */

export function makeTrashBin() {
  const m = M(), g = grp();
  g.add(C(m.metal, 0.26, 0.8, 0, 0.4, 0, 0.22, 10));
  g.add(C(m.dark, 0.28, 0.06, 0, 0.83, 0, 0.28, 10));
  g.userData.cols.push({ k: 'c', x: 0, z: 0, r: 0.3 });
  return g;
}

export function makeMailbox() {
  const m = M(), g = grp();
  g.add(C(m.woodDark, 0.06, 1.1, 0, 0.55, 0, 0.06, 6));
  g.add(B(m.accentRose, 0.26, 0.24, 0.44, 0, 1.2, 0));
  const dome = C(m.accentRose, 0.13, 0.44, 0, 1.32, 0, 0.13, 10);
  dome.rotation.z = Math.PI / 2;
  g.add(dome);
  g.userData.cols.push({ k: 'c', x: 0, z: 0, r: 0.2 });
  return g;
}

export function makePlanter(w = 1.0) {
  const m = M(), g = grp();
  g.add(B(m.terracotta, w, 0.44, 0.5, 0, 0.22, 0));
  g.add(B(m.dark, w - 0.1, 0.06, 0.42, 0, 0.44, 0));
  const rng = makeRng(w * 100);
  for (let i = 0; i < 7; i++) {
    const px = (rng() - 0.5) * (w - 0.2);
    const pz = (rng() - 0.5) * 0.34;
    g.add(S(m.bush, 0.13 + rng() * 0.09, px, 0.52 + rng() * 0.1, pz, true));
    if (rng() > 0.5) g.add(S(m.petalRose, 0.06, px + 0.05, 0.64, pz, true));
  }
  g.userData.cols.push({ k: 'b', x: 0, z: 0, w, d: 0.55, h: 0.6 });
  return g;
}

export function makeFence(len = 4, posts = 5) {
  const m = M(), g = grp();
  // Posts run well below the origin so a fence on a slope stays planted.
  for (let i = 0; i < posts; i++) {
    const x = -len / 2 + (len / (posts - 1)) * i;
    g.add(B(m.woodPale, 0.1, 1.7, 0.1, x, 0.42, 0));
  }
  g.add(B(m.woodPale, len, 0.07, 0.05, 0, 0.92, 0));
  g.add(B(m.woodPale, len, 0.07, 0.05, 0, 0.56, 0));
  g.userData.cols.push({ k: 'b', x: 0, z: 0, w: len, d: 0.22, h: 1.1 });
  return g;
}

export function makeRailing(len = 4, h = 1.05, mat = null) {
  const m = M(), g = grp();
  const mm = mat || m.woodDark;
  const n = Math.max(2, Math.round(len / 1.1));
  for (let i = 0; i <= n; i++) {
    const x = -len / 2 + (len / n) * i;
    g.add(B(mm, 0.08, h + 0.3, 0.08, x, h / 2 - 0.15, 0));
  }
  g.add(B(mm, len, 0.08, 0.1, 0, h, 0));
  g.add(B(mm, len, 0.05, 0.06, 0, h * 0.55, 0));
  return g;
}

export function makeSignPost(lines, w = 1.6) {
  const m = M(), g = grp();
  g.add(C(m.woodDark, 0.09, 2.4, 0, 1.2, 0, 0.09, 8));
  const tex = TEX.signTexture('sign:' + lines.join('|'), lines);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(w, w * 0.45, 0.08), [
    m.woodDark, m.woodDark, m.woodDark, m.woodDark, mat, m.woodDark,
  ]);
  board.position.set(0, 2.05, 0.06);
  board.castShadow = true;
  board.userData.dynamic = true; // multi-material: keep out of the batcher
  g.add(board);
  g.userData.cols.push({ k: 'c', x: 0, z: 0, r: 0.2 });
  return g;
}

export function makeFlagPole(h = 6) {
  const m = M(), g = grp();
  g.add(C(m.metalLight, 0.1, h, 0, h / 2, 0, 0.07, 8));
  const flag = B(m.accentRose, 1.3, 0.8, 0.03, 0.68, h - 0.6, 0);
  flag.userData.dynamic = true;
  g.add(flag);
  g.userData.flag = flag;
  g.userData.cols.push({ k: 'c', x: 0, z: 0, r: 0.2 });
  return g;
}

export function makeUmbrella(color = null, h = 2.5) {
  const m = M(), g = grp();
  g.add(C(m.metalLight, 0.05, h, 0, h / 2, 0, 0.05, 8));
  const canopy = Cone(color || m.fabricRed, 1.55, 0.6, 0, h - 0.1, 0, 12);
  canopy.receiveShadow = true;
  g.add(canopy);
  g.add(S(m.metalLight, 0.07, 0, h + 0.18, 0, true));
  g.userData.cols.push({ k: 'c', x: 0, z: 0, r: 0.14 });
  return g;
}

export function makeTowel(color = null) {
  const m = M(), g = grp();
  const t = B(color || m.fabricRose, 1.1, 0.04, 1.9, 0, 0.03, 0);
  t.castShadow = false;
  g.add(t);
  g.add(B(m.fabricCream, 0.9, 0.02, 1.6, 0, 0.055, 0));
  return g;
}

export function makeBeachBall() {
  const m = M(), g = grp();
  g.add(S(m.white, 0.24, 0, 0.24, 0));
  g.add(S(m.accentRose, 0.2, 0.08, 0.26, 0.08, true));
  g.userData.cols.push({ k: 'c', x: 0, z: 0, r: 0.24 });
  return g;
}

export function makeSurfboard() {
  const m = M(), g = grp();
  const b = C(m.accentTeal, 0.34, 2.3, 0, 1.15, 0, 0.1, 10);
  b.scale.set(1, 1, 0.22);
  b.rotation.z = 0.16;
  g.add(b);
  g.userData.cols.push({ k: 'c', x: 0, z: 0, r: 0.4 });
  return g;
}

export function makeRug(w = 2.4, d = 1.6, mat = null) {
  const m = M(), g = grp();
  const r = B(mat || m.fabricRose, w, 0.03, d, 0, 0.02, 0);
  r.castShadow = false;
  g.add(r);
  g.add(B(m.fabricCream, w - 0.25, 0.035, d - 0.25, 0, 0.03, 0));
  return g;
}

export function makeBlanket() {
  const m = M(), g = grp();
  const b = B(m.fabricRed, 2.6, 0.04, 2.2, 0, 0.03, 0);
  b.castShadow = false;
  g.add(b);
  g.add(B(m.fabricCream, 2.2, 0.05, 1.8, 0, 0.045, 0));
  return g;
}

export function makeBasket() {
  const m = M(), g = grp();
  g.add(C(m.woodPale, 0.32, 0.3, 0, 0.15, 0, 0.28, 10));
  g.add(new THREE.Mesh(UNIT.torus, m.woodDark).translateY(0.36));
  const handle = g.children[g.children.length - 1];
  handle.scale.setScalar(0.72);
  handle.rotation.x = Math.PI / 2;
  g.add(B(m.fabricCream, 0.5, 0.06, 0.5, 0, 0.32, 0));
  g.userData.cols.push({ k: 'c', x: 0, z: 0, r: 0.35 });
  return g;
}

export function makeShelf() {
  const m = M(), g = grp();
  g.add(B(m.woodDark, 1.4, 1.8, 0.32, 0, 0.9, 0));
  for (let i = 0; i < 3; i++) g.add(B(m.woodPale, 1.3, 0.05, 0.3, 0, 0.45 + i * 0.45, 0.02));
  const rng = makeRng(3);
  for (let i = 0; i < 9; i++) {
    const shelf = i % 3;
    g.add(B(rng() > 0.5 ? m.accentRose : m.accentTeal, 0.1, 0.24, 0.16,
      -0.5 + rng() * 1.0, 0.6 + shelf * 0.45, 0.04));
  }
  g.userData.cols.push({ k: 'b', x: 0, z: 0, w: 1.45, d: 0.4, h: 1.9 });
  return g;
}

export function makeKitchen() {
  const m = M(), g = grp();
  g.add(B(m.plasterWhite, 2.6, 0.88, 0.64, 0, 0.44, 0));
  g.add(B(m.stoneLight, 2.68, 0.07, 0.7, 0, 0.91, 0));
  g.add(B(m.metalWhite, 0.5, 0.05, 0.4, -0.7, 0.93, 0));
  g.add(C(m.metalLight, 0.03, 0.36, -0.7, 1.1, -0.2, 0.03, 8));
  g.add(B(m.dark, 0.6, 0.03, 0.44, 0.7, 0.94, 0));
  g.add(B(m.woodDark, 2.4, 0.5, 0.3, 0, 1.75, -0.16));
  g.userData.cols.push({ k: 'b', x: 0, z: 0, w: 2.7, d: 0.7, h: 1.0 });
  return g;
}

/* ------------------------------------------------------------- café */

export function makeCounter(len = 3.2) {
  const m = M(), g = grp();
  g.add(B(m.woodDark, len, 1.05, 0.7, 0, 0.52, 0));
  g.add(B(m.stoneLight, len + 0.12, 0.08, 0.82, 0, 1.08, 0));
  g.add(B(m.accentRose, len - 0.2, 0.12, 0.04, 0, 0.4, 0.36));
  g.userData.cols.push({ k: 'b', x: 0, z: 0, w: len + 0.14, d: 0.84, h: 1.1 });
  return g;
}

export function makeCoffeeMachine() {
  const m = M(), g = grp();
  g.add(B(m.metalLight, 0.7, 0.5, 0.44, 0, 0.25, 0));
  g.add(B(m.dark, 0.7, 0.12, 0.44, 0, 0.56, 0));
  g.add(C(m.metal, 0.05, 0.2, -0.18, 0.12, 0.2, 0.05, 8));
  g.add(C(m.metal, 0.05, 0.2, 0.18, 0.12, 0.2, 0.05, 8));
  g.add(B(m.accentRose, 0.12, 0.06, 0.06, 0.28, 0.4, 0.2));
  return g;
}

export function makeCup(color = 0xffffff) {
  const m = M(), g = grp();
  const cup = C(m.ceramic, 0.05, 0.09, 0, 0.045, 0, 0.042, 10);
  g.add(cup);
  const liquid = new THREE.Mesh(UNIT.cyl, new THREE.MeshStandardMaterial({ color, roughness: 0.35 }));
  liquid.scale.set(0.085, 0.01, 0.085);
  liquid.position.y = 0.082;
  g.add(liquid);
  g.add(C(m.ceramic, 0.06, 0.012, 0, 0.006, 0, 0.06, 10));
  return g;
}

export function makeMenuBoard() {
  const m = M(), g = grp();
  const mat = new THREE.MeshStandardMaterial({ map: TEX.menuBoardTexture(), roughness: 0.9 });
  g.add(B(m.woodDark, 1.3, 1.5, 0.08, 0, 0.75, 0));
  const face = Plane(mat, 1.15, 1.35, 0, 0.75, 0.05, 0, 0);
  face.rotation.set(0, 0, 0);
  g.add(face);
  return g;
}

/* ---------------------------------------------------------- outdoors */

export function makeFountain(r = 3.2) {
  const m = M(), g = grp();
  g.add(C(m.stoneLight, r, 0.6, 0, 0.3, 0, r, 24));
  g.add(C(m.stone, r - 0.35, 0.5, 0, 0.42, 0, r - 0.35, 24));
  const water = C(m.accentTeal, r - 0.45, 0.06, 0, 0.6, 0, r - 0.45, 24);
  water.material = new THREE.MeshStandardMaterial({
    color: 0x6fc2c8, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.8,
  });
  water.userData.dynamic = true;
  water.castShadow = false;
  g.add(water);
  g.userData.water = water;
  g.add(C(m.stoneLight, 0.55, 1.1, 0, 0.55, 0, 0.4, 14));
  g.add(C(m.stoneLight, 1.1, 0.16, 0, 1.15, 0, 1.1, 16));
  g.add(C(m.stoneLight, 0.26, 0.9, 0, 1.6, 0, 0.16, 12));
  g.add(S(m.stoneLight, 0.26, 0, 2.1, 0));
  // jets
  const jets = grp(0, 0, 0);
  jets.userData.dynamic = true;
  const jetMat = new THREE.MeshBasicMaterial({ color: 0xcfeef0, transparent: true, opacity: 0.5 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const j = new THREE.Mesh(UNIT.cyl, jetMat);
    j.scale.set(0.05, 1.0, 0.05);
    j.position.set(Math.cos(a) * 0.5, 1.7, Math.sin(a) * 0.5);
    j.rotation.z = Math.cos(a) * 0.4;
    j.rotation.x = -Math.sin(a) * 0.4;
    jets.add(j);
  }
  g.add(jets);
  g.userData.jets = jets;
  g.userData.cols.push({ k: 'c', x: 0, z: 0, r: r + 0.15 });
  return g;
}

export function makeTelescope() {
  const m = M(), g = grp();
  g.add(C(m.metal, 0.28, 0.12, 0, 0.06, 0, 0.3, 12));
  g.add(C(m.metal, 0.07, 1.1, 0, 0.6, 0, 0.07, 10));
  const body = C(m.metalLight, 0.13, 0.9, 0, 1.25, 0.06, 0.09, 12);
  body.rotation.x = -0.55;
  g.add(body);
  g.add(C(m.gold, 0.07, 0.16, 0, 1.62, 0.3, 0.07, 10));
  g.userData.cols.push({ k: 'c', x: 0, z: 0, r: 0.35 });
  return g;
}

export function makeChest(open = false) {
  const m = M(), g = grp();
  g.add(B(m.woodDark, 0.9, 0.5, 0.6, 0, 0.25, 0));
  g.add(B(m.gold, 0.94, 0.06, 0.08, 0, 0.3, 0));
  const lid = grp(0, 0.5, -0.3);
  lid.userData.dynamic = true;
  const l = B(m.woodDark, 0.9, 0.18, 0.6, 0, 0.09, 0.3);
  lid.add(l);
  lid.add(B(m.gold, 0.94, 0.05, 0.08, 0, 0.18, 0.3));
  if (open) lid.rotation.x = -1.9;
  g.add(lid);
  g.userData.lid = lid;
  g.add(B(m.gold, 0.16, 0.16, 0.05, 0, 0.36, 0.31));
  g.userData.cols.push({ k: 'b', x: 0, z: 0, w: 0.95, d: 0.65, h: 0.7 });
  return g;
}

export function makeCrystalCluster(scale = 1) {
  const m = M(), g = grp();
  const rng = makeRng(91);
  for (let i = 0; i < 7; i++) {
    const a = rng() * Math.PI * 2;
    const r = rng() * 0.5 * scale;
    const h = (0.5 + rng() * 1.1) * scale;
    const c = Cone(m.crystal, 0.13 * scale, h, Math.cos(a) * r, h / 2, Math.sin(a) * r, 6);
    c.rotation.set((rng() - 0.5) * 0.5, rng() * 3, (rng() - 0.5) * 0.5);
    c.castShadow = false;
    g.add(c);
  }
  g.userData.light = { x: 0, y: 0.8 * scale, z: 0, color: 0x8f6fff, intensity: 1.2, distance: 9 };
  return g;
}

/* --------------------------------------------------------- vehicles */

export function makeCar(color = null) {
  const m = M(), g = grp();
  const body = color || m.accentTeal;
  g.add(B(body, 1.9, 0.55, 4.2, 0, 0.72, 0));
  g.add(B(body, 1.75, 0.5, 2.2, 0, 1.22, -0.15));
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x2a3642, roughness: 0.1, metalness: 0.4 });
  g.add(B(glassMat, 1.66, 0.4, 2.05, 0, 1.26, -0.15));
  g.add(B(m.metalWhite, 0.28, 0.12, 0.1, -0.68, 0.8, 2.06));
  g.add(B(m.metalWhite, 0.28, 0.12, 0.1, 0.68, 0.8, 2.06));
  g.add(B(m.accentRose, 0.3, 0.1, 0.08, -0.68, 0.8, -2.06));
  g.add(B(m.accentRose, 0.3, 0.1, 0.08, 0.68, 0.8, -2.06));
  for (const [dx, dz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const w = C(m.rubber, 0.36, 0.24, dx * 0.9, 0.36, dz * 1.35, 0.36, 12);
    w.rotation.z = Math.PI / 2;
    g.add(w);
  }
  g.userData.cols.push({ k: 'b', x: 0, z: 0, w: 2.0, d: 4.3, h: 1.6 });
  return g;
}

export function makeScooter() {
  const m = M(), g = grp();
  g.add(B(m.accentRose, 0.4, 0.4, 1.2, 0, 0.62, -0.1));
  g.add(B(m.dark, 0.34, 0.12, 0.5, 0, 0.86, -0.4));
  g.add(C(m.metalLight, 0.04, 0.9, 0, 0.85, 0.45, 0.04, 8));
  g.add(B(m.metalLight, 0.6, 0.05, 0.06, 0, 1.28, 0.45));
  for (const dz of [0.55, -0.62]) {
    const w = C(m.rubber, 0.27, 0.12, 0, 0.27, dz, 0.27, 12);
    w.rotation.z = Math.PI / 2;
    g.add(w);
  }
  g.userData.cols.push({ k: 'c', x: 0, z: 0, r: 0.6 });
  return g;
}

export function makeBicycle() {
  const m = M(), g = grp();
  for (const dz of [0.58, -0.58]) {
    const w = new THREE.Mesh(UNIT.torus, m.rubber);
    w.scale.setScalar(0.82);
    w.position.set(0, 0.34, dz);
    w.rotation.y = Math.PI / 2;
    g.add(w);
  }
  g.add(C(m.accentTeal, 0.03, 1.1, 0, 0.55, 0, 0.03, 6).rotateX(Math.PI / 2));
  g.add(C(m.accentTeal, 0.03, 0.7, 0, 0.6, -0.3, 0.03, 6));
  g.add(C(m.metalLight, 0.03, 0.7, 0, 0.7, 0.5, 0.03, 6));
  g.add(B(m.leather, 0.12, 0.06, 0.26, 0, 0.95, -0.35));
  g.add(B(m.metalLight, 0.5, 0.04, 0.04, 0, 1.0, 0.52));
  g.userData.cols.push({ k: 'c', x: 0, z: 0, r: 0.5 });
  return g;
}

export function makeBoat(color = null) {
  const m = M(), g = grp();
  const hullMat = color || m.plankWorn;
  // hull: tapered stack of boxes
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    const w = 1.5 - t * 0.25;
    const len = 3.6 - t * 0.2;
    g.add(B(hullMat, w, 0.14, len, 0, 0.12 + i * 0.12, 0));
  }
  g.add(B(hullMat, 1.2, 0.5, 0.12, 0, 0.45, -1.75));
  g.add(B(hullMat, 0.8, 0.5, 0.12, 0, 0.45, 1.78));
  g.add(B(m.plank, 1.1, 0.06, 0.3, 0, 0.62, -0.6));
  g.add(B(m.plank, 1.1, 0.06, 0.3, 0, 0.62, 0.7));
  g.add(C(m.woodDark, 0.05, 1.6, 0.45, 0.75, 0.2, 0.04, 6).rotateZ(0.5));
  g.userData.cols.push({ k: 'b', x: 0, z: 0, w: 1.7, d: 3.8, h: 1.0 });
  g.userData.seat = { x: 0, y: 0.72, z: 0.7 };
  return g;
}

/* -------------------------------------------------------- playground */

export function makePlayground() {
  const m = M(), g = grp();
  // slide
  g.add(B(m.metalLight, 1.2, 0.1, 1.2, -2, 1.6, 0));
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
    g.add(B(m.metal, 0.1, 1.6, 0.1, -2 + dx * 0.5, 0.8, dz * 0.5));
  const slide = B(m.accentTeal, 1.0, 0.08, 3.2, -2, 0.95, 1.9);
  slide.rotation.x = 0.45;
  g.add(slide);
  for (const sx of [-1, 1]) {
    const rail = B(m.metalLight, 0.06, 0.4, 3.2, -2 + sx * 0.5, 1.15, 1.9);
    rail.rotation.x = 0.45;
    g.add(rail);
  }
  // swing
  g.add(B(m.woodDark, 0.14, 2.2, 0.14, 2.0, 1.1, -1.1));
  g.add(B(m.woodDark, 0.14, 2.2, 0.14, 2.0, 1.1, 1.1));
  g.add(B(m.woodDark, 0.14, 0.14, 2.5, 2.0, 2.2, 0));
  for (const dz of [-0.5, 0.5]) {
    const sw = grp(2.0, 2.15, dz);
    sw.userData.dynamic = true;
    sw.add(C(m.metalLight, 0.02, 1.3, -0.25, -0.65, 0, 0.02, 5));
    sw.add(C(m.metalLight, 0.02, 1.3, 0.25, -0.65, 0, 0.02, 5));
    sw.add(B(m.plank, 0.6, 0.05, 0.22, 0, -1.3, 0));
    g.add(sw);
    (g.userData.swings ||= []).push(sw);
  }
  g.userData.cols.push({ k: 'b', x: -2, z: 0, w: 1.4, d: 1.4, h: 1.7 });
  g.userData.cols.push({ k: 'b', x: 2, z: -1.1, w: 0.3, d: 0.3, h: 2.2 });
  g.userData.cols.push({ k: 'b', x: 2, z: 1.1, w: 0.3, d: 0.3, h: 2.2 });
  g.userData.cols.push({ k: 'p', x: -2, z: 0, w: 1.2, d: 1.2, y: 1.65 });
  return g;
}

export function makeTent(color = null) {
  const m = M(), g = grp();
  const fab = color || m.fabricGreen;
  const geo = new THREE.CylinderGeometry(1.5, 1.5, 3.0, 3, 1, true);
  const body = new THREE.Mesh(geo, fab);
  body.rotation.z = Math.PI / 2;
  body.rotation.y = Math.PI / 2;
  body.position.y = 0.76;
  body.castShadow = true; body.receiveShadow = true;
  g.add(body);
  const capGeo = new THREE.CircleGeometry(1.5, 3);
  for (const sz of [-1, 1]) {
    const cap = new THREE.Mesh(capGeo, sz > 0 ? m.dark : fab);
    cap.position.set(0, 0.76, sz * 1.5);
    cap.rotation.z = Math.PI / 6 * (sz > 0 ? 1 : -1);
    if (sz < 0) cap.rotation.y = Math.PI;
    cap.castShadow = true;
    g.add(cap);
  }
  g.userData.cols.push({ k: 'b', x: 0, z: 0, w: 2.6, d: 3.0, h: 2.0 });
  return g;
}

export function makeSleepingBag(color = null) {
  const m = M(), g = grp();
  const b = C(color || m.fabricBlue, 0.32, 1.9, 0, 0.3, 0, 0.28, 10);
  b.rotation.x = Math.PI / 2;
  g.add(b);
  g.add(S(m.fabricCream, 0.2, 0, 0.34, -0.8, true));
  return g;
}

export function makeLogSeat(len = 2.2) {
  const m = M(), g = grp();
  const l = C(m.bark, 0.3, len, 0, 0.3, 0, 0.28, 10);
  l.rotation.z = Math.PI / 2;
  g.add(l);
  g.userData.cols.push({ k: 'b', x: 0, z: 0, w: len, d: 0.6, h: 0.6 });
  g.userData.seat = { x: 0, y: 0.6, z: 0 };
  return g;
}

export function makeFishingSpot() {
  const m = M(), g = grp();
  g.add(C(m.woodDark, 0.04, 2.4, 0, 0.9, 0, 0.02, 6).rotateX(-0.5));
  g.add(B(m.woodPale, 0.5, 0.3, 0.4, 0.4, 0.15, 0.2));
  g.add(B(m.accentTeal, 0.36, 0.24, 0.3, -0.45, 0.12, 0.1));
  g.userData.cols.push({ k: 'c', x: 0, z: 0, r: 0.4 });
  return g;
}

export function makeShellProp(kind = 0) {
  const m = M(), g = grp();
  if (kind === 0) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6, 0, Math.PI), m.accentCream);
    s.rotation.x = -Math.PI / 2;
    s.position.y = 0.03;
    g.add(s);
  } else {
    g.add(Cone(m.accentCream, 0.09, 0.26, 0, 0.1, 0, 8));
  }
  return g;
}

export { UNIT };
