/**
 * terrain.js — procedural island heightfield.
 *
 * Pipeline:
 *   1. `sampleBase(x,z)`   raw island shape (coast + hills + mountains + lake bowl)
 *   2. flatten zones / roads / rivers are registered by world.js
 *   3. `buildHeightmap()`  bakes everything into a Float32Array
 *   4. `height(x,z)`       bilinear lookup into that array — used by physics,
 *                          placement and the visible mesh, so they never disagree.
 */

import * as THREE from 'three';
import { WORLD } from './config.js';
import { fbm, noise2, ridge, smoothstep, clamp, lerp, distToSegment } from './noise.js';
import * as TEX from './textures.js';

/** Mountains and hills: [x, z, height, radius, sharpness] */
const MASSIFS = [
  [-206, 26, 54, 86, 1.5],   // Sunset Point headland
  [156, -186, 64, 96, 1.6],  // northern peak
  [-170, -146, 26, 82, 1.15], // waterfall plateau
  [172, -118, 20, 62, 1.2],  // campsite hill
  [64, -74, 19, 88, 1.0],    // gentle inland rise
  [-96, 96, 14, 70, 1.0],    // south-west rise
  [214, -66, 11, 46, 1.2],   // lighthouse point
];

/** Mirror Lake bowl. */
const LAKE = { x: -100, z: -70, r: 44, depth: 24 };

export class Terrain {
  constructor(quality) {
    this.quality = quality;
    this.half = WORLD.halfSize;
    this.size = this.half * 2;
    /** Physics/placement resolution — deliberately independent of graphics quality. */
    this.res = 300;
    this.step = this.size / this.res;
    this.heights = new Float32Array((this.res + 1) * (this.res + 1));
    this.zones = [];     // flatten discs, applied before paths
    this.overrides = [];  // flatten discs applied AFTER paths (they win)
    this.paths = [];      // roads + rivers (flatten along a polyline)
    this.mesh = null;
    this._v = new THREE.Vector3();
  }

  /* ------------------------------------------------------------ shaping */

  /** Wobbling coastline radius for a given bearing. */
  shoreRadius(angle) {
    return WORLD.shoreRadius
      + 26 * Math.sin(angle * 3 + 0.7)
      + 13 * Math.sin(angle * 5 - 1.2)
      + 7 * Math.sin(angle * 7 + 2.4)
      + 10 * noise2(Math.cos(angle) * 2.4, Math.sin(angle) * 2.4, 101);
  }

  /** Raw island height before any flattening. */
  sampleBase(x, z) {
    const d = Math.hypot(x, z);
    const ang = Math.atan2(z, x);
    const R = this.shoreRadius(ang);
    const s = 1 - d / R;                       // >0 inland, <0 at sea

    if (s <= 0) {
      // Sea floor: a shelf that falls away from the beach.
      const off = -s * R;
      const shelf = -1.2 - 16 * smoothstep(0, 46, off) - 12 * smoothstep(40, 190, off);
      return shelf + fbm(x * 0.012, z * 0.012, 3, 5) * 2.2 * smoothstep(0, 40, off);
    }

    // Wide, gently sloping beach, then a low bluff up onto the plateau.
    let h = 2.9 * smoothstep(0, 0.052, s);
    h += 11.5 * smoothstep(0.088, 0.225, s);

    // Rolling interior.
    const inland = smoothstep(0.10, 0.32, s);
    h += (fbm(x * 0.0062, z * 0.0062, 4, 17) * 0.5 + 0.5) * 22 * inland;
    h += fbm(x * 0.022, z * 0.022, 3, 29) * 2.2 * inland;

    // Mountains.
    for (let i = 0; i < MASSIFS.length; i++) {
      const [mx, mz, mh, mr, sharp] = MASSIFS[i];
      const md = Math.hypot(x - mx, z - mz) / mr;
      if (md < 1.6) {
        const f = Math.exp(-md * md * sharp);
        const rough = ridge(x * 0.02, z * 0.02, 3, 7) * 0.35 + 0.8;
        h += mh * f * rough;
      }
    }

    // Lake bowl.
    const ld = Math.hypot(x - LAKE.x, z - LAKE.z) / LAKE.r;
    if (ld < 2.2) h -= LAKE.depth * Math.exp(-ld * ld * 1.15);

    // Cliffs where the land meets the sea on the high side.
    const cliff = smoothstep(0.015, 0.075, s) * smoothstep(26, 48, h);
    h += cliff * 6.0 * (fbm(x * 0.03, z * 0.03, 2, 61) * 0.5 + 0.5);

    return h;
  }

