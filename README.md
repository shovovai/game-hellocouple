# HelloCouple World

An open-world island city that runs in a browser tab. Drive through downtown
traffic, park up and walk the sidewalks, then head out along the coast road to
find hidden beaches, a waterfall, a lighthouse and a secret grove — with a
companion who follows you everywhere.

The island is about 1.2 km across. Downtown is a 25-block grid of towers,
mid-rise and shopfronts with working signals, pedestrians and moving traffic;
outside it are beaches, forest, a lake, a pier, a campsite and Sunset Point,
joined by a ring road you can drive.

Built with HTML5, CSS3, ES modules, WebGL and Three.js. No backend, no build
step, no external assets, no tracking.

---

## 1. Running it locally

The game is plain static files, but it uses ES modules, so it must be served
over HTTP (opening `index.html` from the filesystem will not work).

```bash
git clone https://github.com/shovovai/game-hellocouple.git
cd game-hellocouple

# any static server works — pick one
python3 -m http.server 8080
npx serve -l 8080
php -S 127.0.0.1:8080
```

Then open <http://127.0.0.1:8080/>.

There is nothing to install and nothing to build. Three.js is vendored at
`vendor/three/three.module.min.js` and mapped with an import map in
`index.html`, so the game also works completely offline.

## 2. Deploying

Copy the repository contents anywhere that serves static files:

| Host | How |
| --- | --- |
| Apache / Nginx | drop the folder in the web root |
| Laravel / Symfony | drop it in `public/hellocouple-world/` → served at that path |
| Netlify / Vercel / Cloudflare Pages | set the folder as the publish directory |
| GitHub Pages | commit the folder, enable Pages |
| S3 / any CDN | upload the folder, serve `index.html` as the index |

Requirements: the server must send `.js` as `text/javascript` (every modern
server does) and ideally enable gzip/brotli — the vendored Three.js build
compresses to roughly 170 KB.

No server-side code, database, environment variable or API key is involved.

## 3. Embedding in HelloCouple

The game is designed to live at **HelloCouple → Play → HelloCouple World**.

```html
<iframe
  src="/hellocouple-world/index.html"
  width="100%"
  height="800"
  style="border:0;display:block;border-radius:16px;overflow:hidden"
  allow="fullscreen; autoplay; pointer-lock; accelerometer; gyroscope"
  allowfullscreen
  title="HelloCouple World"
></iframe>
```

Notes for the embedding page:

- **`allow="pointer-lock"`** lets the mouse capture work. Without it the game
  automatically falls back to drag-to-look, so it still plays fine.
- **`allow="fullscreen"` + `allowfullscreen`** are needed for the fullscreen
  button; if fullscreen is refused, the game shows a toast instead of failing.
- **Audio** only starts after the first click or key press (browser policy).
  This is handled internally — no action needed from the host page.
- **Saves** use `localStorage` scoped to the iframe's origin. Serving the game
  from the same origin as HelloCouple keeps progress attached to the site.
- The canvas resizes to the iframe, so a percentage width and a fixed height are
  enough. A height of 700–900 px reads best; the UI also works down to phone
  size.

To render it inline instead of in an iframe, serve `index.html`'s body markup in
your page and load `css/style.css` plus `js/main.js` as a module — the game only
touches elements inside `#game-root`.

## 4. Controls

