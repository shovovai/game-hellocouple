/**
 * buildings.js — architecture: houses, shops, the café, the lighthouse,
 * piers, bridges, decks and interior rooms.
 *
 * Same contract as props.js: builders return a Group with Y=0 at the ground
 * and local collider descriptors in `userData.cols`.
 */

import * as THREE from 'three';
import { materials } from './materials.js';
import * as TEX from './textures.js';
import { B, C, S, Cone, Plane, grp } from './props.js';
import * as P from './props.js';
import { makeRng } from './noise.js';

const M = () => materials();

/**
 * Window on a wall face, facing +Z.
 *
 * The pane is pushed *into* the wall and surrounded by a frame that stands
 * proud of it, so the opening reads as a hole with depth rather than a sticker.
 * A projecting sill and a lintel above finish it; shutters are optional.
 */
function windowPane(w = 1.0, h = 1.2, x = 0, y = 1.4, z = 0, ry = 0, o = {}) {
  const m = M(), g = grp(x, y, z, ry);
  const { shutters = false, sill = true, frame = m.white, muntins = true } = o;
  const reveal = 0.1;
  // glazing, recessed
  g.add(B(m.windowLit, w, h, 0.05, 0, 0, -reveal));
  // reveal sides, in shadow
  g.add(B(frame, 0.05, h + 0.1, reveal, -w / 2 - 0.02, 0, -reveal / 2));
  g.add(B(frame, 0.05, h + 0.1, reveal, w / 2 + 0.02, 0, -reveal / 2));
  g.add(B(frame, w + 0.1, 0.05, reveal, 0, h / 2 + 0.02, -reveal / 2));
  // frame, proud of the wall
  g.add(B(frame, w + 0.14, 0.08, 0.07, 0, h / 2 + 0.03, 0.015));
  g.add(B(frame, 0.08, h + 0.14, 0.07, -w / 2 - 0.03, 0, 0.015));
  g.add(B(frame, 0.08, h + 0.14, 0.07, w / 2 + 0.03, 0, 0.015));
  if (muntins) {
    g.add(B(frame, 0.045, h, 0.05, 0, 0, -reveal + 0.04));
    g.add(B(frame, w, 0.04, 0.05, 0, h * 0.12, -reveal + 0.04));
  }
  if (sill) {
    // a sill that oversails the wall is the single clearest "real building" cue
    g.add(B(m.stoneLight, w + 0.3, 0.07, 0.22, 0, -h / 2 - 0.06, 0.06));
    g.add(B(m.stoneLight, w + 0.2, 0.05, 0.1, 0, -h / 2 - 0.12, 0.02));
  }
  if (shutters) {
    for (const sx of [-1, 1]) {
      const sh = B(shutters === true ? m.woodDark : shutters, w * 0.5, h * 0.98, 0.05,
        sx * (w / 2 + w * 0.26 + 0.05), 0, 0.06);
      g.add(sh);
      for (let i = 0; i < 3; i++) {
        g.add(B(m.dark, w * 0.44, 0.02, 0.02,
          sx * (w / 2 + w * 0.26 + 0.05), -h * 0.3 + i * h * 0.3, 0.09));
      }
    }
  }
  return g;
}

function doorPanel(w = 1.0, h = 2.1, mat = null) {
  const m = M(), g = grp();
  const door = mat || m.woodDark;
  // recessed leaf inside a proud casing
  g.add(B(door, w, h, 0.08, 0, h / 2, -0.05));
  for (const sy of [0.3, 0.68]) {
    g.add(B(m.dark, w * 0.62, h * 0.28, 0.02, 0, h * sy, -0.008));
  }
  g.add(B(m.white, 0.09, h + 0.1, 0.12, -w / 2 - 0.045, h / 2, 0.02));
  g.add(B(m.white, 0.09, h + 0.1, 0.12, w / 2 + 0.045, h / 2, 0.02));
  g.add(B(m.white, w + 0.28, 0.12, 0.14, 0, h + 0.06, 0.02));
  g.add(B(m.gold, 0.07, 0.07, 0.07, w / 2 - 0.16, h * 0.5, 0.0));
  g.add(B(m.gold, 0.16, 0.04, 0.03, 0, h * 0.62, 0.0));          // letter slot
  g.add(B(m.stoneLight, w + 0.5, 0.12, 0.5, 0, 0.06, 0.2));      // step
  return g;
}

