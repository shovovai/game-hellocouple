/**
 * perf.js — keep the frame rate steady on hardware we cannot see.
 *
 * Guessing a quality level from `hardwareConcurrency` and `deviceMemory` is
 * unreliable: Safari does not report memory at all, and a laptop with eight
 * cores can still be driving an integrated GPU. So the guess only picks the
 * starting point, and this governor corrects it from the one number that
 * actually matters — how long frames are taking.
 *
 * Tiers here only touch things that can change mid-session: resolution,
 * shadows, view distance, crowd size. Anything that would mean rebuilding the
 * world (terrain resolution, tree density) stays fixed at load time.
 */

export const RUNTIME_TIERS = [
  {
    name: 'potato', label: 'Minimum',
    pixelRatio: 0.65, shadows: false, shadowMapSize: 1024, shadowEvery: 4,
    drawDistance: 480, fogDensity: 1.6, traffic: 0.25, pedestrians: 0.2, particles: 0.25,
  },
  {
    name: 'low', label: 'Low',
    pixelRatio: 1.0, shadows: false, shadowMapSize: 1024, shadowEvery: 3,
    drawDistance: 720, fogDensity: 1.3, traffic: 0.5, pedestrians: 0.45, particles: 0.4,
  },
  {
    name: 'medium', label: 'Medium',
    pixelRatio: 1.3, shadows: true, shadowMapSize: 2048, shadowEvery: 2,
    drawDistance: 1100, fogDensity: 1.0, traffic: 0.8, pedestrians: 0.8, particles: 0.75,
  },
  {
    name: 'high', label: 'High',
    pixelRatio: 2.0, shadows: true, shadowMapSize: 3072, shadowEvery: 1,
    drawDistance: 1800, fogDensity: 1.0, traffic: 1.0, pedestrians: 1.0, particles: 1.0,
  },
];

export const tierIndex = (name) => {
  const i = RUNTIME_TIERS.findIndex(t => t.name === name);
  return i < 0 ? 2 : i;
};

/**
 * Some GPUs are slow in ways no CPU counter reveals. When the driver will tell
 * us its name, use it — these strings are the common low-power parts.
 */
const WEAK_GPU = /(intel.*(hd|uhd) graphics|intel.*iris.*(5|6)|mali-[tg]\d|adreno \(tm\) [45]\d\d|powervr|videocore|llvmpipe|swiftshader|software)/i;
const STRONG_GPU = /(rtx|radeon rx|geforce gtx 1[06]|geforce rtx|apple m[1-9]|arc a\d)/i;

export function describeGPU(renderer) {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return '';
    return String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
  } catch { return ''; }
}

/**
 * Pick a starting tier. Deliberately conservative: stepping *up* after a few
 * good seconds is invisible, while starting too high means the player's first
 * impression is a slideshow.
 */
export function guessTier({ touch, renderer }) {
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 0;         // absent on Safari
  const gpu = renderer ? describeGPU(renderer) : '';

  if (WEAK_GPU.test(gpu)) return touch ? 'potato' : 'low';
  if (touch) {
    // A modern phone handles 'low' comfortably; older ones get corrected down
    // within a couple of seconds by the governor.
    return cores >= 6 ? 'low' : 'potato';
  }
  if (STRONG_GPU.test(gpu)) return 'high';
  if (cores <= 4 || (mem && mem <= 4)) return 'low';
  return 'medium';                                  // unknown desktop: earn 'high'
}

export class PerfGovernor {
  /**
   * @param {object} o {start, onChange(tier), enabled, min, max}
   */
  constructor(o = {}) {
    this.enabled = o.enabled !== false;
    this.min = tierIndex(o.min || 'potato');
    this.max = tierIndex(o.max || 'high');
    this.index = Math.min(this.max, Math.max(this.min, tierIndex(o.start || 'medium')));
    this.onChange = o.onChange || (() => {});
    this.samples = new Float32Array(60);
    this.n = 0;
    this.filled = false;
    this.have = 0;
    this.settle = 2.5;                 // ignore the first seconds after a change
    this.goodFor = 0;
    this.badFor = 0;
    this.lastChange = 0;
    this.changes = 0;
  }

  get tier() { return RUNTIME_TIERS[this.index]; }

  /** Clamp the range — used when the player picks a quality by hand. */
  setRange(minName, maxName) {
    this.min = tierIndex(minName);
    this.max = tierIndex(maxName);
    const want = Math.min(this.max, Math.max(this.min, this.index));
    if (want !== this.index) { this.index = want; this._emit(); }
  }

  _emit() {
    this.settle = 2.5;
    this.goodFor = 0;
    this.badFor = 0;
    this.n = 0;
    this.filled = false;
    this.have = 0;
    this.changes++;
    this.onChange(this.tier);
  }

  /** Feed one frame. `dt` in seconds. */
  frame(dt) {
    if (!this.enabled) return;
    const ms = dt * 1000;
    // A single long frame is usually a hitch (a tab wake, a GC, a build step),
    // not a trend — those must not drag the median around.
    if (ms > 500) return;
    if (this.settle > 0) { this.settle -= dt; return; }

    this.samples[this.n++] = ms;
    if (this.n >= this.samples.length) { this.n = 0; this.filled = true; }
    this.have = Math.min(this.samples.length, (this.have || 0) + 1);
    // Decide from a partial window once there is enough of one. On a device
    // running at five frames a second, waiting for sixty samples would mean
    // twelve seconds of stutter before the first correction.
    if (this.have < 20) return;

    const window = this.filled ? this.samples : this.samples.subarray(0, this.have);
    const sorted = Array.from(window).sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];

    // Falling badly behind: drop two tiers at once rather than crawl down.
    if (median > 55 && this.index > this.min) {
      this.index = Math.max(this.min, this.index - 2);
      return this._emit();
    }
    if (median > 26) {
      this.badFor += dt; this.goodFor = 0;
      if (this.badFor > 2.2 && this.index > this.min) {
        this.index--;
        return this._emit();
      }
    } else if (median < 11.5) {
      this.goodFor += dt; this.badFor = 0;
      // Raising quality is only worth it if it is likely to stick, so it takes
      // a long clean run — and after a few corrections we stop trying, or the
      // player gets an oscillating picture.
      if (this.goodFor > 14 && this.index < this.max && this.changes < 6) {
        this.index++;
        return this._emit();
      }
    } else {
      this.badFor = 0; this.goodFor = 0;
    }
  }
}
