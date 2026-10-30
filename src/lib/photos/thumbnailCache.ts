import type { TeleFile } from "@/lib/types";

let database: Promise<IDBDatabase> | undefined;
function openDatabase() {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("telefotos-thumbnails", 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("covers")) {
        const store = db.createObjectStore("covers", { keyPath: "key" });
        store.createIndex("createdAt", "createdAt");
      }
      if (!db.objectStoreNames.contains("originals")) {
        const store = db.createObjectStore("originals", { keyPath: "key" });
        store.createIndex("createdAt", "createdAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return database;
}

export function originalCacheKey(file: TeleFile, account: string) {
  return `${account}:${file.channelId}:${file.messageId}:original`;
}

export async function readOriginal(key: string): Promise<Blob | undefined> {
  try {
    const db = await openDatabase();
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("originals", "readwrite");
      const store = transaction.objectStore("originals");
      const request = store.get(key);
      let blob: Blob | undefined;
      request.onsuccess = () => {
        blob = request.result?.blob;
        if (blob) store.put({ key, blob, createdAt: Date.now() });
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve(blob);
      transaction.onerror = () => reject(transaction.error);
    });
  } catch { return undefined; }
}

// Keep recent originals for instant repeat viewing without allowing the cache to grow forever.
export async function saveOriginal(key: string, blob: Blob): Promise<void> {
  const maxFileBytes = 100 * 1024 * 1024;
  const maxCacheBytes = 250 * 1024 * 1024;
  if (blob.size === 0 || blob.size > maxFileBytes) return;
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("originals", "readwrite");
      const store = transaction.objectStore("originals");
      const request = store.getAll();
      request.onsuccess = () => {
        const entries = (request.result as Array<{ key: string; blob: Blob; createdAt: number }>)
          .filter((entry) => entry.key !== key)
          .sort((a, b) => a.createdAt - b.createdAt);
        let total = blob.size + entries.reduce((sum, entry) => sum + (entry.blob?.size ?? 0), 0);
        while (total > maxCacheBytes && entries.length) {
          const oldest = entries.shift()!;
          total -= oldest.blob?.size ?? 0;
          store.delete(oldest.key);
        }
        store.put({ key, blob, createdAt: Date.now() });
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch { /* Cache/quota failures must never block viewing the Telegram original. */ }
}

export function thumbnailCacheKey(file: TeleFile, account: string) {
  return `${account}:${file.channelId}:${file.messageId}${file.mime.startsWith("video/") ? ":visible-frame-v2" : ""}`;
}

export async function readThumbnail(key: string): Promise<Blob | undefined> {
  try {
    const db = await openDatabase();
    return await new Promise((resolve, reject) => {
      const request = db.transaction("covers").objectStore("covers").get(key);
      request.onsuccess = () => resolve(request.result?.blob);
      request.onerror = () => reject(request.error);
    });
  } catch { return undefined; }
}

export async function saveThumbnail(key: string, blob: Blob): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("covers", "readwrite");
      const store = transaction.objectStore("covers");
      store.put({ key, blob, createdAt: Date.now() });
      const count = store.count();
      count.onsuccess = () => {
        let excess = count.result - 600;
        if (excess <= 0) return;
        const cursor = store.index("createdAt").openCursor();
        cursor.onsuccess = () => {
          if (!cursor.result || excess-- <= 0) return;
          cursor.result.delete();
          cursor.result.continue();
        };
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    window.dispatchEvent(new CustomEvent("telefotos-thumbnail", { detail: key }));
  } catch { /* A cache/quota failure must not prevent opening the original. */ }
}
