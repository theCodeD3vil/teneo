// Builds the Mac release in CI: both CPUs' apps (with sandboxed Local AI XPC
// attached and signed), disk images and zips, and a plain manifest.json
// pointing at this release's zips. `tinyjs publish` would sign the manifest,
// which needs the private update key; CI never has it. The maintainer signs on
// their Mac (scripts/publish-release.ts).
//   bun scripts/package-release.ts --notes-file NOTES --out DIR
/* oxlint-disable no-console -- a command-line script reports on the console */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appSignatureProblems,
  isSigningCertificateHash,
} from "./app-signature.ts";
import { buildAndStageLocalAi, type LocalAiArch } from "./build-local-ai.ts";
import {
  buildSyncDeviceIdentity,
  macReleaseArchitectures,
} from "./build-sync-device-identity.ts";
import { buildManifest } from "./release-manifest.ts";

const option = (name: string) => {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const out = option("--out");
const notes = readFileSync(option("--notes-file"), "utf8").trim();
const repository = process.env.GITHUB_REPOSITORY;
if (!repository) throw new Error("GITHUB_REPOSITORY is not set");
const identity = process.env.TINYJS_SIGN_IDENTITY;
if (!isSigningCertificateHash(identity))
  throw new Error(
    "TINYJS_SIGN_IDENTITY must be the release certificate SHA-1 fingerprint",
  );

// set-release-identity.ts has already made tinyjs.json this release's app
const { name, title, version } = JSON.parse(
  readFileSync("tinyjs.json", "utf8"),
) as Record<string, string>;
mkdirSync(out, { recursive: true });
// TinyJS stages and signs the correct Trusted Sync helper for each CPU.
buildSyncDeviceIdentity();

function run([command, ...args]: string[]): boolean {
  return spawnSync(command, args, { stdio: "inherit" }).status === 0;
}

function verifyBundledLocalAi(appPath: string, arch: LocalAiArch) {
  const required = [
    join(appPath, "Contents", "MacOS", "teneo-ai-client"),
    join(
      appPath,
      "Contents",
      "XPCServices",
      "TeneoInference.xpc",
      "Contents",
      "MacOS",
      "teneo-ai-service",
    ),
  ];
  for (const bin of required) {
    if (!existsSync(bin)) {
      throw new Error(`Missing bundled Local AI binary: ${bin}`);
    }
    const archs = execFileSync("/usr/bin/lipo", ["-archs", bin], {
      encoding: "utf8",
    })
      .trim()
      .split(/\s+/);
    if (archs.length !== 1 || archs[0] !== arch) {
      throw new Error(
        `${bin} has archs [${archs.join(", ")}], expected ${arch}`,
      );
    }
    const libraries = execFileSync("/usr/bin/otool", ["-L", bin], {
      encoding: "utf8",
    });
    for (const line of libraries.split("\n").slice(1)) {
      const library = line.trim().split(" (compatibility version ")[0];
      if (
        library &&
        !library.startsWith("/System/Library/") &&
        !library.startsWith("/usr/lib/")
      ) {
        throw new Error(`${bin} links a non-system library: ${library}`);
      }
    }
  }
}

function buildDmgFromSignedApp(appPath: string, dmgPath: string) {
  const stageDir = mkdtempSync(join(tmpdir(), "teneo-dmg-"));
  try {
    if (!run(["/usr/bin/ditto", appPath, join(stageDir, `${title}.app`)])) {
      throw new Error(`staging ${appPath} for dmg failed`);
    }
    symlinkSync("/Applications", join(stageDir, "Applications"));
    if (
      !run([
        "hdiutil",
        "create",
        "-volname",
        title!,
        "-srcfolder",
        stageDir,
        "-ov",
        "-quiet",
        "-format",
        "UDZO",
        dmgPath,
      ])
    ) {
      throw new Error(`creating ${dmgPath} failed`);
    }
  } finally {
    rmSync(stageDir, { recursive: true, force: true });
  }
}

const builds = [];
for (const arch of macReleaseArchitectures) {
  // Apple's timestamp server, which codesign calls, drops the odd request.
  // Build the .app first (without --dmg), attach and sign Local AI XPC inside-out,
  // verify signatures, and then emit both the .dmg and .zip from the identical .app.
  if (
    !run(["tinyjs", "build", "--arch", arch]) &&
    !run(["tinyjs", "build", "--arch", arch])
  ) {
    throw new Error(`the ${arch} build failed`);
  }

  const appPath = join("dist", `${title}.app`);
  buildAndStageLocalAi({
    arch,
    attach: appPath,
    signIdentity: identity,
    allowSignedAttach: true,
  });
  verifyBundledLocalAi(appPath, arch);

  // the hardened runtime is what keeps other software out of a self-signed app
  const problems = appSignatureProblems(appPath, {
    arch,
    identity,
    requireLocalAi: true,
  });
  if (problems.length > 0) {
    throw new Error(
      `the ${arch} app's signature is wrong:\n  - ${problems.join("\n  - ")}`,
    );
  }

  const dmg = `${name}-${version}-macos-${arch}.dmg`;
  buildDmgFromSignedApp(appPath, join(out, dmg));

  const zip = `${name}-${version}-macos-${arch}.zip`;
  if (!run(["ditto", "-c", "-k", "--keepParent", appPath, join(out, zip)])) {
    throw new Error(`zipping the ${arch} app failed`);
  }
  const sha256 = createHash("sha256")
    .update(readFileSync(join(out, zip)))
    .digest("hex");
  builds.push({ arch, zip, sha256 });
}

const manifest = buildManifest({
  version: version!,
  repository,
  notes,
  builds,
});
writeFileSync(
  join(out, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(
  `${title} ${version}: ${builds.map((build) => build.zip).join(", ")}, disk images and an unsigned manifest.json in ${out}`,
);
