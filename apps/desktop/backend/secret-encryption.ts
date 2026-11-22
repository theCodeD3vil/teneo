/// <reference lib="esnext.typedarrays" />
// ↑ types for Uint8Array's base64 methods, which txiki has

import { devName } from "./dev-run";
import {
  type HistoryKeyEnvelope,
  openHistoryKeyEnvelope,
} from "./history-key-envelope";

// With "Encrypt API keys" on, text holding a secret is saved encrypted
// (AES-GCM) with a key kept in the macOS Keychain, so the database file alone
// never gives the secret away. The Keychain only hands the key to Teneo itself.
// a dev run keeps its own key, so it never reads or replaces the real one
const keychainKeyName = () => devName("history-encryption-key");
const ivLength = 12; // bytes, the size AES-GCM is designed for

// Read once per launch. A failed read (the user denied the Keychain prompt)
// isn't retried until the next launch or until the user turns encryption on
// again, so the prompt doesn't keep coming back.
let encryptionKeyPromise: Promise<CryptoKey> | null = null;
let hardwareKey: HistoryKeyEnvelope | null = null;
let unreadableEnvelope = false;
let unlocked: CryptoKey | null = null;
let unlockedUntil = 0;
let lockTimer: ReturnType<typeof setTimeout> | undefined;
let onLock: (() => void) | undefined;
const unlockMs = 5 * 60_000;

function getEncryptionKey(app: TinyApp): Promise<CryptoKey> {
  assertHistoryUnlocked();
  if (!encryptionKeyPromise) {
    if (!hardwareKey) throw new HistoryKeychainAccessRequired();
    encryptionKeyPromise = openHardwareKey(app, hardwareKey, false);
  }
  return encryptionKeyPromise;
}

export class HistoryKeychainAccessRequired extends Error {
  constructor() {
    super("Allow access to the history key in Settings → Security.");
  }
}

export function needsHistoryKeychainAccess(): boolean {
  return !hasHardwareHistoryKey() && !encryptionKeyPromise;
}

async function loadOrCreateEncryptionKey(app: TinyApp): Promise<CryptoKey> {
  if (hardwareKey) return openHardwareKey(app, hardwareKey, false);
  // get() throws when the Keychain can't be read, and returns null only when
  // the key was never saved, so an existing key is never replaced
  const savedKey = await loadSavedEncryptionKey(app);
  if (savedKey) return savedKey;

  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  try {
    if (!(await app.secrets.set(keychainKeyName(), keyBytes.toBase64())))
      throw new Error("Teneo couldn't save the history key.");
    return await importEncryptionKey(keyBytes);
  } finally {
    keyBytes.fill(0);
  }
}

async function loadSavedEncryptionKey(app: TinyApp): Promise<CryptoKey | null> {
  const savedKey = await app.secrets.get(keychainKeyName());
  if (!savedKey) return null;
  const bytes = Uint8Array.fromBase64(savedKey);
  try {
    if (bytes.length !== 32) throw new Error("The history key is invalid.");
    return await importEncryptionKey(bytes);
  } finally {
    bytes.fill(0);
  }
}

export class LockedHistoryError extends Error {
  constructor() {
    super("Unlock saved secrets in Settings → Security.");
  }
}

export function currentHistoryKeyEnvelope(): HistoryKeyEnvelope | null {
  return hardwareKey;
}

export function hasHardwareHistoryKey(): boolean {
  return hardwareKey !== null || unreadableEnvelope;
}

export function setHistoryKeyEnvelope(
  envelope: HistoryKeyEnvelope | null,
  afterLock: () => void,
  unreadable = false,
): void {
  clearTimeout(lockTimer);
  hardwareKey = envelope;
  unreadableEnvelope = unreadable;
  encryptionKeyPromise = null;
  unlocked = null;
  unlockedUntil = 0;
  onLock = afterLock;
}

export function areHistorySecretsLocked(): boolean {
  return (
    !!hardwareKey?.requireAuthentication &&
    (!unlocked || Date.now() >= unlockedUntil)
  );
}

export function assertHistoryUnlocked(): void {
  if (unreadableEnvelope)
    throw new Error("Teneo's protected history key is unreadable.");
  if (areHistorySecretsLocked()) {
    lockHistorySecrets();
    throw new LockedHistoryError();
  }
}

