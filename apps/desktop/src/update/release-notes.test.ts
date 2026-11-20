import { describe, expect, test } from "bun:test";

import {
  type NoteElement,
  type NoteNode,
  type NoteTag,
  renderReleaseNotes,
} from "./release-notes";

const allowedTags = new Set<NoteTag>([
  "h1",
  "h2",
  "h3",
  "p",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "del",
  "code",
  "pre",
  "blockquote",
  "hr",
  "br",
  "a",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
]);

function elements(nodes: NoteNode[]): NoteElement[] {
  return nodes.flatMap((node) =>
    typeof node === "string" ? [] : [node, ...elements(node.children)],
  );
}

function text(nodes: NoteNode[]): string {
  return nodes
    .map((node) => (typeof node === "string" ? node : text(node.children)))
    .join("");
}

const payloads = [
  `<img src=x onerror="tiny.api.call('syncPairingInfo')">`,
  `<svg onload=alert(1)>`,
  `<script>alert(1)</script>`,
  `<iframe src="javascript:alert(1)"></iframe>`,
  `<a href="javascript:alert(1)">x</a>`,
  `[x](javascript:alert(1))`,
  `[x](JaVaScRiPt:alert(1))`,
  `[x](  javascript:alert(1))`,
  `[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)`,
  `[x](file:///etc/passwd)`,
  `[x](vnc://attacker.example)`,
  `[x](http://plain.example)`,
  `<http://plain.example>`,
  `![x](https://tracker.example/pixel.png)`,
  `![x" onerror="alert(1)](https://a.example/x.png)`,
  `<details><summary>hi</summary><img src=x onerror=1></details>`,
  `<!-- hidden <img src=x onerror=1> -->`,
  "```html\n<img src=x onerror=1>\n```",
  `**<img src=x onerror=1>**`,
  `- <b onmouseover=alert(1)>item</b>`,
  `| a | <img src=x onerror=1> |\n|---|---|\n| 1 | 2 |`,
  `[link](https://ok.example "title\\" onmouseover=\\"alert(1)")`,
];

describe("renderReleaseNotes", () => {
  test.each(payloads)("renders only known tags and https links: %s", (md) => {
    const all = elements(renderReleaseNotes(md));
    for (const node of all) {
      expect(allowedTags.has(node.tag)).toBe(true);
      if (node.tag === "a")
        expect(new URL(node.href ?? "").protocol).toBe("https:");
      else expect(node.href).toBeUndefined();
    }
  });

  test("drops raw HTML instead of showing or running it", () => {
    const nodes = renderReleaseNotes(
      "Fixed it <img src=x onerror=alert(1)> today\n\n<svg onload=1>",
    );
    expect(text(nodes)).toBe("Fixed it  today");
  });

  test("keeps code as text", () => {
    const nodes = renderReleaseNotes("```\n<img src=x onerror=1>\n```");
    expect(nodes).toEqual([
      {
        tag: "pre",
        children: [{ tag: "code", children: ["<img src=x onerror=1>"] }],
      },
    ]);
  });

  test("keeps https links and unwraps every other kind", () => {
    const nodes = renderReleaseNotes(
      "[site](https://teneo.example/a) [bad](javascript:alert(1)) [old](http://x.example)",
    );
    const links = elements(nodes).filter((node) => node.tag === "a");
    expect(links).toEqual([
      { tag: "a", href: "https://teneo.example/a", children: ["site"] },
    ]);
    expect(text(nodes)).toBe("site bad old");
  });

  test("shows an image's description instead of loading it", () => {
    expect(
      renderReleaseNotes("![The new panel](https://x.example/a.png)"),
    ).toEqual([{ tag: "p", children: ["The new panel"] }]);
  });

  test("decodes entities into text", () => {
    expect(text(renderReleaseNotes("Tom &amp; Jerry &lt;3 &#x1F600;"))).toBe(
      "Tom & Jerry <3 😀",
    );
  });

  test("renders a usual release note", () => {
    const nodes = renderReleaseNotes(
      "## New\n\n- **A taller panel**, so more fits.\n- Faster `search`.\n\n1. one\n2. two",
    );
    expect(nodes).toEqual([
      { tag: "h2", children: ["New"] },
      {
        tag: "ul",
        children: [
          {
            tag: "li",
            children: [
              { tag: "strong", children: ["A taller panel"] },
              ", so more fits.",
            ],
          },
          {
            tag: "li",
            children: ["Faster ", { tag: "code", children: ["search"] }, "."],
          },
        ],
      },
      {
        tag: "ol",
        children: [
          { tag: "li", children: ["one"] },
          { tag: "li", children: ["two"] },
        ],
      },
    ]);
  });
});
