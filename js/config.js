/**
 * config.js — All tunable game data lives here.
 *
 * Everything that designers touch (locations, quests, shop stock, progression
 * curves, quality presets) is declared as plain data so new content can be
 * added without touching engine code. See README "Adding content".
 */

export const GAME = {
  name: 'HelloCouple World',
  version: '1.0.0',
  saveKey: 'hellocouple-world:save:v1',
  settingsKey: 'hellocouple-world:settings:v1',
};

/* ------------------------------------------------------------------ world */

export const WORLD = {
  /** Nominal island radius in metres; the coastline wobbles around it. */
  shoreRadius: 560,
  /** Half-size of the terrain mesh (a square that comfortably contains the isle). */
  halfSize: 700,
  /** Ocean plane size. */
  oceanSize: 6000,
  /** Sea level (world Y). Everything below is underwater. */
  seaLevel: 0,
  /** Mirror Lake surface height. */
  lakeLevel: 12.0,
  /** Player cannot swim: this is the wading limit before being pushed back. */
  wadeDepth: -1.1,
  /** Soft boundary — beyond this the player is turned around. */
  boundary: 680,
  gravity: -24,
};

/* --------------------------------------------------------------- quality */

export const QUALITY_PRESETS = {
  low: {
    label: 'Low',
    pixelRatio: 1.0,
    terrainSegments: 192,
    shadows: false,
    shadowMapSize: 1024,
    shadowDistance: 130,
    treeDensity: 0.45,
    gograssDensity: 0,
    grassDensity: 0.0,
    detailDensity: 0.5,
    waterQuality: 0,
    fogDensity: 1.25,
    particles: 0.4,
    drawDistance: 900,
    anisotropy: 1,
    antialias: false,
    traffic: 10,
    pedestrians: 12,
  },
  medium: {
    label: 'Medium',
    pixelRatio: 1.35,
    terrainSegments: 288,
    shadows: true,
    shadowMapSize: 2048,
    shadowDistance: 210,
    treeDensity: 0.75,
    grassDensity: 0.55,
    detailDensity: 0.8,
    waterQuality: 1,
    fogDensity: 1.0,
    particles: 0.75,
    drawDistance: 1400,
    anisotropy: 4,
    antialias: true,
    traffic: 22,
    pedestrians: 26,
  },
  high: {
    label: 'High',
    pixelRatio: 2.0,
    terrainSegments: 416,
    shadows: true,
    shadowMapSize: 3072,
    shadowDistance: 280,
    treeDensity: 1.0,
    grassDensity: 1.0,
    detailDensity: 1.0,
    waterQuality: 2,
    fogDensity: 1.0,
    particles: 1.0,
    drawDistance: 2000,
    anisotropy: 8,
    antialias: true,
    traffic: 34,
    pedestrians: 40,
  },
};

/* ------------------------------------------------------------- locations */

/**
 * Location anchors.
 *   kind: 'inland'  — snapped inward until it sits on solid ground
 *         'shore'   — projected onto the coastline along its own bearing
 *         'peak'    — snapped to the highest ground nearby
 * `offset` pushes a shore location inland (+) or out to sea (-).
 */
