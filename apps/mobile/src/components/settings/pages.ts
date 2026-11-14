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
  /** the icon tile's colours, as on the clipboard cards */
  iconClass: string;
  content: Component;
}

export const settingsPages: Record<SettingsPageName, SettingsPage> = {
  general: {
    title: "General",
    icon: SettingsIcon,
    iconClass: "bg-foreground/10 text-foreground/70",
    content: GeneralTab,
  },
  sync: {
    title: "Sync",
    icon: SyncIcon,
    iconClass: "bg-primary/10 text-primary",
    content: SyncTab,
  },
  storage: {
    title: "Storage",
    icon: StorageIcon,
    iconClass: "bg-warning/10 text-warning",
    content: StorageTab,
  },
  about: {
    title: "About",
    icon: InformationCircleIcon,
    iconClass: "bg-success/10 text-success",
    content: AboutTab,
  },
};
