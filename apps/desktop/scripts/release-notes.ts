// The rules a release's notes must meet. They come from the merged PR's title
// and body, and every installed Teneo up to 0.4.3 shows them as HTML in its
// update window, where a script could reach the app's backend. So notes hold
// Markdown only: no raw HTML, no images, and links only to https pages (or
// mail). CI runs this on the notes before it builds:
//   bun scripts/release-notes.ts NOTES_FILE
// It drops HTML comments (PR templates are full of them, and GitHub doesn't
// show them either), writes the file back, and fails on anything else.
/* oxlint-disable no-console -- a command-line script reports on the console */
import { readFileSync, writeFileSync } from "node:fs";

import { marked, type Token } from "marked";

export function cleanNotes(markdown: string): string {
  return markdown
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function allowedLink(href: string, mail: boolean): boolean {
  try {
    const { protocol } = new URL(href);
    return protocol === "https:" || (mail && protocol === "mailto:");
  } catch {
    return false;
  }
}

function walk(tokens: Token[], problems: string[]): void {
  for (const token of tokens) {
    if (token.type === "html") {
      if (token.text.trim())
        problems.push(`raw HTML: ${token.text.trim().slice(0, 80)}`);
      continue;
    }
    if (token.type === "image") {
      problems.push(`an image: ${token.href}`);
      continue;
    }
    if (token.type === "link" && !allowedLink(token.href, true))
      problems.push(`a link that isn't to an https page: ${token.href}`);
    const nested = token as {
      tokens?: Token[];
      items?: { tokens: Token[] }[];
      header?: { tokens: Token[] }[];
      rows?: { tokens: Token[] }[][];
    };
    if (nested.tokens) walk(nested.tokens, problems);
    for (const item of nested.items ?? []) walk(item.tokens, problems);
    for (const cell of nested.header ?? []) walk(cell.tokens, problems);
    for (const row of nested.rows ?? [])
      for (const cell of row) walk(cell.tokens, problems);
  }
}

/** What in the notes no release may carry. None means they are safe to show. */
export function notesProblems(markdown: string): string[] {
  const problems: string[] = [];
  walk(marked.lexer(markdown), problems);
  return problems;
}

if (import.meta.main) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: bun scripts/release-notes.ts NOTES_FILE");
    process.exit(2);
  }
  const notes = cleanNotes(readFileSync(file, "utf8"));
  writeFileSync(file, `${notes}\n`);
  const problems = notesProblems(notes);
  if (problems.length > 0) {
    console.error(
      `::error::The release notes (the merged PR's title and body) can't ship. Edit the PR's description, then re-run this workflow:\n  - ${problems.join("\n  - ")}`,
    );
    process.exit(1);
  }
  console.log("The release notes are plain Markdown.");
}
