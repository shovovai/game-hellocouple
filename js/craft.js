/**
 * craft.js — the two vehicles that are not cars.
 *
 *   makeBoatModel / Boat            a speedboat: planing hull, wake, spray
 *   makeHeliModel / Helicopter      a light helicopter with collective and cyclic
 *
 * Both reuse the swept-body machinery from `vehicle.js`, so a hull and a
 * fuselage are described the same way a car body is: a profile of rings along
 * the length, each a rounded cross-section.
 */

import * as THREE from 'three';
import { materials } from './materials.js';
import { ringOf, sweep, roundBox } from './vehicle.js';
import { clamp, damp, makeRng } from './noise.js';
import * as TEX from './textures.js';

/* ------------------------------------------------------------------ boat */

export const BOAT_SPEC = {
  length: 6.6, beam: 2.35, draft: 0.42,
  maxSpeed: 16, accel: 5.2, turn: 0.95, reverse: 0.35,
};

/**
 * Speedboat: a deep-V forward section flattening to a planing run aft, a
 * wraparound screen, two seats and an outboard.
 */
export function makeBoatModel(color = 0xf2f4f7, seed = 1) {
  const m = materials();
  const rng = makeRng(seed * 53 + 7);
  const g = new THREE.Group();
  g.userData.dynamic = true;

  const hull = new THREE.MeshStandardMaterial({
    color, roughness: 0.24, metalness: 0.35,
    normalMap: TEX.carPaintNormal(), normalScale: new THREE.Vector2(0.12, 0.12),
  });
  const deck = new THREE.MeshStandardMaterial({ color: 0xd9c9a8, roughness: 0.78 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x1d2229, roughness: 0.5, metalness: 0.35 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x9fc4dd, roughness: 0.05, metalness: 0.1,
    transparent: true, opacity: 0.42, side: THREE.DoubleSide,
  });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xcfd6dd, roughness: 0.18, metalness: 0.9 });
  g.userData.mats = { hull, trim };

  const L = BOAT_SPEC.length, B = BOAT_SPEC.beam, HL = L / 2, HB = B / 2;
  const put = (geo, mat, x = 0, y = 0, z = 0, shadow = true) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };

  // hull: [z fraction, beam fraction, keel depth, sheer height]
  const rings = [
    [-1.00, 0.86, -0.20, 0.60],
    [-0.86, 0.98, -0.34, 0.62],
    [-0.45, 1.00, -0.40, 0.62],
    [0.05, 1.00, -0.42, 0.66],
    [0.45, 0.94, -0.44, 0.74],
    [0.72, 0.82, -0.46, 0.82],
    [0.90, 0.62, -0.44, 0.88],
    [1.00, 0.24, -0.34, 0.92],
  ].map(([zf, bf, keel, sheer]) => ({
    z: zf * HL,
    // narrow at the keel, full at the sheer: that is what makes a hull a hull
    pts: ringOf({ hwB: HB * bf * 0.34, hwT: HB * bf, y0: keel, y1: sheer, rB: 0.1, rT: 0.09 }),
  }));
  put(sweep(rings), hull);

  // rubbing strake along the sheer
  for (const sx of [-1, 1]) {
    put(roundBox(0.07, 0.07, L * 0.9, 0.03), trim, sx * HB * 0.97, 0.6, -L * 0.03, false);
  }
  // deck and cockpit sole
  put(roundBox(B * 0.92, 0.05, L * 0.5, 0.05), deck, 0, 0.6, L * 0.2);
  put(roundBox(B * 0.8, 0.05, L * 0.34, 0.05), deck, 0, 0.42, -L * 0.22);

  // wraparound screen
  const screen = put(roundBox(B * 0.78, 0.42, 0.06, 0.03), glass, 0, 0.86, L * 0.1, false);
  screen.rotation.x = -0.3;
  put(roundBox(B * 0.8, 0.06, 0.1, 0.03), chrome, 0, 1.06, L * 0.08, false);

  // console, wheel, two seats
  put(roundBox(0.6, 0.4, 0.4, 0.06), trim, -B * 0.2, 0.8, L * 0.02);
  const wheel = put(new THREE.TorusGeometry(0.16, 0.025, 6, 14), trim, -B * 0.2, 1.02, L * 0.04, false);
  wheel.rotation.x = 1.2;
  const seats = [];
  for (const sx of [-1, 1]) {
    put(roundBox(0.48, 0.12, 0.46, 0.06), trim, sx * B * 0.2, 0.72, -L * 0.06);
    const back = put(roundBox(0.48, 0.46, 0.12, 0.06), trim, sx * B * 0.2, 0.94, -L * 0.16);
    back.rotation.x = -0.14;
    seats.push({ x: sx * B * 0.2, y: 0.66, z: -L * 0.06 });
  }
  // bench aft
  put(roundBox(B * 0.7, 0.12, 0.42, 0.06), trim, 0, 0.56, -L * 0.36);

  // outboard
  put(roundBox(0.42, 0.62, 0.36, 0.08), trim, 0, 0.42, -HL - 0.12);
  put(roundBox(0.14, 0.5, 0.16, 0.05), trim, 0, 0.0, -HL - 0.18);
  put(roundBox(0.1, 0.16, 0.3, 0.04), chrome, 0, -0.24, -HL - 0.26);

  // rails and a small bow light
  for (const sx of [-1, 1]) {
    const rail = put(new THREE.TorusGeometry(0.5, 0.02, 5, 10, Math.PI), chrome, sx * HB * 0.7, 0.68, L * 0.3, false);
    rail.rotation.set(Math.PI / 2, 0, sx > 0 ? 0 : Math.PI);
  }
  put(roundBox(0.1, 0.1, 0.1, 0.04), new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: 0xffe6b0, emissiveIntensity: 0.5, roughness: 0.3,
  }), 0, 0.95, HL - 0.3, false);

  g.userData.seats = { driver: seats[0], passenger: seats[1] };
  g.userData.size = { w: B, l: L };
  return g;
}

