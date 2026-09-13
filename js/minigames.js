/**
 * minigames.js — fishing and the boat ride.
 *
 * Both are small state machines with no rendering of their own; the UI layer
 * draws them and main.js wires up the rewards.
 */

import { FISH } from './config.js';
import { clamp } from './noise.js';

/**
 * Fishing: wait for the bite, then stop a moving cursor inside the green zone.
 * Zones shrink as your catch count rises, so it stays interesting.
 */
export class FishingGame {
  constructor() {
    this.state = 'idle';       // idle | waiting | active | done
    this.cursor = 0;
    this.dir = 1;
    this.speed = 1.1;
    this.zoneStart = 0.4;
    this.zoneSize = 0.24;
    this.waitTime = 0;
    this.result = null;
    this.onStateChange = null;
  }

  start(caughtSoFar = 0) {
    this.state = 'waiting';
    this.waitTime = 1.1 + Math.random() * 2.4;
    this.zoneSize = clamp(0.26 - caughtSoFar * 0.012, 0.11, 0.26);
    this.zoneStart = 0.12 + Math.random() * (0.76 - this.zoneSize);
    this.speed = 0.95 + Math.min(0.9, caughtSoFar * 0.06) + Math.random() * 0.25;
    this.cursor = 0;
    this.dir = 1;
    this.result = null;
    this._emit();
  }

  _emit() { if (this.onStateChange) this.onStateChange(this); }

  update(dt) {
    if (this.state === 'waiting') {
      this.waitTime -= dt;
      if (this.waitTime <= 0) { this.state = 'active'; this._emit(); }
    } else if (this.state === 'active') {
      this.cursor += this.dir * this.speed * dt;
      if (this.cursor > 1) { this.cursor = 1; this.dir = -1; }
      if (this.cursor < 0) { this.cursor = 0; this.dir = 1; }
    }
  }

  /** Player pressed the button. */
  strike() {
    if (this.state === 'waiting') {
      this.state = 'done';
      this.result = { success: false, reason: 'Too early — the fish swam off.' };
      this._emit();
      return this.result;
    }
    if (this.state !== 'active') return null;
    const inZone = this.cursor >= this.zoneStart && this.cursor <= this.zoneStart + this.zoneSize;
    this.state = 'done';
    if (!inZone) {
      this.result = { success: false, reason: 'Missed! It got away.' };
    } else {
      // closer to the middle of the zone = better fish
      const centre = this.zoneStart + this.zoneSize / 2;
      const acc = 1 - Math.abs(this.cursor - centre) / (this.zoneSize / 2);
      let tier = 0;
      if (acc > 0.92 && Math.random() < 0.35) tier = 3;
      else if (acc > 0.75) tier = 2;
      else if (acc > 0.45) tier = 1;
      const fish = FISH[tier];
      this.result = { success: true, fish, accuracy: acc };
    }
    this._emit();
    return this.result;
  }

  cancel() { this.state = 'idle'; this.result = null; this._emit(); }
}

/**
 * Boat ride: a gentle drive across the water. The boat is steered like a
 * vehicle and the player is parented to the deck.
 */
export class BoatRide {
  constructor(terrain, seaLevel) {
    this.terrain = terrain;
    this.seaLevel = seaLevel;
    this.active = false;
    this.boat = null;
    this.heading = 0;
    this.speed = 0;
    this.maxSpeed = 7.5;
    this.pos = { x: 0, z: 0 };
    this.bob = 0;
  }

  enter(boat, x, z, heading) {
    this.active = true;
    this.boat = boat;
    this.pos.x = x; this.pos.z = z;
    this.heading = heading;
    this.speed = 0;
  }

  exit() {
    this.active = false;
    const b = this.boat;
    this.boat = null;
    return b;
  }

  update(dt, input) {
    if (!this.active) return null;
    const throttle = input.y;
    const steer = input.x;
    this.speed += (throttle * this.maxSpeed - this.speed) * Math.min(1, dt * 0.9);
    this.speed = clamp(this.speed, -this.maxSpeed * 0.4, this.maxSpeed);
    this.heading -= steer * dt * 0.85 * clamp(Math.abs(this.speed) / 3, 0.25, 1);

    const nx = this.pos.x + Math.sin(this.heading) * this.speed * dt;
    const nz = this.pos.z + Math.cos(this.heading) * this.speed * dt;

    // stay in navigable water
    const h = this.terrain.height(nx, nz);
    const d = Math.hypot(nx, nz);
    if (h < this.seaLevel - 0.9 && d < 470) {
      this.pos.x = nx; this.pos.z = nz;
    } else {
      this.speed *= -0.25;
    }

    this.bob += dt;
    if (this.boat) {
      this.boat.position.set(this.pos.x, this.seaLevel + 0.25 + Math.sin(this.bob * 1.5) * 0.09, this.pos.z);
      this.boat.rotation.y = this.heading;
      this.boat.rotation.z = Math.sin(this.bob * 1.2) * 0.045 - steer * 0.12;
      this.boat.rotation.x = Math.cos(this.bob * 0.9) * 0.03 - clamp(this.speed / 40, 0, 0.1);
    }
    return this.pos;
  }
}
