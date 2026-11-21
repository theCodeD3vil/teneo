// The sync core as it runs on the phone with no screen: in a web view that a
// foreground service owns (SyncService.java), with native code supplying what
// a page can't (see native.ts). Everything else is the code the Mac runs.
//
// This page never touches the network itself: the service serves it from the
// app and answers every other request with a 404.
import {
  type ConnectedPeer,
  SyncEngine,
  fromBase64,
  toBase64,
} from "@teneo/sync";

import { takeAll } from "./inbox";
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

/** A device as native code keeps it (KnownDevices.java) */
const toDevice = (peer: ConnectedPeer): ConnectedDevice => ({
  deviceId: peer.deviceId,
  name: peer.name,
  platform: peer.platform,
  maker: peer.maker,
  address: peer.address ?? "",
  pairing: peer.pairing,
});

/** Tell native code who is connected: the app's status and device list */
function reportPeers(engine: SyncEngine): void {
  native.peersChanged(JSON.stringify(engine.peers().map(toDevice)));
}

/** The pairing a device had when it was disconnected on this phone, or null */
function removedPairing(deviceId: string): string | null {
  try {
    const pairing: unknown = JSON.parse(native.removedPairing(deviceId));
    return typeof pairing === "string" ? pairing : null;
  } catch {
    return null;
  }
}

const page: SyncPage = {
  async start(encodedKey, syncSecrets, pairingAddresses) {
    if (run || starting) return;
    starting = true;
    stopWanted = false;
    allowSecrets = syncSecrets;
    // allowed while the page wasn't running: the held-back items go out first
    if (syncSecrets) native.restampHeldBackSecrets();
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
        // the Mac shows this maker's logo by the items copied here
        maker: native.deviceMaker() || undefined,
        // the devices the user disconnected on this phone are native code's
        // to keep: one stays away until it is paired again
        pairing: native.pairingId() || undefined,
        removals: {
          removed: async (peerId) => removedPairing(peerId),
          restore: async (peerId) => native.restoreDevice(peerId),
        },
        onRemovedBy: (peer) => {
          log("a device disconnected this phone");
          native.removedBy(JSON.stringify(toDevice(peer)));
        },
        // images sync too: their bytes are files native code keeps
        images: opened.images,
        // a Mac's items say which app they were copied from: ask it for each
        // app's icon once, and keep it for the app's page to show
        iconSink: {
          missing: async (names) => {
            const missing: unknown = JSON.parse(
              native.missingAppIcons(JSON.stringify(names)),
            );
            return Array.isArray(missing)
              ? missing.filter((name) => typeof name === "string")
              : [];
          },
          save: async (name, png) => {
            if (!native.saveAppIcon(name, toBase64(png))) {
              throw new Error(`the icon of ${name} could not be kept`);
            }
          },
        },
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
        // joining with a pairing code: the key is its one-time key, and the
        // Mac sends the vault's, which native code keeps and restarts on
        ...(pairingAddresses && {
          onVaultKey: (key: Uint8Array) => {
            log("joined: the Mac sent the vault key");
            native.paired(toBase64(key));
          },
        }),
      });
      const transport = new PhoneTransport({
        engine,
        deviceId,
        native,
        isDisconnected: (peerId) => native.isDisconnected(peerId),
        onError: (error) => log(`transport error: ${String(error)}`),
        // a used or run-out code is refused by the Mac: nothing to retry
        ...(pairingAddresses && {
          onRefused: (error) => {
            log(`the Mac refused the pairing code: ${error.message}`);
            page.stop();
            native.failed(
              "the pairing code was refused: it was used, or ran out",
            );
          },
        }),
      });
      // set before starting: native code begins sending events once told ready
      run = { engine, transport, stopStatus: undefined };
      await transport.start();
      // a stop during that has already taken everything down
      const started = run;
      if (!started) return;
      // The Mac of the code: at its addresses, as it doesn't announce the
      // code's key. One made-up id for it, as its own comes with the vault's.
      if (pairingAddresses) {
        if (pairingAddresses.length === 0) {
          page.stop();
          native.failed("the pairing code has no address to reach the Mac at");
          return;
        }
        const [, port] = pairingAddresses[0]!.split(/:(?=\d+$)/);
        transport.found({
          deviceId: "f".repeat(32),
          addresses: pairingAddresses.map((address) =>
            address.replace(/:\d+$/, ""),
          ),
          port: Number(port),
        });
      }
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
    if (allowed && !wasAllowed) {
      // Restamped only now that the setting is set here: a send already under
      // way that read them before would have passed over them for good
      native.restampHeldBackSecrets();
      run?.engine.localChanged();
    }
  },

  removeDevice(deviceId) {
    void run?.engine
      .remove(deviceId)
      .catch((error: unknown) => log(`engine error: ${String(error)}`));
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

  readInbox() {
    takeAll(
      () => native.nextEvent(),
      (event) => {
        if (event.kind === "opened") {
          run?.transport.opened(
            event.connection,
            event.address,
            event.initiator,
          );
        } else if (event.kind === "message") {
          run?.transport.message(event.connection, event.message);
        } else run?.transport.closed(event.connection, event.reason);
      },
      (error) => log(`a connection event failed: ${String(error)}`),
    );
  },
  discovered: (deviceId, addresses, port) =>
    run?.transport.found({ deviceId, addresses, port }),
  localChanged: () => run?.engine.localChanged(),

  debug: {
    /** Dial `ip:port` once (DebugSyncReceiver --es dial-address) */
    dial(address) {
      if (!debuggable || !run) return;
      log(`debug: dialing ${address}`);
      run.transport.debugDial(address);
    },
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
