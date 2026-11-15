import type {
  ClipboardListCursor,
  SecretSpan,
} from "@teneo/shared/types/clipboard";

// How the phone's history lists and searches, as HistoryText.java and
// HistoryQueries.java do it natively, for the fake client to behave the same

const DAY_MS = 24 * 60 * 60 * 1000;

/** The sort keys of an item: the list's order and its cursor */
export interface ListKey {
  pinnedAt: number | null;
  dateCopied: number;
  id: string;
}

/** Negative when `a` lists before `b`: pinned first, newest pin first, then
 *  newest copy first, the id breaking ties. Ids compare as sqlite does. */
export function compareListKeys(a: ListKey, b: ListKey): number {
  if ((a.pinnedAt === null) !== (b.pinnedAt === null)) {
    return a.pinnedAt === null ? 1 : -1;
  }
  if (a.pinnedAt !== null && b.pinnedAt !== null && a.pinnedAt !== b.pinnedAt) {
    return b.pinnedAt - a.pinnedAt;
  }
  if (a.dateCopied !== b.dateCopied) return b.dateCopied - a.dateCopied;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

export function isAfterCursor(
  key: ListKey,
  cursor: ClipboardListCursor,
): boolean {
  return compareListKeys(key, cursor) > 0;
}

/** As the app shows a hidden secret: a long one keeps its last 4 characters */
export function maskSecret(secret: string): string {
  return "********" + (secret.length >= 20 ? secret.slice(-4) : "");
}

/** The text a search looks in. With secrets hidden, each secret is found by
 *  what the card shows and by its label, so searching for part of a key
 *  can't reveal which item holds it. */
export function searchableText(
  text: string,
  secrets: SecretSpan[],
  hideSecrets: boolean,
): string {
  if (!hideSecrets || secrets.length === 0) return text;
  let searchable = "";
  let position = 0;
  for (const secret of secrets) {
    if (
      secret.start < position ||
      secret.end > text.length ||
      secret.start > secret.end
    ) {
      continue;
    }
    searchable += text.slice(position, secret.start);
    searchable += `${maskSecret(text.slice(secret.start, secret.end))} ${secret.label} `;
    position = secret.end;
  }
  return searchable + text.slice(position);
}

/** The start of a long text for the list, with the secrets that fit in it.
 *  A secret the cut would split is left out whole. */
export function truncateText(
  text: string,
  secrets: SecretSpan[],
  limit: number,
): { text: string; secrets: SecretSpan[]; isTruncated: boolean } {
  if (text.length <= limit) return { text, secrets, isTruncated: false };
  let cut = limit;
  // never half a surrogate pair
  const code = text.charCodeAt(cut - 1);
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
  for (const secret of secrets) {
    if (secret.start < cut && secret.end > cut) cut = secret.start;
  }
  return {
    text: text.slice(0, cut),
    secrets: secrets.filter((secret) => secret.end <= cut),
    isTruncated: true,
  };
}

/** "Keep history for": items copied before this are deleted; 0 keeps them all */
export function copiedBefore(now: number, retentionDays: number): number {
  return retentionDays > 0 ? now - retentionDays * DAY_MS : 0;
}
