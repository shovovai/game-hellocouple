/**
 * water.js — ocean, lake, rivers and the waterfall.
 *
 * The ocean shader samples a baked height texture of the island so it knows how
 * deep it is at every point. That single trick gives shallow turquoise water,
 * a foam line that follows the real coastline, and depth-based transparency,
 * without any render-to-texture work.
 */

import * as THREE from 'three';
import { WORLD } from './config.js';
import * as TEX from './textures.js';
import { materials } from './materials.js';
import { clamp } from './noise.js';

/**
 * Bake terrain heights into a half-float texture the water shaders can sample.
 * 8-bit was not precise enough: the foam band is barely a metre deep, and
 * quantising it to half-metre steps wiped the surf line out entirely.
 */
export function bakeHeightTexture(terrain) {
  const n = terrain.res + 1;
  const data = new Uint16Array(n * n);
  for (let i = 0; i < n * n; i++) data[i] = THREE.DataUtils.toHalfFloat(terrain.heights[i]);
  const tex = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.HalfFloatType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

const WATER_VERT = /* glsl */`
  uniform float uTime;
  uniform float uChop;
  uniform float uScale;
  attribute float aEdge;
  varying vec3 vWorld;
  varying vec2 vUvW;
  varying float vWave;
  varying float vEdge;

  void main() {
    vEdge = aEdge;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vUvW = wp.xz;

    float t = uTime;
    float w =
        sin(wp.x * 0.035 + t * 0.9) * 0.55
      + sin(wp.z * 0.047 - t * 1.1) * 0.42
      + sin((wp.x + wp.z) * 0.021 + t * 0.6) * 0.60
      + sin((wp.x - wp.z) * 0.086 + t * 1.9) * 0.16;
    w *= uChop;
    vWave = w;
    wp.y += w;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const WATER_FRAG = /* glsl */`
  uniform float uTime;
  uniform vec3  uDeep;
  uniform vec3  uShallow;
  uniform vec3  uSunDir;
  uniform vec3  uSunColor;
  uniform vec3  uSkyColor;
  uniform vec3  uFogColor;
  uniform float uFogDensity;
  uniform float uLevel;
  uniform float uHalf;
  uniform float uFoam;
  uniform float uOpacity;
  uniform float uSpec;
  uniform sampler2D uHeight;
  uniform sampler2D uNormal;
  uniform int  uUseHeight;
  varying vec3 vWorld;
  varying vec2 vUvW;
  varying float vWave;
  varying float vEdge;

  float groundAt(vec2 p) {
    vec2 uv = (p / (2.0 * uHalf)) + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return -40.0;
    return texture2D(uHeight, uv).r;
  }

  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorld);

    // two scrolling normal samples
    vec2 uv1 = vUvW * 0.035 + vec2(uTime * 0.012, uTime * 0.009);
    vec2 uv2 = vUvW * 0.011 - vec2(uTime * 0.007, uTime * 0.016);
    vec3 n1 = texture2D(uNormal, uv1).xyz * 2.0 - 1.0;
    vec3 n2 = texture2D(uNormal, uv2).xyz * 2.0 - 1.0;
    vec3 nrm = normalize(vec3(n1.x + n2.x, 3.0, n1.y + n2.y));

    float depth = 40.0;
    if (uUseHeight == 1) depth = max(uLevel - groundAt(vWorld.xz), -1.0);
    // River mode: there is no single water level to measure against, so depth
    // comes from the ribbon's own cross-section instead.
    if (uUseHeight == 2) depth = mix(1.6, 0.0, vEdge);

    float shallow = 1.0 - clamp(depth / 8.5, 0.0, 1.0);
    vec3 base = mix(uDeep, uShallow, pow(shallow, 1.35));

    // fresnel sky reflection
    float fres = pow(1.0 - clamp(dot(viewDir, nrm), 0.0, 1.0), 4.0);
    vec3 col = mix(base, uSkyColor * 0.92, clamp(fres * 0.78, 0.0, 0.62));

    // sun glitter
    vec3 h = normalize(uSunDir + viewDir);
    float spec = pow(max(dot(nrm, h), 0.0), 120.0) * uSpec;
    col += uSunColor * spec;
    col += uSunColor * pow(max(dot(nrm, h), 0.0), 12.0) * 0.05 * uSpec;

    // shore foam
    float foamBand = smoothstep(2.1, 0.0, depth) * smoothstep(-0.25, 0.15, depth);
    float ripple = sin(depth * 5.5 - uTime * 2.2 + vUvW.x * 0.22 + vUvW.y * 0.19) * 0.5 + 0.5;
    float lace = sin(vUvW.x * 1.7 + vUvW.y * 1.3 + uTime * 1.1) * 0.5 + 0.5;
    float foam = clamp(foamBand * (0.35 + ripple * 0.75 * (0.5 + lace * 0.7)), 0.0, 1.0) * uFoam;
    col = mix(col, vec3(0.95, 0.98, 1.0), foam * 0.9);

    float alpha = clamp(smoothstep(0.0, 1.1, depth) * uOpacity + foam * 0.7, 0.0, 1.0);
    if (uUseHeight == 2) alpha *= 1.0 - vEdge * vEdge;

    // exponential-squared fog, matched to the scene fog
    float d = length(cameraPosition - vWorld);
    float f = 1.0 - exp(-pow(d * uFogDensity, 2.0));
    col = mix(col, uFogColor, clamp(f, 0.0, 1.0));

    gl_FragColor = vec4(col, alpha);
    #include <colorspace_fragment>
  }
