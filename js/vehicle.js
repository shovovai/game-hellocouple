/**
 * vehicle.js — drivable cars.
 *
 * Two halves:
 *   makeCarModel()  procedural car bodies with steerable, spinning wheels
 *   Vehicle         arcade driving physics — grippy, forgiving, and cheap
 *
 * The same Vehicle class drives the player's car and every AI car in traffic;
 * the difference is only where the throttle and steering come from.
 */

import * as THREE from 'three';
import { materials } from './materials.js';
import { clamp, damp, wrapAngle, makeRng } from './noise.js';
import * as TEX from './textures.js';

const GEO = {
  wheel: null, rim: null, body: null,
};

/**
 * Bodywork is swept, not stacked.
 *
 * A car is described as a side profile: a list of rings along the length, each
 * a rounded cross-section with its own width, sill height, shoulder height and
 * corner radii. Sweeping that gives a real car silhouette — round shoulders, a
 * dropping bonnet, tumblehome on the glasshouse — where a pile of boxes gives
 * a brick. The same machinery makes the rounded bumpers, lights and mirrors.
 */

/** Half a cross-section, bottom centre → up the right side → top centre. */
function halfSection(hwB, hwT, y0, y1, rB, rT, A = 3) {
  const pts = [[0, y0]];
  pts.push([Math.max(0, hwB - rB), y0]);
  for (let i = 1; i <= A; i++) {
    const a = (i / (A + 1)) * Math.PI / 2;
    pts.push([hwB - rB + rB * Math.sin(a), y0 + rB * (1 - Math.cos(a))]);
  }
  pts.push([hwB, y0 + rB]);
  pts.push([hwT, y1 - rT]);
  for (let i = 1; i <= A; i++) {
    const a = (i / (A + 1)) * Math.PI / 2;
    pts.push([hwT - rT * (1 - Math.cos(a)), y1 - rT + rT * Math.sin(a)]);
  }
  pts.push([Math.max(0, hwT - rT), y1]);
  pts.push([0, y1]);
  return pts;
}

function ringOf(o) {
  const half = halfSection(o.hwB, o.hwT ?? o.hwB, o.y0, o.y1, o.rB ?? 0.06, o.rT ?? 0.12);
  const left = half.slice(1, -1).reverse().map(([x, y]) => [-x, y]);
  return half.concat(left);
}

/** Sweep rings along Z into a closed solid. Caps get their own vertices so the
 *  ends stay sharp while the length of the body shades smoothly. */