export const LOCATIONS = [
  { id:'town',        name:'Downtown',            title:'DOWNTOWN',          sub:'Glass, traffic and coffee.',
    anchor:[70,0],      kind:'inland', color:'#ffd6a5', icon:'⌂', radius:105, fastTravel:true },
  { id:'cafe',        name:'HelloCouple Café',    title:'HELLOCOUPLE CAFÉ',  sub:'Two cups, one window seat.',
    anchor:[120,60],     kind:'inland', color:'#ff7a9c', icon:'☕', radius:72, fastTravel:true },
  { id:'park',        name:'Seaside Park',        title:'SEASIDE PARK',      sub:'Green, quiet, and yours.',
    anchor:[440,380],     kind:'inland', color:'#9fe08a', icon:'❦', radius:95, fastTravel:true },
  { id:'picnic',      name:'Picnic Meadow',       title:'PICNIC MEADOW',     sub:'Spread the blanket.',
    anchor:[500,330],   kind:'inland', color:'#ffe08a', icon:'🧺', radius:42, fastTravel:false },
  { id:'beach',       name:'Beach',               title:'BEACH',             sub:'Relax by the ocean.',
    anchor:[60,520],    kind:'shore',  offset:16, color:'#ffe9b0', icon:'≈', radius:110, fastTravel:true },
  { id:'sunsetBeach', name:'Sunset Beach',        title:'SUNSET BEACH',      sub:'The sky puts on a show.',
    anchor:[-380,380],  kind:'shore',  offset:16, color:'#ffb38a', icon:'☀', radius:95, fastTravel:true },
  { id:'viewpoint',   name:'Sunset Point',        title:'SUNSET POINT',      sub:'The whole ocean, just for you.',
    anchor:[-470,60],   kind:'peak',   color:'#ffc978', icon:'▲', radius:130, fastTravel:true },
  { id:'forest',      name:'Whispering Forest',   title:'WHISPERING FOREST', sub:'Listen to the leaves.',
    anchor:[-150,-360],  kind:'inland', color:'#6fbf73', icon:'♣', radius:130, fastTravel:true },
  { id:'lake',        name:'Mirror Lake',         title:'MIRROR LAKE',       sub:'Still water, slow evening.',
    anchor:[-209,-146],  kind:'inland', color:'#7fd8d2', icon:'◊', radius:110, fastTravel:true },
  { id:'waterfall',   name:'Hidden Waterfall',    title:'HIDDEN WATERFALL',  sub:'You found the sound of water.',
    anchor:[-330,-270], kind:'inland', color:'#9ad9ff', icon:'✦', radius:56, fastTravel:true, secret:true },
  { id:'cave',        name:'Crystal Cave',        title:'CRYSTAL CAVE',      sub:'Something glitters in the dark.',
    anchor:[-350,-290], kind:'inland', color:'#c9a7ff', icon:'◆', radius:68, fastTravel:false, secret:true },
  { id:'lighthouse',  name:'Lighthouse',          title:'LIGHTHOUSE',        sub:'A light for the way home.',
    anchor:[470,-150],   kind:'shore',  offset:22, color:'#ff9f9f', icon:'⌖', radius:72, fastTravel:true },
  { id:'pier',        name:'The Pier',            title:'THE PIER',          sub:'Boats, fish and salt air.',
    anchor:[300,430],   kind:'shore',  offset:6,  color:'#c6a27a', icon:'⚓', radius:85, fastTravel:true },
  { id:'campsite',    name:'Campsite',            title:'CAMPSITE',          sub:'Stay until the stars come out.',
    anchor:[360,-230],  kind:'inland', color:'#ffb27a', icon:'▲', radius:68, fastTravel:true },
  { id:'hiddenBeach', name:'Hidden Cove',         title:'HIDDEN COVE',       sub:'Nobody else knows about this one.',
    anchor:[-470,-350], kind:'shore',  offset:4,  color:'#bff0ff', icon:'≈', radius:130, fastTravel:true, secret:true },
  { id:'grove',       name:'Secret Grove',        title:'SECRET GROVE',      sub:'The forest kept a garden.',
    anchor:[-300,-420], kind:'inland', color:'#ffc2e2', icon:'❀', radius:48, fastTravel:true, secret:true },
];

/* ---------------------------------------------------------- collectibles */

export const COLLECTIBLES = {
  heart:  { label:'Hearts',  emoji:'♥', color:0xff6f96, xp:4,  value:{hearts:1} },
  shell:  { label:'Shells',  emoji:'🐚', color:0xffd9b0, xp:3,  value:{shells:1} },
  flower: { label:'Flowers', emoji:'❀', color:0xff9ad1, xp:3,  value:{flowers:1} },
  star:   { label:'Stars',   emoji:'★', color:0xfff2a0, xp:25, value:{stars:1, hearts:10} },
  coin:   { label:'Coins',   emoji:'◉', color:0xffc94a, xp:2,  value:{coins:5} },
};

/* ---------------------------------------------------------------- quests */

/**
 * Quest triggers:
 *   visit:<locationId>      — completed by discovering a location
 *   collect:<type>          — counts collectibles of a type
 *   collectAny              — counts any collectible
 *   activity:<id>           — completed by doing an activity (drink, picnic, fish…)
 */
