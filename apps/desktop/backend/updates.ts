import {
  type UpdateProgress,
  updateProgressEvent,
} from "@teneo/shared/types/windows";

import { getSettings } from "./settings";
import { openUpdateWindow, updateWindowId } from "./windows";

// A push per chunk would flood the page on a fast connection
const progressIntervalMs = 100;

function sendProgress(progress: UpdateProgress, app: TinyApp): void {
  app.window(updateWindowId).push(updateProgressEvent, progress);
}

/** Count the download's bytes as update.install() reads them. */
function trackDownload(response: Response, app: TinyApp): void {
  const total = Number(response.headers.get("content-length")) || null;
  let received = 0;
  let lastSentAt = 0;
  const countedBody = response.body!.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        // performance.now() only moves forward; with Date.now(), setting the
        // Mac's clock back would stop progress until it caught up again
        if (performance.now() - lastSentAt >= progressIntervalMs) {
          lastSentAt = performance.now();
          sendProgress({ received, total }, app);
        }
        controller.enqueue(chunk);
      },
      // Everything has arrived, so the size is known even without a header
      flush() {
        sendProgress({ received, total: received }, app);
      },
    }),
  );
  // update.install() reads the whole download with arrayBuffer()
  response.arrayBuffer = () => new Response(countedBody).arrayBuffer();
}

/** Look for a newer version and ask to install it, for "Check for updates" in
 *  Settings. Only the installed app looks: a dev run has no .app to replace
 *  (tinyjs's own updater makes the same check). */
export async function checkForUpdatesInBackground(app: TinyApp): Promise<void> {
  if (!tjs.exePath.includes(".app/Contents/MacOS/")) return;
  try {
    const { available, current, latest, notes } = await app.update.check();
    if (available && latest) {
      await openUpdateWindow({ current, latest, notes }, app);
    }
  } catch {
    // offline or the release server is down; it looks again next launch
  }
}

const oneDayMs = 24 * 60 * 60 * 1000;

/** Check at launch, then once a day while Teneo runs: a menu bar app can stay
 *  open for weeks. txiki's timers count time the Mac spends asleep, so
 *  overnight sleep doesn't put the check off. */
export function startCheckingForUpdates(app: TinyApp): void {
  const checkIfEnabled = () => {
    if (getSettings().checkForUpdates) void checkForUpdatesInBackground(app);
  };
  checkIfEnabled();
  setInterval(checkIfEnabled, oneDayMs);
}

// The archive is told by the name of what came back, not by the URL asked
// for: update.install() follows redirects one hop at a time, and GitHub
// answers the .zip URL with an empty 302 to a signed blob URL (a bare path
// plus a query string) that carries the bytes. Only that final, successful
// hop is worth counting.
export function isUpdateArchive(url: string, response: Response): boolean {
  if (!response.ok || !response.body) return false;
  const disposition = response.headers.get("content-disposition") ?? "";
  const named = /filename\*?=(?:UTF-8'')?"?([^";]+)/i.exec(disposition)?.[1];
  let name = named ?? "";
  if (!name) {
    try {
      name = new URL(url).pathname.split("/").pop() ?? "";
    } catch {
      name = url;
    }
  }
  try {
    name = decodeURIComponent(name);
  } catch {
    // leave it as sent
  }
  return /\.(zip|tar\.gz|tgz)$/i.test(name);
}

/** Install the available update and relaunch into it. */
export async function installUpdate(app: TinyApp): Promise<void> {
  // update.install() reports no progress, but it downloads through the
  // global fetch, so watch that while it runs
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const response = await originalFetch(input, init);
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (isUpdateArchive(url, response)) trackDownload(response, app);
    return response;
  };
  try {
    await app.update.install();
  } finally {
    globalThis.fetch = originalFetch;
  }
}
