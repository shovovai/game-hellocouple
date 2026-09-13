/**
 * main.js — bootstrap and the game loop.
 *
 * Order of operations:
 *   renderer → save/settings → menu → (Play) → terrain bake → world build →
 *   spawn → loop.
 *
 * Everything heavy runs through a generator so the loading bar moves instead of
 * the tab freezing.
 */

import * as THREE from 'three';
import { WORLD, QUALITY_PRESETS, LOCATIONS, CONTROLS, DRINKS, COLLECTIBLES } from './config.js';
import { Terrain, LAKE } from './terrain.js';
import { resolveLocations, buildNetwork, registerTerrainShaping } from './layout.js';
import { Physics } from './collision.js';
import { createMaterials, materials } from './materials.js';
import * as TEX from './textures.js';
import { Water } from './water.js';
import { Vegetation } from './vegetation.js';
import { World } from './world.js';
import { DayNight } from './daynight.js';
import { Weather } from './weather.js';
import { Player } from './player.js';
import { Companion } from './companion.js';
import { ThirdPersonCamera, FreeCamera } from './camera.js';
import { Controls, isTouchDevice } from './controls.js';
import { InteractionSystem } from './interaction.js';
import { CollectibleField } from './collectibles.js';
import { NPCSystem, DialogueSystem } from './npc.js';
import * as P from './props.js';
import { Wildlife } from './animals.js';
import { SaveManager } from './save.js';
import { QuestSystem } from './quests.js';
import { Shop } from './shop.js';
import { Inventory } from './inventory.js';
import { MapSystem } from './map.js';
import { FishingGame } from './minigames.js';
import { Vehicle } from './vehicle.js';
import { Boat, Helicopter, HELI_SPEC } from './craft.js';
import { TrafficSystem, PedestrianSystem } from './traffic.js';
import { AudioEngine } from './audio.js';
import { UI } from './ui.js';
import { RemotePlayers, NullNetwork } from './net.js';
import * as CACHE from './cache.js';
import { PerfGovernor, RUNTIME_TIERS, guessTier, tierIndex } from './perf.js';
import { LocalVoice, VoiceChat } from './voice.js';
import { MissionSystem, RaceSystem, MISSIONS, RACES } from './missions.js';
import { VOICE } from './config.js';
import { clamp } from './noise.js';

