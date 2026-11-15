// The real parts behind the sync manager: the engine, the database, the Mac.
import { restampSecretItems } from "../database";
import { logError } from "../files";
import { runCommand } from "../run-command";
import { isSyncAvailableIn } from "./availability";
import { startSyncService } from "./service";
import { SyncManager } from "./sync-manager";
import { SqliteSyncStore } from "./sync-store";

// Sync is in every build; TENEO_SYNC=0 switches it off for a run
const isSyncAvailable = () => isSyncAvailableIn(tjs.env);

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
 *  process is told to, and when the app quits. Only with sync switched on:
 *  otherwise a quit is as it was. */
export function stopSyncWhenTold(manager: SyncManager, app: TinyApp): void {
  if (!isSyncAvailable()) return;
  // A quit sends no signal: the window process ends, and the runtime exits
  // this one as soon as `done` settles. So nothing here may wait, and this
  // must be asked for before `init` first awaits: the runtime waits on `done`
  // right after calling `init`, and whoever waited first is told first.
  void app.done.then(
    () => manager.stopAnnouncing(),
    () => manager.stopAnnouncing(),
  );
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    tjs.addSignalListener(signal, () => {
      setTimeout(() => tjs.exit(0), 2000); // never hang on the way out
      void manager.stop().finally(() => tjs.exit(0));
    });
  }
}
