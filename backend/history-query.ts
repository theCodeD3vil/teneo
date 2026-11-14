// The parts of listing the history that don't touch the database: paging,
// search matching and cutting long texts down for the list. Kept apart from
// database.ts so they can be tested without tjs:sqlite.
import type {
  ClipboardListCursor,
  ClipboardListRequest,
  SecretSpan,
} from "../shared/types/clipboard";
import { textPreviewLength } from "../shared/types/clipboard";

/** The list's order: pinned items first, newest pin first, then newest copy
 *  first. The id breaks ties so paging never skips or repeats an item. */
export const listOrder = `pinnedAt IS NULL, pinnedAt DESC, dateCopied DESC, id DESC`;

/** listOrder for a page past the pinned items. Its WHERE fixes pinnedAt to
 *  NULL, so the two leading terms are constant; left out, sqlite reads the
 *  page straight off the unpinned index instead of sorting the history. */
export const unpinnedOrder = `dateCopied DESC, id DESC`;

/** The ORDER BY of the page after `cursor` (the first page without one). */
export function pageOrder(cursor?: ClipboardListCursor): string {
  return cursor?.pinnedAt === null ? unpinnedOrder : listOrder;
}

/** SQL that keeps only the rows after `cursor` in listOrder, with its values.
 *  Row values, not a chain of ORs: sqlite seeks an index to a row value. */
export function afterCursor(cursor: ClipboardListCursor): {
  condition: string;
  values: unknown[];
} {
  const { pinnedAt, dateCopied, id } = cursor;
  if (pinnedAt === null) {
    return {
      condition: `(pinnedAt IS NULL AND (dateCopied, id) < (?, ?))`,
      values: [dateCopied, id],
    };
  }
  // a NULL pinnedAt makes the row value NULL, so unpinned rows are kept apart
  return {
    condition: `(pinnedAt IS NULL OR (pinnedAt, dateCopied, id) < (?, ?, ?))`,
    values: [pinnedAt, dateCopied, id],
  };
}

/** A LIKE pattern that finds `search` anywhere, with its own wildcards escaped. */
export function likePattern(search: string): string {
  return `%${search.toLowerCase().replace(/[\\%_]/g, "\\$&")}%`;
}

export interface SearchableItem {
  text: string | null;
  secrets: SecretSpan[];
  color: string | null;
  paths: string[];
  sourceAppName: string | null | undefined;
}

/** Whether the item matches `search` (already lower-cased). A masked key is
 *  found by what the card shows and by its kind ("GitHub token"), so searching
 *  for part of it can't reveal which item holds it. */
export function matchesSearch(
  item: SearchableItem,
  search: string,
  maskSecrets: boolean,
): boolean {
  return [
    searchableText(item, maskSecrets),
    item.color,
    item.paths.join(" "),
    item.sourceAppName,
  ].some((value) => value?.toLowerCase().includes(search));
}

function searchableText(
  { text, secrets }: SearchableItem,
  maskSecrets: boolean,
): string | null {
  if (!text || !maskSecrets || !secrets.length) return text;
  const parts: string[] = [];
  let position = 0;
  for (const { start, end, label } of secrets) {
    parts.push(
      text.slice(position, start),
      `${maskSecret(text.slice(start, end))} ${label} `,
    );
    position = end;
  }
  parts.push(text.slice(position));
  return parts.join("");
}

// as src/utils/secrets.ts shows it: a long secret keeps its last 4 characters
function maskSecret(secret: string): string {
  return `********${secret.length >= 20 ? secret.slice(-4) : ""}`;
}

/** The start of a long text for the list, with the secrets that fit in it. A
 *  secret the cut would split is left out whole: a half-shown key would be
 *  masked with the wrong tail, or not masked at all. */
export function truncateTextPreview(
  text: string,
  secrets: SecretSpan[],
  fullLength: number = text.length,
  limit: number = textPreviewLength,
): { text: string; secrets: SecretSpan[]; isTruncated: boolean } {
  if (fullLength <= limit && text.length <= limit) {
    return { text, secrets, isTruncated: false };
  }
  let cut = Math.min(limit, text.length);
  for (const { start, end } of secrets) {
    if (start < cut && end > cut) cut = start;
  }
  return {
    text: text.slice(0, cut),
    secrets: secrets.filter(({ end }) => end <= cut),
    isTruncated: true,
  };
}

const listKinds = new Set(["all", "text", "image", "files", "color"]);
const defaultPageSize = 50;
const maxPageSize = 200;

/** The list request the page sent, with anything missing or malformed
 *  replaced by the default: the first page of everything. */
export function parseListRequest(parameters: unknown): ClipboardListRequest {
  const request = (
    parameters && typeof parameters === "object" ? parameters : {}
  ) as Record<string, unknown>;
  const cursor = request.cursor as Record<string, unknown> | undefined;
  const hasCursor =
    cursor &&
    typeof cursor === "object" &&
    typeof cursor.dateCopied === "number" &&
    typeof cursor.id === "string" &&
    (cursor.pinnedAt === null || typeof cursor.pinnedAt === "number");
  const limit =
    typeof request.limit === "number" && Number.isFinite(request.limit)
      ? Math.min(Math.max(Math.floor(request.limit), 1), maxPageSize)
      : defaultPageSize;
  return {
    kind: listKinds.has(request.kind as string)
      ? (request.kind as ClipboardListRequest["kind"])
      : "all",
    search: typeof request.search === "string" ? request.search : "",
    cursor: hasCursor
      ? {
          pinnedAt: cursor.pinnedAt as number | null,
          dateCopied: cursor.dateCopied as number,
          id: cursor.id as string,
        }
      : undefined,
    limit,
  };
}
