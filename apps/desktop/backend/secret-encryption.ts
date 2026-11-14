/// <reference lib="esnext.typedarrays" />
// ↑ types for Uint8Array's base64 methods, which txiki has

// With "Encrypt API keys" on, text holding a secret is saved encrypted
// (AES-GCM) with a key kept in the macOS Keychain, so the database file alone
// never gives the secret away. The Keychain only hands the key to Teneo itself.
const keychainKeyName = "history-encryption-key";
const ivLength = 12; // bytes, the size AES-GCM is designed for

// Read once per launch. A failed read (the user denied the Keychain prompt)
// isn't retried until the next launch or until the user turns encryption on
// again, so the prompt doesn't keep coming back.
let encryptionKeyPromise: Promise<CryptoKey> | null = null;

function getEncryptionKey(app: TinyApp): Promise<CryptoKey> {
  encryptionKeyPromise ??= loadOrCreateEncryptionKey(app);
  return encryptionKeyPromise;
}

async function loadOrCreateEncryptionKey(app: TinyApp): Promise<CryptoKey> {
  // get() throws when the Keychain can't be read, and returns null only when
  // the key was never saved, so an existing key is never replaced
  const savedKey = await loadSavedEncryptionKey(app);
  if (savedKey) return savedKey;

  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  await app.secrets.set(keychainKeyName, keyBytes.toBase64());
  return importEncryptionKey(keyBytes);
}

async function loadSavedEncryptionKey(app: TinyApp): Promise<CryptoKey | null> {
  const savedKey = await app.secrets.get(keychainKeyName);
  return savedKey ? importEncryptionKey(Uint8Array.fromBase64(savedKey)) : null;
}

/** Read the key, or create it, now. This is when macOS may ask for the Mac
 *  password. Rejects when the Keychain can't be read. */
export async function prepareEncryptionKey(app: TinyApp): Promise<void> {
  encryptionKeyPromise = loadOrCreateEncryptionKey(app);
  await encryptionKeyPromise;
}

/** Make decryptText use the saved key and never create a new one. Resolves
 *  false when no key is saved; rejects when the Keychain can't be read. */
export async function restrictToSavedEncryptionKey(
  app: TinyApp,
): Promise<boolean> {
  const savedKey = await loadSavedEncryptionKey(app);
  encryptionKeyPromise = savedKey ? Promise.resolve(savedKey) : null;
  return savedKey !== null;
}

export async function deleteEncryptionKey(app: TinyApp): Promise<void> {
  encryptionKeyPromise = null;
  await app.secrets.delete(keychainKeyName);
}

function importEncryptionKey(
  keyBytes: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

/** Base64 of a random IV followed by the ciphertext. */
export async function encryptText(text: string, app: TinyApp): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(ivLength));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await getEncryptionKey(app),
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
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: encrypted.subarray(0, ivLength) },
    await getEncryptionKey(app),
    encrypted.subarray(ivLength),
  );
  return new TextDecoder().decode(plaintext);
}