export const QUESTS = [
  { id:'welcome',  name:'Welcome to HelloCouple World', desc:'Explore the island and see where the roads lead.',
    trigger:'collectAny', target:3, reward:{hearts:50, xp:40}, auto:true },
  { id:'firstWalk', name:'First Walk', desc:'Explore the town square and its little streets.',
    trigger:'visit:town', target:1, reward:{hearts:10, xp:20}, auto:true },
  { id:'coffeeDate', name:'Coffee Date', desc:'Visit the HelloCouple Café and order something warm.',
    trigger:'activity:drink', target:1, reward:{hearts:25, coins:20, xp:30}, after:'firstWalk' },
  { id:'beachExplorer', name:'Beach Explorer', desc:'Find the beach on the south shore.',
    trigger:'visit:beach', target:1, reward:{hearts:20, xp:25} },
  { id:'sunset', name:'Sunset', desc:'Visit Sunset Point and watch the sun go down.',
    trigger:'visit:viewpoint', target:1, reward:{hearts:30, xp:40} },
  { id:'forestExplorer', name:'Forest Explorer', desc:'Find the forest in the north of the island.',
    trigger:'visit:forest', target:1, reward:{hearts:20, xp:25} },
  { id:'shellSeeker', name:'Shell Seeker', desc:'Collect 5 shells along the sand.',
    trigger:'collect:shell', target:5, reward:{hearts:20, coins:30, xp:35}, after:'beachExplorer' },
  { id:'anglersLuck', name:"Angler's Luck", desc:'Catch a fish from the pier.',
    trigger:'activity:fish', target:1, reward:{coins:60, hearts:15, xp:40} },
  { id:'picnicDay', name:'Picnic Day', desc:'Share a picnic in the meadow.',
    trigger:'activity:picnic', target:1, reward:{hearts:35, xp:35} },
  { id:'secretWaterfall', name:'Secret Waterfall', desc:'Somewhere past the lake, water is falling. Find it.',
    trigger:'visit:waterfall', target:1, reward:{hearts:50, coins:60, xp:70} },
  { id:'lighthouseExplorer', name:'Lighthouse Explorer', desc:'Reach the lighthouse on the eastern point.',
    trigger:'visit:lighthouse', target:1, reward:{hearts:50, xp:60} },
  { id:'collector', name:'Collector', desc:'Collect 10 items of any kind.',
    trigger:'collectAny', target:10, reward:{coins:100, xp:50} },
  { id:'photographer', name:'Photographer', desc:'Take a photo of the island.',
    trigger:'activity:photo', target:1, reward:{coins:40, xp:25} },
  { id:'roadTrip', name:'Road Trip', desc:'Find a car downtown and take it for a drive.',
    trigger:'activity:drive', target:1, reward:{coins:60, hearts:20, xp:40} },
  { id:'campfireNight', name:'Campfire Night', desc:'Sit by the campfire at the campsite.',
    trigger:'activity:campfire', target:1, reward:{hearts:30, xp:35} },
  { id:'handInHand', name:'Hand in Hand', desc:'Take your partner by the hand and walk together (press H).',
    trigger:'activity:holdHands', target:1, reward:{hearts:40, xp:30} },
  { id:'twoSeater', name:'Two Seater', desc:'Go for a drive together with your partner in the car.',
    trigger:'activity:coupleDrive', target:1, reward:{coins:80, hearts:45, xp:55} },
  { id:'saySomething', name:'Say Something', desc:'Speak to your partner out loud using the microphone (press V).',
    trigger:'activity:voice', target:1, reward:{hearts:35, xp:40} },
  { id:'starGatherer', name:'Star Gatherer', desc:'Find 3 hidden stars around the island.',
    trigger:'collect:star', target:3, reward:{coins:250, hearts:100, xp:150} },
];

/* ---------------------------------------------------------- achievements */