/**
 * Boat physics. Planing, not floating: speed builds slowly, turns tighten with
 * speed, and the hull keeps to navigable water. It rides the real wave height
 * so the boat and the sea agree.
 */
export class Boat {
  constructor(model, terrain, water, seaLevel = 0) {
    this.model = model;
    this.terrain = terrain;
    this.water = water;
    this.seaLevel = seaLevel;
    this.spec = BOAT_SPEC;
    this.pos = new THREE.Vector3();
    this.heading = 0;
    this.speed = 0;
    this.steer = 0;
    this.bob = 0;
    this.radius = BOAT_SPEC.beam * 0.55;
    this.wakeT = 0;
  }

  get kmh() { return Math.abs(this.speed) * 3.6; }

  place(x, z, heading = 0) {
    this.pos.set(x, this.seaLevel, z);
    this.heading = heading;
    this.speed = 0;
    this.sync();
  }

  /** Is there enough water here to float? */
  navigable(x, z) {
    return this.terrain.height(x, z) < this.seaLevel - this.spec.draft - 0.25;
  }

  update(dt, input) {
    const s = this.spec;
    const throttle = clamp(input.throttle || 0, -1, 1);
    const steerIn = clamp(input.steer || 0, -1, 1);

    if (input.brake) this.speed = damp(this.speed, 0, 2.4, dt);
    else if (throttle !== 0) {
      const target = s.maxSpeed * throttle * (throttle < 0 ? s.reverse : 1);
      this.speed += clamp(target - this.speed, -s.accel * dt, s.accel * dt);
    } else {
      // a hull off the throttle slows on its own, quickly at first
      this.speed = damp(this.speed, 0, 1.4, dt);
    }
    this.speed = clamp(this.speed, -s.maxSpeed * s.reverse, s.maxSpeed);

    // A boat with no way on cannot steer — the rudder needs water moving past.
    const auth = clamp(Math.abs(this.speed) / 4.5, 0.12, 1);
    this.steer = damp(this.steer, steerIn, 5, dt);
    this.heading -= this.steer * s.turn * auth * dt * Math.sign(this.speed || 1);

    const nx = this.pos.x + Math.sin(this.heading) * this.speed * dt;
    const nz = this.pos.z + Math.cos(this.heading) * this.speed * dt;
    if (this.navigable(nx, nz)) {
      this.pos.x = nx;
      this.pos.z = nz;
    } else {
      // grounding: stop hard rather than beach the player
      this.speed *= -0.2;
    }

    this.bob += dt;
    this.sync();
  }

