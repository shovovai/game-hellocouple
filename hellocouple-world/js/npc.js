/**
 * npc.js — island residents.
 *
 * NPCs reuse the player's character rig. Roles are deliberately simple:
 * `stand` holds a spot, `sit` stays seated, `walk` wanders a radius, `fish`
 * loops the fishing pose. Each one registers an interactable so the dialogue
 * system can pick it up.
 */

import * as THREE from 'three';
import { Character } from './character.js';
import { angleLerp, makeRng } from './noise.js';

export class NPC {
  constructor(scene, physics, terrain, def) {
    this.def = def;
    this.physics = physics;
    this.terrain = terrain;
    this.name = def.name;
    this.role = def.role || 'stand';
    this.character = new Character(def.look || {}, { name: 'npc-' + def.id });
    this.root = this.character.root;
    scene.add(this.root);

    const y = def.y !== undefined ? def.y : physics.groundAt(def.x, def.z, 1e9);
    this.home = new THREE.Vector3(def.x, y, def.z);
    this.pos = this.home.clone();
    this.vel = new THREE.Vector3();
    this.yaw = def.yaw || 0;
    this.speed = 0;
    this.rng = makeRng((def.id || 'npc').length * 977 + def.x);
    this.wander = def.wander || 0;
    this.target = this.home.clone();
    this.waitTimer = this.rng() * 4;
    this.talking = false;
    this.visible = true;
    this.root.position.copy(this.pos);

    if (this.role === 'sit') this.character.playEmote('sit', 1e9);
    if (def.emote) this.character.playEmote(def.emote, 1e9);
  }

  _pickTarget() {
    const a = this.rng() * Math.PI * 2;
    const r = this.rng() * this.wander;
    const x = this.home.x + Math.cos(a) * r;
    const z = this.home.z + Math.sin(a) * r;
    const h = this.terrain.height(x, z);
    if (h < 1.5) return;
    this.target.set(x, h, z);
  }

  update(dt, playerPos) {
    const far = this.pos.distanceToSquared(playerPos) > 90000;    // 300 m
    if (far) { if (this.visible) { this.root.visible = false; this.visible = false; } return; }
    if (!this.visible) { this.root.visible = true; this.visible = true; }

    const near = this.pos.distanceToSquared(playerPos) < 36;
    if (this.role === 'walk' && !this.talking && !near) {
      this.waitTimer -= dt;
      if (this.waitTimer <= 0) { this._pickTarget(); this.waitTimer = 4 + this.rng() * 7; }
      const dx = this.target.x - this.pos.x, dz = this.target.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.8) {
        const s = 1.35;
        this.vel.x = (dx / d) * s;
        this.vel.z = (dz / d) * s;
        this.pos.x += this.vel.x * dt;
        this.pos.z += this.vel.z * dt;
        this.physics.resolve(this.pos, 0.4, this.pos.y, this.pos.y + 1.8);
        this.pos.y = this.physics.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.6);
        this.yaw = angleLerp(this.yaw, Math.atan2(this.vel.x, this.vel.z), 1 - Math.exp(-dt * 8));
        this.speed = s;
      } else {
        this.speed = 0;
      }
    } else {
      this.speed = 0;
    }

    // turn to face the player when close
    if (near) {
      const dx = playerPos.x - this.pos.x, dz = playerPos.z - this.pos.z;
      if (Math.hypot(dx, dz) > 0.3) {
        this.yaw = angleLerp(this.yaw, Math.atan2(dx, dz), 1 - Math.exp(-dt * 5));
      }
    }

    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    this.character.update(dt, {
      speed: this.speed,
      grounded: true,
      sitting: this.role === 'sit',
    });
  }
}

export class NPCSystem {
  constructor(scene, physics, terrain) {
    this.scene = scene;
    this.physics = physics;
    this.terrain = terrain;
    this.npcs = [];
  }

  build(defs, world) {
    for (const def of defs) {
      const npc = new NPC(this.scene, this.physics, this.terrain, def);
      this.npcs.push(npc);
      world.interact({
        x: def.x, y: npc.pos.y, z: def.z, r: 3.0, kind: 'talk',
        label: `Talk to ${def.name}`, data: { npc },
      });
    }
    return this.npcs;
  }

  update(dt, playerPos) {
    for (const n of this.npcs) n.update(dt, playerPos);
  }
}

/**
 * Dialogue runner. Lines are `[text, [choice, ...]]`; picking a choice advances
 * to the next line, and the last line ends the conversation.
 */
export class DialogueSystem {
  constructor(ui) {
    this.ui = ui;
    this.active = null;
    this.index = 0;
    this.onEnd = null;
  }

  start(npc) {
    this.active = npc;
    this.index = 0;
    npc.talking = true;
    this._show();
  }

  _show() {
    const npc = this.active;
    if (!npc) return;
    const lines = npc.def.lines || [['...', ['Bye']]];
    const line = lines[Math.min(this.index, lines.length - 1)];
    this.ui.showDialogue(npc.name, line[0], line[1] || ['Bye'], (choiceIndex) => {
      this.index++;
      if (this.index >= lines.length) this.end();
      else this._show();
    });
  }

  end() {
    if (this.active) this.active.talking = false;
    this.active = null;
    this.ui.hideDialogue();
    if (this.onEnd) this.onEnd();
  }

  get isActive() { return !!this.active; }
}
