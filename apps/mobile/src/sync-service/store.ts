import { type Hlc, type SyncStore } from "@teneo/sync";
import { MemoryStore } from "@teneo/sync/testing";

/** Where sync keeps its history on this phone. For now that is memory, so a
 *  restart of the service starts empty; the database replaces this one
 *  function and nothing else changes: the rest only knows `SyncStore`. */
export function openSyncStore(deviceId: string, clock: Hlc): SyncStore {
  return new MemoryStore(deviceId, clock, Date.now);
}
