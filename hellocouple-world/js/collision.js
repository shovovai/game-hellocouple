/**
 * collision.js — lightweight world collision.
 *
 * Rather than a full physics engine the world registers simple analytic
 * shapes. Characters are vertical capsules that get pushed out of "solids";
 * "platforms" are walkable horizontal surfaces (decks, floors, stairs, bridges)
 * that override the terrain height while you stand on them.
 *
 * A uniform grid keeps the per-frame cost flat no matter how much is built.
 */

const CELL = 14;

export class Physics {
  constructor(terrain) {
    this.terrain = terrain;
    this.solids = [];
    this.platforms = [];
    this.grid = new Map();      // "cx,cz" -> solid indices
    this.platGrid = new Map();
  }

  _key(cx, cz) { return cx + ',' + cz; }

  _insert(grid, idx, minX, minZ, maxX, maxZ) {
    const x0 = Math.floor(minX / CELL), x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL), z1 = Math.floor(maxZ / CELL);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const k = this._key(cx, cz);
        let arr = grid.get(k);
        if (!arr) grid.set(k, (arr = []));
        arr.push(idx);
      }
    }
  }

  /** Upright cylinder obstacle (tree trunk, lamp post, rock…). */
  addCylinder(x, z, r, yMin = -Infinity, yMax = Infinity) {
    const s = { kind: 0, x, z, r, yMin, yMax };
    const i = this.solids.push(s) - 1;
    this._insert(this.grid, i, x - r, z - r, x + r, z + r);
    return s;
  }

  /** Rotated box obstacle (wall, building, crate…). rot is around Y. */
  addBox(x, z, w, d, rot = 0, yMin = -Infinity, yMax = Infinity) {
    const hw = w / 2, hd = d / 2;
    const s = { kind: 1, x, z, hw, hd, rot, cos: Math.cos(-rot), sin: Math.sin(-rot), yMin, yMax };
    const i = this.solids.push(s) - 1;
    const ext = Math.hypot(hw, hd);
    this._insert(this.grid, i, x - ext, z - ext, x + ext, z + ext);
    return s;
  }

  /** Walkable surface at height y. `id` groups platforms (e.g. an interior). */
  addPlatform(x, z, w, d, y, rot = 0, id = null) {
    const hw = w / 2, hd = d / 2;
    const p = { x, z, hw, hd, y, rot, cos: Math.cos(-rot), sin: Math.sin(-rot), id };
    const i = this.platforms.push(p) - 1;
    const ext = Math.hypot(hw, hd);
    this._insert(this.platGrid, i, x - ext, z - ext, x + ext, z + ext);
    return p;
  }

  /** Ramp / stairway approximated by a run of small platforms. */
  addStairs(x0, z0, y0, x1, z1, y1, width = 2.4, steps = 12) {
    const out = [];
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      const x = x0 + (x1 - x0) * t;
      const z = z0 + (z1 - z0) * t;
      const y = y0 + (y1 - y0) * ((i + 1) / steps);
      const rot = Math.atan2(x1 - x0, z1 - z0);
      const len = Math.hypot(x1 - x0, z1 - z0) / steps;
      out.push(this.addPlatform(x, z, width, len * 1.35, y, rot));
    }
    return out;
  }

  _query(grid, x, z) {
    return grid.get(this._key(Math.floor(x / CELL), Math.floor(z / CELL)));
  }

  /**
   * Push a point out of every solid it overlaps.
   * @returns {boolean} true if the position was modified
   */
  resolve(pos, radius, feetY = -Infinity, headY = Infinity) {
    let hit = false;
    for (let oz = -1; oz <= 1; oz++) {
      for (let ox = -1; ox <= 1; ox++) {
        const list = this._query(this.grid, pos.x + ox * CELL * 0.6, pos.z + oz * CELL * 0.6);
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const s = this.solids[list[i]];
          if (headY < s.yMin || feetY > s.yMax) continue;
          if (s.kind === 0) {
            const dx = pos.x - s.x, dz = pos.z - s.z;
            const d = Math.hypot(dx, dz);
            const min = s.r + radius;
            if (d < min && d > 1e-5) {
              const push = (min - d);
              pos.x += (dx / d) * push;
              pos.z += (dz / d) * push;
              hit = true;
            } else if (d <= 1e-5) {
              pos.x += min; hit = true;
            }
          } else {
            // Transform into the box's local frame, clamp, push along the
            // shallowest axis.
            const rx = pos.x - s.x, rz = pos.z - s.z;
            const lx = rx * s.cos - rz * s.sin;
            const lz = rx * s.sin + rz * s.cos;
            const ex = s.hw + radius, ez = s.hd + radius;
            if (lx > -ex && lx < ex && lz > -ez && lz < ez) {
              const px = ex - Math.abs(lx);
              const pz = ez - Math.abs(lz);
              let nlx = lx, nlz = lz;
              if (px < pz) nlx = lx > 0 ? ex : -ex;
              else nlz = lz > 0 ? ez : -ez;
              // back to world space (inverse rotation)
              pos.x = s.x + nlx * s.cos + nlz * s.sin;
              pos.z = s.z - nlx * s.sin + nlz * s.cos;
              hit = true;
            }
          }
        }
      }
    }
    return hit;
  }

  /** True if a point is inside any solid — used for camera collision. */
  isBlocked(x, y, z, pad = 0.2) {
    const list = this._query(this.grid, x, z);
    if (!list) return false;
    for (let i = 0; i < list.length; i++) {
      const s = this.solids[list[i]];
      if (y < s.yMin || y > s.yMax) continue;
      if (s.kind === 0) {
        if (Math.hypot(x - s.x, z - s.z) < s.r + pad) return true;
      } else {
        const rx = x - s.x, rz = z - s.z;
        const lx = rx * s.cos - rz * s.sin;
        const lz = rx * s.sin + rz * s.cos;
        if (Math.abs(lx) < s.hw + pad && Math.abs(lz) < s.hd + pad) return true;
      }
    }
    return false;
  }

  /**
   * Height of the ground under a character.
   * Picks the highest platform that is not above `fromY + stepUp`; falls back
   * to the terrain.
   */
  groundAt(x, z, fromY = Infinity, stepUp = 0.85) {
    let best = this.terrain.height(x, z);
    const list = this._query(this.platGrid, x, z);
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const p = this.platforms[list[i]];
        const rx = x - p.x, rz = z - p.z;
        const lx = rx * p.cos - rz * p.sin;
        const lz = rx * p.sin + rz * p.cos;
        if (Math.abs(lx) <= p.hw && Math.abs(lz) <= p.hd) {
          if (p.y > best && p.y <= fromY + stepUp) best = p.y;
        }
      }
    }
    return best;
  }

  clear() {
    this.solids.length = 0;
    this.platforms.length = 0;
    this.grid.clear();
    this.platGrid.clear();
  }
}
