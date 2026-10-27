import { expect, test } from "bun:test";

import { findSecrets } from "./secret-detection";

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
