'use strict';
/* Tiny IndexedDB wrapper used for autosave. Fails soft: if IndexedDB is unavailable
   (some browsers block it for file:// pages), the app still works, just without autosave. */
(function (CC) {
  const DB_NAME = 'collage-cutter';
  const VERSION = 2; // v2 adds the 'ai' store (cached AI library + model files)
  let db = null;

  const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = (store, mode = 'readonly') => db.transaction(store, mode).objectStore(store);

  CC.db = {
    get ok() { return !!db; },

    async open() {
      try {
        const r = indexedDB.open(DB_NAME, VERSION);
        r.onupgradeneeded = () => {
          const d = r.result;
          if (!d.objectStoreNames.contains('sources')) d.createObjectStore('sources', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
          if (!d.objectStoreNames.contains('ai')) d.createObjectStore('ai');
        };
        db = await req(r);
        if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      } catch (err) {
        console.warn('IndexedDB unavailable, autosave disabled', err);
        db = null;
      }
      return !!db;
    },

    async putSource(rec) { if (db) await req(tx('sources', 'readwrite').put(rec)); },
    async deleteSource(id) { if (db) await req(tx('sources', 'readwrite').delete(id)); },
    async getAllSources() { return db ? req(tx('sources').getAll()) : []; },
    async clearSources() { if (db) await req(tx('sources', 'readwrite').clear()); },
    async setKV(key, value) { if (db) await req(tx('kv', 'readwrite').put(value, key)); },
    async getKV(key) { return db ? req(tx('kv').get(key)) : undefined; },
    async aiGet(key) { return db ? req(tx('ai').get(key)) : undefined; },
    async aiClear() { if (db) await req(tx('ai', 'readwrite').clear()); },
  };
})(window.CC);
