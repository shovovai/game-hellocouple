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
import { Wildlife } from './animals.js';
import { SaveManager } from './save.js';
import { QuestSystem } from './quests.js';
import { Shop } from './shop.js';
import { Inventory } from './inventory.js';
import { MapSystem } from './map.js';
import { FishingGame, BoatRide } from './minigames.js';
import { AudioEngine } from './audio.js';
import { UI } from './ui.js';
import { RemotePlayers, NullNetwork } from './net.js';
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
    this.renderer.toneMappingExposure = 1.05;
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

    const hm = this.terrain.buildHeightmap();
    await this._drain(hm, (t) => this.ui.setLoading(0.02 + t * 0.22, 'Shaping the coastline...'));

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
    await this._drain(gen, (t, label) => this.ui.setLoading(0.3 + t * 0.55, label));

    // ---- actors ----
    this.ui.setLoading(0.88, 'Waking everyone up...');
    await this._frame();

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
    this.boat = new BoatRide(this.terrain, WORLD.seaLevel);
    this.remote = new RemotePlayers(this.scene, NullNetwork);

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
    await new Promise(r => setTimeout(r, 220));
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
      if (now - last > 24) { await this._frame(); last = performance.now(); }
    }
    await this._frame();
  }

  _frame() { return new Promise(r => requestAnimationFrame(() => r())); }

  _wireProgressEvents() {
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

    this._updateWorldSystems(dt);
    this.renderer.render(this.scene, this.camera);
  }

  _updateGameplay(dt, look, zoom) {
    const c = this.controls;
    if (look.x || look.y) this.camRig.rotate(look.x, look.y);
    if (zoom) this.camRig.zoom(zoom);

    const move = c.getMove();
    const jump = c.consumeJump();
    const interact = c.consumeInteract();

    if (this.boat.active) {
      this._updateBoat(dt, move, interact);
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

    this.companion.update(dt, this.player.pos, this.player.speed);
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
    if (area && (area.id === 'beach' || area.id === 'sunsetBeach')) this.save.stat('timeAtBeach', dt);
    this.save.stat('playTime', dt);

    this.collectibles.update(dt, this.time, this.player.pos);
  }

  _updateBoat(dt, move, interact) {
    this.boat.update(dt, { x: move.x, y: move.y });
    const p = this.boat.pos;
    this.player.pos.set(p.x, WORLD.seaLevel + 1.0, p.z);
    this.player.yaw = this.boat.heading;
    this.player.root.position.copy(this.player.pos);
    this.player.root.rotation.y = this.boat.heading;
    this.player.character.update(dt, { speed: 0, grounded: true, sitting: true });
    this.companion.pos.set(p.x - Math.sin(this.boat.heading) * 1.2, WORLD.seaLevel + 1.0, p.z - Math.cos(this.boat.heading) * 1.2);
    this.companion.root.position.copy(this.companion.pos);
    this.companion.root.rotation.y = this.boat.heading;
    this.companion.character.update(dt, { speed: 0, grounded: true, sitting: true });
    this.camRig.update(dt, this.player.pos, { lag: 5 });
    this.ui.showPrompt('Leave the boat');
    if (interact) this._exitBoat();
  }

  _updateWorldSystems(dt) {
    const focus = this.player ? this.player.pos : this.camera.position;
    this.dayNight.update(dt, focus, this.camera);
    this.weather.update(dt, focus);
    this.veg.setWind(0.45 + this.weather.values.wind * 0.5);
    this.veg.update(dt);
    this.water.update(dt, this.dayNight.state);
    this.renderer.setClearColor(this.dayNight.state.fogColor, 1);
    this.world.update(dt, this.time, focus, this.dayNight.state.night);
    this.wildlife.update(dt, focus);
    this.npcSystem.update(dt, focus);
    this.remote.update(dt, this.player);
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
      case 'chest': this._openChest(it); break;
      case 'picnic': this._picnic(it); break;
      case 'telescope': this._telescope(d.name); break;
      case 'fountain': this._fountain(d.name); break;
      case 'shop': this.ui.openOverlay('shop'); break;
      case 'photo': this.togglePhotoMode(true); break;
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
    const b = it.data.boat;
    if (!b) return;
    this.boat.enter(b, b.position.x, b.position.z, it.data.ang || 0);
    this.ui.toast('Boat', 'Steer with the movement keys. Press E to step off.', 'rose');
    this.save.addXp(10);
  }

  _exitBoat() {
    const b = this.boat.exit();
    // step out onto the nearest walkable ground
    let bestX = this.player.pos.x, bestZ = this.player.pos.z, found = false;
    for (let r = 3; r < 60 && !found; r += 2.5) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const x = this.boat.pos.x + Math.cos(a) * r;
        const z = this.boat.pos.z + Math.sin(a) * r;
        if (this.terrain.height(x, z) > 0.6) { bestX = x; bestZ = z; found = true; break; }
      }
    }
    this.player.teleport(bestX, bestZ, this.player.yaw);
    this.companion.teleportNear(this.player.pos, this.player.yaw);
    this.camRig.snap(this.player.pos, this.player.yaw + Math.PI);
    this.ui.hidePrompt();
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
    this.player.emote(id, id === 'dance' ? 5.5 : 2.8);
    if (Math.random() < 0.7) this.companion.emote(id, id === 'dance' ? 5.5 : 2.8);
    this.save.addXp(2);
  }

  async fastTravel(id) {
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

  applySetting(key, value) {
    const s = this.save.settings;
    if (key === 'quality') {
      s.quality = value;
      const q = this._pickQuality();
      this._applyQuality(q);
      this.ui.toast('Graphics', `Set to ${q.name}. Some changes apply on the next visit.`);
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
    this.wildlife?.dispose();
    this.water?.dispose();
    this.veg?.dispose();
    this.dayNight?.dispose();
    this.weather?.dispose();
    this.terrain?.dispose();
    this.remote?.dispose();

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