### Desktop

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` / arrow keys | Move |
| `E` at a car | Get in and drive (`E` again to get out) |
| Mouse move (or drag) | Look around |
| Mouse wheel | Zoom the camera in and out |
| `Shift` | Sprint |
| `Space` | Jump |
| `E` | Interact / sit / stand |
| `M` | Map and fast travel |
| `J` or `Q` | Quests |
| `I` | Inventory |
| `C` | Emote wheel |
| `H` | Hold your partner's hand (and let go) |
| `V` (hold) | Push to talk — speak, and they answer out loud |
| `P` | Photo mode |
| `F` | Fullscreen |
| `Esc` | Pause menu, or close whatever is open |

While driving: `W`/`S` accelerate and reverse, `A`/`D` steer, `Space` brakes,
`E` gets out. The camera pulls back as you gain speed and the speedometer
appears bottom-right.

In photo mode: `W`/`A`/`S`/`D` fly, `Space` rises, `Ctrl` descends, `Shift`
flies faster, the wheel changes the field of view.

### Mobile and tablet

Touch controls appear automatically on touch devices:

- **Left half** — virtual joystick (push it to the edge to sprint).
- **Right half** — swipe to look, pinch to zoom.
- **Buttons** — `E` interact, `⤒` jump (brake while driving), `⚡` sprint
  toggle, `⚭` hold hands, `🎙` hold to talk, `▦` map, `☰` menu, `⎋` get out of
  the car.

## 5. Performance settings

Settings → Graphics. `Auto` picks a preset from the device (CPU cores, memory,
touch capability); Low / Medium / High override it.

| | Low | Medium | High |
| --- | --- | --- | --- |
| Pixel ratio cap | 1.0 | 1.35 | 2.0 |
| Terrain mesh | 192² | 288² | 416² |
| Shadows | 1024 px | 2048 px | 3072 px |
| Shadow distance | 130 m | 210 m | 280 m |
| Tree density | 45 % | 75 % | 100 % |
| Grass | off | 55 % | 100 % |
| Traffic cars | 10 | 22 | 34 |
| Pedestrians | 12 | 26 | 40 |
| Water shader | cheap | normal | full |
| Draw distance | 900 m | 1400 m | 2000 m |

Independent of the preset, the game always:

- merges static props into batches per material **and** per 190 m cell, so draw
  calls stay low without breaking frustum culling;
- splits the terrain into 8×8 chunks so most of a 1.2 km island is culled
  rather than drawn (normals come from the heightfield, so there are no seams);
- draws all traffic with InstancedMesh grouped by car kind and material role —
  a whole city of cars costs about twenty draw calls, and forty pedestrians
  nine;
- merges each character's ~70 primitives down to ~30 by joint and material, so
  a dozen people on screen cost a few dozen draws rather than eight hundred;
- draws all vegetation with `InstancedMesh`, bucketed the same way;
- keeps a pool of 5–7 real point lights that are reassigned each frame to the
  nearest active light sources (the island defines ~130 of them);
- caps the device pixel ratio, shadow map size and shadow distance;
- generates every texture procedurally at 64–256 px instead of shipping 4K maps
  — including the normal maps that give brick, roof tiles, plaster, cloth, skin
  and car paint real relief, which cost nothing to download;
- hides distant NPCs and freezes off-screen wildlife instances.

Measured on the shipped island: roughly 730 draw calls and 1.4 M triangles at
Medium, and 1 400 / 3.3 M at High with the full draw distance. Auto-detect picks
Medium on a typical laptop and Low on phones.

Physics resolution is deliberately **independent of graphics quality**: the
collision heightfield is always baked at 300², so the world feels identical on a
phone and on a desktop.

### It tunes itself

Guessing a quality level from `navigator.hardwareConcurrency` and
`navigator.deviceMemory` is unreliable — Safari does not report memory at all,
and a laptop with eight cores can still be driving integrated graphics. So the
guess only picks a starting point and `perf.js` corrects it from the one number
that matters: measured frame time.

The governor watches a rolling window of frame times and moves between four
**runtime tiers** (Minimum, Low, Medium, High) that scale resolution, shadows,
view distance, crowd size and rain density. A sustained median above 26 ms
steps down; above 55 ms drops two tiers at once; a long clean run below 11.5 ms
steps back up. It only decides from at least twenty samples, so a device running
at five frames a second is corrected in about two seconds rather than twelve.
Single long frames over 500 ms are ignored — those are hitches, not a trend.

Tiers only touch what can change mid-session. Anything that would mean
rebuilding the world — terrain resolution, tree density — stays fixed at the
preset chosen when the island was built. Picking a quality by hand in Settings
pins the tier and the governor stops moving it; **Auto** hands it back.

Shadow maps are redrawn every second, third or fourth frame on the lower tiers
(`renderer.shadowMap.autoUpdate = false` plus a counter) because the sun barely
moves between frames, and the environment probe refreshes every four seconds
rather than every 1.5.

### It remembers the island

The island is a pure function of its seed, and on a cold load most of the wait is
spent proving that: baking a 561 × 561 heightfield, and testing tens of thousands
of candidate tree positions against slope, path distance and physics — most of
which are rejected.

`cache.js` stores both results in IndexedDB, keyed by a hash of everything that
shapes the island, so an edit to a location or a road invalidates them
automatically. Vegetation is cached as a **recording of the placements that
survived** rather than as geometry: the replay skips the search entirely and
rebuilds the same trees from the same decisions.

Measured on the same machine, world build time:

| | Cold | Warm |
| --- | --- | --- |
| Heightfield | 2 900 ms | 500 ms |
| Whole build | 4 860 ms | 2 210 ms |

Everything degrades silently — private browsing, a full disk, no IndexedDB, or a
cache written by an older build all just mean a normal cold generation. Turn it
off or wipe it from **Settings → Graphics → Fast loading**, and bump
`CACHE_VERSION` in `cache.js` when a change makes old entries wrong.

## 6. Project structure

```
game-hellocouple/
├── index.html              markup for every UI surface
├── css/style.css           the complete UI stylesheet
├── vendor/three/           vendored Three.js (MIT) + its licence
├── assets/                 kept for future art; the game ships with none
└── js/
    ├── main.js             bootstrap, game loop, interaction dispatch
    ├── config.js           ALL game data: locations, quests, shop, progression
    ├── noise.js            deterministic noise + small math helpers
    ├── terrain.js          island heightfield, flattening, terrain mesh
    ├── layout.js           snaps locations to real ground, builds the roads
    ├── collision.js        capsule-vs-shape collision + walkable platforms
    ├── batching.js         static geometry merger (draw-call control)
    ├── materials.js        one shared material registry
    ├── textures.js         every texture, generated procedurally
    ├── props.js            furniture, lamps, vehicles, details
    ├── buildings.js        houses, café, shops, lighthouse, piers, bridges
    ├── vegetation.js       instanced trees, bushes, grass, flowers, rocks
    ├── water.js            ocean, lake, rivers, waterfall
    ├── world.js            assembles the island and every location
    ├── city.js             downtown: streets, blocks, towers, furniture
    ├── vehicle.js          car models and arcade driving physics
    ├── traffic.js          instanced AI traffic and pedestrians
    ├── daynight.js         sky, sun, moon, stars, the whole lighting rig
    ├── weather.js          sunny / cloudy / rain
    ├── character.js        procedural humanoid + blended animation
    ├── player.js           player movement and grounding
    ├── companion.js        the second character's follow AI
    ├── camera.js           third-person camera + free camera
    ├── controls.js         keyboard, mouse, touch
    ├── interaction.js      proximity prompts
    ├── collectibles.js     pickups
    ├── quests.js           quests and achievements
    ├── inventory.js        inventory read-model
    ├── shop.js             cosmetics
    ├── npc.js              islanders + dialogue
    ├── animals.js          birds, butterflies, fish
    ├── minigames.js        fishing and the boat
    ├── map.js              minimap, full map, fast travel
    ├── save.js             persistence behind a storage adapter
    ├── ui.js               every DOM surface
    ├── voice.js            push-to-talk companion voice + WebRTC voice chat
    ├── perf.js             frame-rate governor + runtime quality tiers
    ├── cache.js            IndexedDB cache for the generated island
    └── net.js              the multiplayer seam
