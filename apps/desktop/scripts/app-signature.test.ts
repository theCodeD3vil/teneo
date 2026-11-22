import { expect, test } from "bun:test";

import {
  inferenceSandboxProblems,
  releaseHelperProblems,
  signatureProblems,
} from "./app-signature.ts";
import { syncDeviceIdentityHelper } from "./build-sync-device-identity.ts";

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

test("allows only App Sandbox on the inference service", () => {
  const name = "TeneoInference.xpc";
  const sandbox = { "com.apple.security.app-sandbox": true };
  expect(inferenceSandboxProblems(name, sandbox)).toEqual([]);
  for (const entitlements of [
    null,
    {},
    { "com.apple.security.app-sandbox": false },
    { ...sandbox, "com.apple.security.network.client": true },
    { ...sandbox, "com.apple.security.files.user-selected.read-only": true },
  ]) {
    expect(inferenceSandboxProblems(name, entitlements)).toEqual([
      `${name} must have only the enabled App Sandbox entitlement`,
    ]);
  }
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

const app = "dist/Teneo Beta.app";
const helper = `${app}/Contents/Helpers/${syncDeviceIdentityHelper}`;
const identity = "01".repeat(20);
const release = { arch: "arm64", identity } as const;

test("checks the exact architecture and release certificate on the app and helper", () => {
  const verified: string[] = [];
  expect(
    releaseHelperProblems(app, release, {
      executable: (path) => path === helper,
      architectures: (path) => (path === helper ? ["arm64"] : []),
      signedBy(path, fingerprint) {
        expect(fingerprint).toBe(identity);
        verified.push(path);
        return true;
      },
    }),
  ).toEqual([]);
  expect(verified).toEqual([app, helper]);
});

test("rejects missing helpers, wrong architectures and other certificates", () => {
  expect(
    releaseHelperProblems(app, release, {
      executable: () => false,
      architectures: () => {
        throw new Error("Unexpected architecture check");
      },
      signedBy: () => {
        throw new Error("Unexpected signature check");
      },
    }),
  ).toEqual([
    `${syncDeviceIdentityHelper} is missing or isn't an executable file`,
  ]);
  expect(
    releaseHelperProblems(app, release, {
      executable: () => true,
      architectures: () => ["x86_64"],
      signedBy: (path) => path === app,
    }),
  ).toEqual([
    `${syncDeviceIdentityHelper} must be built for arm64 (found x86_64)`,
    `${syncDeviceIdentityHelper} isn't signed with the release certificate`,
  ]);
});

test("refuses an ad-hoc identity selector or a loose certificate name", () => {
  for (const identity of ["-", "Teneo Code Signing"]) {
    expect(releaseHelperProblems(app, { ...release, identity })).toEqual([
      "a release needs the exact code-signing certificate fingerprint",
    ]);
  }
});