/** Fascia board, gutter and a downpipe — the trim that makes a roof land. */
function eaves(w, d, y, mat, overhang = 0.35) {
  const m = M(), g = grp();
  for (const sz of [-1, 1]) {
    g.add(B(mat, w + overhang * 2, 0.16, 0.09, 0, y, sz * (d / 2 + overhang)));
    const gut = C(m.metalWhite, 0.055, w + overhang * 2, 0, y - 0.12, sz * (d / 2 + overhang + 0.02), 0.055, 8);
    gut.rotation.z = Math.PI / 2;
    g.add(gut);
  }
  for (const sx of [-1, 1]) {
    const pipe = C(m.metalWhite, 0.045, y - 0.1, sx * (w / 2 + overhang - 0.12), (y - 0.1) / 2,
      -(d / 2 + overhang - 0.02), 0.045, 8);
    g.add(pipe);
  }
  return g;
}

/** Gable roof made of two slabs. */
function gableRoof(w, d, h, mat, overhang = 0.35) {
  const g = grp();
  const slope = Math.atan2(h, d / 2 + overhang);
  const len = Math.hypot(h, d / 2 + overhang);
  for (const sz of [-1, 1]) {
    const s = B(mat, w + overhang * 2, 0.16, len * 2 * 0.5 + 0.1, 0, h / 2, sz * (d / 4 + overhang / 2));
    s.rotation.x = -sz * slope;
    g.add(s);
  }
  return { group: g, ridge: h };
}

/** Triangular gable end wall. */
function gableEnd(w, h, mat, z, flip = false) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0); shape.lineTo(w / 2, 0); shape.lineTo(0, h); shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: false });
  geo.translate(0, 0, -0.09);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.z = z;
  mesh.castShadow = true; mesh.receiveShadow = true;
  if (flip) mesh.rotation.y = Math.PI;
  return mesh;
}

/**
 * Generic building.
 * @param {object} o w,d,h, style, wall, roofMat, windows, door, sign
 */
