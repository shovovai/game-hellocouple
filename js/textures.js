/**
 * textures.js — every texture in the game is generated procedurally at load
 * time. No image files are downloaded, so the build stays tiny and there are
 * no licensing questions. Textures are cached by key.
 */

import * as THREE from 'three';
import { noise2, fbm, clamp, makeRng } from './noise.js';

const cache = new Map();
let maxAniso = 4;

export function setAnisotropy(v) { maxAniso = v; }

function canvasOf(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

/** Build a texture by evaluating `fn(x, y, data, i)` for every pixel. */
function pixelTexture(key, size, fn, { repeat = 1, srgb = true } = {}) {
  if (cache.has(key)) return cache.get(key);
  const c = canvasOf(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      fn(x, y, d, i, size);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = maxAniso;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

/** Build a texture from arbitrary canvas drawing commands. */
function drawTexture(key, size, draw, { repeat = 1, srgb = true, wrap = THREE.RepeatWrapping } = {}) {
  if (cache.has(key)) return cache.get(key);
  const c = canvasOf(size);
  const ctx = c.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = wrap;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = maxAniso;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

const mix = (a, b, t) => a + (b - a) * t;

/* ------------------------------------------------------------ materials */

export function sandTexture() {
  return pixelTexture('sand', 256, (x, y, d, i) => {
    const g = fbm(x * 0.09, y * 0.09, 4, 11) * 0.5 + 0.5;
    const grain = noise2(x * 1.7, y * 1.7, 4) * 0.5 + 0.5;
    const v = mix(0.82, 1.0, g) * mix(0.92, 1.06, grain);
    d[i] = clamp(228 * v, 0, 255);
    d[i + 1] = clamp(210 * v, 0, 255);
    d[i + 2] = clamp(176 * v, 0, 255);
    d[i + 3] = 255;
  }, { repeat: 1 });
}

export function grassTexture() {
  return pixelTexture('grass', 256, (x, y, d, i) => {
    const g = fbm(x * 0.07, y * 0.07, 4, 23) * 0.5 + 0.5;
    const blade = noise2(x * 2.3, y * 0.6, 9) * 0.5 + 0.5;
    const patch = fbm(x * 0.021, y * 0.021, 3, 31) * 0.5 + 0.5;
    const v = mix(0.72, 1.08, g) * mix(0.93, 1.05, blade);
    d[i] = clamp(mix(86, 122, patch) * v, 0, 255);
    d[i + 1] = clamp(mix(126, 158, patch) * v, 0, 255);
    d[i + 2] = clamp(mix(60, 78, patch) * v, 0, 255);
    d[i + 3] = 255;
  });
}

export function rockTexture() {
  return pixelTexture('rock', 256, (x, y, d, i) => {
    const g = fbm(x * 0.05, y * 0.05, 5, 77) * 0.5 + 0.5;
    const crack = Math.abs(noise2(x * 0.16, y * 0.16, 13));
    const v = mix(0.62, 1.05, g) * (crack < 0.05 ? 0.72 : 1);
    d[i] = clamp(132 * v, 0, 255);
    d[i + 1] = clamp(128 * v, 0, 255);
    d[i + 2] = clamp(122 * v, 0, 255);
    d[i + 3] = 255;
  });
}

export function dirtTexture() {
  return pixelTexture('dirt', 256, (x, y, d, i) => {
    const g = fbm(x * 0.08, y * 0.08, 4, 91) * 0.5 + 0.5;
    const v = mix(0.74, 1.06, g);
    d[i] = clamp(146 * v, 0, 255);
    d[i + 1] = clamp(118 * v, 0, 255);
    d[i + 2] = clamp(86 * v, 0, 255);
    d[i + 3] = 255;
  });
}

export function asphaltTexture() {
  return pixelTexture('asphalt', 256, (x, y, d, i) => {
    const g = fbm(x * 0.35, y * 0.35, 3, 5) * 0.5 + 0.5;
    const grain = noise2(x * 3.1, y * 3.1, 17) * 0.5 + 0.5;
    const v = mix(0.78, 1.1, g) * mix(0.9, 1.08, grain);
    d[i] = clamp(74 * v, 0, 255);
    d[i + 1] = clamp(74 * v, 0, 255);
    d[i + 2] = clamp(79 * v, 0, 255);
    d[i + 3] = 255;
  });
}

export function pavingTexture() {
  return drawTexture('paving', 256, (ctx, s) => {
    ctx.fillStyle = '#adb1b4';
    ctx.fillRect(0, 0, s, s);
    const rng = makeRng(41);
    const tile = s / 4;
    for (let gy = 0; gy < 4; gy++) {
      for (let gx = 0; gx < 4; gx++) {
        const v = 0.88 + rng() * 0.22;
        ctx.fillStyle = `rgb(${178 * v | 0},${182 * v | 0},${186 * v | 0})`;
        ctx.fillRect(gx * tile + 1.5, gy * tile + 1.5, tile - 3, tile - 3);
      }
    }
    ctx.globalAlpha = 0.12;
    for (let i = 0; i < 1400; i++) {
      ctx.fillStyle = rng() > 0.5 ? '#fff' : '#000';
      ctx.fillRect(rng() * s, rng() * s, 1.5, 1.5);
    }
    ctx.globalAlpha = 1;
  });
}

export function woodTexture(key = 'wood', base = [148, 106, 66]) {
  return pixelTexture(key, 256, (x, y, d, i) => {
    const rings = Math.sin((y * 0.32) + fbm(x * 0.03, y * 0.12, 3, 3) * 5.5) * 0.5 + 0.5;
    const grain = noise2(x * 0.4, y * 2.4, 8) * 0.5 + 0.5;
    const v = mix(0.72, 1.08, rings) * mix(0.94, 1.04, grain);
    d[i] = clamp(base[0] * v, 0, 255);
    d[i + 1] = clamp(base[1] * v, 0, 255);
    d[i + 2] = clamp(base[2] * v, 0, 255);
    d[i + 3] = 255;
  });
}

export function plankTexture() {
  return drawTexture('planks', 256, (ctx, s) => {
    const rng = makeRng(9);
    const rows = 6, h = s / rows;
    for (let r = 0; r < rows; r++) {
      const v = 0.82 + rng() * 0.3;
      ctx.fillStyle = `rgb(${160 * v | 0},${118 * v | 0},${76 * v | 0})`;
      ctx.fillRect(0, r * h, s, h - 1.5);
      ctx.strokeStyle = 'rgba(60,38,22,.55)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, r * h + h - 1); ctx.lineTo(s, r * h + h - 1); ctx.stroke();
      ctx.globalAlpha = 0.12;
      for (let i = 0; i < 120; i++) {
        ctx.strokeStyle = rng() > 0.5 ? '#5a3a20' : '#d8b184';
        ctx.beginPath();
        const yy = r * h + rng() * h;
        ctx.moveTo(rng() * s, yy); ctx.lineTo(rng() * s, yy + rng() * 2 - 1); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  });
}

export function barkTexture() {
  return pixelTexture('bark', 128, (x, y, d, i) => {
    const v0 = fbm(x * 0.22, y * 0.05, 4, 61) * 0.5 + 0.5;
    const groove = Math.abs(Math.sin(x * 0.55 + v0 * 4)) ** 0.6;
    const v = mix(0.52, 1.0, groove) * mix(0.8, 1.1, v0);
    d[i] = clamp(104 * v, 0, 255);
    d[i + 1] = clamp(80 * v, 0, 255);
    d[i + 2] = clamp(58 * v, 0, 255);
    d[i + 3] = 255;
  });
}

export function plasterTexture(key = 'plaster', base = [232, 226, 214]) {
  return pixelTexture(key, 128, (x, y, d, i) => {
    const g = fbm(x * 0.14, y * 0.14, 3, 44) * 0.5 + 0.5;
    const v = mix(0.93, 1.04, g);
    d[i] = clamp(base[0] * v, 0, 255);
    d[i + 1] = clamp(base[1] * v, 0, 255);
    d[i + 2] = clamp(base[2] * v, 0, 255);
    d[i + 3] = 255;
  });
}

export function brickTexture() {
  return drawTexture('brick', 256, (ctx, s) => {
    ctx.fillStyle = '#8d6b5c';
    ctx.fillRect(0, 0, s, s);
    const rng = makeRng(77);
    const bh = s / 8, bw = s / 4;
    for (let r = 0; r < 8; r++) {
      const off = (r % 2) * bw * 0.5;
      for (let c = -1; c < 5; c++) {
        const v = 0.82 + rng() * 0.32;
        ctx.fillStyle = `rgb(${168 * v | 0},${94 * v | 0},${72 * v | 0})`;
        ctx.fillRect(c * bw + off + 2, r * bh + 2, bw - 4, bh - 4);
      }
    }
  });
}

export function roofTexture() {
  return drawTexture('roof', 256, (ctx, s) => {
    ctx.fillStyle = '#6c3b30';
    ctx.fillRect(0, 0, s, s);
    const rng = makeRng(23);
    const rows = 8, h = s / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < 8; c++) {
        const v = 0.84 + rng() * 0.3;
        ctx.fillStyle = `rgb(${150 * v | 0},${72 * v | 0},${56 * v | 0})`;
        const w = s / 8;
        ctx.beginPath();
        ctx.roundRect(c * w + 1 + (r % 2) * w * 0.5 - w * 0.25, r * h + 1, w - 2, h - 2, 3);
        ctx.fill();
      }
    }
  });
}

export function fabricTexture(key, rgb) {
  return pixelTexture(key, 64, (x, y, d, i) => {
    const weave = ((x % 4 < 2) !== (y % 4 < 2)) ? 1.04 : 0.95;
    const g = noise2(x * 0.6, y * 0.6, 5) * 0.06 + 1;
    d[i] = clamp(rgb[0] * weave * g, 0, 255);
    d[i + 1] = clamp(rgb[1] * weave * g, 0, 255);
    d[i + 2] = clamp(rgb[2] * weave * g, 0, 255);
    d[i + 3] = 255;
  });
}

/* ------------------------------------------------------- alpha / sprites */

/** Leaf cluster card used by billboard vegetation. */
export function leafTexture(key = 'leaf', tint = [86, 132, 62]) {
  if (cache.has(key)) return cache.get(key);
  const size = 128;
  const c = canvasOf(size);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  const rng = makeRng(key.length * 17 + 3);
  for (let i = 0; i < 120; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.pow(rng(), 0.6) * size * 0.44;
    const x = size / 2 + Math.cos(a) * r;
    const y = size / 2 + Math.sin(a) * r * 0.92;
    const rad = 6 + rng() * 12;
    const v = 0.7 + rng() * 0.55;
    ctx.fillStyle = `rgba(${tint[0] * v | 0},${tint[1] * v | 0},${tint[2] * v | 0},0.95)`;
    ctx.beginPath();
    ctx.ellipse(x, y, rad, rad * (0.6 + rng() * 0.5), a, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  cache.set(key, tex);
  return tex;
}

/** Opaque mottled leaf surface — tiles over foliage blobs. */
export function leafSurfaceTexture(key, tint = [92, 134, 68]) {
  return pixelTexture('leafs:' + key, 128, (x, y, d, i) => {
    const clump = fbm(x * 0.09, y * 0.09, 4, key.length * 7 + 3) * 0.5 + 0.5;
    const veins = Math.abs(noise2(x * 0.55, y * 0.55, 21));
    const speck = noise2(x * 1.9, y * 1.9, 31) * 0.5 + 0.5;
    const v = mix(0.68, 1.18, clump) * mix(0.92, 1.06, speck) * (veins < 0.06 ? 0.82 : 1);
    d[i] = clamp(tint[0] * v, 0, 255);
    d[i + 1] = clamp(tint[1] * v, 0, 255);
    d[i + 2] = clamp(tint[2] * v, 0, 255);
    d[i + 3] = 255;
  }, { repeat: 1 });
}

/** Soft round sprite — particles, glows, light halos. */
export function glowTexture(key = 'glow', inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  if (cache.has(key)) return cache.get(key);
  const size = 128;
  const c = canvasOf(size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.45, inner.replace(/[\d.]+\)$/, '0.45)'));
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

/** Grass blade tuft (alpha-tested billboard). */
export function grassBladeTexture() {
  if (cache.has('blade')) return cache.get('blade');
  const size = 64;
  const c = canvasOf(size);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  const rng = makeRng(5);
  for (let i = 0; i < 16; i++) {
    const x = 6 + rng() * (size - 12);
    const h = size * (0.45 + rng() * 0.5);
    const lean = (rng() - 0.5) * 14;
    const v = 0.6 + rng() * 0.6;
    ctx.strokeStyle = `rgba(${92 * v | 0},${140 * v | 0},${62 * v | 0},0.95)`;
    ctx.lineWidth = 1.6 + rng() * 1.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, size);
    ctx.quadraticCurveTo(x + lean * 0.4, size - h * 0.6, x + lean, size - h);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set('blade', tex);
  return tex;
}

/** Water surface normal map (two scrolling octaves are combined in-shader). */
export function waterNormalTexture() {
  return pixelTexture('waterN', 256, (x, y, d, i, s) => {
    const e = 1.2;
    const h = (a, b) => fbm(a * 0.055, b * 0.055, 4, 19) + 0.35 * fbm(a * 0.16, b * 0.16, 3, 29);
    const nx = h(x - e, y) - h(x + e, y);
    const ny = h(x, y - e) - h(x, y + e);
    const len = Math.hypot(nx, ny, 1) || 1;
    d[i] = clamp((nx / len * 0.5 + 0.5) * 255, 0, 255);
    d[i + 1] = clamp((ny / len * 0.5 + 0.5) * 255, 0, 255);
    d[i + 2] = clamp((1 / len * 0.5 + 0.5) * 255, 0, 255);
    d[i + 3] = 255;
  }, { srgb: false });
}

/** Vertical streaks for the waterfall sheet. */
export function waterfallTexture() {
  if (cache.has('falls')) return cache.get('falls');
  const size = 128;
  const c = canvasOf(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(226,244,255,0.35)';
  ctx.fillRect(0, 0, size, size);
  const rng = makeRng(31);
  for (let i = 0; i < 90; i++) {
    const x = rng() * size;
    const w = 1 + rng() * 5;
    ctx.fillStyle = `rgba(255,255,255,${0.12 + rng() * 0.5})`;
    ctx.fillRect(x, 0, w, size);
  }
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.15 + rng() * 0.6})`;
    ctx.fillRect(rng() * size, rng() * size, 1 + rng() * 3, 6 + rng() * 26);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set('falls', tex);
  return tex;
}

/** Window strip used on building facades (lit at night via emissive map). */
export function windowTexture() {
  return drawTexture('windows', 128, (ctx, s) => {
    ctx.fillStyle = '#1d2836';
    ctx.fillRect(0, 0, s, s);
    const g = ctx.createLinearGradient(0, 0, s, s);
    g.addColorStop(0, 'rgba(180,215,240,.85)');
    g.addColorStop(0.45, 'rgba(120,160,195,.55)');
    g.addColorStop(1, 'rgba(210,235,255,.75)');
    ctx.fillStyle = g;
    ctx.fillRect(2, 2, s - 4, s - 4);
    ctx.strokeStyle = 'rgba(255,255,255,.35)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(s / 2, 0); ctx.lineTo(s / 2, s); ctx.stroke();
  });
}

export function signTexture(key, lines, bg = '#2c2118', fg = '#f6e9d6') {
  if (cache.has(key)) return cache.get(key);
  const w = 512, h = 256;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,.22)';
  ctx.lineWidth = 6;
  ctx.strokeRect(10, 10, w - 20, h - 20);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const arr = Array.isArray(lines) ? lines : [lines];
  const step = h / (arr.length + 1);
  const maxW = w - 60;
  arr.forEach((t, i) => {
    // Shrink to fit rather than letting a long place name run off the board.
    let size = i === 0 ? 54 : 38;
    do {
      ctx.font = `600 ${size}px "Segoe UI", system-ui, sans-serif`;
      if (ctx.measureText(t).width <= maxW) break;
      size -= 2;
    } while (size > 14);
    ctx.fillText(t, w / 2, step * (i + 1));
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  cache.set(key, tex);
  return tex;
}

export function menuBoardTexture() {
  if (cache.has('menuboard')) return cache.get('menuboard');
  const w = 512, h = 512;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#241c16';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#f3e6d2';
  ctx.textAlign = 'center';
  ctx.font = '700 46px "Segoe UI", system-ui, sans-serif';
  ctx.fillText('MENU', w / 2, 70);
  ctx.font = '400 34px "Segoe UI", system-ui, sans-serif';
  const items = ['Coffee', 'Tea', 'Hot Chocolate', 'Lemonade', 'Milkshake'];
  items.forEach((t, i) => {
    ctx.textAlign = 'left';
    ctx.fillText(t, 60, 150 + i * 62);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffc978';
    ctx.fillText('♥', w - 60, 150 + i * 62);
    ctx.fillStyle = '#f3e6d2';
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set('menuboard', tex);
  return tex;
}

export function disposeAll() {
  cache.forEach(t => t.dispose());
  cache.clear();
}

/* ------------------------------------------------------ city facades */

/**
 * Building facade: a grid of windows with floor slabs and a ground-floor
 * shopfront. One 256px tile represents four storeys, so a tower is just a box
 * with the UVs scaled by its real height.
 */
export function facadeTexture(key, o = {}) {
  const {
    wall = [188, 184, 176], glass = [96, 128, 152], frame = [232, 230, 224],
    cols = 4, rows = 4, glassy = 0.0, seedNum = 1,
  } = o;
  return drawTexture('facade:' + key, 256, (ctx, S) => {
    const rng = makeRng(seedNum * 131 + 7);
    // wall base with subtle vertical banding
    ctx.fillStyle = `rgb(${wall[0]},${wall[1]},${wall[2]})`;
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 900; i++) {
      const v = 0.94 + rng() * 0.12;
      ctx.fillStyle = `rgba(${wall[0] * v | 0},${wall[1] * v | 0},${wall[2] * v | 0},0.5)`;
      ctx.fillRect(rng() * S, rng() * S, 2 + rng() * 7, 2 + rng() * 22);
    }

    const cw = S / cols, ch = S / rows;
    for (let r = 0; r < rows; r++) {
      // floor slab
      ctx.fillStyle = `rgba(${wall[0] * 0.82 | 0},${wall[1] * 0.82 | 0},${wall[2] * 0.82 | 0},1)`;
      ctx.fillRect(0, r * ch, S, Math.max(2, ch * 0.09));

      for (let c = 0; c < cols; c++) {
        const pad = cw * (glassy > 0.5 ? 0.06 : 0.17);
        const x = c * cw + pad;
        const y = r * ch + ch * 0.22;
        const w = cw - pad * 2;
        const h = ch * (glassy > 0.5 ? 0.66 : 0.55);

        // frame
        ctx.fillStyle = `rgb(${frame[0]},${frame[1]},${frame[2]})`;
        ctx.fillRect(x - 2, y - 2, w + 4, h + 4);

        // glass with a sky-to-floor gradient and a little per-pane variance
        const v = 0.72 + rng() * 0.55;
        const g = ctx.createLinearGradient(x, y, x, y + h);
        g.addColorStop(0, `rgb(${glass[0] * v * 1.25 | 0},${glass[1] * v * 1.25 | 0},${glass[2] * v * 1.3 | 0})`);
        g.addColorStop(0.55, `rgb(${glass[0] * v | 0},${glass[1] * v | 0},${glass[2] * v | 0})`);
        g.addColorStop(1, `rgb(${glass[0] * v * 0.62 | 0},${glass[1] * v * 0.62 | 0},${glass[2] * v * 0.7 | 0})`);
        ctx.fillStyle = g;
        ctx.fillRect(x, y, w, h);

        // mullion
        ctx.fillStyle = `rgba(${frame[0]},${frame[1]},${frame[2]},0.75)`;
        ctx.fillRect(x + w / 2 - 1, y, 2, h);
        if (rng() < 0.35) {   // a blind, half drawn
          ctx.fillStyle = 'rgba(240,236,226,0.55)';
          ctx.fillRect(x, y, w, h * (0.2 + rng() * 0.4));
        }
      }
    }
  }, { repeat: 1 });
}

/** Matching emissive map: the windows that are lit after dark. */
export function facadeLitTexture(key, o = {}) {
  const { cols = 4, rows = 4, glassy = 0.0, seedNum = 1, lit = 0.45 } = o;
  return drawTexture('facadeLit:' + key, 256, (ctx, S) => {
    const rng = makeRng(seedNum * 977 + 13);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, S, S);
    const cw = S / cols, ch = S / rows;
    const warm = ['#ffd9a0', '#ffc978', '#ffe9c4', '#cfe0ff'];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (rng() > lit) continue;
        const pad = cw * (glassy > 0.5 ? 0.06 : 0.17);
        const x = c * cw + pad;
        const y = r * ch + ch * 0.22;
        const w = cw - pad * 2;
        const h = ch * (glassy > 0.5 ? 0.66 : 0.55);
        ctx.fillStyle = warm[(rng() * warm.length) | 0];
        ctx.globalAlpha = 0.55 + rng() * 0.45;
        ctx.fillRect(x, y, w, h);
      }
    }
    ctx.globalAlpha = 1;
  }, { repeat: 1, srgb: true });
}

/** Ground-floor shopfront strip: glazing, awning line, signage band. */
export function shopfrontTexture(key, o = {}) {
  const { base = [58, 62, 72], accent = [226, 95, 134] } = o;
  return drawTexture('shopfront:' + key, 256, (ctx, S) => {
    const rng = makeRng(key.length * 51 + 3);
    ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
    ctx.fillRect(0, 0, S, S);
    // signage band across the top
    ctx.fillStyle = `rgb(${accent[0]},${accent[1]},${accent[2]})`;
    ctx.fillRect(0, 0, S, S * 0.19);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    for (let i = 0; i < 5; i++) ctx.fillRect(26 + i * 42, S * 0.07, 26, 6);
    // glazing
    for (let i = 0; i < 4; i++) {
      const x = 10 + i * (S - 20) / 4;
      const w = (S - 20) / 4 - 8;
      const g = ctx.createLinearGradient(x, S * 0.22, x, S);
      g.addColorStop(0, 'rgba(190,215,235,0.95)');
      g.addColorStop(0.6, 'rgba(120,150,175,0.9)');
      g.addColorStop(1, 'rgba(70,92,112,0.95)');
      ctx.fillStyle = g;
      ctx.fillRect(x, S * 0.24, w, S * 0.66);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(x, S * 0.24, w, 3);
      if (rng() < 0.5) {
        ctx.fillStyle = 'rgba(255,240,220,0.45)';
        ctx.fillRect(x + 6, S * 0.34, w - 12, S * 0.3);
      }
    }
    // kerb shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, S * 0.92, S, S * 0.08);
  }, { repeat: 1 });
}

/** Asphalt with a painted lane line down the middle of the tile. */
export function roadLineTexture(key, dashed = true) {
  return drawTexture('roadline:' + key, 128, (ctx, S) => {
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#eee4c8';
    if (dashed) ctx.fillRect(S * 0.42, 0, S * 0.16, S * 0.55);
    else ctx.fillRect(S * 0.42, 0, S * 0.16, S);
  }, { repeat: 1 });
}


/* --------------------------------------------------- character surfaces */

/**
 * Character skin/cloth detail. These are shared by every character in the
 * world: the map is near-white greyscale so the material's own colour still
 * decides the hue, and the matching normal map is what actually makes cloth
 * read as cloth under moving light.
 */

/** Greyscale multiplier map (linear, so a value of 255 leaves colour alone). */
function detailTexture(key, size, fn, repeat = 1) {
  return pixelTexture(key, size, (x, y, d, i, s) => {
    const v = clamp(fn(x, y, s) * 255, 0, 255);
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }, { srgb: false, repeat });
}

/** Tangent-space normal map derived from a tiling height function. */
function normalTexture(key, size, h, strength = 1.5, repeat = 1) {
  return pixelTexture(key, size, (x, y, d, i, s) => {
    const w = (a, b) => h((a + s) % s, (b + s) % s, s);
    const dx = (w(x + 1, y) - w(x - 1, y)) * strength;
    const dy = (w(x, y + 1) - w(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1);
    d[i] = (-dx / l * 0.5 + 0.5) * 255;
    d[i + 1] = (-dy / l * 0.5 + 0.5) * 255;
    d[i + 2] = (1 / l * 0.5 + 0.5) * 255;
    d[i + 3] = 255;
  }, { srgb: false, repeat });
}

// Height fields, all in 0..1 and tiling over the texture size.
const SURFACE_HEIGHT = {
  // fine cotton knit: a square weave with slubs
  knit: (x, y) => 0.5 + Math.sin(x * Math.PI * 0.5) * Math.sin(y * Math.PI * 0.5) * 0.34
    + noise2(x * 0.35, y * 0.35, 11) * 0.16,
  // denim: a diagonal twill rib plus a coarse thread
  denim: (x, y) => 0.5 + Math.sin((x + y) * 0.78) * 0.3
    + Math.sin(x * 1.9) * 0.1 + noise2(x * 0.5, y * 0.5, 17) * 0.14,
  // leather / canvas shoe: pebbled grain
  leather: (x, y) => 0.5 + fbm(x * 0.22, y * 0.22, 3, 23) * 0.5,
  // skin: shallow pores only — this must stay subtle or it looks like stone
  skin: (x, y) => 0.5 + noise2(x * 1.4, y * 1.4, 7) * 0.28 + fbm(x * 0.2, y * 0.2, 2, 5) * 0.2,
  // hair: vertical strands with a little wander
  hair: (x, y) => 0.5 + Math.sin(x * 1.5 + noise2(x * 0.1, y * 0.12, 3) * 2.4) * 0.38
    + noise2(x * 0.8, y * 0.3, 9) * 0.12,
};

const SURFACE_SHADE = {
  knit: 0.028, denim: 0.038, leather: 0.05, skin: 0.022, hair: 0.11,
};

/** Greyscale detail map for a character surface kind. */
export function surfaceDetail(kind) {
  const h = SURFACE_HEIGHT[kind] || SURFACE_HEIGHT.knit;
  const amp = SURFACE_SHADE[kind] ?? 0.06;
  return detailTexture('surfd:' + kind, 64, (x, y) => 1 - amp + (h(x, y) - 0.5) * amp * 2);
}

/** Matching normal map for a character surface kind. */
export function surfaceNormal(kind) {
  const h = SURFACE_HEIGHT[kind] || SURFACE_HEIGHT.knit;
  const str = kind === 'skin' ? 0.35 : kind === 'hair' ? 1.6 : 0.9;
  return normalTexture('surfn:' + kind, 64, h, str);
}

/** Eye: white sclera with a coloured iris and pupil, drawn once per hue. */
export function irisTexture(colorHex = '#4a3324') {
  const key = 'iris:' + colorHex;
  if (cache.has(key)) return cache.get(key);
  const size = 64;
  const c = canvasOf(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e9e2da';
  ctx.fillRect(0, 0, size, size);
  const cx = size / 2, cy = size / 2;
  // The iris covers most of the sphere: a small iris on a big white ball is
  // what makes a face read as a cartoon.
  const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, size * 0.44);
  g.addColorStop(0, '#0a0807');
  g.addColorStop(0.38, '#0a0807');
  g.addColorStop(0.43, colorHex);
  g.addColorStop(0.88, colorHex);
  g.addColorStop(1, '#1d1510');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.44, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath();
  ctx.arc(cx - size * 0.13, cy - size * 0.15, size * 0.06, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  cache.set(key, tex);
  return tex;
}

/** Clear-coat orange peel — very fine, just enough to break up flat paint. */
export function carPaintNormal() {
  return normalTexture('carpaint', 64, (x, y) =>
    0.5 + fbm(x * 0.22, y * 0.22, 3, 41) * 0.5, 0.35, 6);
}

/* ------------------------------------------------- architectural normals */

/**
 * Surface relief for architecture. The colour maps already carry the pattern;
 * these give the same pattern real depth under the moving sun, which is most
 * of what separates "a painted box" from "a wall".
 */
const ARCH_HEIGHT = {
  plaster: (x, y) => 0.5 + fbm(x * 0.14, y * 0.14, 3, 13) * 0.45 + noise2(x * 1.2, y * 1.2, 3) * 0.12,
  // brick: courses 8 px tall, 16 px long, offset every other row, deep mortar
  brick: (x, y, s) => {
    const row = Math.floor(y / 8);
    const bx = (x + (row % 2 ? 8 : 0)) % 16;
    const by = y % 8;
    const mortar = bx < 1.3 || by < 1.3;
    return mortar ? 0.14 : 0.78 + noise2(x * 0.9, y * 0.9, 7) * 0.2;
  },
  // roof: overlapping tile courses
  roof: (x, y) => {
    const by = y % 10;
    const bx = (x + (Math.floor(y / 10) % 2 ? 6 : 0)) % 12;
    return (by < 1.6 ? 0.1 : 0.55 + (by / 10) * 0.45) * (bx < 1 ? 0.6 : 1);
  },
  stone: (x, y) => 0.5 + fbm(x * 0.11, y * 0.11, 4, 29) * 0.6,
  wood: (x, y) => 0.5 + Math.sin(y * 0.55 + noise2(x * 0.1, y * 0.08, 5) * 3) * 0.22
    + noise2(x * 1.1, y * 0.25, 9) * 0.2,
  concrete: (x, y) => 0.5 + fbm(x * 0.3, y * 0.3, 3, 19) * 0.3,
  paving: (x, y) => ((x % 16 < 1.2) || (y % 16 < 1.2)) ? 0.15 : 0.8 + noise2(x * 0.7, y * 0.7, 23) * 0.18,
  asphalt: (x, y) => 0.5 + fbm(x * 0.6, y * 0.6, 3, 31) * 0.4,
};

const ARCH_STRENGTH = {
  plaster: 0.5, brick: 2.4, roof: 2.0, stone: 1.6, wood: 0.9,
  concrete: 0.45, paving: 1.6, asphalt: 0.7,
};

/** Normal map for an architectural surface kind. */
export function archNormal(kind, repeat = 1) {
  const h = ARCH_HEIGHT[kind];
  if (!h) return null;
  const tex = normalTexture('archn:' + kind, 128, h, ARCH_STRENGTH[kind] ?? 1);
  if (repeat !== 1) { tex.repeat.set(repeat, repeat); }
  return tex;
}
