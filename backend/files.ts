export async function fileExists(path: string): Promise<boolean> {
  try {
    await tjs.stat(path);
    return true;
  } catch {
    return false;
  }
}

/** A subfolder of the app's data dir, created on first use. */
export async function dataFolder(app: TinyApp, name: string): Promise<string> {
  const folder = `${app.paths.data}/${name}`;
  await tjs.makeDir(folder, { recursive: true });
  return folder;
}

/** A png file as a data: URL. The webview can only load files from its own
 *  folder, so every image the backend makes goes to the page inline. */
export async function pngDataUrl(path: string): Promise<string> {
  const png = await tjs.readFile(path);
  return `data:image/png;base64,${png.toBase64()}`;
}

/** TinyApp has no logger (log() exists only page-side), so errors go to the console. */
export function logError(message: string, error: unknown): void {
  // oxlint-disable-next-line no-console -- the backend's only log output
  console.error(message, error);
}
