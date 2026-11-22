import {
  type LocalAiModelStatus,
  type LocalAiStatus,
  localAiStatusEvent,
} from "../src/types/local-ai";
import {
  localAiBuildFolder,
  localAiClientRelativePath,
  localAiDevHost,
} from "../src/types/local-ai-dev";
import { devName, isDevRun } from "./dev-run";
import {
  classifierModel,
  gemmaModel,
  maxInferenceBytes,
} from "./local-ai-model";
import { credentialCandidates } from "./local-ai-secrets";
import { appPaths } from "./paths";

const classifierIdleSeconds = 5;
const maxBatchSize = 32;

const preference = () => devName("localAiEnabled");
let optIn: Promise<boolean> | undefined;
let optedInCached = false;
let downloadingModelId: string | null = null;
let downloadedBytes = 0;
let changing = false;
let generation = 0;
let sandboxReady: Promise<boolean> | undefined;
let gemmaVerification: { key: string; answer: Promise<boolean> } | undefined;
let classifierVerification:
  | { key: string; answer: Promise<boolean> }
  | undefined;

let inferenceChain: Promise<void> = Promise.resolve();
const backgroundTasks = new Set<Promise<unknown>>();

export function isLocalAiOptedIn(app: TinyApp): Promise<boolean> {
  optIn ??= app.store.get(preference()).then(
    (value) => {
      optedInCached = value === true;
      return optedInCached;
    },
    () => {
      optIn = undefined;
      optedInCached = false;
      return false;
    },
  );
  return optIn;
}

export function isLocalAiOptedInSync(): boolean {
  return optedInCached;
}

export async function primeLocalAiState(app: TinyApp): Promise<boolean> {
  return isLocalAiOptedIn(app);
}

async function setOptIn(app: TinyApp, enabled: boolean) {
  await app.store.set(preference(), enabled);
  optedInCached = enabled;
  optIn = Promise.resolve(enabled);
}

export function trackLocalAiTask<T>(promise: Promise<T>): Promise<T> {
  const tracked = promise.finally(() => {
    backgroundTasks.delete(tracked);
  });
  backgroundTasks.add(tracked);
  return tracked;
}

export async function waitForLocalAiIdle(): Promise<void> {
  while (backgroundTasks.size > 0) {
    await Promise.allSettled(backgroundTasks);
  }
  await inferenceChain.catch(() => undefined);
}

function enqueueInference<T>(
  work: (epoch: number) => Promise<T | null>,
): Promise<T | null> {
  if (changing) return Promise.resolve(null);
  const epoch = generation;
  const runTask = inferenceChain.then(
    () => (changing || epoch !== generation ? null : work(epoch)),
    () => (changing || epoch !== generation ? null : work(epoch)),
  );
  inferenceChain = runTask.then(
    () => undefined,
    () => undefined,
  );
  return runTask;
}

function desktopRoot(): string {
  return tjs.cwd.endsWith("/apps/desktop") ? tjs.cwd : `${tjs.cwd}`;
}

function clientPath(): string | null {
  if (isDevRun()) {
    return `${desktopRoot()}/${localAiBuildFolder}/${localAiDevHost}/${localAiClientRelativePath}`;
  }
  // No fallback in a packaged app: the client must be inside its signed bundle.
  const prefix = tjs.exePath.match(/^(.*\.app\/Contents\/MacOS)\/[^/]+$/)?.[1];
  return prefix ? `${prefix}/teneo-ai-client` : null;
}

async function runShortCommand(
  args: string[],
  input?: Uint8Array,
  env: Record<string, string> = {},
  timeoutMs = 15_000,
): Promise<string> {
  try {
    const child = tjs.spawn(args, {
      stdin: input ? "pipe" : "ignore",
      stdout: "pipe",
      stderr: "ignore",
      env,
    });
    const reader = child.stdout!.getReader();
    async function receive(): Promise<string> {
      let output = "";
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return output + decoder.decode();
        if (output.length + value.length > 64) {
          child.kill("SIGTERM");
          await reader.cancel();
          return "";
        }
        output += decoder.decode(value, { stream: true });
      }
    }
    const timeout = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    try {
      const sent = input
        ? (async () => {
            const writer = child.stdin!.getWriter();
            try {
              await writer.write(input);
            } finally {
              await writer.close();
            }
          })()
        : Promise.resolve();
      const [out, result] = await Promise.all([receive(), child.wait(), sent]);
      return result.exit_status === 0 ? out.trim() : "";
    } catch {
      child.kill("SIGTERM");
      await child.wait().catch(() => undefined);
      return "";
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // Never emit input, output, or exception objects to logs or telemetry.
    return "";
  }
}