function sweep(rings) {
  const P = rings[0].pts.length;
  const R = rings.length;
  const pos = [], uv = [], idx = [];
  for (let r = 0; r < R; r++) {
    const ring = rings[r];
    for (let p = 0; p < P; p++) {
      pos.push(ring.pts[p][0], ring.pts[p][1], ring.z);
      uv.push(p / P, r / (R - 1));
    }
  }
  for (let r = 0; r < R - 1; r++) {
    for (let p = 0; p < P; p++) {
      const q = (p + 1) % P;
      const a = r * P + p, b = r * P + q, c = (r + 1) * P + q, d = (r + 1) * P + p;
      idx.push(a, b, c, a, c, d);
    }
  }
  // caps
  for (const [r, flip] of [[0, true], [R - 1, false]]) {
    const ring = rings[r];
    let cx = 0, cy = 0;
    for (const p of ring.pts) { cx += p[0]; cy += p[1]; }
    cx /= P; cy /= P;
    const base = pos.length / 3;
    pos.push(cx, cy, ring.z); uv.push(0.5, 0.5);
    for (let p = 0; p < P; p++) {
      pos.push(ring.pts[p][0], ring.pts[p][1], ring.z);
      uv.push(0.5 + ring.pts[p][0] * 0.1, 0.5 + ring.pts[p][1] * 0.1);
    }
    for (let p = 0; p < P; p++) {
      const a = base + 1 + p, b = base + 1 + (p + 1) % P;
      if (flip) idx.push(base, b, a); else idx.push(base, a, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Rounded box — used for bumpers, lights, mirrors and handles. */
function roundBox(w, h, d, r = 0.04) {
  const hw = w / 2, hh = h / 2, hd = d / 2;
  const rings = [];
  const inset = Math.min(r, hd * 0.9);
  for (const [z, k] of [[-hd, 0], [-hd + inset, 1], [hd - inset, 1], [hd, 0]]) {
    const s = k ? 1 : 0.82;
    rings.push({ z, pts: ringOf({ hwB: hw * s, hwT: hw * s, y0: -hh * s, y1: hh * s, rB: r, rT: r }) });
  }
  return sweep(rings);
}

/** Tyre cross-section lathed about the axle: flat tread, rounded sidewalls. */
function tyreGeometry(R = 0.355, width = 0.24, rim = 0.215) {
  const pts = [];
  const hw = width / 2;
  pts.push(new THREE.Vector2(rim, -hw));
  pts.push(new THREE.Vector2(R * 0.82, -hw * 1.02));
  pts.push(new THREE.Vector2(R * 0.97, -hw * 0.92));
  pts.push(new THREE.Vector2(R, -hw * 0.72));
  pts.push(new THREE.Vector2(R, hw * 0.72));
  pts.push(new THREE.Vector2(R * 0.97, hw * 0.92));
  pts.push(new THREE.Vector2(R * 0.82, hw * 1.02));
  pts.push(new THREE.Vector2(rim, hw));
  const geo = new THREE.LatheGeometry(pts, 22);
  geo.rotateZ(Math.PI / 2);
  return geo;
}

/** Five-spoke rim with a dish and a hub cap. */
function rimGeometry(r = 0.215, width = 0.22) {
  const parts = [];
  const barrel = new THREE.CylinderGeometry(r, r, width, 18, 1, true);
  barrel.rotateZ(Math.PI / 2);
  parts.push(barrel);
  const dish = new THREE.CylinderGeometry(r * 0.97, r * 0.86, 0.03, 18);
  dish.rotateZ(Math.PI / 2);
  dish.translate(width * 0.34, 0, 0);
  parts.push(dish);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const spoke = new THREE.BoxGeometry(0.035, r * 0.92, 0.055);
    spoke.translate(0, r * 0.46, 0);
    spoke.rotateX(a);
    spoke.translate(width * 0.3, 0, 0);
    parts.push(spoke);
  }
  const hub = new THREE.CylinderGeometry(0.055, 0.05, 0.05, 12);
  hub.rotateZ(Math.PI / 2);
  hub.translate(width * 0.38, 0, 0);
  parts.push(hub);
  const geo = mergeRole(parts.map(p => p.index ? p.toNonIndexed() : p));
  parts.forEach(p => p.dispose());
  return geo;
}

function unitWheel() {
  if (!GEO.wheel) {
    GEO.wheel = tyreGeometry();
    GEO.wheel.userData.shared = true;
    GEO.rim = rimGeometry();
    GEO.rim.userData.shared = true;
    GEO.disc = new THREE.CylinderGeometry(0.16, 0.16, 0.03, 14);
    GEO.disc.rotateZ(Math.PI / 2);
    GEO.disc.userData.shared = true;
  }
  return GEO;
}

/** Car presets: proportions, colour palette and handling. */
export const CAR_KINDS = {
  sedan: {
    w: 1.86, l: 4.40, h: 0.62, cabin: 0.60, nose: 1.05, maxSpeed: 30, accel: 11, grip: 1.00, mass: 1,
    belt: 1.02, roof: 1.50, cabF: 0.16, cabR: -0.66, wsRake: 0.30, rrRake: 0.26,
  },
  sports: {
    w: 1.90, l: 4.30, h: 0.48, cabin: 0.46, nose: 1.15, maxSpeed: 42, accel: 18, grip: 1.15, mass: 0.9, spoiler: true,
    belt: 0.88, roof: 1.26, cabF: 0.02, cabR: -0.52, wsRake: 0.42, rrRake: 0.44, lowRide: true,
  },
  suv: {
    w: 1.98, l: 4.70, h: 0.82, cabin: 0.78, nose: 0.95, maxSpeed: 27, accel: 9.5, grip: 0.92, mass: 1.2,
    belt: 1.22, roof: 1.86, cabF: 0.22, cabR: -0.84, wsRake: 0.26, rrRake: 0.10, tall: true,
  },
  van: {
    w: 2.00, l: 5.10, h: 0.92, cabin: 1.05, nose: 0.75, maxSpeed: 24, accel: 8, grip: 0.85, mass: 1.3, boxy: true,
    belt: 1.26, roof: 2.16, cabF: 0.52, cabR: -0.94, wsRake: 0.20, rrRake: 0.04, tall: true,
  },
  taxi: {
    w: 1.88, l: 4.50, h: 0.64, cabin: 0.62, nose: 1.05, maxSpeed: 29, accel: 10.5, grip: 1.0, mass: 1, taxi: true,
    belt: 1.04, roof: 1.54, cabF: 0.18, cabR: -0.66, wsRake: 0.30, rrRake: 0.24,
  },
  pickup: {
    w: 1.96, l: 5.00, h: 0.78, cabin: 0.70, nose: 1.0, maxSpeed: 26, accel: 9, grip: 0.9, mass: 1.2, bed: true,
    belt: 1.20, roof: 1.82, cabF: 0.30, cabR: -0.20, wsRake: 0.28, rrRake: 0.06, tall: true,
  },
};

export const CAR_COLORS = [
  0xd8dde3, 0x1d2229, 0xb3373f, 0x2d5f9e, 0x3f7d58,
  0xe0b23c, 0x8d5aa8, 0xc96a3a, 0x6f7883, 0xf0f2f4,
];

/**
 * Build a car. Returns a Group with `userData.parts` holding the wheels so the
 * physics can steer and spin them.
 */
export function makeCarModel(kind = 'sedan', color = 0xd8dde3, seed = 1) {
  const m = materials();
  const k = CAR_KINDS[kind] || CAR_KINDS.sedan;
  const rng = makeRng(seed * 37 + 11);
  unitWheel();

  const g = new THREE.Group();
  g.userData.dynamic = true;

  const paint = new THREE.MeshStandardMaterial({
    color, roughness: 0.22, metalness: 0.62,
    normalMap: TEX.carPaintNormal(), normalScale: new THREE.Vector2(0.16, 0.16),
  });
  const trim = new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.62, metalness: 0.25 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x16202b, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.62,
    transmission: 0, side: THREE.DoubleSide,
  });
  const head = new THREE.MeshStandardMaterial({
    color: 0xfff6e0, emissive: 0xffeec0, emissiveIntensity: 0.0, roughness: 0.12, metalness: 0.1,
  });
  const tail = new THREE.MeshStandardMaterial({
    color: 0xb8262c, emissive: 0xff3020, emissiveIntensity: 0.15, roughness: 0.2,
  });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xcfd6dd, roughness: 0.18, metalness: 0.9 });
  g.userData.mats = { paint, head, tail, glass };

  const roleOf = (mat) => mat === paint ? 'paint' : mat === glass ? 'glass'
    : mat === head ? 'head' : mat === tail ? 'tail' : 'trim';
  const put = (geo, mat, x = 0, y = 0, z = 0, shadow = true) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    mesh.userData.role = roleOf(mat);
    g.add(mesh);
    return mesh;
  };
  const box = (mat, w, h, d, x, y, z, r = 0.02) => put(roundBox(w, h, d, r), mat, x, y, z);

  const W = k.w, L = k.l, HW = W / 2, HL = L / 2;
  const wheelR = k.tall ? 0.39 : k.lowRide ? 0.34 : 0.36;
  const ride = (k.lowRide ? 0.20 : k.tall ? 0.36 : 0.28);
  const sill = ride + 0.11;
  const belt = k.belt, roofY = k.roof;

  // ---- lower body: a swept solid from tail to nose ----
  // [z fraction, half-width fraction, shoulder height, sill lift]
  const lower = [
    [-1.00, 0.62, belt - 0.30, 0.10],
    [-0.97, 0.84, belt - 0.10, 0.06],
    [-0.90, 0.96, belt - 0.01, 0.02],
    [-0.70, 1.00, belt, 0.00],
    [-0.30, 1.00, belt, 0.00],
    [0.10, 1.00, belt, 0.00],
    [0.45, 1.00, belt - 0.02, 0.00],
    [0.68, 0.995, belt - 0.07, 0.00],
    [0.86, 0.97, belt - 0.15, 0.02],
    [0.95, 0.90, belt - 0.22, 0.05],
    [1.00, 0.68, belt - 0.30, 0.10],
  ];
  const bodyRings = lower.map(([zf, wf, top, lift]) => ({
    z: zf * HL,
    pts: ringOf({
      hwB: HW * wf * 0.96, hwT: HW * wf, y0: sill + lift, y1: top,
      rB: 0.07, rT: Math.min(0.16, (top - sill - lift) * 0.45),
    }),
  }));
  put(sweep(bodyRings), paint);

  // rocker / underbody shadow band
  const rocker = lower.filter(([zf]) => Math.abs(zf) < 0.93).map(([zf, wf]) => ({
    z: zf * HL,
    pts: ringOf({ hwB: HW * wf * 0.88, hwT: HW * wf * 0.965, y0: ride, y1: sill + 0.1, rB: 0.05, rT: 0.05 }),
  }));
  put(sweep(rocker), trim, 0, 0, 0, false);

  // ---- glasshouse ----
  const cabF = k.cabF * HL, cabR = k.cabR * HL;
  const cabL = cabF - cabR;
  const gh = [
    [0.00, 0.80, belt + 0.04],
    [k.wsRake * 0.55, 0.86, roofY - 0.10],
    [k.wsRake, 0.90, roofY - 0.01],
    [0.5, 0.905, roofY],
    [1 - k.rrRake, 0.90, roofY - 0.01],
    [1 - k.rrRake * 0.45, 0.86, roofY - 0.10],
    [1.00, 0.72, belt + 0.03],
  ];
  const ghRings = gh.map(([t, wf, top]) => ({
    z: cabF - t * cabL,
    pts: ringOf({
      hwB: HW * wf, hwT: HW * wf * 0.9, y0: belt - 0.05, y1: top,
      rB: 0.04, rT: Math.min(0.12, (top - belt) * 0.4),
    }),
  }));
  put(sweep(ghRings), glass, 0, 0, 0, false);

  // roof panel + a painted band under the glass so the body reads as one shell
  const roofRings = ghRings
    .map((r, i) => ({ r, wf: gh[i][1], top: gh[i][2] }))
    .filter(({ top }) => top > roofY - 0.12)
    .map(({ r, wf, top }) => ({
      z: r.z,
      pts: ringOf({ hwB: HW * wf * 0.93, hwT: HW * wf * 0.9, y0: top - 0.1, y1: top + 0.005, rB: 0.05, rT: 0.1 }),
    }));
  if (roofRings.length >= 2) put(sweep(roofRings), paint);

  // pillars: A at the windscreen rake, B upright, C at the rear rake
  const pillar = (z0, z1, wf) => {
    const dz = z1 - z0, dy = roofY - belt;
    for (const sx of [-1, 1]) {
      const p = put(roundBox(0.075, Math.hypot(dy, dz) + 0.06, 0.1, 0.03), paint,
        sx * HW * wf * 0.95, (belt + roofY) / 2 + 0.02, (z0 + z1) / 2);
      p.rotation.x = Math.atan2(dz, dy);
      p.rotation.z = sx * 0.05;
    }
  };
  pillar(cabF, cabF - k.wsRake * cabL, 0.86);
  pillar(cabR, cabR + k.rrRake * cabL, 0.80);
  if (!k.lowRide) pillar(cabF - cabL * 0.5, cabF - cabL * 0.52, 0.9);
  // beltline chrome
  for (const sx of [-1, 1]) {
    const b = put(roundBox(0.03, 0.035, cabL * 0.98, 0.012), chrome, sx * HW * 0.86, belt + 0.01, (cabF + cabR) / 2, false);
    b.userData.role = 'trim';
  }

  // ---- doors: shut lines and handles ----
  const doorZ = k.bed ? [cabF - cabL * 0.55] : [cabF - cabL * 0.06, cabF - cabL * 0.52, cabR + cabL * 0.06];
  for (const dz of doorZ) {
    for (const sx of [-1, 1]) {
      box(trim, 0.02, belt - sill - 0.12, 0.03, sx * HW * 0.995, (sill + belt) / 2, dz, 0.008);
    }
  }
  for (const sx of [-1, 1]) {
    for (const dz of doorZ.slice(0, 2)) {
      box(chrome, 0.05, 0.055, 0.17, sx * HW * 1.0, belt - 0.14, dz - cabL * 0.2, 0.02);
    }
  }

  // ---- nose: grille, lights, bumper, plate ----
  const noseZ = HL - 0.02;
  const grille = box(trim, W * 0.46, 0.15, 0.1, 0, belt - 0.335, noseZ - 0.02, 0.03);
  for (let i = 0; i < 5; i++) {
    box(chrome, W * 0.44, 0.014, 0.04, 0, belt - 0.335 - 0.05 + i * 0.026, noseZ + 0.02, 0.006);
  }
  for (const sx of [-1, 1]) {
    // headlamp: a wide lens with a chrome surround
    box(chrome, W * 0.25, 0.125, 0.07, sx * W * 0.30, belt - 0.245, noseZ - 0.01, 0.035);
    box(head, W * 0.22, 0.095, 0.06, sx * W * 0.30, belt - 0.245, noseZ + 0.025, 0.028);
    // fog lamp
    box(head, 0.11, 0.08, 0.05, sx * W * 0.33, sill + 0.06, noseZ - 0.03, 0.025);
    // rear lamp cluster
    box(tail, W * 0.26, 0.14, 0.06, sx * W * 0.30, belt - 0.20, -HL + 0.01, 0.03);
  }
  box(trim, W * 0.94, 0.2, 0.16, 0, sill + 0.05, noseZ - 0.06, 0.06);         // front bumper
  box(trim, W * 0.94, 0.2, 0.16, 0, sill + 0.05, -HL + 0.06, 0.06);           // rear bumper
  box(m.white, 0.34, 0.11, 0.03, 0, sill + 0.12, noseZ + 0.03, 0.01);         // number plate
  box(m.white, 0.34, 0.11, 0.03, 0, sill + 0.12, -HL - 0.01, 0.01);
  // bonnet shut line + wiper
  box(trim, W * 0.78, 0.012, 0.02, 0, belt - 0.055, cabF + 0.04, 0.005);
  for (const sx of [-1, 1]) {
    const wip = box(trim, 0.02, 0.02, 0.42, sx * W * 0.16, belt + 0.03, cabF - 0.1, 0.008);
    wip.rotation.y = sx * 0.5;
  }

  // ---- mirrors ----
  for (const sx of [-1, 1]) {
    const stalk = box(trim, 0.09, 0.035, 0.05, sx * (HW + 0.04), belt + 0.02, cabF - cabL * 0.14, 0.015);
    stalk.castShadow = false;
    const cap = box(paint, 0.07, 0.1, 0.15, sx * (HW + 0.12), belt + 0.06, cabF - cabL * 0.14, 0.035);
    cap.castShadow = false;
  }

  // ---- cabin interior, visible through the glass ----
  const seatZ = [cabF - cabL * 0.3, cabF - cabL * 0.72];
  for (const sz of seatZ) {
    for (const sx of [-1, 1]) {
      box(trim, 0.42, 0.1, 0.44, sx * W * 0.22, belt - 0.2, sz, 0.05);          // cushion
      const back = box(trim, 0.42, 0.5, 0.12, sx * W * 0.22, belt + 0.03, sz - 0.2, 0.05);
      back.rotation.x = -0.16;
    }
  }
  box(trim, W * 0.84, 0.14, 0.44, 0, belt - 0.03, cabF - cabL * 0.09, 0.05);    // dashboard
  const wheelG = new THREE.TorusGeometry(0.15, 0.022, 6, 16);
  const steer = put(wheelG, trim, -W * 0.22, belt + 0.02, cabF - cabL * 0.22, false);
  steer.rotation.x = 1.15;

  // ---- kind-specific bodywork ----
  if (k.taxi) {
    const sign = box(m.white, 0.66, 0.17, 0.26, 0, roofY + 0.1, cabF - cabL * 0.35, 0.04);
    sign.material = new THREE.MeshStandardMaterial({
      color: 0xffd24a, emissive: 0xffb000, emissiveIntensity: 0.35, roughness: 0.4,
    });
    sign.userData.role = 'trim';
    for (const sx of [-1, 1]) box(m.white, 0.02, 0.24, 1.1, sx * HW * 1.0, belt - 0.24, cabF - cabL * 0.45, 0.01);
  }
  if (k.bed) {
    const bedF = cabR - 0.05, bedR = -HL + 0.08;
    const bedRings = [];
    for (const t of [0, 0.25, 0.75, 1]) {
      bedRings.push({
        z: bedF + (bedR - bedF) * t,
        pts: ringOf({ hwB: HW * 0.99, hwT: HW * 0.99, y0: belt - 0.02, y1: belt + 0.36, rB: 0.04, rT: 0.07 }),
      });
    }
    put(sweep(bedRings), paint);
    box(trim, W * 0.86, 0.05, Math.abs(bedR - bedF) * 0.92, 0, belt + 0.04, (bedF + bedR) / 2, 0.02);
  }
  if (k.spoiler) {
    const blade = box(trim, W * 0.82, 0.05, 0.26, 0, belt + 0.2, -HL + 0.16, 0.02);
    blade.rotation.x = -0.14;
    for (const sx of [-1, 1]) box(trim, 0.055, 0.2, 0.1, sx * W * 0.33, belt + 0.09, -HL + 0.18, 0.02);
    box(trim, W * 0.5, 0.12, 0.2, 0, sill + 0.02, -HL + 0.04, 0.04);          // diffuser
  }
  // exhaust
  for (const sx of k.spoiler ? [-1, 1] : [1]) {
    box(chrome, 0.08, 0.08, 0.14, sx * W * 0.3, ride + 0.04, -HL - 0.02, 0.035);
  }

  // ---- wheels + arches ----
  const wheels = [];
  const axleZ = L * 0.32, axleX = W * 0.5 - 0.09;
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const hub = new THREE.Group();
    hub.position.set(sx * axleX, wheelR, sz * axleZ);
    hub.scale.setScalar(wheelR / 0.355);
    const tyre = new THREE.Mesh(GEO.wheel, m.rubber);
    tyre.castShadow = true;
    tyre.userData.role = 'wheel';
    hub.add(tyre);
    const rim = new THREE.Mesh(GEO.rim, m.metalLight);
    rim.scale.x = sx;
    rim.userData.role = 'rim';
    hub.add(rim);
    const disc = new THREE.Mesh(GEO.disc, trim);
    disc.position.x = sx * 0.04;
    disc.userData.role = 'rim';
    hub.add(disc);
    g.add(hub);
    wheels.push({ hub, tyre, steer: sz > 0, side: sx });

    // wheel arch: a half torus flared over the tyre
    // wheel arch: a slim flare that follows the top of the tyre
    const arch = new THREE.Mesh(
      new THREE.TorusGeometry(wheelR + 0.11, 0.038, 5, 12, Math.PI * 0.95), trim);
    arch.position.set(sx * (HW - 0.055), wheelR, sz * axleZ);
    arch.rotation.set(0, Math.PI / 2, Math.PI * 0.025);
    arch.scale.set(1, 1, 1.15);
    arch.userData.role = 'trim';
    arch.castShadow = false;
    g.add(arch);
  }

  g.userData.parts = { wheels, axleZ, axleX };
  g.userData.kind = kind;
  g.userData.size = { w: W, l: L };
  g.userData.seats = {
    driver: { x: -W * 0.22, y: belt - 0.1, z: cabF - cabL * 0.3 },
    passenger: { x: W * 0.22, y: belt - 0.1, z: cabF - cabL * 0.3 },
  };
  return g;
}

