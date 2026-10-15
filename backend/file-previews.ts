import { fileExists, logError, pngDataUrl } from "./files";

const PREVIEW_SIZE = 64;

/** Quick Look preview of a file as a data: URL: its content where macOS can
 *  render it (images, PDFs, video, code), its icon otherwise. Resolves null
 *  when the file is gone, i.e. moved or deleted since it was copied.
 *  Not cached: files change, and a thumbnail takes milliseconds. */
export async function getFilePreviewUrl(
  path: unknown,
  app: TinyApp,
): Promise<string | null> {
  if (typeof path !== "string" || !path.startsWith("/")) return null;
  if (!(await fileExists(path))) return null;
  try {
    const thumbnail = await app.thumbnail(path, PREVIEW_SIZE);
    return await pngDataUrl(thumbnail.path);
  } catch (error) {
    // file removed between the check and the thumbnail
    logError(`filePreview failed for ${path}:`, error);
    return null;
  }
}
