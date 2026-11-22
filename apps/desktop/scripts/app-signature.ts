// The signature every Teneo.app must carry. Teneo is signed with its own
// certificate, not an Apple Developer ID, so the hardened runtime is what
// keeps other software on the Mac out of it: with it macOS ignores
// DYLD_INSERT_LIBRARIES, loads only libraries Apple signed, and lets nothing
// attach to the process. That would let it act with Teneo's Accessibility
// grant and read Teneo's keys from the Keychain. tinyjs signs with
// `--options runtime` whenever there is a real identity; this checks that
// it did, and that no entitlement undoes it.
//   bun scripts/app-signature.ts PATH.app [ARCH CERTIFICATE_SHA1]
/* oxlint-disable no-console -- a command-line script reports on the console */
import { spawnSync } from "node:child_process";
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  type MacReleaseArchitecture,
  macReleaseArchitectures,
  syncDeviceIdentityHelper,
} from "./build-sync-device-identity.ts";

/** Entitlements that open a hardened-runtime app back up. */
export const loosening = [
  "com.apple.security.get-task-allow",
  "com.apple.security.cs.debugger",
  "com.apple.security.cs.disable-library-validation",
  "com.apple.security.cs.allow-dyld-environment-variables",
  "com.apple.security.cs.allow-unsigned-executable-memory",
  "com.apple.security.cs.allow-jit",
  "com.apple.security.cs.disable-executable-page-protection",
];

/** What is wrong with one executable's signature, from codesign's output. */
export function signatureProblems(
  name: string,
  details: string,
  entitlements: string,
): string[] {
  const problems: string[] = [];
  const flags = /CodeDirectory [^\n]*flags=0x[0-9a-f]+\(([^)]*)\)/.exec(
    details,
  );
  if (!flags || !flags[1]!.split(",").includes("runtime"))
    problems.push(`${name} isn't signed with the hardened runtime`);
  if (
    /flags=0x[0-9a-f]+\([^)]*adhoc/.test(details) ||
    /Signature=adhoc/.test(details)
  )
    problems.push(`${name} is signed ad hoc, not with Teneo's certificate`);
  for (const key of loosening) {
    if (entitlements.includes(key))
      problems.push(`${name} has the entitlement ${key}`);
  }
  return problems;
}

function codesign(args: string[]) {
  return spawnSync("/usr/bin/codesign", args, { encoding: "utf8" });
}

