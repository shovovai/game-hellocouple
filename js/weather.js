/**
 * weather.js — sunny / cloudy / rain with smooth transitions.
 *
 * Rain is a single Points cloud that follows the player and wraps around,
 * so a heavy downpour still costs one draw call.
 */

import * as THREE from 'three';
import { clamp, lerp, makeRng } from './noise.js';

export const WEATHERS = ['sunny', 'cloudy', 'rain'];

const TARGETS = {
  sunny: { cloud: 0.28, rain: 0, wind: 0.55 },
  cloudy: { cloud: 0.80, rain: 0, wind: 0.85 },
  rain: { cloud: 1.00, rain: 1, wind: 1.25 },
};

export class Weather {
  constructor(scene, quality, dayNight) {
    this.scene = scene;
    this.quality = quality;
    this.dayNight = dayNight;
    this.current = 'sunny';
    this.next = 'sunny';
    this.blend = 1;
    this.timer = 90;
    this.auto = true;
    this.rng = makeRng(9001);
    this.values = { cloud: 0.28, rain: 0, wind: 0.55 };

    const count = Math.floor(4200 * quality.particles);
    this.count = count;
    this.activeCount = count;      // scaled at runtime by the perf governor
    const pos = new Float32Array(count * 3);
    const spd = new Float32Array(count);
    this.area = 34;
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (this.rng() - 0.5) * this.area * 2;
      pos[i * 3 + 1] = this.rng() * 26;
      pos[i * 3 + 2] = (this.rng() - 0.5) * this.area * 2;
      spd[i] = 18 + this.rng() * 16;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(spd, 1));
    this.rainMat = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 }, uColor: { value: new THREE.Color(0xbcd6e8) } },
      vertexShader: `
        attribute float aSpeed;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(120.0 / -mv.z, 1.0, 6.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform float uOpacity; uniform vec3 uColor;
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float a = (1.0 - smoothstep(0.0, 0.5, abs(c.x) * 3.2)) * (1.0 - smoothstep(0.2, 0.5, abs(c.y)));
          gl_FragColor = vec4(uColor, a * uOpacity);
        }`,
      transparent: true, depthWrite: false, fog: false,
    });
    this.rain = new THREE.Points(geo, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.rain.userData.dynamic = true;
    scene.add(this.rain);

    this.positions = pos;
    this.speeds = spd;
  }

  set(weather, instant = false) {
    if (!WEATHERS.includes(weather)) return;
    this.next = weather;
    this.timer = 180 + this.rng() * 260;
    if (instant) {
      this.current = weather;
      this.blend = 1;
      Object.assign(this.values, TARGETS[weather]);
      this.dayNight.setCloudiness(this.values.cloud);
    } else {
      this.blend = 0;
    }
  }

  update(dt, focus) {
    if (this.auto) {
      this.timer -= dt;
      if (this.timer <= 0) {
        const r = this.rng();
        this.set(r < 0.58 ? 'sunny' : r < 0.84 ? 'cloudy' : 'rain');
      }
    }

    // ease toward the target weather
    const t = TARGETS[this.next];
    const k = 1 - Math.exp(-dt * 0.35);
    this.values.cloud = lerp(this.values.cloud, t.cloud, k);
    this.values.rain = lerp(this.values.rain, t.rain, k);
    this.values.wind = lerp(this.values.wind, t.wind, k);
    if (Math.abs(this.values.cloud - t.cloud) < 0.02) this.current = this.next;
    this.dayNight.cloudiness = this.values.cloud;

    const intensity = this.values.rain;
    this.rain.visible = intensity > 0.02;
    this.rainMat.uniforms.uOpacity.value = intensity * 0.55;

    if (this.rain.visible && focus) {
      const p = this.positions;
      const a = this.area;
      this.rain.position.set(focus.x, focus.y, focus.z);
      for (let i = 0; i < this.activeCount; i++) {
        p[i * 3 + 1] -= this.speeds[i] * dt;
        p[i * 3] -= dt * 3.5 * this.values.wind;
        if (p[i * 3 + 1] < -4) {
          p[i * 3 + 1] = 24 + Math.random() * 6;
          p[i * 3] = (Math.random() - 0.5) * a * 2;
          p[i * 3 + 2] = (Math.random() - 0.5) * a * 2;
        }
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
  }

  get label() {
    const v = this.values.rain > 0.45 ? 'rain' : this.values.cloud > 0.6 ? 'cloudy' : 'sunny';
    return v;
  }

  get icon() {
    const l = this.label;
    return l === 'rain' ? '🌧' : l === 'cloudy' ? '☁' : '☀';
  }

  /** Scale how many raindrops are simulated, without rebuilding the buffer. */
  setScale(frac) {
    this.activeCount = Math.max(0, Math.round(this.count * Math.min(1, Math.max(0, frac))));
  }

  dispose() {
    this.rain.geometry.dispose();
    this.rainMat.dispose();
    this.scene.remove(this.rain);
  }
}