  sync() {
    const m = this.model;
    const plane = clamp(Math.abs(this.speed) / this.spec.maxSpeed, 0, 1);
    const wave = this.water?.heightAt?.(this.pos.x, this.pos.z, this.bob) ?? 0;
    m.position.set(
      this.pos.x,
      this.seaLevel + wave + 0.02 + Math.sin(this.bob * 1.6) * 0.05 * (1 - plane * 0.7),
      this.pos.z);
    m.rotation.y = this.heading;
    // bow lifts as she gets up on the plane, and she leans into the turn
    m.rotation.x = Math.cos(this.bob * 0.9) * 0.02 * (1 - plane) - plane * 0.09;
    m.rotation.z = Math.sin(this.bob * 1.2) * 0.03 * (1 - plane) - this.steer * 0.2 * plane;
  }

  /** Where the driver steps off: the nearest shore, not the open sea. */
  exitPoint() {
    for (let r = 3; r < 40; r += 2) {
      for (let a = 0; a < 12; a++) {
        const t = (a / 12) * Math.PI * 2;
        const x = this.pos.x + Math.cos(t) * r, z = this.pos.z + Math.sin(t) * r;
        if (this.terrain.height(x, z) > this.seaLevel + 0.4) return { x, z };
      }
    }
    return { x: this.pos.x, z: this.pos.z };
  }
}

/* -------------------------------------------------------------- aircraft */

export const HELI_SPEC = {
  maxSpeed: 34, lift: 9.5, drag: 0.55, yawRate: 1.5, tilt: 0.38, ceiling: 210,
};

