import { marked, type Token, type Tokens } from "marked";

// Release notes come from a merged PR's description, so they are rendered as
// a tree of a few known tags with text in between, never as HTML. Raw HTML in
// the Markdown is dropped, and a link stays a link only when it goes to an
// https page.

export type NoteTag =
  | "h1"
  | "h2"
  | "h3"
  | "p"
  | "ul"
  | "ol"
  | "li"
  | "strong"
  | "em"
  | "del"
  | "code"
  | "pre"
  | "blockquote"
  | "hr"
  | "br"
  | "a"
  | "table"
  | "thead"
  | "tbody"
  | "tr"
  | "th"
  | "td";

export interface NoteElement {
  tag: NoteTag;
  /** only on "a", and always an https URL */
  href?: string;
  /** only on "ol" */
  start?: number;
  children: NoteNode[];
}

export type NoteNode = string | NoteElement;

export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

const entities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

// marked leaves entities as typed; the HTML it used to make showed them
// decoded, and a text node would show them literally
function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi,
    (match, name: string) => {
      if (name[0] !== "#") return entities[name.toLowerCase()] ?? match;
      const code =
        name[1] === "x" || name[1] === "X"
          ? Number.parseInt(name.slice(2), 16)
          : Number.parseInt(name.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    },
  );
}

const element = (
  tag: NoteTag,
  children: NoteNode[] = [],
  extra: Partial<NoteElement> = {},
): NoteElement => ({ tag, children, ...extra });

function headingTag(depth: number): NoteTag {
  if (depth <= 1) return "h1";
  return depth === 2 ? "h2" : "h3";
}

function renderTokens(tokens: Token[] | undefined): NoteNode[] {
  return (tokens ?? []).flatMap(renderToken);
}

function renderToken(token: Token): NoteNode[] {
  switch (token.type) {
    case "space":
    case "html": // raw HTML is never shown, not even as text
    case "def":
    case "checkbox":
      return [];
    case "heading":
      return [element(headingTag(token.depth), renderTokens(token.tokens))];
    case "paragraph":
      return [element("p", renderTokens(token.tokens))];
    case "blockquote":
      return [element("blockquote", renderTokens(token.tokens))];
    case "hr":
      return [element("hr")];
    case "br":
      return [element("br")];
    case "code":
      return [element("pre", [element("code", [token.text])])];
    case "codespan":
      return [element("code", [decodeEntities(token.text)])];
    case "strong":
    case "em":
    case "del":
      return [element(token.type, renderTokens(token.tokens))];
    case "list": {
      const list = token as Tokens.List;
      const items = list.items.map((item) =>
        element("li", renderTokens(item.tokens)),
      );
      if (!list.ordered) return [element("ul", items)];
      const start = typeof list.start === "number" ? list.start : 1;
      return [element("ol", items, start === 1 ? {} : { start })];
    }
    case "table": {
      const table = token as Tokens.Table;
      const cell = (tag: "th" | "td", c: Tokens.TableCell) =>
        element(tag, renderTokens(c.tokens));
      return [
        element("table", [
          element("thead", [
            element(
              "tr",
              table.header.map((c) => cell("th", c)),
            ),
          ]),
          element(
            "tbody",
            table.rows.map((row) =>
              element(
                "tr",
                row.map((c) => cell("td", c)),
              ),
            ),
          ),
        ]),
      ];
    }
    case "link": {
      const children = renderTokens(token.tokens);
      return isHttpsUrl(token.href)
        ? [element("a", children, { href: token.href })]
        : children;
    }
    // An image would load from wherever the notes point as soon as the window
    // opens; its description says what it showed
    case "image":
      return token.text ? [decodeEntities(token.text)] : [];
    case "escape":
      return [token.text];
    case "text":
      return "tokens" in token && token.tokens
        ? renderTokens(token.tokens)
        : [decodeEntities(token.text)];
    default: {
      // anything newer than this list shows its text, never its markup
      const other = token as { tokens?: unknown; text?: unknown };
      if (Array.isArray(other.tokens))
        return renderTokens(other.tokens as Token[]);
      return typeof other.text === "string" ? [decodeEntities(other.text)] : [];
    }
  }
}

export function renderReleaseNotes(markdown: string): NoteNode[] {
  return renderTokens(marked.lexer(markdown));
}
