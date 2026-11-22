// Builds the sandboxed native Local AI client + XPC service (static llama.cpp +
// static SentencePiece + Accelerate Q12 transformer engine), either into the
// local development host or attached into a built TinyJS .app bundle.
/* oxlint-disable no-console -- build diagnostics */
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { arch as hostArch } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  localAiBuildFolder,
  localAiDevHost,
} from "../src/types/local-ai-dev.ts";

export type LocalAiArch = "arm64" | "x86_64";

export interface BuildLocalAiOptions {
  arch?: LocalAiArch;
  attach?: string;
  signIdentity?: string;
  allowSignedAttach?: boolean;
  skipProbe?: boolean;
}

const desktop = fileURLToPath(new URL("..", import.meta.url)).replace(
  /\/$/,
  "",
);
const native = join(desktop, "native", "local-ai");
const host = join(desktop, localAiBuildFolder, localAiDevHost);
const serviceId = "com.michael.teneo.ai.inference";

function resolveCmakeCommand(): [string, string[]] {
  if (process.env.CMAKE) return [process.env.CMAKE, []];
  for (const candidate of [
    "cmake",
    "/opt/homebrew/bin/cmake",
    "/usr/local/bin/cmake",
    "/Applications/CMake.app/Contents/bin/cmake",
  ]) {
    const check = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (check.status === 0) return [candidate, []];
  }
  const uvxCheck = spawnSync("uvx", ["--from", "cmake", "cmake", "--version"], {
    stdio: "ignore",
  });
  if (uvxCheck.status === 0) return ["uvx", ["--from", "cmake", "cmake"]];
  return ["cmake", []];
}

function run(command: string, args: string[]) {
  execFileSync(command, args, { stdio: "inherit" });
}

function codesignWithRetry(identity: string, args: string[]) {
  const baseArgs = [
    "--force",
    "--sign",
    identity,
    ...(identity === "-" ? [] : ["--timestamp"]),
    ...args,
  ];
  const first = spawnSync("/usr/bin/codesign", baseArgs, { stdio: "inherit" });
  if (first.status === 0) return;
  if (identity === "-") {
    throw new Error(`codesign failed for ${args.at(-1) ?? "target"}`);
  }
  // Retry once on transient RFC-3161 timestamp server hiccups in CI.
  run("/usr/bin/codesign", baseArgs);
}

function plist(values: Record<string, string>) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
${Object.entries(values)
  .map(([key, value]) => `<key>${key}</key><string>${value}</string>`)
  .join("\n")}