export function makeHouse(o = {}) {
  const m = M();
  const {
    w = 7, d = 6, h = 3.2,
    style = 'cottage',
    wall = m.plasterCream,
    roofMat = m.roof,
    roofH = 2.0,
    porch = false,
    balcony = false,
    chimney = false,
    seed = 1,
  } = o;
  const g = grp();
  const rng = makeRng(seed * 37 + 11);
  const t = 0.22;                                  // wall thickness

  // walls (front wall split around the door)
  const doorW = 1.2;
  g.add(B(wall, w, h, t, 0, h / 2, d / 2));                                  // back (+Z)
  g.add(B(wall, (w - doorW) / 2, h, t, -(w + doorW) / 4, h / 2, -d / 2));    // front left
  g.add(B(wall, (w - doorW) / 2, h, t, (w + doorW) / 4, h / 2, -d / 2));     // front right
  g.add(B(wall, doorW + 0.1, h - 2.25, t, 0, h - (h - 2.25) / 2, -d / 2));   // lintel
  g.add(B(wall, t, h, d, -w / 2, h / 2, 0));
  g.add(B(wall, t, h, d, w / 2, h / 2, 0));
  g.add(B(m.stoneLight, w + 0.3, 0.35, d + 0.3, 0, 0.17, 0));                // plinth

  const door = doorPanel(doorW, 2.1, style === 'modern' ? m.dark : m.woodDark);
  door.position.set(0, 0, -d / 2 - 0.03);
  g.add(door);
  g.userData.doorAt = { x: 0, z: -d / 2 - 1.6 };

  // windows
  const wy = h * 0.52;
  const cols = Math.max(1, Math.floor(w / 2.6));
  for (let i = 0; i < cols; i++) {
    const x = -w / 2 + (w / (cols + 1)) * (i + 1);
    if (Math.abs(x) > doorW * 0.9) {
      g.add(windowPane(1.0, 1.2, x, wy, -d / 2 - 0.06, 0, { shutters: style !== 'modern' }));
    }
    g.add(windowPane(1.0, 1.2, x, wy, d / 2 + 0.06, Math.PI, { shutters: style !== 'modern' }));
  }
  const rows = Math.max(1, Math.floor(d / 2.8));
  for (let i = 0; i < rows; i++) {
    const z = -d / 2 + (d / (rows + 1)) * (i + 1);
    g.add(windowPane(0.9, 1.1, -w / 2 - 0.06, wy, z, -Math.PI / 2));
    g.add(windowPane(0.9, 1.1, w / 2 + 0.06, wy, z, Math.PI / 2));
  }

  // roof
  if (style === 'modern') {
    g.add(B(m.concrete, w + 0.5, 0.24, d + 0.5, 0, h + 0.12, 0));
    g.add(B(wall, w * 0.55, 1.9, d * 0.55, w * 0.12, h + 1.1, 0));
    g.add(B(m.concrete, w * 0.6, 0.2, d * 0.6, w * 0.12, h + 2.1, 0));
    if (balcony) {
      g.add(B(m.concrete, w * 0.8, 0.18, 1.6, 0, h + 0.2, -d / 2 - 0.7));
      const rail = P.makeRailing(w * 0.8, 0.95, m.metalLight);
      rail.position.set(0, h + 0.29, -d / 2 - 1.45);
      g.add(rail);
      g.userData.cols.push({ k: 'p', x: 0, z: -d / 2 - 0.7, w: w * 0.8, d: 1.6, y: h + 0.3 });
    }
  } else {
    const r = gableRoof(w, d, roofH, roofMat);
    r.group.position.y = h;
    g.add(r.group);
    g.add(gableEnd(w + 0.04, roofH, wall, d / 2 - 0.02));
    g.add(gableEnd(w + 0.04, roofH, wall, -d / 2 - 0.16, true));
    // ridge cap, barge boards and the gutter line
    const ridge = C(roofMat, 0.13, w + 0.75, 0, h + roofH + 0.03, 0, 0.13, 6);
    ridge.rotation.z = Math.PI / 2;
    g.add(ridge);
    for (const sz of [-1, 1]) {
      const barge = B(m.white, w + 0.8, 0.13, 0.1, 0, h + roofH / 2, sz * (d / 4 + 0.2));
      barge.rotation.x = -sz * Math.atan2(roofH, d / 2 + 0.35);
      g.add(barge);
    }
    g.add(eaves(w, d, h + 0.02, m.white));
  }
  // corner boards give the walls an edge instead of a paper fold
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(B(m.white, 0.16, h - 0.3, 0.16, sx * (w / 2 - 0.02), (h - 0.3) / 2 + 0.2, sz * (d / 2 - 0.02)));
  }

  if (chimney) {
    g.add(B(m.brick, 0.7, roofH + 1.4, 0.7, w * 0.28, h + roofH * 0.4, d * 0.2));
    const cy = h + roofH * 0.4 + (roofH + 1.4) / 2;
    g.add(B(m.stone, 0.85, 0.16, 0.85, w * 0.28, cy, d * 0.2));
    for (const sx of [-1, 1]) {
      g.add(C(m.stone, 0.12, 0.3, w * 0.28 + sx * 0.16, cy + 0.22, d * 0.2, 0.14, 8));
    }
  }

  if (porch) {
    const pd = 1.8;
    g.add(B(m.plank, w * 0.8, 0.16, pd, 0, 0.32, -d / 2 - pd / 2));
    for (const sx of [-1, 1]) g.add(B(m.woodPale, 0.16, 2.5, 0.16, sx * (w * 0.36), 1.4, -d / 2 - pd + 0.2));
    const cover = B(roofMat, w * 0.86, 0.14, pd + 0.4, 0, 2.72, -d / 2 - pd / 2);
    cover.rotation.x = -0.12;
    g.add(cover);
    g.userData.cols.push({ k: 'p', x: 0, z: -d / 2 - pd / 2, w: w * 0.8, d: pd, y: 0.4 });
    g.userData.doorAt = { x: 0, z: -d / 2 - pd - 0.8 };
  }

  // collider: leave the doorway open so enterable houses feel right
  g.userData.cols.push({ k: 'b', x: 0, z: d / 2, w, d: t + 0.2, h });
  g.userData.cols.push({ k: 'b', x: -(w + doorW) / 4, z: -d / 2, w: (w - doorW) / 2, d: t + 0.2, h });
  g.userData.cols.push({ k: 'b', x: (w + doorW) / 4, z: -d / 2, w: (w - doorW) / 2, d: t + 0.2, h });
  g.userData.cols.push({ k: 'b', x: -w / 2, z: 0, w: t + 0.2, d, h });
  g.userData.cols.push({ k: 'b', x: w / 2, z: 0, w: t + 0.2, d, h });
  return g;
}