export const ACHIEVEMENTS = [
  { id:'explorer',     name:'Explorer',        desc:'Visit 5 locations.',                 check:s => s.discovered.length >= 5 },
  { id:'cartographer', name:'Cartographer',    desc:'Discover every location.',           check:(s,n) => s.discovered.length >= n.total },
  { id:'collector50',  name:'Collector',       desc:'Collect 50 objects.',                check:s => s.stats.totalCollected >= 50 },
  { id:'beachLover',   name:'Beach Lover',     desc:'Spend 3 minutes at the beach.',      check:s => (s.stats.timeAtBeach||0) >= 180 },
  { id:'mountain',     name:'Mountain Explorer',desc:'Reach the highest point of the island.', check:s => (s.stats.maxHeight||0) >= 62 },
  { id:'secretFinder', name:'Secret Finder',   desc:'Discover the hidden waterfall.',     check:s => s.discovered.includes('waterfall') },
  { id:'sunsetWatcher',name:'Sunset',          desc:'Watch a sunset from Sunset Point.',  check:s => !!s.flags.watchedSunset },
  { id:'angler',       name:'Angler',          desc:'Catch 5 fish.',                      check:s => (s.stats.fishCaught||0) >= 5 },
  { id:'barista',      name:'Regular',         desc:'Order 5 drinks at the café.',        check:s => (s.stats.drinksOrdered||0) >= 5 },
  { id:'dresser',      name:'Style Icon',      desc:'Unlock 3 shop items.',               check:s => s.unlocked.length >= 3 },
  { id:'level5',       name:'Islander',        desc:'Reach level 5.',                     check:s => s.level >= 5 },
  { id:'together',     name:'Together',        desc:'Share 5 activities with your companion.', check:s => (s.stats.dates||0) >= 5 },
];

/* ------------------------------------------------------------------- shop */

export const SHOP = [
  { id:'shirt_sunset', name:'Sunset Tee',    cat:'shirt',  emoji:'👕', price:80,  value:0xff8b6b },
  { id:'shirt_ocean',  name:'Ocean Shirt',   cat:'shirt',  emoji:'👕', price:80,  value:0x4f9fd8 },
  { id:'shirt_rose',   name:'Rose Shirt',    cat:'shirt',  emoji:'👕', price:120, value:0xff7a9c },
  { id:'shirt_cream',  name:'Linen Shirt',   cat:'shirt',  emoji:'👕', price:60,  value:0xf0e6d2 },
  { id:'pants_denim',  name:'Denim Jeans',   cat:'pants',  emoji:'👖', price:70,  value:0x3c5a80 },
  { id:'pants_khaki',  name:'Khaki Pants',   cat:'pants',  emoji:'👖', price:70,  value:0xbda37a },
  { id:'pants_black',  name:'Black Trousers',cat:'pants',  emoji:'👖', price:90,  value:0x2b2f38 },
  { id:'shoes_white',  name:'White Sneakers',cat:'shoes',  emoji:'👟', price:90,  value:0xf2f2f2 },
  { id:'shoes_tan',    name:'Tan Boots',     cat:'shoes',  emoji:'🥾', price:110, value:0x8a5a34 },
  { id:'hat_straw',    name:'Straw Hat',     cat:'hat',    emoji:'👒', price:150, value:0xe3c98a },
  { id:'hat_cap',      name:'Cap',           cat:'hat',    emoji:'🧢', price:120, value:0xe0546f },
  { id:'hair_long',    name:'Long Hair',     cat:'hair',   emoji:'💇', price:140, value:'long' },
  { id:'hair_bun',     name:'Bun',           cat:'hair',   emoji:'💁', price:140, value:'bun' },
  { id:'emote_dance',  name:'Dance Emote',   cat:'emote',  emoji:'🕺', price:200, value:'dance' },
  { id:'emote_heart',  name:'Heart Emote',   cat:'emote',  emoji:'💗', price:180, value:'heart' },
  { id:'emote_cheer',  name:'Cheer Emote',   cat:'emote',  emoji:'🙌', price:150, value:'cheer' },
];

/* --------------------------------------------------------------- avatars */

export const CUSTOMIZE = {
  skin:  ['#f4d4bd', '#e8bc9a', '#c98e64', '#9c6440', '#6e442a', '#4a2e1d'],
  hair:  ['#2b2119', '#5b3a26', '#946b3f', '#d9b382', '#8c2f2f', '#3a3f5a'],
  shirt: ['#ff7a9c', '#4f9fd8', '#f0e6d2', '#6fbf73', '#ff8b6b', '#2b2f38'],
  pants: ['#3c5a80', '#bda37a', '#2b2f38', '#6b6f7a'],
  shoes: ['#f2f2f2', '#8a5a34', '#23262e', '#d8534f'],
  eyes:  ['#4a3324', '#2f2620', '#3f6b4f', '#3d6c93', '#7a5230'],
  styles:['short', 'long', 'bun', 'ponytail'],
  outfits:['tee', 'shirt', 'jacket', 'hoodie', 'coat', 'dress'],
  bottoms:['trousers', 'shorts', 'skirt'],
};

