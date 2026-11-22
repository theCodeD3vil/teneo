import { expect, test } from "bun:test";

import { findSecrets } from "@teneo/shared/detection/secrets";
import { possibleCredentialLabel } from "@teneo/shared/types/clipboard";
import { maskSecrets } from "@teneo/ui/utils/secrets";

import { credentialCandidates, mergeCredentialSpans } from "./local-ai-secrets";

test("selects exact values in unfamiliar credential fields", () => {
  const text = [
    "🔒 Password: FrostyKite93!",
    "DATABASE_PASSWORD='a pass with spaces'",
    '{"access_token":"unprefixedZs394nxV4Mx61"}',
    "Authorization: Bearer mW7JOh9_kYe406Cz2QR",
  ].join("\r\n");
  expect(findSecrets(text)).toEqual([]);
  expect(
    credentialCandidates(text).map(({ start, end, context }) => [
      text.slice(start, end),
      context,
    ]),
  ).toEqual([
    ["FrostyKite93!", undefined],
    ["a pass with spaces", undefined],
    ["unprefixedZs394nxV4Mx61", undefined],
    ["mW7JOh9_kYe406Cz2QR", undefined],
  ]);
});

test("only sends redacted context for a candidate in prose", () => {
  const value = "mW7JOh9_kYe406Cz2QR";
  const text = `Send ${value} in the X-Access header.`;
  const [candidate] = credentialCandidates(text);
  expect(candidate?.context).toBe("Send [VALUE] in the X-Access header.");
  expect(text.slice(candidate?.start, candidate?.end)).toBe(value);
});

test("does not flag documented placeholders or ordinary identifiers", () => {
  expect(
    credentialCandidates(
      [
        'PASSWORD="<your password here>"',
        "PASSWORD=$PASSWORD_FROM_VAULT",
        "PASSWORD=your_password_here",
        'password="<put the value here>"',
        "const password = getPassword()",
        "Order reference: WVG-87900-ZQ4-P9M",
      ].join("\n"),
    ),
  ).toEqual([]);
});

test("keeps rule hits and hides the whole value when a contextual span includes the prefix", () => {
  const token = "ghp_" + "a".repeat(36);
  const text = `TOKEN=${token}`;
  const known = findSecrets(text);
  expect(known[0]?.label).toBe("GitHub token");
  const merged = mergeCredentialSpans(known, credentialCandidates(text));
  expect(merged).toHaveLength(1);
  expect(merged[0]?.label).toBe(possibleCredentialLabel);
  expect(
    maskSecrets(text, merged)
      .map((part) => part.text)
      .join(""),
  ).toBe("TOKEN=********");
  expect(mergeCredentialSpans(known, [])).toEqual(known);
});