/**
 * Arcade car physics. Deliberately grippy and forgiving: this is a relaxing
 * island, not a simulator. Wheels follow the terrain so the body pitches over
 * crests and leans into corners.
 */
export class Vehicle {
  constructor(model, terrain, physics, kind = 'sedan') {
    this.model = model;
    this.terrain = terrain;
    this.physics = physics;
    this.spec = CAR_KINDS[kind] || CAR_KINDS.sedan;

    this.pos = new THREE.Vector3();
    this.heading = 0;
    this.speed = 0;
    this.steer = 0;
    this.wheelSpin = 0;
    this.bodyRoll = 0;
    this.bodyPitch = 0;
    this.airborne = false;
    this.vy = 0;
    this.radius = Math.max(this.spec.w, this.spec.l) * 0.42;
    this.onRoad = true;
    this._tmp = new THREE.Vector3();
  }

  place(x, z, heading = 0) {
    this.pos.set(x, this.terrain.height(x, z), z);
    this.heading = heading;
    this.speed = 0;
    this.sync();
  }

  get kmh() { return Math.abs(this.speed) * 3.6; }

  /**
   * @param {object} input {throttle:-1..1, steer:-1..1, brake:bool}
   */
  update(dt, input) {
    const s = this.spec;
    const throttle = clamp(input.throttle || 0, -1, 1);
    const steerIn = clamp(input.steer || 0, -1, 1);

    // Rougher ground is slower and less grippy than tarmac.
    const surface = this.terrain.biome(this.pos.x, this.pos.z);
    const grip = surface === 'sand' ? 0.62 : surface === 'rock' ? 0.7 : surface === 'grass' ? 0.78 : 1;
    const maxSpeed = s.maxSpeed * (0.55 + grip * 0.45);

    // longitudinal
    if (input.brake) {
      this.speed = damp(this.speed, 0, 6.5, dt);
    } else if (throttle !== 0) {
      const target = maxSpeed * throttle * (throttle < 0 ? 0.42 : 1);
      const rate = (Math.sign(target - this.speed) === Math.sign(this.speed) || this.speed === 0)
        ? s.accel * grip : s.accel * 2.1;
      this.speed += clamp(target - this.speed, -rate * dt, rate * dt);
    } else {
      this.speed = damp(this.speed, 0, 1.1, dt);
    }
    this.speed = clamp(this.speed, -maxSpeed * 0.45, maxSpeed);

    // steering: full lock at low speed, progressively less as you gain speed
    const speedFrac = clamp(Math.abs(this.speed) / s.maxSpeed, 0, 1);
    const lock = 0.62 * (1 - speedFrac * 0.62);
    this.steer = damp(this.steer, steerIn * lock, 9, dt);
    const turn = this.steer * (this.speed / Math.max(3.2, s.l * 0.72)) * s.grip;
    this.heading -= turn * dt * 1.25;

    // integrate
    const dx = Math.sin(this.heading) * this.speed * dt;
    const dz = Math.cos(this.heading) * this.speed * dt;
    const nx = this.pos.x + dx, nz = this.pos.z + dz;

    // collision: push out of solids, scrub speed on impact
    this._tmp.set(nx, this.pos.y + 0.7, nz);
    const before = { x: this._tmp.x, z: this._tmp.z };
    const hit = this.physics.resolve(this._tmp, this.radius, this.pos.y + 0.2, this.pos.y + 1.8);
    if (hit) {
      const slide = Math.hypot(this._tmp.x - before.x, this._tmp.z - before.z);
      this.speed *= clamp(1 - slide * 0.55, 0.35, 0.94);
      this.bodyRoll += (Math.random() - 0.5) * 0.05;
    }
    this.pos.x = this._tmp.x;
    this.pos.z = this._tmp.z;

    // deep water stops you dead
    const gh = this.terrain.height(this.pos.x, this.pos.z);
    if (gh < -0.8) {
      const n = this.terrain.normal(this.pos.x, this.pos.z);
      this.pos.x += n.x * 1.4;
      this.pos.z += n.z * 1.4;
      this.speed *= 0.2;
    }

    // suspension: sample the ground under each axle
    const fx = this.pos.x + Math.sin(this.heading) * s.l * 0.32;
    const fz = this.pos.z + Math.cos(this.heading) * s.l * 0.32;
    const rx = this.pos.x - Math.sin(this.heading) * s.l * 0.32;
    const rz = this.pos.z - Math.cos(this.heading) * s.l * 0.32;
    const hf = this.physics.groundAt(fx, fz, this.pos.y + 1.2);
    const hr = this.physics.groundAt(rx, rz, this.pos.y + 1.2);
    const target = Math.max(hf, hr);

    if (this.pos.y > target + 0.25) {
      this.airborne = true;
      this.vy -= 26 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= target) { this.pos.y = target; this.vy = 0; this.airborne = false; }
    } else {
      this.pos.y = damp(this.pos.y, target, 12, dt);
      this.vy = 0;
      this.airborne = false;
    }

