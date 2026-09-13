/**
 * inventory.js — read-model over the save state.
 * The world has no droppable items in version 1, so the inventory presents
 * collectibles, owned cosmetics and quest items in one place.
 */

import { COLLECTIBLES, SHOP, QUESTS } from './config.js';

export class Inventory {
  constructor(save) { this.save = save; }

  collectibles() {
    return Object.entries(COLLECTIBLES).map(([id, def]) => ({
      id, name: def.label, emoji: def.emoji,
      qty: this.save.state.counts[id] || 0,
    }));
  }

  cosmetics() {
    return SHOP.filter(i => this.save.hasUnlocked(i.id)).map(i => ({
      id: i.id, name: i.name, emoji: i.emoji, cat: i.cat, qty: 1,
    }));
  }

  byCategory(cat) {
    return this.cosmetics().filter(c => c.cat === cat);
  }

  questItems() {
    const out = [];
    const st = this.save.state;
    if (st.flags.hasFish) out.push({ id: 'fish', name: 'Fresh Catch', emoji: '🐟', qty: st.stats.fishCaught || 0 });
    if (st.flags.hasPhoto) out.push({ id: 'photo', name: 'Island Photos', emoji: '📷', qty: st.stats.photos || 0 });
    const done = QUESTS.filter(q => (st.quests[q.id] || {}).done).length;
    if (done) out.push({ id: 'journal', name: 'Travel Journal', emoji: '📔', qty: done });
    return out;
  }

  total() {
    return this.collectibles().reduce((a, c) => a + c.qty, 0);
  }
}
