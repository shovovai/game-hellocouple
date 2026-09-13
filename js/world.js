/**
 * world.js — assembles the island: roads, rivers, bridges and every location.
 *
 * `build()` is a generator so the loading screen can show real progress while
 * the world is created over several frames instead of freezing the tab.
 *
 * Registries the rest of the game reads:
 *   interactables[]     things you can press E on
 *   collectibleSpots[]  where pickups are spawned
 *   npcSpawns[]         NPC definitions
 *   interiors           Map<id, {spawn, exitTo, group}>
 *   lightPool           a handful of real point lights, reassigned each frame
 */

import * as THREE from 'three';
import { WORLD } from './config.js';
import { materials } from './materials.js';
import * as TEX from './textures.js';
import * as P from './props.js';
import * as BLD from './buildings.js';
import { LAKE } from './terrain.js';
import { makeRng, clamp, smoothstep } from './noise.js';
import { batchStatic } from './batching.js';
import { buildCity } from './city.js';
import { makeCarModel, CAR_COLORS, CAR_KINDS } from './vehicle.js';
import { buildRoadGraph } from './layout.js';

const INTERIOR_ORIGIN = new THREE.Vector3(4000, 0, 4000);
const M = () => materials();

/* ---------------------------------------------------------- light pool */

/**
 * Three.js uses physical light units since r155, so the readable intensities
 * the world builders pass (1-3) have to be scaled into candela to actually
 * light anything.
 */
const LIGHT_SCALE = 19;

class LightPool {
  constructor(scene, count) {
    this.sources = [];
    this.lights = [];
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 1.7);
      l.castShadow = false;
      l.visible = false;
      scene.add(l);
      this.lights.push(l);
    }
    this._sorted = [];
  }

  add(src) { this.sources.push(src); return src; }

  update(focus, night, dt) {
    const list = this._sorted;
    list.length = 0;
    for (const s of this.sources) {
      if (s.night && night < 0.25) continue;
      if (s.day && night > 0.4) continue;
      const d = (s.x - focus.x) ** 2 + (s.z - focus.z) ** 2;
      if (d > 4900) continue;                       // 70 m cull
      s._d = d;
      list.push(s);
    }
    list.sort((a, b) => a._d - b._d);
    for (let i = 0; i < this.lights.length; i++) {
      const l = this.lights[i], s = list[i];
      if (!s) { l.visible = false; l.intensity = 0; continue; }
      l.visible = true;
      l.position.set(s.x, s.y, s.z);
      l.color.setHex(s.color);
      l.distance = s.distance * 1.35;
      const flicker = s.fire ? 0.78 + Math.sin(performance.now() * 0.011 + s.x) * 0.12 + Math.random() * 0.12 : 1;
      const nightMul = s.night === false ? 1 : clamp(night * 1.6, s.fire ? 0.55 : 0, 1);
      l.intensity = s.intensity * LIGHT_SCALE * flicker * (s.always ? 1 : nightMul);
    }
  }
}

/* ------------------------------------------------------------- helpers */