/** Light helicopter: cabin, boom, skids, main and tail rotors. */
export function makeHeliModel(color = 0x2b6cb0, seed = 1) {
  const m = materials();
  const g = new THREE.Group();
  g.userData.dynamic = true;

  const body = new THREE.MeshStandardMaterial({
    color, roughness: 0.3, metalness: 0.5,
    normalMap: TEX.carPaintNormal(), normalScale: new THREE.Vector2(0.12, 0.12),
  });
  const trim = new THREE.MeshStandardMaterial({ color: 0x1b2027, roughness: 0.5, metalness: 0.4 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x16202b, roughness: 0.05, metalness: 0.1,
    transparent: true, opacity: 0.5, side: THREE.DoubleSide,
  });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xb9c2cb, roughness: 0.25, metalness: 0.85 });
  g.userData.mats = { body, trim };

  const put = (geo, mat, x = 0, y = 0, z = 0, shadow = true) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };

  // fuselage: a teardrop cabin tapering into a tail boom
  const cab = [
    [-0.62, 0.34, 0.42, 1.30],
    [-0.30, 0.72, 0.26, 1.62],
    [0.05, 0.92, 0.18, 1.78],
    [0.42, 0.96, 0.20, 1.72],
    [0.76, 0.78, 0.34, 1.44],
    [0.98, 0.36, 0.62, 1.06],
  ].map(([z, hw, y0, y1]) => ({
    z: z * 2.6,
    pts: ringOf({ hwB: hw * 0.72, hwT: hw, y0, y1, rB: 0.16, rT: 0.28 }),
  }));
  put(sweep(cab), body);

  // glazed nose
  const nose = [
    [0.42, 0.9, 0.22, 1.68],
    [0.76, 0.74, 0.36, 1.40],
    [0.97, 0.34, 0.62, 1.04],
  ].map(([z, hw, y0, y1]) => ({
    z: z * 2.6 + 0.01,
    pts: ringOf({ hwB: hw * 0.7, hwT: hw * 0.97, y0: y0 + 0.02, y1: y1 - 0.02, rB: 0.14, rT: 0.26 }),
  }));
  put(sweep(nose), glass, 0, 0, 0, false);
  // door windows
  for (const sx of [-1, 1]) {
    put(roundBox(0.04, 0.52, 0.9, 0.03), glass, sx * 0.92, 1.28, 0.1, false);
    put(roundBox(0.03, 0.6, 1.0, 0.02), trim, sx * 0.9, 1.26, 0.1, false);
  }

  // tail boom + fin + stabiliser
  put(roundBox(0.3, 0.3, 3.0, 0.12), body, 0, 1.28, -3.2);
  const fin = put(roundBox(0.1, 1.0, 0.6, 0.06), body, 0, 1.8, -4.5);
  fin.rotation.x = 0.12;
  put(roundBox(1.5, 0.08, 0.42, 0.05), body, 0, 1.42, -4.2);

  // mast and rotor head
  put(roundBox(0.3, 0.34, 0.3, 0.08), trim, 0, 2.0, 0.1);
  put(new THREE.CylinderGeometry(0.09, 0.09, 0.3, 10), chrome, 0, 2.24, 0.1);

  // main rotor — kept in userData so the physics can spin it
  const rotor = new THREE.Group();
  rotor.position.set(0, 2.4, 0.1);
  // Each blade lives in its own hub-centred group: setting a position *and* a
  // rotation on the mesh itself put the root 5 m out and doubled the radius.
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group();
    arm.rotation.y = (i / 4) * Math.PI * 2;
    const blade = new THREE.Mesh(roundBox(0.3, 0.05, 4.6, 0.025), trim);
    blade.position.z = 2.4;
    blade.castShadow = true;
    arm.add(blade);
    rotor.add(arm);
  }
  put(new THREE.TorusGeometry(0.34, 0.05, 6, 12), chrome, 0, 2.4, 0.1, false);
  g.add(rotor);

  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.2, 1.8, -4.5);
  for (let i = 0; i < 3; i++) {
    const arm = new THREE.Group();
    arm.rotation.x = (i / 3) * Math.PI * 2;
    const blade = new THREE.Mesh(roundBox(0.05, 0.72, 0.14, 0.02), trim);
    blade.position.y = 0.4;
    arm.add(blade);
    tailRotor.add(arm);
  }
  g.add(tailRotor);

  // skids
  for (const sx of [-1, 1]) {
    put(roundBox(0.1, 0.1, 3.0, 0.05), chrome, sx * 0.82, 0.1, -0.1);
    for (const sz of [-0.7, 0.7]) {
      const leg = put(roundBox(0.08, 0.62, 0.1, 0.04), chrome, sx * 0.6, 0.42, sz);
      leg.rotation.z = sx * 0.34;
    }
  }

  // nav lights
  const lamp = (c) => new THREE.MeshStandardMaterial({
    color: c, emissive: c, emissiveIntensity: 1.4, roughness: 0.3,
  });
  put(roundBox(0.1, 0.1, 0.1, 0.04), lamp(0xff3b30), -1.0, 1.2, -0.4, false);
  put(roundBox(0.1, 0.1, 0.1, 0.04), lamp(0x30d158), 1.0, 1.2, -0.4, false);

  g.userData.parts = { rotor, tailRotor };
  g.userData.seats = {
    driver: { x: -0.42, y: 1.0, z: 0.55 },
    passenger: { x: 0.42, y: 1.0, z: 0.55 },
  };
  g.userData.size = { w: 2.0, l: 8.0 };
  return g;
}

