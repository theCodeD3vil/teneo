// The signature every Teneo.app must carry. Teneo is signed with its own
// certificate, not an Apple Developer ID, so the hardened runtime is what
// keeps other software on the Mac out of it: with it macOS ignores
// DYLD_INSERT_LIBRARIES, loads only libraries Apple signed, and lets nothing
// attach to the process. That would let it act with Teneo's Accessibility
// grant and read Teneo's keys from the Keychain. tinyjs signs with
// `--options runtime` whenever there is a real identity; this checks that
// it did, and that no entitlement undoes it.
//   bun scripts/app-signature.ts PATH.app     (exits 1 with the problems)
/* oxlint-disable no-console -- a command-line script reports on the console */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

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

function codesign(args: string[]): string {
  const result = spawnSync("codesign", args, { encoding: "utf8" });
  // codesign -d writes what it shows to stderr
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

/** Every problem with the signatures of an app bundle and the programs in it. */
export function appSignatureProblems(app: string): string[] {
  const macos = join(app, "Contents", "MacOS");
  const helpers = join(app, "Contents", "Helpers");
  const executables = [
    app,
    ...readdirSync(macos).map((name) => join(macos, name)),
    ...(() => {
      try {
        return readdirSync(helpers).map((name) => join(helpers, name));
      } catch {
        return [];
      }
    })(),
  ];
  const problems = executables.flatMap((path) =>
    signatureProblems(
      path.slice(path.lastIndexOf("/") + 1),
      codesign(["-dv", "--verbose=4", path]),
      codesign(["-d", "--entitlements", "-", "--xml", path]),
    ),
  );
  if (
    spawnSync("codesign", ["--verify", "--strict", "--deep", app]).status !== 0
  )
    problems.push(`${app} doesn't pass codesign --verify --strict --deep`);
  return problems;
}

if (import.meta.main) {
  const app = process.argv[2];
  if (!app) {
    console.error("usage: bun scripts/app-signature.ts PATH.app");
    process.exit(2);
  }
  const problems = appSignatureProblems(app);
  if (problems.length > 0) {
    console.error(
      `::error::${app}'s signature is wrong:\n  - ${problems.join("\n  - ")}`,
    );
    process.exit(1);
  }
  console.log(`${app}: hardened runtime, no loosening entitlements`);
}
