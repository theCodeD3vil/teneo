// Verifies and publishes Teneo's custom Local AI model artifacts to the
// dedicated public GitHub Releases repository (`theCodeD3vil/teneo-models`),
// keeping large ML weights separate from Teneo's signed app release pipeline.
//
// Usage (from apps/desktop):
//   bun scripts/publish-local-ai-models.ts [--dir /path/to/artifact-lean]
/* oxlint-disable no-console -- CLI release utility */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { classifierModel } from "../backend/local-ai-model.ts";
import { localAiBuildFolder } from "../src/types/local-ai-dev.ts";
import { ghArgs } from "./gh-command.ts";

const REPO = "theCodeD3vil/teneo-models";
const TAG = "q12-v1";

const desktop = fileURLToPath(new URL("..", import.meta.url)).replace(
  /\/$/,
  "",
);

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function verifyLocalArtifact(
  sourcePath: string,
  expectedBytes: number,
  expectedSha256: string,
  label: string,
) {
  if (!existsSync(sourcePath)) {
    throw new Error(`Missing ${label} at ${sourcePath}`);
  }
  const stat = statSync(sourcePath);
  if (!stat.isFile() || stat.size !== expectedBytes) {
    throw new Error(
      `${label} byte size mismatch: expected ${expectedBytes}, got ${stat.size}`,
    );
  }
  const digest = sha256File(sourcePath);
  if (digest !== expectedSha256) {
    throw new Error(
      `${label} SHA-256 mismatch: expected ${expectedSha256}, got ${digest}`,
    );
  }
}

function ghResult(args: string[]) {
  const [program, programArgs] = ghArgs(args);
  return spawnSync(program, programArgs, {
    encoding: "utf8",
    stdio: [process.stdin.isTTY ? "inherit" : "ignore", "pipe", "inherit"],
  });
}

function runGh(args: string[]) {
  if (ghResult(args).status !== 0) {
    throw new Error(`gh ${args.slice(0, 3).join(" ")} failed`);
  }
}

function getGithubResource<T>(path: string): T | null {
  const { status, stdout } = ghResult(["api", "--include", path]);
  const response = /^HTTP\/\S+ (\d{3})[^\r\n]*\r?\n/.exec(stdout ?? "");
  if (response?.[1] === "404") return null;
  const body = response && stdout?.split(/\r?\n\r?\n/, 2)[1];
  if (status !== 0 || !body) {
    throw new Error(`Could not read GitHub API resource ${path}`);
  }
  return JSON.parse(body) as T;
}

const sourceDir = resolve(
  option("--dir") ??
    join(
      desktop,
      localAiBuildFolder,
      "benchmarks",
      "minilm-finetune",
      "lookup-quant",
      "artifact-lean",
    ),
);

const weightsSource = existsSync(
  join(sourceDir, classifierModel.weights.filename),
)
  ? join(sourceDir, classifierModel.weights.filename)
  : join(sourceDir, "model.onnx");
const tokenizerSource = existsSync(
  join(sourceDir, classifierModel.tokenizer.filename),
)
  ? join(sourceDir, classifierModel.tokenizer.filename)
  : join(sourceDir, "tokenizer.model");

