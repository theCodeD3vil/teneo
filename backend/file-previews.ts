import { logError, pngDataUrl } from "./files";

const PREVIEW_SIZE = 64;

/** Quick Look preview of a file as a data: URL: its content where macOS can
 *  render it (images, PDFs, video, code), its icon otherwise. Resolves null
 *  when the file is gone, i.e. moved or deleted since it was copied.
 *  Not cached: files change, and a thumbnail takes milliseconds. */
export async function getFilePreview(
  path: unknown,
  app: TinyApp,
): Promise<string | null> {
  if (typeof path !== "string" || !path.startsWith("/")) return null;
  const stats = await tjs.stat(path).catch(() => null);
  if (!stats) return null;
  try {
    const thumbnail = await app.thumbnail(path, PREVIEW_SIZE);
    return await pngDataUrl(thumbnail.path);
  } catch (error) {
    // file removed between the stat and the thumbnail
    logError(`filePreview failed for ${path}:`, error);
    return null;
  }
}

/** A file's size in bytes, or null for a folder, whose stat size isn't the
 *  size of its contents, or a file that's gone. */
export async function getFileSize(path: string): Promise<number | null> {
  const stats = await tjs.stat(path).catch(() => null);
  return stats && !stats.isDirectory ? stats.size : null;
}
