/**
 * missions.js — authored dates, built the way a GTA mission is built.
 *
 * A quest (see quests.js) is a passive counter: do the thing anywhere, any
 * time, and it ticks. A mission is different — it is an *ordered chain of
 * objectives* that you start deliberately, that tells you where to go while it
 * is running, that can be failed and retried, and that pays out once at the
 * end. That structure is what makes a world feel authored rather than
 * scattered, and it is what this file adds.
 *
 * The shape of one mission:
 *
 *   { id, name, giver, brief, steps: [...], reward, after }
 *
 * and the shape of one step:
 *
 *   { type, at, radius, label, ... }
 *
 * `type` decides how the step is satisfied. Every type is listed in STEP_TYPES
 * below; adding a new kind of objective means adding one entry there and,
 * usually, one line where the game already knows the thing happened.
 *
 * What this deliberately does NOT copy from that other game: there is nothing
 * to shoot, no police, no wanted level, nothing to steal. The verbs here are
 * go, look, hold, give, photograph, catch, race and wait.
 */

/* ------------------------------------------------------------- step types */

/**
 * How each objective completes.
 *
 *   reach    be within `radius` of `at` (optionally in a vehicle)
 *   arrive   reach a named location id
 *   photo    take a photo while inside `radius` of `at`
 *   collect  pick up N of a collectible kind
 *   act      an in-game activity fires (`activity:` events, e.g. fish, order)
 *   hold     hold hands continuously for `seconds`
 *   emote    play a named emote
 *   talk     speak to a named NPC
 *   wait     be inside `radius` until the clock passes `hour`
 *   race     pass every checkpoint in order, under `seconds`
 */
export const STEP_TYPES = ['reach', 'arrive', 'photo', 'collect', 'act', 'hold', 'emote', 'talk', 'wait', 'race'];

/* --------------------------------------------------------------- missions */

export const MISSIONS = [
  {
    id: 'firstDate',
    name: 'First Date',
    giver: { loc: 'town', name: 'Wen' },
    brief: 'Wen says the café does the best coffee on the island — and that the pier at dusk is better.',
    steps: [
      { type: 'arrive', at: 'cafe', label: 'Meet at the HelloCouple Café' },
      { type: 'act', activity: 'drink', label: 'Order a drink for the two of you' },
      { type: 'hold', seconds: 12, label: 'Walk to the pier hand in hand', arriveAt: 'pier' },
      { type: 'photo', at: 'pier', radius: 26, label: 'Take a photo together on the pier' },
    ],
    reward: { coins: 180, hearts: 120, xp: 140 },
    unlock: 'outfit:jacket',
  },
  {
    id: 'goldenHour',
    name: 'Golden Hour',
    after: 'firstDate',
    giver: { loc: 'beach', name: 'Kes' },
    brief: 'Kes swears the light off the west point at sunset is worth the climb. Bring the camera.',
    steps: [
      { type: 'collect', kind: 'flower', count: 5, label: 'Pick 5 flowers along the way' },
      { type: 'arrive', at: 'viewpoint', label: 'Climb to Sunset Point' },
      { type: 'wait', at: 'viewpoint', radius: 34, hour: 18.2, label: 'Wait there until sunset' },
      { type: 'act', activity: 'sunset', label: 'Watch the sunset together' },
      { type: 'photo', at: 'viewpoint', radius: 34, label: 'Photograph the two of you in the light' },
    ],
    reward: { coins: 240, hearts: 180, xp: 200 },
    unlock: 'outfit:dress',
  },
  {
    id: 'roadTripMission',
    name: 'The Long Way Round',
    after: 'firstDate',
    giver: { loc: 'town', name: 'Wen' },
    brief: 'Take a car. Take the ring road. Do not take the short way.',
    steps: [
      { type: 'reach', at: 'town', radius: 30, needs: 'car', label: 'Find a car downtown and get in' },
      { type: 'reach', at: 'lighthouse', radius: 40, needs: 'car', label: 'Drive to the lighthouse' },
      { type: 'reach', at: 'campsite', radius: 40, needs: 'car', label: 'Drive on to the campsite' },
      { type: 'reach', at: 'sunsetBeach', radius: 40, needs: 'car', label: 'Finish at the west beach' },
    ],
    reward: { coins: 220, hearts: 90, xp: 180 },
  },
  {
    id: 'catchOfTheDay',
    name: 'Catch of the Day',
    after: 'firstDate',
    giver: { loc: 'pier', name: 'Odis' },
    brief: 'Odis has a bet on with the campsite about who eats better tonight.',
    steps: [
      { type: 'act', activity: 'fish', count: 3, label: 'Catch 3 fish off the pier' },
      { type: 'talk', npc: 'camper', label: 'Take them up to Juno at the campsite' },
      { type: 'act', activity: 'campfire', label: 'Cook them at the campsite fire' },
    ],
    reward: { coins: 200, hearts: 110, xp: 160 },
  },
  {
    id: 'openWater',
    name: 'Open Water',
    after: 'goldenHour',
    giver: { loc: 'pier', name: 'Odis' },
    brief: 'There is a cove on the west side you cannot reach on foot. Take a boat.',
    steps: [
      { type: 'reach', at: 'pier', radius: 30, needs: 'boat', label: 'Take the boat off the pier' },
      { type: 'reach', at: 'hiddenBeach', radius: 55, needs: 'boat', label: 'Sail round to the hidden cove' },
      { type: 'collect', kind: 'shell', count: 4, label: 'Find 4 shells on the sand' },
      { type: 'emote', emote: 'dance', label: 'Dance on the beach with nobody watching' },
    ],
    reward: { coins: 260, hearts: 200, xp: 220 },
    unlock: 'outfit:coat',
  },
  {
    id: 'skyline',
    name: 'Skyline',
    after: 'roadTripMission',
    giver: { loc: 'viewpoint', name: 'Mira' },
    brief: 'Mira keeps the pads. She says the island only makes sense from the air.',
    steps: [
      { type: 'reach', at: 'viewpoint', radius: 26, needs: 'heli', label: 'Take the helicopter from the pad' },
      { type: 'reach', at: 'town', radius: 80, needs: 'heli', minAlt: 45, label: 'Fly over downtown at 45 m or higher' },
      { type: 'photo', at: 'town', radius: 120, label: 'Photograph the city from the air' },
      { type: 'reach', at: 'lighthouse', radius: 40, needs: 'heli', label: 'Land at the lighthouse pad' },
    ],
    reward: { coins: 400, hearts: 220, xp: 320 },
    unlock: 'hat:aviator',
  },
];

