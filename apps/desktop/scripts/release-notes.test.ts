import { describe, expect, test } from "bun:test";

import { cleanNotes, notesProblems } from "./release-notes.ts";

describe("cleanNotes", () => {
  test("drops a PR template's comments, even one left open", () => {
    expect(
      cleanNotes(
        "Teneo 0.4.4\n\n<!-- Describe it -->\n\n\n**Faster search**\n<!-- open",
      ),
    ).toBe("Teneo 0.4.4\n\n**Faster search**");
  });
});

describe("notesProblems", () => {
  test("passes plain Markdown, code included", () => {
    expect(
      notesProblems(
        "## New\n\n- **A taller panel**, with [details](https://teneo.example).\n- Mail <help@teneo.example>\n\n```\n<img src=x onerror=1>\n```\n\n`<b>`",
      ),
    ).toEqual([]);
  });

  test("flags raw HTML anywhere, images and links that aren't to https pages", () => {
    expect(
      notesProblems(
        [
          "Fixed <img src=x onerror=alert(1)>",
          "<details><summary>x</summary></details>",
          "- item <b>bold</b>",
          "| a | b |\n|---|---|\n| <svg onload=1> | 2 |",
          "![shot](https://x.example/a.png)",
          "[run](javascript:alert(1)) [file](file:///Applications/Calculator.app) [old](http://x.example)",
        ].join("\n\n"),
      ),
    ).toEqual([
      "raw HTML: <img src=x onerror=alert(1)>",
      "raw HTML: <details><summary>x</summary></details>",
      "raw HTML: <b>",
      "raw HTML: </b>",
      "raw HTML: <svg onload=1>",
      "an image: https://x.example/a.png",
      "a link that isn't to an https page: javascript:alert(1)",
      "a link that isn't to an https page: file:///Applications/Calculator.app",
      "a link that isn't to an https page: http://x.example",
    ]);
  });
});
