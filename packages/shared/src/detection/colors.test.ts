import { expect, test } from "bun:test";

import { getCssColor } from "./colors";

test("a text that is exactly one CSS colour is a colour", () => {
  for (const color of [
    "#fff",
    "#1122AA",
    "#11223344",
    "  #1122aa \n",
    "red",
    "RebeccaPurple",
    "transparent",
    "rgb(1, 2, 3)",
    "rgba(1, 2, 3, 0.5)",
    "rgb(1 2 3 / 50%)",
    "hsl(120deg 50% 50%)",
    "oklch(60% 0.15 50)",
    "color(display-p3 1 0 0)",
    "color-mix(in srgb, red 40%, blue)",
    "light-dark(#fff, #000)",
  ]) {
    expect(getCssColor(color)).toBe(color.trim());
  }
});

test("anything else is not", () => {
  for (const text of [
    "",
    null,
    "#12",
    "#12345",
    "#ggg",
    "the sky is blue",
    "blue sky",
    "bluish",
    "rgb(1, 2)",
    "rgb(a, b, c)",
    "hsl(120, 50, 50)",
    "color: #fff;",
    "#fff #000",
  ]) {
    expect(getCssColor(text)).toBeNull();
  }
});
