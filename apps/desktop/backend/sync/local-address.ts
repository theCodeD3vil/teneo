// Sync connections come from this Mac or the local network, and from nowhere
// else. Not link-safety's isLocalIp: that one is for blocking link previews, so
// it calls anything it cannot read "local", which is the wrong way round here.

/** This Mac itself: 127.0.0.0/8 or ::1, also written as IPv6. Any app on
 *  this Mac, and any page in its browsers, can connect from there. */
export function isLoopbackAddress(address: string): boolean {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  const ip = mapped ? mapped[1]! : address;
  return ip === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip);
}

/** A private, link-local or loopback address, IPv4 or IPv6. Anything that is
 *  not an address at all is not. */
export function isLocalNetworkAddress(address: string): boolean {
  // an IPv4 address written as IPv6 is judged as the IPv4 address it is
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  const ip = mapped ? mapped[1]! : address;

  if (ip.includes(":")) {
    return (
      ip === "::1" ||
      /^fe[89ab][0-9a-f]:/i.test(ip) || // link-local, fe80::/10
      /^f[cd][0-9a-f]{2}:/i.test(ip) // unique local, fc00::/7
    );
  }

  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!match) return false;
  const [first, second, third, fourth] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
  ];
  if ([first, second, third, fourth].some((part) => part > 255)) return false;
  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  );
}

/** Whether a connection's address, with or without its port, is at `host`.
 *  A connection this Mac opened is known by `host:port`, one that came in
 *  by the host alone. */
export function isAtHost(address: string | undefined, host: string): boolean {
  if (!address) return false;
  const colon = address.lastIndexOf(":");
  return (colon < 0 ? address : address.slice(0, colon)) === host;
}

export interface NetworkAddress {
  name: string;
  address: string;
  internal: boolean;
}

/** `ip:port` for each IPv4 address of this Mac that another device on the
 *  network could connect to. Link-local ones are left out: a device that only
 *  has those is not on a network with the Mac. */
export function pairingAddresses(
  interfaces: NetworkAddress[],
  port: number,
): string[] {
  const found = interfaces
    .filter(
      (face) =>
        !face.internal &&
        /^\d+\.\d+\.\d+\.\d+$/.test(face.address) &&
        !face.address.startsWith("169.254.") &&
        isLocalNetworkAddress(face.address),
    )
    .map((face) => `${face.address}:${port}`);
  return [...new Set(found)];
}
