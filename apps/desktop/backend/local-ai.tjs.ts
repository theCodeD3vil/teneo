// Runs on the real txiki runtime with a fake app and synthetic history.
/* oxlint-disable no-console -- test summary */
import { possibleCredentialLabel } from "@teneo/shared/types/clipboard";
import { maskSecrets } from "@teneo/ui/utils/secrets";

import {
  forgetDecryptedTexts,
  getClipboardItem,
  initializeDatabase,
  refreshDetectionMetadata,
  saveClipboardItem,
  turnOnSecretEncryption,
} from "./database";
import { isDevRun } from "./dev-run";
import {
  downloadLocalAi,
  classifyLocalAiText,
  enableLocalAi,
  getLocalAiStatus,
  removeLocalAi,
} from "./local-ai";
import { developmentModel as model } from "./local-ai-model";
import { suggestLocalAiAction } from "./local-ai-preview";
import { appPaths } from "./paths";
import { all, run } from "./sqlite";
import { SqliteSyncStore } from "./sync/sync-store";

if (!isDevRun()) throw new Error("Set TINYJS_ICON for the isolated test");
const weights = tjs.args[3];
if (!weights) throw new Error("Pass the path of the verified dev GGUF");

const temp = await tjs.makeTempDir(`${tjs.tmpDir}/teneo-ai-test-XXXXXX`);
const stored = new Map<string, unknown>();
const keys = new Map<string, string>();
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
  push: () => {},
} as unknown as TinyApp;

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
  const before = await getLocalAiStatus(app);
  check(
    before.available && !before.installed && !before.enabled,
    "runner is available without downloading or enabling",
  );
  const path = `${(await appPaths(app)).data}/models`;
  await tjs.makeDir(path, { recursive: true });
  const weightPath = `${path}/${model.filename}`;
  await tjs.link(weights, weightPath);
  const installed = await downloadLocalAi(model.id, app);
  check(
    installed.installed && !installed.enabled,
    "existing verified model is reused without opt-in",
  );
  const item = await saveText(
    "TypeError: Cannot read properties of undefined\n    at build (src/app.js:12:9)\n    at main (src/index.js:7:3)",
  );
  check(
    (await suggestLocalAiAction(item.id, app)) === null,
    "no inference before opt-in",
  );
  const example =
    "Staging account username: demo-user\nPassword: FrostyKite93!";
  const unprotected = await saveText(example);
  check(
    unprotected.secrets.length === 0,
    "enhanced detection is off before opt-in",
  );
  check((await enableLocalAi(true, app)).enabled, "model can be enabled");
  const masked = await saveText(example);
  check(masked.id === unprotected.id, "recopy updates the existing row");
  check(
    masked.secrets[0]?.label === possibleCredentialLabel,
    "unfamiliar credential detected while saving",
  );
  check(
    maskSecrets(example, masked.secrets)
      .map(({ text }) => text)
      .join("") === "Staging account username: demo-user\nPassword: ********",
    "masks the credential and leaves the username visible",
  );
  const context =
    "Send [VALUE] in the X-Access header for our internal demo service.";
  check(
    (await classifyLocalAiText("secrets", context, app)) === "possible_secret",
    "real sandboxed classification identifies an unfamiliar context",
  );
  const contextual = await saveText(
    "Send mW7JOh9_kYe406Cz2QR in the X-Access header for our internal demo service.",
  );
  check(
    contextual.secrets[0]?.label === possibleCredentialLabel,
    "AI result stored during capture",
  );
  const harmless = await saveText(
    'Set PASSWORD="<your password here>". This is documentation.',
  );
  check(!harmless.secrets.length, "the documented placeholder stays visible");
  const store = new SqliteSyncStore(app);
  check(
    (await store.changesAfter(0, 50)).changes.find(
      ({ record }) => record.id === contextual.id,
    )?.hasSecret,
    "sync sees the credential as sensitive",
  );
  const database = await initializeDatabase(app);
  run(
    database,
    `UPDATE "CLIPBOARD_ITEMS" SET detectorVersion = 0 WHERE id = ?`,
    contextual.id,
  );
  await refreshDetectionMetadata(app);
  check(
    (await getClipboardItem(contextual.id, app))?.secrets[0]?.label ===
      possibleCredentialLabel,
    "rule refresh preserves enhanced spans",
  );
  check(await turnOnSecretEncryption(app), "can encrypt later");
  const protectedLink = await saveText(
    "https://example.invalid/?access_token=unprefixedZs394nxV4Mx61",
  );
  check(
    protectedLink.secrets.length && protectedLink.link === null,
    "URLs with credentials cannot get external link previews",
  );
  for (const item of [masked, contextual, protectedLink]) {
    const [row] = all<{ encrypted: number; value: string }>(
      database,
      `SELECT encrypted, value FROM "CLIPBOARD_ITEMS" WHERE id = ?`,
      item.id,
    );
    check(
      row?.encrypted === 1 && row.value !== item.text,
      "credential is encrypted at rest when requested",
    );
  }
  const note = await saveText("Error: This is just an ordinary heading.");
  check(
    (await suggestLocalAiAction(note.id, app)) === null,
    "notes are not treated as stack traces",
  );
  const sensitive = await saveText(
    "TypeError: failed to open postgres://dev:fixture@db.example.com/app\n    at build (src/app.js:12:9)",
  );
  check(sensitive.secrets.length > 0, "fixture matches the existing scanner");
  check(
    (await suggestLocalAiAction(sensitive.id, app)) === null,
    "known secrets are not sent for suggestions",
  );
  check(
    (await suggestLocalAiAction(item.id, app)) === "copy-error-line",
    "txiki offered the known stack action",
  );
  check(!(await enableLocalAi(false, app)).enabled, "turning it off works");
  check(
    (await getLocalAiStatus(app)).installed,
    "turning it off keeps the model",
  );
  check(!(await removeLocalAi(app)).installed, "removing it clears the model");
  console.log("Local AI txiki integration passed.");
} finally {
  forgetDecryptedTexts();
  await tjs.remove(temp);
}