export function lockHistorySecrets(): void {
  if (!hardwareKey?.requireAuthentication || !unlocked) return;
  clearTimeout(lockTimer);
  unlocked = null;
  encryptionKeyPromise = null;
  unlockedUntil = 0;
  onLock?.();
}

export async function unlockHistorySecrets(app: TinyApp): Promise<void> {
  if (!hardwareKey?.requireAuthentication || !areHistorySecretsLocked()) return;
  const key = await openHardwareKey(app, hardwareKey, true);
  unlocked = key;
  unlockedUntil = Date.now() + unlockMs;
  encryptionKeyPromise = Promise.resolve(key);
  clearTimeout(lockTimer);
  lockTimer = setTimeout(lockHistorySecrets, unlockMs);
}

async function openHardwareKey(
  app: TinyApp,
  envelope: HistoryKeyEnvelope,
  interact: boolean,
): Promise<CryptoKey> {
  if (envelope.requireAuthentication && !interact) {
    if (!unlocked || areHistorySecretsLocked()) throw new LockedHistoryError();
    return unlocked;
  }
  const raw = await openHistoryKeyEnvelope(app, envelope, interact);
  try {
    return await importEncryptionKey(raw);
  } finally {
    raw.fill(0);
  }
}

/** Read the key, or create it, now. This is when macOS may ask for the Mac
 *  password. Rejects when the Keychain can't be read. */
export async function prepareEncryptionKey(app: TinyApp): Promise<void> {
  assertHistoryUnlocked();
  encryptionKeyPromise = loadOrCreateEncryptionKey(app);
  try {
    await encryptionKeyPromise;
  } catch (error) {
    encryptionKeyPromise = null;
    throw error;
  }
}

/** Restore must never replace an original key used by saved history. */
export async function restoreHistoryKeychainAccess(
  app: TinyApp,
  hasEncryptedHistory: boolean,
): Promise<void> {
  if (hasHardwareHistoryKey()) return;
  if (!hasEncryptedHistory) return prepareEncryptionKey(app);
  if (!(await restrictToSavedEncryptionKey(app)))
    throw new Error(
      "The original history key is missing. Saved secrets are still encrypted.",
    );
}

/** Make decryptText use the saved key and never create a new one. Resolves
 *  false when no key is saved; rejects when the Keychain can't be read. */
export async function restrictToSavedEncryptionKey(
  app: TinyApp,
): Promise<boolean> {
  assertHistoryUnlocked();
  const savedKey = hardwareKey
    ? await getEncryptionKey(app)
    : await loadSavedEncryptionKey(app);
  encryptionKeyPromise = savedKey ? Promise.resolve(savedKey) : null;
  return savedKey !== null;
}

export async function deleteEncryptionKey(app: TinyApp): Promise<void> {
  encryptionKeyPromise = null;
  await removeLegacyEncryptionKey(app);
}

export async function removeLegacyEncryptionKey(app: TinyApp): Promise<void> {
  await app.secrets.delete(keychainKeyName());
}

export function importEncryptionKey(
  keyBytes: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

/** Base64 of a random IV followed by the ciphertext. */
export async function encryptText(text: string, app: TinyApp): Promise<string> {
  return encryptHistoryText(text, await getEncryptionKey(app));
}

export async function encryptHistoryText(
  text: string,
  key: CryptoKey,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(ivLength));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(text),
  );
  const encrypted = new Uint8Array(ivLength + ciphertext.byteLength);
  encrypted.set(iv);
  encrypted.set(new Uint8Array(ciphertext), ivLength);
  return encrypted.toBase64();
}

/** Throws when the key can't be read, or isn't the one the text was encrypted with. */
export async function decryptText(
  encryptedText: string,
  app: TinyApp,
): Promise<string> {
  const encrypted = Uint8Array.fromBase64(encryptedText);
  if (encrypted.length < ivLength + 16)
    throw new Error("The encrypted history entry is incomplete.");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: encrypted.subarray(0, ivLength) },
    await getEncryptionKey(app),
    encrypted.subarray(ivLength),
  );
  assertHistoryUnlocked();
  return new TextDecoder().decode(plaintext);
}
