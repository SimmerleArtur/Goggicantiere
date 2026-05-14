/* storage.js – großer Offline-Speicher (IndexedDB) + Fallback localStorage
   Ziel: maximale praktische Speicherkapazität im Browser.
   - Primär: IndexedDB (viel größer als localStorage)
   - Fallback: localStorage
   - Migration: vorhandene localStorage-Daten werden beim ersten Zugriff in IndexedDB verschoben
*/

(function(){
  const DB_NAME = "goggicantiere_db_v1";
  const DB_VER  = 1;
  const STORE   = "kv";

  let _dbPromise = null;

  function hasIndexedDB(){
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  }

  function openDB(){
    if (!hasIndexedDB()) return Promise.resolve(null);
    if (_dbPromise) return _dbPromise;

    _dbPromise = new Promise((resolve) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)){
          db.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => {
        console.warn("IndexedDB nicht verfügbar, fallback auf localStorage.", req.error);
        resolve(null);
      };
    });

    return _dbPromise;
  }

  async function idbGet(key){
    const db = await openDB();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const st = tx.objectStore(STORE);
      const req = st.get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror   = () => resolve(null);
    });
  }

  async function idbSet(key, value){
    const db = await openDB();
    if (!db) return false;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      const st = tx.objectStore(STORE);
      const req = st.put(value, key);
      req.onsuccess = () => resolve(true);
      req.onerror   = () => {
        console.error("IndexedDB speichern fehlgeschlagen:", req.error);
        resolve(false);
      };
    });
  }

  async function idbDel(key){
    const db = await openDB();
    if (!db) return false;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      const st = tx.objectStore(STORE);
      const req = st.delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror   = () => resolve(false);
    });
  }

  function lsGet(key){
    try{ return localStorage.getItem(key); }catch{ return null; }
  }
  function lsSet(key, val){
    try{ localStorage.setItem(key, val); return true; }catch{ return false; }
  }
  function lsDel(key){
    try{ localStorage.removeItem(key); return true; }catch{ return false; }
  }

  async function migrateKey(key){
    // Wenn IndexedDB vorhanden ist und der Key dort fehlt,
    // aber in localStorage existiert: rüberkopieren + localStorage löschen.
    const db = await openDB();
    if (!db) return;

    const inDb = await idbGet(key);
    if (inDb != null) return;

    const inLs = lsGet(key);
    if (inLs == null) return;

    const ok = await idbSet(key, inLs);
    if (ok){
      lsDel(key); // wichtig: localStorage freiräumen
    }
  }

  async function get(key){
    await migrateKey(key);
    const v = await idbGet(key);
    if (v != null) return v;
    return lsGet(key);
  }

  async function set(key, value){
    // erst IndexedDB probieren, dann localStorage
    const okIdb = await idbSet(key, value);
    if (okIdb) return true;
    return lsSet(key, value);
  }

  async function remove(key){
    const okIdb = await idbDel(key);
    const okLs  = lsDel(key);
    return okIdb || okLs;
  }

  async function migrate(keys){
    for (const k of (keys || [])){
      // eslint-disable-next-line no-await-in-loop
      await migrateKey(k);
    }
  }

  window.GStorage = { get, set, remove, migrate };
})();