const stageDir = mkdtempSync(join(tmpdir(), "teneo-models-publish-"));
try {
  const stagedWeights = join(stageDir, classifierModel.weights.filename);
  const stagedTokenizer = join(stageDir, classifierModel.tokenizer.filename);
  const sumsPath = join(stageDir, "SHA256SUMS");
  const notesPath = join(stageDir, "RELEASE_NOTES.md");

  console.log(`==> Staging and verifying local Q12 artifacts in ${sourceDir}`);
  for (const [source, staged, artifact] of [
    [weightsSource, stagedWeights, classifierModel.weights],
    [tokenizerSource, stagedTokenizer, classifierModel.tokenizer],
  ] as const) {
    copyFileSync(source, staged);
    verifyLocalArtifact(
      staged,
      artifact.bytes,
      artifact.sha256,
      artifact.filename,
    );
  }

  const sums = [
    `${classifierModel.weights.sha256}  ${classifierModel.weights.filename}`,
    `${classifierModel.tokenizer.sha256}  ${classifierModel.tokenizer.filename}`,
    "",
  ].join("\n");
  writeFileSync(sumsPath, sums);

  const notes = [
    "## MiniLMv2 Q12 Credential Classifier (`q12-v1`)",
    "",
    "Lookup-quantized 12-bit XNLI MiniLMv2 ONNX weights and compact SentencePiece tokenizer used by Teneo's sandboxed on-device credential classifier.",
    "",
    "| File | Bytes | SHA-256 |",
    "| --- | ---: | --- |",
    `| \`${classifierModel.weights.filename}\` | ${classifierModel.weights.bytes.toLocaleString("en-US")} | \`${classifierModel.weights.sha256}\` |`,
    `| \`${classifierModel.tokenizer.filename}\` | ${classifierModel.tokenizer.bytes.toLocaleString("en-US")} | \`${classifierModel.tokenizer.sha256}\` |`,
    "",
    "Teneo verifies both exact byte size and SHA-256 digest in native code before passing read-only file descriptors to `TeneoInference.xpc`.",
    "",
  ].join("\n");
  writeFileSync(notesPath, notes);

  console.log(`==> Checking GitHub authentication and repository ${REPO}`);
  runGh(["api", "user", "--jq", ".login"]);
  const repoPath = `repos/${REPO}`;
  const repo = getGithubResource<{ private: boolean }>(repoPath);
  if (repo?.private) {
    throw new Error(
      `${REPO} must be public; refusing to change its visibility`,
    );
  }
  if (!repo) {
    console.log(`==> Creating public repository ${REPO}`);
    runGh([
      "repo",
      "create",
      REPO,
      "--public",
      "--description",
      "Verified on-device ML model artifacts for Teneo",
    ]);
  }

  const hasCommits = getGithubResource<{ name: string }[]>(
    `${repoPath}/branches?per_page=1`,
  )?.length;
  if (!hasCommits) {
    console.log(`==> Initializing ${REPO} README on its default branch`);
    const readme = [
      "# teneo-models",
      "",
      "Immutable, SHA-256-pinned on-device model artifacts for [Teneo](https://github.com/theCodeD3vil/teneo).",
      "",
      "Teneo downloads these files only when a user explicitly opts into Local AI in Settings, verifies exact byte length and SHA-256 digest locally, and runs inference inside an App-Sandboxed XPC service with zero network entitlements.",
      "",
      "## Releases",
      "",
      `- **\`${TAG}\`** — MiniLMv2 lookup-quantized Q12 credential classifier (\`${classifierModel.weights.filename}\` + \`${classifierModel.tokenizer.filename}\`).`,
      "",
    ].join("\n");
    runGh([
      "api",
      "--method",
      "PUT",
      `${repoPath}/contents/README.md`,
      "-f",
      "message=Initialize model artifact repository",
      "-f",
      `content=${Buffer.from(readme, "utf8").toString("base64")}`,
    ]);
  }

  const release = getGithubResource<{
    draft: boolean;
    assets: { name: string; size: number; digest: string | null }[];
  }>(`${repoPath}/releases/tags/${TAG}`);
  if (!release) {
    console.log(`==> Creating release ${TAG} and uploading verified assets`);
    runGh([
      "release",
      "create",
      TAG,
      "--repo",
      REPO,
      "--title",
      `MiniLMv2 Q12 Credential Classifier (${TAG})`,
      "--notes-file",
      notesPath,
      stagedWeights,
      stagedTokenizer,
      sumsPath,
    ]);
  } else {
    for (const [filename, bytes, sha256] of [
      [
        classifierModel.weights.filename,
        classifierModel.weights.bytes,
        classifierModel.weights.sha256,
      ],
      [
        classifierModel.tokenizer.filename,
        classifierModel.tokenizer.bytes,
        classifierModel.tokenizer.sha256,
      ],
      ["SHA256SUMS", Buffer.byteLength(sums), sha256File(sumsPath)],
    ] as const) {
      const asset = release.assets.find((entry) => entry.name === filename);
      if (asset?.size !== bytes || asset.digest !== `sha256:${sha256}`) {
        throw new Error(
          `${REPO}@${TAG} already exists with a missing or mismatched ${filename}; refusing to overwrite a pinned release`,
        );
      }
    }
    if (release.draft) throw new Error(`${REPO}@${TAG} is still a draft`);
    console.log(`==> Release ${TAG} already contains all verified assets`);
  }

  console.log(`==> Published ${REPO}@${TAG}`);
  console.log(`    ${classifierModel.weights.url}`);
  console.log(`    ${classifierModel.tokenizer.url}`);
} finally {
  rmSync(stageDir, { recursive: true, force: true });
}
