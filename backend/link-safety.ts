// What a copied link may be fetched for: never this Mac or the local network,
// and the copied page itself only when opening it is unlikely to do anything.
import { findSecrets } from "./secret-detection";

// Words in links that act when opened, matched as whole words: "auth" but not "author"
const oneTimeLinkWords =
  /(?<![a-z])(?:token|password|passwd|auth|oauth|otp|magic|reset|verify|verification|confirm|activate|invite|login|signin|sign-in|logout|unsubscribe|download)(?![a-z])/i;
// Query parameters that carry a one-time value; as words they're too common
// in ordinary paths ("claude-code", "keyboard-shortcuts")
const oneTimeParameters =
  /[?&](?:code|key|sig|signature|secret|session|state|ticket|nonce)=/i;
const tokenLike = /[\w-]{32,}/;

/** This Mac, the local network, or an address only it can reach. */
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

/** An IPv4 or IPv6 address on this Mac or the local network. */
export function isLocalIp(ip: string): boolean {
  const address = ip.toLowerCase();
  if (address.includes(":")) {
    return (
      // "::" is this host, "::1" loopback, "::ffff:..." an IPv4 address written
      // as IPv6 (the URL parser turns ::ffff:127.0.0.1 into ::ffff:7f00:1)
      address.startsWith("::") ||
      /^f[cd]/.test(address) || // unique local, fc00::/7
      /^fe[89ab]/.test(address) // link-local, fe80::/10
    );
  }
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !(part >= 0 && part <= 255))) {
    return true; // not an address a public site would have
  }
  const [first, second] = parts;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

/** Whether a site's name leads to this Mac or the local network, e.g. a
 *  router's or NAS's own domain. Fetching it would make macOS ask to let
 *  Teneo find devices on the local network. Rejects when the name can't be
 *  looked up, so the preview is tried again later. */
export async function resolvesToLocalAddress(url: URL): Promise<boolean> {
  if (url.hostname.startsWith("[") || /^[\d.]+$/.test(url.hostname)) {
    return false; // an address, already checked by isLocalAddress
  }
  const addresses = await tjs.lookup(url.hostname, { all: true });
  return [addresses].flat().some((address) => isLocalIp(address.ip));
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
