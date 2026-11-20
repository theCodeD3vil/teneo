import { describe, expect, test } from "bun:test";

import { findSecrets, maximumScannedLength, uncheckedLabel } from "./secrets";

test("finds the password in a connection string", () => {
  const text = "postgres://user:pa55@db.example.com/app";
  const [secret] = findSecrets(text);
  expect(text.slice(secret.start, secret.end)).toBe("pa55");
});

test("a long run of letters and dots is scanned quickly", () => {
  const text = "a.".repeat(45_000) + " https://x.y";
  const start = performance.now();
  expect(findSecrets(text)).toEqual([]);
  // unbounded, the URL scheme pattern took over a second here
  expect(performance.now() - start).toBeLessThan(300);
});

describe("the keys added after the 0.4.2 incident", () => {
  const labels = (text: string) =>
    findSecrets(text).map((secret) => secret.label);
  test.each([
    ["Doppler token", `DOPPLER_TOKEN=dp.st.prd.${"a1B2".repeat(11)}`],
    ["Doppler token", `dp.pt.${"Z9y8".repeat(11)}`],
    ["PyPI token", `pypi-AgEIcHlwaS5vcmc${"x".repeat(60)}`],
    ["Sentry token", `sntryu_${"ab".repeat(32)}`],
    ["Sentry token", `sntrys_eyJpYXQiOjE3MDAwMDAwMDB9_${"Qw".repeat(25)}`],
    ["Hugging Face token", `hf_${"AbCd".repeat(8)}Ef`],
    ["Telegram bot token", `123456789:AA${"bC1_-".repeat(6)}abc`],
    [
      "Discord bot token",
      `MTIzNDU2Nzg5MDEyMzQ1Njc4.GhIjKl.${"aB3_-".repeat(6)}xy`,
    ],
    [
      "Slack token",
      "xapp-1-A0123456789-1234567890123-0123456789abcdef0123456789abcdef",
    ],
  ])("finds a %s", (label, text) => {
    expect(labels(text)).toEqual([label]);
  });

  test("leaves ordinary text with dots alone", () => {
    expect(
      findSecrets(
        "See docs.example.com/v1.2.3 and Mr. Smith's notes. Version 10.0.1",
      ),
    ).toEqual([]);
  });
});

describe("long texts", () => {
  const key = `ghp_${"A".repeat(36)}`;

  test("a key far into a long paste is found", () => {
    const text = `${"lorem ipsum ".repeat(250_000)}${key}`;
    expect(findSecrets(text).map((secret) => secret.label)).toEqual([
      "GitHub token",
    ]);
  });

  test("what is past the scanned length counts as unchecked, not as safe", () => {
    const text = "x".repeat(maximumScannedLength + 10) + key;
    const spans = findSecrets(text);
    expect(spans.at(-1)).toEqual({
      start: maximumScannedLength - 1024,
      end: text.length,
      label: uncheckedLabel,
    });
  });

  test("a whole scan of the longest text checked stays quick", () => {
    const text = "word. ".repeat(maximumScannedLength / 6);
    const started = performance.now();
    findSecrets(text);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