    this.bodyPitch = damp(this.bodyPitch, Math.atan2(hf - hr, s.l * 0.64) * -1, 8, dt);
    this.bodyRoll = damp(this.bodyRoll, -this.steer * speedFrac * 0.20, 7, dt);
    this.wheelSpin += (this.speed / 0.36) * dt;
    this.onRoad = surface !== 'sand' && grip > 0.9;

    this.sync();
  }

  /** Push the simulated state into the model. */
  sync() {
    const g = this.model;
    g.position.copy(this.pos);
    g.rotation.set(0, this.heading, 0);
    g.rotateX(this.bodyPitch);
    g.rotateZ(this.bodyRoll);
    const parts = g.userData.parts;
    if (!parts) return;
    for (const w of parts.wheels) {
      w.hub.rotation.y = w.steer ? -this.steer * 0.85 : 0;
      w.tyre.rotation.x = this.wheelSpin;
    }
  }

  setLights(on) {
    const mats = this.model.userData.mats;
    if (!mats) return;
    mats.head.emissiveIntensity = on ? 1.6 : 0.0;
    mats.tail.emissiveIntensity = on ? 0.9 : 0.15;
  }

  setBraking(on) {
    const mats = this.model.userData.mats;
    if (mats) mats.tail.emissiveIntensity = on ? 2.2 : (mats.head.emissiveIntensity > 0 ? 0.9 : 0.15);
  }

  /** Where the driver stands when they get out. */
  exitPoint() {
    const sx = Math.cos(this.heading), sz = -Math.sin(this.heading);
    return { x: this.pos.x + sx * (this.spec.w * 0.5 + 0.9), z: this.pos.z + sz * (this.spec.w * 0.5 + 0.9) };
  }
}

/**
 * Merge one car model into a geometry per material role, in local space.
 * Traffic renders every car of a given kind with a handful of InstancedMeshes
 * built from these, so a city full of cars costs ~25 draw calls rather than
 * thousands.
 */
export function carRoleGeometries(kind, seed = 1) {
  const model = makeCarModel(kind, 0xffffff, seed);
  model.updateMatrixWorld(true);
  const byRole = new Map();
  model.traverse(o => {
    if (!o.isMesh) return;
    const role = o.userData.role || 'trim';
    const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone());
    g.applyMatrix4(o.matrixWorld);
    if (!byRole.has(role)) byRole.set(role, []);
    byRole.get(role).push(g);
  });
  const out = {};
  for (const [role, list] of byRole) {
    if (role === 'wheel' || role === 'rim') continue;     // wheels are instanced separately
    out[role] = mergeRole(list);
    list.forEach(g => g.dispose());
  }
  model.traverse(o => { if (o.isMesh && !o.geometry.userData.shared) o.geometry.dispose(); });
  return out;
}

function mergeRole(list) {
  let total = 0;
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
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeBoundingSphere();
  return geo;
}

export function wheelGeometries() {
  unitWheel();
  return { tyre: GEO.wheel, rim: GEO.rim };
}
