import type { TeleFile } from "@/lib/types";

let database: Promise<IDBDatabase> | undefined;
function openDatabase() {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("telefotos-thumbnails", 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore("covers", { keyPath: "key" });
      store.createIndex("createdAt", "createdAt");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return database;
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
