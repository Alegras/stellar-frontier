/** Сохранения: IndexedDB (канон §11), с фолбэком на localStorage. */
const DB_NAME = "stellar-frontier";
const STORE = "saves";
const KEY = "campaign";

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

export interface SaveMeta {
  savedAt: number;
  tick: number;
  seed: number;
  empireName: string;
}

export async function saveWorld(key: string, json: string, meta: SaveMeta): Promise<boolean> {
  const db = await openDb();
  if (db) {
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ json, meta }, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  }
  try {
    localStorage.setItem(`${DB_NAME}:${key}`, JSON.stringify({ json, meta }));
    return true;
  } catch {
    return false;
  }
}

export async function loadWorld(key: string): Promise<{ json: string; meta: SaveMeta } | null> {
  const db = await openDb();
  if (db) {
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => {
        const val = req.result as { json: string; meta: SaveMeta } | undefined;
        resolve(val ?? null);
      };
      req.onerror = () => resolve(null);
    });
  }
  try {
    const raw = localStorage.getItem(`${DB_NAME}:${key}`);
    return raw ? (JSON.parse(raw) as { json: string; meta: SaveMeta }) : null;
  } catch {
    return null;
  }
}
