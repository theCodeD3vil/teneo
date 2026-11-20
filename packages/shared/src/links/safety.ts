// What a copied link may be fetched for a preview: never this device or the
// local network, and the copied page itself only when opening it is unlikely
// to do anything. The Mac and the phone go by the same rules.
import { findSecrets } from "../detection/secrets";

// Words in links that act when opened, matched as whole words: "auth" but not "author"
const oneTimeLinkWords =
  /(?<![a-z])(?:token|password|passwd|auth|oauth|otp|magic|reset|verify|verification|confirm|activate|invite|login|signin|sign-in|logout|unsubscribe|download)(?![a-z])/i;
// Query parameters that carry a one-time value; as words they're too common
// in ordinary paths ("claude-code", "keyboard-shortcuts")
const oneTimeParameters =
  /[?&](?:code|key|sig|signature|secret|session|state|ticket|nonce)=/i;
const tokenLike = /[\w-]{32,}/;

/** This device, the local network, or an address only it can reach. */
export function isLocalAddress(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (host.startsWith("[")) return isLocalIp(host.slice(1, -1));
  // a name without a dot only means something on the local network
  if (!host.includes(".")) return true;
  if (/\.(?:localhost|local|lan|home|internal|home\.arpa)$/.test(host)) {
    return true;
  }
  return /^[\d.]+$/.test(host) && isLocalIp(host);
}

/** The four numbers of a dotted IPv4 address, or null when it isn't one. */
function parseIpv4(text: string): number[] | null {
  const parts = text.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part)))
    return null;
  const bytes = parts.map(Number);
  return bytes.every((byte) => byte <= 255) ? bytes : null;
}

/** The eight 16-bit groups of an IPv6 address, or null when it isn't one.
 *  Takes the "::" shorthand, a dotted IPv4 tail and a zone ("%en0"). */
function parseIpv6(text: string): number[] | null {
  let address = text.replace(/%.*$/, "");
  // a dotted IPv4 tail is two groups written another way
  const lastColon = address.lastIndexOf(":");
  if (address.slice(lastColon + 1).includes(".")) {
    const ipv4 = parseIpv4(address.slice(lastColon + 1));
    if (!ipv4) return null;
    const high = ((ipv4[0]! << 8) | ipv4[1]!).toString(16);
    const low = ((ipv4[2]! << 8) | ipv4[3]!).toString(16);
    address = `${address.slice(0, lastColon + 1)}${high}:${low}`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const groups = (part: string) =>
    part === ""
      ? []
      : part
          .split(":")
          .map((group) =>
            /^[0-9a-f]{1,4}$/i.test(group) ? parseInt(group, 16) : NaN,
          );
  const head = groups(halves[0]!);
  const rest = halves.length === 2 ? groups(halves[1]!) : [];
  if ([...head, ...rest].some(Number.isNaN)) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const known = head.length + rest.length;
  if (known > 7) return null; // "::" stands for at least one group
  return [...head, ...Array<number>(8 - known).fill(0), ...rest];
}

function isLocalIpv4([a, b, c]: number[]): boolean {
  return (
    a === 0 || // "this network"
    a === 10 ||
    a === 127 ||
    (a === 100 && b! >= 64 && b! <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF, documentation
    (a === 192 && b === 88 && c === 99) || // 6to4 relays
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a! >= 224 // multicast, reserved and broadcast
  );
}

/** The IPv4 address held in two 16-bit groups */
const embeddedIpv4 = (high: number, low: number) => [
  high >> 8,
  high & 0xff,
  low >> 8,
  low & 0xff,
];

function isLocalIpv6(h: number[]): boolean {
  const [h0, h1, h2, h3, h4, h5, h6, h7] = h as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  // NAT64 (64:ff9b::/96) reaches the IPv4 address it holds; the local-use
  // prefix 64:ff9b:1::/48 is the network's own. Both sit inside ::/8, so
  // they come first
  if (h0 === 0x64 && h1 === 0xff9b) {
    if (h2 === 1) return true;
    return (
      h2 !== 0 ||
      h3 !== 0 ||
      h4 !== 0 ||
      h5 !== 0 ||
      isLocalIpv4(embeddedIpv4(h6, h7))
    );
  }
  // ::/8: unspecified, loopback, and IPv4 written as IPv6 (::ffff:7f00:1)
  if (h0 >> 8 === 0) return true;
  if (h0 === 0x100 && h1 === 0 && h2 === 0 && h3 === 0) return true; // discard
  if (h0 === 0x2001 && h1 < 0x200) return true; // IETF: Teredo, benchmarking…
  if (h0 === 0x2001 && h1 === 0xdb8) return true; // documentation
  if (h0 === 0x2002) return isLocalIpv4(embeddedIpv4(h1, h2)); // 6to4
  if (h0 === 0x3fff && h1 >> 12 === 0) return true; // documentation
  if (h0 === 0x5f00) return true; // segment routing
  return (
    (h0 & 0xfe00) === 0xfc00 || // unique local, fc00::/7
    (h0 & 0xff80) === 0xfe80 || // link- and site-local, fe80::/9
    (h0 & 0xff00) === 0xff00 // multicast
  );
}

/** An IPv4 or IPv6 address on this device or the local network, or one no
 *  public site has. What isn't an address at all counts as local. */
export function isLocalIp(ip: string): boolean {
  const address = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (address.includes(":")) {
    const groups = parseIpv6(address);
    return groups === null || isLocalIpv6(groups);
  }
  const bytes = parseIpv4(address);
  return bytes === null || isLocalIpv4(bytes);
}

/** Whether opening this exact page is unlikely to do anything, such as
 *  signing in or using up a reset link. */
export function canOpenPage(url: URL): boolean {
  if (url.username || url.password) return false;
  let pathAndQuery = url.pathname + url.search;
  try {
    pathAndQuery = decodeURIComponent(pathAndQuery);
  } catch {
    // a stray "%": check the text as it is
  }
  if (
    oneTimeLinkWords.test(pathAndQuery) ||
    oneTimeParameters.test(url.search) ||
    tokenLike.test(pathAndQuery)
  ) {
    return false;
  }
  return findSecrets(url.href).length === 0;
}
