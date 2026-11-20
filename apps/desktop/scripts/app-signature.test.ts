import { expect, test } from "bun:test";

import { signatureProblems } from "./app-signature.ts";

// codesign -dv --verbose=4 of Teneo 0.4.3's teneo, as published
const shipped = `Executable=/Applications/Teneo.app/Contents/MacOS/teneo
Identifier=com.michael.teneo
CodeDirectory v=20500 size=13650 flags=0x10000(runtime) hashes=420+3 location=embedded
Authority=Teneo Code Signing
Timestamp=18 Nov 2026 at 21:28:42
TeamIdentifier=not set`;

test("passes an app signed as releases are", () => {
  expect(signatureProblems("teneo", shipped, "")).toEqual([]);
});

test("flags an app without the hardened runtime, or signed ad hoc", () => {
  expect(
    signatureProblems(
      "teneo",
      shipped.replace("flags=0x10000(runtime)", "flags=0x0(none)"),
      "",
    ),
  ).toEqual(["teneo isn't signed with the hardened runtime"]);
  expect(
    signatureProblems(
      "teneo",
      shipped
        .replace("flags=0x10000(runtime)", "flags=0x2(adhoc)")
        .replace("Authority=Teneo Code Signing", "Signature=adhoc"),
      "",
    ),
  ).toEqual([
    "teneo isn't signed with the hardened runtime",
    "teneo is signed ad hoc, not with Teneo's certificate",
  ]);
});

test("flags an entitlement that lets other code in", () => {
  const entitlements = `<?xml version="1.0"?><plist><dict><key>com.apple.security.cs.disable-library-validation</key><true/><key>com.apple.security.get-task-allow</key><true/></dict></plist>`;
  expect(signatureProblems("tjs", shipped, entitlements)).toEqual([
    "tjs has the entitlement com.apple.security.get-task-allow",
    "tjs has the entitlement com.apple.security.cs.disable-library-validation",
  ]);
});