class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.touch = isTouchDevice();
    this.state = 'menu';          // menu | loading | playing | paused
    this.time = 0;
    this.running = false;
    this.inInterior = null;
    this.photoMode = false;
    this.sitting = null;
    this.driving = null;          // Vehicle the player is currently in
    this.autosaveTimer = 30;
    this.hudTimer = 0;
    this.fpsAcc = 0; this.fpsCount = 0; this.fps = 60;
    this.ambient = { waves: 0, wind: 0, forest: 0, fire: 0, cafe: 0, water: 0, rain: 0 };

    this.save = new SaveManager();
    this.audio = new AudioEngine();
    this.quests = new QuestSystem(this.save);
    this.shop = new Shop(this.save);
    this.inventory = new Inventory(this.save);
    this.fishing = new FishingGame();

    this._setupRenderer();
    this.ui = new UI(this);
    this.controls = new Controls(this.canvas);
    this.controls.onKey = (code) => this._onKey(code);

    this._bindWindow();
    this._boot();
  }

  /* --------------------------------------------------------- renderer */

  /* ------------------------------------------------------- performance */

  /**
   * Start the frame-rate governor. The build-time quality preset has already
   * fixed how much geometry exists; from here the governor only scales what can
   * change mid-session, and it does it from measured frame times rather than
   * from a guess about the hardware.
   */
  _setupGovernor() {
    const pref = this.save.settings.quality;
    const auto = !pref || pref === 'auto';
    const start = auto ? guessTier({ touch: this.touch, renderer: this.renderer }) : pref;
    this.perf = new PerfGovernor({
      start,
      // A manual choice pins the tier; auto is free to move within the range.
      min: auto ? 'potato' : start,
      max: auto ? 'high' : start,
      onChange: (tier) => this._applyTier(tier),
    });
    this._applyTier(this.perf.tier);
  }

  /** Apply a runtime tier. Cheap enough to run mid-frame. */
  _applyTier(tier) {
    this.tier = tier;
    const wantShadows = tier.shadows && this.save.settings.shadows !== false;

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, tier.pixelRatio));
    this.renderer.shadowMap.enabled = wantShadows;
    // Redrawing the shadow map every frame is wasted on a slow device: the sun
    // barely moves between frames.
    this.renderer.shadowMap.autoUpdate = tier.shadowEvery <= 1;
    this._shadowTick = 0;

    this.camera.far = tier.drawDistance;
    this.camera.updateProjectionMatrix();

    const sun = this.dayNight?.sun;
    if (sun) {
      sun.castShadow = wantShadows;
      if (sun.shadow.mapSize.width !== tier.shadowMapSize) {
        sun.shadow.mapSize.set(tier.shadowMapSize, tier.shadowMapSize);
        sun.shadow.map?.dispose();
        sun.shadow.map = null;
      }
    }
    if (this.dayNight) {
      this.dayNight.quality.shadowDistance = Math.min(
        this.quality.shadowDistance, Math.round(tier.drawDistance * 0.18));
      this.dayNight.quality.shadowMapSize = tier.shadowMapSize;
      this.dayNight.setRange(tier.drawDistance);
      this.dayNight.fogScale = tier.fogDensity;
      this.dayNight.apply();
    }
    this.traffic?.setBudget?.(tier.traffic);
    this.pedestrians?.setBudget?.(tier.pedestrians);
    this.weather?.setScale?.(tier.particles);
    this.ui?.setTierLabel?.(tier.label, this.perf?.min !== this.perf?.max);
    if (this.renderer.domElement) this._onResize?.();
  }

  /** Spread shadow-map updates over several frames on the slower tiers. */
  _tickShadows() {
    const every = this.tier?.shadowEvery || 1;
    if (every <= 1 || !this.renderer.shadowMap.enabled) return;
    this._shadowTick = (this._shadowTick + 1) % every;
    this.renderer.shadowMap.needsUpdate = this._shadowTick === 0;
  }

  _pickQuality() {
    const pref = this.save.settings.quality;
    if (pref && pref !== 'auto') return { name: pref, ...QUALITY_PRESETS[pref] };
    const cores = navigator.hardwareConcurrency || 4;
    const mem = navigator.deviceMemory || 4;
    let name = 'high';
    if (this.touch) name = (cores >= 8 && mem >= 6) ? 'medium' : 'low';
    else if (cores <= 4 || mem <= 4) name = 'medium';
    return { name, ...QUALITY_PRESETS[name] };
  }

  _setupRenderer() {
    this.quality = { name: 'medium', ...QUALITY_PRESETS.medium };
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
    });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.16;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.25, 1400);
    this.camera.position.set(0, 30, 40);
    this.freeCam = new FreeCamera(this.camera);
  }

  _applyQuality(q) {
    this.quality = q;
    const dpr = Math.min(window.devicePixelRatio || 1, q.pixelRatio);
    this.renderer.setPixelRatio(dpr);
    this.renderer.shadowMap.enabled = q.shadows && this.save.settings.shadows !== false;
    this.camera.far = q.drawDistance;
    this.camera.updateProjectionMatrix();
    this.dayNight?.setRange(q.drawDistance);
    TEX.setAnisotropy(Math.min(q.anisotropy, this.renderer.capabilities.getMaxAnisotropy()));
    if (this.dayNight) {
      this.dayNight.sun.castShadow = this.renderer.shadowMap.enabled;
      this.dayNight.apply();
    }
  }

  _bindWindow() {
    const resize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h, false);
    };
    this._onResize = resize;
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => setTimeout(resize, 250));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.saveGame(false);
    });
    const unlock = () => { this.audio.resume(); };
    window.addEventListener('pointerdown', unlock, { once: false });
    window.addEventListener('keydown', unlock, { once: false });
    window.addEventListener('beforeunload', () => {
      if (this.state === 'playing') this.saveGame(false);
    });
  }

  /* ------------------------------------------------------------- boot */

  async _boot() {
    await this.save.load();
    this.audio.setVolume('master', this.save.settings.master);
    this.audio.setVolume('music', this.save.settings.music);
    this.audio.setVolume('sfx', this.save.settings.sfx);
    this.controls.sensitivity = this.save.settings.sensitivity;
    this.controls.invertY = this.save.settings.invertY;
    this.controls.enablePointerLock(this.save.settings.pointerLock && !this.touch);
    this.ui.showMenu(this.save.hasSave);
    this.ui.setTutorial(CONTROLS);
  }

  /* -------------------------------------------------------- world gen */

  async startGame(continueSave, openTab = null) {
    if (this.state === 'loading') return;
    this.audio.resume();
    if (!continueSave && this.save.hasSave) {
      // Play always starts a fresh island run but keeps unlocked cosmetics.
      this.save.state.position = null;
    }
    this.ui.hideMenu();
    this.state = 'loading';
    this.ui.showLoading();
    await new Promise(r => setTimeout(r, 40));

    const q = this._pickQuality();
    this._applyQuality(q);
    createMaterials();

    // ---- terrain ----
    this.ui.setLoading(0.02, 'Raising the island...');
    this.terrain = new Terrain(q);
    this.locations = resolveLocations(this.terrain);
    this.network = buildNetwork(this.terrain, this.locations);
    registerTerrainShaping(this.terrain, this.locations, this.network);

    // The heightfield is a pure function of the island's shape, and baking it
    // is by far the slowest part of a cold load. Read it back when we can.
    const hmKey = this.terrain.cacheKey();
    const cached = this.save.settings.cacheWorld === false ? null : await CACHE.get(hmKey);
    if (cached && this.terrain.adoptHeights(cached)) {
      this.ui.setLoading(0.24, 'Remembering the island...');
      await this._frame();
    } else {
      const hm = this.terrain.buildHeightmap();
      await this._drain(hm, (t) => this.ui.setLoading(0.02 + t * 0.22, 'Shaping the coastline...'));
      // Store a copy: the live array keeps being read for the rest of the session.
      if (this.save.settings.cacheWorld !== false) {
        CACHE.put(hmKey, this.terrain.heights.slice()).catch(() => { /* quota; not fatal */ });
      }
    }

    this.physics = new Physics(this.terrain);
    this.terrain.build(this.scene, q);
    this.ui.setLoading(0.27, 'Pouring the ocean...');
    await this._frame();

    this.water = new Water(this.scene, this.terrain, q);
    this.veg = new Vegetation(this.scene, q);
    this.dayNight = new DayNight(this.scene, this.renderer, q);
    this.dayNight.setRange(q.drawDistance);
    this.weather = new Weather(this.scene, q, this.dayNight);

    // ---- world ----
    this.world = new World(this.scene, this.terrain, this.physics, q, this.water, this.veg,
      this.locations, this.network);
    const gen = this.world.build();
    const vegKey = `veg:${hmKey}:${q.name}`;
    const vegSnap = this.save.settings.cacheWorld === false ? null : await CACHE.get(vegKey);
    if (vegSnap) this.world.useVegetationCache(vegSnap);

    await this._drain(gen, (t, label) => this.ui.setLoading(0.3 + t * 0.55, label));

    if (this.save.settings.cacheWorld !== false && !vegSnap && !this.world._vegReplayFailed) {
      const snap = this.world.veg.snapshot();
      if (snap) CACHE.put(vegKey, snap).catch(() => { /* quota; not fatal */ });
    }

    // ---- actors ----
    this.ui.setLoading(0.88, 'Waking everyone up...');
    await this._frame();
    // The governor needs the renderer, the sun and the crowd systems to exist
    // before it can scale anything, so it starts here rather than at boot.
    this._setupGovernor();

    this.player = new Player(this.scene, this.physics, this.terrain, this.save.state.look);
    this.companion = new Companion(this.scene, this.physics, this.terrain, this.save.state.companionLook);
    this.camRig = new ThirdPersonCamera(this.camera, this.physics, this.terrain);

    this.player.onFootstep = (s) => this.audio.footstep(s);
    this.player.onJump = () => this.audio.jump();
    this.player.onLand = () => this.audio.land();

    this.interaction = new InteractionSystem();
    this.collectibles = new CollectibleField(this.scene, this.save);
    this.collectibles.build(this.world.collectibleSpots);
    this.collectibles.onCollect = (it) => this._onCollect(it);

    this.npcSystem = new NPCSystem(this.scene, this.physics, this.terrain);
    this.npcSystem.build(this.world.npcSpawns, this.world);
    this.dialogue = new DialogueSystem(this.ui);
    this.dialogue.onEnd = () => { this.controls.reset(); };

    this.interaction.build(this.world.interactables);

    this.wildlife = new Wildlife(this.scene, this.terrain, q);
    const flowerSpots = this.world.collectibleSpots.filter(s => s.type === 'flower' || s.type === 'heart');
    const waterSpots = [
      { x: LAKE.x, z: LAKE.z, y: WORLD.lakeLevel },
      { x: this.locations.get('pier').x, z: this.locations.get('pier').z, y: WORLD.seaLevel },
      { x: this.locations.get('beach').x, z: this.locations.get('beach').z, y: WORLD.seaLevel },
    ];
    this.wildlife.seed(flowerSpots.length ? flowerSpots : waterSpots, waterSpots);

    this.map = new MapSystem(this.terrain, this.network, this.locations, this.save);
    this.map.bake();

    // ---- city life ----
    this.traffic = new TrafficSystem(this.scene, this.terrain, this.physics, this.world.roadGraph, q);
    this.pedestrians = new PedestrianSystem(this.scene, this.terrain, this.network.city, q);
    this.vehicles = (this.world.drivableCars || []).map(car => {
      const v = new Vehicle(car.model, this.terrain, this.physics, car.kind);
      v.place(car.x, car.z, car.heading);
      car.vehicle = v;
      return v;
    });
    this.boats = (this.world.boats || []).map(b => {
      const v = new Boat(b.model, this.terrain, this.water, WORLD.seaLevel);
      v.place(b.x, b.z, b.heading);
      b.craft = v;
      return v;
    });
    this.helis = (this.world.helis || []).map(h => {
      const v = new Helicopter(h.model, this.terrain, this.physics);
      v.place(h.x, h.z, h.heading);
      h.craft = v;
      return v;
    });
    this.sailing = null;
    this.flying = null;
    this._setupVoice();
    this.remote = new RemotePlayers(this.scene, this.voiceChat?.available ? this.voiceChat : NullNetwork);

    this._setupMissions();
    this._wireProgressEvents();

    // ---- spawn ----
    const spawnLoc = this.locations.get('town');
    const saved = continueSave ? this.save.state.position : null;
    if (saved) {
      const sp = this.world.safeSpot(saved.x, saved.z);
      this.player.teleport(sp.x, sp.z, saved.yaw);
      this.dayNight.setTime(this.save.state.world.time ?? 8.5);
      this.weather.set(this.save.state.world.weather || 'sunny', true);
    } else {
      const home = this.world.arrivals.get('town') || { x: spawnLoc.x, z: spawnLoc.z + 12, yaw: Math.PI };
      const sp = this.world.safeSpot(home.x, home.z);
      this.player.teleport(sp.x, sp.z, home.yaw ?? Math.PI);
      this.dayNight.setTime(8.5);
      this.weather.set('sunny', true);
    }
    this.companion.teleportNear(this.player.pos, this.player.yaw);
    this.camRig.snap(this.player.pos, this.player.yaw + Math.PI);

    this.ui.setLoading(1, 'Ready');
    await this._frame();
    await new Promise(r => setTimeout(r, 90));
    this.ui.hideLoading();
    this.ui.showHUD(this.touch);
    this.ui.updateHUD();
    this.state = 'playing';
    this.running = true;
    this.lastTime = performance.now();
    this.controls.enabled = true;
    requestAnimationFrame(() => this._loop());

    if (openTab) this.ui.openOverlay(openTab);

    // first-run welcome
    if (!this.save.state.flags.welcomed) {
      this.save.flag('welcomed');
      setTimeout(() => {
        this.ui.discovery('HELLOCOUPLE WORLD', 'Explore. Discover. Connect.');
        this.ui.toast('Welcome to the island', 'Explore the town, then follow the roads.', 'rose');
      }, 500);
    }
    console.info('[HelloCouple World] built', this.world.stats);
  }

  /** Run a generator across frames, reporting progress. */
  async _drain(gen, onProgress) {
    let last = performance.now();
    for (const step of gen) {
      const t = typeof step === 'number' ? step : step.t;
      const label = typeof step === 'number' ? null : step.label;
      onProgress(t, label);
      const now = performance.now();
      // Yield often enough that the loading screen keeps animating, but not so
      // often that waiting for the next frame costs more than the work itself.
      if (now - last > 40) { await this._frame(); last = performance.now(); }
    }
    await this._frame();
  }

  _frame() { return new Promise(r => requestAnimationFrame(() => r())); }

  _wireProgressEvents() {
    // Every quest trigger is also a mission event. Wrapping the one funnel the
    // game already has beats sprinkling notify() calls through a dozen files —
    // and it means a new step type only has to name an existing trigger.
    const fire = this.quests.fire.bind(this.quests);
    this.quests.fire = (trigger, amount = 1) => {
      fire(trigger, amount);
      const i = trigger.indexOf(':');
      const kind = trigger.slice(0, i), id = trigger.slice(i + 1);
      if (kind === 'activity') {
        this.missions?.notify('activity', { id });
        if (id === 'photo') this.missions?.notify('photo', {});
      } else if (kind === 'collect') {
        this.missions?.notify('collect', { kind: id });
      } else if (kind === 'visit') {
        this.missions?.notify('arrive', { id });
      }
    };

    this.quests.onComplete = (q, reward) => {
      this.audio.ui('quest');
      this.ui.toast(`Quest complete — ${q.name}`, reward, 'gold');
      this.ui.updateHUD();
    };
    this.quests.onAchievement = (a) => {
      this.audio.ui('level');
      this.ui.toast(`Achievement — ${a.name}`, a.desc, 'gold');
    };
    this.save.onChange = () => { this.hudTimer = 0; };
  }

  /* ------------------------------------------------------------- loop */

  _loop() {
    if (!this.running) return;
    requestAnimationFrame(() => this._loop());
    const now = performance.now();
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    // Simulation dt is clamped so a long stall cannot tunnel the player through
    // the world; UI-facing timers use the real elapsed time instead.
    this.dtReal = Math.min(dt, 0.5);
    if (dt > 0.1) dt = 0.1;
    this.time += dt;
    this.perf?.frame(this.dtReal);

    this.fpsAcc += dt; this.fpsCount++;
    if (this.fpsAcc > 0.5) {
      this.fps = Math.round(this.fpsCount / this.fpsAcc);
      this.fpsAcc = 0; this.fpsCount = 0;
      this.ui.setFps(this.fps + ' fps', this.save.settings.showFps);
    }

    const paused = this.ui.anyOverlayOpen;
    const look = this.controls.consumeLook();
    const zoom = this.controls.consumeZoom();

    if (this.photoMode) {
      this._updatePhoto(dt, look, zoom);
    } else if (!paused) {
      this._updateGameplay(dt, look, zoom);
    } else {
      // keep the world alive but freeze input
      this.player?.update(dt, { x: 0, y: 0, len: 0, sprint: false, jump: false }, this.camRig.yaw, this.audio);
      this.camRig.update(dt, this.player.pos);
    }

    this._updateMissions(dt);
    this._updateWorldSystems(dt);
    this._tickShadows();
    this.renderer.render(this.scene, this.camera);
  }

  _updateGameplay(dt, look, zoom) {
    const c = this.controls;
    if (look.x || look.y) this.camRig.rotate(look.x, look.y);
    if (zoom) this.camRig.zoom(zoom);

    const move = c.getMove();
    const jump = c.consumeJump();
    const interact = c.consumeInteract();

    if (this.driving) {
      this._updateDriving(dt, move, interact, c);
      return;
    }

    if (this.sailing) {
      this._updateBoat(dt, move, interact, c);
      return;
    }

    if (this.flying) {
      this._updateHeli(dt, move, interact, c, jump);
      return;
    }

    if (this.sitting) {
      if (interact || move.len > 0.4 || jump) {
        this._standUp();
        // Standing up consumes the key: otherwise the same press immediately
        // re-triggers the bench you just got off.
        if (interact) {
          this._proximity(false);
          this.player.update(dt, { x: 0, y: 0, len: 0, sprint: false, jump: false }, this.camRig.yaw, this.audio);
          this.camRig.update(dt, this.player.pos);
          return;
        }
      } else {
        this.player.update(dt, { x: 0, y: 0, len: 0, sprint: false, jump: false }, this.camRig.yaw, this.audio);
        this.camRig.update(dt, this.player.pos, { lag: 6 });
        this._proximity(true);
        return;
      }
    }

    this.player.update(dt, {
      x: move.x, y: move.y, len: move.len,
      sprint: c.isSprinting(), jump,
    }, this.camRig.yaw, this.audio);

    this._updateVoice(c);
    this._updateHandHolding(c);
    // The player looks at whatever they are close enough to interact with, and
    // at their partner otherwise.
    const gaze = this._prompt
      ? { x: this._prompt.x, y: (this._prompt.y ?? this.player.pos.y) + 1.4, z: this._prompt.z }
      : (this.companion.enabled ? { x: this.companion.pos.x, y: this.companion.pos.y + 1.5, z: this.companion.pos.z } : null);
    const d = gaze ? Math.hypot(gaze.x - this.player.pos.x, gaze.z - this.player.pos.z) : 99;
    this.player.character.lookAt(d < 9 ? gaze : null, this.player.yaw);
    this.companion.update(dt, this.player.pos, this.player.speed, { yaw: this.player.yaw });
    this.camRig.update(dt, this.player.pos);

    // Refresh the prompt *before* consuming the key so an interact pressed on
    // the same frame you come into range still lands.
    this._proximity(false);
    if (interact) this._tryInteract();

    // discovery + stats
    const found = this.map.checkDiscovery(this.player.pos);
    for (const def of found) {
      this.audio.ui('discover');
      this.ui.discovery(def.title, def.sub);
      this.quests.visited(def.id);
      this.save.addXp(35);
      this.ui.toast(`Discovered ${def.name}`, '+35 XP', 'rose');
    }
    this.save.statMax('maxHeight', this.player.pos.y);
    const area = this.map.currentArea(this.player.pos);
    this._area = area;
    if (area && area.id === 'town' && this.dayNight.state.night > 0.6) this.save.flag('cityNight');
    if (area && (area.id === 'beach' || area.id === 'sunsetBeach')) this.save.stat('timeAtBeach', dt);
    this.save.stat('playTime', dt);

    this.collectibles.update(dt, this.time, this.player.pos);
  }

  /** Player is behind the wheel: input drives the car, camera chases it. */
  /* ---------------------------------------------------------- missions */

  /**
   * Missions are the authored half of the game: an ordered chain of objectives
   * you start on purpose, that tells you where to go while it runs. Quests stay
   * as they were — passive counters that tick wherever you happen to be.
   */
  _setupMissions() {
    this.missions = new MissionSystem(this);
    this.waypoint = P.makeWaypoint();
    this.waypoint.visible = false;
    this.scene.add(this.waypoint);

    this.races = new RaceSystem(this);
    this.checkpoint = P.makeCheckpoint(8);
    this.checkpoint.visible = false;
    this.scene.add(this.checkpoint);

    this.races.onChange = (kind, def, extra) => {
      if (kind === 'needs') {
        const what = { car: 'a car', boat: 'a boat', heli: 'the helicopter' }[def.craft];
        this.ui.toast(def.name, `Get in ${what} first.`);
      } else if (kind === 'start') {
        this.ui.toast(def.name, `Go. Par is ${def.par}s.`, 'gold');
        this.audio.ui('quest');
      } else if (kind === 'checkpoint') {
        this.audio.ui('click');
      } else if (kind === 'failed') {
        this.ui.toast(def.name, extra);
      } else if (kind === 'finish') {
        this._payRace(def, extra);
      }
      this.ui.updateMissionTracker();
    };

    this.missions.onChange = (kind, def, extra) => {
      if (kind === 'start') {
        this.ui.toast(def.name, def.steps[0].label, 'rose');
        this.audio.ui('quest');
      } else if (kind === 'step') {
        this.ui.toast('Next', extra.label, 'gold');
        this.audio.ui('click');
      } else if (kind === 'complete') {
        this._payMission(def);
      } else if (kind === 'abandon') {
        this.ui.toast(def.name, extra || 'Left for another time.');
      }
      this.ui.updateMissionTracker();
      this.map?.setWaypoint?.(this.missions.target());
    };
  }

  /** Is the player currently in this kind of vehicle? */
  _inCraftKind(kind) {
    return kind === 'car' ? !!this.driving
      : kind === 'boat' ? !!this.sailing
        : kind === 'heli' ? !!this.flying : true;
  }

  _payRace(def, r) {
    const t = r.time.toFixed(1);
    if (r.won) {
      const rw = def.reward || {};
      if (rw.coins) this.save.add('coins', rw.coins);
      if (rw.hearts) this.save.add('hearts', rw.hearts);
      if (rw.xp) this.save.addXp(rw.xp);
      this.audio.ui('level');
      this.ui.discovery(def.name.toUpperCase(), `${t}s — under par`);
      this.ui.toast(`${def.name} — ${t}s`,
        r.beat ? 'New personal best.' : `Best ${r.best.toFixed(1)}s`, 'gold');
      this.quests.fire('activity:race');
    } else {
      this.audio.ui('close');
      this.ui.toast(`${def.name} — ${t}s`, `Par is ${def.par}s. Try again.`);
    }
    this.ui.updateHUD();
  }

  _payMission(def) {
    const r = def.reward || {};
    if (r.coins) this.save.add('coins', r.coins);
    if (r.hearts) this.save.add('hearts', r.hearts);
    if (r.xp) this.save.addXp(r.xp);
    if (def.unlock) {
      this.save.state.unlocked = this.save.state.unlocked || [];
      if (!this.save.state.unlocked.includes(def.unlock)) this.save.state.unlocked.push(def.unlock);
    }
    const bits = [r.coins && `${r.coins} coins`, r.hearts && `${r.hearts} hearts`, r.xp && `${r.xp} XP`]
      .filter(Boolean).join(' · ');
    this.audio.ui('level');
    this.ui.discovery(def.name.toUpperCase(), 'Date complete');
    this.ui.toast(`Date complete — ${def.name}`, bits, 'gold');
    this.quests.fire('activity:date');
    this.save.state.stats.dates = (this.save.state.stats.dates || 0) + 1;
    this.ui.updateHUD();
  }

  /** Offer whatever this giver has, or say when they will have something. */
  _missionGiver(_id, name) {
    const offered = this.missions.available().filter(d => d.giver?.name === name);
    if (this.missions.active) {
      this.ui.toast(name, `Finish "${this.missions.active.def.name}" first.`);
      return false;
    }
    if (!offered.length) {
      this.ui.toast(name, 'Nothing new right now. Come back later.');
      return false;
    }
    const def = offered[0];
    this.ui.showBrief(def, (yes) => {
      if (yes) this.missions.start(def.id);
    });
    return true;
  }

  _updateMissions(dt) {
    if (!this.missions) return;
    this.missions.update(dt);
    this.races?.update(dt);

    // The checkpoint ring sits on the next gate of a running race.
    const race = this.races?.hud();
    const cp = this.checkpoint;
    if (race?.target) {
      const y = this.flying ? Math.max(this.terrain.height(race.target.x, race.target.z),
        this.flying.pos.y - 6) : this.terrain.height(race.target.x, race.target.z);
      cp.position.set(race.target.x, y, race.target.z);
      cp.visible = true;
      cp.rotation.y += dt * 0.4;
      cp.userData.mats[0].color.setHex(race.over ? 0xff6a5a : 0x4ad2ff);
    } else if (cp) {
      cp.visible = false;
    }

    const t = race?.target || this.missions.target();
    this.map?.setWaypoint?.(t);
    const wp = this.waypoint;
    if (t) {
      const y = this.terrain.height(t.x, t.z);
      wp.position.set(t.x, y, t.z);
      wp.visible = true;
      wp.userData.spin.rotation.z += dt * 0.9;
      const pulse = 0.55 + Math.sin(this.time * 2.4) * 0.2;
      wp.userData.mats[1].opacity = pulse;
    } else {
      wp.visible = false;
    }
  }

  /* ------------------------------------------------------------- voice */

  /**
   * Two independent things, both optional.
   *
   * `voice` is offline: the browser transcribes what you say, the companion
   * answers out loud. `voiceChat` is a real WebRTC call with whoever joins the
   * same room code, with each voice panned to where that player is standing.
   */
  _setupVoice() {
    this.voiceStatus = '';
    this.voice = new LocalVoice({
      context: () => this._voiceContext(),
      onHeard: (text) => this.ui.setVoiceState('listening', text, ''),
      onReply: (say, act, heard) => {
        this.ui.setVoiceState('speaking', heard, say);
        this.save.state.stats.voiceLines = (this.save.state.stats.voiceLines || 0) + 1;
        this.quests?.fire('activity:voice');
        this.save.addXp(4);
        this._voiceAct(act);
        clearTimeout(this._voiceHide);
        this._voiceHide = setTimeout(() => this.ui.setVoiceState('off'), 5200);
      },
      onState: (state) => {
        if (state === 'listening') this.ui.setVoiceState('listening', '', '');
        else if (state === 'error') this.ui.setVoiceState('off');
      },
    });

    this.voiceChat = new VoiceChat({
      url: VOICE.serverUrl,
      ctx: this.audio?.ctx || null,
      onState: (state, id) => {
        this.voiceStatus = {
          mic: 'Asking for the microphone…',
          connecting: 'Connecting…',
          connected: 'Connected — waiting for someone to join',
          closed: 'Disconnected',
          idle: 'Not connected',
        }[state] || this.voiceStatus;
        if (state === 'peer-joined') { this.voiceStatus = 'Someone joined'; this.ui.toast('Voice chat', 'Someone joined your room.', 'rose'); }
        if (state === 'peer-left') this.voiceStatus = 'They left the room';
        if (this.ui.overlayTab === 'voice' && this.ui.overlayOpen) this.ui.renderOverlay();
      },
    });
  }

  /** What the companion knows about right now, for answering questions. */
  _voiceContext() {
    const q = this.quests?.tracked;
    const h = Math.floor(this.dayNight.time);
    const mm = Math.floor((this.dayNight.time % 1) * 60);
    return {
      playerName: this.save.state.profile?.name || 'you',
      area: this._area?.title || this._area?.name || 'the island',
      clock: `${((h + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`,
      weather: this.weather?.current || 'clear',
      quest: q?.name || null,
      timeGreeting: h < 12 ? 'Morning.' : h < 18 ? 'Afternoon.' : 'Evening.',
    };
  }

  /** A spoken line can also do something, not just answer. */
  _voiceAct(act) {
    if (!act) return;
    if (act === 'hold') this.toggleHandHolding(true);
    else if (act === 'photo') this.togglePhotoMode(true);
    else if (act === 'dance' || act === 'wave') {
      this.companion.emote(act, 2.6);
      this.player.emote(act, 2.6);
    }
  }

  _updateVoice(c) {
    const talk = c.consumeTalk?.();
    if (talk === true) {
      if (!this.voice.available) {
        this.ui.toast('No microphone input', 'This browser cannot transcribe speech. Try Chrome, Edge or Safari.');
      } else if (!this.voice.start()) {
        this.ui.toast('Microphone blocked', 'Allow microphone access to talk.');
      }
    } else if (talk === false) {
      this.voice.stop();
    }
  }

  /** Join or leave the voice room named in Settings → Voice. */
  async toggleVoiceChat() {
    const vc = this.voiceChat;
    if (!vc?.available) {
      this.ui.toast('Voice chat unavailable', 'No signalling server is configured for this build.');
      return;
    }
    if (vc.connected) {
      vc.disconnect();
      this.voiceStatus = 'Not connected';
      this.ui.renderOverlay();
      return;
    }
    try {
      await this.audio?.resume?.();
      vc.ctx = this.audio?.ctx || vc.ctx;
      await vc.connect(this.save.state.settings?.voiceRoom || '', {
        name: this.save.state.profile?.name || 'Player',
        look: this.save.state.look,
      });
    } catch (err) {
      this.voiceStatus = err.message;
      this.ui.toast('Could not join', err.message);
    }
    this.ui.renderOverlay();
  }

  /**
   * Hand holding. The companion walks beside you instead of behind you and one
   * arm on each of you is pinned; anything that changes posture (sitting,
   * driving, sprinting away, a long separation) lets go on its own.
   */
  toggleHandHolding(on = !this.companion.holding) {
    if (on) {
      if (this.driving || this.player.sitting || this.companion.sitting) return;
      const d = Math.hypot(this.companion.pos.x - this.player.pos.x,
        this.companion.pos.z - this.player.pos.z);
      if (d > 4.5) { this.ui.toast('Too far apart to hold hands'); return; }
      this.companion.holding = true;
      this.player.hold = -this.companion.holdSide;
      this.ui.toast('Holding hands');
      this.save.state.stats.handHolds = (this.save.state.stats.handHolds || 0) + 1;
      this.quests?.fire('activity:holdHands');
    } else {
      this.companion.holding = false;
      this.player.hold = 0;
    }
    this.ui.setHolding?.(this.companion.holding);
  }

  _updateHandHolding(c) {
    if (c.consumeHold && c.consumeHold()) this.toggleHandHolding();
    if (!this.companion.holding) return;
    const d = Math.hypot(this.companion.pos.x - this.player.pos.x,
      this.companion.pos.z - this.player.pos.z);
    if (this.player.sitting || this.companion.sitting || this.driving || d > 5.5
        || this.player.swimming || !this.player.grounded) {
      this.toggleHandHolding(false);
    }
  }

  _updateDriving(dt, move, interact, c) {
    const v = this.driving;
    const braking = c.brakeHeld;
    v.update(dt, { throttle: move.y, steer: move.x, brake: braking });
    v.setBraking(braking || move.y < -0.2);

    // passengers ride along
    const back = { x: v.pos.x - Math.sin(v.heading) * 0.2, z: v.pos.z - Math.cos(v.heading) * 0.2 };
    this.player.pos.set(back.x, v.pos.y + 0.9, back.z);
    this.player.yaw = v.heading;
    this.companion.pos.set(back.x, v.pos.y + 0.9, back.z);
    this._seatRiders(dt, v);

    // camera sits further back and lower the faster you go
    const speedFrac = Math.min(1, v.kmh / 120);
    this.camRig.targetDistance = 10.5 + speedFrac * 5.0;
    this.camRig.pitch = Math.max(this.camRig.pitch, 0.10);
    this.camRig.update(dt, { x: v.pos.x, y: v.pos.y + 0.9, z: v.pos.z }, { lag: 7 });
    this.camRig.shake = Math.max(this.camRig.shake, v.airborne ? 0.3 : 0);

    this.ui.setSpeed(v.kmh, v.kmh / (v.spec.maxSpeed * 3.6));
    this.save.stat('distance', Math.abs(v.speed) * dt);

    // driving still discovers places and picks things up
    const found = this.map.checkDiscovery(v.pos);
    for (const def of found) {
      this.audio.ui('discover');
      this.ui.discovery(def.title, def.sub);
      this.quests.visited(def.id);
      this.save.addXp(35);
    }
    this.collectibles.update(dt, this.time, v.pos, 3.2);
    this._area = this.map.currentArea(v.pos);

    this.ui.showPrompt('Get out');
    if (interact) this._exitCar();
  }

  /**
   * Put both of you in the car and keep you there.
   *
   * The seats are declared in car space by `makeCarModel`, so this only has to
   * rotate them into the world each frame. Both characters stay visible and
   * sitting — you can see your partner in the passenger seat through the glass,
   * which is the whole point of driving together.
   */
  _seatRiders(dt, v) {
    const seats = v.model.userData.seats;
    if (!seats) {
      this.player.root.visible = false;
      this.companion.root.visible = false;
      return;
    }
    const cs = Math.cos(v.heading), sn = Math.sin(v.heading);
    const place = (who, seat) => {
      const wx = v.pos.x + seat.x * cs + seat.z * sn;
      const wz = v.pos.z - seat.x * sn + seat.z * cs;
      // the seated rig puts the hips at the root, so drop by the seat height
      who.root.visible = true;
      who.root.position.set(wx, v.pos.y + seat.y - 0.74, wz);
      who.root.rotation.set(v.model.rotation.x, v.heading, v.model.rotation.z);
      who.character.update(dt, { speed: 0, grounded: true, sitting: true });
    };
    place(this.player, seats.driver);
    if (this.companion.enabled) place(this.companion, seats.passenger);
    else this.companion.root.visible = false;
  }

  /** You can only be in one thing at a time. */
  _leaveAnyCraft() {
    if (this.driving) this._exitCar();
    if (this.sailing) { this.sailing = null; this.ui.setDriving(false); }
    if (this.flying) { this.flying = null; this.ui.setDriving(false); }
  }

  _enterCar(car) {
    this._leaveAnyCraft();
    const v = car.vehicle;
    if (!v) return;
    this.driving = v;
    v.setLights(this.dayNight.state.night > 0.35);
    this.toggleHandHolding(false);
    this.companion.sitting = true;
    this.camRig.targetDistance = 9;
    this.camRig.snap({ x: v.pos.x, y: v.pos.y, z: v.pos.z }, v.heading + Math.PI);
    this.ui.setDriving(true, car.kind.charAt(0).toUpperCase() + car.kind.slice(1));
    this.audio.ui('open');
    this.save.flag('drove');
    this.quests.activity('drive');
    this.save.addXp(12);
    if (this.companion.enabled) {
      this.quests.fire('activity:coupleDrive');
      this.save.state.stats.coupleDrives = (this.save.state.stats.coupleDrives || 0) + 1;
      this.ui.toast(`${this.companion.name} got in`, 'Riding shotgun.', 'rose');
    }
    if (!this.save.state.flags.drivingTip) {
      this.save.flag('drivingTip');
      this.ui.toast('Driving', 'W/S accelerate, A/D steer, Space brake, E to get out.', 'rose');
    }
  }

  _exitCar() {
    const v = this.driving;
    if (!v) return;
    const out = v.exitPoint();
    const spot = this.world.safeSpot(out.x, out.z);
    this.driving = null;
    this.player.root.visible = true;
    this.companion.root.visible = true;
    this.companion.sitting = false;
    this.player.root.rotation.set(0, this.player.yaw, 0);
    this.player.teleport(spot.x, spot.z, v.heading + Math.PI / 2);
    this.companion.teleportNear(this.player.pos, this.player.yaw);
    this.camRig.targetDistance = 6.2;
    this.camRig.snap(this.player.pos, this.player.yaw + Math.PI);
    this.ui.setDriving(false);
    this.ui.hidePrompt();
    this.audio.ui('close');
  }

  _updateBoat(dt, move, interact, c) {
    const b = this.sailing;
    b.update(dt, { throttle: move.y, steer: move.x, brake: c.brakeHeld });
    this.player.pos.set(b.pos.x, b.model.position.y + 1.0, b.pos.z);
    this.player.yaw = b.heading;
    this._seatRiders(dt, b);

    const frac = Math.abs(b.speed) / b.spec.maxSpeed;
    this.camRig.targetDistance = 11 + frac * 5;
    this.camRig.pitch = Math.max(this.camRig.pitch, 0.09);
    this.camRig.update(dt, { x: b.pos.x, y: b.model.position.y + 1.1, z: b.pos.z }, { lag: 6 });
    this.ui.setSpeed(b.kmh, frac);
    this.save.stat('distance', Math.abs(b.speed) * dt);
    this._area = this.map.currentArea(b.pos);
    this.collectibles.update(dt, this.time, b.pos, 3.4);

    this.ui.showPrompt('Step off the boat');
    if (interact) this._exitBoat();
  }

  /**
   * Flying. The collective is on jump/brake, the cyclic on the movement axes.
   * The camera pulls back and looks down as you climb, because a helicopter is
   * only fun if you can see what you are flying over.
   */
  _updateHeli(dt, move, interact, c, jump) {
    const h = this.flying;
    h.update(dt, {
      throttle: move.y, steer: move.x,
      up: c.brakeHeld || c.keys?.has?.('Space') || jump,
      down: c.isSprinting(),
    });
    this.player.pos.set(h.pos.x, h.pos.y + 1.0, h.pos.z);
    this.player.yaw = h.heading;
    this._seatRiders(dt, h);

    const alt = clamp(h.altitude / 120, 0, 1);
    this.camRig.targetDistance = 14 + alt * 10;
    this.camRig.pitch = Math.max(this.camRig.pitch, 0.12 + alt * 0.12);
    this.camRig.update(dt, { x: h.pos.x, y: h.pos.y + 1.6, z: h.pos.z }, { lag: 5 });
    this.ui.setSpeed(h.kmh, h.kmh / (HELI_SPEC.maxSpeed * 3.6), `${Math.round(h.altitude)} m`);
    this.save.stat('distance', Math.hypot(h.vel.x, h.vel.z) * dt);

    const found = this.map.checkDiscovery(h.pos);
    for (const def of found) {
      this.audio.ui('discover');
      this.ui.discovery(def.title, def.sub);
      this.quests.visited(def.id);
      this.save.addXp(35);
    }
    this._area = this.map.currentArea(h.pos);

    if (h.grounded) {
      this.ui.showPrompt('Get out');
      if (interact) this._exitHeli();
    } else {
      this.ui.showPrompt(`Altitude ${Math.round(h.altitude)} m — land to get out`);
    }
  }

  /**
   * Swap the CSS grade between a neutral day look, a warm golden-hour look and
   * a cool night one. Only touches the DOM when the band actually changes.
   */
  _grade(state) {
    const h = this.dayNight.time;
    const band = state.night > 0.55 ? 'night'
      : (h > 16.8 && h < 20.2) || (h > 5.2 && h < 7.6) ? 'warm' : '';
    if (band === this._gradeBand) return;
    this._gradeBand = band;
    const el = this._gradeEl || (this._gradeEl = document.getElementById('grade'));
    if (el) el.className = band;
  }

  _updateWorldSystems(dt) {
    const focus = (this.driving || this.sailing || this.flying)?.pos
      || (this.player ? this.player.pos : this.camera.position);
    this.dayNight.update(dt, focus, this.camera);
    this.weather.update(dt, focus);
    this.veg.setWind(0.45 + this.weather.values.wind * 0.5);
    this.veg.update(dt);
    this.water.update(dt, this.dayNight.state);
    this.renderer.setClearColor(this.dayNight.state.fogColor, 1);
    this._grade(this.dayNight.state);
    this.world.update(dt, this.time, focus, this.dayNight.state.night);
    this.wildlife.update(dt, focus);
    this.npcSystem.update(dt, focus);
    if (this.traffic) {
      this.traffic.update(dt, focus);
      this.traffic.setNight(this.dayNight.state.night);
    }
    if (this.pedestrians) this.pedestrians.update(dt, focus, this.time);
    if (this.driving) this.driving.setLights(this.dayNight.state.night > 0.35);
    this.remote.update(dt, this.player);
    if (this.voiceChat?.connected) {
      const cam = this.camRig.camera;
      cam.getWorldDirection(this._camFwd || (this._camFwd = new THREE.Vector3()));
      this.voiceChat.setListener(cam.position, this._camFwd);
      for (const [id, p] of this.remote.peers) {
        this.voiceChat.setPeerPosition(id, p.ch.root.position.x, p.ch.root.position.y + 1.5, p.ch.root.position.z);
      }
    }
    if (this.fishing.state === 'waiting' || this.fishing.state === 'active') {
      this.fishing.update(this.dtReal || dt);
      this.ui.updateFishing(this.fishing);
    }

    this._updateAudio(dt);

    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.25;
      this.ui.updateHUD();
      this.ui.setClock(this.dayNight.time, this.weather.icon);
    }
    if (this.map && this.player) {
      const door = this.inInterior ? this.world.interiors.get(this.inInterior)?.exitTo : null;
      const at = door ? { x: door.x, z: door.z } : this.player.pos;
      this.map.drawMinimap(this.ui.el.minimap, at, door ? null : this.companion.pos, this.player.yaw);
    }

    this.autosaveTimer -= dt;
    if (this.autosaveTimer <= 0) {
      this.autosaveTimer = 45;
      if (this.state === 'playing') this.saveGame(false);
    }
  }

  _updateAudio(dt) {
    if (!this.audio.ready) { this.audio.updateBeds(dt); return; }
    const p = this.player.pos;
    const shore = Math.hypot(p.x, p.z);
    const toSea = clamp(1 - Math.abs(shore - this.terrain.shoreRadius(Math.atan2(p.z, p.x))) / 90, 0, 1);
    const inInterior = !!this.inInterior;
    const area = this._area;
    const night = this.dayNight.state.night;

    this.audio.amb('waves', inInterior ? 0.02 : toSea * 0.5);
    this.audio.amb('wind', inInterior ? 0.01 : 0.05 + (p.y / 90) * 0.16 + this.weather.values.wind * 0.05);
    this.audio.amb('forest', inInterior ? 0 : (area && area.id === 'forest' ? 0.1 : 0.02) * (1 - night));
    this.audio.amb('rain', this.weather.values.rain * (inInterior ? 0.06 : 0.26));
    this.audio.amb('cafe', inInterior === 'cafe' ? 0.1 : 0);
    const fireD = area && area.id === 'campsite' ? 1 : 0;
    this.audio.amb('fire', fireD * 0.12);
    const waterD = area && (area.id === 'waterfall' || area.id === 'lake') ? 1 : 0;
    this.audio.amb('water', waterD * 0.14);
    this.audio.updateBeds(dt);
    this.audio.updateMusic(dt, night > 0.5);
  }

  /* ------------------------------------------------------ interaction */

  _proximity(isSitting) {
    if (isSitting) { this.ui.showPrompt('Stand up'); return; }
    const it = this.interaction.update(this.player.pos, this.player.yaw);
    this._prompt = it;              // also drives where the player looks
    if (it) this.ui.showPrompt(it.label);
    else this.ui.hidePrompt();
  }

  _tryInteract() {
    const it = this.interaction.consume();
    if (!it) return;
    this.audio.ui('click');
    const d = it.data || {};
    switch (it.kind) {
      case 'sit': case 'sunset': case 'campfire': this._sit(it); break;
      case 'enter': this._enterInterior(d.interior); break;
      case 'exit': this._exitInterior(d.to); break;
      case 'climb': this._verticalTravel(d.toY, 'Climbing...'); break;
      case 'descend': this._verticalTravel(d.toY, 'Climbing down...'); break;
      case 'order': this._orderDrink(); break;
      case 'fish': this._startFishing(d.name); break;
      case 'boat': this._enterBoat(it); break;
      case 'heli': this._enterHeli(it); break;
      case 'date': this._missionGiver(it.data?.giver, it.data?.giver); break;
      case 'chest': this._openChest(it); break;
      case 'picnic': this._picnic(it); break;
      case 'telescope': this._telescope(d.name); break;
      case 'fountain': this._fountain(d.name); break;
      case 'shop': this.ui.openOverlay('shop'); break;
      case 'photo': this.togglePhotoMode(true); break;
      case 'drive': this._enterCar(d.car); break;
      case 'talk': this._talk(d.npc); break;
      default:
        this.ui.toast('Nothing happens here yet');
    }
  }

  _sit(it) {
    const d = it.data;
    const seat = d.seat || { x: 0, y: 0.5, z: 0 };
    const yaw = d.yaw ?? this.player.yaw;
    const base = d.offset || { x: it.x, z: it.z };
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const sx = base.x + (seat.x || 0) * cos + (seat.z || 0) * sin;
    const sz = base.z - (seat.x || 0) * sin + (seat.z || 0) * cos;
    const sy = (it.y ?? this.terrain.height(sx, sz)) + (seat.y || 0.5);
    this.player.sit({ x: sx, y: sy - 0.42, z: sz, yaw });
    this.sitting = it;
    this.player.emote('sit', 1e9);

    // companion joins for couple spots
    if (d.couple || it.kind === 'sunset' || it.kind === 'campfire') {
      const ox = sx - cos * 0 + Math.cos(yaw + Math.PI / 2) * 0.75;
      const oz = sz + Math.sin(yaw + Math.PI / 2) * 0.75;
      this.companion.sitAt(ox, sy - 0.42, oz, yaw);
      this.save.stat('dates', 1);
    }
    if (it.kind === 'sunset') {
      const h = this.dayNight.time;
      if (h > 17.4 && h < 20.2) {
        this.save.flag('watchedSunset');
        this.ui.toast('What a view', 'The sun is setting over the water.', 'gold');
        this.save.add('hearts', 5);
        this.save.addXp(20);
      } else {
        this.ui.toast('Lovely spot', 'Come back around 18:30 for the sunset.');
      }
      this.quests.activity('sunset');
    }
    if (it.kind === 'campfire') {
      this.quests.activity('campfire');
      this.ui.toast('Warm and quiet', 'The fire crackles.', 'rose');
      this.save.addXp(15);
    }
    this.quests.checkAchievements();
    this.ui.updateHUD();
  }

  _standUp() {
    this.player.stand();
    this.companion.stand();
    this.player.character.emote = null;
    this.sitting = null;
  }

  async _enterInterior(id) {
    const info = this.world.interiors.get(id);
    if (!info) return;
    await this.ui.fade(true, 380);
    this.player.interior = true;
    this.companion.interior = true;
    this.player.teleport(info.spawn.x, info.spawn.z, info.spawn.yaw);
    this.player.pos.y = info.spawn.y;
    this.player.root.position.copy(this.player.pos);
    this.companion.teleportNear(this.player.pos, info.spawn.yaw);
    this.camRig.snap(this.player.pos, info.spawn.yaw + Math.PI);
    this.inInterior = id;
    this.player.interior = true;
    this.companion.interior = true;
    await this.ui.fade(false, 380);
    if (id === 'cafe') {
      this.ui.toast('HelloCouple Café', 'Order at the counter, then take a seat.', 'rose');
    }
  }

  async _exitInterior(id) {
    const info = this.world.interiors.get(id);
    const to = info?.exitTo;
    await this.ui.fade(true, 380);
    this.player.interior = false;
    this.companion.interior = false;
    if (to) {
      this.player.teleport(to.x, to.z, to.yaw ?? 0);
      this.companion.teleportNear(this.player.pos, this.player.yaw);
      this.camRig.snap(this.player.pos, this.player.yaw + Math.PI);
    }
    this.inInterior = null;
    await this.ui.fade(false, 380);
  }

  async _verticalTravel(toY, label) {
    await this.ui.fade(true, 380);
    this.player.pos.y = toY;
    this.player.vel.set(0, 0, 0);
    this.player.root.position.copy(this.player.pos);
    this.companion.pos.set(this.player.pos.x - 1.4, toY, this.player.pos.z);
    this.companion.root.position.copy(this.companion.pos);
    this.camRig.snap(this.player.pos, this.player.yaw + Math.PI);
    await this.ui.fade(false, 380);
    this.ui.toast(label);
  }

  _orderDrink() {
    this.ui.modal({
      emoji: '☕', title: 'What can we get you?',
      text: 'Everything on the menu is on the house today.',
      choices: DRINKS.map(d => ({
        emoji: d.emoji, name: d.name,
        action: () => {
          this.ui.closeModal();
          this.save.stat('drinksOrdered', 1);
          this.save.add('hearts', 3);
          this.save.addXp(12);
          this.quests.activity('drink');
          this.player.emote('drink', 3.2);
          this.companion.emote('drink', 3.2);
          this.audio.ui('quest');
          this.ui.toast(`One ${d.name}`, '+3 Hearts · +12 XP', 'rose');
          this.ui.updateHUD();
        },
      })),
      buttons: [{ label: 'Maybe later', ghost: true, action: () => this.ui.closeModal() }],
    });
  }

  _startFishing(name) {
    this.player.emote('fish', 1e9);
    this.fishing.start(this.save.state.stats.fishCaught || 0);
    this.ui.showFishing(this,
      () => {
        const r = this.fishing.strike();
        if (!r) return;
        if (r.success) {
          this.save.stat('fishCaught', 1);
          this.save.flag('hasFish');
          this.save.add('coins', r.fish.coins);
          this.save.addXp(r.fish.xp);
          this.quests.activity('fish');
          this.audio.ui('quest');
          this.ui.setFishingMessage(`${r.fish.emoji} ${r.fish.name}! +${r.fish.coins} coins`);
          this.ui.toast(`Caught a ${r.fish.name}`, `+${r.fish.coins} Coins · +${r.fish.xp} XP`, 'gold');
        } else {
          this.audio.splash();
          this.ui.setFishingMessage(r.reason);
        }
        this.ui.updateHUD();
        setTimeout(() => {
          if (this.fishing.state === 'done') this.fishing.start(this.save.state.stats.fishCaught || 0);
        }, 1400);
      },
      () => {
        this.fishing.cancel();
        this.player.character.emote = null;
        this.ui.closeModal();
      });
  }

  _enterBoat(it) {
    const b = it.data?.boat?.craft;
    if (!b) return;
    this._leaveAnyCraft();
    this.toggleHandHolding(false);
    this.sailing = b;
    this.companion.sitting = true;
    this.camRig.targetDistance = 11;
    this.camRig.snap({ x: b.pos.x, y: b.model.position.y, z: b.pos.z }, b.heading + Math.PI);
    this.ui.setDriving(true, 'Boat');
    this.audio.ui('open');
    this.save.flag('sailed');
    this.quests.activity('boat');
    this.save.addXp(14);
    if (this.companion.enabled) this.quests.fire('activity:coupleDrive');
    if (!this.save.state.flags.boatTip) {
      this.save.flag('boatTip');
      this.ui.toast('Out on the water', 'W/S for throttle, A/D to steer, Space to slow. E to step off near land.', 'rose');
    }
  }

  _exitBoat() {
    const b = this.sailing;
    if (!b) return;
    const out = b.exitPoint();
    if (this.terrain.height(out.x, out.z) < 0.6) {
      this.ui.toast('Too far out', 'Bring her closer to shore before stepping off.');
      return;
    }
    this._leaveCraft(this.world.safeSpot(out.x, out.z), b.heading + Math.PI / 2);
    this.sailing = null;
  }

  _enterHeli(it) {
    const h = it.data?.heli?.craft;
    if (!h) return;
    this._leaveAnyCraft();
    this.toggleHandHolding(false);
    this.flying = h;
    this.companion.sitting = true;
    this.camRig.targetDistance = 14;
    this.camRig.snap({ x: h.pos.x, y: h.pos.y, z: h.pos.z }, h.heading + Math.PI);
    this.ui.setDriving(true, 'Helicopter');
    this.audio.ui('open');
    this.save.flag('flew');
    this.quests.fire('activity:fly');
    this.save.addXp(20);
    if (this.companion.enabled) this.quests.fire('activity:coupleDrive');
    if (!this.save.state.flags.flyTip) {
      this.save.flag('flyTip');
      this.ui.toast('Wait for the rotor', 'Space to climb, Shift to descend, W/S to fly, A/D to turn. Land before you get out.', 'rose');
    }
  }

  _exitHeli() {
    const h = this.flying;
    if (!h) return;
    if (!h.grounded) { this.ui.toast('Still airborne', 'Land first.'); return; }
    const out = h.exitPoint();
    this._leaveCraft(this.world.safeSpot(out.x, out.z), h.heading + Math.PI / 2);
    this.flying = null;
  }

  /** Shared tail end of getting out of anything. */
  _leaveCraft(spot, yaw) {
    this.player.root.visible = true;
    this.companion.root.visible = true;
    this.companion.sitting = false;
    this.player.root.rotation.set(0, yaw, 0);
    this.player.teleport(spot.x, spot.z, yaw);
    this.companion.teleportNear(this.player.pos, this.player.yaw);
    this.camRig.snap(this.player.pos, this.player.yaw + Math.PI);
    this.ui.setDriving(false);
    this.ui.hidePrompt();
    this.audio.ui('close');
  }

  _openChest(it) {
    const g = it.data.group;
    if (g && g.userData.lid) {
      const lid = g.userData.lid;
      const start = performance.now();
      const anim = () => {
        const t = Math.min(1, (performance.now() - start) / 600);
        lid.rotation.x = -1.9 * (1 - Math.pow(1 - t, 3));
        if (t < 1) requestAnimationFrame(anim);
      };
      anim();
    }
    const r = it.data.reward || {};
    if (r.coins) this.save.add('coins', r.coins);
    if (r.hearts) this.save.add('hearts', r.hearts);
    this.save.addXp(60);
    this.audio.ui('quest');
    this.ui.modal({
      emoji: '🧰', title: it.data.name || 'Treasure!',
      text: `You found ${r.coins || 0} coins and ${r.hearts || 0} hearts.`,
      buttons: [{ label: 'Wonderful', primary: true, action: () => this.ui.closeModal() }],
    });
    this.ui.updateHUD();
    this.quests.checkAchievements();
  }

  _picnic(it) {
    this.quests.activity('picnic');
    this.save.stat('dates', 1);
    this.save.add('hearts', 8);
    this.save.addXp(25);
    this.player.emote('heart', 3.4);
    this.companion.emote('heart', 3.4);
    this.audio.ui('quest');
    this.ui.modal({
      emoji: '🧺', title: 'A picnic in the meadow',
      text: 'Sandwiches, lemonade and absolutely nowhere to be.',
      buttons: [{ label: 'Perfect', primary: true, action: () => this.ui.closeModal() }],
    });
    this.ui.updateHUD();
  }

  _telescope(name) {
    const spots = LOCATIONS.filter(l => this.save.isDiscovered(l.id)).map(l => l.name);
    const unseen = LOCATIONS.filter(l => !this.save.isDiscovered(l.id) && !l.secret);
    const hint = unseen.length
      ? `You can just make out ${unseen[0].name} from here.`
      : 'You can see every corner of the island from here.';
    this.save.addXp(10);
    this.ui.modal({
      emoji: '🔭', title: name || 'Through the telescope',
      text: `${hint}${spots.length ? ` Places you know: ${spots.length}.` : ''}`,
      buttons: [
        { label: 'Take a photo', primary: true, action: () => { this.ui.closeModal(); this.togglePhotoMode(true); } },
        { label: 'Step back', ghost: true, action: () => this.ui.closeModal() },
      ],
    });
  }

  _fountain(name) {
    if (this.save.state.coins < 1) {
      this.ui.toast('No coins to spare', 'Find some around the island first.');
      return;
    }
    this.save.spend('coins', 1);
    this.save.add('hearts', 2);
    this.save.addXp(6);
    this.audio.pickup('heart');
    this.ui.toast('You made a wish', '−1 Coin · +2 Hearts', 'rose');
    this.player.emote('heart', 2.4);
    this.ui.updateHUD();
  }

  _talk(npc) {
    this.missions?.notify('talk', { id: npc?.id || npc?.def?.id });
    if (!npc) return;
    this.dialogue.start(npc);
    this.save.addXp(4);
  }

  _onCollect(item) {
    const def = COLLECTIBLES[item.type] || COLLECTIBLES.coin;
    this.save.state.counts[item.type] = (this.save.state.counts[item.type] || 0) + 1;
    for (const [k, v] of Object.entries(def.value || {})) {
      if (k === 'coins') this.save.add('coins', v);
      else if (k === 'hearts') this.save.add('hearts', v);
      else if (k === 'shells' || k === 'flowers' || k === 'stars') { /* counted above */ }
    }
    this.save.stat('totalCollected', 1);
    this.save.addXp(def.xp);
    this.quests.collected(item.type);
    this.audio.pickup(item.type === 'star' ? 'star' : item.type === 'heart' ? 'heart' : 'coin');
    this.ui.toast(`${def.emoji} ${def.label.replace(/s$/, '')} collected`, `+${def.xp} XP`, item.type === 'star' ? 'gold' : '');
    this.ui.updateHUD();
  }

  /* ---------------------------------------------------- photo / menus */

  togglePhotoMode(on) {
    const want = on !== undefined ? on : !this.photoMode;
    if (want === this.photoMode) return;
    this.photoMode = want;
    document.body.classList.toggle('photo', want);
    this.ui.setPhotoMode(want);
    if (want) {
      this.freeCam.enter(this.camera.position, this.camRig.yaw + Math.PI, -this.camRig.pitch);
      this.freeCam.fov = this.camera.fov;
      this.quests.activity('photoMode');
    } else {
      this.camera.fov = 58;
      this.camera.updateProjectionMatrix();
      this.camRig.snap(this.player.pos);
    }
  }

  _updatePhoto(dt, look, zoom) {
    const c = this.controls;
    const move = c.getMove();
    this.freeCam.update(dt, {
      move: { x: move.x, y: move.y },
      look,
      up: c.keys.has('Space'),
      down: c.keys.has('ControlLeft') || c.keys.has('KeyC'),
      fast: c.isSprinting(),
      zoom,
    });
    if (this.player) this.player.character.update(dt, { speed: 0, grounded: true, sitting: false });
  }

  takePhoto() {
    this.renderer.render(this.scene, this.camera);
    let url = null;
    try { url = this.canvas.toDataURL('image/png'); } catch { url = null; }
    this.save.stat('photos', 1);
    this.save.flag('hasPhoto');
    this.save.addXp(15);
    this.quests.activity('photo');
    this.audio.camera();
    if (url) {
      this.ui.modal({
        title: 'Photo taken', text: 'Save it, or keep exploring.',
        html: `<img src="${url}" alt="Photo" style="width:100%;border-radius:12px;margin-bottom:14px" />`,
        buttons: [
          {
            label: 'Download', primary: true, action: () => {
              const a = document.createElement('a');
              a.href = url;
              a.download = `hellocouple-world-${Date.now()}.png`;
              document.body.appendChild(a);
              a.click();
              a.remove();
            },
          },
          { label: 'Close', ghost: true, action: () => this.ui.closeModal() },
        ],
      });
    } else {
      this.ui.toast('Photo taken', '+15 XP', 'rose');
    }
    this.ui.updateHUD();
  }

  playEmote(id) {
    this.missions?.notify('emote', { id });
    this.player.emote(id, id === 'dance' ? 5.5 : 2.8);
    if (Math.random() < 0.7) this.companion.emote(id, id === 'dance' ? 5.5 : 2.8);
    this.save.addXp(2);
  }

  async fastTravel(id) {
    if (this.driving) this._exitCar();
    else if (this.sailing) this._exitBoat();
    else if (this.flying) this._exitHeli();
    const loc = this.locations.get(id);
    const def = LOCATIONS.find(l => l.id === id);
    if (!loc || !def || !this.save.isDiscovered(id) || !def.fastTravel) {
      this.ui.toast('You have not found that place yet');
      this.audio.ui('error');
      return;
    }
    this.ui.closeOverlay();
    this.ui.closeModal();
    await this.ui.fade(true, 420);
    this.inInterior = null;
    this.player.interior = false;
    this.companion.interior = false;
    this.sitting = null;
    this.player.stand();
    this.companion.stand();
    const want = this.world.arrivals.get(id) || { x: loc.x, z: loc.z, yaw: null };
    const spot = this.world.safeSpot(want.x, want.z);
    this.player.teleport(spot.x, spot.z, want.yaw ?? Math.atan2(-loc.x, -loc.z));
    this.companion.teleportNear(this.player.pos, this.player.yaw);
    this.camRig.snap(this.player.pos, this.player.yaw + Math.PI);
    await new Promise(r => setTimeout(r, 160));
    await this.ui.fade(false, 420);
    this.ui.discovery(def.title, def.sub);
    this.audio.ui('discover');
  }

  refreshLook() {
    this.player?.setLook(this.save.state.look);
    this.companion?.setLook(this.save.state.companionLook);
  }

  /** Drop everything cached for this device, from Settings. */
  async clearWorldCache() {
    return CACHE.clear();
  }

  applySetting(key, value) {
    const s = this.save.settings;
    if (key === 'quality') {
      s.quality = value;
      const q = this._pickQuality();
      this._applyQuality(q);
      if (this.perf) {
        const a = !value || value === 'auto';
        this.perf.setRange(a ? 'potato' : value, a ? 'high' : value);
        this.perf.enabled = true;
      }
      const auto = !value || value === 'auto';
      this.ui.toast('Graphics', auto
        ? 'Auto — the game will tune itself to keep the frame rate steady.'
        : `Set to ${q.name}. Terrain and tree detail apply on the next visit.`);
    } else if (key === 'cacheWorld') {
      s.cacheWorld = value === 'on';
      if (!s.cacheWorld) CACHE.clear();
      this.ui.toast('Fast loading', s.cacheWorld
        ? 'The island will be remembered after this visit.'
        : 'Turned off. The island is rebuilt from scratch every time.');
    } else if (key === 'shadows') {
      s.shadows = value === 'on';
      this.renderer.shadowMap.enabled = s.shadows && this.quality.shadows;
      if (this.dayNight) this.dayNight.sun.castShadow = this.renderer.shadowMap.enabled;
      this.scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
    } else if (key === 'showFps') {
      s.showFps = value === 'on';
      this.ui.setFps('', s.showFps);
    } else if (key === 'invertY') {
      s.invertY = value === 'on';
      this.controls.invertY = s.invertY;
    } else if (key === 'pointerLock') {
      s.pointerLock = value === 'on';
      this.controls.enablePointerLock(s.pointerLock && !this.touch);
      if (!s.pointerLock) this.controls.releasePointerLock();
    } else if (key === 'weather') {
      if (value === 'auto') { this.weather.auto = true; }
      else { this.weather.auto = false; this.weather.set(value); }
    } else if (key === 'sensitivity') {
      s.sensitivity = parseFloat(value);
      this.controls.sensitivity = s.sensitivity;
    } else if (key === 'master' || key === 'music' || key === 'sfx') {
      s[key] = parseFloat(value);
      this.audio.setVolume(key, s[key]);
    }
    this.save.saveSettings();
  }

  toggleFullscreen() {
    const el = document.documentElement;
    if (!document.fullscreenElement) {
      (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el).catch(() => {
        this.ui.toast('Fullscreen unavailable', 'The page may be embedded without permission.');
      });
    } else {
      document.exitFullscreen?.();
    }
  }

  onOverlayChange(open) {
    this.controls.enabled = !open;
    if (open) {
      this.controls.reset();
      this.controls.releasePointerLock();
      this.ui.hidePrompt();
    }
  }

  async saveGame(announce) {
    if (!this.player) return;
    this.save.state.position = {
      x: this.player.pos.x, z: this.player.pos.z, y: this.player.pos.y, yaw: this.player.yaw,
    };
    this.save.state.world = { time: this.dayNight.time, weather: this.weather.next };
    const ok = await this.save.save();
    if (announce) {
      this.audio.ui(ok ? 'click' : 'error');
      this.ui.toast(ok ? 'Game saved' : 'Could not save', ok ? 'Progress stored in this browser' : 'Storage is unavailable');
    }
  }

  async resetProgress() {
    await this.save.reset();
    this.collectibles?.resetAll();
    this.quests = new QuestSystem(this.save);
    this._setupMissions();
    this._wireProgressEvents();
    this.refreshLook();
    this.ui.updateHUD();
    this.ui.renderOverlay();
    this.ui.toast('Progress reset', 'A fresh start on the island.');
  }

  async toMainMenu() {
    await this.saveGame(false);
    this.ui.closeOverlay();
    this.ui.closeModal();
    await this.ui.fade(true, 380);
    this.running = false;
    this.state = 'menu';
    this._teardown();
    this.ui.hideHUD();
    this.ui.showMenu(true);
    await this.ui.fade(false, 380);
  }

  /**
   * Release the whole world so the next run starts clean.
   *
   * Shared assets survive: the material registry, the procedural texture cache
   * and any geometry flagged `userData.shared` (the unit primitives and the
   * character capsules) are reused by every build.
   */
  _teardown() {
    this.collectibles?.dispose();
    this.traffic?.dispose();
    this.pedestrians?.dispose();
    this.wildlife?.dispose();
    this.water?.dispose();
    this.veg?.dispose();
    this.dayNight?.dispose();
    this.weather?.dispose();
    this.terrain?.dispose();
    this.remote?.dispose();
    this.voice?.dispose();
    this.voiceChat?.disconnect();

    const keep = new Set(Object.values(materials()));
    this.scene.traverse(o => {
      const g = o.geometry;
      if (g && !g.userData.shared) g.dispose?.();
      if (o.material) {
        const list = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of list) if (m && !keep.has(m)) m.dispose();
      }
    });
    for (let i = this.scene.children.length - 1; i >= 0; i--) this.scene.remove(this.scene.children[i]);

    this.scene.fog = null;
    this.physics?.clear();
    this.renderer.renderLists?.dispose?.();
    this.driving = null;
    this.traffic = null;
    this.pedestrians = null;
    this.vehicles = null;
    this.player = null;
    this.companion = null;
    this.world = null;
    this.map = null;
    this.collectibles = null;
  }

  /* ------------------------------------------------------------- keys */

  _onKey(code) {
    if (this.state !== 'playing') return;
    if (code === 'Escape') {
      if (this.ui.briefOpen) return this.ui.closeBrief();
      if (this.ui.wheelOpen) return this.ui.toggleEmoteWheel(false);
      if (this.ui.modalOpen) return this.ui.closeModal();
      if (this.dialogue?.isActive) return this.dialogue.end();
      if (this.photoMode) return this.togglePhotoMode(false);
      if (this.ui.overlayOpen) return this.ui.closeOverlay();
      return this.ui.openOverlay('map');
    }
    if (this.ui.anyOverlayOpen && code !== 'KeyP') return;
    if (code === 'KeyM') this.ui.openOverlay('map');
    else if (code === 'KeyJ' || code === 'KeyQ') this.ui.openOverlay('quests');
    else if (code === 'KeyI') this.ui.openOverlay('inventory');
    else if (code === 'KeyC') this.ui.toggleEmoteWheel();
    else if (code === 'KeyP') this.togglePhotoMode();
    else if (code === 'KeyF') this.toggleFullscreen();
    else if (code === 'KeyH') this.toggleHandHolding();
  }
}

/* ------------------------------------------------------------- start */

function start() {
  try {
    const test = document.createElement('canvas');
    const gl = test.getContext('webgl2') || test.getContext('webgl');
    if (!gl) throw new Error('WebGL is not available');
    window.HelloCoupleWorld = new Game();
  } catch (err) {
    console.error(err);
    const el = document.getElementById('loading-screen');
    document.getElementById('main-menu')?.classList.add('hidden');
    if (el) {
      el.classList.remove('hidden');
      el.innerHTML = `<div class="loading-inner">
        <div class="brand-mark">HelloCouple</div>
        <h1 class="loading-title">HelloCouple World</h1>
        <p class="loading-sub">This browser could not start WebGL.<br/>Try a recent Chrome, Edge, Firefox or Safari with hardware acceleration enabled.</p>
      </div>`;
    }
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
