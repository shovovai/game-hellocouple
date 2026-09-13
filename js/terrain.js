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
  [-430, 54, 76, 175, 1.5],   // Sunset Point headland
  [326, -389, 92, 200, 1.6],  // northern peak
  [-355, -305, 38, 170, 1.15],// waterfall plateau
  [360, -247, 30, 130, 1.2],  // campsite hill
  [-210, 200, 22, 150, 1.0],  // south-west rise
  [447, -138, 16, 96, 1.2],   // lighthouse point
  [-120, -120, 26, 190, 0.9], // central rise
  [90, 330, 18, 150, 1.0],    // southern swell
];

/** Mirror Lake bowl. */
const LAKE = { x: -209, z: -146, r: 84, depth: 34 };

export class Terrain {
  constructor(quality) {
    this.quality = quality;
    this.half = WORLD.halfSize;
    this.size = this.half * 2;
    /** Physics/placement resolution — deliberately independent of graphics quality.
     *  Kept at ~2.5 m spacing whatever the world size. */
    this.res = Math.round((this.size / 2.5) / 8) * 8;
    this.step = this.size / this.res;
    this.heights = new Float32Array((this.res + 1) * (this.res + 1));
    this.zones = [];     // flatten discs, applied before paths
    this.rects = [];     // flatten rectangles (the city plateau)
    this.overrides = [];  // flatten discs applied AFTER paths (they win)
    this.paths = [];      // roads + rivers (flatten along a polyline)
    this.mesh = null;
    this.chunks = [];
    this._v = new THREE.Vector3();
  }

  /* ------------------------------------------------------------ shaping */

  /** Wobbling coastline radius for a given bearing. */
  shoreRadius(angle) {
    return WORLD.shoreRadius
      + 54 * Math.sin(angle * 3 + 0.7)
      + 27 * Math.sin(angle * 5 - 1.2)
      + 15 * Math.sin(angle * 7 + 2.4)
      + 21 * noise2(Math.cos(angle) * 2.4, Math.sin(angle) * 2.4, 101);
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
      const shelf = -1.2 - 16 * smoothstep(0, 70, off) - 14 * smoothstep(60, 320, off);
      return shelf + fbm(x * 0.009, z * 0.009, 3, 5) * 2.4 * smoothstep(0, 60, off);
    }

    // Wide, gently sloping beach, then a low bluff up onto the plateau.
    let h = 3.1 * smoothstep(0, 0.040, s);
    h += 13.0 * smoothstep(0.068, 0.19, s);

    // Rolling interior.
    const inland = smoothstep(0.085, 0.30, s);
    h += (fbm(x * 0.0040, z * 0.0040, 4, 17) * 0.5 + 0.5) * 26 * inland;
    h += fbm(x * 0.016, z * 0.016, 3, 29) * 2.6 * inland;

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
   * Level a rectangle. Downtown needs a flat *rectangle*, not a disc: a disc
   * big enough to cover the grid's corners also reaches the coast and turns
   * the shoreline into a wall.
   */
  addFlatRect(x, z, halfW, halfD, feather = 60, target = null, strength = 1) {
    this.rects.push({ x, z, halfW, halfD, feather, target: target ?? this.sampleBase(x, z), strength });
    return this;
  }

  /**
   * Level along a polyline — used for roads, paths and river beds.
   * @param {Array<[number,number]>} pts
   * @param {object} opts width, feather, drop (offset below natural ground), smooth
   */
  addPath(pts, { width = 6, feather = 9, drop = 0, smooth = 0.55, strength = 1 } = {}) {
    // Pre-smooth elevations along the path so roads have gentle grades.
    // Sampled through the flat rectangles so a road crossing the downtown
    // plateau follows it instead of dragging the raw ground back up.
    const elev = pts.map(p => this.applyRects(p[0], p[1], this.sampleBase(p[0], p[1])) - drop);
    for (let pass = 0; pass < 6; pass++) {
      for (let i = 1; i < elev.length - 1; i++) {
        elev[i] = lerp(elev[i], (elev[i - 1] + elev[i + 1]) * 0.5, smooth);
      }
    }
    this.paths.push({ pts, elev, width, feather, strength });
    return this;
  }

