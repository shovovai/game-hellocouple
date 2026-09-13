/**
 * city.js — downtown.
 *
 * Turns the abstract street grid from layout.js into geometry: road surfaces
 * with lane paint and crosswalks, kerbs and sidewalks, four kinds of block
 * (towers, mid-rise, low-rise, plaza), and the street furniture that makes a
 * city read as one — lights, signals, trees, bins, hydrants, bus shelters and
 * parked cars.
 *
 * Buildings use `facadeBox`, which builds only the five faces you can see with
 * UVs scaled to real metres, so one shared facade material tiles correctly on a
 * 9 m shop and a 70 m tower alike.
 */

import * as THREE from 'three';
import { materials } from './materials.js';
import * as TEX from './textures.js';
import * as P from './props.js';
import { makeCarModel, CAR_COLORS } from './vehicle.js';
import { makeGazebo as BLDGazebo } from './buildings.js';
import { makeRng } from './noise.js';

/** One facade tile is four storeys. */
const TILE = 14;

/**
 * Box with no bottom face and per-face UVs in world units.
 * `tile` is the size in metres that one texture tile covers.
 */
export function facadeBox(w, h, d, tile = TILE) {
  const hw = w / 2, hd = d / 2;
  const pos = [], nrm = [], uv = [], idx = [];
  let v = 0;
  const quad = (a, b, c, e, n, uw, uh) => {
    pos.push(...a, ...b, ...c, ...e);
    for (let i = 0; i < 4; i++) nrm.push(...n);
    uv.push(0, 0, uw, 0, uw, uh, 0, uh);
    idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    v += 4;
  };
  const uH = h / tile;
  quad([-hw, 0, hd], [hw, 0, hd], [hw, h, hd], [-hw, h, hd], [0, 0, 1], w / tile, uH);
  quad([hw, 0, -hd], [-hw, 0, -hd], [-hw, h, -hd], [hw, h, -hd], [0, 0, -1], w / tile, uH);
  quad([hw, 0, hd], [hw, 0, -hd], [hw, h, -hd], [hw, h, hd], [1, 0, 0], d / tile, uH);
  quad([-hw, 0, -hd], [-hw, 0, hd], [-hw, h, hd], [-hw, h, -hd], [-1, 0, 0], d / tile, uH);
  quad([-hw, h, hd], [hw, h, hd], [hw, h, -hd], [-hw, h, -hd], [0, 1, 0], w / tile, d / tile);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

export function buildCity(world, city) {
  const m = materials();
  const rng = makeRng(90210);
  const Y = world.ground(city.x, city.z);
  const q = world.quality;
  const root = world.static;

  const add = (mesh) => { root.add(mesh); return mesh; };
  /**
   * Scale a geometry's UVs into world units. Without this a 70 m plaza slab
   * stretches a single paving tile across the whole block.
   */
  const uvScale = (geo, sx, sy) => {
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy);
    uv.needsUpdate = true;
    return geo;
  };
  const TILE_M = 4.5;                 // metres per ground-texture tile
  const slab = (mat, w, d, x, z, y = 0.06, rot = 0) => {
    const geo = new THREE.BoxGeometry(w, 0.12, d);
    if (mat.map) uvScale(geo, w / TILE_M, d / TILE_M);
    const g = new THREE.Mesh(geo, mat);
    g.position.set(x, Y + y, z);
    g.rotation.y = rot;
    g.receiveShadow = true;
    return add(g);
  };
  /** Road markings are paint, not kerbs: flat planes a few millimetres proud. */
  const paint = (w, d, x, z, y) => {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m.paint);
    g.rotation.x = -Math.PI / 2;
    g.position.set(x, Y + y, z);
    g.receiveShadow = true;
    return add(g);
  };
  const box = (mat, w, h, d, x, y, z, rot = 0) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    if (mat.map) uvScale(geo, Math.max(w, d) / TILE_M, Math.max(h, d) / TILE_M);
    const g = new THREE.Mesh(geo, mat);
    g.position.set(x, Y + y, z);
    g.rotation.y = rot;
    g.castShadow = true; g.receiveShadow = true;
    return add(g);
  };
  const solid = (x, z, w, d, h, rot = 0) => world.physics.addBox(x, z, w, d, rot, Y - 2, Y + h);

  const out = { buildings: 0, props: 0, parked: 0, lights: 0 };

  /* ------------------------------------------------------------ streets */

  const halfX = city.spanX / 2, halfZ = city.spanZ / 2;
  const roadY = 0.05;

  for (const x of city.avenueX) {
    slab(m.roadCity, city.AVENUE, city.spanZ + 24, x, city.z, roadY);
  }
  for (const z of city.streetZ) {
    slab(m.roadCity, city.spanX + 24, city.STREET, city.x, z, roadY);
  }

  // lane markings — dashes between intersections, solid stop bars at them
  const dashLen = 3.2, gap = 3.6;
  for (const x of city.avenueX) {
    for (let z = city.z - halfZ; z < city.z + halfZ; z += dashLen + gap) {
      if (city.streetZ.some(sz => Math.abs(sz - z) < city.STREET * 0.75)) continue;
      slab(m.paint, 0.22, dashLen, x, z, roadY + 0.07);
    }
  }
  for (const z of city.streetZ) {
    for (let x = city.x - halfX; x < city.x + halfX; x += dashLen + gap) {
      if (city.avenueX.some(ax => Math.abs(ax - x) < city.AVENUE * 0.75)) continue;
      slab(m.paint, dashLen, 0.22, x, z, roadY + 0.07);
    }
  }

  // crosswalks on every approach to every intersection
  for (const ix of city.avenueX) {
    for (const iz of city.streetZ) {
      for (const sz of [-1, 1]) {
        const cz = iz + sz * (city.STREET / 2 + 1.9);
        for (let i = -3; i <= 3; i++) {
          paint(0.52, 2.4, ix + i * 1.9, cz, roadY + 0.065);
        }
      }
      for (const sx of [-1, 1]) {
        const cx = ix + sx * (city.AVENUE / 2 + 1.9);
        for (let i = -2; i <= 2; i++) {
          paint(2.4, 0.52, cx, iz + i * 1.9, roadY + 0.065);
        }
      }
    }
  }

  /* -------------------------------------------------- blocks and kerbs */

  const SIDEWALK = 4.2;
  const KERB = 0.16;

  for (const b of city.blocks) {
    const sw = b.w + SIDEWALK * 2, sd = b.d + SIDEWALK * 2;
    // sidewalk deck, slightly proud of the road
    slab(m.sidewalk, sw, sd, b.x, b.z, roadY + KERB);
    // kerb edging
    for (const sx of [-1, 1]) box(m.kerb, 0.3, KERB + 0.16, sd, b.x + sx * sw / 2, KERB / 2, b.z);
    for (const sz of [-1, 1]) box(m.kerb, sw, KERB + 0.16, 0.3, b.x, KERB / 2, b.z + sz * sd / 2);

    if (b.kind === 'plaza') buildPlaza(b);
    else buildBlock(b);
    buildBlockFurniture(b, sw, sd);
  }

  /* ------------------------------------------------------------ builders */

  function facadeMesh(mat, w, h, d, x, z, rot = 0, tile = TILE) {
    const mesh = new THREE.Mesh(facadeBox(w, h, d, tile), mat);
    mesh.position.set(x, Y + KERB + 0.06, z);
    mesh.rotation.y = rot;
    mesh.castShadow = true; mesh.receiveShadow = true;
    add(mesh);
    out.buildings++;
    return mesh;
  }

  /** Ground-floor shopfront band wrapped around a building footprint. */
  function shopBand(x, z, w, d, rot, height = 3.6) {
    const mat = m.shopfronts[(rng() * m.shopfronts.length) | 0];
    const g = new THREE.Mesh(facadeBox(w + 0.12, height, d + 0.12, height * 1.02), mat);
    g.position.set(x, Y + KERB + 0.08, z);
    g.rotation.y = rot;
    g.castShadow = true; g.receiveShadow = true;
    add(g);
    // awning over the street-facing side
    const aw = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, 0.1, 1.5), m.fabricRed);
    aw.position.set(x, Y + KERB + height * 0.82, z + d / 2 + 0.75);
    aw.rotation.y = rot;
    aw.castShadow = true;
    add(aw);
  }

  function rooftop(x, z, w, d, top, seed) {
    const r = makeRng(seed);
    box(m.rooftop, w * 0.9, 0.5, d * 0.9, x, top + 0.25, z);          // parapet fill
    for (const sx of [-1, 1]) box(m.kerb, 0.35, 1.0, d, x + sx * w / 2, top + 0.5, z);
    for (const sz of [-1, 1]) box(m.kerb, w, 1.0, 0.35, x, top + 0.5, z + sz * d / 2);
    const units = 1 + ((r() * 3) | 0);
    for (let i = 0; i < units; i++) {
      const uw = 1.6 + r() * 2.4, ud = 1.6 + r() * 2.2, uh = 1.0 + r() * 1.4;
      box(m.metalLight, uw, uh, ud, x + (r() - 0.5) * (w - uw - 2), top + uh / 2 + 0.4, z + (r() - 0.5) * (d - ud - 2));
    }
    if (r() < 0.5) {
      const mast = 3 + r() * 6;
      box(m.metal, 0.18, mast, 0.18, x + (r() - 0.5) * w * 0.5, top + mast / 2 + 0.4, z + (r() - 0.5) * d * 0.5);
    }
  }

  function buildBlock(b) {
    const seed = (b.col * 31 + b.row * 17 + 5) | 0;
    const r = makeRng(seed);
    const heights = b.kind === 'tower' ? [26, 72] : b.kind === 'midrise' ? [13, 26] : [7, 13];

    // Split the block into a few lots along its longer axis.
    const lots = b.kind === 'tower' ? 2 + ((r() * 2) | 0) : 3 + ((r() * 3) | 0);
    const alongX = r() < 0.5;
    const span = alongX ? b.w : b.d;
    const depth = (alongX ? b.d : b.w) * (0.52 + r() * 0.2);
    let cursor = -span / 2;

    for (let i = 0; i < lots; i++) {
      const remaining = span / 2 - cursor;
      if (remaining < 10) break;
      const lw = Math.min(remaining, span / lots * (0.78 + r() * 0.5));
      const cx0 = cursor + lw / 2;
      cursor += lw + 0.4;

      const h = heights[0] + r() * (heights[1] - heights[0]);
      const face = m.facades[(r() * m.facades.length) | 0];

      for (const side of [-1, 1]) {
        const offset = (alongX ? b.d : b.w) / 2 - depth / 2;
        const x = alongX ? b.x + cx0 : b.x + side * offset;
        const z = alongX ? b.z + side * offset : b.z + cx0;
        const w = alongX ? lw : depth;
        const d = alongX ? depth : lw;
        const hh = h * (0.78 + r() * 0.44);

        facadeMesh(face, w, hh, d, x, z);
        solid(x, z, w, d, hh);

        // setback upper volume on the tallest buildings
        if (hh > 34 && r() < 0.7) {
          const sw2 = w * 0.62, sd2 = d * 0.62, extra = hh * (0.16 + r() * 0.3);
          facadeMesh(face, sw2, extra, sd2, x, z).position.y = Y + KERB + 0.06 + hh;
          rooftop(x, z, sw2, sd2, KERB + hh + extra, seed + i * 7);
        } else {
          rooftop(x, z, w, d, KERB + hh, seed + i * 7);
        }

        if (b.kind !== 'tower' || r() < 0.6) shopBand(x, z, w, d, 0);
        if (r() < 0.28) {
          // vertical neon sign on a corner
          const sh = Math.min(hh * 0.35, 9);
          box(m.neonSign, 0.4, sh, 1.6, x + w / 2 + 0.3, KERB + hh * 0.45, z + d * 0.3);
        }
      }
    }
  }

  function buildPlaza(b) {
    slab(m.paving, b.w, b.d, b.x, b.z, roadY + KERB + 0.02);
    // banded paving so a 70 m square does not read as one flat sheet
    for (let i = 1; i <= 3; i++) {
      const r = b.w * (0.16 + i * 0.12);
      const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 1.4, 44), m.kerb);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(b.x, Y + KERB + roadY + 0.05, b.z);
      ring.receiveShadow = true;
      add(ring);
    }
    const f = P.makeFountain(6.2);
    world.place(f, b.x, b.z, 0, { y: Y + KERB });
    world.animated.push({ update: (dt) => { if (f.userData.jets) f.userData.jets.rotation.y += dt * 0.22; } });
    world.interact({
      x: b.x, y: Y + KERB, z: b.z, r: 4.6, kind: 'fountain',
      label: 'Make a wish', data: { name: 'City Plaza' },
    });
    world.lightPool.add({ x: b.x, y: Y + 3.4, z: b.z, color: 0x9fd8e8, intensity: 1.6, distance: 22, night: true });

    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.3;
      const bx = b.x + Math.cos(a) * 14, bz = b.z + Math.sin(a) * 14;
      const bench = P.makeBench(2.2);
      world.place(bench, bx, bz, -a + Math.PI / 2, { y: Y + KERB });
      world.interact({
        x: bx, y: Y + KERB, z: bz, r: 2.3, kind: 'sit', label: 'Sit down',
        data: { seat: bench.userData.seat, yaw: -a + Math.PI / 2, couple: true },
      });
      const px = b.x + Math.cos(a + 0.4) * 25, pz = b.z + Math.sin(a + 0.4) * 25;
      world.veg.addTree(i % 2 ? 'oak' : 'tropical', px, Y + KERB, pz, 0.8, rng() * 6.28);
      box(m.kerb, 2.4, 0.3, 2.4, px, KERB + 0.1, pz);
      const qx = b.x + Math.cos(a + 0.78) * 30, qz = b.z + Math.sin(a + 0.78) * 30;
      world.place(P.makePlanter(2.0), qx, qz, -a, { y: Y + KERB });
      if (i % 2 === 0) world.place(P.makeStreetLamp(5.0), b.x + Math.cos(a) * 19, b.z + Math.sin(a) * 19, 0, { y: Y + KERB });
    }
    // a bandstand on one side, cafe tables on the other
    const gazebo = BLDGazebo(6.0);
    world.place(gazebo, b.x - b.w * 0.28, b.z - b.d * 0.28, 0.5, { y: Y + KERB });
    world.lightPool.add({ x: b.x - b.w * 0.28, y: Y + 4.2, z: b.z - b.d * 0.28, color: 0xffd9a0, intensity: 1.5, distance: 20, night: true });
    for (let i = 0; i < 4; i++) {
      const tx = b.x + b.w * 0.26 + (i % 2) * 5.2, tz = b.z + b.d * 0.2 + Math.floor(i / 2) * 5.2;
      world.place(P.makeTable(1.3, 1.3, 0.74, true), tx, tz, 0, { y: Y + KERB });
      world.place(P.makeUmbrella(m.fabricRose, 2.6), tx, tz, 0, { y: Y + KERB });
      for (const s2 of [-1, 1]) world.place(P.makeChair(), tx + s2 * 1.15, tz, s2 > 0 ? Math.PI / 2 : -Math.PI / 2, { y: Y + KERB });
    }
    // flagpoles frame the square
    for (const sx of [-1, 1]) world.place(P.makeFlagPole(11), b.x + sx * 28, b.z - 28, 0, { y: Y + KERB });
  }

  function buildBlockFurniture(b, sw, sd) {
    // streetlights + trees along the kerb, alternating
    const along = (len, fn) => {
      const n = Math.max(2, Math.round(len / 17));
      for (let i = 0; i <= n; i++) fn((i / n - 0.5) * (len - 6), i);
    };
    for (const sz of [-1, 1]) {
      along(sw, (t, i) => {
        const x = b.x + t, z = b.z + sz * (sd / 2 - 1.5);
        if (i % 2 === 0) {
          const lamp = P.makeStreetLamp(6.4);
          world.place(lamp, x, z, 0, { y: Y + KERB });
          out.lights++;
        } else if (rng() < 0.62) {
          world.veg.addTree(rng() < 0.5 ? 'oak' : 'tropical', x, Y + KERB, z, 0.6 + rng() * 0.2, rng() * 6.28);
          box(m.rooftop, 1.5, 0.1, 1.5, x, KERB + 0.08, z);
        } else if (rng() < 0.5) {
          world.place(P.makeTrashBin(), x, z, 0, { y: Y + KERB });
        }
      });
    }
    for (const sx of [-1, 1]) {
      along(sd, (t, i) => {
        const x = b.x + sx * (sw / 2 - 1.5), z = b.z + t;
        if (i % 2 === 1) {
          const lamp = P.makeStreetLamp(6.4);
          world.place(lamp, x, z, 0, { y: Y + KERB });
          out.lights++;
        } else if (rng() < 0.4) {
          world.veg.addTree('oak', x, Y + KERB, z, 0.6 + rng() * 0.2, rng() * 6.28);
          box(m.rooftop, 1.5, 0.1, 1.5, x, KERB + 0.08, z);
        } else if (rng() < 0.35) {
          const hyd = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.8, 8), m.accentRose);
          hyd.position.set(x, Y + KERB + 0.4, z);
          hyd.castShadow = true;
          add(hyd);
        }
      });
    }
    // a bus shelter on roughly one block in three
    if (rng() < 0.34) {
      const sx = rng() < 0.5 ? -1 : 1;
      const x = b.x + sx * (sw / 2 - 2.2), z = b.z + (rng() - 0.5) * b.d * 0.5;
      box(m.metalLight, 0.9, 2.6, 4.4, x, 1.3, z);
      const glass = box(m.glass, 0.12, 2.2, 4.2, x + sx * 0.4, 1.4, z);
      glass.castShadow = false;
      box(m.metalLight, 2.6, 0.14, 4.8, x - sx * 0.8, 2.7, z);
      const bench = P.makeBench(2.4);
      world.place(bench, x - sx * 0.8, z, Math.PI / 2, { y: Y + KERB });
      solid(x, z, 1.2, 4.4, 2.7);
      world.lightPool.add({ x, y: Y + 2.6, z, color: 0xcfe6ff, intensity: 0.9, distance: 12, night: true });
    }
  }

  /* ------------------------------------------------- signals + parking */

  for (const ix of city.avenueX) {
    for (const iz of city.streetZ) {
      for (const [sx, sz] of [[-1, -1], [1, 1]]) {
        const x = ix + sx * (city.AVENUE / 2 + 1.4);
        const z = iz + sz * (city.STREET / 2 + 1.4);
        box(m.metal, 0.22, 5.2, 0.22, x, 2.6, z);
        box(m.metal, 2.6, 0.16, 0.16, x - sx * 1.3, 5.1, z);
        const headBox = box(m.dark, 0.34, 0.95, 0.3, x - sx * 2.4, 4.75, z);
        headBox.castShadow = false;
        for (let i = 0; i < 3; i++) {
          const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6),
            i === 0 ? m.lanternGlow : i === 1 ? m.petalGold : m.foliagePine);
          lamp.position.set(x - sx * 2.4, Y + 5.06 - i * 0.3, z + 0.17);
          add(lamp);
        }
        solid(x, z, 0.4, 0.4, 5.2);
        out.props++;
      }
    }
  }

  // parked cars along the kerbs
  const parkCount = Math.round(38 * Math.min(1.2, q.detailDensity + 0.2));
  for (let i = 0; i < parkCount; i++) {
    const b = city.blocks[(rng() * city.blocks.length) | 0];
    const alongX = rng() < 0.5;
    const sw = b.w + SIDEWALK * 2, sd = b.d + SIDEWALK * 2;
    const off = (rng() - 0.5) * (alongX ? b.w * 0.8 : b.d * 0.8);
    const side = rng() < 0.5 ? -1 : 1;
    const x = alongX ? b.x + off : b.x + side * (sw / 2 + 1.6);
    const z = alongX ? b.z + side * (sd / 2 + 1.6) : b.z + off;
    const kinds = ['sedan', 'suv', 'van', 'taxi', 'pickup', 'sports'];
    const kind = kinds[(rng() * kinds.length) | 0];
    const car = makeCarModel(kind, CAR_COLORS[(rng() * CAR_COLORS.length) | 0], i + 3);
    car.position.set(x, Y, z);
    car.rotation.y = alongX ? (side > 0 ? Math.PI : 0) : (side > 0 ? -Math.PI / 2 : Math.PI / 2);
    car.userData.dynamic = false;              // parked: safe to batch
    root.add(car);
    world.physics.addBox(x, z, alongX ? 4.8 : 2.1, alongX ? 2.1 : 4.8, 0, Y - 1, Y + 1.6);
    out.parked++;
  }

  return out;
}