/* ----------------------------------------------------------------- races */

/**
 * Time trials. A race is a mission whose only step is a checkpoint chain, but
 * it is worth keeping the course data separate because the rings are placed in
 * the world and drawn on the map.
 */
export const RACES = [
  {
    id: 'coastRun', name: 'Coast Run', craft: 'car', par: 115,
    start: 'town',
    points: ['town', 'beach', 'pier', 'park', 'town'],
    reward: { coins: 260, hearts: 60, xp: 200 },
  },
  {
    id: 'bayDash', name: 'Bay Dash', craft: 'boat', par: 100,
    start: 'pier',
    points: ['pier', 'beach', 'sunsetBeach', 'hiddenBeach'],
    reward: { coins: 300, hearts: 70, xp: 240 },
  },
  {
    id: 'ridgeFlight', name: 'Ridge Flight', craft: 'heli', par: 130,
    start: 'viewpoint',
    points: ['viewpoint', 'waterfall', 'campsite', 'lighthouse', 'viewpoint'],
    reward: { coins: 420, hearts: 90, xp: 340 },
  },
];

/* --------------------------------------------------------------- runtime */

/**
 * Time trial runtime. A race is its own small state machine because it needs
 * things a mission step does not: a live clock, a checkpoint ring in the world
 * that moves to the next point as you pass it, and a personal best.
 */
export class RaceSystem {
  constructor(game) {
    this.game = game;
    this.active = null;       // { def, index, time }
    this.onChange = () => {};
  }

  get state() {
    const s = this.game.save.state;
    return s.races || (s.races = {});
  }

  record(id) {
    return this.state[id] || (this.state[id] = { best: null, wins: 0, runs: 0 });
  }

  /** World position of checkpoint `i` of `def`. */
  point(def, i) {
    const id = def.points[i];
    const loc = this.game.locations?.get?.(id);
    return loc ? { x: loc.x, z: loc.z, id } : null;
  }