export function makeCabin(seed = 1) {
  const m = M();
  const g = makeHouse({
    w: 6, d: 5, h: 2.9, style: 'cabin', wall: m.wood, roofMat: m.roofSlate,
    roofH: 1.9, porch: true, chimney: true, seed,
  });
  // log detailing
  for (let i = 0; i < 5; i++) {
    const y = 0.5 + i * 0.55;
    for (const sz of [-1, 1]) {
      const log = C(m.bark, 0.14, 6.1, 0, y, sz * 2.5, 0.14, 8);
      log.rotation.z = Math.PI / 2;
      g.add(log);
    }
  }
  return g;
}

export function makeShop(name = 'SHOP', color = null) {
  const m = M(), g = grp();
  const w = 7.5, d = 6, h = 4.0;
  const wall = color || m.plasterBlue;
  g.add(B(wall, w, h, 0.22, 0, h / 2, d / 2));
  g.add(B(wall, 0.22, h, d, -w / 2, h / 2, 0));
  g.add(B(wall, 0.22, h, d, w / 2, h / 2, 0));
  // shopfront: big glazing + door
  g.add(B(wall, w, 1.2, 0.22, 0, h - 0.6, -d / 2));
  g.add(B(wall, 0.9, h, 0.22, -w / 2 + 0.45, h / 2, -d / 2));
  g.add(B(wall, 0.9, h, 0.22, w / 2 - 0.45, h / 2, -d / 2));
  const glass = B(m.glass, w - 2.6, 2.6, 0.08, -0.7, 1.5, -d / 2 - 0.02);
  glass.castShadow = false;
  g.add(glass);
  const door = doorPanel(1.1, 2.3, m.woodDark);
  door.position.set(w / 2 - 1.5, 0, -d / 2 - 0.05);
  g.add(door);
  // awning
  const aw = B(m.fabricRed, w - 0.6, 0.12, 1.5, 0, h - 1.25, -d / 2 - 0.75);
  aw.rotation.x = 0.22;
  g.add(aw);
  for (let i = 0; i < 6; i++) {
    const st = B(m.fabricCream, (w - 0.6) / 12, 0.13, 1.5, -w / 2 + 0.6 + i * ((w - 0.6) / 6), h - 1.25, -d / 2 - 0.75);
    st.rotation.x = 0.22;
    g.add(st);
  }
  // sign
  const tex = TEX.signTexture('shopsign:' + name, [name], '#2a2f3a', '#ffd9a0');
  g.add(Plane(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }), w - 2, 0.85, 0, h - 0.55, -d / 2 - 0.14, 0, Math.PI));
  g.add(B(m.roofSlate, w + 0.4, 0.3, d + 0.4, 0, h + 0.15, 0));
  g.userData.cols.push({ k: 'b', x: 0, z: 0, w: w + 0.2, d: d + 0.2, h });
  return g;
}

