// What a copied link may be fetched for: the rules are shared with the phone
// (@teneo/shared/links/safety); looking a name up is the Mac's own.
import { isLocalIp } from "@teneo/shared/links/safety";

export {
  canOpenPage,
  isLocalAddress,
  isLocalIp,
} from "@teneo/shared/links/safety";

/** The address to fetch `url` from, or null when its name leads to this Mac
 *  or the local network, e.g. a router's or NAS's own domain: fetching that
 *  would make macOS ask to let Teneo find devices on the local network. The
 *  fetch must then go to this address and no other (pinnedGet): looking the
 *  name up again could answer differently. Rejects when the name can't be
 *  looked up, so the preview is tried again later. */
export async function publicAddressOf(url: URL): Promise<string | null> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host.includes(":") || /^[\d.]+$/.test(host)) {
    return isLocalIp(host) ? null : host;
  }
  const answers = [await tjs.lookup(host, { all: true })].flat();
  if (answers.length === 0 || answers.some((answer) => isLocalIp(answer.ip)))
    return null;
  return answers[0]!.ip;
}