/* ------------------------------------------------------------------ voice */

/**
 * Voice settings.
 *
 * `serverUrl` is the only thing this game ever needs a server for. Point it at
 * the signalling server in `server/` (`wss://...` in production, `ws://` for
 * local testing) and the in-game Voice tab can join a room. Leave it empty and
 * live voice chat is simply reported as unavailable — push-to-talk with your
 * companion still works, because that runs entirely in the browser.
 */
export const VOICE = {
  serverUrl: '',            // e.g. 'wss://voice.example.com'
  pushToTalkKey: 'V',
};

/* --------------------------------------------------------------- leveling */

/** XP needed to *reach* a level (index 0 = level 1). */
export const XP_TABLE = [0, 100, 250, 500, 850, 1300, 1900, 2650, 3600, 4750, 6100, 7700, 9600];

export function levelForXp(xp) {
  let lv = 1;
  for (let i = 0; i < XP_TABLE.length; i++) if (xp >= XP_TABLE[i]) lv = i + 1;
  return lv;
}
export function xpBounds(level) {
  const lo = XP_TABLE[Math.min(level - 1, XP_TABLE.length - 1)];
  const hi = level < XP_TABLE.length ? XP_TABLE[level] : lo + 2500 * (level - XP_TABLE.length + 2);
  return { lo, hi };
}

/* ----------------------------------------------------------------- misc */

export const TIPS = [
  'Explore the island to discover hidden places.',
  'Some collectibles are hidden — look behind the rocks.',
  'Visit Sunset Point at sunset.',
  'Press M for the map, and travel to places you have already found.',
  'The café serves five different drinks. Try them all.',
  'Follow the sound of water in the north-west forest.',
  'Your companion follows you everywhere. Even up the lighthouse.',
  'Press P for photo mode, then Capture to save a picture.',
  'Fish from the pier — timing is everything.',
  'Night falls quickly. Street lamps and campfires light the way.',
];

export const CONTROLS = [
  ['WASD', 'Move'],
  ['Mouse', 'Look around'],
  ['Shift', 'Sprint'],
  ['Space', 'Jump'],
  ['E', 'Interact'],
  ['M', 'Map'],
  ['P', 'Photo mode'],
  ['C', 'Emotes'],
  ['E at a car', 'Drive'],
  ['H', 'Hold hands'],
  ['Esc', 'Menu'],
];

export const DRINKS = [
  { id:'coffee', name:'Coffee',        emoji:'☕', color:0x4a2c17 },
  { id:'tea',    name:'Tea',           emoji:'🍵', color:0xb5843c },
  { id:'choco',  name:'Hot Chocolate', emoji:'🍫', color:0x6b3f2a },
  { id:'lemon',  name:'Lemonade',      emoji:'🍋', color:0xf3e07b },
  { id:'shake',  name:'Milkshake',     emoji:'🥤', color:0xf6d9e4 },
];

export const FISH = [
  { name:'Silver Sardine', emoji:'🐟', coins:12, xp:8 },
  { name:'Blue Snapper',   emoji:'🐠', coins:20, xp:12 },
  { name:'Sunset Bass',    emoji:'🐡', coins:32, xp:18 },
  { name:'Golden Koi',     emoji:'🎏', coins:70, xp:40 },
];

export const EMOTES = [
  { id:'wave',  name:'Wave',  emoji:'👋', free:true },
  { id:'sit',   name:'Sit',   emoji:'🪑', free:true },
  { id:'point', name:'Point', emoji:'👉', free:true },
  { id:'cheer', name:'Cheer', emoji:'🙌', free:false },
  { id:'dance', name:'Dance', emoji:'🕺', free:false },
  { id:'heart', name:'Heart', emoji:'💗', free:false },
];