  /* ----------------------------------------------------- zone registry */

  /**
   * Level the ground inside a disc.
   * @param {number} target  world Y to level to (defaults to the ground there)
   */
  addFlatZone(x, z, r, feather = 14, target = null, strength = 1, override = false) {
    const zone = { x, z, r, feather, target: target ?? this.sampleBase(x, z), strength };
    (override ? this.overrides : this.zones).push(zone);
    return this;
  }

  /**
   * Level along a polyline — used for roads, paths and river beds.
   * @param {Array<[number,number]>} pts
   * @param {object} opts width, feather, drop (offset below natural ground), smooth
   */
  addPath(pts, { width = 6, feather = 9, drop = 0, smooth = 0.55, strength = 1 } = {}) {
    // Pre-smooth elevations along the path so roads have gentle grades.
    const elev = pts.map(p => this.sampleBase(p[0], p[1]) - drop);
    for (let pass = 0; pass < 6; pass++) {
      for (let i = 1; i < elev.length - 1; i++) {
        elev[i] = lerp(elev[i], (elev[i - 1] + elev[i + 1]) * 0.5, smooth);
      }
    }
    this.paths.push({ pts, elev, width, feather, strength });
    return this;
  }

  /** Apply all registered zones/paths to a base height. */
  applyZones(x, z, h) {
    for (let i = 0; i < this.zones.length; i++) {
      const zo = this.zones[i];
      const d = Math.hypot(x - zo.x, z - zo.z);
      if (d > zo.r + zo.feather) continue;
      const w = smoothstep(zo.r + zo.feather, zo.r, d) * zo.strength;
      h = lerp(h, zo.target, w);
    }
    for (let i = 0; i < this.paths.length; i++) {
      const p = this.paths[i];
      const pts = p.pts;
      let best = Infinity, bestH = 0;
      for (let j = 0; j < pts.length - 1; j++) {
        const a = pts[j], b = pts[j + 1];
        // Cheap reject before the exact distance test.
        if (Math.min(a[0], b[0]) - x > 40 || x - Math.max(a[0], b[0]) > 40) continue;
        if (Math.min(a[1], b[1]) - z > 40 || z - Math.max(a[1], b[1]) > 40) continue;
        const r = distToSegment(x, z, a[0], a[1], b[0], b[1]);
        if (r.dist < best) { best = r.dist; bestH = lerp(p.elev[j], p.elev[j + 1], r.t); }
      }
      if (best < p.width + p.feather) {
        const w = smoothstep(p.width + p.feather, p.width, best) * p.strength;
        h = lerp(h, bestH, w);
      }
    }
    // Overrides run last so a deliberate pad (the hidden cove floor) is not
    // undone by a trail that happens to arrive along the clifftop.
    for (let i = 0; i < this.overrides.length; i++) {
      const zo = this.overrides[i];
      const d = Math.hypot(x - zo.x, z - zo.z);
      if (d > zo.r + zo.feather) continue;
      h = lerp(h, zo.target, smoothstep(zo.r + zo.feather, zo.r, d) * zo.strength);
    }
    return h;
  }

  /** Distance to the nearest registered path (used to keep trees off roads). */
  distanceToPath(x, z) {
    let best = Infinity;
    for (const p of this.paths) {
      for (let j = 0; j < p.pts.length - 1; j++) {
        const a = p.pts[j], b = p.pts[j + 1];
        const r = distToSegment(x, z, a[0], a[1], b[0], b[1]);
        if (r.dist < best) best = r.dist;
      }
    }
    return best;
  }

  /* --------------------------------------------------------- heightmap */

  /** Bake the heightfield. Yields progress between 0..1 so the loader can tick. */
  *buildHeightmap() {
    const n = this.res + 1;
    const rowsPerChunk = 12;
    for (let iz = 0; iz < n; iz++) {
      const z = -this.half + iz * this.step;
      for (let ix = 0; ix < n; ix++) {
        const x = -this.half + ix * this.step;
        this.heights[iz * n + ix] = this.applyZones(x, z, this.sampleBase(x, z));
      }
      if (iz % rowsPerChunk === 0) yield iz / n;
    }
    yield 1;
  }