/**
 * Helicopter flight, simplified to be flyable with four keys and a thumbstick.
 *
 * Collective on jump/brake, cyclic on the movement axes, yaw follows the turn.
 * There is no autorotation and no stall: let go of everything and it settles.
 */
export class Helicopter {
  constructor(model, terrain, physics) {
    this.model = model;
    this.terrain = terrain;
    this.physics = physics;
    this.spec = HELI_SPEC;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.heading = 0;
    this.pitch = 0;
    this.roll = 0;
    this.rotor = 0;          // 0..1 spool
    this.spin = 0;
    this.grounded = true;
    this.radius = 2.2;
  }

  get kmh() { return Math.hypot(this.vel.x, this.vel.z) * 3.6; }
  get altitude() { return this.pos.y - this.terrain.height(this.pos.x, this.pos.z); }

  place(x, z, heading = 0) {
    this.pos.set(x, this.terrain.height(x, z), z);
    this.vel.set(0, 0, 0);
    this.heading = heading;
    this.rotor = 0;
    this.sync();
  }

  /**
   * @param {object} input {throttle, steer, up, down, boost}
   */
  update(dt, input) {
    const s = this.spec;
    // The rotor spools up before it lifts, so taking off is not instant — but
    // a couple of seconds, not ten.
    const want = (input.up || input.throttle || input.steer || !this.grounded) ? 1 : 0.3;
    this.rotor = damp(this.rotor, want, 1.8, dt);
    this.spin += dt * (6 + this.rotor * 46);

    // Once spooled, the rotor exactly cancels gravity, so hands off is a hover
    // and the collective is the only thing that climbs or descends.
    const spooled = this.rotor > 0.7;
    let vy = this.vel.y - 9.2 * dt;
    if (spooled) {
      const collective = input.up ? 1 : input.down ? -0.6 : 0;
      vy += (9.2 + collective * s.lift) * dt;
    }
    this.vel.y = clamp(vy, -14, 12);

    // cyclic: tilt into the direction of travel, and that tilt is the thrust
    const fwd = clamp(input.throttle || 0, -1, 1);
    const side = clamp(input.steer || 0, -1, 1);
    this.pitch = damp(this.pitch, -fwd * s.tilt, 3.2, dt);
    this.roll = damp(this.roll, -side * s.tilt * 0.8, 3.2, dt);
    this.heading -= side * s.yawRate * dt * (this.grounded ? 0.3 : 1);

    if (!this.grounded && spooled) {
      const push = fwd * s.maxSpeed * 0.9;
      this.vel.x = damp(this.vel.x, Math.sin(this.heading) * push, 1.1, dt);
      this.vel.z = damp(this.vel.z, Math.cos(this.heading) * push, 1.1, dt);
    } else {
      this.vel.x = damp(this.vel.x, 0, s.drag * 4, dt);
      this.vel.z = damp(this.vel.z, 0, s.drag * 4, dt);
    }

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;

    // ground and ceiling
    const ground = this.terrain.height(this.pos.x, this.pos.z);
    if (this.pos.y <= ground) {
      this.pos.y = ground;
      if (this.vel.y < -6) { this.vel.x *= 0.2; this.vel.z *= 0.2; }
      this.vel.y = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }
    if (this.pos.y > ground + s.ceiling) {
      this.pos.y = ground + s.ceiling;
      this.vel.y = Math.min(0, this.vel.y);
    }

    this.sync();
  }

  sync() {
    const m = this.model;
    m.position.copy(this.pos);
    m.rotation.set(this.pitch * (this.grounded ? 0.1 : 1), this.heading, this.roll * (this.grounded ? 0.1 : 1));
    const p = m.userData.parts;
    if (p) {
      p.rotor.rotation.y = this.spin;
      p.tailRotor.rotation.x = this.spin * 2.4;
    }
  }

  /** Step out onto whatever is under the skids. */
  exitPoint() {
    const a = this.heading + Math.PI / 2;
    return { x: this.pos.x + Math.cos(a) * 2.6, z: this.pos.z - Math.sin(a) * 2.6 };
  }
}
