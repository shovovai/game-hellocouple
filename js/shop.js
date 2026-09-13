/**
 * shop.js — cosmetics bought with coins earned in the world.
 * No real money, no randomised rewards: every item has a fixed price and is
 * bought directly.
 */

import { SHOP } from './config.js';

export class Shop {
  constructor(save) {
    this.save = save;
    this.onBuy = null;
    this.onEquip = null;
  }

  get items() { return SHOP; }

  categories() {
    const out = new Map();
    for (const it of SHOP) {
      if (!out.has(it.cat)) out.set(it.cat, []);
      out.get(it.cat).push(it);
    }
    return out;
  }

  owns(id) { return this.save.hasUnlocked(id); }
  canAfford(item) { return this.save.state.coins >= item.price; }

  buy(id) {
    const item = SHOP.find(i => i.id === id);
    if (!item) return { ok: false, reason: 'Unknown item' };
    if (this.owns(id)) return { ok: false, reason: 'Already owned' };
    if (!this.canAfford(item)) return { ok: false, reason: 'Not enough coins' };
    this.save.spend('coins', item.price);
    this.save.unlock(id);
    this.save.addXp(15);
    if (this.onBuy) this.onBuy(item);
    return { ok: true, item };
  }

  /** Apply a purchased cosmetic to the player's look. */
  equip(id) {
    const item = SHOP.find(i => i.id === id);
    if (!item || !this.owns(id)) return false;
    const look = this.save.state.look;
    if (item.cat === 'shirt') look.shirt = '#' + item.value.toString(16).padStart(6, '0');
    else if (item.cat === 'pants') look.pants = '#' + item.value.toString(16).padStart(6, '0');
    else if (item.cat === 'shoes') look.shoes = '#' + item.value.toString(16).padStart(6, '0');
    else if (item.cat === 'hat') look.hat = '#' + item.value.toString(16).padStart(6, '0');
    else if (item.cat === 'hair') look.hairStyle = item.value;
    else if (item.cat === 'emote') {
      const e = this.save.state.equipped.emotes;
      if (!e.includes(item.value)) e.push(item.value);
    }
    this.save.touch();
    if (this.onEquip) this.onEquip(item);
    return true;
  }

  unequipHat() {
    this.save.state.look.hat = null;
    this.save.touch();
  }

  /** Emotes the player may use (free ones plus purchased). */
  unlockedEmotes() {
    return this.save.state.equipped.emotes || [];
  }
}
