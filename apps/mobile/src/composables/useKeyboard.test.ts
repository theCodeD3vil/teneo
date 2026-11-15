import { expect, test } from "bun:test";

import { isKeyboardHeight } from "./useKeyboard";

test("a window that lost a keyboard's worth of height has the keyboard up", () => {
  // the Pixel 6 Pro: 891 tall, 521 with the keyboard
  expect(isKeyboardHeight(891, 521)).toBe(true);
  expect(isKeyboardHeight(891, 891)).toBe(false);
});

test("a small change, such as a browser's bar hiding, is not the keyboard", () => {
  expect(isKeyboardHeight(891, 835)).toBe(false);
  expect(isKeyboardHeight(835, 891)).toBe(false);
});
