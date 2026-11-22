// Verifies dual-model Local AI (Q12 MiniLMv2 + Gemma 3 270M), mask-first BTS
// classification on copy, and post-COMMIT batched BTS classification on sync.
/* oxlint-disable no-console -- test summary */
import {
  ClipboardItemAction,
  ClipboardItemActionsVersion,
  hasClipboardAction,
  possibleCredentialLabel,
} from "@teneo/shared/types/clipboard";
import type { ItemRecord } from "@teneo/sync";

import {
  forgetDecryptedTexts,
  getClipboardItem,
  initializeDatabase,
  onHistoryChanged,
  saveClipboardItem,
  turnOnSecretEncryption,
} from "./database";
import { isDevRun } from "./dev-run";
import { clearCachedActions, getCachedActions } from "./item-actions";
import {
  downloadLocalAi,
  enableLocalAi,
  getLocalAiStatus,
  removeLocalAi,
  waitForLocalAiIdle,
} from "./local-ai";
import { classifierModel, gemmaModel } from "./local-ai-model";
import { appPaths } from "./paths";
import { all } from "./sqlite";
import { SqliteSyncStore } from "./sync/sync-store";
import { clipboardHistoryChangedEvent } from "./types/clipboard";

if (!isDevRun()) throw new Error("Set TINYJS_ICON for the isolated test");
const gemmaWeights = tjs.args[3];
if (!gemmaWeights) throw new Error("Pass the path of the verified dev GGUF");

const temp = await tjs.makeTempDir(`${tjs.tmpDir}/teneo-ai-bts-XXXXXX`);
const stored = new Map<string, unknown>();
const keys = new Map<string, string>();
let uiPushes = 0;
let syncTriggers = 0;

const app = {
  paths: async () => ({ data: `${temp}/data`, cache: `${temp}/cache` }),
  store: {
    get: async (key: string) => stored.get(key) ?? null,
    set: async (key: string, value: unknown) => {
      stored.set(key, value);
      return true;
    },
  },
  secrets: {
    get: async (key: string) => keys.get(key) ?? null,
    set: async (key: string, value: string) => {
      keys.set(key, value);
      return true;
    },
  },
  push: (event: string) => {
    if (event === clipboardHistoryChangedEvent) uiPushes += 1;
  },
} as unknown as TinyApp;

const unsubscribeHistory = onHistoryChanged(() => {
  syncTriggers += 1;
});

function check(value: unknown, label: string) {
  if (!value) throw new Error(label);
}

const saveText = (text: string) =>
  saveClipboardItem(
    {
      kind: "text",
      changeCount: 0,
      text,
      html: null,
      paths: [],
      image: null,
      imageSize: null,
      color: null,
      concealed: false,
      sourceApp: null,
      sourceURL: null,
    },
    app,
  );

