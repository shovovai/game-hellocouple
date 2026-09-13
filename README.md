# HelloCouple World

A compact, hand-built 3D open-world island that runs in a browser tab. Explore a
vacation island, find hidden places, collect things, complete quests, fish from
the pier, share a café date, customise your character, and watch the sun go down
from Sunset Point — with a companion who follows you everywhere.

Built with HTML5, CSS3, ES modules, WebGL and Three.js. No backend, no build
step, no external assets, no tracking.

---

## 1. Running it locally

The game is plain static files, but it uses ES modules, so it must be served
over HTTP (opening `index.html` from the filesystem will not work).

```bash
cd hellocouple-world

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

Copy the `hellocouple-world/` folder anywhere that serves static files:

| Host | How |
| --- | --- |
| Apache / Nginx | drop the folder in the web root |
| Laravel / Symfony | drop it in `public/` → served at `/hellocouple-world/` |
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
| Mouse move (or drag) | Look around |
| Mouse wheel | Zoom the camera in and out |
| `Shift` | Sprint |
| `Space` | Jump |
| `E` | Interact / sit / stand |
| `M` | Map and fast travel |
| `J` or `Q` | Quests |
| `I` | Inventory |
| `C` | Emote wheel |
| `P` | Photo mode |
| `F` | Fullscreen |
| `Esc` | Pause menu, or close whatever is open |

In photo mode: `W`/`A`/`S`/`D` fly, `Space` rises, `Ctrl` descends, `Shift`
flies faster, the wheel changes the field of view.

### Mobile and tablet

Touch controls appear automatically on touch devices:

- **Left half** — virtual joystick (push it to the edge to sprint).
- **Right half** — swipe to look, pinch to zoom.
- **Buttons** — `E` interact, `⤒` jump, `⚡` sprint toggle, `▦` map, `☰` menu.

## 5. Performance settings

Settings → Graphics. `Auto` picks a preset from the device (CPU cores, memory,
touch capability); Low / Medium / High override it.

| | Low | Medium | High |
| --- | --- | --- | --- |
| Pixel ratio cap | 1.0 | 1.35 | 2.0 |
| Terrain mesh | 140² | 200² | 280² |
| Shadows | off | 1024 px | 2048 px |
| Tree density | 45 % | 75 % | 100 % |
| Grass | off | 55 % | 100 % |
| Water shader | cheap | normal | full |
| Draw distance | 760 m | 1050 m | 1400 m |

Independent of the preset, the game always:

- merges static props into batches per material **and** per 110 m cell, so draw
  calls stay low without breaking frustum culling;
- draws all vegetation with `InstancedMesh`, bucketed the same way;
- keeps a pool of 5–7 real point lights that are reassigned each frame to the
  nearest active light sources (the island defines ~130 of them);
- caps the device pixel ratio, shadow map size and shadow distance;
- generates every texture procedurally at 64–256 px instead of shipping 4K maps;
- hides distant NPCs and freezes off-screen wildlife instances.

Physics resolution is deliberately **independent of graphics quality**: the
collision heightfield is always baked at 300², so the world feels identical on a
phone and on a desktop.

## 6. Project structure

```
hellocouple-world/
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
    └── net.js              the multiplayer seam (inert in v1)
```

## 7. Adding content

Almost everything is data in `js/config.js`. The world generator reads it, so
new content needs no engine changes.

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

### Adding a character or NPC

Every character — player, companion, NPC, future remote player — is the same
procedural rig from `character.js`. To add an islander, push a spawn from any
world builder:

```js
this.npcSpawns.push({
  id:'ranger', name:'Bo', role:'walk',      // 'stand' | 'sit' | 'walk' | 'fish'
  x, z, wander: 14,
  look: { skin:'#c98e64', hair:'#5b3a26', hairStyle:'short',
          shirt:'#6fbf73', pants:'#3c5a80', shoes:'#23262e' },
  lines: [
    ['The path north is steeper than it looks.', ['Good to know', 'Where should I go?']],
    ['Follow the ridge and you will find the campsite.', ['Thanks!']],
  ],
});
```

`NPCSystem.build()` creates the character, the wander behaviour and the "Talk
to Bo" prompt. Dialogue lines are `[text, [choice, ...]]`; the last line ends the
conversation.

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

`RemotePlayers` already spawns a `Character` for each remote id it hears about,
interpolates position and yaw, replays emotes, and sends a compact local
snapshot ten times a second. A "couple room" is then a room id shared between
two clients; shared activities (sitting together, a café date) become messages
on the same channel.

Collectibles and quests should stay client-authoritative for a cosmetic,
non-competitive game like this one — there is nothing to cheat for — which keeps
the server to a relay.

## 11. Assets and licences

- **Three.js** — MIT, vendored at `vendor/three/three.module.min.js` with its
  licence file alongside.
- **Everything else is generated at runtime**: terrain, buildings, props,
  characters, vegetation and water are procedural geometry; every texture is
  drawn into a canvas by `textures.js`; every sound is synthesised by the Web
  Audio API in `audio.js`.

There are no third-party models, textures, fonts or audio files, so there is
nothing to attribute beyond Three.js and nothing that can break from an expired
CDN link. The UI uses the system font stack.

## 12. Browser support

Requires WebGL2 (Chrome/Edge 79+, Firefox 51+, Safari 15+, and their mobile
equivalents). If WebGL is unavailable the game shows a clear message instead of
a blank canvas. Audio is optional and fully mutable; the game is playable with
sound off.
