// Where link previews are kept: the web view's IndexedDB, which holds a few
// hundred small pictures without trouble and outlives the app. Nothing here
// rejects for long: a phone that can't save a preview fetches it again.
import type { PreviewCache } from "./link-previews";

const databaseName = "teneo-link-previews";
const storeName = "previews";

interface SavedPreview {
  key: string;
  image: string | null;
  savedAt: number;
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB"));
  });
}

export function indexedDbPreviewCache(): PreviewCache {
  let opening: Promise<IDBDatabase> | null = null;
  function open(): Promise<IDBDatabase> {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(storeName, {
          keyPath: "key",
        });
        store.createIndex("savedAt", "savedAt");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB"));
    }).catch((error: unknown) => {
      opening = null; // the next use tries again
      throw error;
    });
    return opening;
  }
  async function store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await open()).transaction(storeName, mode).objectStore(storeName);
  }

  return {
    async get(key) {
      const saved = (await done((await store("readonly")).get(key))) as
        | SavedPreview
        | undefined;
      return saved ? { image: saved.image, savedAt: saved.savedAt } : null;
    },
    async set(key, image, savedAt) {
      const preview: SavedPreview = { key, image, savedAt };
      await done((await store("readwrite")).put(preview));
    },
    async removeOlderThan(time) {
      const previews = await store("readwrite");
      const old = IDBKeyRange.upperBound(time, true);
      const keys = await done(previews.index("savedAt").getAllKeys(old));
      for (const key of keys) previews.delete(key);
    },
  };
}