  /** Bilinear height lookup — the authoritative ground height. */
  height(x, z) {
    const n = this.res + 1;
    const fx = (x + this.half) / this.step;
    const fz = (z + this.half) / this.step;
    if (fx < 0 || fz < 0 || fx >= n - 1 || fz >= n - 1) {
      // Outside the baked area: open ocean.
      return -26;
    }
    const ix = fx | 0, iz = fz | 0;
    const tx = fx - ix, tz = fz - iz;
    const h = this.heights;
    const a = h[iz * n + ix], b = h[iz * n + ix + 1];
    const c = h[(iz + 1) * n + ix], d = h[(iz + 1) * n + ix + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }

  /** Surface normal from finite differences. */
  normal(x, z, out = new THREE.Vector3()) {
    const e = this.step;
    const hl = this.height(x - e, z), hr = this.height(x + e, z);
    const hd = this.height(x, z - e), hu = this.height(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }

  /** 0 = flat, 1 = vertical. */
  slope(x, z) {
    const n = this.normal(x, z, this._v);
    return 1 - clamp(n.y, 0, 1);
  }

  isWater(x, z) { return this.height(x, z) < WORLD.seaLevel; }

  /** Coarse biome used for footstep sounds, collectible spawning and colouring. */
  biome(x, z) {
    const h = this.height(x, z);
    const s = this.slope(x, z);
    if (h < 0.4) return 'water';
    if (h < 3.4) return 'sand';
    if (s > 0.55 || h > 44) return 'rock';
    return 'grass';
  }

  /* -------------------------------------------------------------- mesh */

  build(scene, quality) {
    const seg = quality.terrainSegments;
    const geo = new THREE.PlaneGeometry(this.size, this.size, seg, seg);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const count = pos.count;
    const colors = new Float32Array(count * 3);
    const blend = new Float32Array(count * 3);
    const uv = geo.attributes.uv;
    const col = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = this.height(x, z);
      pos.setY(i, h);
      // Tile textures by world units instead of across the whole plane.
      uv.setXY(i, x / 7, z / 7);
    }
    geo.computeVertexNormals();

    const nrm = geo.attributes.normal;
    for (let i = 0; i < count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), h = pos.getY(i);
      const steep = 1 - nrm.getY(i);

      // Blend weights: sand / grass / rock.
      const sand = clamp(1 - smoothstep(3.2, 5.6, h), 0, 1);
      const rock = clamp(Math.max(smoothstep(0.30, 0.62, steep), smoothstep(40, 58, h)), 0, 1);
      let grass = clamp(1 - sand - rock, 0, 1);
      const sum = sand + grass + rock || 1;
      blend[i * 3] = sand / sum;
      blend[i * 3 + 1] = grass / sum;
      blend[i * 3 + 2] = rock / sum;

      // Gentle large-scale tint variation keeps big fields from looking flat.
      const tint = fbm(x * 0.004, z * 0.004, 3, 71) * 0.5 + 0.5;
      const dry = smoothstep(3.0, 9.0, h);
      col.setRGB(
        lerp(1.04, 0.92, tint),
        lerp(0.96, 1.06, tint) * lerp(0.98, 1.0, dry),
        lerp(0.90, 1.0, tint)
      );
      // Wet sand darkens toward the waterline, then the sea floor goes muted.
      if (h < 2.2) col.multiplyScalar(lerp(1.0, 0.70, smoothstep(2.2, 0.1, h)));
      if (h < 0) col.multiplyScalar(lerp(1.0, 0.78, smoothstep(0, -3, h)));
      colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aBlend', new THREE.BufferAttribute(blend, 3));

    const grassMap = TEX.grassTexture();
    const sandMap = TEX.sandTexture();
    const rockMap = TEX.rockTexture();

    const mat = new THREE.MeshStandardMaterial({
      map: grassMap,
      vertexColors: true,
      roughness: 0.96,
      metalness: 0.0,
    });

    // Blend three ground textures with the per-vertex weights.
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.sandMap = { value: sandMap };
      shader.uniforms.rockMap = { value: rockMap };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aBlend;\nvarying vec3 vBlend;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vBlend = aBlend;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>',
          '#include <common>\nuniform sampler2D sandMap;\nuniform sampler2D rockMap;\nvarying vec3 vBlend;')
        .replace('#include <map_fragment>', `
          vec4 tGrass = texture2D( map, vMapUv );
          vec4 tSand  = texture2D( sandMap, vMapUv * 0.85 );
          vec4 tRock  = texture2D( rockMap, vMapUv * 0.55 );
          vec4 blended = tSand * vBlend.x + tGrass * vBlend.y + tRock * vBlend.z;
          diffuseColor *= blended;
        `);
      mat.userData.shader = shader;
    };

    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.name = 'terrain';
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    scene.add(mesh);
    this.mesh = mesh;
    return mesh;
  }

  dispose() {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
    }
  }
}

export { LAKE };
