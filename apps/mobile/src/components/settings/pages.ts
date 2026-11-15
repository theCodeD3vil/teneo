import type { Component } from "vue";
import StorageIcon from "~icons/tabler/database";
import InformationCircleIcon from "~icons/tabler/info-circle";
import SyncIcon from "~icons/tabler/refresh";
import SettingsIcon from "~icons/tabler/settings";

import type { SettingsPageName } from "../../composables/useNavigation";
import AboutTab from "./AboutTab.vue";
import GeneralTab from "./GeneralTab.vue";
import StorageTab from "./StorageTab.vue";
import SyncTab from "./SyncTab.vue";

export interface SettingsPage {
  title: string;
  icon: Component;
  /** the page's tint, as on the clipboard cards: its tile on the settings
   *  screen, and the icon and summary on that tile */
  tileClass: string;
  inkClass: string;
  subClass: string;
  content: Component;
}

export const settingsPages: Record<SettingsPageName, SettingsPage> = {
  general: {
    title: "General",
    icon: SettingsIcon,
    tileClass: "bg-tint-neutral",
    inkClass: "text-tint-neutral-ink",
    subClass: "text-tint-neutral-sub",
    content: GeneralTab,
  },
  sync: {
    title: "Sync",
    icon: SyncIcon,
    tileClass: "bg-tint-blue",
    inkClass: "text-tint-blue-ink",
    subClass: "text-tint-blue-sub",
    content: SyncTab,
  },
  storage: {
    title: "Storage",
    icon: StorageIcon,
    tileClass: "bg-tint-amber",
    inkClass: "text-tint-amber-ink",
    subClass: "text-tint-amber-sub",
    content: StorageTab,
  },
  about: {
    title: "About",
    icon: InformationCircleIcon,
    tileClass: "bg-tint-mint",
    inkClass: "text-tint-mint-ink",
    subClass: "text-tint-mint-sub",
    content: AboutTab,
  },
};