  start(id) {
    const def = RACES.find(r => r.id === id);
    if (!def || this.active) return false;
    if (!this.game._inCraftKind?.(def.craft)) {
      this.onChange('needs', def);
      return false;
    }
    this.active = { def, index: 0, time: 0 };
    this.record(id).runs++;
    this.onChange('start', def);
    return true;
  }

  abandon() {
    if (!this.active) return;
    const def = this.active.def;
    this.active = null;
    this.onChange('abandon', def);
  }

  update(dt) {
    const a = this.active;
    if (!a) return;
    a.time += dt;

    // Getting out of the vehicle ends the run — a race is a driving test.
    if (!this.game._inCraftKind?.(a.def.craft)) {
      this.active = null;
      return this.onChange('failed', a.def, 'You left the vehicle');
    }

    const p = this.game.missions?._pos();
    const t = this.point(a.def, a.index);
    if (!p || !t) return;
    const gate = a.def.craft === 'heli' ? 34 : 20;
    if (Math.hypot(p.x - t.x, p.z - t.z) > gate) return;

    a.index++;
    if (a.index < a.def.points.length) return this.onChange('checkpoint', a.def, a.index);

    // finished
    const rec = this.record(a.def.id);
    const time = a.time;
    const beat = rec.best == null || time < rec.best;
    if (beat) rec.best = time;
    const won = time <= a.def.par;
    if (won) rec.wins++;
    this.active = null;
    this.game.save.touch();
    this.onChange('finish', a.def, { time, best: rec.best, beat, won });
  }

  /** HUD line: clock, checkpoint count, distance to the next gate. */
  hud() {
    const a = this.active;
    if (!a) return null;
    const t = this.point(a.def, a.index);
    const p = this.game.missions?._pos();
    return {
      name: a.def.name,
      label: `Checkpoint ${a.index + 1} of ${a.def.points.length}`,
      prog: `${a.time.toFixed(1)}s / par ${a.def.par}s`,
      dist: t && p ? Math.round(Math.hypot(p.x - t.x, p.z - t.z)) : null,
      target: t,
      over: a.time > a.def.par,
    };
  }
}


export class MissionSystem {
  /**
   * @param {object} game the Game instance — used for the player, the world,
   *   the save file and the UI. Kept as one reference rather than a dozen.
   */
  constructor(game) {
    this.game = game;
    this.active = null;         // { def, step, index, timer, data }
    this.stepTime = 0;
    this.holdTime = 0;
    this.counter = 0;
    this.onChange = () => {};
  }

  get state() {
    const s = this.game.save.state;
    return s.missions || (s.missions = {});
  }

  record(id) {
    return this.state[id] || (this.state[id] = { done: false, best: null, plays: 0 });
  }

  /** Missions whose prerequisite is met and which are not finished. */
  available() {
    return MISSIONS.filter(d => !this.record(d.id).done
      && (!d.after || this.record(d.after).done));
  }

  isOffered(id) {
    return this.available().some(d => d.id === id);
  }

  /* ------------------------------------------------------------- control */

  start(id) {
    const def = MISSIONS.find(d => d.id === id);
    if (!def || this.active) return false;
    if (def.after && !this.record(def.after).done) return false;
    this.active = { def, index: 0, step: def.steps[0], data: {} };
    this.stepTime = 0;
    this.holdTime = 0;
    this.counter = 0;
    this.record(id).plays++;
    this.game.save.touch();
    this.onChange('start', def);
    return true;
  }

  abandon(reason = '') {
    if (!this.active) return;
    const def = this.active.def;
    this.active = null;
    this.onChange('abandon', def, reason);
  }

  /** Advance to the next objective, or finish. */
  _advance() {
    const a = this.active;
    a.index++;
    this.stepTime = 0;
    this.holdTime = 0;
    this.counter = 0;
    if (a.index >= a.def.steps.length) return this._complete();
    a.step = a.def.steps[a.index];
    this.onChange('step', a.def, a.step);
  }

  _complete() {
    const def = this.active.def;
    this.record(def.id).done = true;
    this.active = null;
    this.game.save.touch();
    this.onChange('complete', def);
  }

  /* -------------------------------------------------------------- events */

