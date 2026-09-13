/**
 * save.js — persistence.
 *
 * All progress lives in one plain object behind a storage *adapter*. Version 1
 * ships a localStorage adapter; adding HelloCouple account sync later means
 * writing a second adapter with the same three methods (load/save/clear) and
 * handing it to `SaveManager` — nothing else in the game changes.
 */

import { GAME, CUSTOMIZE, levelForXp, xpBounds } from './config.js';

export const LocalAdapter = {
  id: 'local',
  async load(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
  },
  async save(key, data) {
    try { localStorage.setItem(key, JSON.stringify(data)); return true; } catch { return false; }
  },
  async clear(key) {
    try { localStorage.removeItem(key); return true; } catch { return false; }
  },
};

/**
 * Example of the future cloud adapter. Left unwired on purpose — version 1 has
 * no backend. See README "Adding accounts / cloud saves".
 *
 *   export const CloudAdapter = (endpoint, token) => ({
 *     id: 'cloud',
 *     async load()      { return (await fetch(`${endpoint}/save`, {headers:{Authorization:`Bearer ${token}`}})).json(); },
 *     async save(_, d)  { await fetch(`${endpoint}/save`, {method:'PUT', body: JSON.stringify(d)}); return true; },
 *     async clear()     { await fetch(`${endpoint}/save`, {method:'DELETE'}); return true; },
 *   });
 */

export function defaultState() {
  return {
    version: 1,
    profile: { username: 'Islander', avatar: '🌺', created: Date.now() },
    level: 1,
    xp: 0,
    hearts: 0,
    coins: 0,
    counts: { heart: 0, shell: 0, flower: 0, star: 0, coin: 0 },
    discovered: [],
    collected: [],
    quests: {},
    achievements: [],
    unlocked: [],
    equipped: { hat: null, emotes: [] },
    look: {
      skin: CUSTOMIZE.skin[1], hair: CUSTOMIZE.hair[0], hairStyle: 'short',
      shirt: CUSTOMIZE.shirt[0], pants: CUSTOMIZE.pants[0], shoes: CUSTOMIZE.shoes[0], hat: null,
    },
    companionLook: {
      skin: CUSTOMIZE.skin[3], hair: CUSTOMIZE.hair[3], hairStyle: 'long',
      shirt: CUSTOMIZE.shirt[1], pants: CUSTOMIZE.pants[1], shoes: CUSTOMIZE.shoes[1], hat: null,
    },
    flags: {},
    stats: {
      totalCollected: 0, fishCaught: 0, drinksOrdered: 0, dates: 0,
      timeAtBeach: 0, maxHeight: 0, playTime: 0, photos: 0, distance: 0,
    },
    world: { time: 8.5, weather: 'sunny' },
    position: null,
    savedAt: 0,
  };
}

export function defaultSettings() {
  return {
    quality: 'auto',
    shadows: true,
    master: 0.8,
    music: 0.45,
    sfx: 0.85,
    sensitivity: 1.0,
    invertY: false,
    showFps: false,
    pointerLock: true,
  };
}

export class SaveManager {
  constructor(adapter = LocalAdapter) {
    this.adapter = adapter;
    this.state = defaultState();
    this.settings = defaultSettings();
    this.dirty = false;
    this.hasSave = false;
    this.onChange = null;
  }

  async load() {
    const data = await this.adapter.load(GAME.saveKey);
    if (data && data.version === 1) {
      this.state = { ...defaultState(), ...data };
      // merge nested defaults so older saves keep working
      const d = defaultState();
      for (const k of ['counts', 'stats', 'look', 'companionLook', 'flags', 'world', 'profile', 'equipped']) {
        this.state[k] = { ...d[k], ...(data[k] || {}) };
      }
      this.hasSave = true;
    }
    const s = await this.adapter.load(GAME.settingsKey);
    if (s) this.settings = { ...defaultSettings(), ...s };
    return this.state;
  }

  async save() {
    this.state.savedAt = Date.now();
    this.dirty = false;
    return this.adapter.save(GAME.saveKey, this.state);
  }

  async saveSettings() {
    return this.adapter.save(GAME.settingsKey, this.settings);
  }

  async reset() {
    this.state = defaultState();
    this.hasSave = false;
    await this.adapter.clear(GAME.saveKey);
    this.touch();
  }

  touch() {
    this.dirty = true;
    if (this.onChange) this.onChange(this.state);
  }

  /* ------------------------------------------------------- currencies */

  add(kind, amount) {
    if (!amount) return;
    if (kind === 'xp') return this.addXp(amount);
    this.state[kind] = (this.state[kind] || 0) + amount;
    this.touch();
  }

  spend(kind, amount) {
    if ((this.state[kind] || 0) < amount) return false;
    this.state[kind] -= amount;
    this.touch();
    return true;
  }

  /** @returns {number} levels gained */
  addXp(amount) {
    const before = this.state.level;
    this.state.xp += amount;
    this.state.level = levelForXp(this.state.xp);
    this.touch();
    return this.state.level - before;
  }

  xpProgress() {
    const { lo, hi } = xpBounds(this.state.level);
    return { lo, hi, pct: Math.max(0, Math.min(1, (this.state.xp - lo) / ((hi - lo) || 1))) };
  }

  /* ---------------------------------------------------------- helpers */

  isDiscovered(id) { return this.state.discovered.includes(id); }
  discover(id) {
    if (this.isDiscovered(id)) return false;
    this.state.discovered.push(id);
    this.touch();
    return true;
  }

  isCollected(id) { return this.state.collected.includes(id); }
  collect(id) {
    if (this.isCollected(id)) return false;
    this.state.collected.push(id);
    this.touch();
    return true;
  }

  hasUnlocked(id) { return this.state.unlocked.includes(id); }
  unlock(id) {
    if (this.hasUnlocked(id)) return false;
    this.state.unlocked.push(id);
    this.touch();
    return true;
  }

  stat(name, delta) {
    this.state.stats[name] = (this.state.stats[name] || 0) + delta;
    this.touch();
  }

  statMax(name, value) {
    if (value > (this.state.stats[name] || 0)) {
      this.state.stats[name] = value;
      this.touch();
    }
  }

  flag(name, value = true) {
    this.state.flags[name] = value;
    this.touch();
  }
}
