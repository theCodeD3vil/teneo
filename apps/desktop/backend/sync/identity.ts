import { Hlc, isDeviceId, randomBytes, toHex } from "@teneo/sync";
import type { Database } from "tjs:sqlite";

import { devName } from "../dev-run";
import { all } from "../sqlite";

export interface SyncIdentity {
  deviceId: string;
  /** Stamps every pin made on this device. The sync engine learns the stamps
   *  of other devices through the same clock, so a pin made after seeing theirs
   *  is always the larger one. */
  clock: Hlc;
}

// a dev run is a device of its own, never the installed app
const deviceIdStoreKey = () => devName("syncDeviceId");

/** Read this device's id, or make it: 128 random bits, kept for good. */
export async function loadSyncIdentity(
  app: TinyApp,
  database: Database,
): Promise<SyncIdentity> {
  let deviceId: unknown = await app.store.get(deviceIdStoreKey());
  if (!isDeviceId(deviceId)) {
    deviceId = toHex(randomBytes(16));
    await app.store.set(deviceIdStoreKey(), deviceId);
  }
  const clock = new Hlc(deviceId as string);
  const [latest] = all<{ stamp: string | null }>(
    database,
    `SELECT max(pinnedStamp) AS stamp FROM "CLIPBOARD_ITEMS"`,
  );
  if (latest?.stamp) clock.observe(latest.stamp);
  return { deviceId: deviceId as string, clock };
}