/** The HelloCouple Café — the most detailed exterior in the game. */
export function makeCafe() {
  const m = M(), g = grp();
  const w = 11, d = 8.5, h = 4.2;
  const wall = m.plasterRose;

  g.add(B(m.stoneLight, w + 0.6, 0.4, d + 0.6, 0, 0.2, 0));
  g.add(B(wall, w, h, 0.24, 0, h / 2, d / 2));
  g.add(B(wall, 0.24, h, d, -w / 2, h / 2, 0));
  g.add(B(wall, 0.24, h, d, w / 2, h / 2, 0));
  // glazed front with a central door
  g.add(B(wall, w, 1.0, 0.24, 0, h - 0.5, -d / 2));
  g.add(B(wall, 1.0, h, 0.24, -w / 2 + 0.5, h / 2, -d / 2));
  g.add(B(wall, 1.0, h, 0.24, w / 2 - 0.5, h / 2, -d / 2));
  for (const sx of [-1, 1]) {
    const glass = B(m.glass, 3.4, 3.0, 0.08, sx * 3.0, 1.7, -d / 2 - 0.02);
    glass.castShadow = false;
    g.add(glass);
    g.add(B(m.white, 0.12, 3.0, 0.12, sx * 3.0, 1.7, -d / 2 - 0.06));
    g.add(B(m.white, 3.5, 0.12, 0.12, sx * 3.0, 3.2, -d / 2 - 0.06));
  }
  const door = doorPanel(1.4, 2.5, m.woodDark);
  door.position.set(0, 0, -d / 2 - 0.06);
  g.add(door);
  g.add(B(m.glass, 1.0, 1.4, 0.05, 0, 1.6, -d / 2 - 0.12));

  // awning + terrace
  const aw = B(m.fabricRose, w - 0.4, 0.14, 2.2, 0, h - 1.1, -d / 2 - 1.1);
  aw.rotation.x = 0.2;
  g.add(aw);
  for (let i = 0; i < 8; i++) {
    const st = B(m.fabricCream, 0.55, 0.15, 2.2, -w / 2 + 0.9 + i * 1.3, h - 1.1, -d / 2 - 1.1);
    st.rotation.x = 0.2;
    g.add(st);
  }
  for (const sx of [-1, 1]) g.add(C(m.metalLight, 0.06, 2.6, sx * (w / 2 - 0.5), 1.3, -d / 2 - 2.1, 0.06, 8));

  // roof + parapet + chimney flue
  g.add(B(m.roofSlate, w + 0.8, 0.34, d + 0.8, 0, h + 0.17, 0));
  g.add(B(wall, w + 0.8, 0.5, 0.24, 0, h + 0.55, -d / 2 - 0.28));
  g.add(C(m.metal, 0.22, 1.2, w * 0.3, h + 0.8, d * 0.2, 0.22, 10));

  // sign board
  const tex = TEX.signTexture('cafesign', ['HelloCouple', 'CAFÉ'], '#3a2028', '#ffd9e2');
  const signMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: 0xff7a9c, emissiveIntensity: 0.0 });
  const sign = Plane(signMat, 5.4, 1.5, 0, h + 0.55, -d / 2 - 0.42, 0, Math.PI);
  g.add(sign);
  g.userData.signMat = signMat;
  // hanging bracket sign
  g.add(B(m.metal, 0.08, 0.08, 1.2, -w / 2 + 0.3, 3.2, -d / 2 - 0.7));
  const hang = Plane(new THREE.MeshStandardMaterial({ map: TEX.signTexture('cafehang', ['☕'], '#2a1a20', '#ffd9a0'), roughness: 0.7, side: THREE.DoubleSide }), 0.9, 0.9, -w / 2 + 0.3, 2.55, -d / 2 - 1.25, 0, Math.PI);
  g.add(hang);

  // planters + lamps flanking the door
  for (const sx of [-1, 1]) {
    const pl = P.makePlanter(1.1);
    pl.position.set(sx * 1.9, 0.4, -d / 2 - 0.7);
    g.add(pl);
    const lamp = P.makeLantern(2.2);
    lamp.position.set(sx * (w / 2 - 0.9), 0.4, -d / 2 - 2.3);
    g.add(lamp);
    g.userData.lights = (g.userData.lights || []).concat([{ ...lamp.userData.light, x: sx * (w / 2 - 0.9), z: -d / 2 - 2.3, y: 2.4 }]);
  }

  g.userData.cols.push({ k: 'b', x: 0, z: d / 2, w, d: 0.4, h });
  g.userData.cols.push({ k: 'b', x: -w / 2, z: 0, w: 0.4, d, h });
  g.userData.cols.push({ k: 'b', x: w / 2, z: 0, w: 0.4, d, h });
  g.userData.cols.push({ k: 'b', x: -w / 2 + 3.1, z: -d / 2, w: 4.8, d: 0.4, h });
  g.userData.cols.push({ k: 'b', x: w / 2 - 3.1, z: -d / 2, w: 4.8, d: 0.4, h });
  g.userData.doorAt = { x: 0, z: -d / 2 - 1.3 };
  return g;
}

export function makeRestaurant() {
  const m = M(), g = grp();
  const w = 9, d = 7, h = 3.8;
  g.add(B(m.brick, w, h, 0.24, 0, h / 2, d / 2));
  g.add(B(m.brick, 0.24, h, d, -w / 2, h / 2, 0));
  g.add(B(m.brick, 0.24, h, d, w / 2, h / 2, 0));
  g.add(B(m.brick, w, 1.0, 0.24, 0, h - 0.5, -d / 2));
  g.add(B(m.brick, 1.4, h, 0.24, -w / 2 + 0.7, h / 2, -d / 2));
  g.add(B(m.brick, 1.4, h, 0.24, w / 2 - 0.7, h / 2, -d / 2));
  const glass = B(m.glass, w - 3.2, 2.6, 0.08, 0, 1.6, -d / 2 - 0.02);
  glass.castShadow = false;
  g.add(glass);
  const door = doorPanel(1.2, 2.3, m.woodDark);
  door.position.set(-w / 4, 0, -d / 2 - 0.06);
  g.add(door);
  g.add(B(m.roofSlate, w + 0.6, 0.3, d + 0.6, 0, h + 0.15, 0));
  const tex = TEX.signTexture('restsign', ['ISLAND', 'KITCHEN'], '#22301f', '#e9dcb8');
  g.add(Plane(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }), 4.2, 1.2, 0, h - 0.6, -d / 2 - 0.14, 0, Math.PI));
  g.userData.cols.push({ k: 'b', x: 0, z: 0, w: w + 0.2, d: d + 0.2, h });
  return g;
}

