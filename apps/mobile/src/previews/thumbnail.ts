// Draws a downloaded image small, in the web view: it reads every format a
// site may use for its icon or share image, .ico and .svg among them, which
// Android's own decoder does not.

/** Screens are 2x to 3.5x: twice the CSS size is sharp enough for a preview */
const pixelsPerCssPixel = 2;
/** A picture with no size of its own (some svgs) is drawn as a square */
const sizeless = 512;

/** `image` no larger than `size` CSS pixels, as a data: URL. An icon stays a
 *  png, which keeps its edges; a larger picture is a webp, a tenth the size.
 *  Null when the web view can't draw it. */
export async function drawThumbnail(
  image: Uint8Array,
  contentType: string,
  size: number,
): Promise<string | null> {
  // an image element never runs what's inside an svg
  const address = URL.createObjectURL(
    new Blob([image as BlobPart], { type: contentType }),
  );
  try {
    const picture = new Image();
    picture.src = address;
    await picture.decode();
    const width = picture.naturalWidth || sizeless;
    const height = picture.naturalHeight || sizeless;
    const box = size * pixelsPerCssPixel;
    const isVector = contentType === "image/svg+xml";
    // a bitmap is never drawn larger than it is
    const scale = Math.min(
      box / Math.max(width, height),
      isVector ? Infinity : 1,
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.imageSmoothingQuality = "high";
    context.drawImage(picture, 0, 0, canvas.width, canvas.height);
    const isIcon = box <= 256;
    const drawn = isIcon
      ? canvas.toDataURL("image/png")
      : canvas.toDataURL("image/webp", 0.85);
    return drawn.startsWith("data:image/") ? drawn : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(address);
  }
}