async function runClient(args: string[], input?: Uint8Array): Promise<string> {
  const path = clientPath();
  if (!path) return "";
  // Allow time for signature assessment, the sandbox probe, and inference.
  return runShortCommand([path, ...args], input, {}, input ? 35_000 : 15_000);
}

function isSandboxReady(): Promise<boolean> {
  sandboxReady ??= runClient(["probe"]).then((answer) => {
    if (answer === "isolated") return true;
    sandboxReady = undefined;
    return false;
  });
  return sandboxReady;
}

const modelFolder = async (app: TinyApp) =>
  `${(await appPaths(app)).data}/models`;
const gemmaPath = async (app: TinyApp) =>
  `${await modelFolder(app)}/${gemmaModel.filename}`;
const classifierPaths = async (app: TinyApp) => {
  const folder = await modelFolder(app);
  return {
    weights: `${folder}/${classifierModel.weights.filename}`,
    tokenizer: `${folder}/${classifierModel.tokenizer.filename}`,
  };
};

async function bytesAt(path: string): Promise<number> {
  const stat = await tjs.lstat(path).catch(() => null);
  return stat?.isFile ? Number(stat.size) : 0;
}

function gemmaArgs(operation: string, path: string): string[] {
  return [operation, path, gemmaModel.sha256, String(gemmaModel.bytes)];
}

function classifierVerifyArgs(weights: string, tokenizer: string): string[] {
  return [
    "verify-q12",
    weights,
    classifierModel.weights.sha256,
    String(classifierModel.weights.bytes),
    tokenizer,
    classifierModel.tokenizer.sha256,
    String(classifierModel.tokenizer.bytes),
  ];
}

function statKey(
  path: string,
  stat: { dev: number; ino: number; mtim: Date; ctim: Date },
): string {
  return `${path}:${stat.dev}:${stat.ino}:${stat.mtim.getTime()}:${stat.ctim.getTime()}`;
}

async function hasVerifiedGemma(app: TinyApp): Promise<boolean> {
  if (!(await isSandboxReady())) return false;
  const path = await gemmaPath(app);
  const stat = await tjs.lstat(path).catch(() => null);
  if (!stat?.isFile || stat.size !== gemmaModel.bytes) return false;
  const key = statKey(path, stat);
  if (gemmaVerification?.key !== key) {
    gemmaVerification = {
      key,
      answer: runClient(gemmaArgs("verify", path)).then(
        (answer) => answer === "verified",
      ),
    };
  }
  return gemmaVerification.answer;
}

async function hasVerifiedClassifier(app: TinyApp): Promise<boolean> {
  if (!(await isSandboxReady())) return false;
  const { weights, tokenizer } = await classifierPaths(app);
  const [wStat, tStat] = await Promise.all([
    tjs.lstat(weights).catch(() => null),
    tjs.lstat(tokenizer).catch(() => null),
  ]);
  if (
    !wStat?.isFile ||
    wStat.size !== classifierModel.weights.bytes ||
    !tStat?.isFile ||
    tStat.size !== classifierModel.tokenizer.bytes
  ) {
    return false;
  }
  const key = `${statKey(weights, wStat)}|${statKey(tokenizer, tStat)}`;
  if (classifierVerification?.key !== key) {
    classifierVerification = {
      key,
      answer: runClient(classifierVerifyArgs(weights, tokenizer)).then(
        (answer) => answer === "verified",
      ),
    };
  }
  return classifierVerification.answer;
}