`;

/** Every water mesh needs the aEdge attribute the shared shader declares. */
function withEdge(geo, value = 0) {
  const n = geo.attributes.position.count;
  geo.setAttribute('aEdge', new THREE.BufferAttribute(new Float32Array(n).fill(value), 1));
  return geo;
}

function makeWaterMaterial(opts) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uChop: { value: opts.chop ?? 0.55 },
      uScale: { value: 1 },
      uDeep: { value: new THREE.Color(opts.deep ?? 0x0d3b52) },
      uShallow: { value: new THREE.Color(opts.shallow ?? 0x2fa8b0) },
      uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.3) },
      uSunColor: { value: new THREE.Color(0xffe3b0) },
      uSkyColor: { value: new THREE.Color(0x9ec9e8) },
      uFogColor: { value: new THREE.Color(0xbcd3e4) },
      uFogDensity: { value: 0.0016 },
      uLevel: { value: opts.level ?? 0 },
      uHalf: { value: opts.half ?? 340 },
      uFoam: { value: opts.foam ?? 1 },
      uOpacity: { value: opts.opacity ?? 0.92 },
      uSpec: { value: opts.spec ?? 1 },
      uHeight: { value: opts.heightTex ?? null },
      uNormal: { value: TEX.waterNormalTexture() },
      uUseHeight: { value: opts.mode ?? (opts.heightTex ? 1 : 0) },
    },
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    transparent: true,
    depthWrite: true,
    side: THREE.FrontSide,
  });
}

export class Water {
  constructor(scene, terrain, quality) {
    this.scene = scene;
    this.terrain = terrain;
    this.quality = quality;
    this.materials = [];
    this.group = new THREE.Group();
    this.group.name = 'water';
    scene.add(this.group);

    this.heightTex = bakeHeightTexture(terrain);
    const q = quality.waterQuality;

    /* ---- ocean --------------------------------------------------- */
    const seg = q >= 2 ? 220 : q >= 1 ? 150 : 90;
    const oceanGeo = new THREE.PlaneGeometry(1700, 1700, seg, seg);
    oceanGeo.rotateX(-Math.PI / 2);
    withEdge(oceanGeo);
    this.oceanMat = makeWaterMaterial({
      level: WORLD.seaLevel, half: terrain.half, heightTex: this.heightTex,
      chop: q >= 1 ? 0.5 : 0.3, deep: 0x0a3247, shallow: 0x3fbfbe, foam: 1, opacity: 0.93, spec: 1,
    });
    this.ocean = new THREE.Mesh(oceanGeo, this.oceanMat);
    this.ocean.position.y = WORLD.seaLevel;
    this.ocean.renderOrder = 2;
    this.ocean.userData.dynamic = true;
    this.group.add(this.ocean);
    this.materials.push(this.oceanMat);

    // far horizon water (flat, cheap)
    const farGeo = new THREE.RingGeometry(840, 7000, 64, 1);
    farGeo.rotateX(-Math.PI / 2);
    this.farMat = new THREE.MeshBasicMaterial({ color: 0x123f57, fog: true });
    this.far = new THREE.Mesh(farGeo, this.farMat);
    this.far.position.y = WORLD.seaLevel - 0.05;
    this.far.userData.dynamic = true;
    this.group.add(this.far);

    /* ---- lake ---------------------------------------------------- */
    const lakeGeo = new THREE.CircleGeometry(66, 56);
    lakeGeo.rotateX(-Math.PI / 2);
    withEdge(lakeGeo);
    this.lakeMat = makeWaterMaterial({
      level: WORLD.lakeLevel, half: terrain.half, heightTex: this.heightTex,
      chop: 0.06, deep: 0x1b4a4a, shallow: 0x63c2b4, foam: 0.35, opacity: 0.85, spec: 0.7,
    });
    this.materials.push(this.lakeMat);
    this.lake = null; // positioned by world.js via `placeLake`

    this.rivers = [];
    this.falls = [];
  }

  placeLake(x, z) {
    this.lake = new THREE.Mesh(withEdge(new THREE.CircleGeometry(66, 56).rotateX(-Math.PI / 2)), this.lakeMat);
    this.lake.position.set(x, WORLD.lakeLevel, z);
    this.lake.renderOrder = 2;
    this.lake.userData.dynamic = true;
    this.group.add(this.lake);
    return this.lake;
  }

  /** Small pond (waterfall basin, fountain pool…). */
  addPond(x, y, z, radius) {
    const mat = makeWaterMaterial({
      level: y, half: this.terrain.half, heightTex: this.heightTex,
      chop: 0.04, deep: 0x1d5560, shallow: 0x6fd0c8, foam: 0.9, opacity: 0.8, spec: 0.8,
    });
    this.materials.push(mat);
    const mesh = new THREE.Mesh(withEdge(new THREE.CircleGeometry(radius, 30).rotateX(-Math.PI / 2)), mat);
    mesh.position.set(x, y, z);
    mesh.renderOrder = 2;
    mesh.userData.dynamic = true;
    this.group.add(mesh);
    return mesh;
  }

  /**
   * River ribbon following a polyline. Each point sits slightly above the
   * carved channel so the water reads as flowing downhill.
   */
  /**
   * River ribbon. Three vertices per cross-section (left bank, centre, right
   * bank) so the water can fade out at the banks — with only two it rendered
   * as a flat sheet of glass lying on the grass.
   */
  addRiver(points, width = 5, lift = 0.08) {
    // Resample to roughly the terrain grid spacing. With 6 m segments the
    // ribbon cuts straight across every bump and ends up hovering.
    const dense = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2));
      for (let k = 0; k < steps; k++) {
        const t = k / steps;
        dense.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    dense.push(points[points.length - 1]);
    points = dense;

    const pos = [], uvs = [], idx = [], edge = [];
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const [x, z] = points[i];
      const [px, pz] = points[Math.max(0, i - 1)];
      const [nx, nz] = points[Math.min(n - 1, i + 1)];
      let dx = nx - px, dz = nz - pz;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      const ox = -dz * width * 0.5, oz = dx * width * 0.5;
      const yL = this.terrain.height(x + ox, z + oz);
      const yC = this.terrain.height(x, z);
      const yR = this.terrain.height(x - ox, z - oz);
      // The surface is flat across the channel, pinned to the lowest bank.
      const y = Math.min(yL, yC, yR) + lift;
      pos.push(x + ox, y, z + oz, x, y, z, x - ox, y, z - oz);
      uvs.push(0, i * 0.4, 0.5, i * 0.4, 1, i * 0.4);
      edge.push(1, 0, 1);
      if (i < n - 1) {
        const a = i * 3;
        idx.push(a, a + 1, a + 3, a + 1, a + 4, a + 3,
                 a + 1, a + 2, a + 4, a + 2, a + 5, a + 4);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    const mat = makeWaterMaterial({
      level: 0, half: this.terrain.half, heightTex: null, mode: 2,
      chop: 0.0, deep: 0x2d6f74, shallow: 0x86d8cc, foam: 0.5, opacity: 0.75, spec: 0.5,
    });
    mat.side = THREE.DoubleSide;
    mat.depthWrite = false;
    this.materials.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 3;
    mesh.userData.dynamic = true;
    this.group.add(mesh);
    this.rivers.push(mesh);
    return mesh;
  }

  /** Vertical falling sheet with scrolling texture + mist sprite. */
  addWaterfall(x, y, z, width, height, ry = 0) {
    const tex = TEX.waterfallTexture();
    const t2 = tex.clone();
    t2.wrapS = t2.wrapT = THREE.RepeatWrapping;
    t2.repeat.set(1, Math.max(1, height / 6));
    t2.needsUpdate = true;
    const mat = new THREE.MeshStandardMaterial({
      map: t2, transparent: true, opacity: 0.85, roughness: 0.15, metalness: 0.05,
      emissive: 0x9fd8ea, emissiveIntensity: 0.12, side: THREE.DoubleSide, depthWrite: false,
    });
    const geo = new THREE.PlaneGeometry(width, height, 1, 6);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y + height / 2, z);
    mesh.rotation.y = ry;
    mesh.userData.dynamic = true;
    mesh.renderOrder = 3;
    this.group.add(mesh);

    // curved lip so the water appears to pour over the edge
    const lip = new THREE.Mesh(
      new THREE.CylinderGeometry(width * 0.5, width * 0.5, 1.2, 12, 1, true, 0, Math.PI),
      mat);
    lip.scale.set(1, 1, 0.35);
    lip.position.set(x, y + height, z);
    lip.rotation.y = ry + Math.PI / 2;
    lip.userData.dynamic = true;
    this.group.add(lip);

    this.falls.push({ mesh, mat: t2, material: mat, lip });
    return mesh;
  }

  /** Called every frame with the current sky state. */
  update(dt, sky) {
    for (const m of this.materials) {
      m.uniforms.uTime.value += dt;
      if (sky) {
        m.uniforms.uSunDir.value.copy(sky.sunDir);
        m.uniforms.uSunColor.value.copy(sky.sunColor);
        m.uniforms.uSkyColor.value.copy(sky.horizonColor);
        m.uniforms.uFogColor.value.copy(sky.fogColor);
        m.uniforms.uFogDensity.value = sky.fogDensity;
      }
    }
    if (sky) this.farMat.color.copy(sky.deepWaterColor);
    for (const f of this.falls) f.mat.offset.y -= dt * 1.15;
  }

  dispose() {
    this.group.traverse(o => { if (o.isMesh && !o.geometry.userData.shared) o.geometry.dispose(); });
    this.materials.forEach(m => m.dispose());
    for (const f of this.falls) { f.material?.dispose(); f.mat?.dispose(); }
    this.falls.length = 0;
    this.heightTex.dispose();
    this.scene.remove(this.group);
  }
}
