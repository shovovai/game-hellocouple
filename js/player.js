/**
 * player.js — player movement, grounding, wading and animation state.
 *
 * Movement is camera-relative. Grounding comes from physics.groundAt(), which
 * blends the terrain heightfield with any walkable platform (pier decks, house
 * floors, bridges, lighthouse gallery), so the same code walks the beach and
 * climbs a staircase.
 */

import * as THREE from 'three';
import { WORLD } from './config.js';
import { Character } from './character.js';
import { clamp, angleLerp } from './noise.js';

const WALK = 2.7;
const RUN = 6.1;
const ACCEL = 22;
const AIR_ACCEL = 5;

export class Player {
  constructor(scene, physics, terrain, look) {
    this.physics = physics;
    this.terrain = terrain;
    this.character = new Character(look, { name: 'player' });
    this.root = this.character.root;
    scene.add(this.root);

    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.hold = 0;            // -1/+1 when holding the companion's hand
    this.radius = 0.42;
    this.grounded = true;
    this.sitting = false;
    this.sitAnchor = null;
    this.speed = 0;
    this.frozen = false;
    this.stepDistance = 0;
    this.lastGroundY = 0;
    this.inWater = false;
    this.onPlatform = false;
    this.moveScale = 1;
    /** Interiors sit far outside the island; skip world bounds while in one. */
    this.interior = false;

    this._tmp = new THREE.Vector3();
    this.onFootstep = null;
    this.onLand = null;
    this.onJump = null;
  }

  setLook(look) { this.character.setLook(look); }

  teleport(x, z, yaw = null) {
    this.pos.set(x, this.physics.groundAt(x, z, 1e9), z);
    this.vel.set(0, 0, 0);
    if (yaw !== null) this.yaw = yaw;
    this.sitting = false;
    this.sitAnchor = null;
    this.root.position.copy(this.pos);
  }

  sit(anchor) {
    this.sitting = true;
    this.sitAnchor = anchor;
    this.vel.set(0, 0, 0);
    if (anchor) {
      this.pos.set(anchor.x, anchor.y, anchor.z);
      if (anchor.yaw !== undefined) this.yaw = anchor.yaw;
    }
  }

  stand() {
    if (!this.sitting) return;
    this.sitting = false;
    if (this.sitAnchor) {
      const a = this.sitAnchor;
      const bx = a.x - Math.sin(this.yaw) * 1.1;
      const bz = a.z - Math.cos(this.yaw) * 1.1;
      this.pos.set(bx, this.physics.groundAt(bx, bz, 1e9), bz);
    }
    this.sitAnchor = null;
  }

  /** Surface under the feet — drives footstep sounds. */
  surface() {
    if (this.interior || this.onPlatform) return 'wood';
    const b = this.terrain.biome(this.pos.x, this.pos.z);
    if (b === 'water') return 'water';
    if (b === 'sand') return 'sand';
    if (b === 'rock') return 'rock';
    return 'grass';
  }

  update(dt, input, camYaw, audio) {
    const ch = this.character;

    if (this.sitting) {
      this.root.position.copy(this.pos);
      this.root.rotation.y = this.yaw;
      ch.update(dt, { speed: 0, grounded: true, sitting: true });
      this.speed = 0;
      return;
    }

    const moving = !this.frozen && input.len > 0.02;
    const sprint = input.sprint && input.len > 0.55;
    const maxSpeed = (sprint ? RUN : WALK) * (input.len) * this.moveScale;

    // camera-relative direction
    let dx = 0, dz = 0;
    if (moving) {
      const sy = Math.sin(camYaw), cy = Math.cos(camYaw);
      dx = -sy * input.y + cy * input.x;
      dz = -cy * input.y - sy * input.x;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
    }

    const accel = (this.grounded ? ACCEL : AIR_ACCEL) * dt;
    const targetVx = dx * maxSpeed;
    const targetVz = dz * maxSpeed;
    this.vel.x += clamp(targetVx - this.vel.x, -accel, accel);
    this.vel.z += clamp(targetVz - this.vel.z, -accel, accel);
    if (!moving && this.grounded) {
      const drag = 1 - Math.exp(-dt * 14);
      this.vel.x -= this.vel.x * drag;
      this.vel.z -= this.vel.z * drag;
    }

    // jump
    if (input.jump && this.grounded && !this.frozen) {
      this.vel.y = 8.4;
      this.grounded = false;
      this.onJump && this.onJump();
    }

    this.vel.y += WORLD.gravity * dt;
    if (this.vel.y < -42) this.vel.y = -42;

    // integrate + resolve
    const prevY = this.pos.y;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.physics.resolve(this.pos, this.radius, this.pos.y, this.pos.y + 1.8);

    // world boundary + deep water (not applicable inside an interior)
    let th = 0;
    if (!this.interior) {
      const d = Math.hypot(this.pos.x, this.pos.z);
      if (d > WORLD.boundary) {
        const k = WORLD.boundary / d;
        this.pos.x *= k; this.pos.z *= k;
        this.vel.x *= 0.2; this.vel.z *= 0.2;
      }
      th = this.terrain.height(this.pos.x, this.pos.z);
      this.inWater = th < 0;
      if (th < WORLD.wadeDepth) {
        // wade limit: push back toward shallower ground
        const n = this.terrain.normal(this.pos.x, this.pos.z);
        this.pos.x += n.x * 0.9;
        this.pos.z += n.z * 0.9;
        this.vel.x *= 0.3; this.vel.z *= 0.3;
      }
    } else {
      this.inWater = false;
    }

    // ground
    this.pos.y += this.vel.y * dt;
    const groundY = this.physics.groundAt(this.pos.x, this.pos.z, prevY + 0.05);
    this.onPlatform = this.interior || groundY > this.terrain.height(this.pos.x, this.pos.z) + 0.02;

    if (this.pos.y <= groundY + 0.001) {
      if (!this.grounded && this.vel.y < -5) this.onLand && this.onLand(-this.vel.y);
      this.pos.y = groundY;
      this.vel.y = 0;
      this.grounded = true;
    } else if (this.pos.y - groundY > 0.12) {
      this.grounded = false;
    }
    // step up small ledges without jumping
    if (this.grounded && groundY - prevY > 0.02 && groundY - prevY < 0.9) this.pos.y = groundY;

    this.speed = Math.hypot(this.vel.x, this.vel.z);

    // facing
    if (this.speed > 0.25) {
      const want = Math.atan2(this.vel.x, this.vel.z);
      this.yaw = angleLerp(this.yaw, want, 1 - Math.exp(-dt * 13));
    }

    // footsteps
    if (this.grounded && this.speed > 0.4) {
      this.stepDistance += this.speed * dt;
      const stride = this.speed > 3.6 ? 1.55 : 1.05;
      if (this.stepDistance > stride) {
        this.stepDistance = 0;
        this.onFootstep && this.onFootstep(this.surface());
      }
    } else if (this.grounded) {
      this.stepDistance = 0.85;
    }

    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;

    // Slightly sink into water so wading reads correctly.
    if (this.inWater && this.grounded) this.root.position.y -= clamp(-th * 0.35, 0, 0.5);

    ch.update(dt, {
      speed: this.speed,
      grounded: this.grounded,
      sitting: false,
      vy: this.vel.y,
      hold: this.hold || 0,
    });
  }

  emote(id, dur) { this.character.playEmote(id, dur); }
  get position() { return this.pos; }
}
