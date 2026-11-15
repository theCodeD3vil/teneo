import { describe, expect, test } from "bun:test";

import { looksLikeCode } from "@teneo/ui/utils/code-detection";
import { detectCodeLanguage } from "@teneo/ui/utils/highlight";

const prose = [
  "Tap the button at the bottom of the page, then choose a color for the border. The button should return to its normal size once you let go.",
  "Hey! Can you send me the final copy for the release notes before Friday? I'd like to import them into the doc and check the font, the margin and the width of each section.",
  "Meeting notes:\n- move the search button to the top\n- make the header smaller\n- ask Sam about the table layout",
  "Dear team,\n\nPlease select a date for the offsite from the list below. If none works, let me know and we'll update the calendar.\n\nThanks,\nAlex",
  "Remember to call the function room (the one upstairs) and confirm the booking for 12 people.",
  "Made with care on macOS",
  "https://example.com/path?query=1&other=2",
  "The class starts at 9. Bring your own laptop; the display in the room is broken.",
  "Step 1: open Settings. Step 2: choose Sync. Step 3: scan the code (it's under Add a device).",
];

const code: Array<[string, string]> = [
  [
    "javascript",
    "const debounce = (fn, ms) => {\n  let timer;\n  return (...args) => {\n    clearTimeout(timer);\n    timer = setTimeout(() => fn(...args), ms);\n  };\n};",
  ],
  [
    "css",
    ".button {\n  color: red;\n  border: 1px solid #ccc;\n  padding: 4px 8px;\n}\n\n.button:hover {\n  color: blue;\n}",
  ],
  [
    "python",
    "def greet(name):\n    if not name:\n        return 'Hello'\n    return f'Hello {name}'\n\nprint(greet('Sam'))",
  ],
  [
    "json",
    '{\n  "name": "teneo",\n  "version": "0.1.0",\n  "tabs": ["all", "image"]\n}',
  ],
  [
    "xml",
    '<div class="card">\n  <h1>Title</h1>\n  <p>Some text in a paragraph.</p>\n  <button type="button">Save</button>\n</div>',
  ],
  [
    "sql",
    "SELECT id, name\nFROM users\nWHERE created_at > '2026-01-01'\nORDER BY name;",
  ],
  [
    "bash",
    '#!/bin/bash\nfor file in *.txt; do\n  echo "Processing $file"\n  mv "$file" "${file%.txt}.md"\ndone',
  ],
];

describe("looksLikeCode", () => {
  test.each(prose)("prose is not code: %s", (text) => {
    expect(looksLikeCode(text)).toBe(false);
  });

  test.each(code)("%s is code", (_language, text) => {
    expect(looksLikeCode(text)).toBe(true);
  });

  test("a one-line statement is code", () => {
    expect(
      looksLikeCode("const total = items.reduce((a, b) => a + b, 0);"),
    ).toBe(true);
  });
});

describe("detectCodeLanguage", () => {
  test.each(prose)("names no language for prose: %s", async (text) => {
    expect(await detectCodeLanguage(text)).toBeNull();
  });

  test("names JSON written on one line", async () => {
    expect(
      (await detectCodeLanguage('{"a":1,"b":[1,2],"c":{"d":"e"}}'))?.id,
    ).toBe("json");
  });

  test.each(code)("names %s", async (language, text) => {
    expect((await detectCodeLanguage(text))?.id).toBe(language);
  });
});