function codesignOutput(result: ReturnType<typeof codesign>): string {
  // codesign -d writes what it shows to stderr
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

interface ReleaseSignature {
  arch: MacReleaseArchitecture;
  /** The SHA-1 fingerprint returned by `security find-identity`, used only
   *  to select the exact signing certificate. */
  identity: string;
  requireLocalAi?: boolean;
}

interface HelperInspection {
  executable(path: string): boolean;
  architectures(path: string): string[];
  signedBy(path: string, identity: string): boolean;
}

const inspectHelper: HelperInspection = {
  executable(path) {
    const info = lstatSync(path, { throwIfNoEntry: false });
    return info !== undefined && info.isFile() && (info.mode & 0o111) !== 0;
  },
  architectures(path) {
    const result = spawnSync("lipo", ["-archs", path], { encoding: "utf8" });
    return result.status === 0 ? result.stdout.trim().split(/\s+/) : [];
  },
  signedBy(path, identity) {
    return (
      codesign([
        "--verify",
        "--strict",
        `-R=certificate leaf = H"${identity}"`,
        path,
      ]).status === 0
    );
  },
};

export function isSigningCertificateHash(
  identity: unknown,
): identity is string {
  return typeof identity === "string" && /^[0-9a-f]{40}$/i.test(identity);
}

/** Release-only checks. Teneo's own certificate has no Apple TeamIdentifier. */
export function releaseHelperProblems(
  app: string,
  { arch, identity }: ReleaseSignature,
  inspection = inspectHelper,
): string[] {
  if (!isSigningCertificateHash(identity))
    return ["a release needs the exact code-signing certificate fingerprint"];
  const helper = join(app, "Contents", "Helpers", syncDeviceIdentityHelper);
  if (!inspection.executable(helper))
    return [
      `${syncDeviceIdentityHelper} is missing or isn't an executable file`,
    ];
  const problems: string[] = [];
  const architectures = inspection.architectures(helper);
  if (architectures.length !== 1 || architectures[0] !== arch)
    problems.push(
      `${syncDeviceIdentityHelper} must be built for ${arch} (found ${architectures.join(", ") || "no Mach-O architecture"})`,
    );
  if (!inspection.signedBy(app, identity))
    problems.push("the app isn't signed with the release certificate");
  if (!inspection.signedBy(helper, identity))
    problems.push(
      `${syncDeviceIdentityHelper} isn't signed with the release certificate`,
    );
  return problems;
}

export function inferenceSandboxProblems(
  name: string,
  entitlements: unknown,
): string[] {
  if (
    entitlements &&
    typeof entitlements === "object" &&
    Object.keys(entitlements).length === 1 &&
    "com.apple.security.app-sandbox" in entitlements &&
    entitlements["com.apple.security.app-sandbox"] === true
  ) {
    return [];
  }
  return [`${name} must have only the enabled App Sandbox entitlement`];
}

function optionalEntries(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** Every problem with the signatures of an app bundle and the programs in it. */
export function appSignatureProblems(
  app: string,
  release?: ReleaseSignature,
): string[] {
  const macos = join(app, "Contents", "MacOS");
  const helpers = join(app, "Contents", "Helpers");
  const services = join(app, "Contents", "XPCServices");
  const inference = join(services, "TeneoInference.xpc");
  const xpcTargets = optionalEntries(services).flatMap((name) => {
    const path = join(services, name);
    const binaries = join(path, "Contents", "MacOS");
    return [
      path,
      ...optionalEntries(binaries).map((bin) => join(binaries, bin)),
    ];
  });
  const executables = [
    app,
    ...readdirSync(macos).map((name) => join(macos, name)),
    ...optionalEntries(helpers).map((name) => join(helpers, name)),
    ...xpcTargets,
  ];
  const problems = executables.flatMap((path) => {
    const name = path.slice(path.lastIndexOf("/") + 1);
    const details = codesign(["-dv", "--verbose=4", path]);
    const entitlements = codesign(["-d", "--entitlements", "-", "--xml", path]);
    const issues = signatureProblems(
      name,
      details.status === 0 ? codesignOutput(details) : "",
      codesignOutput(entitlements),
    );
    if (entitlements.status !== 0)
      issues.push(`${name}'s entitlements could not be read`);
    if (path === inference || path.startsWith(`${inference}/`)) {
      const parsed = spawnSync(
        "/usr/bin/plutil",
        ["-convert", "json", "-o", "-", "--", "-"],
        {
          input: entitlements.stdout,
          encoding: "utf8",
        },
      );
      issues.push(
        ...inferenceSandboxProblems(
          name,
          parsed.status === 0 ? JSON.parse(parsed.stdout) : null,
        ),
      );
    }
    return issues;
  });
  if (codesign(["--verify", "--strict", "--deep", app]).status !== 0)
    problems.push(`${app} doesn't pass codesign --verify --strict --deep`);
  if (release) problems.push(...releaseHelperProblems(app, release));
  if (release?.requireLocalAi && isSigningCertificateHash(release.identity)) {
    for (const path of [
      join(macos, "teneo-ai-client"),
      join(inference, "Contents", "MacOS", "teneo-ai-service"),
    ]) {
      if (!inspectHelper.executable(path)) {
        problems.push(`${path} is missing or isn't an executable file`);
      } else if (!inspectHelper.signedBy(path, release.identity)) {
        problems.push(`${path} isn't signed with the release certificate`);
      }
    }
  }
  return problems;
}

if (import.meta.main) {
  const [app, archArg, identity, extra] = process.argv.slice(2);
  const arch = macReleaseArchitectures.find((value) => value === archArg);
  if (
    !app ||
    extra ||
    ((archArg !== undefined || identity !== undefined) &&
      (!arch || !isSigningCertificateHash(identity)))
  ) {
    console.error(
      "usage: bun scripts/app-signature.ts PATH.app [arm64|x86_64 CERTIFICATE_SHA1]",
    );
    process.exit(2);
  }
  const problems = appSignatureProblems(
    app,
    arch && identity ? { arch, identity } : undefined,
  );
  if (problems.length > 0) {
    console.error(
      `::error::${app}'s signature is wrong:\n  - ${problems.join("\n  - ")}`,
    );
    process.exit(1);
  }
  console.log(`${app}: hardened runtime, no loosening entitlements`);
}