</dict></plist>`;
}

function stage(
  app: string,
  buildDir: string,
  signIdentity: string,
  isDevHost: boolean,
): string {
  const contents = join(app, "Contents");
  const service = join(contents, "XPCServices", "TeneoInference.xpc");
  const clientBin = join(contents, "MacOS", "teneo-ai-client");
  const serviceBin = join(service, "Contents", "MacOS", "teneo-ai-service");

  // Clean any stale nested bundle files before staging fresh single-binary XPC.
  rmSync(service, { recursive: true, force: true });
  rmSync(join(contents, "Resources", "q12_classifier.py"), { force: true });

  mkdirSync(dirname(clientBin), { recursive: true });
  mkdirSync(dirname(serviceBin), { recursive: true });

  copyFileSync(join(buildDir, "teneo-ai-client"), clientBin);
  copyFileSync(join(buildDir, "teneo-ai-service"), serviceBin);

  const serviceInfo = plist({
    CFBundleIdentifier: serviceId,
    CFBundleExecutable: "teneo-ai-service",
    CFBundlePackageType: "XPC!",
    CFBundleVersion: "1",
  }).replace(
    "</dict></plist>",
    `<key>XPCService</key><dict>
    <key>ServiceType</key><string>Application</string>
  </dict></dict></plist>`,
  );
  writeFileSync(join(service, "Contents", "Info.plist"), serviceInfo);
  if (isDevHost) {
    writeFileSync(
      join(contents, "Info.plist"),
      plist({
        CFBundleIdentifier: "com.michael.teneo.ai.devhost",
        CFBundleExecutable: "teneo-ai-client",
        CFBundlePackageType: "APPL",
        CFBundleVersion: "1",
      }),
    );
  }

  // Sign inside-out with Hardened Runtime on every executable and bundle:
  // 1) TeneoInference.xpc with App Sandbox entitlement (service.entitlements)
  // 2) teneo-ai-client in Contents/MacOS if it isn't the app's main executable
  // 3) Enclosing .app preserving its existing entitlements, requirements, and identifier
  codesignWithRetry(signIdentity, [
    "--options",
    "runtime",
    "--entitlements",
    join(native, "service.entitlements"),
    service,
  ]);
  if (!isDevHost) {
    codesignWithRetry(signIdentity, [
      "--identifier",
      `${serviceId}.client`,
      "--options",
      "runtime",
      clientBin,
    ]);
  }
  codesignWithRetry(signIdentity, [
    "--options",
    "runtime",
    ...(isDevHost
      ? []
      : ["--preserve-metadata=entitlements,requirements,identifier"]),
    app,
  ]);
  run("/usr/bin/codesign", ["--verify", "--strict", "--deep", app]);
  return clientBin;
}

export function buildAndStageLocalAi(
  options: BuildLocalAiOptions = {},
): string {
  if (process.platform !== "darwin") {
    throw new Error("Local AI XPC builds are supported only on macOS");
  }
  const defaultArch: LocalAiArch = hostArch() === "x64" ? "x86_64" : "arm64";
  const targetArch: LocalAiArch = options.arch ?? defaultArch;
  const signIdentity =
    options.signIdentity ?? process.env.TINYJS_SIGN_IDENTITY ?? "-";

  const devHost =
    targetArch === defaultArch
      ? host
      : join(
          desktop,
          localAiBuildFolder,
          `TeneoInferenceHost-${targetArch}.app`,
        );
  const targetApp = options.attach ? resolve(options.attach) : devHost;
  if (options.attach) {
    if (
      dirname(targetApp) !== join(desktop, "dist") ||
      !targetApp.endsWith(".app")
    ) {
      throw new Error(
        "Attach only to a locally built app in apps/desktop/dist",
      );
    }
    if (!options.allowSignedAttach && signIdentity === "-") {
      const signature = spawnSync("/usr/bin/codesign", ["-dv", targetApp], {
        encoding: "utf8",
      });
      if (
        signature.status !== 0 ||
        !signature.stderr?.includes("Signature=adhoc")
      ) {
        throw new Error("Refusing to modify a non-ad-hoc .app without --sign");
      }
    }
  }

  const buildDir = resolve(
    process.env.TENEO_AI_BUILD_DIR ??
      join(desktop, localAiBuildFolder, `native-${targetArch}`),
  );
  const [cmakeBin, cmakePrefix] = resolveCmakeCommand();
  run(cmakeBin, [
    ...cmakePrefix,
    "-S",
    native,
    "-B",
    buildDir,
    "-DCMAKE_BUILD_TYPE=Release",
    "-DCMAKE_OSX_DEPLOYMENT_TARGET=15.0",
    `-DCMAKE_OSX_ARCHITECTURES=${targetArch}`,
    `-DCMAKE_SYSTEM_PROCESSOR=${targetArch}`,
  ]);
  run(cmakeBin, [
    ...cmakePrefix,
    "--build",
    buildDir,
    "--parallel",
    "6",
    "--target",
    "teneo-ai-client",
    "teneo-ai-service",
  ]);

  const client = stage(targetApp, buildDir, signIdentity, !options.attach);
  if (targetArch === defaultArch && !options.skipProbe) {
    if (
      execFileSync(client, ["probe"], {
        encoding: "utf8",
        timeout: 20_000,
      }).trim() !== "isolated"
    ) {
      throw new Error("The inference service did not pass its sandbox probe");
    }
    console.log(`Local AI sandbox probe passed (${targetArch}): ${client}`);
  } else {
    console.log(`Local AI staged (${targetArch}): ${client}`);
  }
  return client;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  let arch: LocalAiArch | undefined;
  let attach: string | undefined;
  let signIdentity: string | undefined;
  let allowSignedAttach = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--arch") {
      const val = argv[++i];
      if (val !== "arm64" && val !== "x86_64") {
        throw new Error(`Invalid --arch value: ${val ?? ""}`);
      }
      arch = val;
    } else if (arg === "--attach") {
      attach = argv[++i];
      if (!attach) throw new Error("--attach requires a .app path");
    } else if (arg === "--sign") {
      signIdentity = argv[++i];
      if (!signIdentity) throw new Error("--sign requires an identity");
      allowSignedAttach = true;
    } else {
      throw new Error(
        "Usage on macOS: bun run local-ai:build [--arch arm64|x86_64] [--attach /path/to/local-build.app] [--sign IDENTITY]",
      );
    }
  }

  buildAndStageLocalAi({ arch, attach, signIdentity, allowSignedAttach });
}