  /** Flat rectangles only — used when sampling road grades. */
  applyRects(x, z, h) {
    for (let i = 0; i < this.rects.length; i++) {
      const r = this.rects[i];
      const dx = Math.abs(x - r.x) - r.halfW;
      const dz = Math.abs(z - r.z) - r.halfD;
      const d = Math.hypot(Math.max(dx, 0), Math.max(dz, 0));
      if (d > r.feather) continue;
      h = lerp(h, r.target, smoothstep(r.feather, 0, d) * r.strength);
    }
    return h;
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
    h = this.applyRects(x, z, h);
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

  /**
   * A key that changes whenever anything that shapes the island changes, so a
   * cached heightfield from an older build is never reused.
   */
  cacheKey() {
    return `hm:${this.res}:${this.size}:${this._shapeHash()}`;
  }

  _shapeHash() {
    // Fold the zone/rect/path lists into one number. Cheap, and any edit to a
    // location or a road moves it.
    let h = 2166136261;
    const mix = (v) => { h ^= Math.round(v * 100) | 0; h = Math.imul(h, 16777619); };
    for (const z of this.zones || []) { mix(z.x); mix(z.z); mix(z.r ?? z.radius ?? 0); mix(z.y ?? z.target ?? 0); }
    for (const r of this.rects || []) { mix(r.x); mix(r.z); mix(r.halfW); mix(r.halfD); mix(r.target ?? 0); }
    for (const p of this.paths || []) { mix(p.width || 0); mix(p.pts?.length || 0); mix(p.elev?.[0] ?? 0); }
    for (const o of this.overrides || []) { mix(o.x ?? 0); mix(o.z ?? 0); mix(o.r ?? o.radius ?? 0); }
    return (h >>> 0).toString(36);
  }

  /** Adopt a heightfield read back from the cache. */
  adoptHeights(buf) {
    if (!buf || buf.length !== this.heights.length) return false;
    this.heights.set(buf);
    return true;
  }

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

  /**
   * Build the terrain as a grid of chunks rather than one huge plane. A single
   * mesh covering a 1.4 km island can never be frustum-culled, so most of the
   * island would be drawn every frame no matter where you stood.
   */
  build(scene, quality) {
    const CH = 8;                                  // chunks per side
    const seg = Math.max(8, Math.round(quality.terrainSegments / CH));
    const chunkSize = this.size / CH;

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
    this.material = mat;

    const root = new THREE.Group();
    root.name = 'terrain';
    const col = new THREE.Color();
    this.chunks = [];

    for (let cz = 0; cz < CH; cz++) {
      for (let cx = 0; cx < CH; cx++) {
        const ox = -this.half + chunkSize * (cx + 0.5);
        const oz = -this.half + chunkSize * (cz + 0.5);

        const geo = new THREE.PlaneGeometry(chunkSize, chunkSize, seg, seg);
        geo.rotateX(-Math.PI / 2);
        geo.translate(ox, 0, oz);

        const pos = geo.attributes.position;
        const count = pos.count;
        const colors = new Float32Array(count * 3);
        const blend = new Float32Array(count * 3);
        const uv = geo.attributes.uv;

        // Normals come from the heightfield, not from the chunk's own triangles:
        // per-chunk computeVertexNormals() leaves a visible lighting seam along
        // every chunk boundary.
        const nrm = geo.attributes.normal;
        const n = new THREE.Vector3();
        for (let i = 0; i < count; i++) {
          const x = pos.getX(i), z = pos.getZ(i);
          pos.setY(i, this.height(x, z));
          uv.setXY(i, x / 7, z / 7);               // tile by world units
          this.normal(x, z, n);
          nrm.setXYZ(i, n.x, n.y, n.z);
        }
        pos.needsUpdate = true;
        nrm.needsUpdate = true;
        for (let i = 0; i < count; i++) {
          const x = pos.getX(i), z = pos.getZ(i), h = pos.getY(i);
          const steep = 1 - nrm.getY(i);

          const sand = clamp(1 - smoothstep(3.2, 5.6, h), 0, 1);
          const rock = clamp(Math.max(smoothstep(0.30, 0.62, steep), smoothstep(48, 68, h)), 0, 1);
          let grass = clamp(1 - sand - rock, 0, 1);
          const sum = sand + grass + rock || 1;
          blend[i * 3] = sand / sum;
          blend[i * 3 + 1] = grass / sum;
          blend[i * 3 + 2] = rock / sum;

          const tint = fbm(x * 0.0025, z * 0.0025, 3, 71) * 0.5 + 0.5;
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
        geo.computeBoundingSphere();

        const mesh = new THREE.Mesh(geo, mat);
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        root.add(mesh);
        this.chunks.push(mesh);
      }
    }

    scene.add(root);
    this.mesh = root;
    return root;
  }

  dispose() {
    for (const c of this.chunks || []) c.geometry.dispose();
    this.material?.dispose();
    this.chunks = null;
    this.mesh = null;
  }
}

export { LAKE };
