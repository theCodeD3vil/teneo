import { registerPlugin } from "@capacitor/core";

import type { SyncPlugin } from "./sync-plugin";

/** The Android app's sync plugin. Registered here once: Capacitor refuses a
 *  second registration of the same name. */
export const Sync = registerPlugin<SyncPlugin>("Sync");
