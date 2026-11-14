const SIZE_UNITS = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"];

/** Bytes in base 1000, as Finder shows them: 178523 → "178.5 kB". */
export function formatFileSize(bytes: number): string {
  const unitIndex = Math.min(
    Math.floor(Math.log10(Math.max(bytes, 1)) / 3),
    SIZE_UNITS.length - 1,
  );
  return new Intl.NumberFormat(undefined, {
    style: "unit",
    unit: SIZE_UNITS[unitIndex],
    unitDisplay: "short",
    maximumFractionDigits: 1,
  }).format(bytes / 1000 ** unitIndex);
}
