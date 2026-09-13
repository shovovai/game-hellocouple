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

const GEO = {
  wheel: null, rim: null, body: null,
};

function unitWheel() {
  if (!GEO.wheel) {
    GEO.wheel = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 16);
    GEO.wheel.rotateZ(Math.PI / 2);
    GEO.wheel.userData.shared = true;
    GEO.rim = new THREE.CylinderGeometry(0.21, 0.21, 0.28, 10);
    GEO.rim.rotateZ(Math.PI / 2);
    GEO.rim.userData.shared = true;
  }
  return GEO;
}

/** Car presets: proportions, colour palette and handling. */
export const CAR_KINDS = {
  sedan:  { w: 1.86, l: 4.40, h: 0.62, cabin: 0.60, nose: 1.05, maxSpeed: 30, accel: 11, grip: 1.00, mass: 1 },
  sports: { w: 1.90, l: 4.30, h: 0.48, cabin: 0.46, nose: 1.15, maxSpeed: 42, accel: 18, grip: 1.15, mass: 0.9, spoiler: true },
  suv:    { w: 1.98, l: 4.70, h: 0.82, cabin: 0.78, nose: 0.95, maxSpeed: 27, accel: 9.5, grip: 0.92, mass: 1.2 },
  van:    { w: 2.00, l: 5.10, h: 0.92, cabin: 1.05, nose: 0.75, maxSpeed: 24, accel: 8, grip: 0.85, mass: 1.3, boxy: true },
  taxi:   { w: 1.88, l: 4.50, h: 0.64, cabin: 0.62, nose: 1.05, maxSpeed: 29, accel: 10.5, grip: 1.0, mass: 1, taxi: true },
  pickup: { w: 1.96, l: 5.00, h: 0.78, cabin: 0.70, nose: 1.0, maxSpeed: 26, accel: 9, grip: 0.9, mass: 1.2, bed: true },
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
    color, roughness: 0.28, metalness: 0.55,
  });
  const trim = new THREE.MeshStandardMaterial({ color: 0x2a2e35, roughness: 0.55, metalness: 0.3 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x141c26, roughness: 0.06, metalness: 0.15, transparent: true, opacity: 0.72,
  });
  const head = new THREE.MeshStandardMaterial({
    color: 0xfff6e0, emissive: 0xffeec0, emissiveIntensity: 0.0, roughness: 0.2,
  });
  const tail = new THREE.MeshStandardMaterial({
    color: 0xb8262c, emissive: 0xff3020, emissiveIntensity: 0.15, roughness: 0.3,
  });
  g.userData.mats = { paint, head, tail, glass };

  const roleOf = (mat) => mat === paint ? 'paint' : mat === glass ? 'glass'
    : mat === head ? 'head' : mat === tail ? 'tail' : 'trim';
  const box = (mat, w, h, d, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.role = roleOf(mat);
    g.add(mesh);
    return mesh;
  };

  const W = k.w, L = k.l, floor = 0.46;

  // ---- lower body: three stacked slabs give a tapered shoulder line ----
  box(paint, W, k.h * 0.55, L, 0, floor + k.h * 0.28, 0);
  box(paint, W * 0.965, k.h * 0.5, L * 0.99, 0, floor + k.h * 0.72, 0);
  box(trim, W * 1.005, 0.16, L * 0.995, 0, floor - 0.02, 0);          // sill
  // nose and tail tapers
  box(paint, W * 0.90, k.h * 0.42, L * 0.14, 0, floor + k.h * 0.24, L * 0.47);
  box(paint, W * 0.90, k.h * 0.46, L * 0.12, 0, floor + k.h * 0.30, -L * 0.47);

  // ---- cabin ----
  const cabL = k.boxy ? L * 0.62 : L * 0.46;
  const cabZ = k.boxy ? L * 0.02 : -L * 0.06;
  const cabY = floor + k.h + k.cabin * 0.5;
  box(paint, W * 0.92, k.cabin, cabL, 0, cabY, cabZ);
  // glazing, inset slightly on each side
  box(glass, W * 0.86, k.cabin * 0.72, cabL * 0.99, 0, cabY + 0.02, cabZ);
  box(glass, W * 0.93, k.cabin * 0.66, cabL * 0.9, 0, cabY + 0.02, cabZ);
  // roof
  box(paint, W * 0.90, 0.07, cabL * 0.96, 0, cabY + k.cabin * 0.5, cabZ);
  if (k.taxi) {
    const sign = box(m.white, 0.62, 0.16, 0.26, 0, cabY + k.cabin * 0.5 + 0.11, cabZ + 0.2);
    sign.material = new THREE.MeshStandardMaterial({
      color: 0xffd24a, emissive: 0xffb000, emissiveIntensity: 0.35, roughness: 0.4,
    });
    sign.userData.role = 'trim';
  }
  if (k.bed) {
    box(trim, W * 0.94, 0.42, L * 0.32, 0, floor + k.h + 0.2, -L * 0.30);
    box(trim, W * 0.86, 0.06, L * 0.30, 0, floor + k.h + 0.02, -L * 0.30);
  }
  if (k.spoiler) {
    box(trim, W * 0.80, 0.05, 0.22, 0, floor + k.h + 0.30, -L * 0.47);
    for (const sx of [-1, 1]) box(trim, 0.06, 0.22, 0.08, sx * W * 0.32, floor + k.h + 0.19, -L * 0.46);
  }

  // ---- lights, grille, mirrors ----
  for (const sx of [-1, 1]) {
    box(head, W * 0.26, 0.13, 0.09, sx * W * 0.31, floor + k.h * 0.55, L * 0.5 + 0.01);
    box(tail, W * 0.24, 0.11, 0.08, sx * W * 0.32, floor + k.h * 0.62, -L * 0.5 - 0.01);
    const mirror = box(paint, 0.16, 0.09, 0.08, sx * (W * 0.52), cabY - k.cabin * 0.18, cabZ + cabL * 0.42);
    mirror.castShadow = false;
  }
  box(trim, W * 0.56, 0.14, 0.07, 0, floor + k.h * 0.30, L * 0.5 + 0.02);   // grille
  box(trim, W * 0.92, 0.14, 0.12, 0, floor + 0.06, L * 0.5);                 // front bumper
  box(trim, W * 0.92, 0.14, 0.12, 0, floor + 0.06, -L * 0.5);                // rear bumper

  // ---- wheels ----
  const wheels = [];
  const axleZ = L * 0.32, axleX = W * 0.5 - 0.06;
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const hub = new THREE.Group();
    hub.position.set(sx * axleX, 0.36, sz * axleZ);
    const tyre = new THREE.Mesh(GEO.wheel, m.rubber);
    tyre.castShadow = true;
    tyre.userData.role = 'wheel';
    hub.add(tyre);
    const rim = new THREE.Mesh(GEO.rim, m.metalLight);
    rim.position.x = sx * 0.02;
    rim.userData.role = 'rim';
    hub.add(rim);
    g.add(hub);
    wheels.push({ hub, tyre, steer: sz > 0, side: sx });
    // arch shadow
    box(trim, 0.1, 0.34, 0.9, sx * (W * 0.5 - 0.01), floor + 0.05, sz * axleZ);
  }

  g.userData.parts = { wheels, axleZ, axleX };
  g.userData.kind = kind;
  g.userData.size = { w: W, l: L };
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
