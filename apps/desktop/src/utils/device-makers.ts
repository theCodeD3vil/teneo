import type { Component } from "vue";
import AppleIcon from "~icons/tabler/brand-apple-filled";
import GoogleIcon from "~icons/tabler/brand-google-filled";

// A phone says who made it when it connects (Android's Build.MANUFACTURER, in
// lower case). Only these have a logo so far; any other shows none.
const makerIcons: Record<string, Component> = {
  google: GoogleIcon,
  apple: AppleIcon,
};

/** The logo of a device's maker, or null when it has none here. */
export function makerIcon(maker: string | null | undefined): Component | null {
  return (maker && makerIcons[maker.toLowerCase()]) || null;
}
