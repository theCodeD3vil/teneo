import { describe, expect, test } from "bun:test";

import {
  findContact,
  formatJson,
  tidyText,
} from "@teneo/ui/utils/text-actions";

describe("tidyText", () => {
  test("drops space at line ends and blank lines at both ends", () => {
    expect(tidyText("\n\n  hello  \nworld\t\n\n")).toBe("  hello\nworld");
  });

  test("keeps one blank line where there were several", () => {
    expect(tidyText("one\n\n\n\ntwo")).toBe("one\n\ntwo");
  });

  test("removes the indentation every line shares, and no more", () => {
    expect(tidyText("    if (x) {\n      y();\n    }")).toBe(
      "if (x) {\n  y();\n}",
    );
  });

  test("keeps the spacing inside a line", () => {
    expect(tidyText("a   b")).toBe("a   b");
  });

  test("reads Windows line ends and non-breaking spaces", () => {
    expect(tidyText("a b \r\nc")).toBe("a b\nc");
  });

  test("leaves a tidy text as it is", () => {
    expect(tidyText("one\n\ntwo")).toBe("one\n\ntwo");
  });
});

describe("formatJson", () => {
  test("indents an object", () => {
    expect(formatJson('{"a":1,"b":[true,null]}')).toBe(
      '{\n  "a": 1,\n  "b": [\n    true,\n    null\n  ]\n}',
    );
  });

  test("keeps values character for character", () => {
    expect(formatJson('{"n":12345678901234567890,"x":1.0}')).toBe(
      '{\n  "n": 12345678901234567890,\n  "x": 1.0\n}',
    );
  });

  test("leaves brackets, commas and escapes inside strings alone", () => {
    expect(formatJson('["a,b:{}","q\\"[x]"]')).toBe(
      '[\n  "a,b:{}",\n  "q\\"[x]"\n]',
    );
  });

  test("keeps an empty object or array on one line", () => {
    expect(formatJson('{"a":{ },"b":[]}')).toBe('{\n  "a": {},\n  "b": []\n}');
  });

  test("is null for text that isn't a JSON object or array", () => {
    expect(formatJson("hello")).toBeNull();
    expect(formatJson('"just a string"')).toBeNull();
    expect(formatJson('{"a":}')).toBeNull();
  });
});

describe("findContact", () => {
  test("finds a phone number written with spaces and brackets", () => {
    expect(findContact("Call me on +44 (20) 7946 0958 today")).toEqual({
      kind: "phone",
      value: "+44 (20) 7946 0958",
      url: "tel:+442079460958",
    });
  });

  test("finds an email address", () => {
    expect(findContact("write to sam.lee@example.co.uk please")).toEqual({
      kind: "email",
      value: "sam.lee@example.co.uk",
      url: "mailto:sam.lee@example.co.uk",
    });
  });

  test("takes whichever comes first", () => {
    expect(findContact("a@example.com or 020 7946 0958")?.kind).toBe("email");
    expect(findContact("020 7946 0958 or a@example.com")?.kind).toBe("phone");
  });

  test("doesn't take dates, IP addresses, short codes or long ids for phones", () => {
    expect(findContact("2026-11-15")).toBeNull();
    expect(findContact("192.168.100.200")).toBeNull();
    expect(findContact("code 123456")).toBeNull();
    expect(findContact("card 4111 1111 1111 1111")).toBeNull();
    expect(findContact("order A12345678")).toBeNull();
  });

  test("doesn't look in a long text", () => {
    expect(findContact("x".repeat(200) + " a@example.com")).toBeNull();
  });
});
