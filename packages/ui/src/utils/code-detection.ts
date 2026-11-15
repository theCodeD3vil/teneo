// Whether a text is code at all, judged by its shape. The highlighter can
// name a language for any text: its grammars score words, and a paragraph
// that says "button" or "return" a few times scores as CSS or JavaScript.
// So the shape is checked first, and only text that passes is given to it.

// characters code is full of and prose is not; no full stops, commas, quotes,
// colons or dashes, which prose is full of too
const codeCharacters = /[{}[\]();=<>|&$#\\`*+~^]/g;

// a line that starts the way code does
const codeStart = new RegExp(
  "^\\s*(?:" +
    [
      "[}\\])]", // closes a block
      "</?[a-zA-Z][\\w-]*[\\s>/]", // a tag
      "//|/\\*|\\*/|#!|<!--", // a comment
      "@[\\w-]+", // a decorator or an at-rule
      "[.#][\\w-]+[^{]*\\{", // a CSS rule
      "\\$\\s|\\$\\w+\\s*=", // a shell prompt or variable
      "(?:import|export|from|def|class|function|const|let|var|return|public|private|protected|static|async|await|package|using|namespace|interface|type|enum|struct|fn|func|impl|use|echo|sudo)\\s+[\\w\"'{*<(.$@]",
      "(?:if|for|while|switch|catch|elif)\\s*\\(",
      "(?:SELECT|INSERT INTO|UPDATE|DELETE FROM|CREATE|ALTER|DROP)\\s",
    ].join("|") +
    ")",
);
// a line that ends the way code does
const codeEnd = /[;{}]\s*$|[([,]\s*$|\)\s*(?:=>|\{|:)\s*$/;
// an assignment, a call, an arrow, or a key with a quoted or bracketed value
const codeInside =
  /[\w\])]\s*(?:===?|!==?|=>|->|::|\+=|-=|&&|\|\|)\s*\S|\b[\w.]+\([^)]*\)|^\s*[\w$.[\]"'-]+\s*[:=]\s*["'[{(\d]|^\s*"[^"]+"\s*:/;

// a line that reads as a sentence: several plain words in a row
const wordRun = /(?:\p{L}[\p{L}'’-]*[\s,]+){5,}\p{L}/u;
const sentenceEnd = /[.!?…]["')\]]?\s*$/;

function count(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

/** True when the text is shaped like code: most of its lines start, end or
 *  read like code, and it has the punctuation code has. A paragraph is not
 *  code, whatever words it uses. */
export function looksLikeCode(text: string): boolean {
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) return false;

  let codeLines = 0;
  let proseLines = 0;
  for (const line of lines) {
    const isIndented = /^(?: {2,}|\t)\S/.test(line);
    const readsAsProse = wordRun.test(line);
    const isCode =
      codeStart.test(line) ||
      codeEnd.test(line) ||
      codeInside.test(line) ||
      (isIndented && !readsAsProse);
    // a sentence is prose even if it mentions a call or ends in a bracket,
    // unless it also starts or ends as code does
    if (readsAsProse && !(codeStart.test(line) || /[;{}]\s*$/.test(line))) {
      proseLines += 1;
    } else if (isCode) {
      codeLines += 1;
    } else if (sentenceEnd.test(line) && /\p{L}{2,}\s+\p{L}{2,}/u.test(line)) {
      proseLines += 1;
    }
  }

  const letters = count(text, /\p{L}/gu);
  const symbols = count(text, codeCharacters);
  const symbolShare = symbols / Math.max(1, symbols + letters);

  if (proseLines >= codeLines) return false;
  const codeShare = codeLines / lines.length;
  // one line has to be plainly code; several can lean on each other
  if (lines.length === 1) return symbolShare >= 0.05;
  return codeShare >= 0.5 && symbolShare >= 0.03;
}
