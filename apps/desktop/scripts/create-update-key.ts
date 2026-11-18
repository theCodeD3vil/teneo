// Makes Teneo's update-signing key. Run once, on your Mac:
//   bun run release:key [--vault NAME]   (default: Personal)
// The private half goes straight into 1Password over stdin (never to disk,
// the screen or the process list) and is read back once to check it. The
// public half goes into tinyjs.json, which every build bakes in: from then
// on, installed apps accept only manifests this key signed.
/* oxlint-disable no-console -- a command-line script reports on the console */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

import {
  publicKeysOf,
  UPDATE_KEY_TITLE as KEY_TITLE,
  UPDATE_KEY_VAULT,
  updateKeyReference,
} from "./release-manifest.ts";

const vault = process.argv.includes("--vault")
  ? process.argv[process.argv.indexOf("--vault") + 1]
  : UPDATE_KEY_VAULT;
const configPath = "tinyjs.json";
const config = JSON.parse(readFileSync(configPath, "utf8")) as {
  update?: Record<string, unknown>;
};

if (publicKeysOf(config).length > 0) {
  console.error(
    "tinyjs.json already has an update key. To replace it, see docs/release-process.md › Rotating the key.",
  );
  process.exit(1);
}

const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
  "sign",
  "verify",
])) as unknown as {
  privateKey: Parameters<typeof crypto.subtle.exportKey>[1];
  publicKey: Parameters<typeof crypto.subtle.exportKey>[1];
};
const privateKey = Buffer.from(
  await crypto.subtle.exportKey("pkcs8", pair.privateKey),
).toString("base64");
const publicKey = Buffer.from(
  await crypto.subtle.exportKey("raw", pair.publicKey),
).toString("base64");

const item = {
  title: KEY_TITLE,
  category: "PASSWORD",
  fields: [
    {
      id: "password",
      type: "CONCEALED",
      purpose: "PASSWORD",
      label: "password",
      value: privateKey,
    },
    {
      id: "notesPlain",
      type: "STRING",
      purpose: "NOTES",
      label: "notesPlain",
      value:
        "Ed25519 private key (PKCS8 DER, base64) that signs Teneo's update manifests. " +
        `Public key: ${publicKey}. Created ${new Date().toISOString().slice(0, 10)}. ` +
        "Used by apps/desktop/scripts/publish-release.ts. Never put it in Doppler or GitHub.",
    },
  ],
};

console.log(
  `Saving the private key to 1Password (vault "${vault}"). Approve with Touch ID.`,
);
// op reads a template from stdin only when stdin is a real pipe. A child's
// stdin here is a socket, so `cat |` hands op the pipe it looks for.
const create = spawnSync(
  "sh",
  ["-c", 'cat | op item create --vault "$1" --format json -', "sh", vault],
  {
    input: JSON.stringify(item),
    stdio: ["pipe", "pipe", "inherit"],
  },
);
if (create.status !== 0) {
  console.error(
    "1Password didn't save the key (its error is above), so nothing changed.",
  );
  process.exit(1);
}

// Read it back and sign with it: a key that can't verify must not be pinned.
const reference = updateKeyReference(vault);
const readBack = spawnSync("op", ["read", "--no-newline", reference], {
  stdio: ["ignore", "pipe", "inherit"],
});
const stored = readBack.stdout.toString();
const probe = new TextEncoder().encode("teneo update key check");
const signingKey = await crypto.subtle.importKey(
  "pkcs8",
  Buffer.from(stored, "base64"),
  "Ed25519",
  false,
  ["sign"],
);
const verifyKey = await crypto.subtle.importKey(
  "raw",
  Buffer.from(publicKey, "base64"),
  "Ed25519",
  false,
  ["verify"],
);
if (
  !(await crypto.subtle.verify(
    "Ed25519",
    verifyKey,
    await crypto.subtle.sign("Ed25519", signingKey, probe),
    probe,
  ))
) {
  console.error(
    `The key read back from 1Password doesn't match. Delete "${KEY_TITLE}" there and run this again.`,
  );
  process.exit(1);
}

config.update = { ...config.update, publicKey };
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

console.log(`\nDone. The public key is now in tinyjs.json:\n  ${publicKey}`);
console.log(
  `The private key is in 1Password as "${KEY_TITLE}" (${reference}).`,
);
if (vault !== UPDATE_KEY_VAULT)
  console.log(
    `Publishing needs that address: export TENEO_UPDATE_KEY_REF="${reference}"`,
  );
