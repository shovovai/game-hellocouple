/**
 * daynight.js — sky dome, sun, moon, stars, clouds and the whole lighting rig.
 *
 * A keyframe table drives every colour in the scene (sky, fog, sun, ambient) so
 * dawn / noon / golden hour / sunset / night all feel deliberately art-directed
 * rather than a linear fade.
 */

import * as THREE from 'three';
import { clamp, lerp, makeRng } from './noise.js';
import { setNightLighting } from './materials.js';
import * as TEX from './textures.js';

const C = (hex) => new THREE.Color(hex);

/** hour, skyTop, skyMid, horizon, fog, sun, sunIntensity, ambient, ambIntensity, night */
const KEYS = [
  { h: 0.0,  top: 0x05070f, mid: 0x0a1020, hor: 0x121a2e, fog: 0x111c30, sun: 0xa8bcf0, si: 0.30, amb: 0x3d4a6e, ai: 0.52, night: 1.0 },
  { h: 4.6,  top: 0x0a1024, mid: 0x16203c, hor: 0x2c3352, fog: 0x222e4a, sun: 0xb0c0e8, si: 0.34, amb: 0x47536f, ai: 0.55, night: 0.9 },
  { h: 6.0,  top: 0x2b4a76, mid: 0x6d7aa0, hor: 0xe2a07e, fog: 0xc2a08e, sun: 0xffc48a, si: 0.85, amb: 0x6a6f8c, ai: 0.52, night: 0.35 },
  { h: 7.4,  top: 0x5a92c9, mid: 0x93bedc, hor: 0xf0cdb0, fog: 0xd8e0e6, sun: 0xfff0d2, si: 1.55, amb: 0x8fa4bd, ai: 0.62, night: 0.0 },
  { h: 12.0, top: 0x3f86d6, mid: 0x7fb6e6, hor: 0xc9ddee, fog: 0xcfe0ec, sun: 0xfff6e2, si: 2.15, amb: 0x9fb6cc, ai: 0.72, night: 0.0 },
  { h: 16.0, top: 0x4a8fd0, mid: 0x8dbde2, hor: 0xdcd2c2, fog: 0xd4dbdd, sun: 0xffeccd, si: 1.85, amb: 0xa3b0bf, ai: 0.68, night: 0.0 },
  { h: 18.2, top: 0x3b6ba8, mid: 0x9b86ab, hor: 0xf4a86a, fog: 0xe0ad92, sun: 0xffb066, si: 1.35, amb: 0x8d7d92, ai: 0.60, night: 0.06 },
  { h: 19.2, top: 0x2a3f77, mid: 0x8a5f92, hor: 0xf2784f, fog: 0xd08a72, sun: 0xff7d47, si: 0.90, amb: 0x7a5f7e, ai: 0.52, night: 0.22 },
  { h: 20.2, top: 0x151d47, mid: 0x3f3566, hor: 0xa8556a, fog: 0x6e4c62, sun: 0xff8f70, si: 0.42, amb: 0x4c4668, ai: 0.42, night: 0.6 },
  { h: 21.4, top: 0x070c1f, mid: 0x121a35, hor: 0x2a2647, fog: 0x1e2942, sun: 0xa8b6e0, si: 0.32, amb: 0x3d4a6e, ai: 0.52, night: 1.0 },
  { h: 24.0, top: 0x05070f, mid: 0x0a1020, hor: 0x121a2e, fog: 0x111c30, sun: 0xa8bcf0, si: 0.30, amb: 0x3d4a6e, ai: 0.52, night: 1.0 },
];

