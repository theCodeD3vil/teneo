import type { FilePreview } from "../shared/types/clipboard";
import { logError, pngDataUrl } from "./files";

const PREVIEW_SIZE = 64;
/** the item preview asks for bigger thumbnails, up to the panel's width */
const MAX_PREVIEW_SIZE = 600;

/** Quick Look preview of a file as a data: URL: its content where macOS can
 *  render it (images, PDFs, video, code), its icon otherwise. A file moved or
 *  deleted since it was copied is missing; one in a folder macOS keeps Teneo
 *  out of, such as Desktop before access is allowed, just has no preview.
 *  Not cached: files change, and a thumbnail takes milliseconds. `size` is in
 *  points; macOS renders it @2x. */
export async function getFilePreview(
  path: unknown,
  size: unknown,
  app: TinyApp,
): Promise<FilePreview> {
  if (typeof path !== "string" || !path.startsWith("/")) {
    return { url: null, isMissing: true };
  }
  try {
    await tjs.stat(path);
  } catch (error) {
    return { url: null, isMissing: !isAccessDenied(error) };
  }
  try {
    const thumbnail = await app.thumbnail(path, previewSize(size));
    return { url: await pngDataUrl(thumbnail.path), isMissing: false };
  } catch (error) {
    // file removed between the stat and the thumbnail
    logError(`filePreview failed for ${path}:`, error);
    return { url: null, isMissing: true };
  }
}

function previewSize(size: unknown): number {
  return typeof size === "number" && size > 0
    ? Math.min(Math.round(size), MAX_PREVIEW_SIZE)
    : PREVIEW_SIZE;
}

/** EPERM: macOS privacy protection (Desktop, Documents, Downloads, iCloud
 *  Drive, other drives). EACCES: the file's own permissions. */
function isAccessDenied(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "EPERM" || code === "EACCES";
}

/** A file's size in bytes, or null for a folder, whose stat size isn't the
 *  size of its contents, or a file that's gone. */
export async function getFileSize(path: string): Promise<number | null> {
  const stats = await tjs.stat(path).catch(() => null);
  return stats && !stats.isDirectory ? stats.size : null;
}
