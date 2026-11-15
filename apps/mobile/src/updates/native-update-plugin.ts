import { registerPlugin } from "@capacitor/core";

import type { UpdatePlugin } from "./update-plugin";

/** The Android app's update plugin, registered once */
export const Updates = registerPlugin<UpdatePlugin>("Updates");
