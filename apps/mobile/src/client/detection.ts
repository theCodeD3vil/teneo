// What the phone looks for in a copied text: the secrets and the link, as
// the Mac does, and whether it is a colour. The Mac decides that as it reads
// its clipboard and keeps a colour as an item of its own kind; the phone's
// texts arrive from sync and the share sheet too, so here it is found the
// way the rest is, and stored with it.
import { getCssColor } from "@teneo/shared/detection/colors";
import { findLink } from "@teneo/shared/detection/links";
import { findSecrets } from "@teneo/shared/detection/secrets";
import { detectionVersion } from "@teneo/shared/detection/version";
import type { ClipboardLink, SecretSpan } from "@teneo/shared/types/clipboard";

/** Which rules a row was looked at with. The shared rules' version, and the
 *  phone's own after it: raise the last number when what the phone looks for
 *  changes, and every text is looked at again. 1: colours. */
export const phoneDetectionVersion = detectionVersion * 100 + 1;

export interface Found {
  secrets: SecretSpan[];
  link: ClipboardLink | null;
  /** the text itself when it is exactly one CSS colour */
  color: string | null;
}

/** Throws if the rules do. A text that holds a secret is never a colour. */
export function detectIn(text: string): Found {
  const secrets = findSecrets(text);
  return {
    secrets,
    link: findLink(text),
    color: secrets.length === 0 ? getCssColor(text) : null,
  };
}
