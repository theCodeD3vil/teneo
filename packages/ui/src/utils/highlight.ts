import type { HLJSApi } from "highlight.js";

import { looksLikeCode } from "./code-detection";
import { formatJson } from "./text-actions";

// The highlighter's score for its best guess. Only text already shaped like
// code is scored, so this weeds out a guess with almost nothing behind it.
const minCodeRelevance = 4;
// Languages the highlighter knows but people rarely copy. Left in, they win
// over the likely ones on a few shared words: SQL was read as Visual Basic.
const unlikelyLanguages = new Set([
  "vbnet",
  "plaintext",
  "php-template",
  "python-repl",
  "wasm",
  "markdown",
]);
// Detection runs every language over the text, which stalls the panel on huge copies
const maxDetectLength = 20_000;

let highlighter: Promise<HLJSApi> | undefined;

// Loaded on the first text preview, so the panel opens without it
function loadHighlighter(): Promise<HLJSApi> {
  highlighter ??= import("highlight.js/lib/common").then(
    (module) => module.default,
  );
  return highlighter;
}

export interface CodeLanguage {
  id: string;
  name: string;
}

/** The language the text is confidently written in, or null for prose. */
export async function detectCodeLanguage(
  text: string,
): Promise<CodeLanguage | null> {
  if (text.length > maxDetectLength) return null;
  // JSON either parses or it doesn't: no guessing needed, and on one line
  // the highlighter takes it for CSS
  if (formatJson(text) !== null) return { id: "json", name: "JSON" };
  // A paragraph scores as a language on its words alone: "button" and
  // "color" are CSS to the highlighter. It is asked only about text that is
  // shaped like code.
  if (!looksLikeCode(text)) return null;

  const hljs = await loadHighlighter();
  const candidates = hljs
    .listLanguages()
    .filter((id) => !unlikelyLanguages.has(id));
  const { language, relevance } = hljs.highlightAuto(text, candidates);
  if (!language || relevance < minCodeRelevance) return null;

  return { id: language, name: hljs.getLanguage(language)?.name ?? language };
}

/** The text as escaped HTML with hljs-* token classes (styled in style.css). */
export async function highlightCode(
  text: string,
  languageId: string,
): Promise<string> {
  const hljs = await loadHighlighter();
  return hljs.highlight(text, { language: languageId, ignoreIllegals: true })
    .value;
}
