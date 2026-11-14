// How devices of one vault find each other on the local network. The sync
// transport only knows this interface; the Mac's is discovery-macos.ts, and
// Windows or Linux can supply theirs.

export interface DiscoveredDevice {
  deviceId: string;
  /** IPv4 addresses, the most likely first. */
  addresses: string[];
  port: number;
}

export interface DiscoveryOptions {
  /** The vault's tag: a device announcing another one is not ours, and is
   *  ignored. */
  tag: string;
  deviceId: string;
  /** The port this device listens on, or null when it doesn't: it then only
   *  looks for the others. */
  port: number | null;
  /** Called each time a device of this vault is found, again if it moves. */
  onDevice(device: DiscoveredDevice): void;
  onError?(error: unknown): void;
}

export interface Discovery {
  start(options: DiscoveryOptions): void;
  /** Announce and look again, after the network changed or the computer woke. */
  restart(): void;
  /** Stop, and end everything started. */
  stop(): void;
  /** The router's address: on a phone's hotspot, the phone. */
  defaultGateway(): Promise<string | null>;
}
