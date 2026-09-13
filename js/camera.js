/**
 * camera.js — third-person follow camera with collision, plus a free camera
 * used by photo mode.
 */

import * as THREE from 'three';
import { clamp, damp, lerp } from './noise.js';

export class ThirdPersonCamera {
  constructor(camera, physics, terrain) {
    this.camera = camera;
    this.physics = physics;
    this.terrain = terrain;
    this.yaw = Math.PI;
    this.pitch = 0.22;
    this.distance = 6.2;
    this.targetDistance = 6.2;
    this.minDistance = 0.95;
    this.maxDistance = 13;
    this.height = 1.55;
    this.free = false;

    this.pos = new THREE.Vector3(0, 5, 10);
    this.focus = new THREE.Vector3();
    this.smoothFocus = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._first = true;
    this.shake = 0;
  }

  rotate(dx, dy) {
    this.yaw -= dx;
    this.pitch = clamp(this.pitch + dy, -0.58, 1.22);
  }

  zoom(d) {
    this.targetDistance = clamp(this.targetDistance + d, this.minDistance, this.maxDistance);
  }

  /** Walk the ray from the focus point out to the camera, stopping at blockers. */
  _collide(focus, dir, dist) {
    const step = 0.35;
    let best = dist;
    for (let t = 0.6; t <= dist; t += step) {
      const x = focus.x + dir.x * t;
      const y = focus.y + dir.y * t;
      const z = focus.z + dir.z * t;
      const ground = this.terrain.height(x, z) + 0.45;
      if (y < ground || this.physics.isBlocked(x, y, z, 0.35)) {
        best = Math.max(this.minDistance, t - step * 1.4);
        break;
      }
    }
    return best;
  }

  update(dt, targetPos, opts = {}) {
    const head = this._tmp.set(targetPos.x, targetPos.y + this.height, targetPos.z);
    if (this._first) { this.smoothFocus.copy(head); this._first = false; }

    const lag = opts.lag ?? 12;
    this.smoothFocus.x = damp(this.smoothFocus.x, head.x, lag, dt);
    this.smoothFocus.y = damp(this.smoothFocus.y, head.y, lag * 0.7, dt);
    this.smoothFocus.z = damp(this.smoothFocus.z, head.z, lag, dt);
    this.focus.copy(this.smoothFocus);

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dir = this._desired.set(
      Math.sin(this.yaw) * cp,
      sp,
      Math.cos(this.yaw) * cp
    ).normalize();

    const wanted = this._collide(this.focus, dir, this.targetDistance);
    // snap in fast when blocked, ease out when clear
    this.distance = wanted < this.distance
      ? lerp(this.distance, wanted, 1 - Math.exp(-dt * 26))
      : damp(this.distance, wanted, 5, dt);

    this.pos.copy(this.focus).addScaledVector(dir, this.distance);
    const minY = this.terrain.height(this.pos.x, this.pos.z) + 0.6;
    if (this.pos.y < minY) this.pos.y = minY;

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 1.6);
      const s = this.shake * 0.12;
      this.pos.x += (Math.random() - 0.5) * s;
      this.pos.y += (Math.random() - 0.5) * s;
    }

    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.focus);
  }

  /** Instantly place the camera behind the player (after teleports). */
  snap(targetPos, yaw = null) {
    if (yaw !== null) this.yaw = yaw;
    this._first = true;
    this.smoothFocus.set(targetPos.x, targetPos.y + this.height, targetPos.z);
    this.distance = this.targetDistance;
  }
}

/** Free-flying camera used by photo mode. */
export class FreeCamera {
  constructor(camera) {
    this.camera = camera;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.speed = 9;
    this.fov = 55;
  }

  enter(from, yaw, pitch) {
    this.pos.copy(from);
    this.yaw = yaw;
    this.pitch = pitch;
  }

  update(dt, input) {
    const { move, look, up, down, fast, zoom } = input;
    this.yaw -= look.x;
    this.pitch = clamp(this.pitch + look.y, -1.5, 1.5);
    if (zoom) this.fov = clamp(this.fov + zoom * 2, 22, 92);

    const sp = this.speed * (fast ? 3 : 1) * dt;
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), spp = Math.sin(this.pitch);
    // forward vector matches the third-person convention (yaw 0 looks -Z)
    const fx = -sy * cp, fy = -spp, fz = -cy * cp;
    this.pos.x += (fx * move.y + cy * move.x) * sp;
    this.pos.y += (fy * move.y) * sp + (up ? sp : 0) - (down ? sp : 0);
    this.pos.z += (fz * move.y - sy * move.x) * sp;

    this.camera.position.copy(this.pos);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(-this.pitch);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
