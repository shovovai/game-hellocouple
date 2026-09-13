/**
 * map.js — minimap, full-screen map and fast travel.
 *
 * The island is rendered once into an offscreen canvas (terrain colours from
 * the same heightfield the world uses, plus the road network). The minimap then
 * just blits a window of that canvas each frame, which costs almost nothing.
 */

import { LOCATIONS, WORLD } from './config.js';
import { LAKE } from './terrain.js';

const SIZE = 720;   // offscreen map resolution

export class MapSystem {
  constructor(terrain, network, locations, save) {
    this.terrain = terrain;
    this.network = network;
    this.locations = locations;
    this.save = save;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = SIZE;
    this.ctx = this.canvas.getContext('2d');
    this.half = terrain.half;
    this.built = false;
    this.minimapZoom = 0.30;      // world metres shown = half*2*zoom
  }

  /** World → map-canvas pixel. */
  toPx(x, z) {
    return {
      x: ((x + this.half) / (this.half * 2)) * SIZE,
      y: ((z + this.half) / (this.half * 2)) * SIZE,
    };
  }

  bake() {
    const ctx = this.ctx;
    const n = this.terrain.res + 1;
    const img = ctx.createImageData(SIZE, SIZE);
    const d = img.data;
    const H = this.terrain.heights;

    for (let py = 0; py < SIZE; py++) {
      const fz = (py / SIZE) * (n - 1);
      const iz = Math.min(n - 2, fz | 0), tz = fz - iz;
      for (let px = 0; px < SIZE; px++) {
        const fx = (px / SIZE) * (n - 1);
        const ix = Math.min(n - 2, fx | 0), tx = fx - ix;
        const a = H[iz * n + ix], b = H[iz * n + ix + 1];
        const c = H[(iz + 1) * n + ix], e = H[(iz + 1) * n + ix + 1];
        const h = (a + (b - a) * tx) * (1 - tz) + (c + (e - c) * tx) * tz;

        // the lake is above sea level, so shade it from its own water line
        const wx = -this.half + (px / SIZE) * this.half * 2;
        const wz = -this.half + (py / SIZE) * this.half * 2;
        const inLake = Math.hypot(wx - LAKE.x, wz - LAKE.z) < LAKE.r + 20 && h < WORLD.lakeLevel;
        let r, g, bl;
        if (inLake) {
          const d = WORLD.lakeLevel - h;
          const t = Math.min(1, d / 5);
          r = 96 - t * 60; g = 178 - t * 80; bl = 172 - t * 50;
        }
        else if (h < -6) { r = 16; g = 52; bl = 78; }
        else if (h < 0) { const t = (h + 6) / 6; r = 16 + t * 40; g = 52 + t * 96; bl = 78 + t * 76; }
        else if (h < 3.2) { r = 226; g = 208; bl = 168; }
        else if (h < 26) { const t = (h - 3.2) / 22.8; r = 122 - t * 22; g = 158 - t * 14; bl = 84 - t * 16; }
        else if (h < 48) { const t = (h - 26) / 22; r = 100 + t * 30; g = 144 - t * 18; bl = 68 + t * 10; }
        else { const t = Math.min(1, (h - 48) / 30); r = 130 + t * 40; g = 126 + t * 40; bl = 120 + t * 44; }

        // cheap hill shading from the x/z gradient
        const hx = H[iz * n + Math.min(n - 1, ix + 1)] - H[iz * n + Math.max(0, ix - 1)];
        const hz = H[Math.min(n - 1, iz + 1) * n + ix] - H[Math.max(0, iz - 1) * n + ix];
        const shade = 1 + (-hx * 0.5 - hz * 0.5) * 0.035;
        const i4 = (py * SIZE + px) * 4;
        d[i4] = Math.max(0, Math.min(255, r * shade));
        d[i4 + 1] = Math.max(0, Math.min(255, g * shade));
        d[i4 + 2] = Math.max(0, Math.min(255, bl * shade));
        d[i4 + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // roads and trails
    for (const road of this.network.roads) {
      ctx.beginPath();
      road.pts.forEach((p, i) => {
        const q = this.toPx(p[0], p[1]);
        i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y);
      });
      ctx.strokeStyle = road.kind === 'road' ? 'rgba(238,230,214,0.92)' : 'rgba(206,180,140,0.75)';
      ctx.lineWidth = road.kind === 'road' ? 3.4 : 2.0;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    for (const river of this.network.rivers) {
      ctx.beginPath();
      river.pts.forEach((p, i) => {
        const q = this.toPx(p[0], p[1]);
        i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y);
      });
      ctx.strokeStyle = 'rgba(110,190,205,0.85)';
      ctx.lineWidth = 2.6;
      ctx.stroke();
    }
    this.built = true;
  }

  /* ------------------------------------------------------------ draw */

  drawMinimap(canvas, player, companion, heading) {
    if (!this.built) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const span = this.half * 2 * this.minimapZoom;
    const p = this.toPx(player.x, player.z);
    const src = (span / (this.half * 2)) * SIZE;

    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, W / 2 - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#0a1420';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(this.canvas, p.x - src / 2, p.y - src / 2, src, src, 0, 0, W, H);

    const toLocal = (wx, wz) => {
      const q = this.toPx(wx, wz);
      return { x: ((q.x - (p.x - src / 2)) / src) * W, y: ((q.y - (p.y - src / 2)) / src) * H };
    };

    // discovered markers
    for (const def of LOCATIONS) {
      if (!this.save.isDiscovered(def.id)) continue;
      const loc = this.locations.get(def.id);
      if (!loc) continue;
      const q = toLocal(loc.x, loc.z);
      if (q.x < -20 || q.y < -20 || q.x > W + 20 || q.y > H + 20) continue;
      ctx.beginPath();
      ctx.arc(q.x, q.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = def.color;
      ctx.globalAlpha = 0.92;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = 'rgba(0,0,0,.45)';
      ctx.stroke();
    }

    // companion
    if (companion) {
      const q = toLocal(companion.x, companion.z);
      ctx.beginPath();
      ctx.arc(q.x, q.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd1e0';
      ctx.fill();
    }

    // player arrow
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(heading);
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(7, 8);
    ctx.lineTo(0, 4);
    ctx.lineTo(-7, 8);
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.restore();
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, W / 2 - 1.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,.20)';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  /** Full map: returns marker rectangles so the UI can make them clickable. */
  drawFull(canvas, player) {
    if (!this.built) return [];
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(this.canvas, 0, 0, SIZE, SIZE, 0, 0, W, H);

    const sx = W / SIZE, sy = H / SIZE;
    const markers = [];
    const placed = [];
    /** Nudge a label up or down until it clears the ones already drawn. */
    const labelY = (x, y, w) => {
      let ly = y - 14;
      for (let tries = 0; tries < 14; tries++) {
        const hit = placed.some(p => Math.abs(p.x - x) < (p.w + w) / 2 && Math.abs(p.y - ly) < 13);
        if (!hit) break;
        ly += (tries % 2 ? 1 : -1) * (13 + Math.floor(tries / 2) * 3);
      }
      placed.push({ x, y: ly, w });
      return ly;
    };
    for (const def of LOCATIONS) {
      const loc = this.locations.get(def.id);
      if (!loc) continue;
      const known = this.save.isDiscovered(def.id);
      const q = this.toPx(loc.x, loc.z);
      const x = q.x * sx, y = q.y * sy;
      if (!known) {
        if (def.secret) continue;
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,.16)';
        ctx.fill();
        ctx.font = '700 11px Inter, system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,.45)';
        ctx.textAlign = 'center';
        ctx.fillText('?', x, y + 4);
        continue;
      }
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fillStyle = def.color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(10,14,24,.7)';
      ctx.stroke();
      ctx.font = '700 12px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      const ly = labelY(x, y, ctx.measureText(def.name).width + 8);
      if (Math.abs(ly - (y - 14)) > 2) {
        ctx.strokeStyle = 'rgba(255,255,255,.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y - 9);
        ctx.lineTo(x, ly + 4);
        ctx.stroke();
      }
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(8,12,20,.85)';
      ctx.strokeText(def.name, x, ly);
      ctx.fillStyle = '#fff';
      ctx.fillText(def.name, x, ly);
      markers.push({ id: def.id, x, y, r: 16, name: def.name, travel: def.fastTravel });
    }

    // player
    const p = this.toPx(player.x, player.z);
    ctx.beginPath();
    ctx.arc(p.x * sx, p.y * sy, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#e2527a';
    ctx.lineWidth = 3;
    ctx.fill();
    ctx.stroke();
    return markers;
  }

  /** Discovery check — returns newly discovered location ids. */
  checkDiscovery(pos) {
    const found = [];
    for (const def of LOCATIONS) {
      if (this.save.isDiscovered(def.id)) continue;
      const loc = this.locations.get(def.id);
      if (!loc) continue;
      const r = def.radius || 30;
      if (Math.hypot(pos.x - loc.x, pos.z - loc.z) < r) {
        this.save.discover(def.id);
        found.push(def);
      }
    }
    return found;
  }

  /** Which location the player is currently standing in (nearest match). */
  currentArea(pos) {
    let best = null, bestD = Infinity;
    for (const def of LOCATIONS) {
      const loc = this.locations.get(def.id);
      if (!loc) continue;
      const d = Math.hypot(pos.x - loc.x, pos.z - loc.z);
      if (d < (def.radius || 30) && d < bestD) { bestD = d; best = def; }
    }
    return best;
  }

  travelTargets() {
    return LOCATIONS.filter(l => l.fastTravel && this.save.isDiscovered(l.id))
      .map(l => ({ def: l, loc: this.locations.get(l.id) }));
  }
}
