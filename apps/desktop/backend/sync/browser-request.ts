// A sync port takes WebSockets from other Teneo devices, and from nothing a
// web page opens: a page in any browser on this Mac or the network could
// otherwise reach it, learn this device's id and use up its tries
// (failedHandshakes). Browsers give themselves away: they add Sec-Fetch-*
// headers and the page's Origin to every WebSocket, and no page can take
// either off. Teneo's peers send neither, except the Mac's own WebSocket
// (txiki), which names the address it connects to as the origin:
// "http://192.168.1.7" for Host "192.168.1.7:47823", "http://::1" for "::1".
// Android's sync network (WebSocketHandshake.isFromWebPage) keeps the same rule.

interface HeaderLookup {
  get(name: string): string | null;
  keys(): Iterable<string>;
}

/** The Host header without its port: a name or IPv4 address loses ":port",
 *  a bracketed IPv6 address "]:port", a bare IPv6 address nothing. */
export function hostWithoutPort(host: string): string {
  if (host.startsWith("[")) return host.slice(0, host.indexOf("]") + 1);
  return host.split(":").length === 2 ? host.slice(0, host.indexOf(":")) : host;
}

export function isFromWebPage(headers: HeaderLookup): boolean {
  for (const name of headers.keys()) {
    if (name.toLowerCase().startsWith("sec-fetch-")) return true;
  }
  const origin = headers.get("origin");
  if (origin === null) return false;
  const host = hostWithoutPort(headers.get("host") ?? "");
  return host === "" || origin.toLowerCase() !== `http://${host.toLowerCase()}`;
}
