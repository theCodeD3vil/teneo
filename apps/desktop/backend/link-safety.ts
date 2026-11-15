// What a copied link may be fetched for: the rules are shared with the phone
// (@teneo/shared/links/safety); looking a name up is the Mac's own.
import { isLocalIp } from "@teneo/shared/links/safety";

export {
  canOpenPage,
  isLocalAddress,
  isLocalIp,
} from "@teneo/shared/links/safety";

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
