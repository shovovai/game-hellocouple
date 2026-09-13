/**
 * quests.js — quests, achievements and the rewards they pay out.
 *
 * Quests are pure data in config.js; this file only tracks progress against
 * their triggers, so adding a quest means adding one object to QUESTS.
 */

import { QUESTS, ACHIEVEMENTS, LOCATIONS } from './config.js';

export class QuestSystem {
  constructor(save) {
    this.save = save;
    this.onComplete = null;      // (quest, rewardText) => void
    this.onProgress = null;      // (quest) => void
    this.onAchievement = null;   // (achievement) => void
    this.onReward = null;        // ({hearts, coins, xp}) => void
    for (const q of QUESTS) {
      if (!this.save.state.quests[q.id]) {
        this.save.state.quests[q.id] = { progress: 0, done: false };
      }
    }
  }

  get all() { return QUESTS; }

  record(id) { return this.save.state.quests[id] || (this.save.state.quests[id] = { progress: 0, done: false }); }

  isActive(q) {
    const r = this.record(q.id);
    if (r.done) return false;
    if (q.after && !this.record(q.after).done) return false;
    return true;
  }

  /** The quest shown in the HUD tracker. */
  get tracked() {
    for (const q of QUESTS) if (this.isActive(q)) return q;
    return null;
  }

  /** Advance every quest listening to `trigger`. */
  fire(trigger, amount = 1) {
    for (const q of QUESTS) {
      if (q.trigger !== trigger) continue;
      if (!this.isActive(q)) continue;
      const r = this.record(q.id);
      r.progress = Math.min(q.target, r.progress + amount);
      this.save.touch();
      if (r.progress >= q.target) this._complete(q);
      else if (this.onProgress) this.onProgress(q, r);
    }
    this.checkAchievements();
  }

  _complete(q) {
    const r = this.record(q.id);
    r.done = true;
    r.at = Date.now();
    const reward = q.reward || {};
    if (reward.hearts) this.save.add('hearts', reward.hearts);
    if (reward.coins) this.save.add('coins', reward.coins);
    if (reward.xp) this.save.addXp(reward.xp);
    this.save.touch();
    if (this.onComplete) this.onComplete(q, this.rewardText(q));
    this.checkAchievements();
  }

  rewardText(q) {
    const r = q.reward || {};
    const bits = [];
    if (r.hearts) bits.push(`${r.hearts} Hearts`);
    if (r.coins) bits.push(`${r.coins} Coins`);
    if (r.xp) bits.push(`${r.xp} XP`);
    return bits.join(' · ');
  }

  /** Called on location discovery. */
  visited(locationId) { this.fire('visit:' + locationId); }

  /** Called on every pickup. */
  collected(type) {
    this.fire('collect:' + type);
    this.fire('collectAny');
  }

  /** Called when an activity is performed (drink, picnic, fish, photo…). */
  activity(id) { this.fire('activity:' + id); }

  checkAchievements() {
    const s = this.save.state;
    const ctx = { total: LOCATIONS.length };
    for (const a of ACHIEVEMENTS) {
      if (s.achievements.includes(a.id)) continue;
      let ok = false;
      try { ok = a.check(s, ctx); } catch { ok = false; }
      if (ok) {
        s.achievements.push(a.id);
        this.save.addXp(40);
        this.save.touch();
        if (this.onAchievement) this.onAchievement(a);
      }
    }
  }

  progressOf(q) {
    const r = this.record(q.id);
    return { value: r.progress, target: q.target, done: r.done };
  }

  get completedCount() { return QUESTS.filter(q => this.record(q.id).done).length; }
  get achievementCount() { return this.save.state.achievements.length; }
}
