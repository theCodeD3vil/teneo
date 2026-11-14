import {
  type Color,
  clampChroma,
  colorsNamed,
  converter,
  formatHex,
  formatHex8,
  parse,
} from "culori";

const toRgb = converter("rgb");
const toHsl = converter("hsl");
const toOklch = converter("oklch");

// "#ff6347" → "tomato"; the first name wins where two share a value (aqua, cyan)
const namesByHex = new Map<string, string>();
for (const [name, value] of Object.entries(colorsNamed)) {
  const hex = `#${value.toString(16).padStart(6, "0")}`;
  if (!namesByHex.has(hex)) namesByHex.set(hex, name);
}

export interface ColorFormats {
  hex: string;
  /** OKLCH lightness, 0 (black) to 1 (white) */
  lightness: number;
  /** its CSS name, when one is exactly this color */
  name: string | null;
  formats: Array<{ label: string; value: string }>;
}

const SHADE_COUNT = 5;
// Shades stop short of pure white and black, which every color would share
const LIGHTEST = 0.97;
const DARKEST = 0.15;

/** A copied color in the formats the preview lists, or null when it can't be
 *  read, such as a system color ("canvastext") or color-mix(). */
export function getColorFormats(css: string): ColorFormats | null {
  const color = parse(css);
  return color ? describeColor(color) : null;
}

/** Five lighter shades, the color itself, then five darker, lightest first.
 *  Only OKLCH lightness changes, so every shade keeps the color's hue. */
export function getColorShades(css: string): ColorFormats[] {
  const color = parse(css);
  if (!color) return [];

  const oklch = toOklch(color);
  // brought into sRGB first, so a shade's formats all match its swatch
  const shadeAt = (lightness: number) =>
    describeColor(clampChroma({ ...oklch, l: lightness }, "oklch"));
  const steps = Array.from(
    { length: SHADE_COUNT },
    (_, index) => (index + 1) / (SHADE_COUNT + 1),
  );
  return [
    ...[...steps]
      .reverse()
      .map((step) => shadeAt(oklch.l + (LIGHTEST - oklch.l) * step)),
    describeColor(color),
    ...steps.map((step) => shadeAt(oklch.l - (oklch.l - DARKEST) * step)),
  ];
}

function describeColor(color: Color): ColorFormats {
  // A wide-gamut color is mapped into sRGB keeping its hue, not just clipped
  const rgb = toRgb(clampChroma(color, "oklch"));
  const alpha = round(rgb.alpha ?? 1, 3);
  const hsl = toHsl(rgb);
  const oklch = toOklch(color); // from the original, so no precision is lost
  const hex = alpha < 1 ? formatHex8(rgb) : formatHex(rgb);
  const [red, green, blue] = [rgb.r, rgb.g, rgb.b].map((channel) =>
    Math.round(Math.min(Math.max(channel, 0), 1) * 255),
  );
  const alphaSuffix = alpha < 1 ? ` / ${alpha}` : "";

  return {
    hex,
    lightness: oklch.l,
    name: alpha === 1 ? (namesByHex.get(hex) ?? null) : null,
    formats: [
      {
        label: "OKLCH",
        value: `oklch(${round(oklch.l * 100, 2)}% ${round(oklch.c, 3)} ${round(oklch.h ?? 0, 2)}${alphaSuffix})`,
      },
      {
        label: "HSL",
        value: `hsl(${round(hsl.h ?? 0, 1)} ${round(hsl.s * 100, 1)}% ${round(hsl.l * 100, 1)}%${alphaSuffix})`,
      },
      { label: "RGBA", value: `rgba(${red}, ${green}, ${blue}, ${alpha})` },
    ],
  };
}

function round(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}
