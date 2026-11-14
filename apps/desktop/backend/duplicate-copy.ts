// Copying the same thing twice in a row bumps the saved item instead of
// adding a row (see saveClipboardItem). Kept apart from database.ts so it can
// be tested without tjs:sqlite.
import type { ClipboardItemRow } from "./types/clipboard";

/** The newest saved item, with its value decrypted. */
export type LatestCopy = Pick<
  ClipboardItemRow,
  "id" | "kind" | "value" | "path"
>;

/** Whether `item` is the same text, color or file list as `latest`. Images
 *  never match: by now the picture is saved under a new name, and two
 *  screenshots can't be told apart without reading both files. */
export function isRepeatCopy(
  item: TinyClipboardData,
  latest: LatestCopy,
): boolean {
  if (item.kind !== latest.kind) return false;
  switch (item.kind) {
    case "text":
      return item.text !== null && item.text === latest.value;
    case "color":
      return item.color !== null && item.color === latest.value;
    case "files":
      // compared as saved (serializePath): the same files in the same order
      return (
        item.paths.length > 0 && JSON.stringify(item.paths) === latest.path
      );
    default:
      return false;
  }
}
