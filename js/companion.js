/**
 * companion.js — the second character.
 *
 * Simple but well-behaved follow AI: keeps a personal-space bubble, steers
 * around obstacles by probing a few candidate headings, turns to look at you
 * when idle, mirrors your emotes occasionally, and re-appears behind you if it
 * ever gets stranded (after a fast travel, for instance).
 */

import * as THREE from 'three';
import { Character } from './character.js';
import { clamp, angleLerp } from './noise.js';

const FOLLOW_MIN = 2.2;
const FOLLOW_MAX = 3.6;
const WALK = 2.7;
const RUN = 6.1;

export class Companion {
  constructor(scene, physics, terrain, look) {
    this.physics = physics;
    this.terrain = terrain;
    this.character = new Character(look, { name: 'companion' });
    this.root = this.character.root;
    scene.add(this.root);

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.radius = 0.42;
    this.speed = 0;
    this.sitting = false;
    this.enabled = true;
    this.interior = false;
    this.name = 'Companion';
    this._probe = new THREE.Vector3();
    this._idleTimer = 0;
    this._emoteTimer = 8;
  }

  setLook(look) { this.character.setLook(look); }

  teleportNear(target, yaw) {
    const a = yaw + Math.PI + 0.6;
    const x = target.x + Math.sin(a) * 2.4;
    const z = target.z + Math.cos(a) * 2.4;
    this.pos.set(x, this.physics.groundAt(x, z, 1e9), z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.root.position.copy(this.pos);
    this.sitting = false;
  }

  sitAt(x, y, z, yaw) {
    this.sitting = true;
    this.pos.set(x, y, z);
    this.yaw = yaw;
    this.vel.set(0, 0, 0);
  }

  stand() { this.sitting = false; }

  /** Is a straight step in this direction clear? */
  _clear(from, dirX, dirZ, dist) {
    const p = this._probe;
    for (let t = 0.8; t <= dist; t += 0.8) {
      p.set(from.x + dirX * t, from.y + 0.9, from.z + dirZ * t);
      if (this.physics.isBlocked(p.x, p.y, p.z, this.radius + 0.15)) return false;
      if (this.interior) continue;                // interiors have no terrain
      const h = this.terrain.height(p.x, p.z);
      if (h < -0.9) return false;                 // don't wade out to sea
      if (h - from.y > 1.6) return false;         // don't climb cliffs
    }
    return true;
  }

  update(dt, target, targetSpeed) {
    if (!this.enabled) return;
    const ch = this.character;

    if (this.sitting) {
      this.root.position.copy(this.pos);
      this.root.rotation.y = this.yaw;
      ch.update(dt, { speed: 0, grounded: true, sitting: true });
      return;
    }

    const dx = target.x - this.pos.x;
    const dz = target.z - this.pos.z;
    const dist = Math.hypot(dx, dz);

    // stranded? pop back behind the player
    if (dist > 42) { this.teleportNear(target, Math.atan2(dx, dz)); return; }

    let moveX = 0, moveZ = 0, want = 0;
    if (dist > FOLLOW_MIN) {
      const nx = dx / dist, nz = dz / dist;
      // steer around obstacles: try straight, then fan out
      let bx = nx, bz = nz, found = false;
      for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.3, -2.3]) {
        const a = Math.atan2(nx, nz) + off;
        const tx = Math.sin(a), tz = Math.cos(a);
        if (this._clear(this.pos, tx, tz, Math.min(4.5, dist))) { bx = tx; bz = tz; found = true; break; }
      }
      if (!found) { bx = nx; bz = nz; }
      const urgency = clamp((dist - FOLLOW_MIN) / 5, 0, 1);
      const base = targetSpeed > 3.8 ? RUN : WALK;
      want = base * (0.55 + urgency * 0.6);
      if (dist > 14) want = RUN * 1.06;
      moveX = bx * want;
      moveZ = bz * want;
    }

    const accel = 16 * dt;
    this.vel.x += clamp(moveX - this.vel.x, -accel, accel);
    this.vel.z += clamp(moveZ - this.vel.z, -accel, accel);
    if (want === 0) {
      const drag = 1 - Math.exp(-dt * 12);
      this.vel.x -= this.vel.x * drag;
      this.vel.z -= this.vel.z * drag;
    }

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    // keep out of the player's personal space
    const nd = Math.hypot(target.x - this.pos.x, target.z - this.pos.z);
    if (nd < 1.15 && nd > 0.001) {
      const push = (1.15 - nd);
      this.pos.x -= ((target.x - this.pos.x) / nd) * push;
      this.pos.z -= ((target.z - this.pos.z) / nd) * push;
    }

    this.physics.resolve(this.pos, this.radius, this.pos.y, this.pos.y + 1.8);
    const gy = this.physics.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.6);
    this.pos.y += (gy - this.pos.y) * Math.min(1, dt * 14);

    this.speed = Math.hypot(this.vel.x, this.vel.z);

    if (this.speed > 0.3) {
      this.yaw = angleLerp(this.yaw, Math.atan2(this.vel.x, this.vel.z), 1 - Math.exp(-dt * 10));
      this._idleTimer = 0;
    } else {
      // look at the player while waiting
      this._idleTimer += dt;
      if (dist > 0.4) {
        this.yaw = angleLerp(this.yaw, Math.atan2(dx, dz), 1 - Math.exp(-dt * 4));
      }
      this._emoteTimer -= dt;
      if (this._emoteTimer <= 0 && this._idleTimer > 2.5) {
        this._emoteTimer = 16 + Math.random() * 22;
        ch.playEmote(Math.random() > 0.5 ? 'wave' : 'point', 2.2);
      }
    }

    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    ch.update(dt, { speed: this.speed, grounded: true, sitting: false });
  }

  emote(id, dur) { this.character.playEmote(id, dur); }
}
