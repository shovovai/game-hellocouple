/**
 * layout.js — decides *where* everything goes.
 *
 * Location anchors in config.js are only hints: this module snaps each one onto
 * ground that is actually suitable (flat enough, above the tide line, on the
 * right side of the coast) and then lays out the road / trail / river network
 * that connects them. Because placement is derived from the terrain instead of
 * hard-coded, new locations can be dropped in anywhere without hand-tuning.
 */

import { LOCATIONS, WORLD } from './config.js';
import { LAKE } from './terrain.js';
import { clamp, lerp } from './noise.js';

/** Catmull-Rom resample — turns a handful of waypoints into a smooth road. */
export function smoothPolyline(points, step = 6) {
  if (points.length < 3) return points.slice();
  const pts = [points[0], ...points, points[points.length - 1]];
  const out = [];
  for (let i = 1; i < pts.length - 2; i++) {
    const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2];
    const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(2, Math.ceil(segLen / step));
    for (let j = 0; j < n; j++) {
      const t = j / n, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

function slopeAt(terrain, x, z) {
  const h = terrain.sampleBase(x, z);
  const e = 3.5;
  const dx = terrain.sampleBase(x + e, z) - terrain.sampleBase(x - e, z);
  const dz = terrain.sampleBase(x, z + e) - terrain.sampleBase(x, z - e);
  return { h, slope: Math.hypot(dx, dz) / (2 * e) };
}

/** The lowest ground a location may sit on — above the tide, and above the lake. */
function minGround(x, z) {
  const inBowl = Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 14;
  return inBowl ? WORLD.lakeLevel + 1.6 : 4.2;
}

/** Spiral-search for the flattest piece of dry land near an anchor. */
function snapInland(terrain, ax, az, searchR = 54) {
  let best = null;
  for (let r = 0; r <= searchR; r += 4) {
    const steps = r === 0 ? 1 : Math.max(8, Math.round(r * 0.9));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const x = ax + Math.cos(a) * r;
      const z = az + Math.sin(a) * r;
      const { h, slope } = slopeAt(terrain, x, z);
      if (h < minGround(x, z)) continue;           // keep off the tide line and out of the lake
      const score = slope * 100 + r * 0.35;
      if (!best || score < best.score) best = { x, z, h, slope, score };
    }
    if (best && best.slope < 0.10 && r > 8) break; // good enough, stay close
  }
  return best || { x: ax, z: az, h: terrain.sampleBase(ax, az), slope: 0 };
}

/** Find high, walkable ground — used for viewpoints. */
function snapPeak(terrain, ax, az, searchR = 56) {
  let best = null;
  for (let r = 0; r <= searchR; r += 4) {
    const steps = r === 0 ? 1 : Math.max(8, Math.round(r * 0.8));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const x = ax + Math.cos(a) * r;
      const z = az + Math.sin(a) * r;
      const { h, slope } = slopeAt(terrain, x, z);
      if (slope > 0.42) continue;
      const score = h - r * 0.08;
      if (!best || score > best.score) best = { x, z, h, slope, score };
    }
  }
  return best || { x: ax, z: az, h: terrain.sampleBase(ax, az), slope: 0 };
}

/** March outward along a bearing until the ground drops into the sea. */
function snapShore(terrain, ax, az, offset = 14) {
  const ang = Math.atan2(az, ax);
  const cos = Math.cos(ang), sin = Math.sin(ang);
  let shore = WORLD.shoreRadius;
  for (let r = 60; r < 360; r += 1.5) {
    const h = terrain.sampleBase(cos * r, sin * r);
    if (h < 0.35) { shore = r; break; }
  }
  const r = Math.max(20, shore - offset);
  const x = cos * r, z = sin * r;
  return { x, z, h: terrain.sampleBase(x, z), shore, ang };
}

/**
 * Resolve every location to a concrete world position.
 * @returns {Map<string, {id,def,x,z,y,ang}>}
 */
export function resolveLocations(terrain) {
  const map = new Map();
  for (const def of LOCATIONS) {
    const [ax, az] = def.anchor;
    let p;
    if (def.kind === 'shore') p = snapShore(terrain, ax, az, def.offset ?? 14);
    else if (def.kind === 'peak') p = snapPeak(terrain, ax, az);
    else p = snapInland(terrain, ax, az);
    map.set(def.id, {
      id: def.id, def,
      x: p.x, z: p.z, y: p.h,
      ang: Math.atan2(p.z, p.x),
      shore: p.shore ?? null,
    });
  }
  return map;
}

