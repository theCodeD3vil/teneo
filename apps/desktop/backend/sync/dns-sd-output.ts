// What macOS's `dns-sd` prints, read back into values. Only the parts Teneo
// needs: which instances of a service appear and go, where one can be reached
// with what TXT, and the addresses of a host.

export interface BrowseEvent {
  added: boolean;
  /** The instance name; it may contain spaces. */
  name: string;
}

/** A line of `dns-sd -B <type> local`, when it is an Add or Rmv of `serviceType`.
 *  The same instance shows once for every network interface it is on. */
export function parseBrowseLine(
  line: string,
  serviceType: string,
): BrowseEvent | null {
  const match =
    /^\d\d:\d\d:\d\d\.\d+\s+(Add|Rmv)\s+\d+\s+\d+\s+\S+\s+(\S+)\s+(.+?)\s*$/.exec(
      line,
    );
  if (!match || match[2] !== `${serviceType}.`) return null;
  return { added: match[1] === "Add", name: match[3]! };
}

export interface ResolvedService {
  host: string;
  port: number;
  txt: Record<string, string>;
}

/** `dns-sd -L` says where an instance can be reached on one line, and its TXT
 *  on the next. Feed it the lines; it answers once it has both. */
export class LookupReader {
  private reached: { host: string; port: number } | null = null;

  feed(line: string): ResolvedService | null {
    const reached = /can be reached at (\S+):(\d+) \(interface \d+\)/.exec(
      line,
    );
    if (reached) {
      this.reached = { host: reached[1]!, port: Number(reached[2]) };
      return null;
    }
    if (this.reached && /^\s/.test(line)) {
      const resolved = { ...this.reached, txt: parseTxt(line) };
      this.reached = null;
      return resolved;
    }
    return null;
  }
}

/** ` vt=0123 dev=abcd` as {vt: "0123", dev: "abcd"}. */
export function parseTxt(line: string): Record<string, string> {
  const txt: Record<string, string> = {};
  for (const pair of line.trim().split(/\s+/)) {
    const at = pair.indexOf("=");
    if (at > 0) txt[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return txt;
}

/** A line of `dns-sd -G v4 <host>`: an address the host has. */
export function parseAddressLine(line: string): string | null {
  const match =
    /^\d\d:\d\d:\d\d\.\d+\s+Add\s+\S+\s+\d+\s+\S+\s+(\d{1,3}(?:\.\d{1,3}){3})\s+\d+\s*$/.exec(
      line,
    );
  return match ? match[1]! : null;
}

/** Addresses on the network first, then this Mac's own: a device on this very
 *  Mac answers on either, but one on the network only on the first. */
export function orderAddresses(addresses: string[]): string[] {
  const unique = [...new Set(addresses)];
  const onNetwork = unique.filter((address) => !address.startsWith("127."));
  return [...onNetwork, ...unique.filter((a) => a.startsWith("127."))];
}

/** The router's address from `route -n get default`; on a phone's hotspot, the phone. */
export function parseGateway(output: string): string | null {
  const match = /^\s*gateway:\s*(\d{1,3}(?:\.\d{1,3}){3})\s*$/m.exec(output);
  return match ? match[1]! : null;
}
