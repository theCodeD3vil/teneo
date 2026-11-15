// The sync core as it runs on the phone with no screen: in a web view that a
// foreground service owns (SyncService.java), with native code supplying what
// a page can't (see native.ts). Everything else is the code the Mac runs.
//
// This page never touches the network itself: the service serves it from the
// app and answers every other request with a 404.
import {
  Hlc,
  SyncEngine,
  parseRecoveryCode,
  randomBytes,
  toHex,
} from "@teneo/sync";
import { MemoryStore } from "@teneo/sync/testing";

import type { NativeSync, SyncPage } from "./native";
import { openSyncStore } from "./store";
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
  store: ReturnType<typeof openSyncStore>;
  stopStatus: number | undefined;
}
let run: Run | null = null;
let starting = false;

const page: SyncPage = {
  async start(recoveryCode) {
    if (run || starting) return;
    starting = true;
    try {
      if (!isSecureContext || typeof crypto?.subtle !== "object") {
        native.failed(
          "the page is not a secure context, so it has no WebCrypto",
        );
        return;
      }
      const vaultKey = await parseRecoveryCode(recoveryCode);
      if (!vaultKey) {
        native.failed("that is not a valid recovery code");
        return;
      }

      const deviceId = toHex(randomBytes(16));
      const clock = new Hlc(deviceId);
      const store = openSyncStore(deviceId, clock);
      const engine = new SyncEngine({
        deviceId,
        name: native.deviceName(),
        platform: "android",
        vaultKey,
        store,
        clock,
        onItemsChanged: () => {
          if (debuggable) reportItems(store);
        },
        onPeersChanged: () => {
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
      run = { engine, transport, store, stopStatus: undefined };
      await transport.start();
      log(`sync running as ${deviceId.slice(0, 8)}`);
      if (debuggable) {
        run.stopStatus = window.setInterval(() => log(status(run)), 30_000);
      }
    } finally {
      starting = false;
    }
  },

  stop() {
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

  debug: {
    /** A copy made on this phone, to see it reach the other devices. */
    copy(text) {
      if (!debuggable || !run) return;
      // only the in-memory store has a way to copy: the database's own app does that
      if (!(run.store instanceof MemoryStore)) return;
      run.store.copy(text);
      run.engine.localChanged();
      log(`copied here "${text.slice(0, 40)}"`);
    },
  },
};

// --- what a person debugging wants to see

let seenTexts = new Set<string>();

function reportItems(store: Run["store"]): void {
  if (!(store instanceof MemoryStore)) return;
  const texts = store.liveTexts();
  for (const text of texts) {
    if (seenTexts.has(text)) continue;
    seenTexts.add(text);
    log(`item "${text.slice(0, 40)}" total=${texts.length}`);
  }
}

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
  const items =
    current.store instanceof MemoryStore ? current.store.liveTexts().length : 0;
  return `status: peers=${current.engine.peers().length} items=${items}`;
}

(globalThis as unknown as { teneoSyncPage: SyncPage }).teneoSyncPage = page;
log("page loaded");
native.pageLoaded();