```

The game is still a pure static site. The one optional extra is the signalling
server, which exists only so two browsers can find each other for voice chat:

```
└── server/
    ├── index.js            WebSocket signalling relay (no DB, no accounts)
    └── package.json        one dependency: ws
```

## 7. Adding content

Almost everything is data in `js/config.js`. The world generator reads it, so
new content needs no engine changes.

### Adding a city block

Downtown is generated from `buildCity()` in `layout.js`, which returns block
rectangles, street centre-lines and intersections. Change `COLS`, `ROWS`,
`BLOCK`, `AVENUE` and `STREET` there to resize the grid — the terrain plateau,
the road network, the traffic graph and the map all follow automatically.

Each block carries a `kind` (`plaza`, `tower`, `midrise`, `low`, `reserved`),
and `city.js` has one builder per kind. To add a district type, add a kind in
`buildCity()` and a branch in `buildBlock()`.

Facades are shared materials built from `facadeTexture()` and
`facadeLitTexture()` in `textures.js`; add an entry to `facadeSpecs` in
`materials.js` and every block can use it. The emissive map is what lights the
windows after dark.

### Adding a car

```js
// vehicle.js → CAR_KINDS
coupe: { w: 1.84, l: 4.2, h: 0.52, cabin: 0.5, nose: 1.1,
         maxSpeed: 36, accel: 15, grip: 1.1, mass: 0.95, spoiler: true },