/** Ribbon mesh (roads, rivers, paths) following a polyline. */
function ribbon(points, width, yFn, lift = 0.05, uvRepeat = 0.25) {
  const pos = [], uvs = [], idx = [];
  const n = points.length;
  let run = 0;
  for (let i = 0; i < n; i++) {
    const [x, z] = points[i];
    const [px, pz] = points[Math.max(0, i - 1)];
    const [nx, nz] = points[Math.min(n - 1, i + 1)];
    let dx = nx - px, dz = nz - pz;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    if (i > 0) run += Math.hypot(x - px, z - pz);
    const ox = -dz * width * 0.5, oz = dx * width * 0.5;
    pos.push(x + ox, yFn(x + ox, z + oz) + lift, z + oz,
             x - ox, yFn(x - ox, z - oz) + lift, z - oz);
    uvs.push(0, run * uvRepeat, 1, run * uvRepeat);
    if (i < n - 1) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export class World {
  constructor(scene, terrain, physics, quality, water, veg, locations, network) {
    this.scene = scene;
    this.terrain = terrain;
    this.physics = physics;
    this.quality = quality;
    this.water = water;
    this.veg = veg;
    this.L = locations;
    this.network = network;

    this.static = new THREE.Group();
    this.static.name = 'world-static';
    scene.add(this.static);
    this.dynamic = new THREE.Group();
    this.dynamic.name = 'world-dynamic';
    this.dynamic.userData.dynamic = true;
    scene.add(this.dynamic);

    // A city needs more than a handful of pooled lights to read at night.
    this.lightPool = new LightPool(scene, quality.name === 'high' ? 14 : quality.shadows ? 9 : 5);
    this.interactables = [];
    this.collectibleSpots = [];
    this.npcSpawns = [];
    this.interiors = new Map();
    /** Where fast travel and the initial spawn should put the player. */
    this.arrivals = new Map();
    this.animated = [];              // {update(dt)}
    this.signs = [];
    this.rng = makeRng(20240501);
    this._interiorIndex = 0;
    this.stats = {};
  }

  /* ------------------------------------------------------- placement */

  ground(x, z) { return this.terrain.height(x, z); }

  /** Place a prop group, register its colliders and lights. */
  place(group, x, z, ry = 0, opts = {}) {
    const y = opts.y !== undefined ? opts.y : this.ground(x, z);
    group.position.set(x, y + (opts.lift || 0), z);
    group.rotation.y = ry;
    (opts.dynamic ? this.dynamic : this.static).add(group);

    const cos = Math.cos(ry), sin = Math.sin(ry);
    const toWorld = (lx, lz) => ({ x: x + lx * cos + lz * sin, z: z - lx * sin + lz * cos });

    for (const c of group.userData.cols || []) {
      const w = toWorld(c.x || 0, c.z || 0);
      if (opts.noCollide) break;
      if (c.k === 'c') {
        this.physics.addCylinder(w.x, w.z, c.r, y - 1, y + (c.h || 40));
      } else if (c.k === 'b') {
        this.physics.addBox(w.x, w.z, c.w, c.d, ry + (c.rot || 0), y - 1, y + (c.h || 40));
      } else if (c.k === 'p') {
        this.physics.addPlatform(w.x, w.z, c.w, c.d, y + (opts.lift || 0) + c.y, ry + (c.rot || 0), opts.interior);
      }
    }
    const lights = [];
    if (group.userData.light) lights.push(group.userData.light);
    if (group.userData.lights) lights.push(...group.userData.lights);
    for (const l of lights) {
      const w = toWorld(l.x || 0, l.z || 0);
      this.lightPool.add({ ...l, x: w.x, y: y + (opts.lift || 0) + (l.y || 0), z: w.z });
    }
    return group;
  }

  /** Record a safe arrival point for a location (fast travel target). */
  arrive(id, x, z, yaw = null) {
    this.arrivals.set(id, { x, z, yaw });
  }

  /**
   * Nearest standable, unobstructed spot — stops fast travel from dropping the
   * player inside a café wall.
   */
  safeSpot(x, z) {
    for (let r = 0; r <= 34; r += 1.6) {
      const steps = r === 0 ? 1 : Math.max(10, Math.round(r * 1.6));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2 + r * 0.7;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        const g = this.physics.groundAt(px, pz, 1e9);
        if (g < 0.35) continue;
        if (!this.physics.isBlocked(px, g + 1.0, pz, 0.65)) return { x: px, z: pz };
      }
    }
    return { x, z };
  }

  /** Register something the player can press E on. */
  interact(o) {
    const it = {
      id: o.id || ('i' + this.interactables.length),
      x: o.x, y: o.y ?? this.ground(o.x, o.z), z: o.z,
      r: o.r ?? 2.6,
      label: o.label || 'Interact',
      kind: o.kind || 'generic',
      data: o.data || {},
      once: !!o.once,
      used: false,
      enabled: o.enabled !== false,
    };
    this.interactables.push(it);
    return it;
  }

  drop(type, x, z, y = null, hidden = false) {
    this.collectibleSpots.push({ type, x, z, y: y ?? this.ground(x, z), hidden });
  }

  /* ------------------------------------------------------------ build */

  /**
   * Hand the world a cached scatter. Vegetation calls made during the build are
   * then dropped and the recording is replayed instead, which skips the slope,
   * path and physics probes that make scattering slow.
   */
  useVegetationCache(snap) {
    this._vegReplay = snap;
    this.veg.mute = true;
  }

  *build(onProgress) {
    if (!this._vegReplay) this.veg.record();
    const steps = [
      ['Carving roads', () => this.buildRoads()],
      ['Filling the rivers', () => this.buildRivers()],
      ['Raising the town', () => this.buildTown()],
      ['Pouring the streets', () => this.buildCityDistrict()],
      ['Parking the cars', () => this.buildDrivableCars()],
      ['Brewing the coffee', () => this.buildCafe()],
      ['Planting the park', () => this.buildPark()],
      ['Spreading the picnic', () => this.buildPicnic()],
      ['Raking the sand', () => this.buildBeaches()],
      ['Building the pier', () => this.buildPier()],
      ['Finding the viewpoint', () => this.buildViewpoint()],
      ['Growing the forest', () => this.buildForest()],
      ['Filling the lake', () => this.buildLake()],
      ['Hiding the waterfall', () => this.buildWaterfall()],
      ['Lighting the lighthouse', () => this.buildLighthouse()],
      ['Pitching the tents', () => this.buildCampsite()],
      ['Scattering the houses', () => this.buildHouses()],
      ['Planting trees', () => this.scatterVegetation()],
      ['Adding the details', () => this.scatterDetails()],
      ['Hiding the treasures', () => this.placeCollectibles()],
      ['Waking the islanders', () => this.placeNPCs()],
      ['Furnishing the interiors', () => this.buildInteriors()],
      ['Packing it all up', () => this.finalize()],
    ];
    for (let i = 0; i < steps.length; i++) {
      const [label, fn] = steps[i];
      fn();
      yield { t: (i + 1) / steps.length, label };
    }
  }

  /* ------------------------------------------------------------ roads */

  buildRoads() {
    const m = M();
    const yFn = (x, z) => this.terrain.height(x, z);
    for (const road of this.network.roads) {
      if (road.city) continue;            // downtown streets are drawn by city.js
      const isRoad = road.kind === 'road';
      const geo = ribbon(road.pts, road.width, yFn, 0.08, 0.12);
      const mesh = new THREE.Mesh(geo, isRoad ? m.asphalt : m.dirtPath);
      mesh.receiveShadow = true;
      this.static.add(mesh);

      if (isRoad) {
        // sidewalks
        for (const side of [-1, 1]) {
          const off = road.pts.map((p, i) => {
            const a = road.pts[Math.max(0, i - 1)], b = road.pts[Math.min(road.pts.length - 1, i + 1)];
            let dx = b[0] - a[0], dz = b[1] - a[1];
            const l = Math.hypot(dx, dz) || 1;
            return [p[0] - (dz / l) * side * (road.width * 0.5 + 0.85),
                    p[1] + (dx / l) * side * (road.width * 0.5 + 0.85)];
          });
          const sw = new THREE.Mesh(ribbon(off, 1.8, yFn, 0.16, 0.5), m.paving);
          sw.receiveShadow = true;
          this.static.add(sw);
        }
        // centre dashes
        const dash = [];
        for (let i = 0; i < road.pts.length - 1; i += 2) dash.push(road.pts[i]);
        if (dash.length > 2) {
          for (let i = 0; i + 1 < dash.length; i += 2) {
            const seg = [dash[i], dash[i + 1]];
            const dm = new THREE.Mesh(ribbon(seg, 0.24, yFn, 0.11, 0.5),
              new THREE.MeshStandardMaterial({ color: 0xe8e2d0, roughness: 0.85 }));
            dm.receiveShadow = true;
            this.static.add(dm);
          }
        }
      }
    }
  }

  /* ----------------------------------------------------------- rivers */

  buildRivers() {
    for (const r of this.network.rivers) {
      this.water.addRiver(r.pts, r.width, 0.25);
      // rocks along the banks
      for (let i = 2; i < r.pts.length - 2; i += 3) {
        const [x, z] = r.pts[i];
        const [px, pz] = r.pts[i - 1];
        let dx = x - px, dz = z - pz;
        const l = Math.hypot(dx, dz) || 1;
        dx /= l; dz /= l;
        for (const side of [-1, 1]) {
          if (this.rng() > 0.65) continue;
          const ox = -dz * side * (r.width * 0.55 + 0.6 + this.rng());
          const oz = dx * side * (r.width * 0.55 + 0.6 + this.rng());
          const rx = x + ox, rz = z + oz;
          this.veg.addRock(rx, this.ground(rx, rz) - 0.15, rz, 0.5 + this.rng() * 0.8,
            this.rng() * 6.28, i % 3);
        }
      }
    }

    // bridges wherever a road crosses a river
    for (const road of this.network.roads) {
      for (const river of this.network.rivers) {
        const cross = this._findCrossing(road.pts, river.pts);
        if (!cross) continue;
        const style = road.kind === 'road' ? (this.rng() > 0.5 ? 'stone' : 'road') : 'wood';
        const span = river.width + 8;
        const b = BLD.makeBridge(span, road.width + 1.4, style, 0.55);
        const y = Math.max(
          this.ground(cross.x + Math.sin(cross.ang) * span * 0.5, cross.z + Math.cos(cross.ang) * span * 0.5),
          this.ground(cross.x - Math.sin(cross.ang) * span * 0.5, cross.z - Math.cos(cross.ang) * span * 0.5)
        );
        this.place(b, cross.x, cross.z, cross.ang, { y: y - 0.1 });
      }
    }
  }

  _findCrossing(a, b) {
    for (let i = 0; i < a.length - 1; i++) {
      for (let j = 0; j < b.length - 1; j++) {
        const p1 = a[i], p2 = a[i + 1], p3 = b[j], p4 = b[j + 1];
        const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
        if (Math.abs(d) < 1e-6) continue;
        const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
        const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
          return {
            x: p1[0] + (p2[0] - p1[0]) * t,
            z: p1[1] + (p2[1] - p1[1]) * t,
            ang: Math.atan2(p2[0] - p1[0], p2[1] - p1[1]),
          };
        }
      }
    }
    return null;
  }

  /* ------------------------------------------------------------- town */

  buildTown() {
    // Downtown itself is generated by city.js; this pass only places the civic
    // bits that need to know about gameplay — the shop, the signage and the
    // people.
    const t = this.L.get('town');
    this.townCenter = { x: t.x, z: t.z };
    const city = this.network.city;
    const Y = this.ground(t.x, t.z);

    // A shop entrance on the plaza's edge, and a signpost by the kerb.
    const shopBlock = city.blocks.find(b => b.ring === 1) || city.blocks[0];
    const sx = shopBlock.x, sz = shopBlock.z + shopBlock.d / 2 + 5.6;
    this.interact({
      x: sx, y: Y, z: sz, r: 4.0, kind: 'shop',
      label: 'Browse the shop', data: { name: 'City Outfitters' },
    });
    this.place(P.makeSignPost(['DOWNTOWN', 'Beach ↓   Park →'], 2.6), t.x + 16, t.z + 28, 0.4, { y: Y });

    // Arrive on the plaza, not in the middle of a block.
    const plaza = city.blocks.find(b => b.kind === 'plaza') || city.blocks[0];
    this.arrive('town', plaza.x, plaza.z + plaza.d / 2 - 6,
      Math.atan2(0, -(plaza.d / 2 - 6)));

    this.npcSpawns.push({
      id: 'stroller', name: 'Kes', role: 'walk',
      x: t.x - 46, z: t.z + 40, wander: 26,
      look: { skin: '#6e442a', hair: '#2b2119', shirt: '#f0e6d2', pants: '#bda37a', hairStyle: 'short' },
      lines: [['Morning! Grab a car if you are heading out of town — the coast road is worth it.',
               ['Good idea', 'Where should I go?']],
              ['Everything connects by the ring road. You cannot really get lost.', ['Thanks!']]],
    });
    this.npcSpawns.push({
      id: 'shopkeeper', name: 'Wen', role: 'stand',
      x: sx + 3, z: sz + 1.5, wander: 0,
      look: { skin: '#c98e64', hair: '#946b3f', shirt: '#4f9fd8', pants: '#3c5a80', hairStyle: 'short' },
      lines: [['Coins buy clothes and emotes. Cars are free — just press E at one.',
               ['Good to know', 'Where should I go?']],
              ['Five secrets hide out on the island. The waterfall is my favourite.', ['Thanks!']]],
    });
  }

  /**
   * Cars the player can actually drive. They are dynamic (never batched) and
   * each registers its own "Drive" prompt; main.js wraps them in a Vehicle.
   */
  buildDrivableCars() {
    const city = this.network.city;
    const kinds = Object.keys(CAR_KINDS);
    this.drivableCars = [];

    const spots = [];
    // A row in the kerb lane of the street south of the plaza — clear of the
    // parked cars, and the first thing you see when you spawn.
    const plaza = city.blocks.find(b => b.kind === 'plaza') || city.blocks[0];
    const laneZ = city.streetZ.reduce((best, z) =>
      Math.abs(z - (plaza.z + plaza.d / 2)) < Math.abs(best - (plaza.z + plaza.d / 2)) ? z : best, city.streetZ[0]);
    for (let i = 0; i < 4; i++) {
      spots.push({ x: plaza.x - 21 + i * 13, z: laneZ + 3.0, ry: Math.PI / 2, kind: kinds[i % kinds.length] });
    }
    // and one parked at most major locations, so you are never stranded
    for (const id of ['beach', 'pier', 'park', 'lighthouse', 'campsite', 'sunsetBeach', 'forest', 'lake']) {
      const loc = this.L.get(id);
      if (!loc) continue;
      const a = Math.atan2(loc.z, loc.x);
      const spot = this.safeSpot(loc.x - Math.cos(a) * 12, loc.z - Math.sin(a) * 12);
      spots.push({ x: spot.x, z: spot.z, ry: a + Math.PI / 2, kind: kinds[(this.rng() * kinds.length) | 0] });
    }

    spots.forEach((s, i) => {
      const y = this.ground(s.x, s.z);
      if (y < 0.6) return;
      const color = CAR_COLORS[(this.rng() * CAR_COLORS.length) | 0];
      const model = makeCarModel(s.kind, color, i + 11);
      model.position.set(s.x, y, s.z);
      model.rotation.y = s.ry;
      this.dynamic.add(model);
      const car = { model, kind: s.kind, x: s.x, z: s.z, y, heading: s.ry, index: this.drivableCars.length };
      this.drivableCars.push(car);
      this.interact({
        x: s.x, y, z: s.z, r: 4.2, kind: 'drive',
        label: 'Drive', data: { car },
      });
    });
  }

  /** Downtown: streets, blocks, towers, furniture — see city.js. */
  buildCityDistrict() {
    this.cityStats = buildCity(this, this.network.city);
    this.roadGraph = buildRoadGraph(this.network.city, this.network.roads);
  }

  /* ------------------------------------------------------------- café */

  buildCafe() {
    const m = M();
    const c = this.L.get('cafe');
    // Downtown reserved a block for the café — use it so the two never overlap.
    const block = this.network.city?.blocks.find(b => b.reservedFor === 'cafe');
    if (block) { c.x = block.x; c.z = block.z; c.y = this.ground(block.x, block.z); }
    const face = Math.atan2(this.townCenter.x - c.x, this.townCenter.z - c.z);
    const cafe = BLD.makeCafe();
    this.place(cafe, c.x, c.z, face);
    this.cafeSignMat = cafe.userData.signMat;

    const cos = Math.cos(face), sin = Math.sin(face);
    const fwd = (lx, lz) => ({ x: c.x + lx * cos + lz * sin, z: c.z - lx * sin + lz * cos });

    // terrace
    const pad = new THREE.Mesh(new THREE.CircleGeometry(11, 28).rotateX(-Math.PI / 2), m.paving);
    pad.position.set(c.x, this.ground(c.x, c.z) + 0.09, c.z);
    pad.receiveShadow = true;
    this.static.add(pad);

    // Terrace tables sit either side of the doorway, never across it: the path
    // in and out of the café has to stay clear of their interaction radius.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 2; i++) {
        const lx = side * (3.3 + i * 3.0);
        const p = fwd(lx, -7.2 - i * 1.4);
        this.place(P.makeTable(1.15, 1.15, 0.74, true), p.x, p.z, face);
        this.place(P.makeUmbrella(m.fabricRose, 2.45), p.x, p.z, face);
        for (const s of [-1, 1]) {
          const q = fwd(lx + s * 1.05, -7.2 - i * 1.4);
          this.place(P.makeChair(), q.x, q.z, face + (s > 0 ? Math.PI / 2 : -Math.PI / 2));
        }
        this.interact({
          x: p.x, z: p.z, r: 2.1, kind: 'sit', label: 'Sit at the table',
          data: { seat: { x: 0, y: 0.5, z: 1.0 }, yaw: face + Math.PI, couple: true,
                  offset: fwd(lx, -8.3 - i * 1.4) },
        });
      }
    }

    const door = fwd(cafe.userData.doorAt.x, cafe.userData.doorAt.z);
    this.interact({
      id: 'cafe-door', x: door.x, z: door.z, r: 4.2, kind: 'enter',
      label: 'Enter Café', data: { interior: 'cafe' },
    });
    // Step out a few metres in front of the door: a third-person camera sits
    // behind the player, and right on the threshold that is inside the wall.
    const stand = fwd(0, cafe.userData.doorAt.z - 3.2);
    this.cafeDoor = { x: stand.x, z: stand.z, yaw: face };
    this.arrive('cafe', stand.x, stand.z, face);

    const s1 = P.makeSignPost(['HELLOCOUPLE CAFÉ', 'Open every day'], 2.4);
    const sp = fwd(-7, -9);
    this.place(s1, sp.x, sp.z, face);

    this.npcSpawns.push({
      id: 'barista-out', name: 'Marlo', role: 'cafe',
      x: fwd(5.5, -7.5).x, z: fwd(5.5, -7.5).z, wander: 3,
      look: { skin: '#c98e64', hair: '#2b2119', shirt: '#f0e6d2', pants: '#2b2f38', hairStyle: 'short' },
      lines: [
        ['Two coffees on the terrace? Best seat on the island.', ['Sounds perfect', 'Where should I go?']],
        ['Head down the south road for the beach. The lighthouse is east.', ['Thanks!']],
      ],
    });
  }

  /* ------------------------------------------------------------- park */

  buildPark() {
    const m = M();
    const p = this.L.get('park');
    const rng = this.rng;

    const lawn = new THREE.Mesh(new THREE.CircleGeometry(34, 36).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: TEX.grassTexture(), color: 0xc9e0b4, roughness: 0.97 }));
    lawn.position.set(p.x, this.ground(p.x, p.z) + 0.06, p.z);
    lawn.receiveShadow = true;
    this.static.add(lawn);

    // little fountain + gazebo
    const f = P.makeFountain(2.2);
    this.place(f, p.x, p.z, 0);
    this.animated.push({ update: (dt) => { if (f.userData.jets) f.userData.jets.rotation.y -= dt * 0.3; } });
    this.interact({ x: p.x, z: p.z, r: 4, kind: 'fountain', label: 'Toss a coin', data: { name: 'Park Fountain' } });

    const gazebo = BLD.makeGazebo(3.4);
    this.place(gazebo, p.x - 15, p.z + 9, 0.4);
    this.lightPool.add({ x: p.x - 15, y: 3.2, z: p.z + 9, color: 0xffd9a0, intensity: 1.3, distance: 13, night: true });
    this.interact({
      x: p.x - 15, z: p.z + 9, r: 3.4, kind: 'sit', label: 'Rest in the gazebo',
      data: { seat: { x: 0, y: 0.75, z: 0 }, yaw: 0.4 },
    });

    // benches around a ring path
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.25;
      const bx = p.x + Math.cos(a) * 13, bz = p.z + Math.sin(a) * 13;
      const bench = P.makeBench(2.0);
      this.place(bench, bx, bz, -a + Math.PI / 2);
      this.interact({
        x: bx, z: bz, r: 2.2, kind: 'sit', label: 'Sit together',
        data: { seat: bench.userData.seat, yaw: -a + Math.PI / 2, couple: true },
      });
      this.place(P.makeStreetLamp(4.2), p.x + Math.cos(a + 0.5) * 19, p.z + Math.sin(a + 0.5) * 19, 0);
      this.place(P.makeTrashBin(), p.x + Math.cos(a + 0.7) * 15, p.z + Math.sin(a + 0.7) * 15, 0);
    }

    // playground
    const pl = P.makePlayground();
    this.place(pl, p.x + 16, p.z - 8, 0.8);
    this.animated.push({
      update: (dt, time) => {
        for (const sw of pl.userData.swings || []) sw.rotation.x = Math.sin(time * 1.1 + sw.position.z) * 0.22;
      },
    });

    // picnic tables + flowers
    for (let i = 0; i < 3; i++) {
      const a = 2.2 + i * 0.6;
      const tx = p.x + Math.cos(a) * 20, tz = p.z + Math.sin(a) * 20;
      const pt = P.makePicnicTable();
      this.place(pt, tx, tz, -a);
      this.interact({
        x: tx, z: tz, r: 2.4, kind: 'sit', label: 'Sit at the table',
        data: { seat: pt.userData.seat, yaw: -a },
      });
    }

    // flower beds
    for (let i = 0; i < 90; i++) {
      const a = rng() * Math.PI * 2, r = 8 + rng() * 24;
      const fx = p.x + Math.cos(a) * r, fz = p.z + Math.sin(a) * r;
      const kind = ['rose', 'white', 'gold'][i % 3];
      this.veg.addFlower(fx, this.ground(fx, fz), fz, kind, 0.65 + rng() * 0.5, rng() * 6.28);
    }

    this.arrive('park', p.x + 18, p.z + 10, Math.atan2(-18, -10));
    this.npcSpawns.push({
      id: 'park-visitor', name: 'Nell', role: 'walk',
      x: p.x + 8, z: p.z + 12, wander: 14,
      look: { skin: '#f4d4bd', hair: '#946b3f', shirt: '#6fbf73', pants: '#bda37a', hairStyle: 'long' },
      lines: [
        ['Beautiful day, isn\'t it?', ['Yes!', 'Where should I go?']],
        ['Follow the coast road west and you will find Sunset Point. Go at sunset.', ['Thank you!']],
      ],
    });
  }

  buildPicnic() {
    const m = M();
    const p = this.L.get('picnic');
    const bl = P.makeBlanket();
    this.place(bl, p.x, p.z, 0.5);
    this.place(P.makeBasket(), p.x + 1.0, p.z + 0.6, 0.9);
    const bench = P.makeBench(1.9);
    this.place(bench, p.x - 3.6, p.z - 1.2, 1.1);
    this.interact({
      x: p.x, z: p.z, r: 3.0, kind: 'picnic', label: 'Have a picnic',
      data: { name: 'Picnic Meadow' },
    });
    for (let i = 0; i < 60; i++) {
      const a = this.rng() * 6.28, r = 3 + this.rng() * 16;
      const fx = p.x + Math.cos(a) * r, fz = p.z + Math.sin(a) * r;
      this.veg.addFlower(fx, this.ground(fx, fz), fz, ['rose', 'white', 'gold'][i % 3], 0.65 + this.rng() * 0.45, this.rng() * 6.28);
    }
    this.place(P.makeSignPost(['PICNIC MEADOW'], 1.8), p.x - 6, p.z + 5, 0.8);
    this.arrive('picnic', p.x + 5, p.z + 5, Math.atan2(-5, -5));
  }

  /* ---------------------------------------------------------- beaches */

  /** Outward (seaward) and tangent unit vectors for a coastal location. */
  _coast(loc) {
    const len = Math.hypot(loc.x, loc.z) || 1;
    const ox = loc.x / len, oz = loc.z / len;
    return { ox, oz, tx: -oz, tz: ox, ang: Math.atan2(ox, oz) };
  }

  buildBeaches() {
    const m = M();
    const specs = [
      { id: 'beach', span: 46, chairs: 5, umbrellas: 3, palms: 16, shells: 16 },
      { id: 'sunsetBeach', span: 38, chairs: 4, umbrellas: 2, palms: 12, shells: 12 },
      { id: 'hiddenBeach', span: 20, chairs: 1, umbrellas: 1, palms: 6, shells: 10 },
    ];
    for (const sp of specs) {
      const loc = this.L.get(sp.id);
      const c = this._coast(loc);
      const at = (t, inward) => ({
        x: loc.x + c.tx * t - c.ox * inward,
        z: loc.z + c.tz * t - c.oz * inward,
      });

      for (let i = 0; i < sp.chairs; i++) {
        const t = (i / Math.max(1, sp.chairs - 1) - 0.5) * sp.span;
        const p = at(t + (this.rng() - 0.5) * 4, -2 - this.rng() * 3);
        const chair = P.makeBeachChair(i % 2 ? m.fabricSun : m.fabricRose);
        this.place(chair, p.x, p.z, c.ang + Math.PI + (this.rng() - 0.5) * 0.5);
        this.interact({
          x: p.x, z: p.z, r: 2.0, kind: 'sit', label: 'Relax on the chair',
          data: { seat: chair.userData.seat, yaw: c.ang + Math.PI, sunset: sp.id !== 'beach' },
        });
      }
      for (let i = 0; i < sp.umbrellas; i++) {
        const t = (i / Math.max(1, sp.umbrellas - 1) - 0.5) * sp.span * 0.8;
        const p = at(t + 2.4, -1);
        this.place(P.makeUmbrella(i % 2 ? m.fabricRed : m.fabricBlue, 2.6), p.x, p.z, 0);
        const q = at(t - 1.6, 3);
        this.place(P.makeTowel(i % 2 ? m.fabricBlue : m.fabricRose), q.x, q.z, this.rng() * 3);
      }
      this.arrive(sp.id, at(0, 7).x, at(0, 7).z, Math.atan2(-c.ox, -c.oz) + Math.PI);
      const ball = at(sp.span * 0.2, 0);
      this.place(P.makeBeachBall(), ball.x, ball.z, 0);
      const surf = at(-sp.span * 0.3, 6);
      this.place(P.makeSurfboard(), surf.x, surf.z, c.ang);

      // palms + driftwood + rocks
      for (let i = 0; i < sp.palms; i++) {
        const p = at((this.rng() - 0.5) * sp.span * 1.8, 8 + this.rng() * 26);
        const h = this.ground(p.x, p.z);
        if (h < 1.6 || h > 12) continue;
        this.veg.addTree('palm', p.x, h, p.z, 0.85 + this.rng() * 0.5, this.rng() * 6.28, (this.rng() - 0.5) * 0.12);
      }
      for (let i = 0; i < 10; i++) {
        const p = at((this.rng() - 0.5) * sp.span * 2.0, -6 + this.rng() * 14);
        const h = this.ground(p.x, p.z);
        this.veg.addRock(p.x, h - 0.1, p.z, 0.4 + this.rng() * 1.5, this.rng() * 6.28, i % 3);
      }
      for (let i = 0; i < sp.shells; i++) {
        const p = at((this.rng() - 0.5) * sp.span * 1.7, -4 + this.rng() * 8);
        this.drop('shell', p.x, p.z, null, sp.id === 'hiddenBeach');
      }
      for (let i = 0; i < 4; i++) {
        const p = at((this.rng() - 0.5) * sp.span, 1 + this.rng() * 5);
        this.place(P.makeLogSeat(1.4 + this.rng()), p.x, p.z, this.rng() * 3);
      }

      if (sp.id === 'sunsetBeach') {
        const p = at(0, -4);
        this.interact({
          x: p.x, z: p.z, r: 5, kind: 'sunset', label: 'Watch the sunset',
          data: { name: 'Sunset Beach' },
        });
        this.place(P.makeSignPost(['SUNSET BEACH'], 2.0), at(sp.span * 0.5, 12).x, at(sp.span * 0.5, 12).z, c.ang + Math.PI);
      }
      if (sp.id === 'beach') {
        this.place(P.makeSignPost(['BEACH', 'Please keep it clean'], 2.2), at(sp.span * 0.55, 14).x, at(sp.span * 0.55, 14).z, c.ang + Math.PI);
        this.npcSpawns.push({
          id: 'tourist', name: 'Rin', role: 'walk', x: at(6, 4).x, z: at(6, 4).z, wander: 10,
          look: { skin: '#9c6440', hair: '#5b3a26', shirt: '#4f9fd8', pants: '#f0e6d2', hairStyle: 'bun' },
          lines: [['The water is perfect today. Have you tried the café in town?', ['Not yet', 'Where should I go?']],
                  ['The pier is east along the shore. Great fishing.', ['Thanks!']]],
        });
      }
      if (sp.id === 'hiddenBeach') {
        this.drop('star', at(0, -1).x, at(0, -1).z, null, true);
        const chest = P.makeChest();
        const cp = at(4, 5);
        this.place(chest, cp.x, cp.z, c.ang + Math.PI, { dynamic: true });
        this.interact({
          x: cp.x, z: cp.z, r: 2.2, kind: 'chest', label: 'Open the chest', once: true,
          data: { group: chest, reward: { coins: 120, hearts: 25 }, name: 'Cove Treasure' },
        });
      }
    }
  }

  /* ------------------------------------------------------------- pier */

  buildPier() {
    const m = M();
    const loc = this.L.get('pier');
    const c = this._coast(loc);
    const length = 44;
    const deckY = WORLD.seaLevel + 2.5;
    const baseY = this.ground(loc.x, loc.z);

    const pier = BLD.makePier(length, 5.4, baseY, deckY - baseY);
    this.place(pier, loc.x, loc.z, c.ang + Math.PI, { y: baseY });

    // ramp from the sand up to the deck
    const rampA = { x: loc.x - c.ox * 1.5, z: loc.z - c.oz * 1.5 };
    this.physics.addStairs(rampA.x, rampA.z, baseY, loc.x + c.ox * 3.5, loc.z + c.oz * 3.5, deckY, 5.0, 6);
    const ramp = P.B(m.plankWorn, 5.2, 0.16, 6.5, 0, 0, 0);
    const rampG = P.grp();
    rampG.add(ramp);
    ramp.rotation.x = Math.atan2(deckY - baseY, 6.0);
    ramp.position.y = (deckY - baseY) / 2;
    this.place(rampG, loc.x + c.ox * 1.0, loc.z + c.oz * 1.0, c.ang, { y: baseY, noCollide: true });

    const along = (d, side = 0) => ({
      x: loc.x + c.ox * d + c.tx * side,
      z: loc.z + c.oz * d + c.tz * side,
    });

    for (let i = 8; i < length; i += 11) {
      for (const s of [-1, 1]) {
        const p = along(i, s * 2.2);
        this.place(P.makeLantern(2.6), p.x, p.z, 0, { y: deckY });
      }
    }
    for (let i = 14; i < length - 6; i += 14) {
      const p = along(i, 1.4);
      const bench = P.makeBench(1.9);
      this.place(bench, p.x, p.z, c.ang + Math.PI / 2, { y: deckY });
      this.interact({
        x: p.x, y: deckY, z: p.z, r: 2.0, kind: 'sit', label: 'Sit and watch the sea',
        data: { seat: bench.userData.seat, yaw: c.ang + Math.PI / 2, couple: true },
      });
    }

    // fishing spot at the end
    const end = along(length - 3, 0);
    this.place(P.makeFishingSpot(), end.x + c.tx * 1.6, end.z + c.tz * 1.6, c.ang, { y: deckY });
    this.interact({
      id: 'pier-fish', x: end.x, y: deckY, z: end.z, r: 3.2, kind: 'fish',
      label: 'Go fishing', data: { name: 'Pier' },
    });
    this.place(P.makeSignPost(['THE PIER', 'Fishing ↑'], 2.0), along(-6, 5).x, along(-6, 5).z, c.ang + Math.PI, { y: baseY });
    this.arrive('pier', along(-8, 0).x, along(-8, 0).z, c.ang);

    // moored boats
    for (let i = 0; i < 3; i++) {
      const p = along(16 + i * 11, 5.4);
      const boat = P.makeBoat(i === 1 ? M().accentTeal : null);
      this.place(boat, p.x, p.z, c.ang + Math.PI / 2 + (this.rng() - 0.5) * 0.2, { y: WORLD.seaLevel + 0.25, dynamic: true, noCollide: true });
      this.animated.push({
        update: (dt, time) => {
          boat.position.y = WORLD.seaLevel + 0.25 + Math.sin(time * 0.9 + i) * 0.12;
          boat.rotation.z = Math.sin(time * 0.7 + i * 2) * 0.05;
          boat.rotation.x = Math.cos(time * 0.55 + i) * 0.035;
        },
      });
      if (i === 0) {
        this.interact({
          id: 'boat-ride', x: p.x, y: deckY, z: p.z, r: 3.6, kind: 'boat',
          label: 'Take the boat out', data: { boat, ang: c.ang },
        });
      }
    }

    // crates and rope on the deck
    for (let i = 0; i < 5; i++) {
      const p = along(10 + this.rng() * (length - 16), (this.rng() - 0.5) * 3.4);
      const crate = P.grp();
      crate.add(P.B(m.plank, 0.7, 0.6, 0.7, 0, 0.3, 0));
      crate.userData.cols.push({ k: 'b', x: 0, z: 0, w: 0.75, d: 0.75, h: 0.6 });
      this.place(crate, p.x, p.z, this.rng() * 3, { y: deckY });
    }

    this.npcSpawns.push({
      id: 'fisher', name: 'Odis', role: 'fish',
      x: along(length - 8, -2).x, z: along(length - 8, -2).z, y: deckY, wander: 0,
      look: { skin: '#6e442a', hair: '#2b2119', shirt: '#bda37a', pants: '#3c5a80', hairStyle: 'short' },
      lines: [['They bite best at sunset. Try the end of the pier.', ['Good tip', 'Where should I go?']],
              ['North of here the road runs up to the lighthouse. Worth the climb.', ['Thanks!']]],
      emote: 'fish',
    });
  }

  /* -------------------------------------------------------- viewpoint */

  buildViewpoint() {
    const m = M();
    const v = this.L.get('viewpoint');
    const c = this._coast(v);
    const y = this.ground(v.x, v.z);

    const deck = BLD.makeViewDeck(11, 8, 0.6);
    const dx = v.x + c.ox * 2.5, dz = v.z + c.oz * 2.5;
    this.place(deck, dx, dz, c.ang + Math.PI, { y });
    const deckY = y + deck.userData.deckY;

    const tel = P.makeTelescope();
    this.place(tel, dx + c.tx * 2.6 + c.ox * 1.2, dz + c.tz * 2.6 + c.oz * 1.2, c.ang, { y: deckY });
    this.interact({
      x: dx + c.tx * 2.6, y: deckY, z: dz + c.tz * 2.6, r: 2.4, kind: 'telescope',
      label: 'Look through the telescope', data: { name: 'Sunset Point' },
    });

    for (const s of [-1, 1]) {
      const bx = dx + c.tx * s * 3.4 - c.ox * 1.8;
      const bz = dz + c.tz * s * 3.4 - c.oz * 1.8;
      const bench = P.makeBench(2.1);
      this.place(bench, bx, bz, c.ang + Math.PI, { y: deckY });
      this.interact({
        x: bx, y: deckY, z: bz, r: 2.2, kind: 'sunset', label: 'Watch the sunset together',
        data: { seat: bench.userData.seat, yaw: c.ang + Math.PI, couple: true, name: 'Sunset Point' },
      });
    }

    this.place(P.makeSignPost(['SUNSET POINT', 'Best at 18:30'], 2.4), v.x - c.ox * 8 + c.tx * 5, v.z - c.oz * 8 + c.tz * 5, c.ang + Math.PI, { y });
    for (let i = 0; i < 6; i++) {
      const a = this.rng() * 6.28, r = 8 + this.rng() * 12;
      const rx = v.x + Math.cos(a) * r, rz = v.z + Math.sin(a) * r;
      this.veg.addRock(rx, this.ground(rx, rz) - 0.2, rz, 0.9 + this.rng() * 1.6, this.rng() * 6.28, i % 3);
    }
    for (let i = 0; i < 40; i++) {
      const a = this.rng() * 6.28, r = 5 + this.rng() * 16;
      const fx = v.x + Math.cos(a) * r, fz = v.z + Math.sin(a) * r;
      this.veg.addFlower(fx, this.ground(fx, fz), fz, ['gold', 'white', 'rose'][i % 3], 0.6 + this.rng() * 0.4, this.rng() * 6.28);
    }
    this.drop('heart', dx - c.ox * 2, dz - c.oz * 2, deckY + 0.6);
    this.drop('star', v.x - c.tx * 16, v.z - c.tz * 16, null, true);
    this.viewpointDeckY = deckY;
    this.arrive('viewpoint', v.x - c.ox * 9, v.z - c.oz * 9, c.ang);
  }

  /* ----------------------------------------------------------- forest */

  buildForest() {
    const f = this.L.get('forest');
    const g = this.L.get('grove');
    const rng = this.rng;

    for (let i = 0; i < 26; i++) {
      const a = rng() * 6.28, r = 8 + rng() * 52;
      const x = f.x + Math.cos(a) * r, z = f.z + Math.sin(a) * r;
      const h = this.ground(x, z);
      if (h < 4) continue;
      if (rng() > 0.5) this.place(P.makeLogSeat(1.6 + rng() * 1.6), x, z, rng() * 6.28);
      else this.veg.addRock(x, h - 0.2, z, 0.6 + rng() * 1.4, rng() * 6.28, i % 3);
    }
    this.place(P.makeSignPost(['WHISPERING FOREST', 'Watch for wildlife'], 2.2), f.x + 10, f.z + 12, 0.9);
    this.arrive('forest', f.x + 5, f.z + 7, Math.atan2(-5, -7));

    // forest treasure
    const tA = rng() * 6.28;
    const tx = f.x + Math.cos(tA) * 38, tz = f.z + Math.sin(tA) * 38;
    const chest = P.makeChest();
    this.place(chest, tx, tz, rng() * 6.28, { dynamic: true });
    this.interact({
      x: tx, z: tz, r: 2.2, kind: 'chest', label: 'Open the chest', once: true,
      data: { group: chest, reward: { coins: 90, hearts: 20 }, name: 'Forest Treasure' },
    });
    this.drop('star', f.x - 30, f.z + 26, null, true);

    // ---- secret grove ----
    const clearing = new THREE.Mesh(new THREE.CircleGeometry(13, 26).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: TEX.grassTexture(), color: 0xd6e8bd, roughness: 0.96 }));
    clearing.position.set(g.x, this.ground(g.x, g.z) + 0.07, g.z);
    clearing.receiveShadow = true;
    this.static.add(clearing);

    const bench = P.makeBench(2.0);
    this.place(bench, g.x + 3.5, g.z + 2.2, -1.0);
    this.interact({
      x: g.x + 3.5, z: g.z + 2.2, r: 2.3, kind: 'sit', label: 'Rest on the hidden bench',
      data: { seat: bench.userData.seat, yaw: -1.0, couple: true },
    });
    for (let i = 0; i < 120; i++) {
      const a = rng() * 6.28, r = rng() * 13;
      const fx = g.x + Math.cos(a) * r, fz = g.z + Math.sin(a) * r;
      this.veg.addFlower(fx, this.ground(fx, fz), fz, ['rose', 'white', 'gold'][i % 3], 0.65 + rng() * 0.5, rng() * 6.28);
    }
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * 6.28;
      const rx = g.x + Math.cos(a) * 14, rz = g.z + Math.sin(a) * 14;
      this.veg.addRock(rx, this.ground(rx, rz) - 0.2, rz, 0.8 + rng() * 1.2, rng() * 6.28, i % 3);
    }
    this.lightPool.add({ x: g.x, y: 2.0, z: g.z, color: 0xffc9e6, intensity: 1.4, distance: 16, always: true });
    this.drop('heart', g.x - 2, g.z - 3);
    this.drop('heart', g.x + 1, g.z - 5);
    this.drop('star', g.x, g.z + 6, null, true);
    this.arrive('grove', g.x + 6, g.z + 7, Math.atan2(-6, -7));
  }

  /* ------------------------------------------------------------- lake */

  buildLake() {
    const m = M();
    const l = this.L.get('lake');
    this.water.placeLake(LAKE.x, LAKE.z);

    /** Radius from the lake centre at which the ground rises out of the water. */
    const shoreAt = (ang) => {
      for (let r = 8; r < 72; r += 0.5) {
        const x = LAKE.x + Math.cos(ang) * r, z = LAKE.z + Math.sin(ang) * r;
        if (this.ground(x, z) > WORLD.lakeLevel - 0.15) return r;
      }
      return 40;
    };


    // reeds + lily pads around the waterline
    for (let i = 0; i < 150; i++) {
      const a = this.rng() * 6.28;
      const r = shoreAt(a) - 3 + this.rng() * 7;
      const x = LAKE.x + Math.cos(a) * r, z = LAKE.z + Math.sin(a) * r;
      const h = this.ground(x, z);
      if (h > WORLD.lakeLevel + 1.4 || h < WORLD.lakeLevel - 2.2) continue;
      this.veg.addReeds(x, h, z, 0.7 + this.rng() * 0.7, this.rng() * 6.28);
    }
    const padMat = new THREE.MeshStandardMaterial({ color: 0x4f8b4a, roughness: 0.85, side: THREE.DoubleSide });
    for (let i = 0; i < 26; i++) {
      const a = this.rng() * 6.28, r = 8 + this.rng() * 22;
      const x = LAKE.x + Math.cos(a) * r, z = LAKE.z + Math.sin(a) * r;
      if (this.ground(x, z) > WORLD.lakeLevel - 0.8) continue;
      const pad = new THREE.Mesh(new THREE.CircleGeometry(0.5 + this.rng() * 0.5, 9).rotateX(-Math.PI / 2), padMat);
      pad.position.set(x, WORLD.lakeLevel + 0.06, z);
      this.static.add(pad);
    }

    // dock on the near shore, running out over the water
    const da = Math.atan2(l.z - LAKE.z, l.x - LAKE.x);
    const shoreR = shoreAt(da);
    const dockX = LAKE.x + Math.cos(da) * (shoreR + 1.5);
    const dockZ = LAKE.z + Math.sin(da) * (shoreR + 1.5);
    const dockY = WORLD.lakeLevel + 0.45;
    const dock = BLD.makeDock(11, 2.8, 0.5);
    // orient so the planks run from the bank toward the middle of the lake
    this.place(dock, dockX, dockZ, Math.atan2(Math.cos(da), Math.sin(da)), { y: dockY - 0.5 });
    this.interact({
      x: dockX - Math.cos(da) * 6, y: dockY, z: dockZ - Math.sin(da) * 6, r: 3.0, kind: 'fish',
      label: 'Fish from the dock', data: { name: 'Mirror Lake' },
    });
    const boat = P.makeBoat();
    this.place(boat, dockX - Math.cos(da) * 8 + Math.sin(da) * 3, dockZ - Math.sin(da) * 8 - Math.cos(da) * 3,
      da + Math.PI / 2, { y: WORLD.lakeLevel + 0.2, dynamic: true, noCollide: true });
    this.animated.push({
      update: (dt, time) => {
        boat.position.y = WORLD.lakeLevel + 0.2 + Math.sin(time * 0.8) * 0.05;
        boat.rotation.z = Math.sin(time * 0.6) * 0.03;
      },
    });

    // benches looking over the water
    for (let i = 0; i < 3; i++) {
      const a = da + (i - 1) * 0.9;
      const br = shoreAt(a) + 3.5;
      const bx = LAKE.x + Math.cos(a) * br, bz = LAKE.z + Math.sin(a) * br;
      const bench = P.makeBench(2.0);
      const by = this.ground(bx, bz);
      this.place(bench, bx, bz, Math.atan2(LAKE.x - bx, LAKE.z - bz), { y: by });
      this.interact({
        x: bx, y: by, z: bz, r: 2.2, kind: 'sit', label: 'Sit by the lake',
        data: { seat: bench.userData.seat, yaw: Math.atan2(LAKE.x - bx, LAKE.z - bz), couple: true },
      });
    }
    this.place(P.makeSignPost(['MIRROR LAKE'], 2.0), l.x + 4, l.z + 6, 1.2);
    const lookout = shoreAt(da) + 5;
    this.interact({
      x: LAKE.x + Math.cos(da) * lookout, z: LAKE.z + Math.sin(da) * lookout, r: 5, kind: 'photo',
      label: 'Take a photo here', data: { name: 'Mirror Lake' },
    });
    this.arrive('lake', LAKE.x + Math.cos(da) * lookout, LAKE.z + Math.sin(da) * lookout,
      Math.atan2(-Math.cos(da), -Math.sin(da)));
    const fr = shoreAt(da + 1) + 2;
    this.drop('flower', LAKE.x + Math.cos(da + 1) * fr, LAKE.z + Math.sin(da + 1) * fr);
    this.drop('heart', dockX - Math.cos(da) * 5, dockZ - Math.sin(da) * 5, dockY + 0.6);
  }

  /* -------------------------------------------------------- waterfall */

  buildWaterfall() {
    const m = M();
    const w = this.L.get('waterfall');
    const rng = this.rng;
    const baseY = this.ground(w.x, w.z);

    // the cliff the water pours over — faces the pond
    const faceAng = Math.atan2(LAKE.x - w.x, LAKE.z - w.z);
    const nx = Math.sin(faceAng), nz = Math.cos(faceAng);   // toward the lake
    const cliffH = 13;
    const cliffX = w.x - nx * 9, cliffZ = w.z - nz * 9;

    const wall = P.grp();
    wall.add(P.B(m.stone, 22, cliffH + 6, 9, 0, (cliffH + 6) / 2 - 3, 0));
    wall.userData.cols.push({ k: 'b', x: 0, z: 0, w: 22, d: 9, h: cliffH + 3 });
    this.place(wall, cliffX, cliffZ, faceAng, { y: baseY });
    for (let i = 0; i < 22; i++) {
      const a = rng() * 6.28;
      const rr = 6 + rng() * 9;
      const rx = cliffX + Math.cos(a) * rr, rz = cliffZ + Math.sin(a) * rr;
      // Keep the boulders off the face itself — otherwise they stand in front
      // of the falls and hide the one thing this whole set piece is for.
      const along = (rx - cliffX) * nx + (rz - cliffZ) * nz;
      const across = Math.abs((rx - cliffX) * nz - (rz - cliffZ) * nx);
      if (along > 2.5 && across < 7.5) continue;
      this.veg.addRock(rx, baseY + rng() * cliffH * 0.8, rz, 1.0 + rng() * 2.0, rng() * 6.28, i % 3);
    }

    // Pond + falling water.
    // `baseY` is the *carved* basin floor, so the surface has to be lifted back
    // up to sit just under the rim; and the sheet has to clear the rock face,
    // which is 4.5 m deep from the cliff centre.
    const pondY = baseY + 1.9;
    this.water.addPond(w.x, pondY, w.z, 9);
    this.water.addWaterfall(cliffX + nx * 5.8, pondY - 0.35, cliffZ + nz * 5.8, 6.5, cliffH, faceAng);

    // mist
    const mist = new THREE.Points(
      (() => {
        const n = Math.floor(160 * this.quality.particles);
        const pos = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          pos[i * 3] = (Math.random() - 0.5) * 11;
          pos[i * 3 + 1] = Math.random() * 6;
          pos[i * 3 + 2] = (Math.random() - 0.5) * 7;
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        return g;
      })(),
      new THREE.PointsMaterial({
        map: TEX.glowTexture('mist', 'rgba(255,255,255,0.55)', 'rgba(255,255,255,0)'),
        size: 2.6, transparent: true, depthWrite: false, opacity: 0.42, sizeAttenuation: true,
      }));
    mist.position.set(cliffX + nx * 6, pondY - 0.3, cliffZ + nz * 6);
    mist.userData.dynamic = true;
    this.dynamic.add(mist);
    this.animated.push({
      update: (dt, time) => {
        const p = mist.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) {
          let y = p.getY(i) + dt * (0.4 + (i % 5) * 0.12);
          if (y > 6.5) y = 0;
          p.setY(i, y);
          p.setX(i, p.getX(i) + Math.sin(time * 0.7 + i) * dt * 0.25);
        }
        p.needsUpdate = true;
      },
    });

    // bridge over the outflow + hidden bench
    const bAng = faceAng + Math.PI / 2;
    const bx = w.x + nx * 15, bz = w.z + nz * 15;
    this.place(BLD.makeBridge(9, 2.6, 'wood', 0.5), bx, bz, bAng, { y: this.ground(bx, bz) });
    const bench = P.makeBench(1.9);
    const hbx = w.x + nx * 5 + Math.cos(faceAng) * 7, hbz = w.z + nz * 5 - Math.sin(faceAng) * 7;
    this.place(bench, hbx, hbz, faceAng + Math.PI);
    this.interact({
      x: hbx, z: hbz, r: 2.3, kind: 'sit', label: 'Sit by the waterfall',
      data: { seat: bench.userData.seat, yaw: faceAng + Math.PI, couple: true },
    });
    this.interact({
      x: w.x, z: w.z, r: 7, kind: 'photo', label: 'Take a photo of the falls',
      data: { name: 'Hidden Waterfall' },
    });

    for (let i = 0; i < 50; i++) {
      const a = rng() * 6.28, r = 6 + rng() * 16;
      const fx = w.x + Math.cos(a) * r, fz = w.z + Math.sin(a) * r;
      this.veg.addFlower(fx, this.ground(fx, fz), fz, ['white', 'rose'][i % 2], 0.6 + rng() * 0.4, rng() * 6.28);
    }
    this.arrive('waterfall', w.x + nx * 12, w.z + nz * 12, Math.atan2(-nx, -nz));
    this.drop('heart', w.x + nx * 3, w.z + nz * 3);
    this.drop('flower', w.x - nx * 2 + 4, w.z - nz * 2 + 2);

    /* ---- crystal cave, tucked behind the cliff ---- */
    // The cave sits beside the falls, opening toward the pond — tucked behind
    // the rocks rather than buried in the hillside behind the cliff.
    const cav = this.L.get('cave');
    const caveAng = faceAng + Math.PI;
    const tx = nz, tz = -nx;                       // along the cliff face
    const camX = cliffX + tx * 12 + nx * 3.5;
    const camZ = cliffZ + tz * 12 + nz * 3.5;
    const cy = pondY - 0.25;
    cav.x = camX; cav.z = camZ; cav.y = cy;

    const cave = P.grp();
    const cw = 9, cd = 8, chh = 3.4;
    const wallH = chh + 4.5, wallY = chh / 2 - 2.0;   // walls reach down to meet the slope
    cave.add(P.B(m.stone, cw + 1.4, 0.9, cd + 1.4, 0, -0.45, 0));                  // floor
    cave.add(P.B(m.stone, cw + 1.4, wallH, 0.9, 0, wallY, cd / 2));                // back
    cave.add(P.B(m.stone, 0.9, wallH, cd, -cw / 2, wallY, 0));
    cave.add(P.B(m.stone, 0.9, wallH, cd, cw / 2, wallY, 0));
    cave.add(P.B(m.stone, (cw - 3) / 2, wallH, 0.9, -(cw + 3) / 4, wallY, -cd / 2));
    cave.add(P.B(m.stone, (cw - 3) / 2, wallH, 0.9, (cw + 3) / 4, wallY, -cd / 2));
    cave.add(P.B(m.stone, cw + 1.4, 0.9, cd + 1.4, 0, chh + 0.4, 0));              // ceiling
    cave.userData.cols.push({ k: 'p', x: 0, z: 0, w: cw - 0.8, d: cd - 0.8, y: 0 });
    cave.userData.cols.push({ k: 'b', x: 0, z: cd / 2, w: cw + 1.4, d: 1.0, h: chh });
    cave.userData.cols.push({ k: 'b', x: -cw / 2, z: 0, w: 1.0, d: cd, h: chh });
    cave.userData.cols.push({ k: 'b', x: cw / 2, z: 0, w: 1.0, d: cd, h: chh });
    cave.userData.cols.push({ k: 'b', x: -(cw + 3) / 4, z: -cd / 2, w: (cw - 3) / 2, d: 1.0, h: chh });
    cave.userData.cols.push({ k: 'b', x: (cw + 3) / 4, z: -cd / 2, w: (cw - 3) / 2, d: 1.0, h: chh });
    this.place(cave, camX, camZ, caveAng, { y: cy });

    for (let i = 0; i < 7; i++) {
      const a = rng() * 6.28, r = rng() * 3.2;
      const cl = P.makeCrystalCluster(0.7 + rng() * 0.8);
      this.place(cl, camX + Math.cos(a) * r, camZ + Math.sin(a) * r, rng() * 6.28, { y: cy });
    }
    const chest = P.makeChest();
    this.place(chest, camX, camZ + 2, caveAng, { y: cy, dynamic: true });
    this.interact({
      x: camX, y: cy, z: camZ + 2, r: 2.4, kind: 'chest', label: 'Open the crystal chest', once: true,
      data: { group: chest, reward: { coins: 200, hearts: 40, stars: 0 }, name: 'Crystal Cave' },
    });
    this.drop('star', camX + 2.5, camZ - 1.5, cy + 0.6, true);
    this.drop('coin', camX - 2.5, camZ, cy + 0.6, true);
    this.lightPool.add({ x: camX, y: cy + 1.8, z: camZ, color: 0x9a7dff, intensity: 2.2, distance: 15, always: true });
  }

  /* ------------------------------------------------------- lighthouse */

  buildLighthouse() {
    const m = M();
    const l = this.L.get('lighthouse');
    const c = this._coast(l);
    const y = this.ground(l.x, l.z);
    const lh = BLD.makeLighthouse();
    this.place(lh, l.x, l.z, c.ang + Math.PI, { y });
    this.lighthouseTop = y + lh.userData.topY;
    this.lighthouseAt = { x: l.x, z: l.z, ang: c.ang };

    const beacon = lh.userData.beacon;
    this.animated.push({
      update: (dt, time, night) => {
        beacon.rotation.y += dt * 0.6;
        if (lh.userData.beamMat) lh.userData.beamMat.opacity = 0.05 + (night || 0) * 0.16;
      },
    });

    const door = { x: l.x + Math.cos(c.ang + Math.PI) * 0 + lh.userData.doorAt.x, z: l.z };
    const dcos = Math.cos(c.ang + Math.PI), dsin = Math.sin(c.ang + Math.PI);
    const dw = {
      x: l.x + lh.userData.doorAt.x * dcos + lh.userData.doorAt.z * dsin,
      z: l.z - lh.userData.doorAt.x * dsin + lh.userData.doorAt.z * dcos,
    };
    this.interact({
      id: 'lighthouse-climb', x: dw.x, y, z: dw.z, r: 3.2, kind: 'climb',
      label: 'Climb the lighthouse', data: { toY: this.lighthouseTop, name: 'Lighthouse' },
    });

    // gallery platform + descend prompt + telescope at the top
    this.physics.addPlatform(l.x, l.z, 5.4, 5.4, this.lighthouseTop, 0, 'lighthouse-top');
    const tel = P.makeTelescope();
    this.place(tel, l.x + c.ox * 1.5, l.z + c.oz * 1.5, c.ang, { y: this.lighthouseTop, noCollide: true });
    this.interact({
      id: 'lighthouse-down', x: l.x - c.ox * 1.6, y: this.lighthouseTop, z: l.z - c.oz * 1.6, r: 2.4,
      kind: 'descend', label: 'Climb back down', data: { toY: y },
    });
    this.interact({
      x: l.x + c.ox * 1.5, y: this.lighthouseTop, z: l.z + c.oz * 1.5, r: 2.2, kind: 'telescope',
      label: 'Look out over the island', data: { name: 'Lighthouse' },
    });
    this.drop('star', l.x + c.tx * 1.9, l.z + c.tz * 1.9, this.lighthouseTop + 0.7, true);

    // rocks + fence + sign
    for (let i = 0; i < 24; i++) {
      const a = this.rng() * 6.28, r = 8 + this.rng() * 18;
      const rx = l.x + Math.cos(a) * r, rz = l.z + Math.sin(a) * r;
      this.veg.addRock(rx, this.ground(rx, rz) - 0.25, rz, 0.8 + this.rng() * 2.0, this.rng() * 6.28, i % 3);
    }
    for (let i = 0; i < 4; i++) {
      const t = (i - 1.5) * 4;
      this.place(P.makeFence(4), l.x - c.ox * 9 + c.tx * t, l.z - c.oz * 9 + c.tz * t, c.ang + Math.PI / 2);
    }
    this.place(P.makeSignPost(['LIGHTHOUSE', 'Climb to the top'], 2.2),
      l.x - c.ox * 12 + c.tx * 5, l.z - c.oz * 12 + c.tz * 5, c.ang + Math.PI, { y: this.ground(l.x - c.ox * 12 + c.tx * 5, l.z - c.oz * 12 + c.tz * 5) });
    this.place(P.makeBench(2.0), l.x - c.ox * 11, l.z - c.oz * 11, c.ang + Math.PI);
    this.arrive('lighthouse', l.x - c.ox * 14, l.z - c.oz * 14, c.ang);
  }

  /* --------------------------------------------------------- campsite */

  buildCampsite() {
    const m = M();
    const c = this.L.get('campsite');
    const rng = this.rng;

    const fire = P.makeCampfire();
    this.place(fire, c.x, c.z, 0, { dynamic: true });
    this.animated.push({
      update: (dt, time) => {
        const fl = fire.userData.flames;
        if (!fl) return;
        for (const f of fl.children) {
          const p = f.userData.phase || 0;
          f.scale.y = 0.75 + Math.sin(time * 9 + p) * 0.3;
          f.scale.x = f.scale.z = 0.85 + Math.cos(time * 7 + p) * 0.18;
          f.rotation.z = Math.sin(time * 4 + p) * 0.12;
        }
      },
    });
    this.interact({
      x: c.x, z: c.z, r: 4.0, kind: 'campfire', label: 'Sit by the campfire',
      data: { name: 'Campsite', couple: true },
    });

    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * 6.28 + 0.6;
      const tx = c.x + Math.cos(a) * 8.5, tz = c.z + Math.sin(a) * 8.5;
      this.place(P.makeTent([m.fabricGreen, m.fabricBlue, m.fabricRed][i]), tx, tz, -a + Math.PI / 2);
      this.place(P.makeSleepingBag(i % 2 ? m.fabricCream : m.fabricSun), tx + Math.cos(a) * 2.6, tz + Math.sin(a) * 2.6, -a);
    }
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * 6.28 + 0.3;
      const lx = c.x + Math.cos(a) * 3.2, lz = c.z + Math.sin(a) * 3.2;
      const log = P.makeLogSeat(2.0);
      this.place(log, lx, lz, -a);
      this.interact({
        x: lx, z: lz, r: 1.9, kind: 'sit', label: 'Sit on the log',
        data: { seat: log.userData.seat, yaw: Math.atan2(c.x - lx, c.z - lz) },
      });
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * 6.28 + 0.9;
      this.place(P.makeLantern(2.4), c.x + Math.cos(a) * 11, c.z + Math.sin(a) * 11, 0);
    }
    const pt = P.makePicnicTable();
    this.place(pt, c.x + 11, c.z - 4, 0.6);
    this.interact({
      x: c.x + 11, z: c.z - 4, r: 2.4, kind: 'sit', label: 'Sit at the table',
      data: { seat: pt.userData.seat, yaw: 0.6 },
    });
    this.place(P.makeSignPost(['CAMPSITE', 'Stay for the stars'], 2.2), c.x - 9, c.z + 8, 0.9);
    this.arrive('campsite', c.x + 6, c.z + 6, Math.atan2(-6, -6));
    this.drop('heart', c.x + 4, c.z + 4);
    this.drop('coin', c.x - 5, c.z - 5);

    this.npcSpawns.push({
      id: 'camper', name: 'Juno', role: 'sit',
      x: c.x + Math.cos(1.2) * 3.4, z: c.z + Math.sin(1.2) * 3.4, wander: 0,
      look: { skin: '#e8bc9a', hair: '#8c2f2f', shirt: '#ff8b6b', pants: '#2b2f38', hairStyle: 'bun' },
      lines: [['Stay until dark. You can see every star from up here.', ['I will', 'Where should I go?']],
              ['The forest trail west leads down to the lake. Listen for water.', ['Thanks!']]],
    });
  }

  /* ----------------------------------------------------------- houses */

  buildHouses() {
    const m = M();
    const t = this.L.get('town');
    const spots = [
      { x: t.x + 40, z: t.z + 26, ry: -0.7, style: 'cottage', wall: m.plasterCream, enter: 'cottage' },
      { x: t.x - 42, z: t.z + 30, ry: 0.8, style: 'modern', wall: m.plasterWhite, balcony: true },
      { x: t.x - 46, z: t.z - 26, ry: 2.3, style: 'cottage', wall: m.plasterSage },
      { x: t.x + 34, z: t.z - 30, ry: -2.2, style: 'modern', wall: m.plasterBlue, balcony: true },
      { x: t.x + 8, z: t.z + 56, ry: 0.2, style: 'cottage', wall: m.plasterRose },
    ];
    for (const s of spots) {
      const h = BLD.makeHouse({
        w: 7 + this.rng() * 2, d: 6 + this.rng() * 1.5, h: 3.2,
        style: s.style, wall: s.wall, porch: s.style === 'cottage', chimney: s.style === 'cottage',
        balcony: s.balcony, seed: s.x,
      });
      this.place(h, s.x, s.z, s.ry);
      this.lightPool.add({ x: s.x, y: 2.4, z: s.z, color: 0xffd39a, intensity: 1.0, distance: 11, night: true });
      this.place(P.makeFence(5), s.x + Math.sin(s.ry) * 7, s.z + Math.cos(s.ry) * 7, s.ry);
      this.place(P.makeMailbox(), s.x + Math.sin(s.ry) * 7 + 2.4, s.z + Math.cos(s.ry) * 7, s.ry);
      if (s.enter) {
        const cos = Math.cos(s.ry), sin = Math.sin(s.ry);
        const d = h.userData.doorAt;
        const dw = { x: s.x + d.x * cos + d.z * sin, z: s.z - d.x * sin + d.z * cos };
        const out = { x: s.x + d.x * cos + (d.z - 3.4) * sin, z: s.z - d.x * sin + (d.z - 3.4) * cos };
        this.interact({
          id: 'house-' + s.enter, x: dw.x, z: dw.z, r: 4.2, kind: 'enter',
          label: 'Enter the cottage', data: { interior: s.enter },
        });
        this.houseDoor = { x: out.x, z: out.z, yaw: s.ry + Math.PI };
      }
    }

    // beach houses
    const b = this.L.get('beach');
    const bc = this._coast(b);
    for (let i = 0; i < 2; i++) {
      const off = (i - 0.5) * 34;
      const x = b.x + bc.tx * off - bc.ox * 26;
      const z = b.z + bc.tz * off - bc.oz * 26;
      const h = BLD.makeHouse({
        w: 8, d: 6.5, h: 3.2, style: 'modern', wall: m.plasterWhite, balcony: true, seed: i + 5,
      });
      this.place(h, x, z, bc.ang + Math.PI);
      this.lightPool.add({ x, y: 2.6, z, color: 0xffd39a, intensity: 1.0, distance: 11, night: true });
      if (i === 0) {
        const cos = Math.cos(bc.ang + Math.PI), sin = Math.sin(bc.ang + Math.PI);
        const d = h.userData.doorAt;
        const dw = { x: x + d.x * cos + d.z * sin, z: z - d.x * sin + d.z * cos };
        const out = { x: x + d.x * cos + (d.z - 3.4) * sin, z: z - d.x * sin + (d.z - 3.4) * cos };
        this.interact({
          id: 'house-beach', x: dw.x, z: dw.z, r: 4.2, kind: 'enter',
          label: 'Enter the beach house', data: { interior: 'beachhouse' },
        });
        this.beachHouseDoor = { x: out.x, z: out.z, yaw: bc.ang + Math.PI };
      }
    }

    // forest cabins
    const f = this.L.get('forest');
    for (let i = 0; i < 2; i++) {
      const a = 1.2 + i * 2.4;
      const x = f.x + Math.cos(a) * 30, z = f.z + Math.sin(a) * 30;
      this.place(BLD.makeCabin(i + 2), x, z, -a);
      this.lightPool.add({ x, y: 2.4, z, color: 0xffc98a, intensity: 0.9, distance: 10, night: true });
    }
  }

  /* ------------------------------------------------------- vegetation */

  buildInteriors() {
    const m = M();
    const mk = (id, roomOpts) => {
      const ox = INTERIOR_ORIGIN.x + this._interiorIndex * 140;
      const oz = INTERIOR_ORIGIN.z;
      this._interiorIndex++;
      const room = BLD.makeInterior(roomOpts);
      this.place(room, ox, oz, 0, { y: 0, interior: id });
      return { ox, oz, room };
    };

    /* ---- café ---- */
    {
      const { ox, oz } = mk('cafe', { w: 12, d: 10, h: 3.6, floor: m.plank, wall: m.plasterRose });
      const counter = P.makeCounter(4.2);
      this.place(counter, ox, oz + 3.2, Math.PI, { y: 0 });
      this.place(P.makeCoffeeMachine(), ox - 1.2, oz + 3.9, Math.PI, { y: 1.12, noCollide: true });
      this.place(P.makeShelf(), ox + 3.6, oz + 4.2, Math.PI, { y: 0 });
      this.place(P.makeMenuBoard(), ox + 1.6, oz + 4.7, Math.PI, { y: 1.4, noCollide: true });
      for (let i = 0; i < 4; i++) {
        const tx = ox - 3.6 + (i % 2) * 5.4;
        const tz = oz - 2.6 + Math.floor(i / 2) * 3.2;
        this.place(P.makeTable(1.2, 1.2, 0.74, true), tx, tz, 0, { y: 0 });
        for (const s of [-1, 1]) this.place(P.makeChair(), tx + s * 1.1, tz, s > 0 ? Math.PI / 2 : -Math.PI / 2, { y: 0 });
        this.interact({
          x: tx, y: 0, z: tz, r: 1.9, kind: 'sit', label: 'Sit at the table',
          data: { seat: { x: 0, y: 0.5, z: 1.05 }, yaw: Math.PI, couple: true, interior: 'cafe' },
        });
      }
      this.place(P.makeIndoorLamp(), ox - 5.0, oz - 4.0, 0, { y: 0 });
      this.place(P.makePlanter(1.0), ox + 5.0, oz - 4.0, 0, { y: 0 });
      this.place(P.makeRug(3.2, 2.2, m.fabricRose), ox, oz - 1.0, 0, { y: 0, noCollide: true });
      // windows looking out
      for (const sx of [-1, 1]) {
        const wmesh = P.B(m.windowLit, 3.0, 1.9, 0.12, 0, 0, 0);
        const g = P.grp();
        g.add(wmesh);
        this.place(g, ox + sx * 3.0, oz - 5.0, 0, { y: 1.7, noCollide: true });
      }
      this.interact({
        id: 'cafe-counter', x: ox, y: 0, z: oz + 2.2, r: 2.6, kind: 'order',
        label: 'Order a drink', data: { interior: 'cafe' },
      });
      this.interact({
        id: 'cafe-exit', x: ox, y: 0, z: oz - 4.4, r: 2.4, kind: 'exit',
        label: 'Step outside', data: { to: 'cafe' },
      });
      this.lightPool.add({ x: ox, y: 3.0, z: oz, color: 0xffd9a8, intensity: 2.4, distance: 18, always: true });
      this.lightPool.add({ x: ox, y: 2.2, z: oz + 3.4, color: 0xffc98a, intensity: 1.4, distance: 10, always: true });
      this.interiors.set('cafe', { spawn: { x: ox, y: 0, z: oz - 3.4, yaw: Math.PI }, exitKey: 'cafe' });
      this.npcSpawns.push({
        id: 'barista', name: 'Ada', role: 'stand', x: ox - 0.6, z: oz + 4.0, y: 0, wander: 0, interior: 'cafe',
        look: { skin: '#f4d4bd', hair: '#3a3f5a', shirt: '#ff7a9c', pants: '#2b2f38', hairStyle: 'bun' },
        lines: [['Welcome to HelloCouple Café! What can I get you two?', ['A drink please', 'Just looking']],
                ['Take your time. The window seat has the best view.', ['Thanks!']]],
      });
    }

    /* ---- cottage ---- */
    {
      const { ox, oz } = mk('cottage', { w: 9, d: 8, h: 3.2, floor: m.plank, wall: m.plasterCream });
      this.place(P.makeBed(), ox - 2.6, oz + 2.4, 0, { y: 0 });
      this.place(P.makeSofa(2.2), ox + 2.6, oz - 1.0, Math.PI, { y: 0 });
      this.place(P.makeTable(1.4, 0.9, 0.5), ox + 2.6, oz - 2.6, 0, { y: 0 });
      this.place(P.makeKitchen(), ox + 2.0, oz + 3.4, Math.PI, { y: 0 });
      this.place(P.makeShelf(), ox - 4.0, oz - 2.0, Math.PI / 2, { y: 0 });
      this.place(P.makeRug(3.0, 2.2), ox + 1.6, oz - 1.4, 0, { y: 0, noCollide: true });
      this.place(P.makeIndoorLamp(), ox + 3.8, oz + 0.6, 0, { y: 0 });
      this.interact({
        x: ox + 2.6, y: 0, z: oz - 1.0, r: 1.9, kind: 'sit', label: 'Sit on the sofa',
        data: { seat: { x: 0, y: 0.48, z: 0.5 }, yaw: 0, couple: true, interior: 'cottage' },
      });
      this.interact({
        id: 'cottage-exit', x: ox, y: 0, z: oz - 3.6, r: 2.4, kind: 'exit',
        label: 'Step outside', data: { to: 'cottage' },
      });
      this.lightPool.add({ x: ox, y: 2.7, z: oz, color: 0xffd9a8, intensity: 2.0, distance: 15, always: true });
      this.interiors.set('cottage', { spawn: { x: ox, y: 0, z: oz - 2.6, yaw: Math.PI }, exitKey: 'cottage' });
      this.drop('heart', ox - 3.0, oz - 2.8, 0.6);
    }

    /* ---- beach house ---- */
    {
      const { ox, oz } = mk('beachhouse', { w: 10, d: 8, h: 3.3, floor: m.plankWorn, wall: m.plasterBlue });
      this.place(P.makeSofa(2.4), ox - 2.2, oz + 1.4, 0, { y: 0 });
      this.place(P.makeTable(1.6, 1.0, 0.5), ox - 2.2, oz - 0.4, 0, { y: 0 });
      this.place(P.makeBed(), ox + 3.0, oz + 2.2, -Math.PI / 2, { y: 0 });
      this.place(P.makeKitchen(), ox - 3.0, oz + 3.4, Math.PI, { y: 0 });
      this.place(P.makeRug(3.4, 2.4, M().fabricBlue), ox - 2.2, oz + 0.4, 0, { y: 0, noCollide: true });
      this.place(P.makeSurfboard(), ox + 4.2, oz - 2.6, 0.4, { y: 0 });
      this.place(P.makeIndoorLamp(), ox - 4.2, oz - 2.6, 0, { y: 0 });
      this.interact({
        x: ox - 2.2, y: 0, z: oz + 1.4, r: 1.9, kind: 'sit', label: 'Sit on the sofa',
        data: { seat: { x: 0, y: 0.48, z: 0.5 }, yaw: Math.PI, couple: true, interior: 'beachhouse' },
      });
      this.interact({
        id: 'beachhouse-exit', x: ox, y: 0, z: oz - 3.6, r: 2.4, kind: 'exit',
        label: 'Step outside', data: { to: 'beachhouse' },
      });
      this.lightPool.add({ x: ox, y: 2.8, z: oz, color: 0xffe0b8, intensity: 2.0, distance: 16, always: true });
      this.interiors.set('beachhouse', { spawn: { x: ox, y: 0, z: oz - 2.6, yaw: Math.PI }, exitKey: 'beachhouse' });
      this.drop('coin', ox + 3.6, oz - 1.0, 0.6);
    }

    // exit targets in the outside world
    const ext = {
      cafe: this.cafeDoor,
      cottage: this.houseDoor,
      beachhouse: this.beachHouseDoor,
    };
    for (const [id, info] of this.interiors) {
      info.exitTo = ext[info.exitKey] || { x: 0, z: 0, yaw: 0 };
    }
  }

  /** True inside the downtown plateau (plus a margin). */
  inCity(x, z, margin = 14) {
    const c = this.network.city;
    if (!c) return false;
    return Math.abs(x - c.x) < c.spanX / 2 + margin && Math.abs(z - c.z) < c.spanZ / 2 + margin;
  }

  scatterVegetation() {
    const q = this.quality;
    const rng = this.rng;
    const half = this.terrain.half;
    const forest = this.L.get('forest');
    const grove = this.L.get('grove');

    // ---- trees ----
    const step = 5.2 / Math.max(0.35, q.treeDensity);
    for (let z = -half + 8; z < half - 8; z += step) {
      for (let x = -half + 8; x < half - 8; x += step) {
        const jx = x + (rng() - 0.5) * step * 0.9;
        const jz = z + (rng() - 0.5) * step * 0.9;
        const h = this.terrain.height(jx, jz);
        if (h < 2.4 || h > 72) continue;
        const slope = this.terrain.slope(jx, jz);
        if (slope > 0.44) continue;

        // density masks
        const dForest = Math.hypot(jx - forest.x, jz - forest.z);
        const dGrove = Math.hypot(jx - grove.x, jz - grove.z);
        let density = 0.20;
        density += smoothstep(96, 18, dForest) * 0.72;
        density += smoothstep(150, 60, Math.hypot(jx, jz)) * 0.05;
        if (dGrove < 24) density = 0;
        if (this.inCity(jx, jz)) continue;
        if (this.terrain.distanceToPath(jx, jz) < 6.5) continue;
        if (this.physics.isBlocked(jx, jz === 0 ? 1 : h + 1.5, jz, 2.2)) continue;
        if (rng() > density) continue;

        let type;
        if (h < 6.5) type = 'palm';
        else if (h > 46) type = 'pine';
        else if (dForest < 70) type = rng() < 0.55 ? 'pine' : (rng() < 0.6 ? 'oak' : 'tropical');
        else type = rng() < 0.55 ? 'oak' : 'tropical';

        this.veg.addTree(type, jx, h, jz, 0.8 + rng() * 0.55, rng() * 6.28, (rng() - 0.5) * 0.09);

        if (rng() < 0.5) {
          const bx = jx + (rng() - 0.5) * 4, bz = jz + (rng() - 0.5) * 4;
          this.veg.addBush(bx, this.terrain.height(bx, bz), bz, 0.7 + rng() * 0.7, rng() * 6.28);
        }
      }
    }

    // ---- grass + flowers ----
    if (q.grassDensity > 0) {
      const gstep = 3.4 / q.grassDensity;
      for (let z = -half + 6; z < half - 6; z += gstep) {
        for (let x = -half + 6; x < half - 6; x += gstep) {
          const jx = x + (rng() - 0.5) * gstep;
          const jz = z + (rng() - 0.5) * gstep;
          const h = this.terrain.height(jx, jz);
          if (h < 3.4 || h > 58) continue;
          if (this.terrain.slope(jx, jz) > 0.4) continue;
          if (this.inCity(jx, jz, 4)) continue;
          if (this.terrain.distanceToPath(jx, jz) < 3.4) continue;
          if (rng() > 0.42) continue;
          this.veg.addGrass(jx, h, jz, 0.75 + rng() * 0.8, rng() * 6.28);
          if (rng() < 0.055) {
            this.veg.addFlower(jx + 0.4, h, jz + 0.4, ['rose', 'white', 'gold'][(rng() * 3) | 0], 0.6 + rng() * 0.35, rng() * 6.28);
          }
        }
      }
    }

    // ---- shore rocks ----
    for (let i = 0; i < 260 * q.detailDensity; i++) {
      const a = rng() * 6.28;
      const shore = this.terrain.shoreRadius(a);
      const r = shore - 4 + rng() * 16;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = this.terrain.height(x, z);
      if (h > 5 || h < -3) continue;
      this.veg.addRock(x, h - 0.2, z, 0.35 + rng() * 1.5, rng() * 6.28, i % 3);
    }

    // ---- cliff and highland rocks ----
    for (let i = 0; i < 340 * q.detailDensity; i++) {
      const x = (rng() - 0.5) * half * 1.8;
      const z = (rng() - 0.5) * half * 1.8;
      const h = this.terrain.height(x, z);
      if (h < 12) continue;
      if (this.inCity(x, z)) continue;
      const slope = this.terrain.slope(x, z);
      if (slope < 0.26 && rng() > 0.14) continue;   // boulders belong on slopes
      if (this.terrain.distanceToPath(x, z) < 5) continue;
      // big ones only where the ground is genuinely steep
      const size = 0.45 + rng() * (slope > 0.4 ? 2.1 : 0.9);
      this.veg.addRock(x, h - 0.25, z, size, rng() * 6.28, i % 3);
    }
  }

  /* ---------------------------------------------------------- details */

  scatterDetails() {
    const m = M();
    const rng = this.rng;
    // street lamps and benches along the main roads
    for (const road of this.network.roads) {
      if (road.kind !== 'road') continue;
      const spacing = 26;
      let acc = spacing;
      for (let i = 1; i < road.pts.length; i++) {
        const [x, z] = road.pts[i];
        const [px, pz] = road.pts[i - 1];
        acc += Math.hypot(x - px, z - pz);
        if (acc < spacing) continue;
        acc = 0;
        let dx = x - px, dz = z - pz;
        const l = Math.hypot(dx, dz) || 1;
        dx /= l; dz /= l;
        const side = (i % 2 === 0) ? 1 : -1;
        const ox = -dz * side * (road.width * 0.5 + 1.9);
        const oz = dx * side * (road.width * 0.5 + 1.9);
        const lx = x + ox, lz = z + oz;
        const h = this.terrain.height(lx, lz);
        if (h < 1.5 || this.inCity(lx, lz)) continue;
        this.place(P.makeStreetLamp(5.2), lx, lz, 0);
        if (rng() < 0.25) {
          const bx = x - ox * 1.15, bz = z - oz * 1.15;
          if (this.terrain.height(bx, bz) > 1.5) {
            const bench = P.makeBench(2.0);
            this.place(bench, bx, bz, Math.atan2(-ox, -oz));
            this.interact({
              x: bx, z: bz, r: 2.1, kind: 'sit', label: 'Sit down',
              data: { seat: bench.userData.seat, yaw: Math.atan2(-ox, -oz) },
            });
          }
        }
        if (rng() < 0.16) this.place(P.makeTrashBin(), x + ox * 1.2, z + oz * 1.2, 0);
      }
    }

    // signposts at trail heads
    const junctions = [
      { id: 'beach', text: ['TO THE BEACH'] },
      { id: 'lake', text: ['TO MIRROR LAKE'] },
      { id: 'campsite', text: ['TO THE CAMPSITE'] },
      { id: 'park', text: ['TO THE PARK'] },
    ];
    for (const j of junctions) {
      const p = this.L.get(j.id);
      if (!p) continue;
      const a = Math.atan2(p.z, p.x);
      const sx = p.x - Math.cos(a) * 30, sz = p.z - Math.sin(a) * 30;
      const h = this.terrain.height(sx, sz);
      if (h < 1.6) continue;
      this.place(P.makeSignPost(j.text, 2.0), sx, sz, -a + Math.PI / 2);
    }

    // driftwood + fences in open country
    for (let i = 0; i < 26 * this.quality.detailDensity; i++) {
      const a = rng() * 6.28, r = 40 + rng() * 200;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = this.terrain.height(x, z);
      if (h < 4 || this.terrain.slope(x, z) > 0.3) continue;
      if (this.inCity(x, z)) continue;
      if (this.terrain.distanceToPath(x, z) < 8) continue;
      if (rng() < 0.5) this.place(P.makeFence(5 + rng() * 3), x, z, rng() * 6.28);
      else this.place(P.makeLogSeat(1.8 + rng()), x, z, rng() * 6.28);
    }
  }

  /* ----------------------------------------------------- collectibles */

  placeCollectibles() {
    const rng = this.rng;
    const half = this.terrain.half;
    const types = ['heart', 'coin', 'flower', 'heart', 'coin'];
    let placed = 0;
    let guard = 0;
    while (placed < 96 && guard++ < 6000) {
      const a = rng() * 6.28, r = rng() * (half - 40);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = this.terrain.height(x, z);
      if (h < 3 || h > 66) continue;
      if (this.terrain.slope(x, z) > 0.35) continue;
      if (this.physics.isBlocked(x, h + 1, z, 1.0)) continue;
      const nearPath = this.terrain.distanceToPath(x, z);
      const hidden = nearPath > 22;
      let type = types[(rng() * types.length) | 0];
      if (h < 5) type = 'shell';
      if (hidden && rng() < 0.22) type = 'coin';
      this.drop(type, x, z, null, hidden);
      placed++;
    }
    // a friendly trail of hearts leading out of town
    const t = this.L.get('town');
    for (let i = 0; i < 6; i++) {
      const a = 1.1 + i * 0.22;
      this.drop('heart', t.x + Math.cos(a) * (24 + i * 7), t.z + Math.sin(a) * (24 + i * 7));
    }
  }

  placeNPCs() {
    // Downtown's own residents are pushed by buildTown(); this pass adds the
    // people who belong to the wider island.
    const city = this.network.city;
    const plaza = city.blocks.find(b => b.kind === 'plaza') || city.blocks[0];
    this.npcSpawns.push({
      id: 'commuter', name: 'Sol', role: 'walk',
      x: plaza.x + plaza.w * 0.6, z: plaza.z - plaza.d * 0.55, wander: 34,
      look: { skin: '#9c6440', hair: '#3a3f5a', shirt: '#2b2f38', pants: '#6b6f7a', hairStyle: 'bun' },
      lines: [['Traffic downtown, quiet everywhere else. That is the island for you.',
               ['Sounds right', 'Where should I go?']],
              ['Take the coast road south for the beach, north for the lighthouse.', ['Thanks!']]],
    });
    const park = this.L.get('park');
    if (park) {
      this.npcSpawns.push({
        id: 'gardener', name: 'Ilo', role: 'stand',
        x: park.x - 12, z: park.z + 8, wander: 0,
        look: { skin: '#e8bc9a', hair: '#5b3a26', shirt: '#6fbf73', pants: '#3c5a80', hairStyle: 'short' },
        lines: [['The flower beds are mine. Take one if you like — they grow back.',
                 ['Thank you', 'Where should I go?']],
                ['Follow the water north and you will hear the falls before you see them.', ['Thanks!']]],
      });
    }
  }

  /* --------------------------------------------------------- finalize */

  finalize() {
    // Replay a cached scatter, if one was handed to us, before the buckets are
    // frozen into InstancedMeshes.
    if (this._vegReplay) {
      this.veg.mute = false;
      if (!this.veg.replay(this._vegReplay)) this._vegReplayFailed = true;
      this._vegReplay = null;
    }
    const vegStats = this.veg.finalize();
    const batch = batchStatic(this.static, 250);
    this.stats = {
      ...vegStats,
      city: this.cityStats,
      cars: (this.drivableCars || []).length,
      graphNodes: this.roadGraph ? this.roadGraph.nodes.length : 0,
      batches: batch.batches,
      mergedMeshes: batch.meshes,
      triangles: Math.round(batch.tris),
      colliders: this.physics.solids.length,
      platforms: this.physics.platforms.length,
      interactables: this.interactables.length,
      collectibles: this.collectibleSpots.length,
      lights: this.lightPool.sources.length,
    };
  }

  /* ----------------------------------------------------------- update */

  update(dt, time, focus, night) {
    for (const a of this.animated) a.update(dt, time, night);
    this.lightPool.update(focus, night, dt);
    if (this.cafeSignMat) this.cafeSignMat.emissiveIntensity = night > 0.3 ? 0.55 : 0.0;
  }
}
