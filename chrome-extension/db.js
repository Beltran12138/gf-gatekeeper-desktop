/**
 * Girlfriend Gatekeeper — IndexedDB helpers
 * Shared between popup.js (write) and content.js (read).
 * Stores large binary blobs (video, audio) that exceed chrome.storage.local limits.
 */

const _DB_NAME = 'gfgk_media';
const _DB_VER  = 1;
const _STORE   = 'files';

function _openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(_DB_NAME, _DB_VER);
    r.onupgradeneeded = e => e.target.result.createObjectStore(_STORE);
    r.onsuccess = e => res(e.target.result);
    r.onerror   = e => rej(e.target.error);
  });
}

async function mediaSave(key, blob) {
  const db = await _openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(_STORE, 'readwrite');
    tx.objectStore(_STORE).put(blob, key);
    tx.oncomplete = () => res();
    tx.onerror    = e => rej(e.target.error);
  });
}

async function mediaLoad(key) {
  const db = await _openDB();
  return new Promise((res, rej) => {
    const r = db.transaction(_STORE, 'readonly').objectStore(_STORE).get(key);
    r.onsuccess = e => res(e.target.result ?? null);
    r.onerror   = e => rej(e.target.error);
  });
}

async function mediaDelete(key) {
  const db = await _openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(_STORE, 'readwrite');
    tx.objectStore(_STORE).delete(key);
    tx.oncomplete = () => res();
    tx.onerror    = e => rej(e.target.error);
  });
}