try {
  // 1. Verify dual-model LocalAiStatus and install both Q12 + Gemma 3 270M.
  const initial = await getLocalAiStatus(app);
  check(initial.models.length === 2, "status reports both Local AI models");
  const q12Initial = initial.models.find((m) => m.id === classifierModel.id);
  const gemmaInitial = initial.models.find((m) => m.id === gemmaModel.id);
  check(
    q12Initial?.available && q12Initial.role === "classification",
    "Q12 classifier runner is sandbox-probed and available",
  );
  check(
    gemmaInitial?.available && gemmaInitial.role === "general",
    "Gemma XPC runner is sandbox-probed and available",
  );

  const modelsDir = `${(await appPaths(app)).data}/models`;
  await tjs.makeDir(modelsDir, { recursive: true });
  await tjs.link(gemmaWeights, `${modelsDir}/${gemmaModel.filename}`);

  const afterQ12 = await downloadLocalAi(classifierModel.id, app);
  check(
    afterQ12.models.find((m) => m.id === classifierModel.id)?.installed ===
      true,
    "Q12 classifier stages and SHA-256 verifies both ONNX and SPM files",
  );
  const afterBoth = await downloadLocalAi(gemmaModel.id, app);
  check(
    afterBoth.models.every((m) => m.installed),
    "both Q12 classifier and Gemma 3 270M are installed",
  );

  check((await enableLocalAi(true, app)).enabled, "Local AI enabled");
  const database = await initializeDatabase(app);
  check(await turnOnSecretEncryption(app), "secret encryption enabled");

  // 2. Copy BTS test A: Benign lookalike in prose is masked + encrypted immediately,
  //    then unmasked + decrypted behind the scenes by Q12, bumping syncSeq so peers receive it.
  const benignLookalike =
    "Help center article kP9_xR4vN2mQ8zL7wT5 explains how password reset emails work.";
  const immediateBenign = await saveText(benignLookalike);
  check(
    immediateBenign.secrets[0]?.label === possibleCredentialLabel,
    "ambiguous lookalike is masked synchronously on save before SQLite write",
  );
  check(
    immediateBenign.actions === 0 &&
      immediateBenign.actionsVersion ===
        ClipboardItemActionsVersion.deterministic,
    "masked item starts with zero actions at deterministic version",
  );
  const [encryptedBeforeBts] = all<{
    encrypted: number | null;
    value: string;
    syncSeq: number;
  }>(
    database,
    `SELECT encrypted, value, syncSeq FROM "CLIPBOARD_ITEMS" WHERE id = ?`,
    immediateBenign.id,
  );
  check(
    encryptedBeforeBts?.encrypted === 1 &&
      encryptedBeforeBts.value !== benignLookalike,
    "unchecked ambiguous lookalike never hits SQLite in plaintext when encryptSecrets is on",
  );

  await waitForLocalAiIdle();

  const clearedBenign = await getClipboardItem(immediateBenign.id, app);
  check(
    clearedBenign !== null && clearedBenign.secrets.length === 0,
    "Q12 classifier unmasks false-positive commit hash behind the scenes",
  );
  check(
    clearedBenign !== null &&
      hasClipboardAction(clearedBenign.actions, ClipboardItemAction.qr) &&
      clearedBenign.actionsVersion === ClipboardItemActionsVersion.localAi,
    "unmasked item receives deterministic actions and localAi actionsVersion",
  );
  const [decryptedAfterBts] = all<{
    encrypted: number | null;
    value: string;
    syncSeq: number;
  }>(
    database,
    `SELECT encrypted, value, syncSeq FROM "CLIPBOARD_ITEMS" WHERE id = ?`,
    immediateBenign.id,
  );
  check(
    decryptedAfterBts?.encrypted === null &&
      decryptedAfterBts.value === benignLookalike &&
      decryptedAfterBts.syncSeq > (encryptedBeforeBts?.syncSeq ?? 0),
    "clearing a held-back false-positive decrypts row and bumps syncSeq once",
  );

  // 3. Copy BTS test B: Real contextual credential stays masked & encrypted, no syncSeq bump!
  const realSecret =
    "Send mW7JOh9_kYe406Cz2QR in the X-Access header for our internal demo service.";
  const immediateSecret = await saveText(realSecret);
  const [secretBefore] = all<{ encrypted: number | null; syncSeq: number }>(
    database,
    `SELECT encrypted, syncSeq FROM "CLIPBOARD_ITEMS" WHERE id = ?`,
    immediateSecret.id,
  );
  await waitForLocalAiIdle();
  const [secretAfter] = all<{
    encrypted: number | null;
    syncSeq: number;
    actions: number;
    actionsVersion: number;
  }>(
    database,
    `SELECT encrypted, syncSeq, actions, actionsVersion FROM "CLIPBOARD_ITEMS" WHERE id = ?`,
    immediateSecret.id,
  );
  check(
    secretAfter?.encrypted === 1 &&
      secretAfter.actions === 0 &&
      secretAfter.actionsVersion === ClipboardItemActionsVersion.localAi &&
      secretAfter.syncSeq === secretBefore?.syncSeq,
    "confirmed secret stays encrypted with 0 actions and does NOT re-bump syncSeq",
  );

  // 4. Copy BTS test C: Stack trace gets deterministic actions immediately, then Gemma adds
  //    copyErrorLine behind the scenes WITHOUT bumping syncSeq or firing sync listeners!
  const stackTrace =
    "TypeError: Cannot read properties of undefined\n    at build (src/app.js:12:9)\n    at main (src/index.js:7:3)";
  const immediateStack = await saveText(stackTrace);
  check(
    hasClipboardAction(immediateStack.actions, ClipboardItemAction.qr) &&
      !hasClipboardAction(
        immediateStack.actions,
        ClipboardItemAction.copyErrorLine,
      ),
    "stack trace starts with deterministic QR action immediately",
  );
  const [stackBefore] = all<{ syncSeq: number }>(
    database,
    `SELECT syncSeq FROM "CLIPBOARD_ITEMS" WHERE id = ?`,
    immediateStack.id,
  );
  const syncTriggersBeforeStackBts = syncTriggers;
  const uiPushesBeforeStackBts = uiPushes;

  await waitForLocalAiIdle();

  const upgradedStack = await getClipboardItem(immediateStack.id, app);
  const [stackAfter] = all<{ syncSeq: number; actionsVersion: number }>(
    database,
    `SELECT syncSeq, actionsVersion FROM "CLIPBOARD_ITEMS" WHERE id = ?`,
    immediateStack.id,
  );
  check(
    upgradedStack !== null &&
      hasClipboardAction(
        upgradedStack.actions,
        ClipboardItemAction.copyErrorLine,
      ) &&
      upgradedStack.actionsVersion === ClipboardItemActionsVersion.localAi,
    "Gemma BTS classification sets copyErrorLine bit in cache and SQLite",
  );
  check(
    stackAfter?.syncSeq === stackBefore?.syncSeq &&
      syncTriggers === syncTriggersBeforeStackBts &&
      uiPushes > uiPushesBeforeStackBts,
    "action-only BTS update pushes UI event without bumping syncSeq or triggering sync engine",
  );

  // 5. Sync batch BTS test: SqliteSyncStore commits incoming records fast, masks ambiguous
  //    candidates before disk write, and classifies the whole batch post-COMMIT.
  const store = new SqliteSyncStore(app);
  const now = Date.now();
  const syncSecretId = "11111111-1111-4111-8111-111111111111";
  const syncBenignId = "22222222-2222-4222-8222-222222222222";
  const syncJsonId = "33333333-3333-4333-8333-333333333333";
  const syncStackId = "44444444-4444-4444-8444-444444444444";

  const syncRecord = (
    id: string,
    text: string,
    dateCopied: number,
  ): ItemRecord => ({
    image: null,
    id,
    kind: "text",
    text,
    createdAt: dateCopied,
    origin: "peer-device-1",
    dateCopied,
    sourceApp: "Terminal",
    pinned: null,
    deletedAt: null,
  });

  await store.transaction(async (tx) => {
    await tx.put(
      syncRecord(
        syncSecretId,
        "Authorization bearer token for staging: mW7JOh9_kYe406Cz2QR",
        now - 4000,
      ),
    );
    await tx.put(
      syncRecord(
        syncBenignId,
        "Public documentation page xT7_qM2pK9vR4nL8wZ3 explains how token rotation works.",
        now - 3000,
      ),
    );
    await tx.put(
      syncRecord(
        syncJsonId,
        '{"contact":"team@example.com","ok":true}',
        now - 2000,
      ),
    );
    await tx.put(
      syncRecord(
        syncStackId,
        "ReferenceError: config is not defined\n    at init (src/boot.ts:21:5)\n    at start (src/main.ts:4:1)",
        now - 1000,
      ),
    );
  });

  // Immediately after COMMIT, JSON item already has deterministic actions in cache!
  const cachedJson = getCachedActions(syncJsonId);
  check(
    cachedJson !== undefined &&
      hasClipboardAction(cachedJson.actions, ClipboardItemAction.formatJson) &&
      hasClipboardAction(
        cachedJson.actions,
        ClipboardItemAction.contactEmail,
      ) &&
      hasClipboardAction(cachedJson.actions, ClipboardItemAction.qr),
    "sync transaction populates write-through actionCache on commit",
  );

  await waitForLocalAiIdle();

  // Clear in-memory cache and verify SQLite persisted all sync BTS results accurately.
  clearCachedActions();
  const loadedSyncSecret = await getClipboardItem(syncSecretId, app);
  const loadedSyncBenign = await getClipboardItem(syncBenignId, app);
  const loadedSyncJson = await getClipboardItem(syncJsonId, app);
  const loadedSyncStack = await getClipboardItem(syncStackId, app);

  check(
    loadedSyncSecret !== null &&
      loadedSyncSecret.secrets.length > 0 &&
      loadedSyncSecret.actions === 0 &&
      loadedSyncSecret.actionsVersion === ClipboardItemActionsVersion.localAi,
    "synced contextual secret stays masked with 0 actions in SQLite",
  );
  check(
    loadedSyncBenign !== null &&
      loadedSyncBenign.secrets.length === 0 &&
      hasClipboardAction(loadedSyncBenign.actions, ClipboardItemAction.qr) &&
      loadedSyncBenign.actionsVersion === ClipboardItemActionsVersion.localAi,
    "synced benign documentation slug is unmasked and given QR action in SQLite",
  );
  check(
    loadedSyncStack !== null &&
      hasClipboardAction(
        loadedSyncStack.actions,
        ClipboardItemAction.copyErrorLine,
      ) &&
      loadedSyncStack.actionsVersion === ClipboardItemActionsVersion.localAi,
    "synced stack trace receives copyErrorLine action in SQLite",
  );
  check(
    loadedSyncJson !== null &&
      hasClipboardAction(
        loadedSyncJson.actions,
        ClipboardItemAction.formatJson,
      ) &&
      hasClipboardAction(
        loadedSyncJson.actions,
        ClipboardItemAction.contactEmail,
      ) &&
      loadedSyncJson.actionsVersion === ClipboardItemActionsVersion.localAi,
    "synced JSON/email item reloads full precomputed bitmask from SQLite",
  );

  // 6. Per-model removal keeps the other model active, removing both disables Local AI cleanly.
  const afterRemoveGemma = await removeLocalAi(app, gemmaModel.id);
  check(
    afterRemoveGemma.installed &&
      afterRemoveGemma.enabled &&
      afterRemoveGemma.models.find((m) => m.id === classifierModel.id)
        ?.installed === true &&
      afterRemoveGemma.models.find((m) => m.id === gemmaModel.id)?.installed ===
        false,
    "removing Gemma leaves Q12 classifier installed and Local AI enabled",
  );
  const afterRemoveAll = await removeLocalAi(app);
  check(
    !afterRemoveAll.installed && !afterRemoveAll.enabled,
    "removing remaining models disables Local AI cleanly",
  );

  console.log("Local AI dual-model + BTS copy/sync integration passed.");
} finally {
  unsubscribeHistory();
  clearCachedActions();
  forgetDecryptedTexts();
  await tjs.remove(temp);
}
