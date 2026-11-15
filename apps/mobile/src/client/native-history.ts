import { registerPlugin } from "@capacitor/core";

import type { HistoryPlugin } from "./history-plugin";

/** The Android app's history plugin. Registered here once: Capacitor
 *  refuses a second registration of the same name. */
export const History = registerPlugin<HistoryPlugin>("History");
