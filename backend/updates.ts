import {
  type UpdateProgress,
  updateProgressEvent,
} from "../shared/types/windows";
import { updateWindowId } from "./windows";

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

/** Install the available update and relaunch into it. */
export async function installUpdate(app: TinyApp): Promise<void> {
  // update.install() reports no progress, but it downloads through the
  // global fetch, so watch that while it runs
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const response = await originalFetch(input, init);
    // It fetches the manifest first; the update itself is the .zip
    if (String(input).endsWith(".zip") && response.body) {
      trackDownload(response, app);
    }
    return response;
  };
  try {
    await app.update.install();
  } finally {
    globalThis.fetch = originalFetch;
  }
}
