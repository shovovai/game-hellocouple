/**
 * net.js — multiplayer seam.
 *
 * Version 1 is single-player: `NullNetwork` is installed and nothing is sent
 * anywhere. This file exists so that adding real multiplayer later is a matter
 * of writing one adapter, not restructuring the game:
 *
 *   1. Implement the `NetworkAdapter` interface below against your transport
 *      (WebSocket, WebRTC data channel, or a hosted realtime service).
 *   2. Hand it to `RemotePlayers` in main.js instead of `NullNetwork`.
 *   3. The game already sends a compact local snapshot every tick and spawns a
 *      `Character` for every remote id it hears about.
 *
 * The world itself is deterministic (one seed, no server state), so two clients
 * that agree on the seed already share an identical island — only characters,
 * pickups and activity state would need replicating.
 */

import { Character } from './character.js';
import { angleLerp } from './noise.js';

/**
 * @typedef {Object} NetworkAdapter
 * @property {(room: string, profile: object) => Promise<void>} connect
 * @property {() => void} disconnect
 * @property {(snapshot: object) => void} send      local player state, ~10 Hz
 * @property {(cb: (id: string, snapshot: object) => void) => void} onPeer
 * @property {(cb: (id: string) => void) => void} onPeerLeft
 * @property {boolean} connected
 */

export const NullNetwork = {
  connected: false,
  async connect() { /* single player: nothing to do */ },
  disconnect() {},
  send() {},
  onPeer() {},
  onPeerLeft() {},
};

/** Spawns and interpolates characters for remote players. */
export class RemotePlayers {
  constructor(scene, adapter = NullNetwork) {
    this.scene = scene;
    this.adapter = adapter;
    this.peers = new Map();
    this.sendTimer = 0;
    this.sendRate = 1 / 10;

    adapter.onPeer?.((id, snap) => this._apply(id, snap));
    adapter.onPeerLeft?.((id) => this.remove(id));
  }

  get active() { return this.adapter.connected; }

  _apply(id, snap) {
    let p = this.peers.get(id);
    if (!p) {
      const ch = new Character(snap.look || {}, { name: 'peer-' + id });
      this.scene.add(ch.root);
      p = { ch, target: { x: snap.x, y: snap.y, z: snap.z, yaw: snap.yaw }, speed: 0 };
      this.peers.set(id, p);
    }
    p.target.x = snap.x; p.target.y = snap.y; p.target.z = snap.z;
    p.target.yaw = snap.yaw;
    p.speed = snap.speed || 0;
    if (snap.emote) p.ch.playEmote(snap.emote, 2.4);
  }

  remove(id) {
    const p = this.peers.get(id);
    if (!p) return;
    this.scene.remove(p.ch.root);
    p.ch.dispose();
    this.peers.delete(id);
  }

  update(dt, local) {
    if (!this.adapter.connected) return;
    this.sendTimer -= dt;
    if (this.sendTimer <= 0) {
      this.sendTimer = this.sendRate;
      this.adapter.send({
        x: +local.pos.x.toFixed(2), y: +local.pos.y.toFixed(2), z: +local.pos.z.toFixed(2),
        yaw: +local.yaw.toFixed(3), speed: +local.speed.toFixed(2),
        emote: local.character.emote || null,
      });
    }
    const k = 1 - Math.exp(-dt * 9);
    for (const p of this.peers.values()) {
      const r = p.ch.root;
      r.position.x += (p.target.x - r.position.x) * k;
      r.position.y += (p.target.y - r.position.y) * k;
      r.position.z += (p.target.z - r.position.z) * k;
      r.rotation.y = angleLerp(r.rotation.y, p.target.yaw, k);
      p.ch.update(dt, { speed: p.speed, grounded: true, sitting: false });
    }
  }

  dispose() {
    for (const id of [...this.peers.keys()]) this.remove(id);
  }
}
