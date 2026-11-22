import { expect, test } from "bun:test";

import { findErrorLine } from "./error-line";

test("copies the original error line, not the model's output or surrounding stack", () => {
  expect(
    findErrorLine(
      'Traceback (most recent call last):\r\n  File "demo.py", line 4, in main\r\n  ValueError: missing flag\r\n',
    ),
  ).toBe("ValueError: missing flag");
});

test("declines without a valid line or beyond the bounded input", () => {
  expect(findErrorLine("We saw an Error: yesterday.")).toBeNull();
  expect(findErrorLine("Error:\nRun the tests")).toBeNull();
  expect(findErrorLine("Error: This is just a heading.")).toBeNull();
  expect(findErrorLine(`Error: ${"a".repeat(4096)}`)).toBeNull();
});