/* ------------------------------------------------------------- networks */

/**
 * Road + trail + river network. Each entry becomes a flattened terrain path
 * plus a surface mesh built by world.js.
 */
export function buildNetwork(terrain, L) {
  const at = id => [L.get(id).x, L.get(id).z];
  /** point between two locations, pushed outward from the island centre */
  const mid = (a, b, bulge = 0) => {
    const A = at(a), B = at(b);
    const mx = (A[0] + B[0]) / 2, mz = (A[1] + B[1]) / 2;
    const len = Math.hypot(mx, mz) || 1;
    return [mx + (mx / len) * bulge, mz + (mz / len) * bulge];
  };

  const townSouth = [L.get('town').x + 4, L.get('town').z + 42];
  const townEast = [L.get('town').x + 46, L.get('town').z + 6];
  const townWest = [L.get('town').x - 52, L.get('town').z - 4];
  const townNorth = [L.get('town').x - 2, L.get('town').z - 44];

  const roads = [
    {
      id: 'ring-east', kind: 'road', width: 7,
      pts: smoothPolyline([
        townEast,
        mid('town', 'park', 10),
        at('park'),
        mid('park', 'pier', 8),
        at('pier'),
        [L.get('pier').x + 10, L.get('pier').z - 60],
        mid('pier', 'lighthouse', -34),
        at('lighthouse'),
      ]),
    },
    {
      id: 'ring-north', kind: 'road', width: 7,
      pts: smoothPolyline([
        at('lighthouse'),
        [L.get('lighthouse').x - 40, L.get('lighthouse').z - 34],
        at('campsite'),
        mid('campsite', 'forest', -18),
        at('forest'),
        mid('forest', 'lake', -8),
        at('lake'),
      ]),
    },
    {
      id: 'ring-west', kind: 'road', width: 6,
      pts: smoothPolyline([
        at('lake'),
        [L.get('lake').x - 48, L.get('lake').z + 34],
        mid('lake', 'viewpoint', -22),
        [L.get('viewpoint').x + 34, L.get('viewpoint').z + 18],
        mid('viewpoint', 'sunsetBeach', -26),
        at('sunsetBeach'),
      ]),
    },
    {
      id: 'ring-south', kind: 'road', width: 7,
      pts: smoothPolyline([
        at('sunsetBeach'),
        mid('sunsetBeach', 'beach', -20),
        at('beach'),
        [L.get('beach').x + 6, L.get('beach').z - 54],
        townSouth,
      ]),
    },
    {
      id: 'town-loop', kind: 'road', width: 6,
      pts: smoothPolyline([townSouth, townWest, townNorth, townEast, townSouth, townWest]),
    },
    // ---- trails -------------------------------------------------------
    {
      id: 'trail-viewpoint', kind: 'trail', width: 3,
      pts: smoothPolyline([
        [L.get('viewpoint').x + 46, L.get('viewpoint').z + 24],
        [L.get('viewpoint').x + 22, L.get('viewpoint').z + 12],
        at('viewpoint'),
      ], 4),
    },
    {
      id: 'trail-waterfall', kind: 'trail', width: 3,
      pts: smoothPolyline([
        [L.get('lake').x - 16, L.get('lake').z - 22],
        mid('lake', 'waterfall', 4),
        at('waterfall'),
        mid('waterfall', 'grove', 0),
        at('grove'),
      ], 4),
    },
    {
      id: 'trail-cove', kind: 'trail', width: 3,
      pts: smoothPolyline([
        at('grove'),
        [(L.get('grove').x + L.get('hiddenBeach').x) / 2 - 14, (L.get('grove').z + L.get('hiddenBeach').z) / 2],
        at('hiddenBeach'),
      ], 4),
    },
    {
      id: 'trail-picnic', kind: 'trail', width: 3.4,
      pts: smoothPolyline([at('park'), mid('park', 'picnic', 6), at('picnic')], 4),
    },
    {
      id: 'trail-cafe', kind: 'trail', width: 3.4,
      pts: smoothPolyline([townWest, [L.get('cafe').x + 12, L.get('cafe').z + 12], at('cafe')], 4),
    },
  ];

  // ---- rivers ---------------------------------------------------------
  const lakeP = { x: LAKE.x, z: LAKE.z };      // the bowl itself, not the shore marker
  const fallP = L.get('waterfall');
  const rivers = [
    {
      // Waterfall pond down into Mirror Lake. It has to finish *inside* the
      // lake, otherwise the stream visibly stops short on the bank.
      id: 'river-falls',
      pts: smoothPolyline([
        [fallP.x + 6, fallP.z + 10],
        [lerp(fallP.x, lakeP.x, 0.45) + 8, lerp(fallP.z, lakeP.z, 0.45)],
        [lerp(fallP.x, lakeP.x, 0.82), lerp(fallP.z, lakeP.z, 0.82) - 4],
        [lakeP.x - 14, lakeP.z - 18],
        [lakeP.x - 5, lakeP.z - 8],
      ], 5),
      width: 4.5, drop: 2.6,
    },
    {
      // Lake outflow, running south-west to the sea. The route deliberately
      // keeps clear of the Sunset Point massif so it does not carve a trench
      // through the headland.
      id: 'river-out',
      pts: smoothPolyline([
        [lakeP.x - 6, lakeP.z + 9],
        [lakeP.x - 20, lakeP.z + 24],
        [lakeP.x - 38, lakeP.z + 62],
        [lakeP.x - 44, lakeP.z + 118],
        [lakeP.x - 66, lakeP.z + 196],
        [lakeP.x - 84, lakeP.z + 268],
        [lakeP.x - 96, lakeP.z + 320],
      ], 7),
      width: 5.5, drop: 2.8,
    },
  ];

  return { roads, rivers };
}

