/**
 * cache.js — keep the expensive, deterministic parts of world generation
 * between visits.
 *
 * Nothing here changes what the world looks like. The island is a pure
 * function of its seed, so the first load bakes the heightfield and the
 * procedural textures, and every load after that reads them straight out of
 * IndexedDB instead of recomputing a few million noise samples. On a phone
 * that is the difference between a twenty second wait and a two second one.
 *
 * Everything degrades silently: private browsing, a full disk, a browser with
 * no IndexedDB, a cache written by an older build — each just means a normal
 * cold generation, never an error the player sees.
 */

const DB_NAME = 'hellocouple-world';
const STORE = 'gen';
const DB_VERSION = 1;

/**
 * Bump when a change makes an old cache wrong — a new terrain shape, different
 * texture code, a new location. Stale entries are dropped on read.
 */
export const CACHE_VERSION = 3;

let dbPromise = null;
let disabled = false;

function openDB() {
  if (disabled) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch { return resolve(null); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { disabled = true; resolve(null); };
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

/** Read one entry. Returns null for a miss, a stale version, or any failure. */
export async function get(key) {
  const db = await openDB();
  if (!db) return null;
  return new Promise((resolve) => {
    let req;
    try { req = tx(db, 'readonly').get(key); } catch { return resolve(null); }
    req.onsuccess = () => {
      const v = req.result;
      resolve(v && v.v === CACHE_VERSION ? v.data : null);
    };
    req.onerror = () => resolve(null);
  });
}

/** Write one entry. Resolves either way — a failed write is not worth a retry. */
export async function put(key, data) {
  const db = await openDB();
  if (!db) return false;
  return new Promise((resolve) => {
    let req;
    try { req = tx(db, 'readwrite').put({ v: CACHE_VERSION, at: Date.now(), data }, key); }
    catch { return resolve(false); }
    req.onsuccess = () => resolve(true);
    req.onerror = () => resolve(false);        // quota exceeded, most likely
  });
}

/** Forget everything. Exposed in Settings so a stuck cache is always fixable. */
export async function clear() {
  const db = await openDB();
  if (!db) return false;
  return new Promise((resolve) => {
    let req;
    try { req = tx(db, 'readwrite').clear(); } catch { return resolve(false); }
    req.onsuccess = () => resolve(true);
    req.onerror = () => resolve(false);
  });
}

/** Roughly how much has been stored, for the Settings readout. */
export async function usage() {
  try {
    const e = await navigator.storage?.estimate?.();
    return e?.usage ?? null;
  } catch { return null; }
}