export async function hasLocalAiPreviewModel(app: TinyApp): Promise<boolean> {
  const [optedIn, gemmaOk] = await Promise.all([
    isLocalAiOptedIn(app),
    hasVerifiedGemma(app),
  ]);
  return optedIn && gemmaOk;
}

function encodeFramedBatch(encodedTexts: Uint8Array[]): Uint8Array {
  let total = 4;
  for (const item of encodedTexts) {
    total += 4 + item.byteLength;
  }
  const frame = new Uint8Array(total);
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  view.setUint32(0, encodedTexts.length, true);
  let offset = 4;
  for (const item of encodedTexts) {
    view.setUint32(offset, item.byteLength, true);
    offset += 4;
    frame.set(item, offset);
    offset += item.byteLength;
  }
  return frame;
}

interface ClassifierDaemon {
  key: string;
  closed: boolean;
  sendBatch: (
    encodedTexts: Uint8Array[],
  ) => Promise<Array<"possible_secret" | "no_signal"> | null>;
  close: () => Promise<void>;
}

let activeDaemon: ClassifierDaemon | null = null;

async function stopClassifierDaemon(): Promise<void> {
  const daemon = activeDaemon;
  activeDaemon = null;
  if (daemon) {
    await daemon.close().catch(() => undefined);
  }
}

export async function stopLocalAiWorkers(): Promise<void> {
  await stopClassifierDaemon();
}

async function spawnClassifierDaemon(
  weights: string,
  tokenizer: string,
  key: string,
): Promise<ClassifierDaemon | null> {
  const bin = clientPath();
  if (!bin) return null;

  try {
    const child = tjs.spawn(
      [
        bin,
        "serve-q12",
        weights,
        classifierModel.weights.sha256,
        String(classifierModel.weights.bytes),
        tokenizer,
        classifierModel.tokenizer.sha256,
        String(classifierModel.tokenizer.bytes),
        String(classifierModel.cutoff),
        String(classifierIdleSeconds),
      ],
      {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "ignore",
        env: {},
      },
    );

    const reader = child.stdout!.getReader();
    const writer = child.stdin!.getWriter();
    const lineQueue: string[] = [];
    let waiter: ((line: string | null) => void) | null = null;
    let closed = false;

    const pushLine = (line: string | null) => {
      if (waiter) {
        const resolve = waiter;
        waiter = null;
        resolve(line);
      } else if (line !== null) {
        lineQueue.push(line);
      }
    };

    void (async () => {
      const decoder = new TextDecoder();
      let pending = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) {
            pending += decoder.decode();
            if (pending.trim()) pushLine(pending.trim());
            break;
          }
          pending += decoder.decode(value, { stream: true });
          if (pending.length > 8_192) {
            child.kill("SIGTERM");
            break;
          }
          let newline = pending.indexOf("\n");
          while (newline >= 0) {
            const line = pending.slice(0, newline).trim();
            pending = pending.slice(newline + 1);
            if (line) pushLine(line);
            newline = pending.indexOf("\n");
          }
        }
      } catch {
        // Ignored; marks stream closed below.
      } finally {
        closed = true;
        pushLine(null);
      }
    })();

    const nextLine = (timeoutMs: number): Promise<string | null> => {
      if (lineQueue.length > 0) return Promise.resolve(lineQueue.shift()!);
      if (closed) return Promise.resolve(null);
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          if (waiter === onLine) waiter = null;
          child.kill("SIGTERM");
          resolve(null);
        }, timeoutMs);
        const onLine = (line: string | null) => {
          clearTimeout(timer);
          resolve(line);
        };
        waiter = onLine;
      });
    };

    const close = async () => {
      closed = true;
      try {
        await writer.close();
      } catch {
        // Already closed.
      }
      try {
        child.kill("SIGTERM");
      } catch {
        // Already exited.
      }
      try {
        await reader.cancel();
      } catch {
        // Already closed.
      }
      await child.wait().catch(() => undefined);
    };

    const readyLine = await nextLine(30_000);
    if (readyLine !== "ready") {
      await close();
      return null;
    }

    const daemon: ClassifierDaemon = {
      key,
      get closed() {
        return closed;
      },
      async sendBatch(encodedTexts: Uint8Array[]) {
        if (closed || encodedTexts.length === 0) return null;
        try {
          await writer.write(encodeFramedBatch(encodedTexts));
        } catch {
          await close();
          return null;
        }
        const header = await nextLine(15_000);
        if (header !== `ok ${encodedTexts.length}`) {
          await close();
          return null;
        }
        const labels: Array<"possible_secret" | "no_signal"> = [];
        for (let i = 0; i < encodedTexts.length; i += 1) {
          const line = await nextLine(5_000);
          if (line !== "possible_secret" && line !== "no_signal") {
            await close();
            return null;
          }
          labels.push(line);
        }
        return labels;
      },
      close,
    };
    return daemon;
  } catch {
    return null;
  }
}