/** Lighthouse: tapered tower, gallery, lamp room. */
export function makeLighthouse() {
  const m = M(), g = grp();
  const H = 20;
  // base building
  g.add(B(m.plasterWhite, 6.5, 3.2, 5.0, 3.6, 1.6, 0));
  g.add(B(m.roofSlate, 7.0, 0.28, 5.4, 3.6, 3.3, 0));
  g.add(windowPane(0.9, 1.0, 3.6, 1.9, -2.55));
  const bDoor = doorPanel(1.1, 2.1, m.dark);
  bDoor.position.set(5.4, 0, -2.55);
  g.add(bDoor);

  // tower
  const towerMat = m.plasterWhite;
  const seg = 5;
  for (let i = 0; i < seg; i++) {
    const y0 = (H / seg) * i, y1 = (H / seg) * (i + 1);
    const r0 = 2.6 - (i / seg) * 0.9, r1 = 2.6 - ((i + 1) / seg) * 0.9;
    const band = C(i % 2 === 0 ? towerMat : m.accentRose, r0, y1 - y0, 0, (y0 + y1) / 2, 0, r1, 20);
    g.add(band);
  }
  g.add(C(m.stoneLight, 3.1, 0.6, 0, 0.3, 0, 3.0, 20));
  // gallery
  const gy = H + 0.2;
  g.add(C(m.metal, 2.6, 0.3, 0, gy, 0, 2.6, 20));
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    g.add(C(m.metalLight, 0.05, 1.0, Math.cos(a) * 2.45, gy + 0.65, Math.sin(a) * 2.45, 0.05, 6));
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.45, 0.06, 6, 28), m.metalLight);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = gy + 1.15;
  g.add(ring);
  // lamp room
  g.add(C(m.metal, 1.7, 0.2, 0, gy + 0.4, 0, 1.7, 16));
  const lampGlass = C(m.lampGlass, 1.5, 2.4, 0, gy + 1.7, 0, 1.5, 16);
  lampGlass.castShadow = false;
  g.add(lampGlass);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.add(C(m.metal, 0.07, 2.4, Math.cos(a) * 1.5, gy + 1.7, Math.sin(a) * 1.5, 0.07, 6));
  }
  g.add(Cone(m.metal, 1.9, 1.3, 0, gy + 3.55, 0, 16));
  g.add(S(m.gold, 0.2, 0, gy + 4.3, 0));

  // the rotating beam emitter
  const beacon = grp(0, gy + 1.7, 0);
  beacon.userData.dynamic = true;
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xffe6b0, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
  const beam = new THREE.Mesh(new THREE.ConeGeometry(2.6, 60, 10, 1, true), beamMat);
  beam.rotation.z = Math.PI / 2;
  beam.position.x = 30;
  beam.castShadow = false;
  beacon.add(beam);
  beacon.add(S(m.lanternGlow, 0.5, 0, 0, 0));
  g.add(beacon);
  g.userData.beacon = beacon;
  g.userData.beamMat = beamMat;

  g.userData.cols.push({ k: 'c', x: 0, z: 0, r: 2.9 });
  g.userData.cols.push({ k: 'b', x: 3.6, z: 0, w: 6.5, d: 5.0, h: 3.2 });
  g.userData.topY = gy + 0.35;
  g.userData.doorAt = { x: 5.4, z: -4.2 };
  g.userData.lights = [{ x: 0, y: gy + 1.7, z: 0, color: 0xffe0a0, intensity: 3, distance: 45, night: true }];
  return g;
}

