// Real sandbox smoke and synthetic diagnostic quality check across both
// Q12 MiniLMv2 (batched XPC classifier) and Gemma 3 270M (XPC LLM). Fixtures only.
/* oxlint-disable no-console -- reports synthetic fixture results */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import {
  classifierModel,
  developmentModel as model,
} from "../backend/local-ai-model.ts";
import {
  localAiBuildFolder,
  localAiClientRelativePath,
  localAiDevHost,
} from "../src/types/local-ai-dev.ts";

const client = resolve(
  process.argv[2] ??
    join(localAiBuildFolder, localAiDevHost, localAiClientRelativePath),
);
const devModelsDir = join(
  homedir(),
  "Library",
  "Application Support",
  "com.michael.teneo.debug",
  "dev",
  "models",
);
const weights = resolve(process.argv[3] ?? join(devModelsDir, model.filename));

function resolveQ12Paths(): { weights: string; tokenizer: string } | null {
  const installedW = join(devModelsDir, classifierModel.weights.filename);
  const installedT = join(devModelsDir, classifierModel.tokenizer.filename);
  if (existsSync(installedW) && existsSync(installedT)) {
    return { weights: installedW, tokenizer: installedT };
  }
  const benchDir = resolve(
    join(
      localAiBuildFolder,
      "benchmarks",
      "minilm-finetune",
      "lookup-quant",
      "artifact-lean",
    ),
  );
  const benchW = join(benchDir, "model.onnx");
  const benchT = join(benchDir, "tokenizer.model");
  if (existsSync(benchW) && existsSync(benchT)) {
    return { weights: benchW, tokenizer: benchT };
  }
  return null;
}

function encodeFramedBatch(texts: string[]): Uint8Array {
  const encoder = new TextEncoder();
  const items = texts.map((text) => encoder.encode(text));
  let total = 4;
  for (const item of items) total += 4 + item.byteLength;
  const frame = new Uint8Array(total);
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  view.setUint32(0, items.length, true);
  let offset = 4;
  for (const item of items) {
    view.setUint32(offset, item.byteLength, true);
    offset += 4;
    frame.set(item, offset);
    offset += item.byteLength;
  }
  return frame;
}

function call(args: string[], input?: string | Uint8Array) {
  const start = performance.now();
  const result = spawnSync(client, args, {
    encoding: "utf8",
    input,
    timeout: 35_000,
    env: {},
  });
  return {
    ms: Math.round(performance.now() - start),
    output: (result.stdout ?? "").trim(),
    status: result.status,
  };
}

if (call(["probe"]).output !== "isolated") {
  throw new Error("Sandbox probe failed");
}

function smokeQ12() {
  const q12Paths = resolveQ12Paths();
  if (!q12Paths) {
    throw new Error(
      "Missing Q12 weights or tokenizer; install Q12 or stage the pinned artifacts",
    );
  }
  const q12VerifyArgs = [
    q12Paths.weights,
    classifierModel.weights.sha256,
    String(classifierModel.weights.bytes),
    q12Paths.tokenizer,
    classifierModel.tokenizer.sha256,
    String(classifierModel.tokenizer.bytes),
  ];
  if (call(["verify-q12", ...q12VerifyArgs]).output !== "verified") {
    throw new Error("Q12 model verification failed");
  }
  if (
    call([
      "verify-q12",
      q12Paths.weights,
      "0".repeat(64),
      String(classifierModel.weights.bytes),
      q12Paths.tokenizer,
      classifierModel.tokenizer.sha256,
      String(classifierModel.tokenizer.bytes),
    ]).status !== 66
  ) {
    throw new Error("The broker accepted an incorrect Q12 digest");
  }

  const q12Cases = [
    [
      "q12-password",
      "possible_secret",
      "Staging account username: demo-user\nPassword: [VALUE]",
    ],
    [
      "q12-header-token",
      "possible_secret",
      "Send [VALUE] in the X-Access header for our internal demo service.",
    ],
    [
      "q12-help-article",
      "no_signal",
      "The public help article's URL is [VALUE]; it explains how to reset a password.",
    ],
    [
      "q12-docs-slug",
      "no_signal",
      "Public documentation page [VALUE] explains how token rotation works.",
    ],
  ] as const;

  const batchResult = call(
    ["classify-q12", ...q12VerifyArgs, String(classifierModel.cutoff)],
    encodeFramedBatch(q12Cases.map(([, , text]) => text)),
  );
  const batchLines = batchResult.output.split("\n").filter(Boolean);
  if (batchResult.status !== 0 || batchLines.length !== q12Cases.length) {
    throw new Error(
      `Q12 batch inference failed (exit ${batchResult.status}, lines ${batchLines.length})`,
    );
  }
  let q12Correct = 0;
  for (let i = 0; i < q12Cases.length; i += 1) {
    const [name, expected] = q12Cases[i]!;
    const got = batchLines[i]!;
    if (got !== "possible_secret" && got !== "no_signal") {
      throw new Error(`${name}: classifier did not return an allowed label`);
    }
    if (got === expected) q12Correct += 1;
    console.log(`${name}: ${got === expected ? "match" : "mismatch"}`);
  }
  if (q12Correct !== q12Cases.length)
    throw new Error("Q12 fixture label mismatch");
  console.log(
    `Q12 XPC batch passed (${batchResult.ms} ms for ${q12Cases.length} items; ${q12Correct}/${q12Cases.length} synthetic matches).`,
  );
}
smokeQ12();

const args = [weights, model.sha256, String(model.bytes)];
if (call(["verify", ...args]).output !== "verified")
  throw new Error("Model verification failed");
if (call(["preview", weights, "0".repeat(64), args[2]!], "test").status !== 66)
  throw new Error("The broker accepted an incorrect digest");

const cases = [
  [
    "actual-stack",
    "preview",
    "stack_trace",
    "TypeError: Cannot read properties of undefined\n    at build (src/app.js:12:9)\n    at main (src/index.js:7:3)",
  ],
  [
    "error-note",
    "preview",
    "other",
    "Error: This line is the heading I want on the sign at the reception desk. Please print the rest below it.",
  ],
  [
    "unprefixed-password",
    "secrets",
    "possible_secret",
    "Staging account username: demo-user\nPassword: [VALUE]",
  ],
  [
    "custom-service-token",
    "secrets",
    "possible_secret",
    "Send [VALUE] in the X-Access header for our internal demo service.",
  ],
  [
    "placeholder",
    "secrets",
    "no_signal",
    "The public help article's URL is [VALUE]; it explains how to reset a password.",
  ],
  [
    "order-reference",
    "secrets",
    "no_signal",
    "The order reference is [VALUE]. No password is used for looking it up.",
  ],
] as const;

let correct = 0;
for (const [name, operation, expected, text] of cases) {
  const match = call([operation, ...args], text);
  const allowed =
    operation === "preview"
      ? ["stack_trace", "other"]
      : ["possible_secret", "no_signal"];
  if (match.status !== 0 || !allowed.includes(match.output)) {
    console.log(
      `${name}: inference unavailable (${match.ms} ms, exit ${match.status})`,
    );
    throw new Error(
      "The packaged inference path did not return an allowed label",
    );
  }
  if (match.output === expected) correct += 1;
  console.log(
    `${name}: ${match.output === expected ? "match" : "mismatch"} (${match.ms} ms)`,
  );
}
console.log(
  `Sandbox and verified model passed. Synthetic labels: ${correct}/${cases.length}.`,
);
