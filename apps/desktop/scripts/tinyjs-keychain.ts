// macOS Keychain ACLs belong to the launcher that wrote the keys. Keep
// noninteractive reads in that same signed executable, not in a sidecar.
// Remove this overlay when pinned TinyJS provides a no-UI Keychain read.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const version = "0.75.1";
const revision = "5749b8abe4ace5cc1a8f1fe472c39346ffaf69bb";
const sourceHash =
  "c64cee66788a181911598b36824dc38f438b0de81e14a5a3a8141e90884fc822";

function replaceOnce(source: string, from: string, to: string): string {
  if (source.split(from).length !== 2)
    throw new Error("The pinned TinyJS source no longer matches the patch");
  return source.replace(from, () => to);
}

const frameworks = [
  "WebKit",
  "AppKit",
  "Carbon",
  "UserNotifications",
  "AVFoundation",
  "ServiceManagement",
  "IOKit",
  "Quartz",
  "Vision",
  "QuickLookThumbnailing",
  "Security",
  "LocalAuthentication",
  "MediaPlayer",
  "CoreMedia",
  "CoreWLAN",
  "CoreLocation",
  "CoreAudio",
  "AudioToolbox",
  "UniformTypeIdentifiers",
];

export function prepareTinyjs(arches: readonly ("arm64" | "x86_64")[]) {
  const binary = execFileSync("/usr/bin/which", ["tinyjs"], {
    encoding: "utf8",
  }).trim();
  const installed = dirname(realpathSync(binary));
  const installedVersion = execFileSync(binary, ["version"], {
    encoding: "utf8",
  });
  if (!installedVersion.startsWith(`tinyjs v${version} `))
    throw new Error(`Teneo's Keychain overlay requires TinyJS ${version}`);

  const work = mkdtempSync(join(tmpdir(), "teneo-tinyjs-"));
  const dispose = () => rmSync(work, { recursive: true, force: true });
  try {
    const url = `https://codeload.github.com/tarwin/tinyjsapp/tar.gz/${revision}`;
    const archive = join(work, "source.tar.gz");
    execFileSync("/usr/bin/curl", [
      "--disable",
      "-fLsS",
      "--max-time",
      "60",
      "-o",
      archive,
      url,
    ]);
    if (
      createHash("sha256").update(readFileSync(archive)).digest("hex") !==
      sourceHash
    )
      throw new Error(
        "The TinyJS source archive did not match its pinned hash",
      );
    execFileSync("/usr/bin/tar", ["-xzf", archive, "-C", work]);

    const source = join(work, `tinyjsapp-${revision}`);
    const native = join(source, "native");
    const launcherSource = join(native, "launcher-macos.cc");
    const launcherCode = replaceOnce(
      readFileSync(launcherSource, "utf8"),
      `    if (req->op == "get") {
      q[(__bridge id)kSecReturnData] = @YES;
      q[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
      CFTypeRef data = NULL;
      OSStatus st = SecItemCopyMatching((__bridge CFDictionaryRef)q, &data);`,
      `    if (req->op == "get" || req->op == "get-silent") {
      q[(__bridge id)kSecReturnData] = @YES;
      q[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
      CFTypeRef data = NULL;
      OSStatus st;
      if (req->op == "get-silent") {
        // SecItemCopyMatching uses the file-based login Keychain here.
        // Run on the launcher thread and restore policy before handling RPCs.
        Boolean allowed = false;
        st = SecKeychainGetUserInteractionAllowed(&allowed);
        if (st == errSecSuccess) {
          st = SecKeychainSetUserInteractionAllowed(false);
          if (st == errSecSuccess) {
            st = SecItemCopyMatching((__bridge CFDictionaryRef)q, &data);
            SecKeychainSetUserInteractionAllowed(allowed);
          }
        }
      } else {
        st = SecItemCopyMatching((__bridge CFDictionaryRef)q, &data);
      }`,
    );
    writeFileSync(launcherSource, launcherCode);
    execFileSync("/bin/sh", [join(native, "gen-client.sh")], {
      stdio: "inherit",
    });

    // Use the pinned release's CLI and txiki binaries, in an isolated copy.
    const tool = join(work, "tool");
    cpSync(installed, tool, { recursive: true });
    const bridge = join(tool, "runtime", "bridge.js");
    writeFileSync(
      bridge,
      replaceOnce(
        readFileSync(bridge, "utf8"),
        "    secrets: {\n      async get(key) {",
        `    secrets: {
      async getWithoutPrompt(key) {
        const r = await ask('SECRET', 'get-silent\\t' + esc(id || 'tinyjs-app') + '\\t' + esc(key));
        if (!r?.ok) throw new Error(r?.error ?? 'keychain error');
        return r.value ?? null;
      },
      async get(key) {`,
      ),
    );

    const slices = arches.map((arch) => {
      const target = `${arch}-apple-macos14.0`;
      const launcherObject = join(work, `launcher-${arch}.o`);
      const aiObject = join(work, `ai-${arch}.o`);
      const slice = join(work, `launcher-${arch}`);
      execFileSync(
        "/usr/bin/xcrun",
        [
          "clang++",
          "-std=c++17",
          "-c",
          "-x",
          "objective-c++",
          "-DTINYJS_AI",
          "-mmacosx-version-min=14.0",
          "-arch",
          arch,
          `-I${join(native, "include")}`,
          launcherSource,
          "-o",
          launcherObject,
        ],
        { stdio: "inherit" },
      );
      execFileSync(
        "/usr/bin/xcrun",
        [
          "swiftc",
          "-parse-as-library",
          "-target",
          target,
          "-c",
          join(native, "tiny_ai.swift"),
          "-o",
          aiObject,
        ],
        { stdio: "inherit" },
      );
      execFileSync(
        "/usr/bin/xcrun",
        [
          "swiftc",
          launcherObject,
          aiObject,
          "-o",
          slice,
          "-lc++",
          "-target",
          target,
          ...frameworks.flatMap((name) => ["-framework", name]),
          "-Xlinker",
          "-weak_framework",
          "-Xlinker",
          "ScreenCaptureKit",
          "-Xlinker",
          "-weak_framework",
          "-Xlinker",
          "FoundationModels",
          "-ldl",
        ],
        { stdio: "inherit" },
      );
      return slice;
    });
    const launcher = join(tool, "native", "launcher-macos");
    execFileSync("/usr/bin/lipo", ["-create", ...slices, "-output", launcher]);
    execFileSync("/usr/bin/codesign", ["--force", "--sign", "-", launcher]);
    return { binary: join(tool, "tinyjs"), dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
