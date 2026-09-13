/**
 * traffic.js — ambient traffic and pedestrians.
 *
 * Both systems render with InstancedMesh: all the traffic in the city is about
 * twenty draw calls, and forty pedestrians are six. Cars drive a real node
 * graph (city grid joined to the coast road) keeping to the right-hand lane,
 * yielding to whatever is in front of them, and giving the player a wide berth.
 */

import * as THREE from 'three';
import { materials } from './materials.js';
import { CAR_KINDS, CAR_COLORS, carRoleGeometries, wheelGeometries } from './vehicle.js';
import { clamp, wrapAngle, makeRng } from './noise.js';
import * as TEX from './textures.js';

const KINDS = ['sedan', 'suv', 'van', 'taxi', 'pickup', 'sports'];
const LANE = 3.1;                     // metres right of the centre-line
const ACTIVE_RANGE = 260;             // cars further away than this are recycled

/* ------------------------------------------------------------- traffic */

export class TrafficSystem {
  constructor(scene, terrain, physics, graph, quality) {
    this.scene = scene;
    this.terrain = terrain;
    this.physics = physics;
    this.graph = graph;
    this.count = Math.max(0, quality.traffic ?? 16);
    this.rng = makeRng(5150);
    this.cars = [];
    this.group = new THREE.Group();
    this.group.name = 'traffic';
    this.group.userData.dynamic = true;
    scene.add(this.group);

    const m = materials();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._hide = new THREE.Vector3(0, 0, 0);

    // one instanced mesh per (kind, role)
    this.batches = new Map();
    const roleMat = {
      paint: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.5 }),
      trim: new THREE.MeshStandardMaterial({ color: 0x2a2e35, roughness: 0.55, metalness: 0.3 }),
      glass: new THREE.MeshPhysicalMaterial({ color: 0x141c26, roughness: 0.06, metalness: 0.15, transparent: true, opacity: 0.72 }),
      head: new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xffeec0, emissiveIntensity: 0, roughness: 0.2 }),
      tail: new THREE.MeshStandardMaterial({ color: 0xb8262c, emissive: 0xff3020, emissiveIntensity: 0.2, roughness: 0.3 }),
    };
    this.roleMat = roleMat;

    for (const kind of KINDS) {
      const geos = carRoleGeometries(kind, kind.length + 2);
      const perKind = Math.max(2, Math.ceil(this.count / KINDS.length) + 2);
      const set = {};
      for (const [role, geo] of Object.entries(geos)) {
        const inst = new THREE.InstancedMesh(geo, roleMat[role] || roleMat.trim, perKind);
        inst.castShadow = role === 'paint';
        inst.receiveShadow = true;
        inst.frustumCulled = false;
        inst.count = perKind;
        this.group.add(inst);
        set[role] = inst;
      }
      this.batches.set(kind, { set, capacity: perKind, used: 0 });
    }

    const wheels = wheelGeometries();
    const cap = Math.max(4, this.count * 4);
    this.tyres = new THREE.InstancedMesh(wheels.tyre, m.rubber, cap);
    this.rims = new THREE.InstancedMesh(wheels.rim, m.metalLight, cap);
    for (const im of [this.tyres, this.rims]) {
      im.frustumCulled = false;
      im.castShadow = false;
      this.group.add(im);
    }

    this._spawnAll();
  }

  _pickStart() {
    const n = this.graph.nodes;
    for (let tries = 0; tries < 40; tries++) {
      const a = (this.rng() * n.length) | 0;
      if (!n[a].links.length) continue;
      const l = n[a].links[(this.rng() * n[a].links.length) | 0];
      return { from: a, to: l.to };
    }
    return null;
  }

  _spawnAll() {
    for (let i = 0; i < this.count; i++) {
      const kind = KINDS[i % KINDS.length];
      const batch = this.batches.get(kind);
      if (batch.used >= batch.capacity) continue;
      const route = this._pickStart();
      if (!route) break;
      const car = {
        kind, slot: batch.used++, wheelSlot: this.cars.length,
        color: new THREE.Color(CAR_COLORS[(this.rng() * CAR_COLORS.length) | 0]),
        spec: CAR_KINDS[kind],
        from: route.from, to: route.to, t: this.rng(),
        x: 0, z: 0, y: 0, heading: 0, speed: 6 + this.rng() * 6,
        spin: 0, steer: 0, visible: true,
        cruise: 8 + this.rng() * 9,
      };
      this._snap(car);
      this.cars.push(car);
    }
    for (const [, b] of this.batches) {
      for (const inst of Object.values(b.set)) inst.count = b.used;
    }
    // per-car paint colour
    for (const car of this.cars) {
      const b = this.batches.get(car.kind);
      b.set.paint?.setColorAt(car.slot, car.color);
    }
    for (const [, b] of this.batches) if (b.set.paint?.instanceColor) b.set.paint.instanceColor.needsUpdate = true;
  }

  /** Lane-centre point for the current edge at parameter t. */
  _point(car, t, out) {
    const a = this.graph.nodes[car.from], b = this.graph.nodes[car.to];
    let dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    // right-hand side of travel
    const ox = -dz * LANE, oz = dx * LANE;
    out.x = a.x + (b.x - a.x) * t + ox;
    out.z = a.z + (b.z - a.z) * t + oz;
    out.len = len;
    out.dx = dx;
    out.dz = dz;
    return out;
  }

  _snap(car) {
    const p = this._point(car, car.t, {});
    car.x = p.x; car.z = p.z;
    car.heading = Math.atan2(p.dx, p.dz);
    car.y = this.terrain.height(car.x, car.z);
  }

  _advanceEdge(car) {
    const node = this.graph.nodes[car.to];
    const options = node.links.filter(l => l.to !== car.from);
    const pick = options.length ? options[(this.rng() * options.length) | 0]
      : node.links[0];
    car.from = car.to;
    car.to = pick ? pick.to : car.from;
    car.t = 0;
  }

  update(dt, focus) {
    const p = {};
    let wheelIdx = 0;

    for (const car of this.cars) {
      const far = Math.hypot(car.x - focus.x, car.z - focus.z);

      // recycle cars that have wandered out of range
      if (far > ACTIVE_RANGE * 1.6) {
        const route = this._pickStart();
        if (route) {
          const n = this.graph.nodes[route.from];
          if (Math.hypot(n.x - focus.x, n.z - focus.z) < ACTIVE_RANGE) {
            car.from = route.from; car.to = route.to; car.t = 0;
            this._snap(car);
          }
        }
      }

      const visible = far < ACTIVE_RANGE;
      car.visible = visible;

      if (visible) {
        // keep a gap to whatever is directly ahead, and to the player
        let target = car.cruise;
        for (const other of this.cars) {
          if (other === car || !other.visible) continue;
          const dx = other.x - car.x, dz = other.z - car.z;
          const d = Math.hypot(dx, dz);
          if (d > 16) continue;
          const ahead = (dx * Math.sin(car.heading) + dz * Math.cos(car.heading)) / (d || 1);
          if (ahead > 0.75) target = Math.min(target, Math.max(0, (d - 6.5) * 1.5));
        }
        const pd = Math.hypot(focus.x - car.x, focus.z - car.z);
        if (pd < 11) {
          const ahead = ((focus.x - car.x) * Math.sin(car.heading) + (focus.z - car.z) * Math.cos(car.heading)) / (pd || 1);
          if (ahead > 0.6) target = Math.min(target, Math.max(0, (pd - 5.5) * 1.4));
        }

        car.speed += clamp(target - car.speed, -14 * dt, 5.5 * dt);
        car.speed = Math.max(0, car.speed);

        this._point(car, car.t, p);
        car.t += (car.speed * dt) / (p.len || 1);
        while (car.t >= 1) { this._advanceEdge(car); car.t = 0.001; }

        this._point(car, car.t, p);
        const wantHeading = Math.atan2(p.dx, p.dz);
        const turn = wrapAngle(wantHeading - car.heading);
        car.heading += turn * Math.min(1, dt * 5);
        car.steer = clamp(turn * 2.2, -0.5, 0.5);
        car.x = p.x; car.z = p.z;
        car.y = this.physics.groundAt(car.x, car.z, car.y + 1.5);
        car.spin += (car.speed / 0.36) * dt;
      }

      // ---- write instances ----
      const b = this.batches.get(car.kind);
      if (visible) {
        this._e.set(0, car.heading, 0);
        this._q.setFromEuler(this._e);
        this._m.compose(this._p.set(car.x, car.y, car.z), this._q, this._s.set(1, 1, 1));
      } else {
        this._m.compose(this._p.set(0, -9999, 0), this._q.identity(), this._hide.set(0, 0, 0));
      }
      for (const inst of Object.values(b.set)) inst.setMatrixAt(car.slot, this._m);

      // wheels
      const s = car.spec;
      for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
        if (wheelIdx >= this.tyres.count) break;
        if (!visible) {
          this._m.compose(this._p.set(0, -9999, 0), this._q.identity(), this._hide);
        } else {
          const ax = s.w * 0.5 - 0.06, az = s.l * 0.32;
          const wx = car.x + Math.cos(car.heading) * (sx * ax) + Math.sin(car.heading) * (sz * az);
          const wz = car.z - Math.sin(car.heading) * (sx * ax) + Math.cos(car.heading) * (sz * az);
          this._e.set(car.spin, car.heading + (sz > 0 ? -car.steer * 0.7 : 0), 0);
          this._q.setFromEuler(this._e);
          this._m.compose(this._p.set(wx, car.y + 0.36, wz), this._q, this._s.set(1, 1, 1));
        }
        this.tyres.setMatrixAt(wheelIdx, this._m);
        this.rims.setMatrixAt(wheelIdx, this._m);
        wheelIdx++;
      }
    }

    for (const [, b] of this.batches) {
      for (const inst of Object.values(b.set)) inst.instanceMatrix.needsUpdate = true;
    }
    this.tyres.instanceMatrix.needsUpdate = true;
    this.rims.instanceMatrix.needsUpdate = true;
  }

  setNight(night) {
    this.roleMat.head.emissiveIntensity = night > 0.35 ? 1.5 : 0;
    this.roleMat.tail.emissiveIntensity = night > 0.35 ? 1.0 : 0.2;
  }

  dispose() {
    this.group.traverse(o => { if (o.isInstancedMesh) { o.geometry.dispose(); } });
    Object.values(this.roleMat).forEach(m => m.dispose());
    this.scene.remove(this.group);
  }
}

