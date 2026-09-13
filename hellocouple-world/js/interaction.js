/**
 * interaction.js — proximity prompts.
 *
 * Keeps a spatial bucket list of everything registered by world.js and finds
 * the best candidate near the player each frame: closest first, but preferring
 * things you are actually facing.
 */

const CELL = 16;

export class InteractionSystem {
  constructor() {
    this.items = [];
    this.grid = new Map();
    this.current = null;
    this.enabled = true;
  }

  build(items) {
    this.items = items;
    this.grid.clear();
    items.forEach((it, i) => {
      const cx = Math.floor(it.x / CELL), cz = Math.floor(it.z / CELL);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const k = (cx + dx) + ',' + (cz + dz);
          let a = this.grid.get(k);
          if (!a) this.grid.set(k, (a = []));
          a.push(i);
        }
      }
    });
  }

  /** @returns the interactable under the prompt, or null */
  update(pos, facing) {
    if (!this.enabled) { this.current = null; return null; }
    const k = Math.floor(pos.x / CELL) + ',' + Math.floor(pos.z / CELL);
    const list = this.grid.get(k);
    let best = null, bestScore = Infinity;
    if (list) {
      for (const i of list) {
        const it = this.items[i];
        if (!it.enabled || (it.once && it.used)) continue;
        const dx = it.x - pos.x, dz = it.z - pos.z, dy = (it.y ?? pos.y) - pos.y;
        if (Math.abs(dy) > 3.4) continue;
        const d = Math.hypot(dx, dz);
        if (d > it.r) continue;
        // prefer what the player is looking at
        // (a yaw of exactly 0 is a valid heading, so test the type, not truthiness)
        let score = d;
        if (typeof facing === 'number' && d > 0.2) {
          const dot = (dx / d) * Math.sin(facing) + (dz / d) * Math.cos(facing);
          score -= dot * 1.15;
        }
        if (score < bestScore) { bestScore = score; best = it; }
      }
    }
    this.current = best;
    return best;
  }

  consume() {
    const c = this.current;
    if (!c) return null;
    if (c.once) c.used = true;
    return c;
  }
}
