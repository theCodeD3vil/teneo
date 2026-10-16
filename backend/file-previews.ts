import { logError, pngDataUrl } from "./files";

const PREVIEW_SIZE = 64;

/** What a card shows for a file on disk. */
interface FilePreview {
  /** data: URL of the Quick Look thumbnail */
  url: string;
  /** bytes; null for a folder, whose stat size isn't the size of its contents */
  size: number | null;
}

/** Quick Look preview of a file: its content where macOS can render it
 *  (images, PDFs, video, code), its icon otherwise. Resolves null when the
 *  file is gone, i.e. moved or deleted since it was copied.
 *  Not cached: files change, and a thumbnail takes milliseconds. */
export async function getFilePreview(
  path: unknown,
  app: TinyApp,
): Promise<FilePreview | null> {
  if (typeof path !== "string" || !path.startsWith("/")) return null;
  const stats = await tjs.stat(path).catch(() => null);
  if (!stats) return null;
  try {
    const thumbnail = await app.thumbnail(path, PREVIEW_SIZE);
    return {
      url: await pngDataUrl(thumbnail.path),
      size: stats.isDirectory ? null : stats.size,
    };
  } catch (error) {
    // file removed between the stat and the thumbnail
    logError(`filePreview failed for ${path}:`, error);
    return null;
  }
}
