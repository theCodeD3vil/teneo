// Finds the link in a copied text. Both apps store what it finds with the
// text, so the Mac and the phone must agree on it.
import type { ClipboardLink } from "../types/clipboard";

/** The link in a copied text, when the whole text is one http(s) URL. */
export function findLink(text: string): ClipboardLink | null {
  const trimmed = text.trim();
  if (trimmed.length > 2048 || /\s/.test(trimmed)) return null;
  if (!/^https?:\/\//i.test(trimmed) || !URL.canParse(trimmed)) return null;
  const url = new URL(trimmed);
  if (!url.hostname) return null;
  return { url: url.href, host: url.hostname.replace(/^www\./, "") };
}
