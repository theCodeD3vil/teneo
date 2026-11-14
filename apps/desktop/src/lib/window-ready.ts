import { nextTick } from "vue";

/** Windows that the backend opens with show: false (settings, update) call
 *  this once the data their first frame needs is in, so the window appears
 *  already painted instead of as a blank sheet while the bundle loads.
 *  Only microtasks here: in a hidden window WebKit never fires
 *  requestAnimationFrame and aligns setTimeout to whole seconds, so either
 *  would hold the window back for no reason. nextTick is enough for Vue to
 *  flush the render; WebKit paints before the surfaced window is composited. */
export async function showWindowWhenPainted(
  ready: Promise<unknown> = Promise.resolve(),
): Promise<void> {
  await ready.catch(() => undefined);
  await nextTick();
  await tiny.win.show();
}
