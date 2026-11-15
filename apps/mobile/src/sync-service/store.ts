import { type SyncStore } from "@teneo/sync";

import { HistoryBridge, type NativeHistory } from "./history-bridge";
import { NativeSyncStore } from "./native-store";

/** Where sync keeps its history on this phone: the app's own database, which
 *  native code owns. The device id is the one made with it, so a restart is the
 *  same device. The rest only knows `SyncStore`; the in-memory store of
 *  `@teneo/sync/testing` is for tests. */
export function openSyncStore(native: NativeHistory): {
  deviceId: string;
  store: SyncStore;
} {
  const history = new HistoryBridge(native);
  const deviceId = history.deviceId();
  return { deviceId, store: new NativeSyncStore(history, deviceId) };
}
