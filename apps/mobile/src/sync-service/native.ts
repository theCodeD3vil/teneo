// The two sides of the bridge between this page and the Android code that owns
// the sockets and Bonjour (SyncRuntime.java). The page can't open a plain
// WebSocket to a device on the network (it is an https page), and can't listen
// at all, so native code does, and the page sees each connection as a Channel.
// The phone's history database is native code's too: see history-bridge.ts.
import type { NativeHistory } from "./history-bridge";

/** What native code gives the page: the object `TeneoNative`. Every call is
 *  quick and never waits on the network. */
export interface NativeSync extends NativeHistory {
  log(line: string): void;
  /** The page is loaded: native code answers by calling `teneoSyncPage.start` */
  pageLoaded(): void;
  /** The page can't run (the key is no good): nothing would help */
  failed(reason: string): void;
  /** Joining with a pairing code: the vault key the Mac sent, base64 */
  paired(vaultKey: string): void;
  takeTrustedConfiguration(): string | null;
  syncIdentityPublicKey(create: boolean): string | null;
  signSyncIdentity(message: string): string | null;
  saveTrustedSnapshot(snapshot: string): boolean;
  trustedJoined(): void;
  enrollmentFingerprint(fingerprint: string): void;
  /** Items with secrets may sync now, and this page knows it: the ones held
   *  back get new change numbers, so they are sent. Called by the page, so no
   *  send of its own can read them before it knows (SyncController). Does
   *  nothing when none is waiting to be sent. */
  restampHeldBackSecrets(): void;
  /** The devices connected now, as a JSON array of `ConnectedDevice` */
  peersChanged(devices: string): void;
  /** The id of this phone's pairing, made anew each time it is paired; ""
   *  for a phone paired before there was one */
  pairingId(): string;
  /** The pairing a device had when the user disconnected it on this phone,
   *  as a JSON string; `null` when it isn't disconnected (KnownDevices.java) */
  removedPairing(deviceId: string): string;
  /** A device disconnected here was paired again: it syncs once more */
  restoreDevice(deviceId: string): void;
  /** A device said it disconnected this phone: a `ConnectedDevice` in JSON */
  removedBy(device: string): void;
  /** Whether sync with a device was ended, by it or on this phone: it is
   *  not dialed */
  isDisconnected(deviceId: string): boolean;
  /** The core has its keys: listen, announce this device and look for the
   *  others, all with the vault's tag */
  ready(tag: string, deviceId: string): void;
  /** Dial `ip:port`. Returns the connection's number at once; `opened` or
   *  `closed` for it follows. Only local addresses are dialed. */
  connect(address: string): number;
  syncNetworkReady(): boolean;
  /** The next of the connections' openings, messages and ends, in the order
   *  they happened, or null (or undefined, as some web views answer) once
   *  there are none: see inbox.ts */
  nextEvent(): string | null | undefined;
  /** Queue a text message. False when it can't be sent. */
  send(connection: number, message: string): boolean;
  close(connection: number, reason: string): void;
  /** A connection from this address failed its handshake: too many and the
   *  address is refused for a while */
  handshakeFailed(address: string): void;
  /** This phone's local addresses as one string: another string means the
   *  network changed */
  networkSignature(): string;
  /** The network changed: announce and look again */
  restartDiscovery(): void;
  /** What this phone is called to the other devices */
  deviceName(): string;
  /** Who made this phone, in lower case ("google"), or "" when unknown */
  deviceMaker(): string;
  /** Which of these app names (a JSON array) the phone has no icon for, as a
   *  JSON array (AppIcons.java) */
  missingAppIcons(names: string): string;
  /** Keep an app's icon, a png in base64. False when it isn't kept. */
  saveAppIcon(name: string, png: string): boolean;
  /** Only a debug build shows what the page does with items */
  isDebuggable(): boolean;
}

/** A device of this vault that Bonjour found */
export interface DiscoveredDevice {
  deviceId: string;
  /** IPv4 addresses, the most likely first */
  addresses: string[];
  port: number;
}

/** A device connected now, as the page tells native code */
export interface ConnectedDevice {
  deviceId: string;
  name: string;
  platform: string;
  /** Who made it, as it said; "" when it didn't */
  maker: string;
  /** Where it is on the network; "" when that isn't known */
  address: string;
  /** The id of its pairing; "" when it said none */
  pairing: string;
}

/** What native code calls on the page: the object `teneoSyncPage`. */
export interface SyncPage {
  /** Run sync with this vault key (base64), which native code keeps. Items
   *  holding secrets travel only while `syncSecrets` is true. */
  start(
    vaultKey: string,
    syncSecrets: boolean,
    /** Joining with a pairing code: vaultKey is its one-time key, and the
     *  Mac at these host:port addresses sends the vault's */
    pairingAddresses?: string[] | null,
    trustedConfiguration?: string,
  ): Promise<void>;
  startTrusted(syncSecrets: boolean): Promise<void>;
  /** The user changed whether items holding secrets travel */
  setSyncSecrets(allowed: boolean): void;
  /** The user disconnected this device, and native code keeps that it is:
   *  tell it, and end the connection to it */
  removeDevice(deviceId: string): void;
  /** End sync: close every connection */
  stop(): void;
  /** Connections have opened, sent messages or ended: take them all with
   *  `nextEvent`. Said again only once the page has found none left. An
   *  opened `address` is `host:port` for a connection this phone dialed, and
   *  the host alone for one that came in. A close may have no reason, and
   *  for a dial that never opened it comes alone. */
  readInbox(): void;
  discovered(deviceId: string, addresses: string[], port: number): void;
  /** The phone's history changed (a copy, a pin, a delete, made in the app or
   *  by the share sheet): send it on */
  localChanged(): void;
  /** Only in a debug build */
  debug: { copy(text: string): void; dial(address: string): void };
}