/** Wooden pier walking out to sea. Returns deck platforms for collision. */
export function makePier(length = 40, width = 5, groundY = 0, deckY = 2.2) {
  const m = M(), g = grp();
  const planks = Math.ceil(length / 1.2);
  for (let i = 0; i < planks; i++) {
    const z = -i * 1.2;
    g.add(B(m.plankWorn, width, 0.14, 1.1, 0, deckY, z));
  }
  for (let i = 0; i <= planks; i += 3) {
    const z = -i * 1.2;
    for (const sx of [-1, 1]) {
      g.add(C(m.woodDark, 0.2, deckY + 6, sx * (width / 2 - 0.3), deckY - (deckY + 6) / 2 + 0.1, z, 0.2, 8));
    }
    g.add(B(m.woodDark, width, 0.18, 0.18, 0, deckY - 0.14, z));
  }
  // rails with gaps for the boat steps
  for (const sx of [-1, 1]) {
    for (let i = 0; i < planks - 2; i += 4) {
      const rail = P.makeRailing(4.6, 1.0, m.woodDark);
      rail.position.set(sx * (width / 2 - 0.12), deckY + 0.07, -i * 1.2 - 2.3);
      rail.rotation.y = Math.PI / 2;
      g.add(rail);
    }
  }
  g.userData.cols.push({ k: 'p', x: 0, z: -length / 2, w: width, d: length + 1.2, y: deckY + 0.07 });
  g.userData.deckY = deckY + 0.07;
  g.userData.endZ = -length;
  return g;
}

export function makeDock(len = 8, width = 2.6, deckY = 0.6) {
  const m = M(), g = grp();
  const n = Math.ceil(len / 1.1);
  for (let i = 0; i < n; i++) g.add(B(m.plankWorn, width, 0.12, 1.0, 0, deckY, -i * 1.1));
  for (let i = 0; i <= n; i += 2) {
    for (const sx of [-1, 1]) g.add(C(m.woodDark, 0.13, deckY + 3, sx * (width / 2 - 0.2), deckY - (deckY + 3) / 2, -i * 1.1, 0.13, 6));
  }
  g.userData.cols.push({ k: 'p', x: 0, z: -len / 2, w: width, d: len + 1.0, y: deckY + 0.06 });
  g.userData.deckY = deckY + 0.06;
  return g;
}

/** Bridge across a river/gap. Oriented along local Z. */
export function makeBridge(span = 10, width = 4, style = 'wood', deckY = 0.4) {
  const m = M(), g = grp();
  if (style === 'stone') {
    g.add(B(m.stoneLight, width, 0.5, span, 0, deckY, 0));
    for (const sx of [-1, 1]) {
      g.add(B(m.stoneLight, 0.3, 0.85, span, sx * (width / 2 - 0.15), deckY + 0.62, 0));
    }
    // arch
    for (let i = 0; i < 7; i++) {
      const t = (i / 6 - 0.5) * 2;
      const y = deckY - 0.3 - Math.cos(t * 1.2) * 0.9;
      g.add(B(m.stone, width - 0.2, 0.4, span / 7, 0, y, t * span * 0.42));
    }
  } else if (style === 'road') {
    g.add(B(m.asphalt, width, 0.4, span, 0, deckY, 0));
    for (const sx of [-1, 1]) {
      const rail = P.makeRailing(span, 1.0, m.metalLight);
      rail.position.set(sx * (width / 2 - 0.1), deckY + 0.2, 0);
      rail.rotation.y = Math.PI / 2;
      g.add(rail);
      g.add(B(m.concrete, 0.4, 1.4, 0.6, sx * (width / 2), deckY - 0.5, span / 2 - 0.4));
      g.add(B(m.concrete, 0.4, 1.4, 0.6, sx * (width / 2), deckY - 0.5, -span / 2 + 0.4));
    }
  } else {
    const n = Math.ceil(span / 0.9);
    for (let i = 0; i < n; i++) {
      const z = -span / 2 + i * 0.9 + 0.45;
      const sag = Math.cos((i / (n - 1) - 0.5) * Math.PI) * 0.35;
      g.add(B(m.plankWorn, width, 0.12, 0.82, 0, deckY + sag * 0.4, z));
    }
    for (const sx of [-1, 1]) {
      for (let i = 0; i <= 4; i++) {
        const z = -span / 2 + (span / 4) * i;
        g.add(B(m.woodDark, 0.12, 1.1, 0.12, sx * (width / 2 - 0.1), deckY + 0.55, z));
      }
      g.add(B(m.woodDark, 0.1, 0.1, span, sx * (width / 2 - 0.1), deckY + 1.05, 0));
      g.add(B(m.woodDark, 0.08, 0.08, span, sx * (width / 2 - 0.1), deckY + 0.6, 0));
    }
    g.add(B(m.woodDark, width + 0.3, 0.25, 0.4, 0, deckY - 0.1, -span / 2));
    g.add(B(m.woodDark, width + 0.3, 0.25, 0.4, 0, deckY - 0.1, span / 2));
  }
  g.userData.cols.push({ k: 'p', x: 0, z: 0, w: width, d: span, y: deckY + 0.24 });
  return g;
}

