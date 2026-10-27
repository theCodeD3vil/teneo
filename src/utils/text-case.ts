export type TextCase =
  | "upper"
  | "lower"
  | "capitalize"
  | "camel"
  | "snake"
  | "kebab";

/** The text in the given case. Joined cases work line by line, so a list of
 *  names stays a list. */
export function convertCase(text: string, textCase: TextCase): string {
  switch (textCase) {
    case "upper":
      return text.toUpperCase();
    case "lower":
      return text.toLowerCase();
    case "capitalize":
      return text
        .toLowerCase()
        .replace(/(^|[^\p{L}\p{N}'’])(\p{L})/gu, (_, before, letter) => {
          return before + letter.toUpperCase();
        });
    case "camel":
      return mapLines(text, (words) =>
        words
          .map((word, index) =>
            index ? capitalizeWord(word) : word.toLowerCase(),
          )
          .join(""),
      );
    case "snake":
      return mapLines(text, (words) => words.join("_").toLowerCase());
    case "kebab":
      return mapLines(text, (words) => words.join("-").toLowerCase());
  }
}

function mapLines(text: string, join: (words: string[]) => string): string {
  return text
    .split("\n")
    .map((line) => join(splitWords(line)))
    .join("\n");
}

// "fooBar baz-qux" and "XMLHttp" split into words at spaces, punctuation and
// lower-to-upper boundaries
function splitWords(line: string): string[] {
  return line
    .replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, "$1 $2")
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function capitalizeWord(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}
