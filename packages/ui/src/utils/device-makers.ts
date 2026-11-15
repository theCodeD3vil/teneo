import type { Component } from "vue";
import AppleIcon from "~icons/tabler/brand-apple-filled";

import GoogleLogo from "../components/device-maker/GoogleLogo.vue";

// A phone says who made it when it connects (Android's Build.MANUFACTURER, in
// lower case). Only these have a logo so far; any other shows none. Google's
// is its own four-colour G; Apple's logo has one colour, the text's.
const makerIcons: Record<string, Component> = {
  google: GoogleLogo,
  apple: AppleIcon,
};

/** The logo of a device's maker, or null when it has none here. */
export function makerIcon(maker: string | null | undefined): Component | null {
  return (maker && makerIcons[maker.toLowerCase()]) || null;
}
