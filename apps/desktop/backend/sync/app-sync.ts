// The real parts behind the sync manager: the engine, the database, the Mac.
import { restampSecretItems } from "../database";
import { logError } from "../files";
import { runCommand } from "../run-command";
import { startSyncService } from "./service";
import { SyncManager } from "./sync-manager";
import { SqliteSyncStore } from "./sync-store";

// Sync stays behind this switch until the owner decides to ship it
const isSyncAvailable = () => tjs.env.TENEO_SYNC === "1";

export function createSyncManager(app: TinyApp): SyncManager {
  return new SyncManager(app, {
    available: isSyncAvailable,
    start: startSyncService,
    restampSecretItems,
    forgetPeers: (forApp) => new SqliteSyncStore(forApp).forgetPeers(),
    computerName: () =>
      runCommand(["/usr/sbin/scutil", "--get", "ComputerName"]),
    networkAddresses: () => tjs.system.networkInterfaces,
    log: logError,
  });
}

/** The engine ends what announces this Mac when it stops, so stop it when the
 *  process is told to. Only with sync switched on: otherwise a quit is as it
 *  was. */
export function stopSyncWhenTold(manager: SyncManager): void {
  if (!isSyncAvailable()) return;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    tjs.addSignalListener(signal, () => {
      setTimeout(() => tjs.exit(0), 2000); // never hang on the way out
      void manager.stop().finally(() => tjs.exit(0));
    });
  }
}