  /**
   * The game calls this when something happens that a step might be waiting
   * for. Keeping every step type behind one entry point means the rest of the
   * game does not have to know what a mission is.
   */
  notify(kind, payload = {}) {
    const a = this.active;
    if (!a) return;
    const s = a.step;
    switch (s.type) {
      case 'act':
        if (kind === 'activity' && payload.id === s.activity) {
          this.counter++;
          if (this.counter >= (s.count || 1)) this._advance();
          else this.onChange('progress', a.def, s);
        }
        break;
      case 'collect':
        if (kind === 'collect' && payload.kind === s.kind) {
          this.counter++;
          if (this.counter >= (s.count || 1)) this._advance();
          else this.onChange('progress', a.def, s);
        }
        break;
      case 'photo':
        if (kind === 'photo' && this._near(s)) this._advance();
        break;
      case 'emote':
        if (kind === 'emote' && payload.id === s.emote) this._advance();
        break;
      case 'talk':
        if (kind === 'talk' && payload.id === s.npc) this._advance();
        break;
      case 'arrive':
        if (kind === 'arrive' && payload.id === s.at) this._advance();
        break;
      default:
        break;
    }
  }

  /* --------------------------------------------------------------- tick */

  update(dt) {
    const a = this.active;
    if (!a) return;
    const s = a.step;
    this.stepTime += dt;
    const g = this.game;

    switch (s.type) {
      case 'reach': {
        if (!this._near(s)) break;
        if (s.needs && !this._inCraft(s.needs)) break;
        if (s.minAlt && (g.flying?.altitude ?? 0) < s.minAlt) break;
        this._advance();
        break;
      }
      case 'arrive': {
        if (this._near(s)) this._advance();
        break;
      }
      case 'hold': {
        if (g.companion?.holding) this.holdTime += dt;
        else this.holdTime = Math.max(0, this.holdTime - dt * 0.6);
        const there = !s.arriveAt || this._near({ at: s.arriveAt, radius: s.radius || 30 });
        if (this.holdTime >= (s.seconds || 10) && there) this._advance();
        break;
      }
      case 'wait': {
        if (!this._near(s)) break;
        const h = g.dayNight?.time ?? 0;
        const target = s.hour ?? 18;
        // Accept a window rather than an instant, or a slow clock could skip it.
        if (h >= target && h < target + 2.4) this._advance();
        break;
      }
      default:
        break;
    }
  }

  /* ------------------------------------------------------------ helpers */

  _pos() {
    const g = this.game;
    return (g.driving || g.sailing || g.flying)?.pos || g.player?.pos;
  }

  _inCraft(kind) {
    const g = this.game;
    return kind === 'car' ? !!g.driving
      : kind === 'boat' ? !!g.sailing
        : kind === 'heli' ? !!g.flying : true;
  }

  _near(s) {
    const t = this.target(s);
    if (!t) return false;
    const p = this._pos();
    if (!p) return false;
    return Math.hypot(p.x - t.x, p.z - t.z) <= (s.radius || 22);
  }

  /** Where a step points, in world space. Null for steps with no place. */
  target(s = this.active?.step) {
    if (!s) return null;
    const id = s.at || s.arriveAt;
    if (!id) return null;
    const loc = this.game.locations?.get?.(id);
    return loc ? { x: loc.x, z: loc.z } : null;
  }

  /** Text for the HUD tracker: the objective, plus its own progress. */
  hud() {
    const a = this.active;
    if (!a) return null;
    const s = a.step;
    let prog = `${a.index + 1} / ${a.def.steps.length}`;
    if (s.type === 'collect' || (s.type === 'act' && s.count)) {
      prog = `${this.counter} / ${s.count || 1}`;
    } else if (s.type === 'hold') {
      prog = `${Math.floor(this.holdTime)} / ${s.seconds}s`;
    } else if (s.type === 'wait') {
      const h = Math.floor(s.hour), mm = Math.round((s.hour % 1) * 60);
      prog = `until ${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }
    const t = this.target(s);
    let dist = null;
    if (t) {
      const p = this._pos();
      if (p) dist = Math.round(Math.hypot(p.x - t.x, p.z - t.z));
    }
    return { name: a.def.name, label: s.label, prog, dist, target: t };
  }
}
