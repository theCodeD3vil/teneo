import type { HLJSApi } from "highlight.js";

// Prose scores a few points for words like "if" and "return"; code scores higher
const minCodeRelevance = 8;
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

  const hljs = await loadHighlighter();
  const { language, relevance } = hljs.highlightAuto(text);
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