```

That is enough for it to appear parked downtown, in traffic, and in the row of
drivable cars by the plaza. `makeCarModel()` reads the proportions; `Vehicle`
reads the handling numbers. Optional flags: `boxy`, `bed`, `spoiler`, `taxi`.

### Adding a location

```js
// config.js → LOCATIONS
{
  id:'quarry', name:'Old Quarry', title:'OLD QUARRY', sub:'Something used to be mined here.',
  anchor:[120, -40],      // a hint, not a hard position
  kind:'inland',          // 'inland' | 'shore' | 'peak'
  color:'#b9a68a', icon:'⛏', radius:30, fastTravel:true, secret:false,
}
```

`layout.js` snaps the anchor onto ground that is actually suitable — flat and
above the tide line for `inland`, the coastline for `shore`, high ground for
`peak` — so an approximate anchor is enough. The location immediately gets a
discovery banner, a map marker, minimap presence and (if `fastTravel`) a travel
card.

To give it buildings, add a `buildQuarry()` method to `World` and one line to
the `steps` array in `World.build()`. Inside it, use:

```js
const q = this.L.get('quarry');
this.place(P.makeBench(2), q.x + 4, q.z, 0);           // props + colliders + lights
this.interact({ x: q.x, z: q.z, r: 3, kind: 'sit', label: 'Rest', data: {...} });
this.drop('coin', q.x + 6, q.z - 2);                    // a collectible
this.arrive('quarry', q.x + 8, q.z + 8);                // where fast travel lands
```

### Adding a quest

```js
// config.js → QUESTS
{
  id:'quarryRun', name:'Quarry Run', desc:'Find the old quarry.',
  trigger:'visit:quarry',   // visit:<id> | collect:<type> | collectAny | activity:<id>
  target:1,
  reward:{ hearts:25, coins:40, xp:30 },
  after:'firstWalk',        // optional prerequisite
}
```

Quest triggers are fired from gameplay with `quests.visited(id)`,
`quests.collected(type)` and `quests.activity(id)`. To add a new activity type,
call `this.quests.activity('yourId')` from the matching handler in `main.js` and
use `activity:yourId` as the trigger.

### Adding a collectible type

```js
// config.js → COLLECTIBLES
feather: { label:'Feathers', emoji:'🪶', color:0xf0e4d0, xp:5, value:{ coins:2 } },
```

Then give it a mesh in `collectibles.js` → `GEOS`:

```js
const GEOS = { ..., feather: () => new THREE.ConeGeometry(0.1, 0.4, 5) };
```

Scatter it from the world with `this.drop('feather', x, z)`. It is counted,
saved, shown in the Collection and Inventory screens, and usable as a quest
trigger automatically.

### Adding an outfit

`character.js` builds clothes over the base body in `_buildOutfit()`, hung off
the `chest` and `hips` joints so they animate for free. A look carries two
fields: `outfit` (`tee` `shirt` `jacket` `hoodie` `coat` `dress`) and `bottom`
(`trousers` `shorts` `skirt`), and `bottom` also decides how much leg is bare.
Add a branch there, then list the name in `CUSTOMIZE.outfits` in `config.js` and
it appears in **Customize**. Changing `outfit`, `bottom` or `height` re-runs
`_build()` (`setLook` detects it) because those change geometry, not colour.

### Adding a character or NPC

Every character — player, companion, NPC, future remote player — is the same
procedural rig from `character.js`. To add an islander, push a spawn from any
world builder:

```js
this.npcSpawns.push({
  id:'ranger', name:'Bo', role:'walk',      // 'stand' | 'sit' | 'walk' | 'fish'
  x, z, wander: 14,
  look: { skin:'#c98e64', hair:'#5b3a26', hairStyle:'short',   // short|long|bun|ponytail
          shirt:'#6fbf73', pants:'#3c5a80', shoes:'#23262e',
          eyes:'#4a3324', height: 1.0 },
  lines: [
    ['The path north is steeper than it looks.', ['Good to know', 'Where should I go?']],
    ['Follow the ridge and you will find the campsite.', ['Thanks!']],
  ],
});
```

`NPCSystem.build()` creates the character, the wander behaviour and the "Talk
to Bo" prompt. Dialogue lines are `[text, [choice, ...]]`; the last line ends the
conversation.

**How the body is built.** `character.js` assembles a real joint hierarchy
(hips → spine → chest → neck → head, plus four limb chains) out of capsules and
spheres: shoulders, elbows, knees and ankles all carry a joint ball so the limbs
never separate from the body, hands have a palm and a thumb, shoes have a sole,
and the head carries a jaw, brow, nose, lips, ears, eyebrows and eyes with lids
that blink. Skin, knit, denim, leather and hair each get a tiling greyscale
detail map **and** a matching normal map generated in `textures.js`
(`surfaceDetail` / `surfaceNormal`), so cloth reacts to the moving sun instead of
reading as a flat block of colour. The maps are greyscale and shared by every
character in the world — only `material.color` changes per person, so a crowd
costs one set of textures.

Those ~70 primitives would be ~70 draw calls each, so after building, `_flush()`
merges the meshes that hang off the same joint and share a material into one
geometry, cached globally because every character has the identical layout. A
character costs roughly 30 draws instead of 70, and the merged pieces are marked
`userData.shared` so teardown leaves them alone. Anything that must animate on
its own — the eyelids — sets `userData.noMerge = true` and is skipped.

Pedestrians (`traffic.js`) use the same detail and normal maps but are drawn as
nine `InstancedMesh` parts (torso, hips, shoulders, head, hair, arms, sleeves,
legs, shoes) with per-instance colour, height and hair length, so a crowd of 40
costs nine draw calls in total rather than one rig each.

To add a new animation, add a pose function to `character.js` (a map of joint →
`[x, y, z]` rotations) and blend it in `Character.update()`; the damping there is
what produces the blending, so poses never need transition code.

### Adding a shop item

```js
// config.js → SHOP
{ id:'hat_beanie', name:'Beanie', cat:'hat', emoji:'🧢', price:130, value:0x4f6f8f },
```

Categories `shirt`, `pants`, `shoes`, `hat`, `hair` and `emote` are already
wired into `shop.equip()`.

## 8. Save data

Progress is stored in `localStorage` under `hellocouple-world:save:v1`
(settings under `hellocouple-world:settings:v1`), covering player position,
discovered locations, collected items, coins, hearts, XP and level, quests,
achievements, unlocked cosmetics, both characters' looks, statistics, time of
day and weather. It autosaves every 45 seconds, on tab hide and on exit.

**Save Game** and **Reset Progress** live in Settings and in the pause menu.

## 9. Adding accounts and cloud saves later

`save.js` puts every read and write behind a three-method adapter:

```js
{
  async load(key)        { ... }
  async save(key, data)  { ... }
  async clear(key)       { ... }
}
```

Version 1 installs `LocalAdapter`. To add HelloCouple account sync, write a
`CloudAdapter` that talks to your API (a commented sketch is in `save.js`) and
construct the manager with it:

```js
this.save = new SaveManager(CloudAdapter('/api/game', token));
```

Nothing else in the game changes. The save object already carries a `profile`
block (`username`, `avatar`, `created`) for a game profile, and a
last-write-wins merge is enough because the payload is a single small JSON
document. A sensible production setup keeps the local adapter as a cache and
flushes to the cloud adapter on the existing autosave tick.

## 10. Adding multiplayer later

Version 1 is genuinely single-player — nothing is faked. The seam is `net.js`:

1. The island is **deterministic**: one seed, no server state. Two clients that
   agree on the seed already see an identical world, so only characters and
   shared activity state ever need replicating.
2. Implement the `NetworkAdapter` interface in `net.js` against your transport
   (WebSocket, WebRTC data channel, or a hosted realtime service):
   `connect`, `disconnect`, `send`, `onPeer`, `onPeerLeft`, `connected`.
3. Pass it to `RemotePlayers` instead of `NullNetwork` in `main.js`.

`voice.js` already ships one: `VoiceChat` is a working WebRTC adapter with
`connect`, `disconnect`, `send`, `onPeer`, `onPeerLeft` and `connected`, and
`main.js` installs it whenever `VOICE.serverUrl` is set. Joining a voice room
therefore already syncs the other player's character. What is *not* replicated
yet is world state — collectibles, quest progress, weather and time of day are
still per client.

`RemotePlayers` already spawns a `Character` for each remote id it hears about,
interpolates position and yaw, replays emotes, and sends a compact local
snapshot ten times a second. A "couple room" is then a room id shared between
two clients; shared activities (sitting together, a café date) become messages
on the same channel.

Collectibles and quests should stay client-authoritative for a cosmetic,
non-competitive game like this one — there is nothing to cheat for — which keeps
the server to a relay.

## 11. Being a couple

Three things in the game are about the two of you rather than the island.

### Holding hands

Press `H` (or `⚭` on touch) when you are near each other. The companion stops
trailing behind and walks at your shoulder, and one arm on each of you is pinned
so the hands meet and swing together. Anything that changes posture lets go on
its own: sitting, getting in a car, swimming, jumping, or drifting more than
5.5 m apart. It counts toward the **Hand in Hand** quest.

The follow AI is in `companion.js`: `holdSpot()` returns a point beside you
rather than behind you, and while holding the companion steers straight at it
with a speed that tracks yours, because the usual obstacle-avoidance fan would
visibly stretch the pair apart. The arm pose is in `character.js` — `state.hold`
is `-1` or `+1` and replaces the locomotion swing on that one arm.

### Driving together

Get into any car and your partner gets in beside you. `makeCarModel()` declares
`userData.seats` in car space; `_seatRiders()` in `main.js` rotates those into
the world every frame and puts both characters into the seated pose, so you can
see each other through the glass as you drive. Completes **Two Seater**.

### Talking out loud

Two independent systems, both in `voice.js`.

**Push to talk with your companion — no server, works offline.** Hold `V` (or
`🎙`), say something, let go. The browser's `SpeechRecognition` transcribes it,
`voice.js` matches it against the `REPLIES` table, and the answer is spoken back
through `speechSynthesis`. Some lines also *do* something: "hold my hand" takes
your hand, "let's take a photo" opens photo mode, "dance" makes you both dance.
The companion can answer questions about where you are, the time, the weather
and your current quest — `_voiceContext()` in `main.js` decides what it knows.

Add a line by adding one entry to `REPLIES`:

```js
[/\b(sing|song)\b/, (c) => `Not in front of everyone in ${c.area}.`],
```

Return `{ say, act }` instead of a string to trigger behaviour, and handle the
new `act` in `_voiceAct()`.

Speech recognition needs Chrome, Edge or Safari; Firefox has no
`SpeechRecognition` and the game says so rather than failing. Speech *synthesis*
works everywhere. Pick which voice answers in **Voice** → *Their voice*.

**Live voice chat with a real person — needs the server.** Open the **Voice**
tab, type the same room code as your partner, press *Join room*. After the
handshake the microphone audio is peer-to-peer WebRTC; each voice is played
through a `PannerNode` positioned at that player's character, so someone across
the plaza sounds like they are across the plaza.

This is the only part of the game that needs a server, and all the server does is
introduce the two browsers to each other:

```bash
cd server
npm install
npm start          # listens on :8080, or $PORT
```

Then point the game at it:

```js
// js/config.js
export const VOICE = {
  serverUrl: 'wss://voice.example.com',   // ws:// for local testing
  pushToTalkKey: 'V',
};
```

Leave `serverUrl` empty and live voice chat reports itself unavailable; push to
talk with your companion still works, because that never leaves the browser.

The server keeps no accounts, no database and no history — only which socket is
in which room, in memory. Set `ALLOWED_ORIGINS` in production (comma separated)
so only your own site can open a socket; `MAX_ROOM` caps a room (default 8).
It exposes `GET /health` for a platform health check. Deploy it anywhere that
runs Node 18+ and supports WebSockets — Railway, Render, Fly.io, or a VPS
behind nginx. Serve the game itself over HTTPS: browsers only grant microphone
access on a secure origin.

`VoiceChat` implements the same `NetworkAdapter` interface as `NullNetwork`, so
`RemotePlayers` drives it unchanged — joining a room already syncs position, yaw
and emotes over the WebRTC data channel alongside the audio. See §10.

## 12. Assets and licences

- **Three.js** — MIT, vendored at `vendor/three/three.module.min.js` with its
  licence file alongside.
- **Everything else is generated at runtime**: terrain, buildings, props,
  characters, vegetation and water are procedural geometry; every texture is
  drawn into a canvas by `textures.js`; every sound is synthesised by the Web
  Audio API in `audio.js`.

There are no third-party models, textures, fonts or audio files, so there is
nothing to attribute beyond Three.js and nothing that can break from an expired
CDN link. The UI uses the system font stack.

## 13. Browser support

Requires WebGL2 (Chrome/Edge 79+, Firefox 51+, Safari 15+, and their mobile
equivalents). If WebGL is unavailable the game shows a clear message instead of
a blank canvas. Audio is optional and fully mutable; the game is playable with
sound off.