async function runClassifierChunk(
  encodedTexts: Uint8Array[],
  app: TinyApp,
  epoch: number,
): Promise<Array<"possible_secret" | "no_signal"> | null> {
  if (changing || epoch !== generation) return null;
  const { weights, tokenizer } = await classifierPaths(app);
  const [wStat, tStat] = await Promise.all([
    tjs.lstat(weights).catch(() => null),
    tjs.lstat(tokenizer).catch(() => null),
  ]);
  if (
    !wStat?.isFile ||
    wStat.size !== classifierModel.weights.bytes ||
    !tStat?.isFile ||
    tStat.size !== classifierModel.tokenizer.bytes
  ) {
    return null;
  }
  const key = `${statKey(weights, wStat)}|${statKey(tokenizer, tStat)}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (changing || epoch !== generation) return null;
    if (!activeDaemon || activeDaemon.closed || activeDaemon.key !== key) {
      await stopClassifierDaemon();
      activeDaemon = await spawnClassifierDaemon(weights, tokenizer, key);
      if (!activeDaemon) return null;
    }
    const labels = await activeDaemon.sendBatch(encodedTexts);
    if (labels) {
      return epoch === generation ? labels : null;
    }
    await stopClassifierDaemon();
  }
  return null;
}

export async function getLocalAiStatus(app: TinyApp): Promise<LocalAiStatus> {
  const [avail, optedIn] = await Promise.all([
    isSandboxReady(),
    isLocalAiOptedIn(app),
  ]);
  const [gemmaInstalled, classifierInstalled] = await Promise.all([
    avail ? hasVerifiedGemma(app) : Promise.resolve(false),
    avail ? hasVerifiedClassifier(app) : Promise.resolve(false),
  ]);

  const models: LocalAiModelStatus[] = [
    {
      id: classifierModel.id,
      name: classifierModel.name,
      role: classifierModel.role,
      description: classifierModel.description,
      bytes: classifierModel.bytes,
      available: avail,
      installed: classifierInstalled,
      downloading: downloadingModelId === classifierModel.id,
      downloadedBytes:
        downloadingModelId === classifierModel.id ? downloadedBytes : 0,
    },
    {
      id: gemmaModel.id,
      name: gemmaModel.name,
      role: gemmaModel.role,
      description: gemmaModel.description,
      bytes: gemmaModel.bytes,
      available: avail,
      installed: gemmaInstalled,
      downloading: downloadingModelId === gemmaModel.id,
      downloadedBytes:
        downloadingModelId === gemmaModel.id ? downloadedBytes : 0,
    },
  ];

  const installed = classifierInstalled || gemmaInstalled;
  const anyReady = avail && installed;
  const activeDownload = models.find((entry) => entry.downloading);

  return {
    available: avail,
    optedIn,
    enabled: optedIn && anyReady,
    installed,
    downloading: downloadingModelId !== null,
    downloadingModelId,
    downloadedBytes: activeDownload?.downloadedBytes ?? 0,
    model: {
      id: activeDownload?.id ?? gemmaModel.id,
      name: activeDownload?.name ?? gemmaModel.name,
      bytes: activeDownload?.bytes ?? gemmaModel.bytes,
    },
    models,
  };
}

async function publish(app: TinyApp): Promise<LocalAiStatus> {
  const status = await getLocalAiStatus(app);
  app.push(localAiStatusEvent, status);
  return status;
}

async function copyOrLink(source: string, destination: string): Promise<void> {
  try {
    await tjs.link(source, destination);
  } catch {
    await tjs.copyFile(source, destination);
  }
}

async function downloadFileWithCurl(
  url: string,
  expectedBytes: number,
  destination: string,
  onProgress: (bytes: number) => void,
): Promise<boolean> {
  if (!url.startsWith("https://")) return false;
  const child = tjs.spawn(
    [
      "/usr/bin/curl",
      "--disable",
      "--silent",
      "--fail",
      "--location",
      "--proto",
      "=https",
      "--proto-redir",
      "=https",
      "--max-redirs",
      "5",
      "--connect-timeout",
      "15",
      "--max-time",
      "600",
      "--max-filesize",
      String(expectedBytes),
      "--output",
      destination,
      url,
    ],
    { stdin: "ignore", stdout: "ignore", stderr: "ignore", env: {} },
  );
  const progress = setInterval(() => {
    void bytesAt(destination).then((bytes) => {
      onProgress(Math.min(bytes, expectedBytes));
    });
  }, 400);
  try {
    const result = await child.wait();
    return result.exit_status === 0;
  } finally {
    clearInterval(progress);
  }
}

async function installClassifierModel(
  folder: string,
  tempDir: string,
  app: TinyApp,
): Promise<void> {
  const { weights, tokenizer } = await classifierPaths(app);
  const partialWeights = `${tempDir}/weights.onnx`;
  const partialTokenizer = `${tempDir}/tokenizer.spm`;

  let stagedFromLocal = false;
  if (isDevRun()) {
    const devArtifactDir = `${desktopRoot()}/${localAiBuildFolder}/benchmarks/minilm-finetune/lookup-quant/artifact-lean`;
    const [localW, localT] = await Promise.all([
      tjs.stat(`${devArtifactDir}/model.onnx`).catch(() => null),
      tjs.stat(`${devArtifactDir}/tokenizer.model`).catch(() => null),
    ]);
    if (localW?.isFile && localT?.isFile) {
      await copyOrLink(`${devArtifactDir}/model.onnx`, partialWeights);
      await copyOrLink(`${devArtifactDir}/tokenizer.model`, partialTokenizer);
      downloadedBytes = classifierModel.bytes;
      void publish(app).catch(() => undefined);
      stagedFromLocal = true;
    }
  }

  if (!stagedFromLocal) {
    if (!classifierModel.weights.url || !classifierModel.tokenizer.url) {
      throw new Error();
    }
    const okWeights = await downloadFileWithCurl(
      classifierModel.weights.url,
      classifierModel.weights.bytes,
      partialWeights,
      (bytes) => {
        if (!downloadingModelId || bytes <= downloadedBytes) return;
        downloadedBytes = bytes;
        void publish(app).catch(() => undefined);
      },
    );
    if (!okWeights) throw new Error();
    const okTok = await downloadFileWithCurl(
      classifierModel.tokenizer.url,
      classifierModel.tokenizer.bytes,
      partialTokenizer,
      (bytes) => {
        const total = classifierModel.weights.bytes + bytes;
        if (!downloadingModelId || total <= downloadedBytes) return;
        downloadedBytes = total;
        void publish(app).catch(() => undefined);
      },
    );
    if (!okTok) throw new Error();
  }

  const verified = await runClient(
    classifierVerifyArgs(partialWeights, partialTokenizer),
  );
  if (verified !== "verified") throw new Error();

  await tjs.makeDir(folder, { recursive: true });
  await tjs.rename(partialWeights, weights);
  await tjs.rename(partialTokenizer, tokenizer);
  classifierVerification = undefined;
}

export async function downloadLocalAi(id: unknown, app: TinyApp) {
  if (changing) return getLocalAiStatus(app);
  const isClassifier = id === classifierModel.id;
  const isGemma = id === gemmaModel.id;
  if (!isClassifier && !isGemma) return getLocalAiStatus(app);

  if (!(await isSandboxReady())) return getLocalAiStatus(app);

  changing = true;
  downloadingModelId = id;
  downloadedBytes = 0;
  void publish(app).catch(() => undefined);
  let tempDir: string | undefined;
  try {
    const folder = await modelFolder(app);
    if (isClassifier && (await hasVerifiedClassifier(app))) {
      downloadingModelId = null;
      return await getLocalAiStatus(app);
    }
    if (isGemma && (await hasVerifiedGemma(app))) {
      downloadingModelId = null;
      return await getLocalAiStatus(app);
    }

    await tjs.makeDir(folder, { recursive: true });
    tempDir = await tjs.makeTempDir(`${folder}/download-XXXXXX`);

    if (isClassifier) {
      await installClassifierModel(folder, tempDir, app);
    } else {
      const target = await gemmaPath(app);
      const partial = `${tempDir}/weights`;
      const ok = await downloadFileWithCurl(
        gemmaModel.url,
        gemmaModel.bytes,
        partial,
        (bytes) => {
          if (!downloadingModelId || bytes <= downloadedBytes) return;
          downloadedBytes = bytes;
          void publish(app).catch(() => undefined);
        },
      );
      if (
        !ok ||
        (await runClient(gemmaArgs("verify", partial))) !== "verified"
      ) {
        throw new Error();
      }
      await tjs.rename(partial, target);
      gemmaVerification = undefined;
    }
  } catch {
    throw new Error("Couldn't download or verify the model. Try again.");
  } finally {
    if (tempDir) await tjs.remove(tempDir).catch(() => undefined);
    downloadingModelId = null;
    changing = false;
    downloadedBytes = 0;
    await publish(app);
  }
  return getLocalAiStatus(app);
}

export async function enableLocalAi(enabled: boolean, app: TinyApp) {
  if (changing) return getLocalAiStatus(app);
  changing = true;
  generation += 1;
  try {
    if (enabled) {
      if (!(await isSandboxReady())) {
        throw new Error(
          "The local model is not ready or could not be verified.",
        );
      }
      let verifiedAny = false;
      const { weights, tokenizer } = await classifierPaths(app);
      if (
        (await runClient(classifierVerifyArgs(weights, tokenizer))) ===
        "verified"
      ) {
        verifiedAny = true;
      }
      if (!verifiedAny) {
        const path = await gemmaPath(app);
        if ((await runClient(gemmaArgs("verify", path))) === "verified") {
          verifiedAny = true;
        }
      }
      if (!verifiedAny) {
        throw new Error(
          "The local model is not ready or could not be verified.",
        );
      }
      await setOptIn(app, true);
    } else {
      await setOptIn(app, false);
      await stopClassifierDaemon();
      await waitForLocalAiIdle();
    }
  } finally {
    changing = false;
  }
  return publish(app);
}

async function removeFileIfPresent(path: string): Promise<void> {
  const stat = await tjs.lstat(path).catch(() => null);
  if (stat?.isFile || stat?.isSymbolicLink) await tjs.remove(path);
}

export async function removeLocalAi(app: TinyApp, id?: unknown) {
  if (changing) return getLocalAiStatus(app);
  changing = true;
  generation += 1;
  try {
    await stopClassifierDaemon();
    const removeClassifier = id === undefined || id === classifierModel.id;
    const removeGemma = id === undefined || id === gemmaModel.id;
    if (!removeClassifier && !removeGemma) return await getLocalAiStatus(app);

    if (removeClassifier) {
      const { weights, tokenizer } = await classifierPaths(app);
      await removeFileIfPresent(weights);
      await removeFileIfPresent(tokenizer);
      classifierVerification = undefined;
    }
    if (removeGemma) {
      await removeFileIfPresent(await gemmaPath(app));
      gemmaVerification = undefined;
    }

    if (id === undefined) {
      await setOptIn(app, false);
      await waitForLocalAiIdle();
    } else {
      const [stillClassifier, stillGemma] = await Promise.all([
        hasVerifiedClassifier(app),
        hasVerifiedGemma(app),
      ]);
      if (!stillClassifier && !stillGemma) {
        await setOptIn(app, false);
        await waitForLocalAiIdle();
      }
    }
  } catch {
    throw new Error("Couldn't remove the local model.");
  } finally {
    changing = false;
    await publish(app);
  }
  return getLocalAiStatus(app);
}

export async function classifyLocalAiSecretBatch(
  contexts: string[],
  app: TinyApp,
): Promise<Array<"possible_secret" | "no_signal" | null>> {
  if (contexts.length === 0) return [];
  const encoder = new TextEncoder();
  const encodedContexts = contexts.map((ctx) => encoder.encode(ctx));

  return (
    (await enqueueInference(async (epoch) => {
      if (!(await isLocalAiOptedIn(app)) || changing || epoch !== generation) {
        return contexts.map(() => null);
      }
      const useClassifier = await hasVerifiedClassifier(app);
      if (useClassifier) {
        const results: Array<"possible_secret" | "no_signal" | null> =
          Array.from({ length: contexts.length }, () => null);
        const validIndices: number[] = [];
        for (let i = 0; i < encodedContexts.length; i += 1) {
          if (encodedContexts[i]!.byteLength <= maxInferenceBytes) {
            validIndices.push(i);
          }
        }
        for (
          let start = 0;
          start < validIndices.length;
          start += maxBatchSize
        ) {
          if (changing || epoch !== generation) return contexts.map(() => null);
          const sliceIndices = validIndices.slice(start, start + maxBatchSize);
          const sliceEncoded = sliceIndices.map((idx) => encodedContexts[idx]!);
          const labels = await runClassifierChunk(sliceEncoded, app, epoch);
          if (!labels) continue;
          for (let j = 0; j < sliceIndices.length; j += 1) {
            results[sliceIndices[j]!] = labels[j]!;
          }
        }
        return epoch === generation ? results : contexts.map(() => null);
      }

      if (await hasVerifiedGemma(app)) {
        const path = await gemmaPath(app);
        const results: Array<"possible_secret" | "no_signal" | null> = [];
        for (let i = 0; i < encodedContexts.length; i += 1) {
          if (changing || epoch !== generation) return contexts.map(() => null);
          const input = encodedContexts[i]!;
          if (input.byteLength > maxInferenceBytes) {
            results.push(null);
            continue;
          }
          const answer = await runClient(gemmaArgs("secrets", path), input);
          results.push(
            answer === "possible_secret" || answer === "no_signal"
              ? answer
              : null,
          );
        }
        return epoch === generation ? results : contexts.map(() => null);
      }

      return contexts.map(() => null);
    })) ?? contexts.map(() => null)
  );
}

export async function classifyLocalAiText(
  operation: "preview" | "secrets",
  text: string,
  app: TinyApp,
): Promise<string | null> {
  if (operation === "secrets") {
    const [answer] = await classifyLocalAiSecretBatch([text], app);
    return answer ?? null;
  }

  const input = new TextEncoder().encode(text);
  if (input.length > maxInferenceBytes) return null;

  return enqueueInference(async (epoch) => {
    if (
      !(await isLocalAiOptedIn(app)) ||
      !(await hasVerifiedGemma(app)) ||
      changing ||
      epoch !== generation
    ) {
      return null;
    }
    const path = await gemmaPath(app);
    if (changing || epoch !== generation) return null;
    const answer = await runClient(gemmaArgs("preview", path), input);
    return epoch === generation ? answer || null : null;
  });
}

export async function detectLocalAiCredentials(text: string, app: TinyApp) {
  if (!(await isLocalAiOptedIn(app))) return [];
  const candidates = credentialCandidates(text);
  if (!candidates.length) return [];

  // One inference per capture. An explicit field is already a strong signal.
  // If there are additional ambiguous candidates, or the runner is unavailable,
  // keep them masked rather than treating an unchecked value as benign.
  const ambiguous = candidates.find((candidate) => candidate.context);
  const answer = ambiguous?.context
    ? await classifyLocalAiText("secrets", ambiguous.context, app)
    : null;
  return candidates
    .filter((candidate) => candidate !== ambiguous || answer !== "no_signal")
    .map(({ start, end, label }) => ({ start, end, label }));
}