/* --------------------------------------------------------- pedestrians */

/**
 * Sidewalk pedestrians. Six instanced meshes cover the whole crowd; each
 * walker follows the perimeter of a city block with a simple two-beat gait.
 */
export class PedestrianSystem {
  constructor(scene, terrain, city, quality) {
    this.scene = scene;
    this.terrain = terrain;
    this.count = Math.max(0, quality.pedestrians ?? 20);
    this.rng = makeRng(31415);
    this.group = new THREE.Group();
    this.group.name = 'pedestrians';
    this.group.userData.dynamic = true;
    scene.add(this.group);

    const skinTones = [0xf4d4bd, 0xe8bc9a, 0xc98e64, 0x9c6440, 0x6e442a];
    const shirtTones = [0xff7a9c, 0x4f9fd8, 0xf0e6d2, 0x6fbf73, 0xff8b6b, 0x2b2f38, 0xe0b23c, 0x8d6cc4];
    const hairTones = [0x241a12, 0x3a2a1c, 0x6b4a2c, 0xb08f5e, 0x141414, 0x8a5a3a];
    const shoeTones = [0x2b2724, 0x4a4340, 0xdad3c8, 0x6a4a34];

    // One material per surface so every pedestrian shares the same detail and
    // normal maps as the hero characters — only the instance colour changes.
    const matFor = (kind, roughness, normalScale) => {
      const map = TEX.surfaceDetail(kind);
      const normalMap = TEX.surfaceNormal(kind);
      map.repeat.set(2, 3);
      normalMap.repeat.set(2, 3);
      return new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness, map, normalMap,
        normalScale: new THREE.Vector2(normalScale, normalScale),
      });
    };
    this.mats = {
      skin: matFor('skin', 0.58, 0.3),
      knit: matFor('knit', 0.84, 0.6),
      denim: matFor('denim', 0.88, 0.7),
      hair: matFor('hair', 0.44, 0.8),
      leather: matFor('leather', 0.55, 0.8),
    };

    const mk = (geo, mat, count, shadow = false) => {
      const im = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
      im.frustumCulled = false;
      im.castShadow = shadow;
      im.receiveShadow = shadow;
      this.group.add(im);
      return im;
    };
    // Scale is baked into the geometry so that one instanced draw can still
    // give the body non-round proportions.
    const caps = (r, l, sx, sy, sz, seg = 7) =>
      new THREE.CapsuleGeometry(r, l, 2, seg).scale(sx, sy, sz);
    const sph = (r, sx, sy, sz, seg = 10) =>
      new THREE.SphereGeometry(r, seg, seg - 2).scale(sx, sy, sz);

    const n = Math.max(1, this.count);
    const M = this.mats;
    this.parts = {
      torso: mk(caps(0.155, 0.34, 1.22, 1, 0.78), M.knit, n, true),
      hips: mk(caps(0.135, 0.12, 1.15, 1, 0.85), M.denim, n, true),
      shoulders: mk(sph(0.1, 1.78, 0.62, 0.92), M.knit, n),
      head: mk(sph(0.105, 1, 1.14, 1.06, 12), M.skin, n, true),
      hair: mk(new THREE.SphereGeometry(0.112, 12, 9, 0, Math.PI * 2, 0, Math.PI * 0.62)
        .scale(1.03, 1.16, 1.08), M.hair, n, true),
      arms: mk(caps(0.05, 0.4, 1, 1, 0.95), M.skin, n * 2),
      sleeves: mk(caps(0.058, 0.15, 1, 1, 0.95), M.knit, n * 2),
      legs: mk(caps(0.07, 0.42, 1, 1, 0.95), M.denim, n * 2, true),
      shoes: mk(new THREE.BoxGeometry(0.095, 0.065, 0.235), M.leather, n * 2),
    };

    this.peds = [];
    const blocks = city.blocks;
    const pad = 3.0;
    for (let i = 0; i < this.count; i++) {
      const b = blocks[(this.rng() * blocks.length) | 0];
      const hw = b.w / 2 + pad, hd = b.d / 2 + pad;
      const perim = 4 * (hw + hd);
      this.peds.push({
        cx: b.x, cz: b.z, hw, hd, perim,
        s: this.rng() * perim,
        speed: (0.9 + this.rng() * 0.7) * (this.rng() < 0.5 ? 1 : -1),
        phase: this.rng() * 6.28,
        // build varies height and bulk a little so a crowd isn't clones
        tall: 0.93 + this.rng() * 0.14,
        longHair: this.rng() < 0.42,
        x: 0, z: 0, y: 0, heading: 0, visible: true,
      });
    }
    const pick = (arr) => new THREE.Color(arr[(this.rng() * arr.length) | 0]);
    for (let i = 0; i < this.peds.length; i++) {
      const skin = pick(skinTones), shirt = pick(shirtTones);
      const hair = pick(hairTones), shoe = pick(shoeTones);
      const trousers = new THREE.Color().setHSL(0.05 + this.rng() * 0.6, 0.12 + this.rng() * 0.3, 0.18 + this.rng() * 0.4);
      this.parts.head.setColorAt(i, skin);
      this.parts.hair.setColorAt(i, hair);
      this.parts.torso.setColorAt(i, shirt);
      this.parts.shoulders.setColorAt(i, shirt);
      this.parts.hips.setColorAt(i, trousers);
      for (const k of [0, 1]) {
        this.parts.arms.setColorAt(i * 2 + k, skin);
        this.parts.sleeves.setColorAt(i * 2 + k, shirt);
        this.parts.legs.setColorAt(i * 2 + k, trousers);
        this.parts.shoes.setColorAt(i * 2 + k, shoe);
      }
    }
    for (const im of Object.values(this.parts)) if (im.instanceColor) im.instanceColor.needsUpdate = true;

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._zero = new THREE.Vector3(0, 0, 0);
  }

  /** Walk the rectangle perimeter: returns position + facing for arc length s. */
  _walk(p, s) {
    const { hw, hd } = p;
    const w = hw * 2, d = hd * 2;
    let t = ((s % p.perim) + p.perim) % p.perim;
    if (t < w) return { x: p.cx - hw + t, z: p.cz - hd, h: Math.PI / 2 };
    t -= w;
    if (t < d) return { x: p.cx + hw, z: p.cz - hd + t, h: 0 };
    t -= d;
    if (t < w) return { x: p.cx + hw - t, z: p.cz + hd, h: -Math.PI / 2 };
    t -= w;
    return { x: p.cx - hw, z: p.cz + hd - t, h: Math.PI };
  }

  update(dt, focus, time) {
    for (let i = 0; i < this.peds.length; i++) {
      const p = this.peds[i];
      const far = Math.hypot(p.cx - focus.x, p.cz - focus.z);
      const visible = far < 190;
      if (visible) {
        p.s += p.speed * dt;
        const w = this._walk(p, p.s);
        p.x = w.x; p.z = w.z;
        p.y = this.terrain.height(p.x, p.z);
        p.heading = p.speed > 0 ? w.h : w.h + Math.PI;
      }

      const setPart = (im, idx, x, y, z, rx, ry, rz, sx = 1, sy = 1, sz = 1) => {
        if (!visible) {
          this._m.compose(this._p.set(0, -9999, 0), this._q.identity(), this._zero);
        } else {
          this._e.set(rx, ry, rz);
          this._q.setFromEuler(this._e);
          this._m.compose(this._p.set(x, y, z), this._q, this._s.set(sx, sy, sz));
        }
        im.setMatrixAt(idx, this._m);
      };

      const gait = Math.sin(time * 6.5 * Math.sign(p.speed || 1) + p.phase);
      const bob = Math.abs(Math.cos(time * 6.5 + p.phase)) * 0.035;
      const h = p.heading;
      const fwd = { x: Math.sin(h), z: Math.cos(h) };
      const side = { x: Math.cos(h), z: -Math.sin(h) };
      const T = p.tall;
      const base = p.y + bob;
      const at = (yy) => base + yy * T;

      setPart(this.parts.hips, i, p.x, at(0.86), p.z, 0, h, 0);
      setPart(this.parts.torso, i, p.x, at(1.13), p.z, 0.045, h, 0);
      setPart(this.parts.shoulders, i, p.x, at(1.40), p.z, 0.02, h, 0);
      setPart(this.parts.head, i, p.x, at(1.585), p.z, 0, h + Math.sin(time * 0.7 + p.phase) * 0.12, 0);
      setPart(this.parts.hair, i, p.x, at(1.585), p.z,
        0, h + Math.sin(time * 0.7 + p.phase) * 0.12, 0,
        1, p.longHair ? 1.5 : 1, p.longHair ? 1.12 : 1);

      for (const [k, sgn, sx] of [[0, 1, -1], [1, -1, 1]]) {
        const swing = gait * sgn * 0.45;
        const lx = p.x + side.x * sx * 0.085, lz = p.z + side.z * sx * 0.085;
        setPart(this.parts.legs, i * 2 + k,
          lx + fwd.x * swing * 0.24, at(0.47), lz + fwd.z * swing * 0.24, swing, h, 0);
        setPart(this.parts.shoes, i * 2 + k,
          lx + fwd.x * (swing * 0.46 + 0.03), at(0.065) + Math.max(0, swing) * 0.06,
          lz + fwd.z * (swing * 0.46 + 0.03), swing * 0.35, h, 0);
      }
      for (const [k, sgn, sx] of [[0, -1, -1], [1, 1, 1]]) {
        const swing = gait * sgn * 0.4;
        const ax = p.x + side.x * sx * 0.195, az = p.z + side.z * sx * 0.195;
        setPart(this.parts.arms, i * 2 + k,
          ax + fwd.x * swing * 0.2, at(1.16), az + fwd.z * swing * 0.2, swing, h, sx * 0.07);
        setPart(this.parts.sleeves, i * 2 + k,
          ax + fwd.x * swing * 0.09, at(1.30), az + fwd.z * swing * 0.09, swing * 0.5, h, sx * 0.07);
      }
    }
    for (const im of Object.values(this.parts)) im.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    for (const im of Object.values(this.parts)) im.geometry.dispose();
    for (const m of Object.values(this.mats)) m.dispose();
    this.scene.remove(this.group);
  }
}
