// What a text preview can do with a text besides copying it: tidy it, lay
// out JSON, and act on a phone number or an email address found in it.

/** The text cleaned up for pasting: no stray space at line ends, no blank
 *  lines at either end, no more than one blank line in a row, and no
 *  indentation that every line shares. Spacing inside a line is kept, so code
 *  and tables stay aligned. */
export function tidyText(text: string): string {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .replace(/[   ]/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""));

  const indents = lines
    .filter((line) => line.length > 0)
    .map((line) => /^[ \t]*/.exec(line)?.[0].length ?? 0);
  const sharedIndent = indents.length ? Math.min(...indents) : 0;

  return lines
    .map((line) => line.slice(sharedIndent))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");
}

/** Past this much, a text isn't checked for JSON: parsing it would stall the page */
const jsonLimit = 200_000;

/** The text laid out as indented JSON, or null if it isn't a JSON object or
 *  array. Only the space between values changes: every value is kept
 *  character for character, so long numbers and key order survive. */
export function formatJson(text: string): string | null {
  const source = text.trim();
  if (source.length > jsonLimit || !/^[{[]/.test(source)) return null;
  try {
    JSON.parse(source);
  } catch {
    return null;
  }

  let result = "";
  let depth = 0;
  const newLine = () => "\n" + "  ".repeat(depth);

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (character === '"') {
      // a string is copied whole, escapes and all
      let end = index + 1;
      while (source[end] !== '"') end += source[end] === "\\" ? 2 : 1;
      result += source.slice(index, end + 1);
      index = end;
    } else if (character === "{" || character === "[") {
      const closing = character === "{" ? "}" : "]";
      let next = index + 1;
      while (/\s/.test(source[next] ?? "")) next += 1;
      if (source[next] === closing) {
        // an empty object or array stays on one line
        result += character + closing;
        index = next;
      } else {
        depth += 1;
        result += character + newLine();
      }
    } else if (character === "}" || character === "]") {
      depth -= 1;
      result += newLine() + character;
    } else if (character === ",") {
      result += "," + newLine();
    } else if (character === ":") {
      result += ": ";
    } else if (!/\s/.test(character)) {
      result += character;
    }
  }
  return result;
}

export interface Contact {
  kind: "phone" | "email";
  /** as written in the text */
  value: string;
  /** what opens the phone's dialler or mail app */
  url: string;
}

/** A short text is looked at for a contact; a long one is prose or code,
 *  where a run of digits is rarely a phone number */
const contactTextLimit = 200;

const emailPattern = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
// digits with the spaces, dots, dashes and brackets phone numbers are written with
const phonePattern = /(?<![\w.])\+?\(?\d[\d\s().-]{5,}\d(?![\w])/g;

/** The first email address or phone number in a short text, or null. */
export function findContact(text: string): Contact | null {
  if (text.length > contactTextLimit) return null;

  const email = emailPattern.exec(text);
  const phone = findPhone(text);
  if (email && (!phone || email.index < phone.index)) {
    return { kind: "email", value: email[0], url: `mailto:${email[0]}` };
  }
  if (!phone) return null;
  const digits = phone.value.replace(/[^\d+]/g, "");
  return { kind: "phone", value: phone.value, url: `tel:${digits}` };
}

function findPhone(text: string): { value: string; index: number } | null {
  for (const match of text.matchAll(phonePattern)) {
    const value = match[0];
    const digitCount = value.replace(/\D/g, "").length;
    // 8 to 15 digits is a phone number; fewer is a code, more a card or an id
    if (digitCount < 8 || digitCount > 15) continue;
    // dates, times, versions and IP addresses are digits with separators too
    if (/^\d{1,4}[-./]\d{1,2}[-./]\d{1,4}$/.test(value)) continue;
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) continue;
    return { value, index: match.index };
  }
  return null;
}