/**
 * Register terrain flattening for the whole network + every location pad.
 * Must run before `terrain.buildHeightmap()`.
 */
export function registerTerrainShaping(terrain, L, network) {
  // Location pads — level ground so buildings do not float or sink.
  const pads = {
    town: [50, 22], cafe: [16, 10], park: [40, 18], picnic: [16, 10],
    campsite: [20, 14], pier: [14, 10], lighthouse: [15, 10],
    viewpoint: [17, 12], waterfall: [16, 10], grove: [16, 10],
    lake: [0, 0], forest: [0, 0], beach: [0, 0], sunsetBeach: [0, 0],
    hiddenBeach: [12, 14], cave: [0, 0],
  };
  for (const [id, [r, f]] of Object.entries(pads)) {
    if (!r) continue;
    const p = L.get(id);
    if (!p) continue;
    // The hidden cove has to sit at beach level or it reads as a grassy ledge,
    // and it must win over the trail that drops in from the clifftop.
    if (id === 'hiddenBeach') terrain.addFlatZone(p.x, p.z, r, f, 2.1, 0.95, true);
    else terrain.addFlatZone(p.x, p.z, r, f, null, 0.92);
  }

  for (const r of network.roads) {
    terrain.addPath(r.pts, {
      width: r.width * 0.75,
      feather: r.kind === 'road' ? 11 : 7,
      smooth: r.kind === 'road' ? 0.62 : 0.45,
      strength: 1,
    });
  }
  for (const r of network.rivers) {
    // The channel has to be wide enough to survive the heightfield's ~2.3 m
    // sampling, or the carve smooths away and the ribbon floats on the grass.
    terrain.addPath(r.pts, { width: r.width * 1.5, feather: 10, drop: r.drop, smooth: 0.3, strength: 1 });
  }

  // Soften the lake rim a little so the shoreline reads as a beach, not a wall.
  terrain.addFlatZone(LAKE.x, LAKE.z, LAKE.r + 10, 22, null, 0.35);

  // Basin for the waterfall pond — without it the pool is a millimetre deep
  // and the water shader renders it as foam.
  const fall = L.get('waterfall');
  if (fall) {
    const base = terrain.sampleBase(fall.x, fall.z);
    terrain.addFlatZone(fall.x, fall.z, 7.5, 5.5, base - 2.4, 1);
  }
}

export { clamp };
