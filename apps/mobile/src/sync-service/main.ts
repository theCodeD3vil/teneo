// The sync core as it runs on the phone with no screen: in a web view that a
// foreground service owns (SyncService.java), with native code supplying what
// a page can't (see native.ts). Everything else is the code the Mac runs.
//
// This page never touches the network itself: the service serves it from the
// app and answers every other request with a 404.
import { SyncEngine, fromBase64 } from "@teneo/sync";

import type { ConnectedDevice, NativeSync, SyncPage } from "./native";
import { openSyncStore } from "./store";
import { loggedStore } from "./store-log";
import { PhoneTransport } from "./transport";

/** Put there by `addJavascriptInterface` */
declare const TeneoNative: NativeSync;

const native = TeneoNative;
const log = (line: string) => native.log(line);
// what the page does with items and devices is for people debugging, not for
// the log of every build
const debuggable = native.isDebuggable();

interface Run {
  engine: SyncEngine;
  transport: PhoneTransport;
  stopStatus: number | undefined;
}
let run: Run | null = null;
let starting = false;
// a stop that came while starting: start gives up at its next step
let stopWanted = false;
let allowSecrets = false;

/** Tell native code who is connected: the app's status and device list */
function reportPeers(engine: SyncEngine): void {
  const devices: ConnectedDevice[] = engine
    .peers()
    .map(({ deviceId, name, platform }) => ({ deviceId, name, platform }));
  native.peersChanged(JSON.stringify(devices));
}

const page: SyncPage = {
  async start(encodedKey, syncSecrets) {
    if (run || starting) return;
    starting = true;
    stopWanted = false;
    allowSecrets = syncSecrets;
    try {
      if (!isSecureContext || typeof crypto?.subtle !== "object") {
        native.failed(
          "the page is not a secure context, so it has no WebCrypto",
        );
        return;
      }
      // checked by the app's parsers when it was paired; this only guards
      // against storage handing back something else
      const vaultKey = fromBase64(encodedKey);
      if (vaultKey?.length !== 32) {
        native.failed("the stored key is not a vault key");
        return;
      }
      if (stopWanted) return;

      // The device id is the one made with the database, so a restart is the
      // same device. There is no clock here: a pin is stamped where it is made
      // (HistoryStore.java), and every stamp that is saved from another
      // device is seen by that clock as it is saved.
      const opened = openSyncStore(native);
      const { deviceId } = opened;
      const store = debuggable ? loggedStore(opened.store, log) : opened.store;
      const engine = new SyncEngine({
        deviceId,
        name: native.deviceName(),
        platform: "android",
        vaultKey,
        store,
        syncSecrets: () => allowSecrets,
        onItemsChanged: () => {
          if (debuggable) log("items changed by another device");
        },
        onPeersChanged: () => {
          reportPeers(engine);
          if (debuggable) log(`peers ${describePeers(engine)}`);
        },
        onError: (error) => log(`engine error: ${String(error)}`),
      });
      const transport = new PhoneTransport({
        engine,
        deviceId,
        native,
        onError: (error) => log(`transport error: ${String(error)}`),
      });
      // set before starting: native code begins sending events once told ready
      run = { engine, transport, stopStatus: undefined };
      await transport.start();
      // a stop during that has already taken everything down
      const started = run;
      if (!started) return;
      log(`sync running as ${deviceId.slice(0, 8)}`);
      if (debuggable) {
        started.stopStatus = window.setInterval(() => log(status(run)), 30_000);
      }
    } catch (error) {
      // Nothing is listening for this promise, so say it: otherwise the
      // service's notification stays up over a sync that never started
      if (run) page.stop();
      native.failed(`sync could not start: ${String(error)}`);
    } finally {
      starting = false;
    }
  },

  setSyncSecrets(allowed) {
    const wasAllowed = allowSecrets;
    allowSecrets = allowed;
    // the ones held back go out from the next send
    if (allowed && !wasAllowed) run?.engine.localChanged();
  },

  stop() {
    if (starting) stopWanted = true;
    if (!run) return;
    window.clearInterval(run.stopStatus);
    run.transport.stop();
    run.engine.stop();
    run = null;
    log("sync stopped");
  },

  opened: (id, address, initiator) =>
    run?.transport.opened(id, address, initiator),
  message: (id, message) => run?.transport.message(id, message),
  closed: (id, reason) => run?.transport.closed(id, reason),
  discovered: (deviceId, addresses, port) =>
    run?.transport.found({ deviceId, addresses, port }),
  localChanged: () => run?.engine.localChanged(),

  debug: {
    /** A copy made on this phone, saved as the capture saves one: the
     *  history tells the core, which sends it on. */
    copy(text) {
      if (!debuggable || !run) return;
      // native code answers in JSON and never throws: a failure is in the answer
      const answer = native.debugSaveText(text);
      const failure = (() => {
        try {
          return (JSON.parse(answer) as { error?: string }).error;
        } catch {
          return "no answer";
        }
      })();
      log(
        failure
          ? `the copy was not saved: ${failure}`
          : `copied here "${text.slice(0, 40)}"`,
      );
    },
  },
};

// --- what a person debugging wants to see

function describePeers(engine: SyncEngine): string {
  return (
    engine
      .peers()
      .map((peer) => peer.name)
      .join(", ") || "none"
  );
}

function status(current: Run | null): string {
  if (!current) return "status: not running";
  return `status: peers=${current.engine.peers().length}`;
}

(globalThis as unknown as { teneoSyncPage: SyncPage }).teneoSyncPage = page;
log("page loaded");
native.pageLoaded();