/** Viewing deck with railing — used at Sunset Point. */
export function makeViewDeck(w = 9, d = 7, deckY = 0.5) {
  const m = M(), g = grp();
  const n = Math.ceil(d / 1.0);
  for (let i = 0; i < n; i++) g.add(B(m.plankWorn, w, 0.14, 0.92, 0, deckY, -d / 2 + i * 1.0 + 0.5));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(C(m.woodDark, 0.18, deckY + 4, sx * (w / 2 - 0.3), deckY - (deckY + 4) / 2, sz * (d / 2 - 0.3), 0.18, 8));
  }
  // railing around three sides (open at +Z, the approach)
  const rf = P.makeRailing(w, 1.05, m.woodDark);
  rf.position.set(0, deckY + 0.07, -d / 2 + 0.1);
  g.add(rf);
  for (const sx of [-1, 1]) {
    const r = P.makeRailing(d, 1.05, m.woodDark);
    r.position.set(sx * (w / 2 - 0.1), deckY + 0.07, 0);
    r.rotation.y = Math.PI / 2;
    g.add(r);
  }
  g.userData.cols.push({ k: 'p', x: 0, z: 0, w, d, y: deckY + 0.07 });
  g.userData.cols.push({ k: 'b', x: 0, z: -d / 2 + 0.1, w, d: 0.2, h: deckY + 1.1 });
  g.userData.deckY = deckY + 0.07;
  return g;
}

export function makeGazebo(r = 3.2) {
  const m = M(), g = grp();
  g.add(C(m.plankWorn, r, 0.3, 0, 0.15, 0, r, 8));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.add(C(m.woodPale, 0.12, 2.8, Math.cos(a) * (r - 0.3), 1.4, Math.sin(a) * (r - 0.3), 0.12, 8));
  }
  g.add(Cone(m.roof, r + 0.5, 1.6, 0, 3.6, 0, 8));
  g.add(S(m.gold, 0.16, 0, 4.5, 0));
  g.userData.cols.push({ k: 'p', x: 0, z: 0, w: r * 1.5, d: r * 1.5, y: 0.3 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.userData.cols.push({ k: 'c', x: Math.cos(a) * (r - 0.3), z: Math.sin(a) * (r - 0.3), r: 0.16 });
  }
  return g;
}

/**
 * Interior room. Built in the "interior zone" far from the island so it can be
 * lit and fogged independently without loading a second scene.
 */
export function makeInterior(o = {}) {
  const m = M();
  const { w = 8, d = 7, h = 3.2, floor = null, wall = null, ceiling = true } = o;
  const g = grp();
  const floorMat = floor || m.plank;
  const wallMat = wall || m.plasterCream;
  const f = B(floorMat, w, 0.3, d, 0, -0.15, 0);
  f.receiveShadow = true;
  g.add(f);
  g.add(B(wallMat, w, h, 0.25, 0, h / 2, d / 2));
  g.add(B(wallMat, w, h, 0.25, 0, h / 2, -d / 2));
  g.add(B(wallMat, 0.25, h, d, -w / 2, h / 2, 0));
  g.add(B(wallMat, 0.25, h, d, w / 2, h / 2, 0));
  if (ceiling) {
    const c = B(m.plasterWhite, w + 0.5, 0.25, d + 0.5, 0, h + 0.12, 0);
    c.castShadow = false;
    g.add(c);
  }
  // skirting
  g.add(B(m.woodPale, w, 0.16, 0.08, 0, 0.08, d / 2 - 0.16));
  g.add(B(m.woodPale, w, 0.16, 0.08, 0, 0.08, -d / 2 + 0.16));
  g.userData.cols.push({ k: 'p', x: 0, z: 0, w, d, y: 0 });
  g.userData.cols.push({ k: 'b', x: 0, z: d / 2, w: w + 0.5, d: 0.3, h });
  g.userData.cols.push({ k: 'b', x: 0, z: -d / 2, w: w + 0.5, d: 0.3, h });
  g.userData.cols.push({ k: 'b', x: -w / 2, z: 0, w: 0.3, d: d + 0.5, h });
  g.userData.cols.push({ k: 'b', x: w / 2, z: 0, w: 0.3, d: d + 0.5, h });
  return g;
}
