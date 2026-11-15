// The two sides of the bridge between this page and the Android code that owns
// the sockets and Bonjour (SyncRuntime.java). The page can't open a plain
// WebSocket to a device on the network (it is an https page), and can't listen
// at all, so native code does, and the page sees each connection as a Channel.

/** What native code gives the page: the object `TeneoNative`. Every call is
 *  quick and never waits on the network. */
export interface NativeSync {
  log(line: string): void;
  /** The page is loaded: native code answers by calling `teneoSyncPage.start` */
  pageLoaded(): void;
  /** The page can't run (the recovery code is no good): nothing would help */
  failed(reason: string): void;
  /** The core has its keys: listen, announce this device and look for the
   *  others, all with the vault's tag */
  ready(tag: string, deviceId: string): void;
  /** Dial `ip:port`. Returns the connection's number at once; `opened` or
   *  `closed` for it follows. Only local addresses are dialed. */
  connect(address: string): number;
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

/** What native code calls on the page: the object `teneoSyncPage`. Messages
 *  and closes of one connection arrive in order. */
export interface SyncPage {
  /** Run sync with this recovery code */
  start(recoveryCode: string): Promise<void>;
  /** End sync: close every connection */
  stop(): void;
  /** A connection is ready. `address` is `host:port` for one this phone
   *  dialed, and the host alone for one that came in. */
  opened(connection: number, address: string, initiator: boolean): void;
  message(connection: number, message: string): void;
  /** A connection ended, whichever side ended it; `reason` may be empty. For a
   *  dial that never opened it comes alone. */
  closed(connection: number, reason: string): void;
  discovered(deviceId: string, addresses: string[], port: number): void;
  /** Only in a debug build */
  debug: { copy(text: string): void };
}