const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const SKY_FRAG = /* glsl */`
  uniform vec3 uTop, uMid, uHorizon;
  uniform vec3 uSunDir, uSunColor, uMoonDir;
  uniform float uNight, uCloud;
  varying vec3 vDir;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), u.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;

    vec3 col = mix(uHorizon, uMid, smoothstep(-0.02, 0.24, h));
    col = mix(col, uTop, smoothstep(0.16, 0.80, h));
    col = mix(col, uHorizon * 0.72, smoothstep(0.0, -0.25, h));

    // sun disk + bloom
    float sd = max(dot(d, uSunDir), 0.0);
    col += uSunColor * pow(sd, 2200.0) * 14.0;
    col += uSunColor * pow(sd, 90.0) * 0.35;
    col += uSunColor * pow(sd, 8.0) * 0.10 * (1.0 - uNight);

    // moon
    float md = max(dot(d, uMoonDir), 0.0);
    col += vec3(0.86, 0.89, 1.0) * pow(md, 4000.0) * 9.0 * uNight;
    col += vec3(0.55, 0.60, 0.82) * pow(md, 140.0) * 0.20 * uNight;

    // drifting high cloud band
    if (h > 0.0) {
      vec2 cp = d.xz / max(h + 0.12, 0.08);
      float n = vnoise(cp * 1.1) * 0.55 + vnoise(cp * 2.7) * 0.30 + vnoise(cp * 6.1) * 0.15;
      float cloud = smoothstep(0.52 - uCloud * 0.32, 0.78, n) * uCloud;
      cloud *= smoothstep(0.0, 0.22, h);
      vec3 cloudCol = mix(uHorizon * 1.05, vec3(1.0), 0.45) * (1.0 - uNight * 0.72);
      col = mix(col, cloudCol, cloud * 0.85);
    }

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export class DayNight {
  constructor(scene, renderer, quality) {
    this.scene = scene;
    this.quality = quality;
    this.time = 8.5;          // hours
    this.speed = 1 / 90;      // 1 in-game hour per 90 real seconds
    this.paused = false;

    // ---- sky dome ----
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: C(0x3f86d6) },
        uMid: { value: C(0x7fb6e6) },
        uHorizon: { value: C(0xc9ddee) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
        uSunColor: { value: C(0xfff6e2) },
        uNight: { value: 0 },
        uCloud: { value: 0.35 },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    this.sky.userData.dynamic = true;
    scene.add(this.sky);

    // ---- stars ----
    const starCount = 1400;
    const sp = new Float32Array(starCount * 3);
    const ss = new Float32Array(starCount);
    const rng = makeRng(4242);
    for (let i = 0; i < starCount; i++) {
      const u = rng() * 2 - 1, a = rng() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      sp[i * 3] = Math.cos(a) * r;
      sp[i * 3 + 1] = Math.abs(u);
      sp[i * 3 + 2] = Math.sin(a) * r;
      ss[i] = 8 + rng() * 22;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    starGeo.setAttribute('aSize', new THREE.BufferAttribute(ss, 1));
    this.starMat = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 }, uTime: { value: 0 }, uScale: { value: 300 } },
      vertexShader: `
        attribute float aSize; varying float vTw;
        uniform float uTime; uniform float uScale;
        void main(){
          vTw = 0.65 + 0.35 * sin(uTime * 1.7 + position.x * 0.01 + position.z * 0.013);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (uScale / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform float uOpacity; varying float vTw;
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float d = 1.0 - smoothstep(0.10, 0.5, length(c));
          gl_FragColor = vec4(vec3(1.0, 0.98, 0.94), d * uOpacity * vTw);
        }`,
      transparent: true, depthWrite: false, fog: false,
    });
    this.stars = new THREE.Points(starGeo, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -999;
    this.stars.userData.dynamic = true;
    scene.add(this.stars);

    // ---- moon disc ----
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TEX.glowTexture('moon', 'rgba(245,248,255,1)', 'rgba(200,215,255,0)'),
      transparent: true, depthWrite: false, fog: false, opacity: 0,
    }));
    this.moon.scale.setScalar(60);
    this.moon.renderOrder = -998;
    this.moon.userData.dynamic = true;
    scene.add(this.moon);

    // ---- lights ----
    this.sun = new THREE.DirectionalLight(0xfff6e2, 2.0);
    this.sun.castShadow = quality.shadows;
    const sd = quality.shadowDistance;
    this.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = sd * 3.2;
    this.sun.shadow.camera.left = -sd;
    this.sun.shadow.camera.right = sd;
    this.sun.shadow.camera.top = sd;
    this.sun.shadow.camera.bottom = -sd;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.035;
    this.sun.target.position.set(0, 0, 0);
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0x9fb6cc, 0x4a5140, 0.7);
    scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0x404a60, 0.35);
    scene.add(this.ambient);

    this.fog = new THREE.FogExp2(0xcfe0ec, 0.0016);
    scene.fog = this.fog;

    // shared state other systems read
    this.state = {
      sunDir: new THREE.Vector3(0, 1, 0),
      moonDir: new THREE.Vector3(0, -1, 0),
      sunColor: C(0xffffff),
      horizonColor: C(0xc9ddee),
      fogColor: C(0xcfe0ec),
      deepWaterColor: C(0x123f57),
      fogDensity: 0.0016,
      night: 0,
      hour: 8.5,
      isNight: false,
      phase: 'day',
    };
    this.cloudiness = 0.35;
    this._tmp = new THREE.Vector3();

    // A tiny equirectangular gradient of the current sky, run through PMREM and
    // used as scene.environment. Without it every metal surface renders black
    // and glass has nothing to reflect.
    this.renderer = renderer;
    this._envW = 32; this._envH = 16;
    this._envData = new Uint8Array(this._envW * this._envH * 4);
    this._envTex = new THREE.DataTexture(this._envData, this._envW, this._envH, THREE.RGBAFormat);
    this._envTex.mapping = THREE.EquirectangularReflectionMapping;
    this._envTex.colorSpace = THREE.SRGBColorSpace;
    this._envTex.needsUpdate = true;
    this._pmrem = new THREE.PMREMGenerator(renderer);
    this._envRT = null;
    this._envDirty = true;
    this._envTimer = 0;
    this.skyRadius = 1000;
    this.setRange(1000);
    this.apply();
  }

  /**
   * Keep the sky, stars and moon comfortably inside the camera's far plane —
   * otherwise the dome is clipped away and the horizon renders black.
   */
  setRange(far) {
    this.skyRadius = far * 0.86;
    this.sky.scale.setScalar(this.skyRadius);
    this.stars.scale.setScalar(this.skyRadius * 0.94);
    this.moon.scale.setScalar(this.skyRadius * 0.075);
    this.starMat.uniforms.uScale.value = this.skyRadius * 0.09;
  }

  /** Interpolate the keyframe table at the current hour. */
  _sample(h) {
    let a = KEYS[0], b = KEYS[KEYS.length - 1];
    for (let i = 0; i < KEYS.length - 1; i++) {
      if (h >= KEYS[i].h && h <= KEYS[i + 1].h) { a = KEYS[i]; b = KEYS[i + 1]; break; }
    }
    const t = (h - a.h) / ((b.h - a.h) || 1);
    const mixC = (ka, kb) => C(ka).lerp(C(kb), t);
    return {
      top: mixC(a.top, b.top), mid: mixC(a.mid, b.mid), hor: mixC(a.hor, b.hor),
      fog: mixC(a.fog, b.fog), sun: mixC(a.sun, b.sun),
      si: lerp(a.si, b.si, t), amb: mixC(a.amb, b.amb), ai: lerp(a.ai, b.ai, t),
      night: lerp(a.night, b.night, t),
    };
  }

  setTime(h) { this.time = ((h % 24) + 24) % 24; this.apply(); }

  apply() {
    const k = this._sample(this.time);
    const s = this.state;

    // sun arc: up at 6:00, peak at 12:00, down at 18:00
    const ang = ((this.time - 6) / 12) * Math.PI;
    s.sunDir.set(Math.cos(ang) * 0.82, Math.sin(ang), Math.cos(ang) * 0.34 + 0.22).normalize();
    s.moonDir.copy(s.sunDir).multiplyScalar(-1);

    const cloudDim = 1 - this.cloudiness * 0.40;
    s.sunColor.copy(k.sun);
    s.horizonColor.copy(k.hor);
    s.fogColor.copy(k.fog);
    s.night = k.night;
    s.hour = this.time;
    s.isNight = k.night > 0.5;
    s.phase = this.time < 5.5 || this.time >= 20.6 ? 'night'
      : this.time < 7.5 ? 'dawn'
      : this.time < 16.5 ? 'day'
      : this.time < 18.6 ? 'golden'
      : 'sunset';
    s.deepWaterColor.copy(k.fog).lerp(C(0x0a2c42), 0.62);

    const fogMul = this.quality.fogDensity * (1 + this.cloudiness * 0.5);
    s.fogDensity = (k.night > 0.5 ? 0.0022 : 0.0013) * fogMul;
    this.fog.color.copy(k.fog);
    this.fog.density = s.fogDensity;
    this.scene.background = null;

    this.skyMat.uniforms.uTop.value.copy(k.top);
    this.skyMat.uniforms.uMid.value.copy(k.mid);
    this.skyMat.uniforms.uHorizon.value.copy(k.hor);
    this.skyMat.uniforms.uSunDir.value.copy(s.sunDir);
    this.skyMat.uniforms.uMoonDir.value.copy(s.moonDir);
    this.skyMat.uniforms.uSunColor.value.copy(k.sun);
    this.skyMat.uniforms.uNight.value = k.night;
    this.skyMat.uniforms.uCloud.value = this.cloudiness;

    this.sun.color.copy(k.sun);
    this.sun.intensity = k.si * cloudDim;
    this.sun.visible = k.si * cloudDim > 0.04;
    this.hemi.color.copy(k.hor);
    this.hemi.groundColor.copy(C(0x4a5140).lerp(k.fog, 0.4));
    this.hemi.intensity = (0.42 + (1 - k.night) * 0.35) * (0.85 + this.cloudiness * 0.55);
    this.ambient.color.copy(k.amb);
    this.ambient.intensity = k.ai;

    this.starMat.uniforms.uOpacity.value = clamp((k.night - 0.35) / 0.5, 0, 1) * (1 - this.cloudiness * 0.75);
    this.moon.material.opacity = clamp((k.night - 0.2) / 0.6, 0, 1) * 0.9;

    setNightLighting(k.night > 0.32, clamp(k.night * 1.4, 0, 1));
    this._envKeys = k;
    this._envDirty = true;
  }

  /** Rebuild the environment map from the current sky colours. */
  _refreshEnv() {
    const k = this._envKeys;
    if (!k || !this._pmrem) return;
    const W = this._envW, H = this._envH, d = this._envData;
    const ground = C(0x4a4f42).lerp(k.fog, 0.55);
    const c = new THREE.Color();
    for (let y = 0; y < H; y++) {
      // v = 0 at the zenith, 1 at the nadir
      const v = y / (H - 1);
      if (v < 0.34) c.copy(k.top).lerp(k.mid, v / 0.34);
      else if (v < 0.5) c.copy(k.mid).lerp(k.hor, (v - 0.34) / 0.16);
      else c.copy(k.hor).lerp(ground, Math.min(1, (v - 0.5) / 0.35));
      const r = Math.round(c.r * 255), g = Math.round(c.g * 255), b = Math.round(c.b * 255);
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
      }
    }
    this._envTex.needsUpdate = true;
    const rt = this._pmrem.fromEquirectangular(this._envTex);
    if (this._envRT) this._envRT.dispose();
    this._envRT = rt;
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 0.85;
  }

  /** Keep the sky, stars and shadow volume centred on the player. */
  update(dt, focus, camera) {
    if (!this.paused) {
      this.time = (this.time + dt * this.speed * 24 / 60) % 24;
      this.apply();
    }
    this.starMat.uniforms.uTime.value += dt;

    // PMREM is not free, so refresh the environment a few times a minute.
    this._envTimer -= dt;
    if (this._envDirty && this._envTimer <= 0) {
      this._envDirty = false;
      this._envTimer = 1.5;
      this._refreshEnv();
    }

    if (camera) {
      this.sky.position.copy(camera.position);
      this.stars.position.copy(camera.position);
      this.moon.position.copy(camera.position).addScaledVector(this.state.moonDir, this.skyRadius * 0.9);
    }
    if (focus) {
      // snap to shadow texels to stop the shadow map from crawling
      const sd = this.quality.shadowDistance;
      const texel = (sd * 2) / this.quality.shadowMapSize;
      const fx = Math.round(focus.x / texel) * texel;
      const fz = Math.round(focus.z / texel) * texel;
      this.sun.target.position.set(fx, focus.y, fz);
      this.sun.position.copy(this.sun.target.position).addScaledVector(this.state.sunDir, sd * 1.9);
      this.sun.target.updateMatrixWorld();
    }
  }

  setCloudiness(v) { this.cloudiness = clamp(v, 0, 1); this.apply(); }

  dispose() {
    this.scene.environment = null;
    this._envRT?.dispose();
    this._envTex.dispose();
    this._pmrem?.dispose();
    this.sky.geometry.dispose(); this.skyMat.dispose();
    this.stars.geometry.dispose(); this.starMat.dispose();
    this.moon.material.dispose();
  }
}
